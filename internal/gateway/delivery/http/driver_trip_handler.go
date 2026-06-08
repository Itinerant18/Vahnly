package http

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
)

type FinalBill struct {
	OrderID             string  `json:"order_id"`
	BaseFarePaise       int64   `json:"base_fare_paise"`
	DistanceKM          float64 `json:"distance_km"`
	DistanceChargePaise int64   `json:"distance_charge_paise"`
	WaitMinutes         int     `json:"wait_minutes"`
	WaitChargePaise     int64   `json:"wait_charge_paise"`
	OvertimeMinutes     int     `json:"overtime_minutes"`
	OvertimeChargePaise int64   `json:"overtime_charge_paise"`
	TollsPaise          int64   `json:"tolls_paise"`
	ParkingChargesPaise int64   `json:"parking_charges_paise"`
	NightSurgePaise     int64   `json:"night_surge_paise"`
	CareSurchargePaise  int64   `json:"care_surcharge_paise"`
	TotalFarePaise      int64   `json:"total_fare_paise"`
}

// HandleDriverAddOrderEvent handles POST /api/v1/driver/orders/{id}/events
func (h *GatewayHandler) HandleDriverAddOrderEvent(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}

	orderID := r.PathValue("id")
	if orderID == "" {
		http.Error(w, "missing_order_id", http.StatusBadRequest)
		return
	}

	var req struct {
		EventType   string `json:"event_type"` // 'ADD_TOLL', 'ADD_STOP', 'toll_added', 'parking_added', 'waiting_added'
		AmountPaise int64  `json:"amount_paise"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}

	if req.EventType != "ADD_TOLL" && req.EventType != "ADD_STOP" && req.EventType != "toll_added" && req.EventType != "parking_added" && req.EventType != "waiting_added" && req.EventType != "REPORT_ISSUE" {
		http.Error(w, "invalid_event_type: must be ADD_TOLL, ADD_STOP, toll_added, parking_added, waiting_added, or REPORT_ISSUE", http.StatusBadRequest)
		return
	}
	if req.AmountPaise < 0 || (req.EventType != "REPORT_ISSUE" && req.AmountPaise <= 0) {
		http.Error(w, "invalid_amount: must be greater than zero (or non-negative for REPORT_ISSUE)", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		log.Printf("[ADD_ORDER_EVENT] Transaction initiation failed: %v", err)
		http.Error(w, "transaction_failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// Verify order status and driver assignment
	var currentStatus string
	var assignedDriverID *string
	var cityPrefix string
	var baseFarePaise int64
	query := `
		SELECT status::text, assigned_driver_id::text, city_prefix, base_fare_paise
		FROM orders 
		WHERE id = $1::uuid 
		FOR UPDATE
	`
	err = tx.QueryRow(ctx, query, orderID).Scan(&currentStatus, &assignedDriverID, &cityPrefix, &baseFarePaise)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "order_not_found", http.StatusNotFound)
			return
		}
		http.Error(w, "database_read_exception", http.StatusInternalServerError)
		return
	}

	if currentStatus != "DELIVERING" {
		http.Error(w, fmt.Sprintf("invalid_state: expected DELIVERING, got %s", currentStatus), http.StatusConflict)
		return
	}
	if assignedDriverID == nil || *assignedDriverID != driverID {
		http.Error(w, "forbidden: driver identity mismatch", http.StatusForbidden)
		return
	}

	// 1. Insert event into order_events
	eventInsert := `
		INSERT INTO order_events (order_id, event_type, amount_paise, description, created_at)
		VALUES ($1::uuid, $2, $3, $4, NOW())
	`
	_, err = tx.Exec(ctx, eventInsert, orderID, req.EventType, req.AmountPaise, req.Description)
	if err != nil {
		log.Printf("[ADD_ORDER_EVENT] Failed inserting event: %v", err)
		http.Error(w, "failed_to_save_event", http.StatusInternalServerError)
		return
	}

	// 2. Post unbalanced credit entry for the driver to trigger discrepancy alert (skip for REPORT_ISSUE)
	if req.EventType != "REPORT_ISSUE" {
		ledgerInsert := `
			INSERT INTO financial_ledger_entries (order_id, city_prefix, regional_settlement_zone, account_type, entry_type, amount_paise, description, created_at)
			VALUES ($1::uuid, $2, $2, 'DRIVER_EARNINGS', 'CREDIT', $3, $4, NOW())
		`
		desc := fmt.Sprintf("Mid-trip mutation: %s - %s", req.EventType, req.Description)
		_, err = tx.Exec(ctx, ledgerInsert, orderID, cityPrefix, req.AmountPaise, desc)
		if err != nil {
			log.Printf("[ADD_ORDER_EVENT] Failed inserting ledger entry: %v", err)
			http.Error(w, "failed_to_post_ledger", http.StatusInternalServerError)
			return
		}
	}

	// 3. Compute updated total fare estimate
	var eventsSum int64
	err = tx.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_paise), 0) FROM order_events WHERE order_id = $1::uuid
	`, orderID).Scan(&eventsSum)
	if err != nil {
		log.Printf("[ADD_ORDER_EVENT] Failed querying events sum: %v", err)
	}

	fareEstimate := baseFarePaise + eventsSum + 5000 + 1500

	if err := tx.Commit(ctx); err != nil {
		log.Printf("[ADD_ORDER_EVENT] Transaction commit failed: %v", err)
		http.Error(w, "commit_failed", http.StatusInternalServerError)
		return
	}

	// Publish the updated fare estimate to Redis Pub/Sub so it can be streamed to the rider
	pubPayload := map[string]interface{}{
		"order_id":      orderID,
		"fare_estimate": fareEstimate,
	}
	if bytes, marshalErr := json.Marshal(pubPayload); marshalErr == nil {
		_ = h.clusterClient.Publish(ctx, RedisPubSubChannel, string(bytes)).Err()
	}

	writeJSONResponse(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Event recorded and ledger updated",
	})
}

