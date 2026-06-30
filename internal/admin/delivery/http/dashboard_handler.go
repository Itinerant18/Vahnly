package http

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type DashboardHandler struct {
	dbPool          *pgxpool.Pool
	redisClient     *redis.ClusterClient
	logger          *log.Logger
	incidentHandler *IncidentAdminHandler
}

func NewDashboardHandler(dbPool *pgxpool.Pool, redisClient *redis.ClusterClient, logger *log.Logger, incidentHandler *IncidentAdminHandler) *DashboardHandler {
	return &DashboardHandler{
		dbPool:          dbPool,
		redisClient:     redisClient,
		logger:          logger,
		incidentHandler: incidentHandler,
	}
}

type KPIResponse struct {
	TotalTrips          int64   `json:"total_trips"`
	ActiveTrips         int64   `json:"active_trips"`
	NewRiderSignups     int64   `json:"new_rider_signups"`
	NewDriverSignups    int64   `json:"new_driver_signups"`
	OnlineDrivers       int64   `json:"online_drivers"`
	TotalDrivers        int64   `json:"total_drivers"`
	CancellationRate    float64 `json:"cancellation_rate"`
	AvgEtaMinutes       float64 `json:"avg_eta_minutes"`
	AvgRating           float64 `json:"avg_rating"`
	GrossRevenue        int64   `json:"gross_revenue"`
	NetRevenue          int64   `json:"net_revenue"`
	PromoCost           int64   `json:"promo_cost"`
	TotalTripsDelta     float64 `json:"total_trips_delta"`
	ActiveTripsChange   int64   `json:"active_trips_change"`
	NewSignupsDelta     float64 `json:"new_signups_delta"`
	OnlineDriversDelta  float64 `json:"online_drivers_delta"`
	CancellationDelta   float64 `json:"cancellation_delta"`
	RevenueDelta        float64 `json:"revenue_delta"`
	// Operational health KPIs (best-effort; 0 when the backing table is absent).
	SOS24h                 int64 `json:"sos_24h"`
	OutstandingPayoutsPaise int64 `json:"outstanding_payouts_paise"`
	OpenTickets            int64 `json:"open_tickets"`
	SLABreaches            int64 `json:"sla_breaches"`
	PromoCostPaise         int64 `json:"promo_cost_paise"`
}

type ChartPoint struct {
	Label string  `json:"label"`
	Value float64 `json:"value"`
}

type ChartsResponse struct {
	TripsChart   []ChartPoint `json:"trips_chart"`
	RevenueChart []ChartPoint `json:"revenue_chart"`
	CancelChart  []ChartPoint `json:"cancel_chart"`
	DriversChart []ChartPoint `json:"drivers_chart"`
}

type AlertResponseItem struct {
	ID        string    `json:"id"`
	Timestamp string    `json:"timestamp"`
	Type      string    `json:"type"`
	Message   string    `json:"message"`
	Severity  string    `json:"severity"`
	CreatedAt time.Time `json:"-"`
}

