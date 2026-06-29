package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/big"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
	h3 "github.com/uber/h3-go/v3"

	dispatchDomain "github.com/platform/driver-delivery/internal/dispatch/domain"
	"github.com/platform/driver-delivery/internal/domain"
	"github.com/platform/driver-delivery/internal/rider/realtime"
	"github.com/platform/driver-delivery/internal/rider/repository"
)

// driverAssignmentsChannel mirrors gateway/delivery/http.RedisPubSubChannel. A
// JSON payload carrying "fare_estimate" on this channel is forwarded raw to the
// driver's order-keyed WebSocket (see InternalBackplaneMultiplexer).
const driverAssignmentsChannel = "gateway:assignments:broadcast"

// Business sentinels for booking.
var (
	ErrActiveOrderExists   = errors.New("rider already has an active trip")
	ErrNoActiveOrder       = errors.New("no active order")
	ErrOrderNotCancellable = errors.New("order cannot be cancelled in its current state")
	ErrCarNotFound         = errors.New("no usable car for this booking")
	ErrInvalidBooking      = errors.New("invalid booking request")
	ErrTripShareExpired    = errors.New("trip share link expired or invalid")
	ErrAlreadyRated        = errors.New("order is not ratable (not completed, not owned, or already rated)")
	ErrTripNotActive       = errors.New("order is not an active (DELIVERING) trip")
	ErrTooManyStops        = errors.New("maximum of 3 stops already added")
	ErrMonthlyNotBookable  = errors.New("monthly package estimate only; recurring billing not yet available")
	ErrOutsideServiceArea  = errors.New("pickup is outside our service area; Vahnly operates in Kolkata only for now")
)

// Fare engine constants for the metered point-to-point path. Per-tier base/per-km live in the
// metered rate card (package_pricing.go meteredCard); the surge multiplier comes from
// FareQuoter.GetFareQuote.
const (
	d4mCarePaise     int64 = 4900
	nightChargePaise int64 = 5000
	roadFactor             = 1.3
	deg2rad                = math.Pi / 180.0
)

// istZone is UTC+05:30. Built explicitly so night-charge logic does not depend
// on the host tz database.
var istZone = time.FixedZone("IST", 5*3600+30*60)

// FareQuoter is satisfied by *pricing/service.OrderPricingService. Abstracted so
// the fare math is unit-testable without Redis/Kafka.
type FareQuoter interface {
	GetFareQuote(ctx context.Context, city, h3Cell string, distanceMeters float64) (int64, float64, error)
}

// EventPublisher publishes a message to a named Kafka topic.
type EventPublisher interface {
	Publish(ctx context.Context, topic, key string, value []byte) error
}

// GarageReader is the slice of the rider repository booking needs to resolve cars.
type GarageReader interface {
	GetGarageCars(ctx context.Context, riderID string) ([]*domain.RiderGarageCar, error)
}

// EmergencyReader is the slice of the rider repository SOS needs.
type EmergencyReader interface {
	GetEmergencyContacts(ctx context.Context, riderID string) ([]*domain.RiderEmergencyContact, error)
}

type BookingService struct {
	orders    repository.RiderOrderRepository
	garage    GarageReader
	quoter    FareQuoter
	promo     PromoValidator
	cache     *redis.ClusterClient
	publisher EventPublisher
	emergency EmergencyReader
	sms       SMSSender
}

func NewBookingService(orders repository.RiderOrderRepository, garage GarageReader, quoter FareQuoter, promo PromoValidator, cache *redis.ClusterClient, publisher EventPublisher, emergency EmergencyReader, sms SMSSender) *BookingService {
	return &BookingService{orders: orders, garage: garage, quoter: quoter, promo: promo, cache: cache, publisher: publisher, emergency: emergency, sms: sms}
}

// ---- request/response DTOs ----

type FareEstimateRequest struct {
	PickupLat     float64    `json:"pickup_lat"`
	PickupLng     float64    `json:"pickup_lng"`
	DropoffLat    *float64   `json:"dropoff_lat"`
	DropoffLng    *float64   `json:"dropoff_lng"`
	TripType      string     `json:"trip_type"`
	PackageType   string     `json:"package_type"` // HOURLY|MINI_OUTSTATION|OUTSTATION|MONTHLY; empty = distance-priced
	DurationHours int        `json:"duration_hours"`
	CarType       string     `json:"car_type"`
	Transmission  string     `json:"transmission"`
	ScheduledAt   *time.Time `json:"scheduled_at"`
	PromoCode     string     `json:"promo_code"`
	D4MCare       bool       `json:"d4m_care"`
	PaymentMethod string     `json:"payment_method"`
	City          string     `json:"city"`
}

type FareBreakdown struct {
	BaseFarePaise        int64   `json:"base_fare_paise"`
	DistanceChargePaise  int64   `json:"distance_charge_paise"`
	NightChargePaise     int64   `json:"night_charge_paise"`
	OvertimePaise        int64   `json:"overtime_paise"`
	DriverAllowancePaise int64   `json:"driver_allowance_paise"`
	D4MCarePaise         int64   `json:"d4m_care_paise"`
	SurgeMultiplier      float64 `json:"surge_multiplier"`
	PromoDiscountPaise   int64   `json:"promo_discount_paise"`
	EstimatedTotalPaise  int64   `json:"estimated_total_paise"`
	EstimatedTotalINR    string  `json:"estimated_total_inr"`
}

type FareEstimate struct {
	FareBreakdown         FareBreakdown `json:"fare_breakdown"`
	EstimatedPickupETAMin int           `json:"estimated_pickup_eta_minutes"`
	DriverAvailability    string        `json:"driver_availability"`
	SurgeActive           bool          `json:"surge_active"`
	H3Cell                string        `json:"h3_cell"`

	// dispatchFarePaise is the surged (base+distance) fare stored on the order and
	// sent to dispatch. promoCodeID carries the resolved promo_codes.id so the
	// order-create path can lock + redeem it. Neither is serialized.
	dispatchFarePaise int64  `json:"-"`
	promoCodeID       string `json:"-"`
}

