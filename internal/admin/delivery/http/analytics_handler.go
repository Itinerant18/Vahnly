package http

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type AnalyticsHandler struct {
	dbPool *pgxpool.Pool
	logger *log.Logger
}

func NewAnalyticsHandler(dbPool *pgxpool.Pool, logger *log.Logger) *AnalyticsHandler {
	return &AnalyticsHandler{dbPool: dbPool, logger: logger}
}

type TripDayStat struct {
	Day       string `json:"day"`
	Total     int64  `json:"total"`
	Completed int64  `json:"completed"`
	Cancelled int64  `json:"cancelled"`
}

type RevenueDayStat struct {
	Day          string `json:"day"`
	RevenuePaise int64  `json:"revenue_paise"`
}

type HourDemandStat struct {
	Hour   int   `json:"hour"`
	Demand int64 `json:"demand"`
}

type AnalyticsFunnel struct {
	Created   int64 `json:"created"`
	Assigned  int64 `json:"assigned"`
	Started   int64 `json:"started"`
	Completed int64 `json:"completed"`
	Cancelled int64 `json:"cancelled"`
}

type AnalyticsSummary struct {
	TotalTrips        int64   `json:"total_trips"`
	CompletedTrips    int64   `json:"completed_trips"`
	CancelledTrips    int64   `json:"cancelled_trips"`
	RevenuePaise      int64   `json:"revenue_paise"`
	CancellationRate  float64 `json:"cancellation_rate"`
	UniqueRiders      int64   `json:"unique_riders"`
	ActiveDrivers     int64   `json:"active_drivers"`
	AvgFarePaise      int64   `json:"avg_fare_paise"`
}

// HandleGetAnalyticsSummary returns KPI totals for a date range (?from=&to= in RFC3339)
func (h *AnalyticsHandler) HandleGetAnalyticsSummary(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	from, to := parseDateRange(r)
	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()

	var s AnalyticsSummary
	err := h.dbPool.QueryRow(ctx, `
		SELECT
			COUNT(*)                                                              AS total_trips,
			COUNT(*) FILTER (WHERE status = 'COMPLETED')                         AS completed_trips,
			COUNT(*) FILTER (WHERE status = 'CANCELLED')                         AS cancelled_trips,
			COALESCE(SUM(base_fare_paise) FILTER (WHERE status='COMPLETED'), 0)  AS revenue_paise,
			ROUND(100.0 * COUNT(*) FILTER (WHERE status='CANCELLED')
			      / NULLIF(COUNT(*), 0), 2)                                      AS cancellation_rate,
			COUNT(DISTINCT customer_id)                                           AS unique_riders,
			COALESCE(AVG(base_fare_paise) FILTER (WHERE status='COMPLETED'), 0)::BIGINT AS avg_fare_paise
		FROM orders
		WHERE created_at >= $1 AND created_at < $2`,
		from, to,
	).Scan(
		&s.TotalTrips, &s.CompletedTrips, &s.CancelledTrips,
		&s.RevenuePaise, &s.CancellationRate, &s.UniqueRiders, &s.AvgFarePaise,
	)
	if err != nil {
		h.logger.Printf("[ANALYTICS] summary query failed: %v", err)
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}

	// Active drivers (online in period via state changes is complex; use distinct assigned_driver_id as proxy)
	_ = h.dbPool.QueryRow(ctx, `
		SELECT COUNT(DISTINCT assigned_driver_id) FROM orders
		WHERE created_at >= $1 AND created_at < $2 AND assigned_driver_id IS NOT NULL`,
		from, to,
	).Scan(&s.ActiveDrivers)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(s)
}

