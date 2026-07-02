package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/platform/driver-delivery/internal/domain"
)

var (
	// ErrOrderNotFound is returned when an order does not exist or is not owned
	// by the requesting rider.
	ErrOrderNotFound = errors.New("order not found")
	// ErrNotRatable is returned when an order cannot be rated (not completed,
	// not owned, or already rated).
	ErrNotRatable = errors.New("order is not ratable")
	// ErrDuplicateActiveOrder is returned when the one-active-order-per-rider
	// unique index rejects an insert (concurrent double-booking).
	ErrDuplicateActiveOrder = errors.New("rider already has an active order")
)

// RiderOrderRepository is the persistence contract for rider bookings.
type RiderOrderRepository interface {
	GetActiveOrderID(ctx context.Context, riderID string) (string, error)
	InsertRiderOrder(ctx context.Context, p InsertOrderParams) (string, error)
	EnqueueScheduledDispatch(ctx context.Context, orderID string, scheduledAt time.Time, payload []byte) error
	InsertFareBreakdown(ctx context.Context, orderID string, basePaise, distancePaise, nightPaise, totalPaise int64) error
	GetAssignedDriver(ctx context.Context, orderID, riderID string) (string, error)
	GetOrderForRider(ctx context.Context, orderID, riderID string) (*domain.RiderOrder, error)
	GetOrderByID(ctx context.Context, orderID string) (*domain.RiderOrder, error)
	GetOrderByShareToken(ctx context.Context, token string) (*domain.RiderOrder, error)
	GetPickupOTP(ctx context.Context, orderID string) (string, error)
	ListOrders(ctx context.Context, riderID string, f OrderFilter) ([]*domain.RiderOrder, int64, error)
	CancelOrder(ctx context.Context, orderID, riderID, reason string, feePaise int64) error
	RateOrder(ctx context.Context, p RateParams) (assignedDriverID string, err error)
	GetDriverPublicInfo(ctx context.Context, driverID string) (name string, rating float64, err error)

	MarkSOSTriggered(ctx context.Context, orderID, riderID string) (driverID string, err error)
	GetLastGPSPoint(ctx context.Context, orderID string) (lat, lng float64, ok bool, err error)
	UpdateOrderStops(ctx context.Context, orderID, riderID string, stopsJSON []byte, newBaseFare int64, newSurge float64) error
	UpdateBookedDuration(ctx context.Context, orderID, riderID string, hours int, newBaseFare int64) error
	UpdateOrderDropoff(ctx context.Context, orderID, riderID string, lat, lng float64, address string, newBaseFare int64, newSurge float64) error

	// InServiceArea reports whether a pickup point falls inside the city's active
	// geofence. Returns true when there is no geofence to enforce (fail-open).
	InServiceArea(ctx context.Context, city string, lat, lng float64) (bool, error)
}

type InsertOrderParams struct {
	RiderID                string
	CityPrefix             string
	PickupLat              float64
	PickupLng              float64
	DropoffLat             float64
	DropoffLng             float64
	PickupH3Cell           string
	BaseFarePaise          int64
	SurgeMultiplier        float64
	OTPHash                string
	RiderPickupOTP         string // plaintext pickup OTP, surfaced on the active-order screen
	GarageCarID            *string
	OneTimeCarMake         *string
	OneTimeCarModel        *string
	OneTimeCarType         *string
	OneTimeCarTransmission *string
	PaymentMethod          string
	PromoCode              *string
	PromoCodeID            *string // promo_codes.id when a promo applies; nil otherwise
	PromoDiscountPaise     int64
	D4MCareOpted           bool
	TripShareToken         string
	TripShareExpiresAt     time.Time
	PersonsCount           *int
	ScheduledAt            *time.Time
	WaypointsJSON          []byte // pickup/dropoff/stop addresses, stored in rider_stops JSONB
	BookedDurationHours    *int
	PackageType            string // HOURLY|MINI_OUTSTATION|OUTSTATION|MONTHLY; "" = distance-priced
	OwnerNotInCar          bool   // rider sends the car without riding along
	TripType               string // booking tier (IN_CITY_ROUND|OUTSTATION|…); "" = unset
}

type OrderFilter struct {
	Status   string // COMPLETED | CANCELLED | UPCOMING | "" (all)
	Limit    int
	Offset   int
	FromDate *time.Time
	ToDate   *time.Time
}

type RateParams struct {
	OrderID  string
	RiderID  string
	Rating   int
	Tags     []string
	Comment  string
	TipPaise int64
}