// EstimateFare computes a fare quote: tiered flat rate card for package/block bookings, or the
// surged distance-metered engine for point-to-point.
func (s *BookingService) EstimateFare(ctx context.Context, req FareEstimateRequest) (*FareEstimate, error) {
	if !inIndiaBBox(req.PickupLat, req.PickupLng) {
		return nil, ErrInvalidBooking
	}
	city := strings.ToUpper(strings.TrimSpace(req.City))
	if city == "" {
		city = "KOL"
	}

	// One-way road distance (metres). Used by the metered path and by outstation extra-km math;
	// computed up-front so both branches can read it.
	straight := 0.0
	if req.DropoffLat != nil && req.DropoffLng != nil {
		straight = haversineMeters(req.PickupLat, req.PickupLng, *req.DropoffLat, *req.DropoffLng)
	}
	roadMeters := straight * roadFactor
	if strings.Contains(strings.ToUpper(req.TripType), "ROUND") {
		roadMeters *= 2 // return leg
	}

	cell := h3CellRes8(req.PickupLat, req.PickupLng)

	when := time.Now()
	if req.ScheduledAt != nil {
		when = *req.ScheduledAt
	}

	// Package/block pricing: tiered flat rate card, NO surge (the differentiator — this path never
	// calls the surge quoter). Promo + D4M still apply. Overtime/extra-km are 0 at estimate time
	// (no actual km/hours yet); they are applied at trip-end billing.
	if q, ok := packageQuote(req.PackageType, req.CarType, req.DurationHours, roadMeters/1000, when); ok {
		d4m := int64(0)
		if req.D4MCare {
			d4m = d4mCarePaise
		}
		// Promo validates against the commissionable service fare, not the allowance reimbursement.
		var promoDiscount int64
		var promoCodeID string
		if res, _ := s.promo.Validate(ctx, req.PromoCode, q.ServiceFarePaise(), city); res != nil {
			promoDiscount = res.DiscountPaise
			promoCodeID = res.PromoCodeID
		}
		total := q.ServiceFarePaise() + q.RiderAddonsPaise() + d4m - promoDiscount
		if total < 0 {
			total = 0
		}
		availability, _ := s.driverAvailability(ctx, city, req.PickupLat, req.PickupLng)
		return &FareEstimate{
			FareBreakdown: FareBreakdown{
				BaseFarePaise:        q.BasePaise,
				DistanceChargePaise:  q.ExtraKmPaise,
				NightChargePaise:     q.NightChargePaise,
				OvertimePaise:        q.OvertimePaise,
				DriverAllowancePaise: q.DriverAllowancePaise,
				D4MCarePaise:         d4m,
				SurgeMultiplier:      1.0, // packages are never surged
				PromoDiscountPaise:   promoDiscount,
				EstimatedTotalPaise:  total,
				EstimatedTotalINR:    fmt.Sprintf("₹%.2f", float64(total)/100),
			},
			EstimatedPickupETAMin: pickupETA(availability),
			DriverAvailability:    availability,
			SurgeActive:           false,
			H3Cell:                cell,
			// dispatchFarePaise is the commissionable service fare (base + extra-km + overtime),
			// EXCLUDING night surcharge, the driver-allowance reimbursement, D4M and promo — the
			// allowance is a 100% rider→driver passthrough and must not inflate the payout/commission
			// basis. Mirrors the metered path (which dispatches base+distance only).
			dispatchFarePaise: q.ServiceFarePaise(),
			promoCodeID:       promoCodeID,
		}, nil
	}

	// Tier-based pre-surge metered fare (base + per-km), then apply the live surge multiplier from
	// the engine (which also enforces the admin freeze cap). The quoter's own base-derived subtotal
	// is discarded — the tier rate card is authoritative for the base.
	base, perKmPaise := meteredRateFor(req.CarType)
	distanceCharge := int64(math.Round(float64(perKmPaise) * roadMeters / 1000))
	preSurge := base + distanceCharge
	_, multiplier, err := s.quoter.GetFareQuote(ctx, city, cell, roadMeters)
	if err != nil {
		return nil, err
	}
	surgedSubtotal := int64(float64(preSurge) * multiplier)

	night := int64(0)
	if isNightIST(when) {
		night = nightChargePaise
	}

	d4m := int64(0)
	if req.D4MCare {
		d4m = d4mCarePaise
	}

	var promoDiscount int64
	var promoCodeID string
	if res, _ := s.promo.Validate(ctx, req.PromoCode, surgedSubtotal, city); res != nil {
		promoDiscount = res.DiscountPaise
		promoCodeID = res.PromoCodeID
	}

	total := surgedSubtotal + night + d4m - promoDiscount
	if total < 0 {
		total = 0
	}

	availability, _ := s.driverAvailability(ctx, city, req.PickupLat, req.PickupLng)

	return &FareEstimate{
		FareBreakdown: FareBreakdown{
			BaseFarePaise:       base,
			DistanceChargePaise: distanceCharge,
			NightChargePaise:    night,
			SurgeMultiplier:     multiplier,
			PromoDiscountPaise:  promoDiscount,
			D4MCarePaise:        d4m,
			EstimatedTotalPaise: total,
			EstimatedTotalINR:   fmt.Sprintf("₹%.2f", float64(total)/100),
		},
		EstimatedPickupETAMin: pickupETA(availability),
		DriverAvailability:    availability,
		SurgeActive:           multiplier > 1.0,
		H3Cell:                cell,
		dispatchFarePaise:     surgedSubtotal,
		promoCodeID:           promoCodeID,
	}, nil
}

