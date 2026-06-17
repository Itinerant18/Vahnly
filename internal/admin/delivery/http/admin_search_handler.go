package http

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// AdminExtrasHandler backs the shell/search/team-action/detail-tab admin APIs that
// were added on top of the original Phase-11 handlers. It shares the same pgxpool
// the sibling admin handlers use. Every detail-tab query is best-effort: when the
// underlying table is absent it returns an empty array/object with HTTP 200 so the
// frontend renders a clean empty state instead of an error.
type AdminExtrasHandler struct {
	dbPool *pgxpool.Pool
	logger *log.Logger
}

func NewAdminExtrasHandler(dbPool *pgxpool.Pool, logger *log.Logger) *AdminExtrasHandler {
	return &AdminExtrasHandler{dbPool: dbPool, logger: logger}
}

// writeExtrasJSON mirrors writeRiderJSON — a thin JSON envelope helper.
func writeExtrasJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

// ---------------------------------------------------------------------------
// GET /api/v1/admin/search?q=<str>
// ---------------------------------------------------------------------------

func (h *AdminExtrasHandler) HandleGlobalSearch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	type tripHit struct {
		ID         string `json:"id"`
		Status     string `json:"status"`
		FarePaise  int64  `json:"fare_paise"`
		CityPrefix string `json:"city_prefix"`
	}
	type driverHit struct {
		ID     string `json:"id"`
		Name   string `json:"name"`
		Phone  string `json:"phone"`
		Status string `json:"status"`
	}
	type riderHit struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Phone string `json:"phone"`
	}

	trips := make([]tripHit, 0)
	drivers := make([]driverHit, 0)
	riders := make([]riderHit, 0)

	if q != "" {
		like := "%" + q + "%"

		// Trips: LIKE-search by id/city, ordered by id.
		if rows, err := h.dbPool.Query(ctx, `
			SELECT id::text, status::text, base_fare_paise, city_prefix
			FROM orders
			WHERE id::text ILIKE $1 OR city_prefix ILIKE $1
			ORDER BY id
			LIMIT 5`, like); err == nil {
			for rows.Next() {
				var t tripHit
				if err := rows.Scan(&t.ID, &t.Status, &t.FarePaise, &t.CityPrefix); err == nil {
					trips = append(trips, t)
				}
			}
			rows.Close()
		}

		// Drivers: search by name/phone/id, ordered by name.
		if rows, err := h.dbPool.Query(ctx, `
			SELECT id::text, name, COALESCE(phone, ''), current_state::text
			FROM drivers
			WHERE name ILIKE $1 OR COALESCE(phone, '') ILIKE $1 OR id::text ILIKE $1
			ORDER BY name
			LIMIT 5`, like); err == nil {
			for rows.Next() {
				var d driverHit
				if err := rows.Scan(&d.ID, &d.Name, &d.Phone, &d.Status); err == nil {
					drivers = append(drivers, d)
				}
			}
			rows.Close()
		}

		// Riders: search by name/phone/id, ordered by name.
		if rows, err := h.dbPool.Query(ctx, `
			SELECT id::text, COALESCE(name, ''), COALESCE(phone, '')
			FROM riders
			WHERE COALESCE(name, '') ILIKE $1 OR COALESCE(phone, '') ILIKE $1 OR id::text ILIKE $1
			ORDER BY name
			LIMIT 5`, like); err == nil {
			for rows.Next() {
				var ri riderHit
				if err := rows.Scan(&ri.ID, &ri.Name, &ri.Phone); err == nil {
					riders = append(riders, ri)
				}
			}
			rows.Close()
		}
	}

	writeExtrasJSON(w, map[string]any{
		"trips":   trips,
		"drivers": drivers,
		"riders":  riders,
	})
}