type postgresOrderRepo struct {
	dbPool *pgxpool.Pool
}

func NewPostgresOrderRepository(db *pgxpool.Pool) *postgresOrderRepo {
	return &postgresOrderRepo{dbPool: db}
}

// terminalStates are the order statuses that are no longer active.
const activeOrderPredicate = `status NOT IN ('COMPLETED'::order_status_enum, 'CANCELLED'::order_status_enum)`

func (r *postgresOrderRepo) GetActiveOrderID(ctx context.Context, riderID string) (string, error) {
	var id string
	err := r.dbPool.QueryRow(ctx, `
		SELECT id::text FROM orders
		WHERE rider_id = $1::uuid AND `+activeOrderPredicate+`
		ORDER BY created_at DESC LIMIT 1`, riderID).Scan(&id)
	if err != nil {
		return "", err
	}
	return id, nil
}

// GetAssignedDriver returns the driver assigned to an order the rider owns, or ErrOrderNotFound
// if the order isn't theirs or has no driver yet. Used to route rider->driver chat.
func (r *postgresOrderRepo) GetAssignedDriver(ctx context.Context, orderID, riderID string) (string, error) {
	var driverID *string
	err := r.dbPool.QueryRow(ctx, `
		SELECT assigned_driver_id::text FROM orders
		WHERE id = $1::uuid AND rider_id = $2::uuid`, orderID, riderID).Scan(&driverID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrOrderNotFound
	}
	if err != nil {
		return "", err
	}
	if driverID == nil || *driverID == "" {
		return "", ErrOrderNotFound
	}
	return *driverID, nil
}

// EnqueueScheduledDispatch stores a future-dated order's dispatch payload verbatim so the
// scheduler can replay it onto order.created near pickup. ON CONFLICT keeps it idempotent.
func (r *postgresOrderRepo) EnqueueScheduledDispatch(ctx context.Context, orderID string, scheduledAt time.Time, payload []byte) error {
	_, err := r.dbPool.Exec(ctx, `
		INSERT INTO scheduled_dispatch_queue (order_id, scheduled_at, payload)
		VALUES ($1::uuid, $2, $3::jsonb)
		ON CONFLICT (order_id) DO NOTHING`, orderID, scheduledAt, payload)
	return err
}

// InsertFareBreakdown persists the per-order fare component split for the admin trip
// detail. Called best-effort after the order insert — its failure never blocks a booking.
func (r *postgresOrderRepo) InsertFareBreakdown(ctx context.Context, orderID string, basePaise, distancePaise, nightPaise, totalPaise int64) error {
	_, err := r.dbPool.Exec(ctx, `
		INSERT INTO order_fare_breakdowns (order_id, base_paise, distance_paise, night_paise, total_paise)
		VALUES ($1::uuid, $2, $3, $4, $5)
		ON CONFLICT (order_id) DO UPDATE SET
			base_paise = EXCLUDED.base_paise, distance_paise = EXCLUDED.distance_paise,
			night_paise = EXCLUDED.night_paise, total_paise = EXCLUDED.total_paise`,
		orderID, basePaise, distancePaise, nightPaise, totalPaise)
	return err
}