// SendChatToDriver pushes a rider's chat line to the assigned driver's WS for an order the
// rider owns. Ephemeral (no persistence) — pickup coordination ("I'm at the gate"), not a
// durable thread. Published on the driver assignments backplane; the gateway forwards any
// payload carrying "chat_message" verbatim to the driver's socket.
func (s *BookingService) SendChatToDriver(ctx context.Context, riderID, orderID, text string) error {
	text = strings.TrimSpace(text)
	if text == "" || len(text) > 500 {
		return ErrInvalidBooking
	}
	driverID, err := s.orders.GetAssignedDriver(ctx, orderID, riderID)
	if err != nil {
		return err
	}
	if s.cache == nil {
		return nil
	}
	payload, _ := json.Marshal(map[string]any{
		"driver_id": driverID,
		"order_id":  orderID,
		"chat_message": map[string]any{
			"from": "RIDER",
			"text": text,
			"ts":   time.Now().Unix(),
		},
	})
	return s.cache.Publish(ctx, driverAssignmentsChannel, string(payload)).Err()
}

// SendRiderLocation pushes the rider's live pin to the assigned driver during first-mile, so
// the driver can find the exact car/pickup spot. Ephemeral, same backplane as chat.
func (s *BookingService) SendRiderLocation(ctx context.Context, riderID, orderID string, lat, lng float64) error {
	if lat == 0 && lng == 0 {
		return ErrInvalidBooking
	}
	driverID, err := s.orders.GetAssignedDriver(ctx, orderID, riderID)
	if err != nil {
		return err
	}
	if s.cache == nil {
		return nil
	}
	payload, _ := json.Marshal(map[string]any{
		"driver_id":      driverID,
		"order_id":       orderID,
		"rider_location": map[string]any{"lat": lat, "lng": lng},
	})
	return s.cache.Publish(ctx, driverAssignmentsChannel, string(payload)).Err()
}

// ---- create order ----

type StopDTO struct {
	Lat     float64 `json:"lat"`
	Lng     float64 `json:"lng"`
	Address string  `json:"address"`
}

type OneTimeCarDTO struct {
	Make         string `json:"make"`
	Model        string `json:"model"`
	CarType      string `json:"car_type"`
	Transmission string `json:"transmission"`
}

type CreateOrderRequest struct {
	PickupLat      float64        `json:"pickup_lat"`
	PickupLng      float64        `json:"pickup_lng"`
	PickupAddress  string         `json:"pickup_address"`
	DropoffLat     *float64       `json:"dropoff_lat"`
	DropoffLng     *float64       `json:"dropoff_lng"`
	DropoffAddress string         `json:"dropoff_address"`
	Stops          []StopDTO      `json:"stops"`
	TripType       string         `json:"trip_type"`
	PackageType    string         `json:"package_type"` // HOURLY|MINI_OUTSTATION|OUTSTATION|MONTHLY; empty = distance-priced
	DurationHours  int            `json:"duration_hours"`
	GarageCarID    string         `json:"garage_car_id"`
	OneTimeCar     *OneTimeCarDTO `json:"one_time_car"`
	PersonsCount   int            `json:"persons_count"`
	PromoCode      string         `json:"promo_code"`
	D4MCareOpted   bool           `json:"d4m_care_opted"`
	OwnerNotInCar  bool           `json:"owner_not_in_car"` // rider sends the car without riding along
	PaymentMethod  string         `json:"payment_method"`
	ScheduledAt    *time.Time     `json:"scheduled_at"`
	City           string         `json:"city"`
}

type CreateOrderResult struct {
	Order        *domain.RiderOrder `json:"order"`
	FareEstimate *FareEstimate      `json:"fare_estimate"`
	OTP          string             `json:"otp"`
}

