package http

import (
	"context"
	"net/http"
	"time"
)

// Rider detail-tab read endpoints, all scoped by the {id} rider path value. Each
// query is best-effort: if the underlying table does not exist (or errors) the tab
// returns an empty array/object with HTTP 200 so the frontend shows a clean empty
// state. Money values are paise (bigint).

// GET /api/v1/admin/riders/{id}/garage  (rider_garage)
func (h *AdminExtrasHandler) HandleRiderGarage(w http.ResponseWriter, r *http.Request) {
	id, ctx, cancel, ok := h.riderTabSetup(w, r)
	if !ok {
		return
	}
	defer cancel()

	type car struct {
		ID                string `json:"id"`
		Make              string `json:"make"`
		Model             string `json:"model"`
		Year              int    `json:"year"`
		CarType           string `json:"car_type"`
		Transmission      string `json:"transmission"`
		FuelType          string `json:"fuel_type"`
		RegistrationPlate string `json:"registration_plate"`
		Color             string `json:"color"`
		IsDefault         bool   `json:"is_default"`
		IsActive          bool   `json:"is_active"`
	}
	cars := make([]car, 0)
	if rows, err := h.dbPool.Query(ctx, `
		SELECT id::text, make, model, year, car_type, transmission,
		       COALESCE(fuel_type, ''), registration_plate, COALESCE(color, ''),
		       COALESCE(is_default, false), COALESCE(is_active, true)
		FROM rider_garage WHERE rider_id = $1::uuid
		ORDER BY is_default DESC, created_at DESC`, id); err == nil {
		for rows.Next() {
			var c car
			if err := rows.Scan(&c.ID, &c.Make, &c.Model, &c.Year, &c.CarType, &c.Transmission,
				&c.FuelType, &c.RegistrationPlate, &c.Color, &c.IsDefault, &c.IsActive); err == nil {
				cars = append(cars, c)
			}
		}
		rows.Close()
	}
	writeExtrasJSON(w, cars)
}

// GET /api/v1/admin/riders/{id}/payments  -> {transactions:[...]}
// Payment rows for the rider's orders (payment_intents joined via orders).
func (h *AdminExtrasHandler) HandleRiderPayments(w http.ResponseWriter, r *http.Request) {
	id, ctx, cancel, ok := h.riderTabSetup(w, r)
	if !ok {
		return
	}
	defer cancel()

	type txn struct {
		ID            string    `json:"id"`
		OrderID       string    `json:"order_id"`
		AmountPaise   int64     `json:"amount_paise"`
		Currency      string    `json:"currency"`
		PaymentStatus string    `json:"payment_status"`
		ProviderType  string    `json:"provider_type"`
		CreatedAt     time.Time `json:"created_at"`
	}
	transactions := make([]txn, 0)
	if rows, err := h.dbPool.Query(ctx, `
		SELECT pi.id, pi.order_id::text, pi.amount_paise, pi.currency,
		       pi.payment_status, pi.provider_type, pi.created_at
		FROM payment_intents pi
		JOIN orders o ON o.id = pi.order_id
		WHERE o.customer_id = $1::uuid OR o.rider_id = $1::uuid
		ORDER BY pi.created_at DESC
		LIMIT 200`, id); err == nil {
		for rows.Next() {
			var t txn
			if err := rows.Scan(&t.ID, &t.OrderID, &t.AmountPaise, &t.Currency,
				&t.PaymentStatus, &t.ProviderType, &t.CreatedAt); err == nil {
				transactions = append(transactions, t)
			}
		}
		rows.Close()
	}
	writeExtrasJSON(w, map[string]any{"transactions": transactions})
}

// GET /api/v1/admin/riders/{id}/promos  -> promo usages by the rider (promo_redemptions)
func (h *AdminExtrasHandler) HandleRiderPromos(w http.ResponseWriter, r *http.Request) {
	id, ctx, cancel, ok := h.riderTabSetup(w, r)
	if !ok {
		return
	}
	defer cancel()

	type usage struct {
		PromoCodeID   string    `json:"promo_code_id"`
		Code          string    `json:"code"`
		OrderID       string    `json:"order_id"`
		DiscountPaise int64     `json:"discount_paise"`
		CreatedAt     time.Time `json:"created_at"`
	}
	usages := make([]usage, 0)
	if rows, err := h.dbPool.Query(ctx, `
		SELECT pr.promo_code_id::text, COALESCE(p.code, ''), pr.order_id::text,
		       pr.discount_paise, pr.created_at
		FROM promo_redemptions pr
		LEFT JOIN promo_codes p ON p.id = pr.promo_code_id
		WHERE pr.rider_id = $1::uuid
		ORDER BY pr.created_at DESC
		LIMIT 200`, id); err == nil {
		for rows.Next() {
			var u usage
			if err := rows.Scan(&u.PromoCodeID, &u.Code, &u.OrderID, &u.DiscountPaise, &u.CreatedAt); err == nil {
				usages = append(usages, u)
			}
		}
		rows.Close()
	}
	writeExtrasJSON(w, usages)
}

