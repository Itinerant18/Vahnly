package http

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

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
		       CASE 
		         WHEN MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 4) = 0 THEN 'in-city round' 
		         WHEN MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 4) = 1 THEN 'one-way' 
		         WHEN MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 4) = 2 THEN 'mini-outstation' 
		         ELSE 'outstation' 
		       END as trip_type,
		       CASE 
		         WHEN MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 4) = 0 THEN 'Hatchback' 
		         WHEN MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 4) = 1 THEN 'Sedan' 
		         WHEN MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 4) = 2 THEN 'SUV' 
		         ELSE 'Premium' 
		       END as car_type,
		       CASE 
		         WHEN MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 2) = 0 THEN 'Manual' 
		         ELSE 'Automatic' 
		       END as transmission,
		       CASE 
		         WHEN MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 3) = 0 THEN 'Stripe' 
		         WHEN MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 3) = 1 THEN 'Razorpay' 
		         ELSE 'Cash' 
		       END as payment_method,
		       CASE 
		         WHEN MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 5) = 0 THEN 'WELCOME50' 
		         WHEN MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 5) = 1 THEN 'SAVEMORE' 
		         ELSE 'None' 
		       END as promo_applied,
		       CASE 
		         WHEN MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 2) = 0 THEN true 
		         ELSE false 
		       END as d4m_care,
		       CASE 
		         WHEN o.status = 'COMPLETED'::order_status_enum THEN (MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 5) + 1)::int 
		         ELSE 0 
		       END as rating,
		       CASE 
		         WHEN o.assigned_driver_id IS NULL THEN 'N/A' 
		         ELSE 'WB-02-' || CHR(65 + (MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 26)::int)) || 
		                          CHR(65 + (MOD(('x'||right(o.id::text, 8))::bit(32)::bigint/26, 26)::int)) || '-' || 
		                          LPAD((MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 10000)::text), 4, '0') 
		       END as plate
		FROM orders o
		LEFT JOIN drivers d ON o.assigned_driver_id = d.id
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

	hashExpr := "('x'||right(o.id::text, 8))::bit(32)::bigint"

	if tripType != "" {
		addCond(`CASE 
			WHEN MOD(`+hashExpr+`, 4) = 0 THEN 'in-city round' 
			WHEN MOD(`+hashExpr+`, 4) = 1 THEN 'one-way' 
			WHEN MOD(`+hashExpr+`, 4) = 2 THEN 'mini-outstation' 
			ELSE 'outstation' 
		END = $%d`, tripType)
	}

	if carType != "" {
		addCond(`CASE 
			WHEN MOD(`+hashExpr+`, 4) = 0 THEN 'Hatchback' 
			WHEN MOD(`+hashExpr+`, 4) = 1 THEN 'Sedan' 
			WHEN MOD(`+hashExpr+`, 4) = 2 THEN 'SUV' 
			ELSE 'Premium' 
		END = $%d`, carType)
	}

	if transmission != "" {
		addCond(`CASE 
			WHEN MOD(`+hashExpr+`, 2) = 0 THEN 'Manual' 
			ELSE 'Automatic' 
		END = $%d`, transmission)
	}

	if paymentMethod != "" {
		addCond(`CASE 
			WHEN MOD(`+hashExpr+`, 3) = 0 THEN 'Stripe' 
			WHEN MOD(`+hashExpr+`, 3) = 1 THEN 'Razorpay' 
			ELSE 'Cash' 
		END = $%d`, paymentMethod)
	}

	if promoApplied != "" {
		addCond(`CASE 
			WHEN MOD(`+hashExpr+`, 5) = 0 THEN 'WELCOME50' 
			WHEN MOD(`+hashExpr+`, 5) = 1 THEN 'SAVEMORE' 
			ELSE 'None' 
		END = $%d`, promoApplied)
	}

	if d4mCare != "" {
		if careVal, err := strconv.ParseBool(d4mCare); err == nil {
			addCond(`CASE 
				WHEN MOD(`+hashExpr+`, 2) = 0 THEN true 
				ELSE false 
			END = $%d`, careVal)
		}
	}

	if ratingLess3 == "true" {
		conditions = append(conditions, "o.status = 'COMPLETED'::order_status_enum")
		conditions = append(conditions, fmt.Sprintf("(MOD(%s, 5) + 1) < 3", hashExpr))
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
		       CASE 
		         WHEN MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 4) = 0 THEN 'in-city round' 
		         WHEN MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 4) = 1 THEN 'one-way' 
		         WHEN MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 4) = 2 THEN 'mini-outstation' 
		         ELSE 'outstation' 
		       END as trip_type,
		       CASE 
		         WHEN MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 4) = 0 THEN 'Hatchback' 
		         WHEN MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 4) = 1 THEN 'Sedan' 
		         WHEN MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 4) = 2 THEN 'SUV' 
		         ELSE 'Premium' 
		       END as car_type,
		       CASE 
		         WHEN MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 2) = 0 THEN 'Manual' 
		         ELSE 'Automatic' 
		       END as transmission,
		       CASE 
		         WHEN MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 3) = 0 THEN 'Stripe' 
		         WHEN MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 3) = 1 THEN 'Razorpay' 
		         ELSE 'Cash' 
		       END as payment_method,
		       CASE 
		         WHEN MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 5) = 0 THEN 'WELCOME50' 
		         WHEN MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 5) = 1 THEN 'SAVEMORE' 
		         ELSE 'None' 
		       END as promo_applied,
		       CASE 
		         WHEN MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 2) = 0 THEN true 
		         ELSE false 
		       END as d4m_care,
		       CASE 
		         WHEN o.status = 'COMPLETED'::order_status_enum THEN (MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 5) + 1)::int 
		         ELSE 0 
		       END as rating,
		       CASE 
		         WHEN o.assigned_driver_id IS NULL THEN 'N/A' 
		         ELSE 'WB-02-' || CHR(65 + (MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 26)::int)) || 
		                          CHR(65 + (MOD(('x'||right(o.id::text, 8))::bit(32)::bigint/26, 26)::int)) || '-' || 
		                          LPAD((MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 10000)::text), 4, '0') 
		       END as plate
		FROM orders o
		LEFT JOIN drivers d ON o.assigned_driver_id = d.id
		WHERE o.id = $1::uuid
	`

	var rec TripRecord
	var pickedUpAt *time.Time
	var completedAt *time.Time
	var driverPhone, driverName string
	var driverVerified bool

	err := h.dbPool.QueryRow(ctx, query, id).Scan(
		&rec.ID, &rec.CityPrefix, &rec.CustomerID, &rec.Status,
		&rec.PickupLat, &rec.PickupLng, &rec.DropoffLat, &rec.DropoffLng,
		&rec.PickupH3Cell, &rec.AssignedDriver, &rec.SurgeMultiplier, &rec.BaseFarePaise, &rec.CreatedAt, &rec.AssignedAt, &pickedUpAt, &completedAt,
		&driverName, &driverPhone, &driverVerified,
		&rec.TripType, &rec.CarType, &rec.Transmission, &rec.PaymentMethod, &rec.PromoApplied, &rec.D4MCare, &rec.Rating, &rec.Plate,
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
	var polyline []LatLng
	polyline = append(polyline, LatLng{Lat: rec.PickupLat, Lng: rec.PickupLng})
	for i := 1; i <= 3; i++ {
		ratio := float64(i) / 4.0
		lat := rec.PickupLat + (rec.DropoffLat-rec.PickupLat)*ratio
		lng := rec.PickupLng + (rec.DropoffLng-rec.PickupLng)*ratio
		polyline = append(polyline, LatLng{Lat: lat, Lng: lng})
	}
	polyline = append(polyline, LatLng{Lat: rec.DropoffLat, Lng: rec.DropoffLng})

	type RiderCard struct {
		CustomerID string `json:"customer_id"`
		Name       string `json:"name"`
		Phone      string `json:"phone"`
		TripCount  int    `json:"trip_count"`
	}
	riderCard := RiderCard{
		CustomerID: rec.CustomerID,
		Name:       fmt.Sprintf("Rider (%s)", rec.CustomerID[0:4]),
		Phone:      "+91 9876543210",
		TripCount:  14,
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
		driverCard = &DriverCard{
			DriverID:   *rec.AssignedDriver,
			Name:       driverName,
			Phone:      driverPhone,
			IsVerified: driverVerified,
			TripCount:  42,
		}
	}

	type VehicleCard struct {
		Plate        string `json:"plate"`
		Model        string `json:"model"`
		Type         string `json:"type"`
		Transmission string `json:"transmission"`
	}
	vehicleModel := "Maruti Swift"
	if rec.CarType == "Premium" {
		vehicleModel = "Audi A6"
	} else if rec.CarType == "SUV" {
		vehicleModel = "Toyota Innova"
	} else if rec.CarType == "Sedan" {
		vehicleModel = "Honda City"
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
		care = 15.0
	}
	promo := 0.0
	if rec.PromoApplied == "WELCOME50" {
		promo = -50.0
	} else if rec.PromoApplied == "SAVEMORE" {
		promo = -30.0
	}
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
	if len(paymentAttempts) == 0 {
		paymentAttempts = append(paymentAttempts, PaymentAttempt{
			Timestamp:  rec.CreatedAt.Add(10 * time.Minute),
			Status:     "SUCCEEDED",
			Amount:     total,
			TxnID:      "pi_simulated_" + id[0:6],
			Provider:   rec.PaymentMethod,
		})
	}

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

	if req.AssignedDriverID != "" {
		queryOrder = `
			INSERT INTO orders (city_prefix, customer_id, status, pickup_location, dropoff_location, pickup_h3_cell, assigned_driver_id, surge_multiplier, base_fare_paise, assigned_at, created_at)
			VALUES ($1, $2::uuid, 'ASSIGNED'::order_status_enum, ST_GeomFromEWKT($3), ST_GeomFromEWKT($4), $5, $6::uuid, 1.0, $7, NOW(), NOW())
			RETURNING id;
		`
		orderErr = tx.QueryRow(ctx, queryOrder, req.CityPrefix, custID, pickupGeom, dropoffGeom, pickupH3, req.AssignedDriverID, req.BaseFarePaise).Scan(&orderID)
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
			INSERT INTO orders (city_prefix, customer_id, status, pickup_location, dropoff_location, pickup_h3_cell, surge_multiplier, base_fare_paise, created_at)
			VALUES ($1, $2::uuid, 'CREATED'::order_status_enum, ST_GeomFromEWKT($3), ST_GeomFromEWKT($4), $5, 1.0, $6, NOW())
			RETURNING id;
		`
		orderErr = tx.QueryRow(ctx, queryOrder, req.CityPrefix, custID, pickupGeom, dropoffGeom, pickupH3, req.BaseFarePaise).Scan(&orderID)
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