func (s *BookingService) CreateOrder(ctx context.Context, riderID string, req CreateOrderRequest) (*CreateOrderResult, error) {
	// 1. one active trip per rider.
	if _, err := s.orders.GetActiveOrderID(ctx, riderID); err == nil {
		return nil, ErrActiveOrderExists
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	// Monthly/permanent packages are a recurring engagement — the estimate is supported but
	// booking needs the recurring-billing subsystem (not in this slice).
	if strings.EqualFold(strings.TrimSpace(req.PackageType), PackageMonthly) {
		return nil, ErrMonthlyNotBookable
	}

	if !inIndiaBBox(req.PickupLat, req.PickupLng) {
		return nil, ErrInvalidBooking
	}
	if req.PersonsCount < 0 || req.PersonsCount > 8 {
		return nil, ErrInvalidBooking
	}
	if len(req.Stops) > 3 {
		return nil, ErrInvalidBooking
	}
	city := strings.ToUpper(strings.TrimSpace(req.City))
	if city == "" {
		city = "KOL"
	}
	// Geofence gate: reject pickups outside the city's service area. Fail-open if
	// the check itself errors — a transient DB issue must not block all bookings.
	if ok, err := s.orders.InServiceArea(ctx, city, req.PickupLat, req.PickupLng); err == nil && !ok {
		return nil, ErrOutsideServiceArea
	}

	// 2. resolve the car (garage car / one-time / default).
	var garageCarID *string
	var otMake, otModel, otType, otTrans *string
	var carType, transmission string

	cars, err := s.garage.GetGarageCars(ctx, riderID)
	if err != nil {
		return nil, err
	}
	switch {
	case req.GarageCarID != "":
		car := findCar(cars, req.GarageCarID)
		if car == nil {
			return nil, ErrCarNotFound
		}
		garageCarID = &car.ID
		carType, transmission = car.CarType, car.Transmission
	case req.OneTimeCar != nil:
		ot := req.OneTimeCar
		if strings.TrimSpace(ot.Make) == "" || strings.TrimSpace(ot.Model) == "" ||
			strings.TrimSpace(ot.CarType) == "" || strings.TrimSpace(ot.Transmission) == "" {
			return nil, ErrInvalidBooking
		}
		otMake, otModel = &ot.Make, &ot.Model
		ct, tr := strings.ToUpper(ot.CarType), strings.ToUpper(ot.Transmission)
		otType, otTrans = &ct, &tr
		carType, transmission = ct, tr
	default:
		car := defaultCar(cars)
		if car == nil {
			return nil, ErrCarNotFound
		}
		garageCarID = &car.ID
		carType, transmission = car.CarType, car.Transmission
	}

	// 3. fare (reuse the estimate path).
	est, err := s.EstimateFare(ctx, FareEstimateRequest{
		PickupLat: req.PickupLat, PickupLng: req.PickupLng,
		DropoffLat: req.DropoffLat, DropoffLng: req.DropoffLng,
		TripType: req.TripType, PackageType: req.PackageType, DurationHours: req.DurationHours,
		CarType: carType, Transmission: transmission,
		ScheduledAt: req.ScheduledAt, PromoCode: req.PromoCode,
		D4MCare: req.D4MCareOpted, PaymentMethod: req.PaymentMethod, City: city,
	})
	if err != nil {
		return nil, err
	}

	// 4. trip-start OTP (sha256 — matches the driver verify-otp path) + 5. share token.
	otpPlain, err := generate4DigitOTP()
	if err != nil {
		return nil, err
	}
	shareToken, err := randomHex(32)
	if err != nil {
		return nil, err
	}

	// dropoff falls back to pickup (orders.dropoff_location is NOT NULL).
	dropLat, dropLng := req.PickupLat, req.PickupLng
	if req.DropoffLat != nil && req.DropoffLng != nil {
		dropLat, dropLng = *req.DropoffLat, *req.DropoffLng
	}

	waypoints, _ := json.Marshal(map[string]any{
		"pickup_address":  req.PickupAddress,
		"dropoff_address": req.DropoffAddress,
		"stops":           req.Stops,
	})

	var promoCode *string
	if strings.TrimSpace(req.PromoCode) != "" {
		promoCode = &req.PromoCode
	}
	// Only carry the promo onto the order when it actually resolved to a discount.
	var promoCodeID *string
	if est.promoCodeID != "" {
		promoCodeID = &est.promoCodeID
	} else {
		promoCode = nil
	}
	var personsCount *int
	if req.PersonsCount > 0 {
		personsCount = &req.PersonsCount
	}
	// Duration is meaningful for round-trip / outstation rides and for every package tier
	// (the package fare is computed from it).
	var bookedDuration *int
	tt := strings.ToUpper(req.TripType)
	if (strings.Contains(tt, "ROUND") || strings.Contains(tt, "OUTSTATION") || isPackageBooking(req.PackageType)) && req.DurationHours > 0 {
		bookedDuration = &req.DurationHours
	}
	paymentMethod := strings.ToUpper(strings.TrimSpace(req.PaymentMethod))
	if paymentMethod == "" {
		paymentMethod = "CASH"
	}

	orderID, err := s.orders.InsertRiderOrder(ctx, repository.InsertOrderParams{
		RiderID:                riderID,
		CityPrefix:             city,
		PickupLat:              req.PickupLat,
		PickupLng:              req.PickupLng,
		DropoffLat:             dropLat,
		DropoffLng:             dropLng,
		PickupH3Cell:           est.H3Cell,
		BaseFarePaise:          est.dispatchFarePaise,
		SurgeMultiplier:        est.FareBreakdown.SurgeMultiplier,
		OTPHash:                sha256Hex(otpPlain),
		RiderPickupOTP:         otpPlain,
		GarageCarID:            garageCarID,
		OneTimeCarMake:         otMake,
		OneTimeCarModel:        otModel,
		OneTimeCarType:         otType,
		OneTimeCarTransmission: otTrans,
		PaymentMethod:          paymentMethod,
		PromoCode:              promoCode,
		PromoCodeID:            promoCodeID,
		PromoDiscountPaise:     est.FareBreakdown.PromoDiscountPaise,
		D4MCareOpted:           req.D4MCareOpted,
		TripShareToken:         shareToken,
		TripShareExpiresAt:     time.Now().Add(24 * time.Hour),
		PersonsCount:           personsCount,
		ScheduledAt:            req.ScheduledAt,
		WaypointsJSON:          waypoints,
		BookedDurationHours:    bookedDuration,
		PackageType:            req.PackageType,
		OwnerNotInCar:          req.OwnerNotInCar,
		TripType:               req.TripType,
	})
	if err != nil {
		return nil, err
	}

	// 8. Build the dispatch payload (same shape dispatch consumes). Instant bookings — and
	// any scheduled within the lead window — publish to order.created now. A far-future
	// booking is stored verbatim instead; the dispatch scheduler replays it ~lead before
	// pickup (store-and-replay), so the up-front quote is honoured and never re-priced.
	payload := dispatchDomain.OrderCreatedPayload{
		OrderID:       orderID,
		CityPrefix:    city,
		CustomerID:    riderID,
		RiderID:       riderID,
		PickupH3Cell:  est.H3Cell,
		PickupLat:     req.PickupLat,
		PickupLng:     req.PickupLng,
		BaseFarePaise: est.dispatchFarePaise,
		RetryCount:    0,
		CarType:       carType,
		Transmission:  transmission,
	}
	if payloadBytes, mErr := json.Marshal(payload); mErr == nil {
		deferUntilLead := req.ScheduledAt != nil &&
			req.ScheduledAt.After(time.Now().Add(dispatchDomain.ScheduledDispatchLead()))
		if deferUntilLead {
			if enqErr := s.orders.EnqueueScheduledDispatch(ctx, orderID, *req.ScheduledAt, payloadBytes); enqErr != nil {
				// The order is already persisted CREATED and counts as the rider's active
				// booking. If it can't be queued for replay it would never dispatch yet
				// still block the rider, so compensate: cancel it and surface the failure
				// for a clean retry (cancelling clears the active-order block).
				_ = s.orders.CancelOrder(ctx, orderID, riderID, "scheduling_failed", 0)
				return nil, fmt.Errorf("failed to enqueue scheduled booking: %w", enqErr)
			}
		} else if s.publisher != nil {
			if pubErr := s.publisher.Publish(ctx, "order.created", orderID, payloadBytes); pubErr != nil {
				// The order is persisted CREATED and counts as the rider's active booking,
				// but dispatch never received order.created so it would never match — a ghost
				// booking. Mirror the scheduled-enqueue failure path above: cancel to clear the
				// active-order block and surface the failure for a clean retry.
				_ = s.orders.CancelOrder(ctx, orderID, riderID, "dispatch_unavailable", 0)
				return nil, fmt.Errorf("booking created but dispatch unavailable, please retry: %w", pubErr)
			}
		}
	}

	// 9. mark the active order in Redis (4h TTL).
	if s.cache != nil {
		_ = s.cache.Set(ctx, "rider:active:order:"+riderID, orderID, 4*time.Hour).Err()
	}

	// 10. return the persisted order + fare + OTP (plaintext returned once).
	order, err := s.orders.GetOrderForRider(ctx, orderID, riderID)
	if err != nil {
		return nil, err
	}
	return &CreateOrderResult{Order: order, FareEstimate: est, OTP: otpPlain}, nil
}

// ---- active order ----

type LatLng struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

type DriverPublic struct {
	FirstName string  `json:"first_name"`
	Rating    float64 `json:"rating"`
}

type ActiveOrderResult struct {
	Order          *domain.RiderOrder `json:"order"`
	Driver         *DriverPublic      `json:"driver,omitempty"`
	DriverLocation *LatLng            `json:"driver_location,omitempty"`
	// OTP is the pickup OTP, exposed only while the driver is approaching pickup so the
	// rider's live-trip screen can recover it on cold start. Empty otherwise.
	OTP string `json:"otp"`
}

func (s *BookingService) GetActiveOrder(ctx context.Context, riderID string) (*ActiveOrderResult, error) {
	orderID := ""
	if s.cache != nil {
		if v, err := s.cache.Get(ctx, "rider:active:order:"+riderID).Result(); err == nil {
			orderID = v
		}
	}
	if orderID == "" {
		id, err := s.orders.GetActiveOrderID(ctx, riderID)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNoActiveOrder
		}
		if err != nil {
			return nil, err
		}
		orderID = id
	}

	order, err := s.orders.GetOrderByID(ctx, orderID)
	if errors.Is(err, repository.ErrOrderNotFound) {
		return nil, ErrNoActiveOrder
	}
	if err != nil {
		return nil, err
	}

	res := &ActiveOrderResult{Order: order}
	if order.AssignedDriverID != nil && *order.AssignedDriverID != "" {
		if name, rating, err := s.orders.GetDriverPublicInfo(ctx, *order.AssignedDriverID); err == nil {
			res.Driver = &DriverPublic{FirstName: firstName(name), Rating: rating}
		}
		if loc, ok := s.driverLiveLocation(ctx, order.CityPrefix, *order.AssignedDriverID); ok {
			res.DriverLocation = loc
		}
	}
	// Surface the pickup OTP only while the driver is approaching pickup; once the trip
	// is underway the OTP has been consumed and must not be re-displayed.
	switch order.Status {
	case "ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_AT_PICKUP":
		if otp, err := s.orders.GetPickupOTP(ctx, order.ID); err == nil {
			res.OTP = otp
		}
	}
	return res, nil
}