func (h *DashboardHandler) HandleGetDashboardKPIs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	rRange := r.URL.Query().Get("range")
	if rRange == "" {
		rRange = "today"
	}
	if rRange != "today" && rRange != "week" && rRange != "month" {
		http.Error(w, "invalid_range", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	currentStart, previousStart, previousEnd := getTimeRanges(rRange)

	// total_trips
	var totalTrips int64
	err := h.dbPool.QueryRow(ctx, "SELECT COUNT(*) FROM orders WHERE created_at >= $1", currentStart).Scan(&totalTrips)
	if err != nil {
		h.logger.Printf("Failed to get total_trips: %v", err)
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}

	var prevTotalTrips int64
	err = h.dbPool.QueryRow(ctx, "SELECT COUNT(*) FROM orders WHERE created_at >= $1 AND created_at < $2", previousStart, previousEnd).Scan(&prevTotalTrips)
	if err != nil {
		h.logger.Printf("Failed to get prev_total_trips: %v", err)
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}

	// active_trips
	var activeTrips int64
	err = h.dbPool.QueryRow(ctx, "SELECT COUNT(*) FROM orders WHERE status IN ('ASSIGNED','EN_ROUTE_TO_PICKUP','DELIVERING')").Scan(&activeTrips)
	if err != nil {
		h.logger.Printf("Failed to get active_trips: %v", err)
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}

	// new_rider_signups (proxy: distinct customer_id)
	var newRiders int64
	err = h.dbPool.QueryRow(ctx, "SELECT COUNT(DISTINCT customer_id) FROM orders WHERE created_at >= $1", currentStart).Scan(&newRiders)
	if err != nil {
		h.logger.Printf("Failed to get new_riders: %v", err)
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}

	var prevNewRiders int64
	err = h.dbPool.QueryRow(ctx, "SELECT COUNT(DISTINCT customer_id) FROM orders WHERE created_at >= $1 AND created_at < $2", previousStart, previousEnd).Scan(&prevNewRiders)
	if err != nil {
		h.logger.Printf("Failed to get prev_new_riders: %v", err)
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}

	// new_driver_signups
	var newDrivers int64
	err = h.dbPool.QueryRow(ctx, "SELECT COUNT(*) FROM drivers WHERE created_at >= $1", currentStart).Scan(&newDrivers)
	if err != nil {
		h.logger.Printf("Failed to get new_drivers: %v", err)
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}

	var prevNewDrivers int64
	err = h.dbPool.QueryRow(ctx, "SELECT COUNT(*) FROM drivers WHERE created_at >= $1 AND created_at < $2", previousStart, previousEnd).Scan(&prevNewDrivers)
	if err != nil {
		h.logger.Printf("Failed to get prev_new_drivers: %v", err)
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}

	// online_drivers
	var onlineDrivers int64
	err = h.dbPool.QueryRow(ctx, "SELECT COUNT(*) FROM drivers WHERE current_state != 'OFFLINE'::driver_state_enum").Scan(&onlineDrivers)
	if err != nil {
		h.logger.Printf("Failed to get online_drivers: %v", err)
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}

	// total_drivers
	var totalDrivers int64
	err = h.dbPool.QueryRow(ctx, "SELECT COUNT(*) FROM drivers").Scan(&totalDrivers)
	if err != nil {
		h.logger.Printf("Failed to get total_drivers: %v", err)
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}

	// cancellation_rate
	var cancellationRate float64
	err = h.dbPool.QueryRow(ctx, `
		SELECT (CASE WHEN total > 0 THEN (cancelled::float / total::float) * 100 ELSE 0 END)
		FROM (
			SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'CANCELLED'::order_status_enum) as cancelled
			FROM orders
			WHERE created_at >= $1
		) sub
	`, currentStart).Scan(&cancellationRate)
	if err != nil {
		h.logger.Printf("Failed to get cancellation_rate: %v", err)
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}

	var prevCancellationRate float64
	err = h.dbPool.QueryRow(ctx, `
		SELECT (CASE WHEN total > 0 THEN (cancelled::float / total::float) * 100 ELSE 0 END)
		FROM (
			SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'CANCELLED'::order_status_enum) as cancelled
			FROM orders
			WHERE created_at >= $1 AND created_at < $2
		) sub
	`, previousStart, previousEnd).Scan(&prevCancellationRate)
	if err != nil {
		h.logger.Printf("Failed to get prev_cancellation_rate: %v", err)
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}

	// avg_eta_minutes
	var avgEtaMinutes float64
	err = h.dbPool.QueryRow(ctx, `
		SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (assigned_at - created_at)) / 60.0), 0)
		FROM orders
		WHERE assigned_at IS NOT NULL AND created_at >= $1
	`, currentStart).Scan(&avgEtaMinutes)
	if err != nil {
		h.logger.Printf("Failed to get avg_eta_minutes: %v", err)
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}

	// gross_revenue
	var grossRevenue int64
	err = h.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_paise), 0)
		FROM financial_ledger_entries
		WHERE entry_type = 'CREDIT' AND account_type = 'RIDER_EXTERNAL_PAYMENT' AND created_at >= $1
	`, currentStart).Scan(&grossRevenue)
	if err != nil {
		h.logger.Printf("Failed to get gross_revenue: %v", err)
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}

	var prevGrossRevenue int64
	err = h.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_paise), 0)
		FROM financial_ledger_entries
		WHERE entry_type = 'CREDIT' AND account_type = 'RIDER_EXTERNAL_PAYMENT' AND created_at >= $1 AND created_at < $2
	`, previousStart, previousEnd).Scan(&prevGrossRevenue)
	if err != nil {
		h.logger.Printf("Failed to get prev_gross_revenue: %v", err)
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}

	// net_revenue
	var netRevenue int64
	err = h.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_paise), 0)
		FROM financial_ledger_entries
		WHERE entry_type = 'CREDIT' AND account_type = 'PLATFORM_COMMISSION' AND created_at >= $1
	`, currentStart).Scan(&netRevenue)
	if err != nil {
		h.logger.Printf("Failed to get net_revenue: %v", err)
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}

	// promo_cost
	var promoCost int64
	err = h.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_paise), 0)
		FROM financial_ledger_entries
		WHERE entry_type = 'DEBIT' AND account_type = 'PLATFORM_COMMISSION' AND created_at >= $1
	`, currentStart).Scan(&promoCost)
	if err != nil {
		h.logger.Printf("Failed to get promo_cost: %v", err)
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	// promoCost is the real query value above; no 5%-of-revenue fabrication fallback.

	// Calculations
	totalTripsDelta := percentageDelta(totalTrips, prevTotalTrips)

	// No KPI snapshot/time-series table exists, so there is no real prior value to diff
	// active-trips / online-drivers against — report 0 rather than inventing an offset.
	activeTripsChange := int64(0)

	newSignups := newRiders + newDrivers
	prevNewSignups := prevNewRiders + prevNewDrivers
	newSignupsDelta := percentageDelta(newSignups, prevNewSignups)

	onlineDriversDelta := percentageDelta(onlineDrivers, onlineDrivers)

	cancellationDelta := cancellationRate - prevCancellationRate
	revenueDelta := percentageDelta(grossRevenue, prevGrossRevenue)

	// Operational health KPIs. Each is best-effort: a missing table leaves the value 0.
	var sos24h, outstandingPayouts, openTickets, slaBreaches, promoCostPaise int64
	_ = h.dbPool.QueryRow(ctx,
		`SELECT COUNT(*) FROM safety_sos_alerts WHERE created_at >= NOW() - INTERVAL '24 hours'`).Scan(&sos24h)
	_ = h.dbPool.QueryRow(ctx,
		`SELECT COALESCE(SUM(net_amount_paise), 0) FROM payout_requests WHERE status IN ('PENDING','APPROVED','HELD')`).Scan(&outstandingPayouts)
	_ = h.dbPool.QueryRow(ctx,
		`SELECT COUNT(*) FROM support_tickets WHERE status IN ('OPEN','PENDING')`).Scan(&openTickets)
	_ = h.dbPool.QueryRow(ctx,
		`SELECT COUNT(*) FROM support_tickets WHERE status IN ('OPEN','PENDING') AND sla_deadline < NOW()`).Scan(&slaBreaches)
	_ = h.dbPool.QueryRow(ctx,
		`SELECT COALESCE(SUM(promo_discount_paise), 0) FROM orders WHERE created_at >= $1`, currentStart).Scan(&promoCostPaise)
	var avgRating float64
	_ = h.dbPool.QueryRow(ctx,
		`SELECT COALESCE(AVG(rating), 0) FROM drivers WHERE rating > 0`).Scan(&avgRating)

	kpis := KPIResponse{
		TotalTrips:          totalTrips,
		ActiveTrips:         activeTrips,
		NewRiderSignups:     newRiders,
		NewDriverSignups:    newDrivers,
		OnlineDrivers:       onlineDrivers,
		TotalDrivers:        totalDrivers,
		CancellationRate:    cancellationRate,
		AvgEtaMinutes:       avgEtaMinutes,
		AvgRating:           avgRating,
		GrossRevenue:        grossRevenue,
		NetRevenue:          netRevenue,
		PromoCost:           promoCost,
		TotalTripsDelta:     totalTripsDelta,
		ActiveTripsChange:   activeTripsChange,
		NewSignupsDelta:     newSignupsDelta,
		OnlineDriversDelta:  onlineDriversDelta,
		CancellationDelta:   cancellationDelta,
		RevenueDelta:        revenueDelta,
		SOS24h:                  sos24h,
		OutstandingPayoutsPaise: outstandingPayouts,
		OpenTickets:             openTickets,
		SLABreaches:             slaBreaches,
		PromoCostPaise:          promoCostPaise,
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(kpis); err != nil {
		h.logger.Printf("Failed to encode KPIs: %v", err)
	}
}

func (h *DashboardHandler) HandleGetDashboardCharts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	rRange := r.URL.Query().Get("range")
	if rRange == "" {
		rRange = "today"
	}
	if rRange != "today" && rRange != "week" && rRange != "month" {
		http.Error(w, "invalid_range", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	currentStart, _, _ := getTimeRanges(rRange)

	var labels []string
	if rRange == "week" {
		labels = []string{"Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"}
	} else if rRange == "month" {
		for i := 30; i >= 1; i-- {
			t := time.Now().UTC().AddDate(0, 0, -i)
			labels = append(labels, strconv.Itoa(t.Day()))
		}
	} else {
		for h := 0; h < 24; h++ {
			labels = append(labels, fmt.Sprintf("%02d:00", h))
		}
	}

	tripsMap := make(map[string]float64)
	revMap := make(map[string]float64)
	cancelMap := make(map[string]float64)
	driversMap := make(map[string]float64)

	// Fetch Trips
	var queryTrips string
	if rRange == "week" {
		queryTrips = `
			SELECT TRIM(TO_CHAR(created_at, 'Dy')) as lbl, COUNT(*)::float
			FROM orders
			WHERE created_at >= $1
			GROUP BY lbl
		`
	} else if rRange == "month" {
		queryTrips = `
			SELECT EXTRACT(DAY FROM created_at)::text as lbl, COUNT(*)::float
			FROM orders
			WHERE created_at >= $1
			GROUP BY lbl
		`
	} else {
		queryTrips = `
			SELECT TO_CHAR(created_at, 'HH24') || ':00' as lbl, COUNT(*)::float
			FROM orders
			WHERE created_at >= $1
			GROUP BY lbl
		`
	}

	rows, err := h.dbPool.Query(ctx, queryTrips, currentStart)
	if err != nil {
		h.logger.Printf("Failed to query trips chart: %v", err)
	} else {
		defer rows.Close()
		for rows.Next() {
			var lbl string
			var val float64
			if err := rows.Scan(&lbl, &val); err == nil {
				tripsMap[lbl] = val
			}
		}
	}

	// Fetch Revenue
	var queryRevenue string
	if rRange == "week" {
		queryRevenue = `
			SELECT TRIM(TO_CHAR(created_at, 'Dy')) as lbl, COALESCE(SUM(amount_paise), 0)::float
			FROM financial_ledger_entries
			WHERE entry_type = 'CREDIT' AND account_type = 'RIDER_EXTERNAL_PAYMENT' AND created_at >= $1
			GROUP BY lbl
		`
	} else if rRange == "month" {
		queryRevenue = `
			SELECT EXTRACT(DAY FROM created_at)::text as lbl, COALESCE(SUM(amount_paise), 0)::float
			FROM financial_ledger_entries
			WHERE entry_type = 'CREDIT' AND account_type = 'RIDER_EXTERNAL_PAYMENT' AND created_at >= $1
			GROUP BY lbl
		`
	} else {
		queryRevenue = `
			SELECT TO_CHAR(created_at, 'HH24') || ':00' as lbl, COALESCE(SUM(amount_paise), 0)::float
			FROM financial_ledger_entries
			WHERE entry_type = 'CREDIT' AND account_type = 'RIDER_EXTERNAL_PAYMENT' AND created_at >= $1
			GROUP BY lbl
		`
	}

	rowsRev, err := h.dbPool.Query(ctx, queryRevenue, currentStart)
	if err != nil {
		h.logger.Printf("Failed to query revenue chart: %v", err)
	} else {
		defer rowsRev.Close()
		for rowsRev.Next() {
			var lbl string
			var val float64
			if err := rowsRev.Scan(&lbl, &val); err == nil {
				revMap[lbl] = val
			}
		}
	}

	// Fetch Cancellation Rate
	var queryCancel string
	if rRange == "week" {
		queryCancel = `
			SELECT TRIM(TO_CHAR(created_at, 'Dy')) as lbl, 
			       (CASE WHEN COUNT(*) > 0 THEN (COUNT(*) FILTER (WHERE status = 'CANCELLED'::order_status_enum))::float / COUNT(*)::float * 100 ELSE 0 END) as rate
			FROM orders
			WHERE created_at >= $1
			GROUP BY lbl
		`
	} else if rRange == "month" {
		queryCancel = `
			SELECT EXTRACT(DAY FROM created_at)::text as lbl, 
			       (CASE WHEN COUNT(*) > 0 THEN (COUNT(*) FILTER (WHERE status = 'CANCELLED'::order_status_enum))::float / COUNT(*)::float * 100 ELSE 0 END) as rate
			FROM orders
			WHERE created_at >= $1
			GROUP BY lbl
		`
	} else {
		queryCancel = `
			SELECT TO_CHAR(created_at, 'HH24') || ':00' as lbl, 
			       (CASE WHEN COUNT(*) > 0 THEN (COUNT(*) FILTER (WHERE status = 'CANCELLED'::order_status_enum))::float / COUNT(*)::float * 100 ELSE 0 END) as rate
			FROM orders
			WHERE created_at >= $1
			GROUP BY lbl
		`
	}

	rowsCancel, err := h.dbPool.Query(ctx, queryCancel, currentStart)
	if err != nil {
		h.logger.Printf("Failed to query cancel chart: %v", err)
	} else {
		defer rowsCancel.Close()
		for rowsCancel.Next() {
			var lbl string
			var val float64
			if err := rowsCancel.Scan(&lbl, &val); err == nil {
				cancelMap[lbl] = val
			}
		}
	}

	// Fetch Drivers
	var queryDrivers string
	if rRange == "week" {
		queryDrivers = `
			SELECT TRIM(TO_CHAR(created_at, 'Dy')) as lbl, COUNT(DISTINCT assigned_driver_id)::float
			FROM orders
			WHERE created_at >= $1 AND assigned_driver_id IS NOT NULL
			GROUP BY lbl
		`
	} else if rRange == "month" {
		queryDrivers = `
			SELECT EXTRACT(DAY FROM created_at)::text as lbl, COUNT(DISTINCT assigned_driver_id)::float
			FROM orders
			WHERE created_at >= $1 AND assigned_driver_id IS NOT NULL
			GROUP BY lbl
		`
	} else {
		queryDrivers = `
			SELECT TO_CHAR(created_at, 'HH24') || ':00' as lbl, COUNT(DISTINCT assigned_driver_id)::float
			FROM orders
			WHERE created_at >= $1 AND assigned_driver_id IS NOT NULL
			GROUP BY lbl
		`
	}

	rowsDrivers, err := h.dbPool.Query(ctx, queryDrivers, currentStart)
	if err != nil {
		h.logger.Printf("Failed to query drivers chart: %v", err)
	} else {
		defer rowsDrivers.Close()
		for rowsDrivers.Next() {
			var lbl string
			var val float64
			if err := rowsDrivers.Scan(&lbl, &val); err == nil {
				driversMap[lbl] = val
			}
		}
	}

	// Build responses
	resp := ChartsResponse{
		TripsChart:   make([]ChartPoint, len(labels)),
		RevenueChart: make([]ChartPoint, len(labels)),
		CancelChart:  make([]ChartPoint, len(labels)),
		DriversChart: make([]ChartPoint, len(labels)),
	}

	for i, label := range labels {
		resp.TripsChart[i] = ChartPoint{Label: label, Value: tripsMap[label]}
		resp.RevenueChart[i] = ChartPoint{Label: label, Value: revMap[label]}
		resp.CancelChart[i] = ChartPoint{Label: label, Value: cancelMap[label]}
		resp.DriversChart[i] = ChartPoint{Label: label, Value: driversMap[label]}
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		h.logger.Printf("Failed to encode ChartsResponse: %v", err)
	}
}

func (h *DashboardHandler) HandleGetDashboardAlerts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	limitStr := r.URL.Query().Get("limit")
	limit := 15
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
			limit = l
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var alertsList []AlertResponseItem

	// 1. SOS alerts from IncidentAdminHandler
	if h.incidentHandler != nil {
		incidents := h.incidentHandler.GetIncidents()
		for _, inc := range incidents {
			if inc.IncidentType == "SOS" {
				shortID := ""
				if len(inc.OrderID) >= 4 {
					shortID = inc.OrderID[0:4]
				} else {
					shortID = inc.OrderID
				}
				alertsList = append(alertsList, AlertResponseItem{
					ID:        "ALR-SOS-" + shortID,
					Timestamp: "1 min ago",
					Type:      "sos",
					Message:   fmt.Sprintf("SOS triggered for trip %s in %s", inc.OrderID, inc.CityPrefix),
					Severity:  "critical",
					CreatedAt: time.Now().Add(-1 * time.Minute),
				})
			}
		}
	}

	// 2. Cancellation alerts
	queryCancellations := `
		SELECT id, city_prefix, created_at 
		FROM orders
		WHERE status = 'CANCELLED'::order_status_enum AND created_at >= NOW() - INTERVAL '24 hours'
		ORDER BY created_at DESC 
		LIMIT $1
	`
	rowsCancel, err := h.dbPool.Query(ctx, queryCancellations, limit)
	if err != nil {
		h.logger.Printf("Failed to query cancellation alerts: %v", err)
	} else {
		defer rowsCancel.Close()
		for rowsCancel.Next() {
			var id, cityPrefix string
			var createdAt time.Time
			if err := rowsCancel.Scan(&id, &cityPrefix, &createdAt); err == nil {
				shortID := ""
				if len(id) >= 4 {
					shortID = id[len(id)-4:]
				} else {
					shortID = id
				}
				alertsList = append(alertsList, AlertResponseItem{
					ID:        "ALR-CNC-" + shortID,
					Timestamp: relativeTime(createdAt),
					Type:      "cancellation",
					Message:   fmt.Sprintf("Trip TRP-%s-%s was cancelled", cityPrefix, strings.ToUpper(shortID)),
					Severity:  "warn",
					CreatedAt: createdAt,
				})
			}
		}
	}

	// 3. New driver alerts
	queryDrivers := `
		SELECT id, name, city_prefix, created_at 
		FROM drivers
		WHERE created_at >= NOW() - INTERVAL '24 hours'
		ORDER BY created_at DESC 
		LIMIT $1
	`
	rowsDriver, err := h.dbPool.Query(ctx, queryDrivers, limit)
	if err != nil {
		h.logger.Printf("Failed to query driver alerts: %v", err)
	} else {
		defer rowsDriver.Close()
		for rowsDriver.Next() {
			var id, name, cityPrefix string
			var createdAt time.Time
			if err := rowsDriver.Scan(&id, &name, &cityPrefix, &createdAt); err == nil {
				shortID := ""
				if len(id) >= 4 {
					shortID = id[len(id)-4:]
				} else {
					shortID = id
				}
				alertsList = append(alertsList, AlertResponseItem{
					ID:        "ALR-DRV-" + shortID,
					Timestamp: relativeTime(createdAt),
					Type:      "signup",
					Message:   fmt.Sprintf("New driver %s registered in %s", name, cityPrefix),
					Severity:  "info",
					CreatedAt: createdAt,
				})
			}
		}
	}

	// 4. Large financial transaction alerts
	queryLedger := `
		SELECT id, order_id, amount_paise, account_type, created_at 
		FROM financial_ledger_entries
		WHERE created_at >= NOW() - INTERVAL '24 hours' AND amount_paise > 50000
		ORDER BY created_at DESC 
		LIMIT $1
	`
	rowsLedger, err := h.dbPool.Query(ctx, queryLedger, limit)
	if err != nil {
		h.logger.Printf("Failed to query ledger alerts: %v", err)
	} else {
		defer rowsLedger.Close()
		for rowsLedger.Next() {
			var id int64
			var orderID, accountType string
			var amountPaise int64
			var createdAt time.Time
			if err := rowsLedger.Scan(&id, &orderID, &amountPaise, &accountType, &createdAt); err == nil {
				shortID := ""
				if len(orderID) >= 4 {
					shortID = orderID[len(orderID)-4:]
				} else {
					shortID = orderID
				}
				alertsList = append(alertsList, AlertResponseItem{
					ID:        fmt.Sprintf("ALR-LDG-%d", id),
					Timestamp: relativeTime(createdAt),
					Type:      "payout",
					Message:   fmt.Sprintf("Large transaction for order ...%s: ₹%.2f (%s)", shortID, float64(amountPaise)/100.0, accountType),
					Severity:  "info",
					CreatedAt: createdAt,
				})
			}
		}
	}

	sort.Slice(alertsList, func(i, j int) bool {
		return alertsList[i].CreatedAt.After(alertsList[j].CreatedAt)
	})

	if len(alertsList) > limit {
		alertsList = alertsList[:limit]
	}

	if alertsList == nil {
		alertsList = []AlertResponseItem{}
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{"alerts": alertsList}); err != nil {
		h.logger.Printf("Failed to encode alerts: %v", err)
	}
}

func (h *DashboardHandler) HandleGetRecentTrips(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	limitStr := r.URL.Query().Get("limit")
	limit := 10
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
			limit = l
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	query := `
		SELECT o.id, o.city_prefix, o.status::text, o.base_fare_paise, o.created_at, o.completed_at,
		       COALESCE(d.name, 'Unassigned') as driver_name
		FROM orders o
		LEFT JOIN drivers d ON o.assigned_driver_id = d.id
		ORDER BY o.created_at DESC
		LIMIT $1
	`
	rows, err := h.dbPool.Query(ctx, query, limit)
	if err != nil {
		h.logger.Printf("Failed to query recent trips: %v", err)
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type RecentTripItem struct {
		TripID      string  `json:"trip_id"`
		Rider       string  `json:"rider"`
		Driver      string  `json:"driver"`
		Status      string  `json:"status"`
		Amount      float64 `json:"amount"`
		DurationMin int     `json:"duration_min"`
		City        string  `json:"city"`
	}

	var trips []RecentTripItem
	for rows.Next() {
		var id, cityPrefix, status, driverName string
		var baseFarePaise int64
		var createdAt time.Time
		var completedAt *time.Time

		err := rows.Scan(&id, &cityPrefix, &status, &baseFarePaise, &createdAt, &completedAt, &driverName)
		if err != nil {
			h.logger.Printf("Failed to scan recent trip row: %v", err)
			continue
		}

		duration := 0
		if completedAt != nil {
			duration = int(completedAt.Sub(createdAt).Minutes())
		}

		last4 := ""
		if len(id) >= 4 {
			last4 = id[len(id)-4:]
		} else {
			last4 = id
		}
		tripID := fmt.Sprintf("TRP-%s-%s", cityPrefix, strings.ToUpper(last4))

		trips = append(trips, RecentTripItem{
			TripID:      tripID,
			Rider:       "Rider",
			Driver:      driverName,
			Status:      strings.ToLower(status),
			Amount:      float64(baseFarePaise) / 100.0,
			DurationMin: duration,
			City:        cityPrefix,
		})
	}

	if trips == nil {
		trips = []RecentTripItem{}
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{"trips": trips}); err != nil {
		h.logger.Printf("Failed to encode recent trips: %v", err)
	}
}

func getTimeRanges(rRange string) (time.Time, time.Time, time.Time) {
	now := time.Now().UTC()
	var currentStart, previousStart, previousEnd time.Time

	switch rRange {
	case "week":
		currentStart = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC).AddDate(0, 0, -7)
		previousStart = currentStart.AddDate(0, 0, -7)
		previousEnd = currentStart
	case "month":
		currentStart = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC).AddDate(0, 0, -30)
		previousStart = currentStart.AddDate(0, 0, -30)
		previousEnd = currentStart
	case "today":
		fallthrough
	default:
		currentStart = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
		previousStart = currentStart.AddDate(0, 0, -1)
		previousEnd = currentStart
	}
	return currentStart, previousStart, previousEnd
}

func relativeTime(t time.Time) string {
	d := time.Since(t)
	if d < time.Minute {
		return "just now"
	}
	if d < time.Hour {
		return fmt.Sprintf("%d min ago", int(d.Minutes()))
	}
	if d < 24*time.Hour {
		return fmt.Sprintf("%d hr ago", int(d.Hours()))
	}
	return fmt.Sprintf("%d days ago", int(d.Hours()/24))
}

func percentageDelta(current, previous int64) float64 {
	if previous == 0 {
		if current > 0 {
			return 100.0
		}
		return 0.0
	}
	return (float64(current-previous) / float64(previous)) * 100.0
}