func (r *postgresOrderRepo) InsertRiderOrder(ctx context.Context, p InsertOrderParams) (string, error) {
	pickupGeom := fmt.Sprintf("SRID=4326;POINT(%f %f)", p.PickupLng, p.PickupLat)
	dropoffGeom := fmt.Sprintf("SRID=4326;POINT(%f %f)", p.DropoffLng, p.DropoffLat)

	tx, err := r.dbPool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	var orderID string
	err = tx.QueryRow(ctx, `
		INSERT INTO orders (
			city_prefix, customer_id, rider_id, status,
			pickup_location, dropoff_location, pickup_h3_cell, pickup_osm_node_id,
			base_fare_paise, surge_multiplier, otp_hash, rider_pickup_otp,
			garage_car_id, one_time_car_make, one_time_car_model, one_time_car_type, one_time_car_transmission,
			payment_method, promo_code, promo_discount_paise, d4m_care_opted,
			trip_share_token, trip_share_expires_at, persons_count, scheduled_at, rider_stops,
			booked_duration_hours, package_type, owner_not_in_car, trip_type
		) VALUES (
			$1, $2::uuid, $3::uuid, 'CREATED'::order_status_enum,
			ST_GeographyFromText($4), ST_GeographyFromText($5), $6, 0,
			$7, $8, $9, $10,
			$11::uuid, $12, $13, $14, $15,
			$16, $17, $18, $19,
			$20, $21, $22, $23, $24,
			$25, NULLIF($26, ''), $27, NULLIF($28, '')
		) RETURNING id::text`,
		p.CityPrefix, p.RiderID, p.RiderID,
		pickupGeom, dropoffGeom, p.PickupH3Cell,
		p.BaseFarePaise, p.SurgeMultiplier, p.OTPHash, p.RiderPickupOTP,
		p.GarageCarID, p.OneTimeCarMake, p.OneTimeCarModel, p.OneTimeCarType, p.OneTimeCarTransmission,
		p.PaymentMethod, p.PromoCode, p.PromoDiscountPaise, p.D4MCareOpted,
		p.TripShareToken, p.TripShareExpiresAt, p.PersonsCount, p.ScheduledAt, p.WaypointsJSON,
		p.BookedDurationHours, p.PackageType, p.OwnerNotInCar, p.TripType,
	).Scan(&orderID)
	if err != nil {
		// The partial unique index (migration 000123) is the race-proof backstop
		// for the service's active-order pre-check: a concurrent double-tap loses
		// here instead of creating a second live order.
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "uq_orders_one_active_per_rider" {
			return "", ErrDuplicateActiveOrder
		}
		return "", err
	}

	// Lock + record the promo redemption in the same transaction. If the promo
	// can no longer be applied (race exhausted a cap, per-rider limit hit), void
	// the discount on the order so the persisted fare is honest.
	if p.PromoCodeID != nil && *p.PromoCodeID != "" {
		applied, rErr := redeemPromo(ctx, tx, *p.PromoCodeID, p.RiderID, orderID, p.PromoDiscountPaise)
		if rErr != nil {
			return "", rErr
		}
		if !applied {
			if _, err := tx.Exec(ctx, `UPDATE orders SET promo_code = NULL, promo_discount_paise = 0 WHERE id = $1::uuid`, orderID); err != nil {
				return "", err
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return orderID, nil
}

// InServiceArea reports whether (lat,lng) is covered by the city's active
// geofence. Fail-open: when no active geofenced row exists, returns true so a
// missing/unset geofence never blocks bookings.
func (r *postgresOrderRepo) InServiceArea(ctx context.Context, city string, lat, lng float64) (bool, error) {
	var covered bool
	err := r.dbPool.QueryRow(ctx, `
		SELECT ST_Covers(geofence, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography)
		FROM regional_cities
		WHERE city_prefix = $1 AND is_active AND geofence IS NOT NULL`,
		city, lng, lat,
	).Scan(&covered)
	if errors.Is(err, pgx.ErrNoRows) {
		return true, nil // nothing to enforce
	}
	if err != nil {
		return true, err // fail-open on transient errors; caller may log
	}
	return covered, nil
}

const orderSelect = `
	id::text, status::text, city_prefix, rider_id::text, assigned_driver_id::text,
	ST_Y(pickup_location::geometry), ST_X(pickup_location::geometry),
	ST_Y(dropoff_location::geometry), ST_X(dropoff_location::geometry),
	pickup_h3_cell,
	garage_car_id::text, one_time_car_make, one_time_car_model, one_time_car_type, one_time_car_transmission,
	base_fare_paise, surge_multiplier, promo_code, promo_discount_paise, d4m_care_opted, payment_method,
	persons_count, rider_stops, scheduled_at, trip_type, package_type,
	trip_share_token, trip_share_expires_at,
	rider_rating_for_driver, rider_tip_paise, rider_review_tags, rider_review_comment,
	cancelled_by, cancellation_reason,
	assigned_at, completed_at, created_at`

func scanRiderOrder(row rowScanner) (*domain.RiderOrder, error) {
	var o domain.RiderOrder
	var dropLat, dropLng float64
	var surge *float64
	err := row.Scan(
		&o.ID, &o.Status, &o.CityPrefix, &o.RiderID, &o.AssignedDriverID,
		&o.PickupLat, &o.PickupLng,
		&dropLat, &dropLng,
		&o.PickupH3Cell,
		&o.GarageCarID, &o.OneTimeCarMake, &o.OneTimeCarModel, &o.OneTimeCarType, &o.OneTimeCarTransmission,
		&o.BaseFarePaise, &surge, &o.PromoCode, &o.PromoDiscountPaise, &o.D4MCareOpted, &o.PaymentMethod,
		&o.PersonsCount, &o.RiderStops, &o.ScheduledAt, &o.TripType, &o.PackageType,
		&o.TripShareToken, &o.TripShareExpiresAt,
		&o.RiderRatingForDriver, &o.RiderTipPaise, &o.RiderReviewTags, &o.RiderReviewComment,
		&o.CancelledBy, &o.CancellationReason,
		&o.AssignedAt, &o.CompletedAt, &o.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	o.DropoffLat = &dropLat
	o.DropoffLng = &dropLng
	if surge != nil {
		o.SurgeMultiplier = *surge
	}
	return &o, nil
}

func (r *postgresOrderRepo) GetOrderForRider(ctx context.Context, orderID, riderID string) (*domain.RiderOrder, error) {
	o, err := scanRiderOrder(r.dbPool.QueryRow(ctx, `SELECT `+orderSelect+` FROM orders WHERE id = $1::uuid AND rider_id = $2::uuid`, orderID, riderID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrOrderNotFound
	}
	return o, err
}

func (r *postgresOrderRepo) GetOrderByID(ctx context.Context, orderID string) (*domain.RiderOrder, error) {
	o, err := scanRiderOrder(r.dbPool.QueryRow(ctx, `SELECT `+orderSelect+` FROM orders WHERE id = $1::uuid`, orderID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrOrderNotFound
	}
	return o, err
}

func (r *postgresOrderRepo) GetOrderByShareToken(ctx context.Context, token string) (*domain.RiderOrder, error) {
	o, err := scanRiderOrder(r.dbPool.QueryRow(ctx, `SELECT `+orderSelect+` FROM orders WHERE trip_share_token = $1`, token))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrOrderNotFound
	}
	return o, err
}

// GetPickupOTP returns the plaintext pickup OTP for an order (empty if not set).
func (r *postgresOrderRepo) GetPickupOTP(ctx context.Context, orderID string) (string, error) {
	var otp *string
	err := r.dbPool.QueryRow(ctx, `SELECT rider_pickup_otp FROM orders WHERE id = $1::uuid`, orderID).Scan(&otp)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrOrderNotFound
	}
	if err != nil {
		return "", err
	}
	if otp == nil {
		return "", nil
	}
	return *otp, nil
}

func (r *postgresOrderRepo) ListOrders(ctx context.Context, riderID string, f OrderFilter) ([]*domain.RiderOrder, int64, error) {
	conds := []string{"rider_id = $1::uuid"}
	args := []any{riderID}
	n := 2

	switch strings.ToUpper(f.Status) {
	case "COMPLETED":
		conds = append(conds, "status = 'COMPLETED'::order_status_enum")
	case "CANCELLED":
		conds = append(conds, "status = 'CANCELLED'::order_status_enum")
	case "UPCOMING":
		conds = append(conds, activeOrderPredicate)
	}
	if f.FromDate != nil {
		conds = append(conds, fmt.Sprintf("created_at >= $%d", n))
		args = append(args, *f.FromDate)
		n++
	}
	if f.ToDate != nil {
		conds = append(conds, fmt.Sprintf("created_at <= $%d", n))
		args = append(args, *f.ToDate)
		n++
	}
	where := "WHERE " + strings.Join(conds, " AND ")

	var total int64
	if err := r.dbPool.QueryRow(ctx, `SELECT COUNT(*) FROM orders `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	limit := f.Limit
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	q := `SELECT ` + orderSelect + ` FROM orders ` + where +
		fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", n, n+1)
	args = append(args, limit, f.Offset)

	rows, err := r.dbPool.Query(ctx, q, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	orders := make([]*domain.RiderOrder, 0)
	for rows.Next() {
		o, err := scanRiderOrder(rows)
		if err != nil {
			return nil, 0, err
		}
		orders = append(orders, o)
	}
	return orders, total, rows.Err()
}

func (r *postgresOrderRepo) CancelOrder(ctx context.Context, orderID, riderID, reason string, feePaise int64) error {
	tx, err := r.dbPool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var reasonArg any
	if strings.TrimSpace(reason) != "" {
		reasonArg = reason
	}
	tag, err := tx.Exec(ctx, `
		UPDATE orders
		SET status = 'CANCELLED'::order_status_enum, cancelled_by = 'RIDER', cancellation_reason = $3
		WHERE id = $1::uuid AND rider_id = $2::uuid AND `+activeOrderPredicate,
		orderID, riderID, reasonArg)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrOrderNotFound
	}

	// Collect a cancellation fee from the wallet only if the balance covers it.
	// The wallet CHECK (balance_paise >= 0) prevents an overdraft; an uncollected
	// fee is intentionally dropped here (no "charge on next trip" column exists).
	if feePaise > 0 {
		var balanceAfter int64
		err := tx.QueryRow(ctx, `
			UPDATE rider_wallet SET balance_paise = balance_paise - $2, updated_at = now()
			WHERE rider_id = $1::uuid AND balance_paise >= $2
			RETURNING balance_paise`, riderID, feePaise).Scan(&balanceAfter)
		if err == nil {
			if _, err := tx.Exec(ctx, `
				INSERT INTO rider_wallet_transactions (rider_id, type, amount_paise, balance_after_paise, reference_id, reference_type, description)
				VALUES ($1::uuid, 'ADJUSTMENT', $2, $3, $4::uuid, 'ORDER', $5)`,
				riderID, -feePaise, balanceAfter, orderID, "cancellation fee"); err != nil {
				return err
			}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		// pgx.ErrNoRows => insufficient balance / no wallet: fee not collected.
	}

	return tx.Commit(ctx)
}

func (r *postgresOrderRepo) RateOrder(ctx context.Context, p RateParams) (string, error) {
	tx, err := r.dbPool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	var assignedDriverID *string
	var cityPrefix string
	err = tx.QueryRow(ctx, `
		UPDATE orders SET
			rider_rating_for_driver = $3,
			rider_review_tags = $4,
			rider_review_comment = $5,
			rider_tip_paise = $6
		WHERE id = $1::uuid AND rider_id = $2::uuid
		  AND status = 'COMPLETED'::order_status_enum
		  AND rider_rating_for_driver IS NULL
		RETURNING assigned_driver_id::text, city_prefix`,
		p.OrderID, p.RiderID, p.Rating, p.Tags, nullIfEmpty(p.Comment), p.TipPaise,
	).Scan(&assignedDriverID, &cityPrefix)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotRatable
	}
	if err != nil {
		return "", err
	}

	driverID := ""
	if assignedDriverID != nil {
		driverID = *assignedDriverID
	}

	// Credit any tip to driver earnings in the financial ledger (same tx).
	if p.TipPaise > 0 && driverID != "" {
		if _, err := tx.Exec(ctx, `
			INSERT INTO financial_ledger_entries (order_id, city_prefix, account_type, entry_type, amount_paise, description)
			VALUES ($1::uuid, $2, 'DRIVER_EARNINGS', 'CREDIT', $3, $4)`,
			p.OrderID, cityPrefix, p.TipPaise, fmt.Sprintf("TIP_CREDIT from rider rating on order %s", p.OrderID)); err != nil {
			return "", err
		}

		// Notify the driver of the tip: an in-app row (driver_notifications) plus an FCM
		// push queued to the notification outbox. Both share the rating transaction so a
		// tip is never credited without its notification, and vice versa.
		tipRupees := p.TipPaise / 100
		title := "You received a tip! 🎉"
		body := fmt.Sprintf("You received a ₹%d tip from your last rider! 🎉", tipRupees)
		if _, err := tx.Exec(ctx, `
			INSERT INTO driver_notifications (driver_id, category, title, body)
			VALUES ($1::uuid, 'EARNINGS', $2, $3)`,
			driverID, title, body); err != nil {
			return "", err
		}
		payload := fmt.Sprintf(`{"type":"TIP_RECEIVED","order_id":"%s","tip_paise":%d}`, p.OrderID, p.TipPaise)
		if _, err := tx.Exec(ctx, `
			INSERT INTO notification_outbox (user_id, title, body, payload)
			VALUES ($1::uuid, $2, $3, $4::jsonb)`,
			driverID, title, body, payload); err != nil {
			return "", err
		}
	}

	// Recompute the driver's aggregate rating from the source of truth (rated orders).
	if driverID != "" {
		if _, err := tx.Exec(ctx, `
			UPDATE drivers SET rating = COALESCE((
				SELECT ROUND(AVG(rider_rating_for_driver)::numeric, 2)
				FROM orders
				WHERE assigned_driver_id = $1::uuid AND rider_rating_for_driver IS NOT NULL
			), rating)
			WHERE id = $1::uuid`, driverID); err != nil {
			return "", err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return driverID, nil
}

func (r *postgresOrderRepo) GetDriverPublicInfo(ctx context.Context, driverID string) (string, float64, error) {
	var name string
	var rating *float64
	err := r.dbPool.QueryRow(ctx, `SELECT name, rating FROM drivers WHERE id = $1::uuid`, driverID).Scan(&name, &rating)
	if err != nil {
		return "", 0, err
	}
	if rating != nil {
		return name, *rating, nil
	}
	return name, 0, nil
}

// MarkSOSTriggered stamps sos_triggered_at on an in-progress trip and returns the
// assigned driver. Only valid while the order is DELIVERING.
func (r *postgresOrderRepo) MarkSOSTriggered(ctx context.Context, orderID, riderID string) (string, error) {
	var driverID *string
	err := r.dbPool.QueryRow(ctx, `
		UPDATE orders SET sos_triggered_at = now()
		WHERE id = $1::uuid AND rider_id = $2::uuid AND status = 'DELIVERING'::order_status_enum
		RETURNING assigned_driver_id::text`, orderID, riderID).Scan(&driverID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrOrderNotFound
	}
	if err != nil {
		return "", err
	}
	// Surface the rider SOS to the admin safety feed (safety_sos_alerts is what
	// GET /api/v1/admin/safety/sos reads). Best-effort — never fail the SOS on this.
	_, _ = r.dbPool.Exec(ctx, `
		INSERT INTO safety_sos_alerts (id, trip_id, reporter_type, status)
		VALUES ('sos-' || gen_random_uuid()::text, $1::uuid, 'RIDER', 'ACTIVE')`, orderID)
	if driverID != nil {
		return *driverID, nil
	}
	return "", nil
}

func (r *postgresOrderRepo) GetLastGPSPoint(ctx context.Context, orderID string) (float64, float64, bool, error) {
	var lat, lng float64
	err := r.dbPool.QueryRow(ctx, `
		SELECT latitude, longitude FROM orders_gps_trail
		WHERE order_id = $1::uuid ORDER BY captured_at DESC LIMIT 1`, orderID).Scan(&lat, &lng)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, 0, false, nil
	}
	if err != nil {
		return 0, 0, false, err
	}
	return lat, lng, true, nil
}

func (r *postgresOrderRepo) UpdateOrderStops(ctx context.Context, orderID, riderID string, stopsJSON []byte, newBaseFare int64, newSurge float64) error {
	tag, err := r.dbPool.Exec(ctx, `
		UPDATE orders SET rider_stops = $3, base_fare_paise = $4, surge_multiplier = $5
		WHERE id = $1::uuid AND rider_id = $2::uuid AND status = 'DELIVERING'::order_status_enum`,
		orderID, riderID, stopsJSON, newBaseFare, newSurge)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrOrderNotFound
	}
	return nil
}

// UpdateOrderDropoff moves the dropoff point and re-prices an in-progress trip.
// orders has no dropoff_address column (only the dropoff_location geography), so
// the supplied address is intentionally not persisted. Valid while the trip is
// active (heading to pickup, at pickup, or delivering).
func (r *postgresOrderRepo) UpdateOrderDropoff(ctx context.Context, orderID, riderID string, lat, lng float64, address string, newBaseFare int64, newSurge float64) error {
	dropoffGeom := fmt.Sprintf("SRID=4326;POINT(%f %f)", lng, lat)
	tag, err := r.dbPool.Exec(ctx, `
		UPDATE orders
		SET dropoff_location = ST_GeographyFromText($3), base_fare_paise = $4, surge_multiplier = $5
		WHERE id = $1::uuid AND rider_id = $2::uuid
		  AND status IN ('EN_ROUTE_TO_PICKUP'::order_status_enum, 'ARRIVED_AT_PICKUP'::order_status_enum, 'DELIVERING'::order_status_enum)`,
		orderID, riderID, dropoffGeom, newBaseFare, newSurge)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrOrderNotFound
	}
	return nil
}

func (r *postgresOrderRepo) UpdateBookedDuration(ctx context.Context, orderID, riderID string, hours int, newBaseFare int64) error {
	tag, err := r.dbPool.Exec(ctx, `
		UPDATE orders SET booked_duration_hours = booked_duration_hours + $3, base_fare_paise = $4
		WHERE id = $1::uuid AND rider_id = $2::uuid AND status = 'DELIVERING'::order_status_enum
		  AND booked_duration_hours IS NOT NULL`,
		orderID, riderID, hours, newBaseFare)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrOrderNotFound
	}
	return nil
}

func nullIfEmpty(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}