// ---- cancel ----

type CancelResult struct {
	Cancelled bool  `json:"cancelled"`
	FeePaise  int64 `json:"fee_paise"`
}

func (s *BookingService) CancelOrder(ctx context.Context, riderID, orderID, reason string) (*CancelResult, error) {
	order, err := s.orders.GetOrderForRider(ctx, orderID, riderID)
	if err != nil {
		return nil, err // repository.ErrOrderNotFound
	}

	switch order.Status {
	case "CREATED", "ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_AT_PICKUP":
		// cancellable
	default:
		return nil, ErrOrderNotCancellable
	}

	// Cancel-after-travel fee (reach compensation for the driver). Tiered by how far the
	// driver got; env-configurable. Live ETA isn't computed here, so time-since-assignment
	// is the proxy for EN_ROUTE. The fee is recorded on the order and goes to the driver.
	fee := int64(0)
	switch order.Status {
	case "ARRIVED_AT_PICKUP":
		// Driver already reached the car — full reach compensation.
		fee = envPaise("CANCEL_FEE_ARRIVED_PAISE", 5000) // ₹50
	case "EN_ROUTE_TO_PICKUP":
		if order.AssignedAt != nil && time.Since(*order.AssignedAt) > 3*time.Minute {
			fee = envPaise("CANCEL_FEE_ENROUTE_PAISE", 3000) // ₹30
		}
	}

	if err := s.orders.CancelOrder(ctx, orderID, riderID, reason, fee); err != nil {
		return nil, err
	}

	if s.cache != nil {
		_ = s.cache.Del(ctx, "rider:active:order:"+riderID).Err()
	}

	if order.AssignedDriverID != nil && *order.AssignedDriverID != "" && s.publisher != nil {
		evt, _ := json.Marshal(map[string]any{
			"order_id":  orderID,
			"driver_id": *order.AssignedDriverID,
			"reason":    reason,
			// status makes the message self-describing on the assignments broadcast channel,
			// so the assigned driver's dispatch stream can distinguish a cancellation.
			"status": "CANCELLED",
		})
		_ = s.publisher.Publish(ctx, "order.cancelled", orderID, evt)
	}

	// Notify the rider's live-trip WebSocket.
	_ = realtime.Publish(ctx, s.cache, riderID, realtime.MsgTripCancelled, map[string]any{
		"order_id":               orderID,
		"cancelled_by":           "RIDER",
		"reason":                 reason,
		"cancellation_fee_paise": fee,
	})

	return &CancelResult{Cancelled: true, FeePaise: fee}, nil
}

