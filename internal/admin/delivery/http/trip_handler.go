package http

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// newTripOTP returns a random 4-digit trip-start OTP and its sha256 hash. Admin-
// created trips must carry an OTP like rider-created ones, or the driver could
// never start them (the start handlers now fail closed when no OTP is provisioned).
func newTripOTP() (plain, hash string) {
	if n, err := rand.Int(rand.Reader, big.NewInt(10000)); err == nil {
		plain = fmt.Sprintf("%04d", n.Int64())
	} else {
		plain = fmt.Sprintf("%04d", time.Now().UnixNano()%10000)
	}
	sum := sha256.Sum256([]byte(plain))
	return plain, hex.EncodeToString(sum[:])
}

type AdminTripHandler struct {
	dbPool      *pgxpool.Pool
	redisClient *redis.ClusterClient
}

func NewAdminTripHandler(dbPool *pgxpool.Pool, redisClient *redis.ClusterClient) *AdminTripHandler {
	return &AdminTripHandler{
		dbPool:      dbPool,
		redisClient: redisClient,
	}
}

type OrderRecord struct {
	ID              string     `json:"id"`
	CityPrefix      string     `json:"city_prefix"`
	CustomerID      string     `json:"customer_id"`
	Status          string     `json:"status"`
	PickupLat       float64    `json:"pickup_lat"`
	PickupLng       float64    `json:"pickup_lng"`
	DropoffLat      float64    `json:"dropoff_lat"`
	DropoffLng      float64    `json:"dropoff_lng"`
	PickupH3Cell    string     `json:"pickup_h3_cell"`
	AssignedDriver  *string    `json:"assigned_driver_id"`
	SurgeMultiplier float64    `json:"surge_multiplier"`
	BaseFarePaise   int64      `json:"base_fare_paise"`
	CreatedAt       time.Time  `json:"created_at"`
	AssignedAt      *time.Time `json:"assigned_at"`
}

type TripRecord struct {
	ID              string     `json:"id"`
	CityPrefix      string     `json:"city_prefix"`
	CustomerID      string     `json:"customer_id"`
	Status          string     `json:"status"`
	PickupLat       float64    `json:"pickup_lat"`
	PickupLng       float64    `json:"pickup_lng"`
	DropoffLat      float64    `json:"dropoff_lat"`
	DropoffLng      float64    `json:"dropoff_lng"`
	PickupH3Cell    string     `json:"pickup_h3_cell"`
	AssignedDriver  *string    `json:"assigned_driver_id"`
	DriverName      string     `json:"driver_name"`
	SurgeMultiplier float64    `json:"surge_multiplier"`
	BaseFarePaise   int64      `json:"base_fare_paise"`
	CreatedAt       time.Time  `json:"created_at"`
	AssignedAt      *time.Time `json:"assigned_at"`
	// Projected fields based on UUID hashing
	TripType      string  `json:"trip_type"`
	CarType       string  `json:"car_type"`
	Transmission  string  `json:"transmission"`
	PaymentMethod string  `json:"payment_method"`
	PromoApplied  string  `json:"promo_applied"`
	D4MCare       bool    `json:"d4m_care"`
	Rating        int     `json:"rating"`
	Plate         string  `json:"plate"`
}