// HandleDriverEndTrip handles PATCH /api/v1/driver/orders/{id}/end
func (h *GatewayHandler) HandleDriverEndTrip(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}

	orderID := r.PathValue("id")
	if orderID == "" {
		http.Error(w, "missing_order_id", http.StatusBadRequest)
		return
	}

	var req struct {
		OdometerReading int    `json:"odometer_reading"`
		FuelLevel       int    `json:"fuel_level"`
		PhotoURL        string `json:"photo_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}

	if req.OdometerReading <= 0 {
		http.Error(w, "invalid_odometer_reading: must be a positive integer", http.StatusBadRequest)
		return
	}
	if req.FuelLevel < 0 || req.FuelLevel > 100 {
		req.FuelLevel = max(0, min(100, req.FuelLevel))
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		log.Printf("[END_TRIP] Transaction initiation failed: %v", err)
		http.Error(w, "transaction_failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// Fetch current status, assigned_driver_id, waiting_started_at, picked_up_at
	var currentStatus string
	var assignedDriverID *string
	var cityPrefix string
	var baseFarePaise int64
	var waitingStartedAt *time.Time
	var pickedUpAt *time.Time
	query := `
		SELECT status::text, assigned_driver_id::text, city_prefix, base_fare_paise, waiting_started_at, picked_up_at
		FROM orders 
		WHERE id = $1::uuid 
		FOR UPDATE
	`
	err = tx.QueryRow(ctx, query, orderID).Scan(
		&currentStatus, &assignedDriverID, &cityPrefix, &baseFarePaise, &waitingStartedAt, &pickedUpAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "order_not_found", http.StatusNotFound)
			return
		}
		http.Error(w, "database_read_exception", http.StatusInternalServerError)
		return
	}

	if currentStatus != "DELIVERING" {
		http.Error(w, fmt.Sprintf("invalid_state: expected DELIVERING, got %s", currentStatus), http.StatusConflict)
		return
	}
	if assignedDriverID == nil || *assignedDriverID != driverID {
		http.Error(w, "forbidden: driver identity mismatch", http.StatusForbidden)
		return
	}

	// Fetch START odometer checkpoint
	var startReading int
	err = tx.QueryRow(ctx,
		`SELECT odometer_value FROM trip_odometer_checkpoints WHERE order_id = $1::uuid AND checkpoint_type = 'START'`,
		orderID).Scan(&startReading)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "sequence_violation: START checkpoint must be captured before END", http.StatusUnprocessableEntity)
			return
		}
		http.Error(w, "database_read_exception", http.StatusInternalServerError)
		return
	}

	if req.OdometerReading <= startReading {
		http.Error(w, fmt.Sprintf("invalid_end_reading: end odometer (%d) must be greater than start odometer (%d)", req.OdometerReading, startReading), http.StatusBadRequest)
		return
	}

	// 1. Insert END odometer checkpoint
	_, err = tx.Exec(ctx, `
		INSERT INTO trip_odometer_checkpoints (order_id, checkpoint_type, odometer_value, fuel_percentage, photo_url, captured_at, created_by)
		VALUES ($1::uuid, 'END', $2, $3, $4, NOW(), $5::uuid)
		ON CONFLICT (order_id, checkpoint_type) DO UPDATE
		SET odometer_value = EXCLUDED.odometer_value,
		    fuel_percentage = EXCLUDED.fuel_percentage,
		    photo_url       = EXCLUDED.photo_url,
		    captured_at     = EXCLUDED.captured_at
	`, orderID, req.OdometerReading, req.FuelLevel, req.PhotoURL, driverID)
	if err != nil {
		log.Printf("[END_TRIP] Failed inserting END checkpoint: %v", err)
		http.Error(w, "checkpoint_write_failed", http.StatusInternalServerError)
		return
	}

	// Save dashboard photo to driver_documents if present
	if req.PhotoURL != "" {
		_, docErr := tx.Exec(ctx, `
			INSERT INTO driver_documents (driver_id, document_type, storage_url, status)
			VALUES ($1::uuid, 'TRIP_END_DASHBOARD_PHOTO', $2, 'VERIFIED')
		`, driverID, req.PhotoURL)
		if docErr != nil {
			log.Printf("[END_TRIP] Failed saving dashboard photo to driver_documents: %v", docErr)
		}
	}

	// 2. Finalize trip status
	completedAt := time.Now()
	_, err = tx.Exec(ctx, `
		UPDATE orders 
		SET status = 'COMPLETED'::order_status_enum,
		    completed_at = $2
		WHERE id = $1::uuid
	`, orderID, completedAt)
	if err != nil {
		log.Printf("[END_TRIP] Failed updating order status: %v", err)
		http.Error(w, "order_status_update_failed", http.StatusInternalServerError)
		return
	}

	// 3. Reset driver state to ONLINE_AVAILABLE and duty state to ONLINE
	_, err = tx.Exec(ctx, `
		UPDATE drivers 
		SET current_state = 'ONLINE_AVAILABLE'::driver_state_enum,
		    duty_state = 'ONLINE'::driver_duty_state,
		    updated_at = NOW()
		WHERE id = $1::uuid
	`, driverID)
	if err != nil {
		log.Printf("[END_TRIP] Failed resetting driver state: %v", err)
		http.Error(w, "driver_state_update_failed", http.StatusInternalServerError)
		return
	}

	// 4. Calculate Bill
	actualKM := float64(req.OdometerReading - startReading)
	extraKM := math.Max(0, actualKM-15.0)
	distanceChargePaise := int64(extraKM * 1800.0) // ₹18 per km after 15 km free

	waitMinutes := 0
	if waitingStartedAt != nil && pickedUpAt != nil {
		waitMinutes = int(pickedUpAt.Sub(*waitingStartedAt).Minutes())
	}
	waitChargePaise := int64(0)
	if waitMinutes > 5 {
		waitChargePaise = int64(waitMinutes-5) * 200 // ₹2/min after 5 mins
	}

	var startTripTime time.Time
	if pickedUpAt != nil {
		startTripTime = *pickedUpAt
	} else {
		startTripTime = completedAt.Add(-15 * time.Minute) // default fallback
	}
	overtimeMinutes := int(completedAt.Sub(startTripTime).Minutes())
	overtimeChargePaise := int64(overtimeMinutes) * 50 // ₹0.50 per minute

	// Query events for tolls and parking
	var tollsPaise, parkingPaise int64
	err = tx.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN event_type IN ('ADD_TOLL', 'toll_added') THEN amount_paise ELSE 0 END), 0),
		       COALESCE(SUM(CASE WHEN event_type IN ('ADD_STOP', 'parking_added', 'waiting_added') THEN amount_paise ELSE 0 END), 0)
		FROM order_events
		WHERE order_id = $1::uuid
	`, orderID).Scan(&tollsPaise, &parkingPaise)
	if err != nil {
		log.Printf("[END_TRIP] Failed querying events sum: %v", err)
	}

	nightSurgePaise := int64(5000) // flat night surge ₹50
	careSurchargePaise := int64(1500) // flat care surcharge ₹15

	totalFarePaise := baseFarePaise + distanceChargePaise + waitChargePaise + overtimeChargePaise + tollsPaise + parkingPaise + nightSurgePaise + careSurchargePaise

	// 5. Run Odometer Variance Audit
	var straightKm float64
	err = tx.QueryRow(ctx,
		`SELECT ST_Distance(pickup_location, dropoff_location) / 1000.0 FROM orders WHERE id = $1::uuid`,
		orderID).Scan(&straightKm)
	if err == nil && straightKm > 0 {
		expectedKm := straightKm * 1.3
		variancePct := (actualKM - expectedKm) / expectedKm * 100
		if math.Abs(variancePct) > 15.0 {
			// Flag review, hold payout, post corrective adjustment entries
			_, _ = tx.Exec(ctx, `UPDATE orders SET financial_status = 'REVIEW_REQUIRED' WHERE id = $1::uuid`, orderID)
			
			holdReason := fmt.Sprintf("Odometer variance %.1f%% under financial review (order %s)", variancePct, orderID)
			_, _ = tx.Exec(ctx, `UPDATE drivers SET payout_hold = true, payout_hold_reason = $1 WHERE id = $2::uuid`, holdReason, driverID)

			correctivePaise := int64(math.Round(math.Abs(actualKM-expectedKm) * 1200)) // ₹12 corrective rate
			if correctivePaise <= 0 {
				correctivePaise = 1
			}

			desc := fmt.Sprintf("[CORRECTIVE_ADJUSTMENT PENDING_REVIEW] mileage variance %.1f%% on order %s", variancePct, orderID)
			insertLedger := `INSERT INTO financial_ledger_entries (order_id, city_prefix, regional_settlement_zone, account_type, entry_type, amount_paise, description, created_at)
			                 VALUES ($1::uuid, $2, $2, 'CORRECTIVE_ADJUSTMENT', $3, $4, $5, NOW())`
			_, _ = tx.Exec(ctx, insertLedger, orderID, cityPrefix, "DEBIT", correctivePaise, desc)
			_, _ = tx.Exec(ctx, insertLedger, orderID, cityPrefix, "CREDIT", correctivePaise, desc)
			
			log.Printf("[END_TRIP_AUDIT] Order %s flagged REVIEW_REQUIRED due to odometer variance (%.1f%%)", orderID, variancePct)
		}
	}

	// Insert audit log
	auditQuery := `INSERT INTO audit_logs (driver_id, action) VALUES ($1::uuid, $2)`
	actionStr := fmt.Sprintf("TRIP_ENDED: order_id=%s, actual_km=%.2f, total_fare=₹%.2f", orderID, actualKM, float64(totalFarePaise)/100.0)
	_, _ = tx.Exec(ctx, auditQuery, driverID, actionStr)

	if err := tx.Commit(ctx); err != nil {
		log.Printf("[END_TRIP] Transaction commit failed: %v", err)
		http.Error(w, "commit_failed", http.StatusInternalServerError)
		return
	}

	// 6. Return DTO
	bill := FinalBill{
		OrderID:             orderID,
		BaseFarePaise:       baseFarePaise,
		DistanceKM:          actualKM,
		DistanceChargePaise: distanceChargePaise,
		WaitMinutes:         waitMinutes,
		WaitChargePaise:     waitChargePaise,
		OvertimeMinutes:     overtimeMinutes,
		OvertimeChargePaise: overtimeChargePaise,
		TollsPaise:          tollsPaise,
		ParkingChargesPaise: parkingPaise,
		NightSurgePaise:     nightSurgePaise,
		CareSurchargePaise:  careSurchargePaise,
		TotalFarePaise:      totalFarePaise,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(bill)
}