// ---- history ----

func (s *BookingService) ListHistory(ctx context.Context, riderID string, f repository.OrderFilter) ([]*domain.RiderOrder, int64, error) {
	return s.orders.ListOrders(ctx, riderID, f)
}

// GetOrderByID returns an order by id without rider scoping. Callers (e.g. the
// invoice handler) must verify ownership against order.RiderID themselves.
func (s *BookingService) GetOrderByID(ctx context.Context, orderID string) (*domain.RiderOrder, error) {
	return s.orders.GetOrderByID(ctx, orderID)
}

// ---- rate driver ----

type RateRequest struct {
	Rating   int      `json:"rating"`
	Tags     []string `json:"tags"`
	Comment  string   `json:"comment"`
	TipPaise int64    `json:"tip_paise"`
}

var validRatingTags = map[string]bool{
	"POLITE": true, "SAFE_DRIVING": true, "KNEW_ROUTES": true, "PUNCTUAL": true, "CLEAN": true,
}

func (s *BookingService) RateDriver(ctx context.Context, riderID, orderID string, req RateRequest) error {
	if req.Rating < 1 || req.Rating > 5 {
		return ErrInvalidBooking
	}
	if len(req.Comment) > 500 {
		return ErrInvalidBooking
	}
	if req.TipPaise < 0 {
		return ErrInvalidBooking
	}
	tags := make([]string, 0, len(req.Tags))
	for _, t := range req.Tags {
		t = strings.ToUpper(strings.TrimSpace(t))
		if validRatingTags[t] {
			tags = append(tags, t)
		}
	}

	driverID, err := s.orders.RateOrder(ctx, repository.RateParams{
		OrderID: orderID, RiderID: riderID, Rating: req.Rating,
		Tags: tags, Comment: req.Comment, TipPaise: req.TipPaise,
	})
	if errors.Is(err, repository.ErrNotRatable) {
		return ErrAlreadyRated
	}
	if err != nil {
		return err
	}

	if s.publisher != nil {
		evt, _ := json.Marshal(map[string]any{
			"driver_id": driverID,
			"order_id":  orderID,
			"rating":    req.Rating,
			"tip_paise": req.TipPaise,
		})
		_ = s.publisher.Publish(ctx, "driver.rated", orderID, evt)
	}
	return nil
}

// ---- trip share (public, sanitized) ----

type TripShareView struct {
	Status         string  `json:"status"`
	DriverName     string  `json:"driver_name,omitempty"`
	DriverLocation *LatLng `json:"driver_location,omitempty"`
	PickupLat      float64 `json:"pickup_lat"`
	PickupLng      float64 `json:"pickup_lng"`
	DropoffLat     float64 `json:"dropoff_lat"`
	DropoffLng     float64 `json:"dropoff_lng"`
	ETAMinutes     int     `json:"eta_minutes"`
}

func (s *BookingService) GetTripShare(ctx context.Context, token string) (*TripShareView, error) {
	order, err := s.orders.GetOrderByShareToken(ctx, token)
	if err != nil {
		return nil, err // repository.ErrOrderNotFound
	}
	if order.TripShareExpiresAt == nil || time.Now().After(*order.TripShareExpiresAt) {
		return nil, ErrTripShareExpired
	}

	view := &TripShareView{
		Status:     order.Status,
		PickupLat:  order.PickupLat,
		PickupLng:  order.PickupLng,
		ETAMinutes: pickupETA("MEDIUM"),
	}
	if order.DropoffLat != nil && order.DropoffLng != nil {
		view.DropoffLat, view.DropoffLng = *order.DropoffLat, *order.DropoffLng
	}
	if order.AssignedDriverID != nil && *order.AssignedDriverID != "" {
		if name, _, err := s.orders.GetDriverPublicInfo(ctx, *order.AssignedDriverID); err == nil {
			view.DriverName = firstName(name) // first name only — no full name / phone / id
		}
		if loc, ok := s.driverLiveLocation(ctx, order.CityPrefix, *order.AssignedDriverID); ok {
			view.DriverLocation = loc
		}
	}
	return view, nil
}

// ---- SOS (critical fast path) ----

type SOSResult struct {
	Triggered        bool `json:"triggered"`
	ContactsNotified int  `json:"contacts_notified"`
}

// TriggerSOS is the fastest critical path: it stamps the order, synchronously SMSes
// the rider's emergency contacts (no Kafka on the SMS path), then fires the Kafka
// incident + WS notification asynchronously.
func (s *BookingService) TriggerSOS(ctx context.Context, riderID, orderID string) (*SOSResult, error) {
	order, err := s.orders.GetOrderForRider(ctx, orderID, riderID)
	if err != nil {
		return nil, err
	}
	// Atomically stamp sos_triggered_at; only valid while DELIVERING.
	driverID, err := s.orders.MarkSOSTriggered(ctx, orderID, riderID)
	if err != nil {
		if errors.Is(err, repository.ErrOrderNotFound) {
			return nil, ErrTripNotActive
		}
		return nil, err
	}

	// Best-known location: last GPS trail point, else pickup.
	lat, lng := order.PickupLat, order.PickupLng
	if gl, gln, ok, _ := s.orders.GetLastGPSPoint(ctx, orderID); ok {
		lat, lng = gl, gln
	}

	var driverLoc *LatLng
	driverName := ""
	if driverID != "" {
		driverLoc, _ = s.driverLiveLocation(ctx, order.CityPrefix, driverID)
		if n, _, e := s.orders.GetDriverPublicInfo(ctx, driverID); e == nil {
			driverName = firstName(n)
		}
	}
	shareToken := ""
	if order.TripShareToken != nil {
		shareToken = *order.TripShareToken
	}

	// SYNCHRONOUS: SMS each emergency contact with live location + driver + share link.
	contacts, _ := s.emergency.GetEmergencyContacts(ctx, riderID)
	notified := 0
	msg := fmt.Sprintf("SOS from your contact's ride. Driver: %s. Location: %.5f,%.5f. Track: /trip-share/%s",
		driverName, lat, lng, shareToken)
	for _, c := range contacts {
		if s.sms != nil {
			if err := s.sms.SendSMS(c.Phone, msg); err == nil {
				notified++
			}
		}
	}

	// Async: Kafka incident + rider WS notification (off the critical response path).
	go func(driverLoc *LatLng) {
		bg := context.Background()
		if s.publisher != nil {
			evt, _ := json.Marshal(map[string]any{
				"order_id":         orderID,
				"rider_id":         riderID,
				"driver_id":        driverID,
				"rider_location":   LatLng{Lat: lat, Lng: lng},
				"driver_location":  driverLoc,
				"trip_share_token": shareToken,
			})
			_ = s.publisher.Publish(bg, "incident.sos", orderID, evt)
		}
		_ = realtime.Publish(bg, s.cache, riderID, realtime.MsgNotification, map[string]any{
			"type":  "SOS",
			"title": "SOS activated",
			"body":  "SOS activated. Help is on the way.",
			"data":  map[string]any{"order_id": orderID},
		})
	}(driverLoc)

	return &SOSResult{Triggered: true, ContactsNotified: notified}, nil
}