// HandleGetTripsOverTime returns daily trip counts for a date range
func (h *AnalyticsHandler) HandleGetTripsOverTime(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	from, to := parseDateRange(r)
	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()

	rows, err := h.dbPool.Query(ctx, `
		SELECT
			DATE(created_at)::TEXT                                       AS day,
			COUNT(*)                                                      AS total,
			COUNT(*) FILTER (WHERE status = 'COMPLETED')                 AS completed,
			COUNT(*) FILTER (WHERE status = 'CANCELLED')                 AS cancelled
		FROM orders
		WHERE created_at >= $1 AND created_at < $2
		GROUP BY DATE(created_at)
		ORDER BY day ASC`, from, to)
	if err != nil {
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	stats := make([]TripDayStat, 0)
	for rows.Next() {
		var s TripDayStat
		if err := rows.Scan(&s.Day, &s.Total, &s.Completed, &s.Cancelled); err == nil {
			stats = append(stats, s)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"data": stats})
}

// HandleGetRevenueOverTime returns daily revenue totals for completed trips
func (h *AnalyticsHandler) HandleGetRevenueOverTime(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	from, to := parseDateRange(r)
	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()

	rows, err := h.dbPool.Query(ctx, `
		SELECT DATE(created_at)::TEXT AS day, COALESCE(SUM(base_fare_paise), 0) AS revenue_paise
		FROM orders
		WHERE status = 'COMPLETED' AND created_at >= $1 AND created_at < $2
		GROUP BY DATE(created_at)
		ORDER BY day ASC`, from, to)
	if err != nil {
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	stats := make([]RevenueDayStat, 0)
	for rows.Next() {
		var s RevenueDayStat
		if err := rows.Scan(&s.Day, &s.RevenuePaise); err == nil {
			stats = append(stats, s)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"data": stats})
}

// HandleGetDemandByHour returns trip demand bucketed by hour-of-day
func (h *AnalyticsHandler) HandleGetDemandByHour(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	from, to := parseDateRange(r)
	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()

	rows, err := h.dbPool.Query(ctx, `
		SELECT EXTRACT(HOUR FROM created_at)::INT AS hour, COUNT(*) AS demand
		FROM orders
		WHERE created_at >= $1 AND created_at < $2
		GROUP BY EXTRACT(HOUR FROM created_at)
		ORDER BY hour ASC`, from, to)
	if err != nil {
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	stats := make([]HourDemandStat, 0)
	for rows.Next() {
		var s HourDemandStat
		if err := rows.Scan(&s.Hour, &s.Demand); err == nil {
			stats = append(stats, s)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"data": stats})
}

// HandleGetFunnel returns the booking → completed conversion funnel
func (h *AnalyticsHandler) HandleGetFunnel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	from, to := parseDateRange(r)
	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()

	var f AnalyticsFunnel
	err := h.dbPool.QueryRow(ctx, `
		SELECT
			COUNT(*) AS created,
			COUNT(*) FILTER (WHERE status IN ('ASSIGNED','EN_ROUTE_TO_PICKUP','DELIVERING','COMPLETED')) AS assigned,
			COUNT(*) FILTER (WHERE status IN ('DELIVERING','COMPLETED'))                                  AS started,
			COUNT(*) FILTER (WHERE status = 'COMPLETED')                                                  AS completed,
			COUNT(*) FILTER (WHERE status = 'CANCELLED')                                                  AS cancelled
		FROM orders
		WHERE created_at >= $1 AND created_at < $2`, from, to,
	).Scan(&f.Created, &f.Assigned, &f.Started, &f.Completed, &f.Cancelled)
	if err != nil {
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(f)
}

// HandleGetTopCities returns trip counts grouped by city
func (h *AnalyticsHandler) HandleGetTopCities(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	from, to := parseDateRange(r)
	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()

	rows, err := h.dbPool.Query(ctx, `
		SELECT city_prefix, COUNT(*) AS total,
		       COALESCE(SUM(base_fare_paise) FILTER (WHERE status='COMPLETED'), 0) AS revenue_paise
		FROM orders
		WHERE created_at >= $1 AND created_at < $2
		GROUP BY city_prefix
		ORDER BY total DESC
		LIMIT 10`, from, to)
	if err != nil {
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type CityRow struct {
		City         string `json:"city"`
		Total        int64  `json:"total"`
		RevenuePaise int64  `json:"revenue_paise"`
	}
	result := make([]CityRow, 0)
	for rows.Next() {
		var row CityRow
		if err := rows.Scan(&row.City, &row.Total, &row.RevenuePaise); err == nil {
			result = append(result, row)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"data": result})
}

// HandleGetPrebuiltDashboard returns a named prebuilt dashboard's data payload.
// ?dashboard= one of: operations | growth | finance | driver-supply | marketing | safety
func (h *AnalyticsHandler) HandleGetPrebuiltDashboard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	dashboard := r.PathValue("dashboard")
	from, to := parseDateRange(r)
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	var result map[string]any

	switch dashboard {
	case "operations":
		var activeTrips, onlineDrivers, openSOS, openTickets int64
		_ = h.dbPool.QueryRow(ctx, `SELECT COUNT(*) FROM orders WHERE status IN ('ASSIGNED','EN_ROUTE_TO_PICKUP','DELIVERING')`).Scan(&activeTrips)
		_ = h.dbPool.QueryRow(ctx, `SELECT COUNT(*) FROM drivers WHERE current_state IN ('ONLINE_AVAILABLE','ONLINE_EN_ROUTE','ONLINE_DELIVERING')`).Scan(&onlineDrivers)
		_ = h.dbPool.QueryRow(ctx, `SELECT COUNT(*) FROM safety_sos_alerts WHERE status = 'ACTIVE'`).Scan(&openSOS)
		_ = h.dbPool.QueryRow(ctx, `SELECT COUNT(*) FROM support_tickets WHERE status = 'OPEN'`).Scan(&openTickets)
		var todayTrips, todayRevenue int64
		todayStart := time.Now().UTC().Truncate(24 * time.Hour)
		_ = h.dbPool.QueryRow(ctx, `SELECT COUNT(*), COALESCE(SUM(base_fare_paise) FILTER (WHERE status='COMPLETED'), 0) FROM orders WHERE created_at >= $1`, todayStart).Scan(&todayTrips, &todayRevenue)
		result = map[string]any{
			"active_trips":  activeTrips,
			"online_drivers": onlineDrivers,
			"open_sos":      openSOS,
			"open_tickets":  openTickets,
			"today_trips":   todayTrips,
			"today_revenue_paise": todayRevenue,
		}

	case "growth":
		var totalRiders, totalDrivers, totalTrips int64
		_ = h.dbPool.QueryRow(ctx, `SELECT COUNT(DISTINCT customer_id) FROM orders WHERE created_at >= $1 AND created_at < $2`, from, to).Scan(&totalRiders)
		_ = h.dbPool.QueryRow(ctx, `SELECT COUNT(*) FROM drivers WHERE created_at >= $1 AND created_at < $2`, from, to).Scan(&totalDrivers)
		_ = h.dbPool.QueryRow(ctx, `SELECT COUNT(*) FROM orders WHERE created_at >= $1 AND created_at < $2`, from, to).Scan(&totalTrips)
		// Daily new riders/drivers
		type DayGrowth struct {
			Day     string `json:"day"`
			Riders  int64  `json:"riders"`
			Drivers int64  `json:"drivers"`
		}
		// Derive daily riders from orders distinct customer per day
		rows, err := h.dbPool.Query(ctx, `
			SELECT DATE(created_at)::TEXT, COUNT(DISTINCT customer_id)
			FROM orders WHERE created_at >= $1 AND created_at < $2
			GROUP BY DATE(created_at) ORDER BY 1`, from, to)
		dailyRiders := make([]DayGrowth, 0)
		if err == nil {
			for rows.Next() {
				var g DayGrowth
				if err := rows.Scan(&g.Day, &g.Riders); err == nil {
					dailyRiders = append(dailyRiders, g)
				}
			}
			rows.Close()
		}
		result = map[string]any{
			"period_riders":  totalRiders,
			"period_drivers": totalDrivers,
			"period_trips":   totalTrips,
			"daily_riders":   dailyRiders,
		}

	case "finance":
		var grossRevenue, avgFare int64
		var completedTrips int64
		_ = h.dbPool.QueryRow(ctx, `
			SELECT COALESCE(SUM(base_fare_paise),0), COUNT(*), COALESCE(AVG(base_fare_paise),0)::BIGINT
			FROM orders WHERE status = 'COMPLETED' AND created_at >= $1 AND created_at < $2`, from, to,
		).Scan(&grossRevenue, &completedTrips, &avgFare)
		var pendingPayouts, paidPayouts int64
		_ = h.dbPool.QueryRow(ctx, `SELECT COALESCE(SUM(net_amount_paise),0) FROM payout_requests WHERE status = 'PENDING'`).Scan(&pendingPayouts)
		_ = h.dbPool.QueryRow(ctx, `SELECT COALESCE(SUM(net_amount_paise),0) FROM payout_requests WHERE status = 'PAID' AND created_at >= $1 AND created_at < $2`, from, to).Scan(&paidPayouts)
		result = map[string]any{
			"gross_revenue_paise":   grossRevenue,
			"completed_trips":       completedTrips,
			"avg_fare_paise":        avgFare,
			"pending_payouts_paise": pendingPayouts,
			"paid_payouts_paise":    paidPayouts,
		}

	case "driver-supply":
		type DriverStateCounts struct {
			Available  int64 `json:"available"`
			EnRoute    int64 `json:"en_route"`
			Delivering int64 `json:"delivering"`
			Offline    int64 `json:"offline"`
		}
		var sc DriverStateCounts
		_ = h.dbPool.QueryRow(ctx, `
			SELECT
				COUNT(*) FILTER (WHERE current_state = 'ONLINE_AVAILABLE')   AS available,
				COUNT(*) FILTER (WHERE current_state = 'ONLINE_EN_ROUTE')    AS en_route,
				COUNT(*) FILTER (WHERE current_state = 'ONLINE_DELIVERING')  AS delivering,
				COUNT(*) FILTER (WHERE current_state = 'OFFLINE')            AS offline
			FROM drivers`).Scan(&sc.Available, &sc.EnRoute, &sc.Delivering, &sc.Offline)
		// Drivers active in period
		var activeInPeriod int64
		_ = h.dbPool.QueryRow(ctx, `SELECT COUNT(DISTINCT assigned_driver_id) FROM orders WHERE created_at >= $1 AND created_at < $2`, from, to).Scan(&activeInPeriod)
		result = map[string]any{
			"state_counts":          sc,
			"active_drivers_period": activeInPeriod,
		}

	case "marketing":
		var activeCampaigns, totalSegments int64
		_ = h.dbPool.QueryRow(ctx, `SELECT COUNT(*) FROM marketing_campaigns WHERE status = 'ACTIVE'`).Scan(&activeCampaigns)
		_ = h.dbPool.QueryRow(ctx, `SELECT COUNT(*) FROM marketing_segments`).Scan(&totalSegments)
		var promoRedemptions int64
		_ = h.dbPool.QueryRow(ctx, `SELECT COUNT(*) FROM orders WHERE created_at >= $1 AND created_at < $2`, from, to).Scan(&promoRedemptions)
		result = map[string]any{
			"active_campaigns":   activeCampaigns,
			"total_segments":     totalSegments,
			"orders_in_period":   promoRedemptions,
		}

	case "safety":
		var activeSOS, totalIncidents, openIncidents, anomalies int64
		_ = h.dbPool.QueryRow(ctx, `SELECT COUNT(*) FROM safety_sos_alerts WHERE status = 'ACTIVE'`).Scan(&activeSOS)
		_ = h.dbPool.QueryRow(ctx, `SELECT COUNT(*) FROM safety_incidents WHERE created_at >= $1 AND created_at < $2`, from, to).Scan(&totalIncidents)
		_ = h.dbPool.QueryRow(ctx, `SELECT COUNT(*) FROM safety_incidents WHERE status IN ('OPEN','UNDER_INVESTIGATION')`).Scan(&openIncidents)
		_ = h.dbPool.QueryRow(ctx, `SELECT COUNT(*) FROM ride_check_anomalies WHERE status = 'PENDING'`).Scan(&anomalies)
		type CategoriesRow struct {
			Category string `json:"category"`
			Count    int64  `json:"count"`
		}
		rows, err := h.dbPool.Query(ctx, `
			SELECT category, COUNT(*) FROM safety_incidents
			WHERE created_at >= $1 AND created_at < $2 GROUP BY category ORDER BY 2 DESC`, from, to)
		categories := make([]CategoriesRow, 0)
		if err == nil {
			for rows.Next() {
				var cr CategoriesRow
				if err := rows.Scan(&cr.Category, &cr.Count); err == nil {
					categories = append(categories, cr)
				}
			}
			rows.Close()
		}
		result = map[string]any{
			"active_sos":      activeSOS,
			"total_incidents": totalIncidents,
			"open_incidents":  openIncidents,
			"anomalies":       anomalies,
			"by_category":     categories,
		}

	default:
		http.Error(w, "unknown_dashboard", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(result)
}

// HandleExportCSV exports a simple query result as CSV based on ?report= parameter
func (h *AnalyticsHandler) HandleExportCSV(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	report := r.URL.Query().Get("report")
	from, to := parseDateRange(r)
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	w.Header().Set("Content-Type", "text/csv; charset=utf-8")

	switch report {
	case "trips":
		w.Header().Set("Content-Disposition", `attachment; filename="trips_export.csv"`)
		_, _ = w.Write([]byte("order_id,city,status,fare_paise,surge_multiplier,created_at,completed_at\n"))
		rows, err := h.dbPool.Query(ctx, `
			SELECT id::TEXT, city_prefix, status::TEXT, base_fare_paise, surge_multiplier, created_at, COALESCE(completed_at::TEXT,'')
			FROM orders WHERE created_at >= $1 AND created_at < $2 ORDER BY created_at DESC LIMIT 5000`, from, to)
		if err == nil {
			for rows.Next() {
				var id, city, status, completedAt string
				var fare int64
				var surge float64
				var createdAt time.Time
				if err := rows.Scan(&id, &city, &status, &fare, &surge, &createdAt, &completedAt); err == nil {
					_, _ = fmt.Fprintf(w, "%s,%s,%s,%d,%.2f,%s,%s\n", id, city, status, fare, surge, createdAt.Format(time.RFC3339), completedAt)
				}
			}
			rows.Close()
		}
	case "revenue":
		w.Header().Set("Content-Disposition", `attachment; filename="revenue_export.csv"`)
		_, _ = w.Write([]byte("day,city,completed_trips,revenue_paise\n"))
		rows, err := h.dbPool.Query(ctx, `
			SELECT DATE(created_at)::TEXT, city_prefix, COUNT(*), COALESCE(SUM(base_fare_paise),0)
			FROM orders WHERE status = 'COMPLETED' AND created_at >= $1 AND created_at < $2
			GROUP BY DATE(created_at), city_prefix ORDER BY 1,2`, from, to)
		if err == nil {
			for rows.Next() {
				var day, city string
				var count, revenue int64
				if err := rows.Scan(&day, &city, &count, &revenue); err == nil {
					_, _ = fmt.Fprintf(w, "%s,%s,%d,%d\n", day, city, count, revenue)
				}
			}
			rows.Close()
		}
	default:
		http.Error(w, "unknown_report: use trips|revenue", http.StatusBadRequest)
	}
}

// parseDateRange extracts ?from=&to= query params, defaulting to the last 30 days
func parseDateRange(r *http.Request) (time.Time, time.Time) {
	q := r.URL.Query()
	to := time.Now().UTC()
	from := to.AddDate(0, 0, -30)
	if v := q.Get("from"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			from = t
		} else if t, err := time.Parse("2006-01-02", v); err == nil {
			from = t
		}
	}
	if v := q.Get("to"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			to = t
		} else if t, err := time.Parse("2006-01-02", v); err == nil {
			to = t.Add(24 * time.Hour) // inclusive
		}
	}
	return from, to
}