// HandleDriverConfirmPayment handles POST /api/v1/driver/orders/{id}/confirm-payment
func (h *GatewayHandler) HandleDriverConfirmPayment(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}

	orderID := r.PathValue("id")
	if orderID == "" {
		http.Error(w, "missing_order_id", http.StatusBadRequest)
		return
	}

	var req struct {
		PaymentMethod string   `json:"payment_method"` // "UPI" or "CASH"
		RiderRating   int      `json:"rider_rating"`
		Tags          []string `json:"tags"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// Idempotency check: verify if ledger splits have already been posted
	idempotencyKey := fmt.Sprintf("idempotency:confirm:%s", orderID)
	setSuccess, err := h.clusterClient.SetNX(ctx, idempotencyKey, "PROCESSING", 10*time.Minute).Result()
	if err != nil {
		http.Error(w, "cache_verification_failure", http.StatusInternalServerError)
		return
	}
	if !setSuccess {
		status, _ := h.clusterClient.Get(ctx, idempotencyKey).Result()
		if status == "SUCCESS" {
			writeJSONResponse(w, http.StatusOK, map[string]interface{}{"success": true, "message": "payment_already_confirmed"})
			return
		}
		http.Error(w, "payment_confirmation_in_flight", http.StatusConflict)
		return
	}

	// Remove lock on failure
	var processStatus string
	defer func() {
		if processStatus != "SUCCESS" {
			_ = h.clusterClient.Del(context.Background(), idempotencyKey)
		}
	}()

	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		log.Printf("[CONFIRM_PAYMENT] Transaction begin failed: %v", err)
		http.Error(w, "transaction_failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// Fetch order details
	var currentStatus string
	var assignedDriverID *string
	var cityPrefix string
	var baseFarePaise int64
	var waitingStartedAt *time.Time
	var pickedUpAt *time.Time
	var completedAt *time.Time
	query := `
		SELECT status::text, assigned_driver_id::text, city_prefix, base_fare_paise, waiting_started_at, picked_up_at, completed_at
		FROM orders 
		WHERE id = $1::uuid 
		FOR UPDATE
	`
	err = tx.QueryRow(ctx, query, orderID).Scan(
		&currentStatus, &assignedDriverID, &cityPrefix, &baseFarePaise, &waitingStartedAt, &pickedUpAt, &completedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "order_not_found", http.StatusNotFound)
			return
		}
		http.Error(w, "database_read_exception", http.StatusInternalServerError)
		return
	}

	if currentStatus != "COMPLETED" {
		http.Error(w, fmt.Sprintf("invalid_state: expected COMPLETED, got %s", currentStatus), http.StatusConflict)
		return
	}
	if assignedDriverID == nil || *assignedDriverID != driverID {
		http.Error(w, "forbidden: driver identity mismatch", http.StatusForbidden)
		return
	}

	// Fetch Odometer checkpoints to compute distance
	var startOdo, endOdo int
	err = tx.QueryRow(ctx, `
		SELECT 
			COALESCE((SELECT odometer_value FROM trip_odometer_checkpoints WHERE order_id = $1::uuid AND checkpoint_type = 'START'), 0),
			COALESCE((SELECT odometer_value FROM trip_odometer_checkpoints WHERE order_id = $1::uuid AND checkpoint_type = 'END'), 0)
	`, orderID).Scan(&startOdo, &endOdo)
	if err != nil {
		log.Printf("[CONFIRM_PAYMENT] Failed reading checkpoints: %v", err)
	}

	actualKM := float64(endOdo - startOdo)
	extraKM := math.Max(0, actualKM-15.0)
	distanceChargePaise := int64(extraKM * 1800.0)

	waitMinutes := 0
	if waitingStartedAt != nil && pickedUpAt != nil {
		waitMinutes = int(pickedUpAt.Sub(*waitingStartedAt).Minutes())
	}
	waitChargePaise := int64(0)
	if waitMinutes > 5 {
		waitChargePaise = int64(waitMinutes-5) * 200
	}

	overtimeMinutes := 0
	if pickedUpAt != nil && completedAt != nil {
		overtimeMinutes = int(completedAt.Sub(*pickedUpAt).Minutes())
	}
	overtimeChargePaise := int64(overtimeMinutes) * 50

	// Query events for tolls and parking
	var tollsPaise, parkingPaise int64
	err = tx.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN event_type IN ('ADD_TOLL', 'toll_added') THEN amount_paise ELSE 0 END), 0),
		       COALESCE(SUM(CASE WHEN event_type IN ('ADD_STOP', 'parking_added', 'waiting_added') THEN amount_paise ELSE 0 END), 0)
		FROM order_events
		WHERE order_id = $1::uuid
	`, orderID).Scan(&tollsPaise, &parkingPaise)

	nightSurgePaise := int64(5000)
	careSurchargePaise := int64(1500)

	nonTollFarePaise := baseFarePaise + distanceChargePaise + waitChargePaise + overtimeChargePaise + nightSurgePaise + careSurchargePaise
	totalFarePaise := nonTollFarePaise + tollsPaise + parkingPaise

	// 1. Insert record into payment_intents
	paymentIntentID := fmt.Sprintf("pi_confirm_%d_%s", time.Now().Unix(), orderID[:8])
	paymentIntentQuery := `
		INSERT INTO payment_intents (id, order_id, amount_paise, currency, payment_status, provider_type, idempotency_key, created_at, updated_at)
		VALUES ($1, $2::uuid, $3, 'INR', 'SUCCEEDED', $4, $5, NOW(), NOW())
		ON CONFLICT (id) DO NOTHING
	`
	_, err = tx.Exec(ctx, paymentIntentQuery, paymentIntentID, orderID, totalFarePaise, req.PaymentMethod, orderID)
	if err != nil {
		log.Printf("[CONFIRM_PAYMENT] Failed inserting payment intent: %v", err)
		http.Error(w, "payment_intent_failed", http.StatusInternalServerError)
		return
	}

	// 2. Post double-entry financial ledger splits
	platformCommissionPaise := (nonTollFarePaise * 20) / 100
	driverEarningsPaise := nonTollFarePaise - platformCommissionPaise

	ledgerInsertQuery := `
		INSERT INTO financial_ledger_entries (order_id, city_prefix, regional_settlement_zone, account_type, entry_type, amount_paise, description, created_at)
		VALUES ($1::uuid, $2, $2, $3, $4, $5, $6, NOW());
	`

	// Leg A: Full Rider Outflow Debit
	_, err = tx.Exec(ctx, ledgerInsertQuery, orderID, cityPrefix, "RIDER_EXTERNAL_PAYMENT", "DEBIT", totalFarePaise, fmt.Sprintf("Rider payment settled via %s", req.PaymentMethod))
	if err != nil {
		log.Printf("[CONFIRM_PAYMENT] Leg A failed: %v", err)
		http.Error(w, "ledger_write_failed", http.StatusInternalServerError)
		return
	}

	// Leg B: Net Driver Share Credit
	_, err = tx.Exec(ctx, ledgerInsertQuery, orderID, cityPrefix, "DRIVER_EARNINGS", "CREDIT", driverEarningsPaise, "Driver partner transaction payout share allocation (80% of fare splits)")
	if err != nil {
		log.Printf("[CONFIRM_PAYMENT] Leg B failed: %v", err)
		http.Error(w, "ledger_write_failed", http.StatusInternalServerError)
		return
	}

	// Leg C: Corporate Commission Take-Rate Credit
	_, err = tx.Exec(ctx, ledgerInsertQuery, orderID, cityPrefix, "PLATFORM_COMMISSION", "CREDIT", platformCommissionPaise, "Platform take-rate corporate matches commission fee (20%)")
	if err != nil {
		log.Printf("[CONFIRM_PAYMENT] Leg C failed: %v", err)
		http.Error(w, "ledger_write_failed", http.StatusInternalServerError)
		return
	}

	// 3. Clear active trip Redis keys
	activeTripKey := fmt.Sprintf("driver:active:trip:%s", driverID)
	_ = h.clusterClient.Del(ctx, activeTripKey)

	// Insert audit log
	auditQuery := `INSERT INTO audit_logs (driver_id, action) VALUES ($1::uuid, $2)`
	actionStr := fmt.Sprintf("PAYMENT_CONFIRMED: order_id=%s, method=%s, amount=₹%.2f, rating=%d", orderID, req.PaymentMethod, float64(totalFarePaise)/100.0, req.RiderRating)
	_, _ = tx.Exec(ctx, auditQuery, driverID, actionStr)

	if err := tx.Commit(ctx); err != nil {
		log.Printf("[CONFIRM_PAYMENT] Transaction commit failed: %v", err)
		http.Error(w, "commit_failed", http.StatusInternalServerError)
		return
	}

	processStatus = "SUCCESS"
	_ = h.clusterClient.Set(ctx, idempotencyKey, "SUCCESS", 24*time.Hour)

	writeJSONResponse(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Payment confirmed and financial ledger splits posted",
	})
}