// ---- add stop / extend duration ----

type waypointData struct {
	PickupAddress  string    `json:"pickup_address"`
	DropoffAddress string    `json:"dropoff_address"`
	Stops          []StopDTO `json:"stops"`
}

// AddStop appends an intermediate stop to an in-progress trip (max 3), recomputes
// the fare over the new waypoint chain, and notifies the driver.
func (s *BookingService) AddStop(ctx context.Context, riderID, orderID string, stop StopDTO) (*domain.RiderOrder, error) {
	order, err := s.orders.GetOrderForRider(ctx, orderID, riderID)
	if err != nil {
		return nil, err
	}
	if order.Status != "DELIVERING" {
		return nil, ErrTripNotActive
	}
	if !inIndiaBBox(stop.Lat, stop.Lng) {
		return nil, ErrInvalidBooking
	}

	var wp waypointData
	if len(order.RiderStops) > 0 {
		_ = json.Unmarshal(order.RiderStops, &wp)
	}
	if len(wp.Stops) >= 3 {
		return nil, ErrTooManyStops
	}
	wp.Stops = append(wp.Stops, stop)
	stopsJSON, _ := json.Marshal(wp)

	road := waypointRoadMeters(order, wp.Stops)
	newFare, mult, err := s.quoter.GetFareQuote(ctx, order.CityPrefix, order.PickupH3Cell, road)
	if err != nil {
		return nil, err
	}
	if err := s.orders.UpdateOrderStops(ctx, orderID, riderID, stopsJSON, newFare, mult); err != nil {
		return nil, err
	}

	s.notifyDriverOrderUpdated(ctx, orderID, newFare)
	return s.orders.GetOrderForRider(ctx, orderID, riderID)
}

// ChangeDrop moves the dropoff of an in-progress trip (mid-trip change-drop),
// re-prices over the existing stop chain to the new dropoff, persists it, and
// notifies the driver. Valid while heading to pickup, at pickup, or delivering.
func (s *BookingService) ChangeDrop(ctx context.Context, riderID, orderID string, lat, lng float64, address string) (*domain.RiderOrder, error) {
	order, err := s.orders.GetOrderForRider(ctx, orderID, riderID)
	if err != nil {
		return nil, err
	}
	switch order.Status {
	case "EN_ROUTE_TO_PICKUP", "ARRIVED_AT_PICKUP", "DELIVERING":
		// active — change-drop allowed
	default:
		return nil, ErrTripNotActive
	}
	if !inIndiaBBox(lat, lng) {
		return nil, ErrInvalidBooking
	}

	// Re-price over the existing stop chain to the NEW dropoff. Set the new dropoff
	// on the order struct before calling waypointRoadMeters so the final leg lands
	// at the new destination.
	order.DropoffLat = &lat
	order.DropoffLng = &lng

	var wp waypointData
	if len(order.RiderStops) > 0 {
		_ = json.Unmarshal(order.RiderStops, &wp)
	}
	road := waypointRoadMeters(order, wp.Stops)
	newFare, mult, err := s.quoter.GetFareQuote(ctx, order.CityPrefix, order.PickupH3Cell, road)
	if err != nil {
		return nil, err
	}
	if err := s.orders.UpdateOrderDropoff(ctx, orderID, riderID, lat, lng, address, newFare, mult); err != nil {
		return nil, err
	}

	s.notifyDriverOrderUpdated(ctx, orderID, newFare)
	return s.orders.GetOrderForRider(ctx, orderID, riderID)
}

// ExtendDuration adds hours to a round-trip / outstation booking's duration.
func (s *BookingService) ExtendDuration(ctx context.Context, riderID, orderID string, extendHours int) (*domain.RiderOrder, error) {
	if extendHours < 1 || extendHours > 12 {
		return nil, ErrInvalidBooking
	}
	order, err := s.orders.GetOrderForRider(ctx, orderID, riderID)
	if err != nil {
		return nil, err
	}
	if order.Status != "DELIVERING" {
		return nil, ErrTripNotActive
	}
	// Distance-based fare is unaffected by duration; base fare is carried unchanged.
	if err := s.orders.UpdateBookedDuration(ctx, orderID, riderID, extendHours, order.BaseFarePaise); err != nil {
		if errors.Is(err, repository.ErrOrderNotFound) {
			// Not a duration booking (one-way) — cannot extend.
			return nil, ErrTripNotActive
		}
		return nil, err
	}

	s.notifyDriverOrderUpdated(ctx, orderID, order.BaseFarePaise)
	return s.orders.GetOrderForRider(ctx, orderID, riderID)
}