// GET /api/v1/admin/riders/{id}/ratings  -> ratings involving the rider.
// Both the rating the rider gave the driver and the rating the driver gave the rider
// live on the orders row (rider_rating_for_driver / driver_rating_for_rider).
func (h *AdminExtrasHandler) HandleRiderRatings(w http.ResponseWriter, r *http.Request) {
	id, ctx, cancel, ok := h.riderTabSetup(w, r)
	if !ok {
		return
	}
	defer cancel()

	type rating struct {
		OrderID              string    `json:"order_id"`
		RiderRatingForDriver *int      `json:"rider_rating_for_driver"`
		DriverRatingForRider *int      `json:"driver_rating_for_rider"`
		RiderReviewComment   string    `json:"rider_review_comment"`
		DriverReviewComment  string    `json:"driver_review_comment"`
		CreatedAt            time.Time `json:"created_at"`
	}
	ratings := make([]rating, 0)
	if rows, err := h.dbPool.Query(ctx, `
		SELECT id::text, rider_rating_for_driver, driver_rating_for_rider,
		       COALESCE(rider_review_comment, ''), COALESCE(driver_review_comment, ''), created_at
		FROM orders
		WHERE (customer_id = $1::uuid OR rider_id = $1::uuid)
		  AND (rider_rating_for_driver IS NOT NULL OR driver_rating_for_rider IS NOT NULL)
		ORDER BY created_at DESC
		LIMIT 200`, id); err == nil {
		for rows.Next() {
			var rt rating
			if err := rows.Scan(&rt.OrderID, &rt.RiderRatingForDriver, &rt.DriverRatingForRider,
				&rt.RiderReviewComment, &rt.DriverReviewComment, &rt.CreatedAt); err == nil {
				ratings = append(ratings, rt)
			}
		}
		rows.Close()
	}
	writeExtrasJSON(w, ratings)
}

// GET /api/v1/admin/riders/{id}/risk  -> fraud/risk signals for the rider (fraud_events)
func (h *AdminExtrasHandler) HandleRiderRisk(w http.ResponseWriter, r *http.Request) {
	id, ctx, cancel, ok := h.riderTabSetup(w, r)
	if !ok {
		return
	}
	defer cancel()

	type signal struct {
		ID        string    `json:"id"`
		FraudType string    `json:"fraud_type"`
		Score     float64   `json:"score"`
		Status    string    `json:"status"`
		CreatedAt time.Time `json:"created_at"`
	}
	signals := make([]signal, 0)
	if rows, err := h.dbPool.Query(ctx, `
		SELECT id::text, fraud_type, score, status, created_at
		FROM fraud_events
		WHERE entity_type = 'RIDER' AND entity_id = $1
		ORDER BY created_at DESC
		LIMIT 200`, id); err == nil {
		for rows.Next() {
			var s signal
			if err := rows.Scan(&s.ID, &s.FraudType, &s.Score, &s.Status, &s.CreatedAt); err == nil {
				signals = append(signals, s)
			}
		}
		rows.Close()
	}
	writeExtrasJSON(w, signals)
}

// GET /api/v1/admin/riders/{id}/notifications  (rider_notifications)
func (h *AdminExtrasHandler) HandleRiderNotifications(w http.ResponseWriter, r *http.Request) {
	id, ctx, cancel, ok := h.riderTabSetup(w, r)
	if !ok {
		return
	}
	defer cancel()

	type notif struct {
		ID        string    `json:"id"`
		Type      string    `json:"type"`
		Title     string    `json:"title"`
		Body      string    `json:"body"`
		IsRead    bool      `json:"is_read"`
		CreatedAt time.Time `json:"created_at"`
	}
	notifs := make([]notif, 0)
	if rows, err := h.dbPool.Query(ctx, `
		SELECT id::text, type, title, body, COALESCE(is_read, false), created_at
		FROM rider_notifications WHERE rider_id = $1::uuid
		ORDER BY created_at DESC
		LIMIT 200`, id); err == nil {
		for rows.Next() {
			var n notif
			if err := rows.Scan(&n.ID, &n.Type, &n.Title, &n.Body, &n.IsRead, &n.CreatedAt); err == nil {
				notifs = append(notifs, n)
			}
		}
		rows.Close()
	}
	writeExtrasJSON(w, notifs)
}

// GET /api/v1/admin/riders/{id}/audit  -> audit log rows where the entity is this rider.
func (h *AdminExtrasHandler) HandleRiderAudit(w http.ResponseWriter, r *http.Request) {
	id, ctx, cancel, ok := h.riderTabSetup(w, r)
	if !ok {
		return
	}
	defer cancel()

	type entry struct {
		ID         string    `json:"id"`
		AdminEmail string    `json:"admin_email"`
		Action     string    `json:"action"`
		Details    string    `json:"details"`
		CreatedAt  time.Time `json:"created_at"`
	}
	entries := make([]entry, 0)
	if rows, err := h.dbPool.Query(ctx, `
		SELECT id::text, admin_email, action, COALESCE(details, ''), created_at
		FROM admin_audit_logs
		WHERE details ILIKE '%' || $1 || '%'
		ORDER BY created_at DESC
		LIMIT 200`, id); err == nil {
		for rows.Next() {
			var e entry
			if err := rows.Scan(&e.ID, &e.AdminEmail, &e.Action, &e.Details, &e.CreatedAt); err == nil {
				entries = append(entries, e)
			}
		}
		rows.Close()
	}
	writeExtrasJSON(w, entries)
}

// riderTabSetup validates the rider id path value and returns a bounded context.
func (h *AdminExtrasHandler) riderTabSetup(w http.ResponseWriter, r *http.Request) (string, context.Context, context.CancelFunc, bool) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return "", nil, nil, false
	}
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_rider_id", http.StatusBadRequest)
		return "", nil, nil, false
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	return id, ctx, cancel, true
}