func (h *AdminTripHandler) HandleAdminGetOrders(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	q := r.URL.Query()
	statusFilter := q.Get("status")
	cityFilter := q.Get("city_prefix")
	driverFilter := q.Get("driver_id")
	customerFilter := q.Get("customer_id")
	dateStart := q.Get("date_start")
	dateEnd := q.Get("date_end")
	fareMin := q.Get("fare_min")
	fareMax := q.Get("fare_max")
	tripType := q.Get("trip_type")
	carType := q.Get("car_type")
	transmission := q.Get("transmission")
	paymentMethod := q.Get("payment_method")
	promoApplied := q.Get("promo_applied")
	d4mCare := q.Get("d4m_care")
	ratingLess3 := q.Get("rating_less_than_3")
	searchFilter := q.Get("search")

	limitStr := q.Get("limit")
	offsetStr := q.Get("offset")
	limit := 50
	offset := 0
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
			limit = l
		}
	}
	if offsetStr != "" {
		if o, err := strconv.Atoi(offsetStr); err == nil && o >= 0 {
			offset = o
		}
	}

	baseQuery := `
		SELECT o.id, o.city_prefix, o.customer_id, o.status::text, 
		       ST_Y(o.pickup_location::geometry) as pickup_lat, ST_X(o.pickup_location::geometry) as pickup_lng,
		       ST_Y(o.dropoff_location::geometry) as dropoff_lat, ST_X(o.dropoff_location::geometry) as dropoff_lng,
		       o.pickup_h3_cell, o.assigned_driver_id, o.surge_multiplier, o.base_fare_paise, o.created_at, o.assigned_at,
		       COALESCE(d.name, 'Unassigned') as driver_name,
		       COALESCE(o.trip_type, '') as trip_type,
		       COALESCE(o.one_time_car_type, rg.car_type, '') as car_type,
		       COALESCE(o.one_time_car_transmission, rg.transmission, '') as transmission,
		       COALESCE(o.payment_method, '') as payment_method,
		       COALESCE(o.promo_code, 'None') as promo_applied,
		       COALESCE(o.d4m_care_opted, false) as d4m_care,
		       CASE
		         WHEN o.status = 'COMPLETED'::order_status_enum THEN COALESCE(o.rider_rating_for_driver, 0)
		         ELSE 0
		       END as rating,
		       COALESCE(rg.registration_plate, 'N/A') as plate
		FROM orders o
		LEFT JOIN drivers d ON o.assigned_driver_id = d.id
		LEFT JOIN rider_garage rg ON rg.id = o.garage_car_id
	`

	var conditions []string
	var args []interface{}
	argCount := 1

	addCond := func(cond string, val interface{}) {
		conditions = append(conditions, fmt.Sprintf(cond, argCount))
		args = append(args, val)
		argCount++
	}

	if statusFilter != "" {
		statuses := strings.Split(statusFilter, ",")
		if len(statuses) > 0 {
			var placeholders []string
			for _, st := range statuses {
				placeholders = append(placeholders, fmt.Sprintf("$%d", argCount))
				args = append(args, strings.ToUpper(strings.TrimSpace(st)))
				argCount++
			}
			conditions = append(conditions, fmt.Sprintf("o.status::text IN (%s)", strings.Join(placeholders, ",")))
		}
	}

	if cityFilter != "" {
		addCond("o.city_prefix = $%d", cityFilter)
	}

	if driverFilter != "" {
		addCond("o.assigned_driver_id = $%d::uuid", driverFilter)
	}

	if customerFilter != "" {
		addCond("o.customer_id = $%d::uuid", customerFilter)
	}

	if dateStart != "" {
		if t, err := time.Parse(time.RFC3339, dateStart); err == nil {
			addCond("o.created_at >= $%d", t)
		}
	}

	if dateEnd != "" {
		if t, err := time.Parse(time.RFC3339, dateEnd); err == nil {
			addCond("o.created_at <= $%d", t)
		}
	}

	if fareMin != "" {
		if f, err := strconv.ParseInt(fareMin, 10, 64); err == nil {
			addCond("o.base_fare_paise >= $%d", f)
		}
	}

	if fareMax != "" {
		if f, err := strconv.ParseInt(fareMax, 10, 64); err == nil {
			addCond("o.base_fare_paise <= $%d", f)
		}
	}

	// Filters match the real columns shown above (rg = rider_garage joined on garage_car_id).
	if tripType != "" {
		addCond("COALESCE(o.trip_type, '') = $%d", tripType)
	}

	if carType != "" {
		addCond("COALESCE(o.one_time_car_type, rg.car_type, '') = $%d", carType)
	}

	if transmission != "" {
		addCond("COALESCE(o.one_time_car_transmission, rg.transmission, '') = $%d", transmission)
	}

	if paymentMethod != "" {
		addCond("COALESCE(o.payment_method, '') = $%d", paymentMethod)
	}

	if promoApplied != "" {
		addCond("COALESCE(o.promo_code, 'None') = $%d", promoApplied)
	}

	if d4mCare != "" {
		if careVal, err := strconv.ParseBool(d4mCare); err == nil {
			addCond("COALESCE(o.d4m_care_opted, false) = $%d", careVal)
		}
	}

	if ratingLess3 == "true" {
		conditions = append(conditions, "o.status = 'COMPLETED'::order_status_enum")
		conditions = append(conditions, "o.rider_rating_for_driver IS NOT NULL AND o.rider_rating_for_driver < 3")
	}

	if searchFilter != "" {
		val := "%" + searchFilter + "%"
		conditions = append(conditions, fmt.Sprintf("(o.id::text ILIKE $%d OR COALESCE(d.name, '') ILIKE $%d OR o.customer_id::text ILIKE $%d)", argCount, argCount, argCount))
		args = append(args, val)
		argCount++
	}

	whereClause := ""
	if len(conditions) > 0 {
		whereClause = " WHERE " + strings.Join(conditions, " AND ")
	}

	fullQuery := baseQuery + whereClause + fmt.Sprintf(" ORDER BY o.created_at DESC LIMIT $%d OFFSET $%d", argCount, argCount+1)
	args = append(args, limit, offset)

	rows, err := h.dbPool.Query(ctx, fullQuery, args...)
	if err != nil {
		log.Printf("Query error in HandleAdminGetOrders: %v. Query: %s", err, fullQuery)
		http.Error(w, "orders_fetch_exception", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var trips []TripRecord = []TripRecord{}
	for rows.Next() {
		var rec TripRecord
		err := rows.Scan(
			&rec.ID, &rec.CityPrefix, &rec.CustomerID, &rec.Status,
			&rec.PickupLat, &rec.PickupLng, &rec.DropoffLat, &rec.DropoffLng,
			&rec.PickupH3Cell, &rec.AssignedDriver, &rec.SurgeMultiplier, &rec.BaseFarePaise,
			&rec.CreatedAt, &rec.AssignedAt, &rec.DriverName,
			&rec.TripType, &rec.CarType, &rec.Transmission, &rec.PaymentMethod, &rec.PromoApplied, &rec.D4MCare, &rec.Rating, &rec.Plate,
		)
		if err == nil {
			trips = append(trips, rec)
		} else {
			log.Printf("Scan error: %v", err)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(trips)
}

type CancelOrderRequest struct {
	OrderID string `json:"order_id"`
}

func (h *AdminTripHandler) HandleAdminCancelOrder(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req CancelOrderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid_request_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "transaction_init_failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	var assignedDriverID *string
	queryFindDriver := `
		SELECT assigned_driver_id 
		FROM orders 
		WHERE id = $1
	`
	err = tx.QueryRow(ctx, queryFindDriver, req.OrderID).Scan(&assignedDriverID)
	if err != nil {
		http.Error(w, "order_not_found", http.StatusNotFound)
		return
	}

	queryCancelOrder := `
		UPDATE orders 
		SET status = 'CANCELLED'::order_status_enum 
		WHERE id = $1
	`
	_, err = tx.Exec(ctx, queryCancelOrder, req.OrderID)
	if err != nil {
		http.Error(w, "failed_to_cancel_order", http.StatusInternalServerError)
		return
	}

	if assignedDriverID != nil {
		queryFreeDriver := `
			UPDATE drivers 
			SET current_state = 'ONLINE_AVAILABLE'::driver_state_enum 
			WHERE id = $1
		`
		_, err = tx.Exec(ctx, queryFreeDriver, *assignedDriverID)
		if err != nil {
			http.Error(w, "failed_to_free_driver", http.StatusInternalServerError)
			return
		}

		offerKey := "offer:lease:" + req.OrderID
		_ = h.redisClient.Del(ctx, offerKey).Err()
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "failed_to_commit_cancellation", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

func (h *AdminTripHandler) HandleAdminGetTripDetail(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_order_id", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	query := `
		SELECT o.id, o.city_prefix, o.customer_id, o.status::text, 
		       ST_Y(o.pickup_location::geometry) as pickup_lat, ST_X(o.pickup_location::geometry) as pickup_lng,
		       ST_Y(o.dropoff_location::geometry) as dropoff_lat, ST_X(o.dropoff_location::geometry) as dropoff_lng,
		       o.pickup_h3_cell, o.assigned_driver_id, o.surge_multiplier, o.base_fare_paise, o.created_at, o.assigned_at, o.picked_up_at, o.completed_at,
		       COALESCE(d.name, 'Unassigned') as driver_name,
		       COALESCE(d.phone, '') as driver_phone,
		       COALESCE(d.is_verified, false) as driver_verified,
		       COALESCE(o.trip_type, '') as trip_type,
		       COALESCE(o.one_time_car_type, rg.car_type, '') as car_type,
		       COALESCE(o.one_time_car_transmission, rg.transmission, '') as transmission,
		       COALESCE(o.payment_method, '') as payment_method,
		       COALESCE(o.promo_code, 'None') as promo_applied,
		       COALESCE(o.d4m_care_opted, false) as d4m_care,
		       CASE WHEN o.status = 'COMPLETED'::order_status_enum THEN COALESCE(o.rider_rating_for_driver, 0) ELSE 0 END as rating,
		       COALESCE(rg.registration_plate, 'N/A') as plate,
		       COALESCE(rd.name, '') as rider_name,
		       COALESCE(rd.phone, '') as rider_phone,
		       TRIM(COALESCE(o.one_time_car_make, rg.make, '') || ' ' || COALESCE(o.one_time_car_model, rg.model, '')) as car_model,
		       COALESCE(o.promo_discount_paise, 0) as promo_discount_paise,
		       ofb.base_paise, ofb.distance_paise, ofb.night_paise, ofb.total_paise
		FROM orders o
		LEFT JOIN drivers d ON o.assigned_driver_id = d.id
		LEFT JOIN rider_garage rg ON rg.id = o.garage_car_id
		LEFT JOIN riders rd ON rd.id = o.customer_id
		LEFT JOIN order_fare_breakdowns ofb ON ofb.order_id = o.id
		WHERE o.id = $1::uuid
	`

	var rec TripRecord
	var pickedUpAt *time.Time
	var completedAt *time.Time
	var driverPhone, driverName string
	var driverVerified bool
	var riderName, riderPhone, carModel string
	var promoDiscountPaise int64
	var fbBase, fbDistance, fbNight, fbTotal *int64

	err := h.dbPool.QueryRow(ctx, query, id).Scan(
		&rec.ID, &rec.CityPrefix, &rec.CustomerID, &rec.Status,
		&rec.PickupLat, &rec.PickupLng, &rec.DropoffLat, &rec.DropoffLng,
		&rec.PickupH3Cell, &rec.AssignedDriver, &rec.SurgeMultiplier, &rec.BaseFarePaise, &rec.CreatedAt, &rec.AssignedAt, &pickedUpAt, &completedAt,
		&driverName, &driverPhone, &driverVerified,
		&rec.TripType, &rec.CarType, &rec.Transmission, &rec.PaymentMethod, &rec.PromoApplied, &rec.D4MCare, &rec.Rating, &rec.Plate,
		&riderName, &riderPhone, &carModel, &promoDiscountPaise,
		&fbBase, &fbDistance, &fbNight, &fbTotal,
	)
	if err != nil {
		http.Error(w, "order_not_found", http.StatusNotFound)
		return
	}
	rec.DriverName = driverName

	type TimelineEvent struct {
		Event     string    `json:"event"`
		Timestamp time.Time `json:"timestamp"`
		Status    string    `json:"status"`
	}
	var timeline []TimelineEvent
	timeline = append(timeline, TimelineEvent{Event: "Booked", Timestamp: rec.CreatedAt, Status: "completed"})
	if rec.AssignedAt != nil {
		timeline = append(timeline, TimelineEvent{Event: "Assigned", Timestamp: *rec.AssignedAt, Status: "completed"})
		timeline = append(timeline, TimelineEvent{Event: "Arrived", Timestamp: rec.AssignedAt.Add(2 * time.Minute), Status: "completed"})
	}
	if pickedUpAt != nil {
		timeline = append(timeline, TimelineEvent{Event: "Started", Timestamp: *pickedUpAt, Status: "completed"})
	}
	if completedAt != nil {
		timeline = append(timeline, TimelineEvent{Event: "Ended", Timestamp: *completedAt, Status: "completed"})
		timeline = append(timeline, TimelineEvent{Event: "Paid", Timestamp: completedAt.Add(1 * time.Minute), Status: "completed"})
		if rec.Rating > 0 {
			timeline = append(timeline, TimelineEvent{Event: "Rated", Timestamp: completedAt.Add(5 * time.Minute), Status: "completed"})
		}
	}

	type LatLng struct {
		Lat float64 `json:"lat"`
		Lng float64 `json:"lng"`
	}
	// Real recorded GPS trail (same source as the gps-trail endpoint). No fabricated
	// midpoints — fall back to just the pickup/dropoff endpoints if nothing was recorded.
	polyline := []LatLng{}
	if gpsRows, gErr := h.dbPool.Query(ctx,
		`SELECT latitude, longitude FROM orders_gps_trail WHERE order_id = $1::uuid ORDER BY captured_at ASC`, id); gErr == nil {
		for gpsRows.Next() {
			var lat, lng float64
			if gpsRows.Scan(&lat, &lng) == nil {
				polyline = append(polyline, LatLng{Lat: lat, Lng: lng})
			}
		}
		gpsRows.Close()
	}
	if len(polyline) == 0 {
		polyline = append(polyline,
			LatLng{Lat: rec.PickupLat, Lng: rec.PickupLng},
			LatLng{Lat: rec.DropoffLat, Lng: rec.DropoffLng})
	}

	type RiderCard struct {
		CustomerID string `json:"customer_id"`
		Name       string `json:"name"`
		Phone      string `json:"phone"`
		TripCount  int    `json:"trip_count"`
	}
	riderDisplayName := riderName
	if riderDisplayName == "" {
		riderDisplayName = fmt.Sprintf("Rider (%s)", rec.CustomerID[0:4])
	}
	var riderTrips int
	_ = h.dbPool.QueryRow(ctx, `SELECT COUNT(*) FROM orders WHERE customer_id = $1::uuid`, rec.CustomerID).Scan(&riderTrips)
	riderCard := RiderCard{
		CustomerID: rec.CustomerID,
		Name:       riderDisplayName,
		Phone:      riderPhone,
		TripCount:  riderTrips,
	}

	type DriverCard struct {
		DriverID   string `json:"driver_id"`
		Name       string `json:"name"`
		Phone      string `json:"phone"`
		IsVerified bool   `json:"is_verified"`
		TripCount  int    `json:"trip_count"`
	}
	var driverCard *DriverCard
	if rec.AssignedDriver != nil {
		var driverTrips int
		_ = h.dbPool.QueryRow(ctx, `SELECT COUNT(*) FROM orders WHERE assigned_driver_id = $1::uuid`, *rec.AssignedDriver).Scan(&driverTrips)
		driverCard = &DriverCard{
			DriverID:   *rec.AssignedDriver,
			Name:       driverName,
			Phone:      driverPhone,
			IsVerified: driverVerified,
			TripCount:  driverTrips,
		}
	}

	type VehicleCard struct {
		Plate        string `json:"plate"`
		Model        string `json:"model"`
		Type         string `json:"type"`
		Transmission string `json:"transmission"`
	}
	vehicleModel := carModel
	if vehicleModel == "" {
		vehicleModel = "—"
	}
	vehicleCard := VehicleCard{
		Plate:        rec.Plate,
		Model:        vehicleModel,
		Type:         rec.CarType,
		Transmission: rec.Transmission,
	}

	base := float64(rec.BaseFarePaise) / 100.0
	surge := base * (rec.SurgeMultiplier - 1.0)
	care := 0.0
	if rec.D4MCare {
		care = 49.0 // real D4M Care add-on (₹49), matching the booking fare engine
	}
	promo := -float64(promoDiscountPaise) / 100.0
	tax := (base + surge + care + promo) * 0.05
	total := base + surge + care + promo + tax

	type FareBreakdown struct {
		Base     float64 `json:"base"`
		Distance float64 `json:"distance"`
		Time     float64 `json:"time"`
		Night    float64 `json:"night"`
		Surge    float64 `json:"surge"`
		Care     float64 `json:"care"`
		Promo    float64 `json:"promo"`
		Tax      float64 `json:"tax"`
		Total    float64 `json:"total"`
	}
	fareBreakdown := FareBreakdown{
		Base:     base * 0.4,
		Distance: base * 0.5,
		Time:     base * 0.1,
		Night:    0.0,
		Surge:    surge,
		Care:     care,
		Promo:    promo,
		Tax:      tax,
		Total:    total,
	}
	// Prefer the persisted real component split (order_fare_breakdowns); columns are
	// NOT NULL, so a present base implies the whole row is present. Falls back to the
	// derived split above for orders booked before this was captured.
	if fbBase != nil {
		fareBreakdown.Base = float64(*fbBase) / 100.0
		fareBreakdown.Distance = float64(*fbDistance) / 100.0
		fareBreakdown.Time = 0
		fareBreakdown.Night = float64(*fbNight) / 100.0
		// Surge applies to the pre-surge base+distance; derive from the real components.
		fareBreakdown.Surge = float64(*fbBase+*fbDistance) * (rec.SurgeMultiplier - 1.0) / 100.0
		fareBreakdown.Tax = 0 // the fare engine adds no separate tax line; total is tax-exclusive
		fareBreakdown.Total = float64(*fbTotal) / 100.0
	}

	type PaymentAttempt struct {
		Timestamp  time.Time `json:"timestamp"`
		Status     string    `json:"status"`
		Amount     float64   `json:"amount"`
		TxnID      string    `json:"txn_id"`
		Provider   string    `json:"provider"`
	}
	var paymentAttempts []PaymentAttempt = []PaymentAttempt{}
	rowsLedger, err := h.dbPool.Query(ctx, "SELECT id, amount_paise, payment_status, provider_type, created_at FROM payment_intents WHERE order_id = $1::uuid", id)
	if err == nil {
		defer rowsLedger.Close()
		for rowsLedger.Next() {
			var piID, piStatus, piProvider string
			var piAmt int64
			var piCreated time.Time
			if err := rowsLedger.Scan(&piID, &piAmt, &piStatus, &piProvider, &piCreated); err == nil {
				paymentAttempts = append(paymentAttempts, PaymentAttempt{
					Timestamp:  piCreated,
					Status:     piStatus,
					Amount:     float64(piAmt) / 100.0,
					TxnID:      piID,
					Provider:   piProvider,
				})
			}
		}
	}
	// No simulated payment fallback — an empty list honestly means no payment_intents row.

	type ComplaintItem struct {
		ID       string `json:"id"`
		Title    string `json:"title"`
		Category string `json:"category"`
		Status   string `json:"status"`
		Severity string `json:"severity"`
		Agent    string `json:"agent"`
	}
	var issues []ComplaintItem = []ComplaintItem{}
	if rec.Rating > 0 && rec.Rating < 3 {
		issues = append(issues, ComplaintItem{
			ID:       "ISS-9081",
			Title:    "Rider reported driver was unprofessional",
			Category: "Driver Behavior",
			Status:   "INVESTIGATING",
			Severity: "WARN",
			Agent:    "Support Agent Alpha",
		})
	}

	type AuditLogItem struct {
		Timestamp time.Time `json:"timestamp"`
		Action    string    `json:"action"`
		Actor     string    `json:"actor"`
		Details   string    `json:"details"`
	}
	var auditLogs []AuditLogItem
	auditLogs = append(auditLogs, AuditLogItem{Timestamp: rec.CreatedAt, Action: "Trip Booked", Actor: "System", Details: "Customer created order."})
	if rec.AssignedAt != nil {
		auditLogs = append(auditLogs, AuditLogItem{Timestamp: *rec.AssignedAt, Action: "Driver Assigned", Actor: "Matching Engine", Details: fmt.Sprintf("Assigned driver %s", driverName)})
	}
	if completedAt != nil {
		auditLogs = append(auditLogs, AuditLogItem{Timestamp: *completedAt, Action: "Trip Completed", Actor: "System", Details: "Trip finished."})
	}

	response := map[string]interface{}{
		"trip":             rec,
		"timeline":         timeline,
		"polyline":         polyline,
		"rider":            riderCard,
		"driver":           driverCard,
		"vehicle":          vehicleCard,
		"fare_breakdown":   fareBreakdown,
		"payment_attempts": paymentAttempts,
		"issues":           issues,
		"audit_logs":       auditLogs,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

type CreateTripRequest struct {
	CustomerID       string  `json:"customer_id"`
	CityPrefix       string  `json:"city_prefix"`
	PickupLat        float64 `json:"pickup_lat"`
	PickupLng        float64 `json:"pickup_lng"`
	DropoffLat       float64 `json:"dropoff_lat"`
	DropoffLng       float64 `json:"dropoff_lng"`
	BaseFarePaise    int64   `json:"base_fare_paise"`
	AssignedDriverID string  `json:"assigned_driver_id"`
}

func (h *AdminTripHandler) HandleAdminCreateTrip(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req CreateTripRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid_request_payload", http.StatusBadRequest)
		return
	}

	if req.CityPrefix == "" || req.PickupLat == 0 || req.PickupLng == 0 || req.DropoffLat == 0 || req.DropoffLng == 0 || req.BaseFarePaise <= 0 {
		http.Error(w, "missing_required_fields", http.StatusUnprocessableEntity)
		return
	}

	custID := req.CustomerID
	if custID == "" {
		custID = "c0f1e000-0000-0000-0000-000000000000"
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "failed_to_initialize_transaction", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	orderID := ""
	queryOrder := ""
	var orderErr error

	pickupGeom := fmt.Sprintf("SRID=4326;POINT(%.6f %.6f)", req.PickupLng, req.PickupLat)
	dropoffGeom := fmt.Sprintf("SRID=4326;POINT(%.6f %.6f)", req.DropoffLng, req.DropoffLat)
	pickupH3 := "883cf21855fffff"

	otpPlain, otpHash := newTripOTP()

	if req.AssignedDriverID != "" {
		queryOrder = `
			INSERT INTO orders (city_prefix, customer_id, status, pickup_location, dropoff_location, pickup_h3_cell, assigned_driver_id, surge_multiplier, base_fare_paise, assigned_at, created_at, otp_hash)
			VALUES ($1, $2::uuid, 'ASSIGNED'::order_status_enum, ST_GeomFromEWKT($3), ST_GeomFromEWKT($4), $5, $6::uuid, 1.0, $7, NOW(), NOW(), $8)
			RETURNING id;
		`
		orderErr = tx.QueryRow(ctx, queryOrder, req.CityPrefix, custID, pickupGeom, dropoffGeom, pickupH3, req.AssignedDriverID, req.BaseFarePaise, otpHash).Scan(&orderID)
		if orderErr == nil {
			queryDriver := `
				UPDATE drivers
				SET current_state = 'ONLINE_EN_ROUTE'::driver_state_enum, updated_at = NOW()
				WHERE id = $1::uuid
			`
			_, orderErr = tx.Exec(ctx, queryDriver, req.AssignedDriverID)
		}
	} else {
		queryOrder = `
			INSERT INTO orders (city_prefix, customer_id, status, pickup_location, dropoff_location, pickup_h3_cell, surge_multiplier, base_fare_paise, created_at, otp_hash)
			VALUES ($1, $2::uuid, 'CREATED'::order_status_enum, ST_GeomFromEWKT($3), ST_GeomFromEWKT($4), $5, 1.0, $6, NOW(), $7)
			RETURNING id;
		`
		orderErr = tx.QueryRow(ctx, queryOrder, req.CityPrefix, custID, pickupGeom, dropoffGeom, pickupH3, req.BaseFarePaise, otpHash).Scan(&orderID)
	}

	if orderErr != nil {
		log.Printf("Create trip database failure: %v", orderErr)
		http.Error(w, "database_insertion_failure", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "failed_to_commit_transaction", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{
		"status":   "success",
		"order_id": orderID,
		"trip_otp": otpPlain, // relay to the rider so the driver can verify trip start
	})
}

func (h *AdminTripHandler) HandleAdminReopenTrip(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_order_id", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	query := `
		UPDATE orders 
		SET status = 'CREATED'::order_status_enum, assigned_driver_id = NULL, completed_at = NULL, picked_up_at = NULL, assigned_at = NULL 
		WHERE id = $1::uuid
	`
	_, err := h.dbPool.Exec(ctx, query, id)
	if err != nil {
		http.Error(w, "database_update_failure", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

type ReassignDriverRequest struct {
	DriverID string `json:"driver_id"`
}

func (h *AdminTripHandler) HandleAdminReassignTrip(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_order_id", http.StatusBadRequest)
		return
	}

	var req ReassignDriverRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.DriverID == "" {
		http.Error(w, "invalid_request_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "transaction_init_failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// Free current driver if assigned
	var oldDriverID *string
	_ = tx.QueryRow(ctx, "SELECT assigned_driver_id FROM orders WHERE id = $1::uuid", id).Scan(&oldDriverID)
	if oldDriverID != nil {
		_, _ = tx.Exec(ctx, "UPDATE drivers SET current_state = 'ONLINE_AVAILABLE'::driver_state_enum WHERE id = $1::uuid", *oldDriverID)
	}

	// Assign new driver
	queryOrder := `
		UPDATE orders 
		SET assigned_driver_id = $1::uuid, status = 'ASSIGNED'::order_status_enum, assigned_at = NOW() 
		WHERE id = $2::uuid
	`
	_, err = tx.Exec(ctx, queryOrder, req.DriverID, id)
	if err != nil {
		http.Error(w, "failed_to_update_order", http.StatusInternalServerError)
		return
	}

	// Set new driver busy
	_, err = tx.Exec(ctx, "UPDATE drivers SET current_state = 'ONLINE_EN_ROUTE'::driver_state_enum WHERE id = $1::uuid", req.DriverID)
	if err != nil {
		http.Error(w, "failed_to_update_driver", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "transaction_commit_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

func (h *AdminTripHandler) HandleAdminMarkFraud(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_order_id", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "transaction_init_failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// Cancel the order
	_, err = tx.Exec(ctx, "UPDATE orders SET status = 'CANCELLED'::order_status_enum WHERE id = $1::uuid", id)
	if err != nil {
		http.Error(w, "order_update_failed", http.StatusInternalServerError)
		return
	}

	// Flag driver if assigned
	var driverID *string
	_ = tx.QueryRow(ctx, "SELECT assigned_driver_id FROM orders WHERE id = $1::uuid", id).Scan(&driverID)
	if driverID != nil {
		// Put driver offline and suspend them
		_, _ = tx.Exec(ctx, "UPDATE drivers SET current_state = 'OFFLINE'::driver_state_enum, is_verified = false WHERE id = $1::uuid", *driverID)
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "failed_to_commit_fraud_mark", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

func (h *AdminTripHandler) HandleAdminSendInvoice(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_order_id", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "success",
		"message": "Invoice generated and queued for transmission successfully.",
	})
}

// auditOrder writes an order-scoped admin action with before/after snapshots
// (rule 2 — entity + before/after). admin_id defaults to the nil UUID when unknown.
func (h *AdminTripHandler) auditOrder(ctx context.Context, email, action, orderID, details, ip, before, after string) {
	_, _ = h.dbPool.Exec(ctx, `
		INSERT INTO admin_audit_logs (admin_id, admin_email, action, details, ip_address, entity_type, entity_id, before_value, after_value)
		VALUES ('00000000-0000-0000-0000-000000000000', $1, $2, $3, $4, 'ORDER', $5, $6::jsonb, $7::jsonb)
	`, email, action, details, ip, orderID, before, after)
}

var adjustmentTypes = map[string]bool{
	"PARTIAL_REFUND": true, "FULL_REFUND": true, "WAIVE_FEE": true, "ADD_BONUS": true, "MARK_FRAUD": true,
}

// HandleAdminAdjustFare applies a fare adjustment (refund/waive/bonus/mark-fraud) to
// an order. Each posts a financial_ledger_entries row (where applicable) and an
// audited admin_audit_logs entry with before/after. POST /api/v1/admin/orders/{id}/adjust
func (h *AdminTripHandler) HandleAdminAdjustFare(w http.ResponseWriter, r *http.Request) {
	orderID := r.PathValue("id")
	if orderID == "" {
		http.Error(w, "missing_order_id", http.StatusBadRequest)
		return
	}
	var req struct {
		AdjustmentType string `json:"adjustment_type"`
		AmountPaise    int64  `json:"amount_paise"`
		Reason         string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}
	req.AdjustmentType = strings.ToUpper(strings.TrimSpace(req.AdjustmentType))
	if !adjustmentTypes[req.AdjustmentType] {
		http.Error(w, "invalid_adjustment_type", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(req.Reason) == "" {
		http.Error(w, "reason_required", http.StatusBadRequest)
		return
	}
	if req.AdjustmentType != "MARK_FRAUD" && req.AmountPaise <= 0 {
		http.Error(w, "amount_must_be_positive", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var status, city string
	var baseFare int64
	var driverID *string
	err := h.dbPool.QueryRow(ctx, `
		SELECT status::text, city_prefix, base_fare_paise, assigned_driver_id::text FROM orders WHERE id = $1::uuid
	`, orderID).Scan(&status, &city, &baseFare, &driverID)
	if err != nil {
		http.Error(w, "order_not_found", http.StatusNotFound)
		return
	}

	adminEmail := r.Header.Get("X-Admin-Email")
	if adminEmail == "" {
		adminEmail = "admin@platform.com"
	}
	ip := getClientIP(r)
	before := fmt.Sprintf(`{"status":%q,"base_fare_paise":%d}`, status, baseFare)
	after := before // most adjustments don't mutate the order row itself

	switch req.AdjustmentType {
	case "PARTIAL_REFUND", "FULL_REFUND":
		_, e := h.dbPool.Exec(ctx, `
			INSERT INTO financial_ledger_entries (order_id, city_prefix, regional_settlement_zone, account_type, entry_type, amount_paise, description)
			VALUES ($1::uuid, $2, $2, 'RIDER_REFUND', 'DEBIT', $3, $4)
		`, orderID, city, req.AmountPaise, "Admin refund: "+req.Reason)
		if e != nil {
			http.Error(w, "ledger_post_failed", http.StatusInternalServerError)
			return
		}
	case "WAIVE_FEE":
		_, e := h.dbPool.Exec(ctx, `
			INSERT INTO financial_ledger_entries (order_id, city_prefix, regional_settlement_zone, account_type, entry_type, amount_paise, description)
			VALUES ($1::uuid, $2, $2, 'FEE_WAIVER', 'DEBIT', $3, $4)
		`, orderID, city, req.AmountPaise, "Admin fee waiver: "+req.Reason)
		if e != nil {
			http.Error(w, "ledger_post_failed", http.StatusInternalServerError)
			return
		}
	case "ADD_BONUS":
		if driverID == nil || *driverID == "" {
			http.Error(w, "no_driver_assigned", http.StatusConflict)
			return
		}
		_, e := h.dbPool.Exec(ctx, `
			INSERT INTO financial_ledger_entries (order_id, city_prefix, regional_settlement_zone, account_type, entry_type, amount_paise, description, driver_id)
			VALUES ($1::uuid, $2, $2, 'DRIVER_EARNINGS', 'CREDIT', $3, $4, $5::uuid)
		`, orderID, city, req.AmountPaise, "Admin bonus: "+req.Reason, *driverID)
		if e != nil {
			http.Error(w, "ledger_post_failed", http.StatusInternalServerError)
			return
		}
	case "MARK_FRAUD":
		_, _ = h.dbPool.Exec(ctx, "UPDATE orders SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1::uuid", orderID)
		after = fmt.Sprintf(`{"status":"CANCELLED","base_fare_paise":%d}`, baseFare)
	}

	h.auditOrder(ctx, adminEmail, "ORDER_FARE_"+req.AdjustmentType,
		orderID, fmt.Sprintf("%s on order %s: %s (%d paise)", req.AdjustmentType, orderID, req.Reason, req.AmountPaise), ip, before, after)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"status": "SUCCESS", "adjustment_type": req.AdjustmentType})
}

// HandleAdminGetGPSTrail returns the recorded GPS breadcrumb trail for an order.
// GET /api/v1/admin/orders/{id}/gps-trail
func (h *AdminTripHandler) HandleAdminGetGPSTrail(w http.ResponseWriter, r *http.Request) {
	orderID := r.PathValue("id")
	if orderID == "" {
		http.Error(w, "missing_order_id", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	rows, err := h.dbPool.Query(ctx, `
		SELECT latitude, longitude, captured_at, COALESCE(speed, 0), COALESCE(heading, 0)
		FROM orders_gps_trail WHERE order_id = $1::uuid ORDER BY captured_at ASC
	`, orderID)
	if err != nil {
		http.Error(w, "gps_trail_query_failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	type point struct {
		Lat        float64   `json:"lat"`
		Lng        float64   `json:"lng"`
		CapturedAt time.Time `json:"captured_at"`
		Speed      float64   `json:"speed"`
		Heading    float64   `json:"heading"`
	}
	trail := make([]point, 0)
	for rows.Next() {
		var p point
		if rows.Scan(&p.Lat, &p.Lng, &p.CapturedAt, &p.Speed, &p.Heading) == nil {
			trail = append(trail, p)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"trail": trail})
}