// notifyDriverOrderUpdated pushes a driver.order.updated event to the driver's
// order-keyed WebSocket via the gateway assignments channel (raw JSON forwarding
// is keyed on the "fare_estimate" marker).
func (s *BookingService) notifyDriverOrderUpdated(ctx context.Context, orderID string, newFarePaise int64) {
	if s.cache == nil {
		return
	}
	payload, _ := json.Marshal(map[string]any{
		"order_id":      orderID,
		"type":          "driver.order.updated",
		"fare_estimate": map[string]any{"base_fare_paise": newFarePaise},
	})
	_ = s.cache.Publish(ctx, driverAssignmentsChannel, payload).Err()
}

// waypointRoadMeters sums the great-circle legs pickup → stops → dropoff and
// applies the road factor.
func waypointRoadMeters(order *domain.RiderOrder, stops []StopDTO) float64 {
	lat, lng := order.PickupLat, order.PickupLng
	total := 0.0
	for _, st := range stops {
		total += haversineMeters(lat, lng, st.Lat, st.Lng)
		lat, lng = st.Lat, st.Lng
	}
	if order.DropoffLat != nil && order.DropoffLng != nil {
		total += haversineMeters(lat, lng, *order.DropoffLat, *order.DropoffLng)
	}
	return total * roadFactor
}

// ---- helpers ----

func inIndiaBBox(lat, lng float64) bool {
	return lat >= indiaMinLat && lat <= indiaMaxLat && lng >= indiaMinLng && lng <= indiaMaxLng
}

// haversineMeters returns the great-circle distance in metres, equivalent to
// PostGIS ST_Distance over geography points.
func haversineMeters(lat1, lng1, lat2, lng2 float64) float64 {
	const earthRadiusM = 6371000.0
	dLat := (lat2 - lat1) * deg2rad
	dLng := (lng2 - lng1) * deg2rad
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*deg2rad)*math.Cos(lat2*deg2rad)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return earthRadiusM * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

func h3CellRes8(lat, lng float64) string {
	return h3.ToString(h3.FromGeo(h3.GeoCoord{Latitude: lat * deg2rad, Longitude: lng * deg2rad}, 8))
}

func isNightIST(t time.Time) bool {
	h := t.In(istZone).Hour()
	return h >= 22 || h < 6
}

// driverAvailability counts distinct fresh drivers in the pickup cell + its KRing-1
// neighbours, using the same drivers:zset:{city}:{cell} spatial index dispatch uses.
func (s *BookingService) driverAvailability(ctx context.Context, city string, lat, lng float64) (string, int) {
	if s.cache == nil {
		return "NONE", 0
	}
	target := h3.FromGeo(h3.GeoCoord{Latitude: lat * deg2rad, Longitude: lng * deg2rad}, 8)
	if !h3.IsValid(target) {
		return "NONE", 0
	}
	now := time.Now().Unix()
	stale := now - 30

	pipe := s.cache.Pipeline()
	cmds := make([]*redis.StringSliceCmd, 0)
	for _, cell := range h3.KRing(target, 1) {
		key := fmt.Sprintf("drivers:zset:%s:%s", city, h3.ToString(cell))
		cmds = append(cmds, pipe.ZRevRangeByScore(ctx, key, &redis.ZRangeBy{
			Max: fmt.Sprintf("%d", now),
			Min: fmt.Sprintf("%d", stale),
		}))
	}
	if _, err := pipe.Exec(ctx); err != nil && !errors.Is(err, redis.Nil) {
		return "NONE", 0
	}

	seen := make(map[string]struct{})
	for _, cmd := range cmds {
		ids, err := cmd.Result()
		if err != nil {
			continue
		}
		for _, id := range ids {
			seen[id] = struct{}{}
		}
	}

	count := len(seen)
	switch {
	case count > 5:
		return "HIGH", count
	case count >= 2:
		return "MEDIUM", count
	case count == 1:
		return "LOW", count
	default:
		return "NONE", count
	}
}

func (s *BookingService) driverLiveLocation(ctx context.Context, city, driverID string) (*LatLng, bool) {
	if s.cache == nil {
		return nil, false
	}
	key := fmt.Sprintf("driver:{%s:%s}:profile", city, driverID)
	vals, err := s.cache.HMGet(ctx, key, "latitude", "longitude").Result()
	if err != nil || len(vals) < 2 || vals[0] == nil || vals[1] == nil {
		return nil, false
	}
	lat, ok1 := parseFloat(vals[0])
	lng, ok2 := parseFloat(vals[1])
	if !ok1 || !ok2 {
		return nil, false
	}
	return &LatLng{Lat: lat, Lng: lng}, true
}

// pickupETA is a coarse heuristic until route-based ETA is wired for the rider side.
func pickupETA(availability string) int {
	switch availability {
	case "HIGH":
		return 3
	case "MEDIUM":
		return 6
	case "LOW":
		return 10
	default:
		return 15
	}
}

func findCar(cars []*domain.RiderGarageCar, id string) *domain.RiderGarageCar {
	for _, c := range cars {
		if c.ID == id && c.IsActive {
			return c
		}
	}
	return nil
}

func defaultCar(cars []*domain.RiderGarageCar) *domain.RiderGarageCar {
	for _, c := range cars {
		if c.IsDefault && c.IsActive {
			return c
		}
	}
	return nil
}

func firstName(full string) string {
	full = strings.TrimSpace(full)
	if full == "" {
		return ""
	}
	return strings.Fields(full)[0]
}

func parseFloat(v any) (float64, bool) {
	s, ok := v.(string)
	if !ok {
		return 0, false
	}
	var f float64
	if _, err := fmt.Sscanf(s, "%g", &f); err != nil {
		return 0, false
	}
	return f, true
}

func generate4DigitOTP() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(10000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%04d", n.Int64()), nil
}

func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func randomHex(nBytes int) (string, error) {
	b := make([]byte, nBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
