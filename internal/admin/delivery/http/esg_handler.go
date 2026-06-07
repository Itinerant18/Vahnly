package http

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type ESGHandler struct {
	db     *pgxpool.Pool
	logger *log.Logger
}

func NewESGHandler(db *pgxpool.Pool, logger *log.Logger) *ESGHandler {
	return &ESGHandler{db: db, logger: logger}
}

func esgJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (h *ESGHandler) HandleGetESGSummary(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	type EmissionFactor struct {
		VehicleType  string  `json:"vehicle_type"`
		CO2KgPerKm   float64 `json:"co2_kg_per_km"`
		Description  string  `json:"description"`
	}

	type CarbonRecord struct {
		ID           string    `json:"id"`
		TripID       *string   `json:"trip_id,omitempty"`
		VehicleType  string    `json:"vehicle_type"`
		DistanceKm   float64   `json:"distance_km"`
		EmissionKg   float64   `json:"emission_kg"`
		OffsetKg     float64   `json:"offset_kg"`
		RecordedDate string    `json:"recorded_date"`
	}

	type ESGReport struct {
		ID              string          `json:"id"`
		Period          string          `json:"period"`
		TotalTrips      int             `json:"total_trips"`
		TotalDistanceKm float64         `json:"total_distance_km"`
		TotalEmissionKg float64         `json:"total_emission_kg"`
		TotalOffsetKg   float64         `json:"total_offset_kg"`
		NetEmissionKg   float64         `json:"net_emission_kg"`
		EVTripPct       float64         `json:"ev_trip_pct"`
		WomenDriverPct  float64         `json:"women_driver_pct"`
		Status          string          `json:"status"`
		Metrics         json.RawMessage `json:"metrics"`
		CreatedAt       time.Time       `json:"created_at"`
	}

	efRows, _ := h.db.Query(ctx, `SELECT vehicle_type, co2_kg_per_km, description FROM emission_factors ORDER BY co2_kg_per_km`)
	factors := []EmissionFactor{}
	if efRows != nil {
		defer efRows.Close()
		for efRows.Next() {
			var ef EmissionFactor
			if err := efRows.Scan(&ef.VehicleType, &ef.CO2KgPerKm, &ef.Description); err == nil {
				factors = append(factors, ef)
			}
		}
	}

	crRows, _ := h.db.Query(ctx, `SELECT id, trip_id, vehicle_type, distance_km, emission_kg, offset_kg, recorded_date::text FROM carbon_records ORDER BY recorded_date DESC LIMIT 50`)
	records := []CarbonRecord{}
	if crRows != nil {
		defer crRows.Close()
		for crRows.Next() {
			var cr CarbonRecord
			if err := crRows.Scan(&cr.ID, &cr.TripID, &cr.VehicleType, &cr.DistanceKm, &cr.EmissionKg, &cr.OffsetKg, &cr.RecordedDate); err == nil {
				records = append(records, cr)
			}
		}
	}

	rpRows, _ := h.db.Query(ctx, `SELECT id, period, total_trips, total_distance_km, total_emission_kg, total_offset_kg, net_emission_kg, ev_trip_pct, women_driver_pct, status, metrics, created_at FROM esg_reports ORDER BY period DESC`)
	reports := []ESGReport{}
	if rpRows != nil {
		defer rpRows.Close()
		for rpRows.Next() {
			var rp ESGReport
			if err := rpRows.Scan(&rp.ID, &rp.Period, &rp.TotalTrips, &rp.TotalDistanceKm, &rp.TotalEmissionKg, &rp.TotalOffsetKg, &rp.NetEmissionKg, &rp.EVTripPct, &rp.WomenDriverPct, &rp.Status, &rp.Metrics, &rp.CreatedAt); err == nil {
				reports = append(reports, rp)
			}
		}
	}

	var totalEmissionMTD, totalTripsMTD float64
	_ = h.db.QueryRow(ctx, `SELECT COALESCE(SUM(emission_kg),0), COUNT(*) FROM carbon_records WHERE recorded_date >= DATE_TRUNC('month', CURRENT_DATE)`).Scan(&totalEmissionMTD, &totalTripsMTD)

	esgJSON(w, http.StatusOK, map[string]any{
		"emission_factors": factors,
		"carbon_records":   records,
		"esg_reports":      reports,
		"mtd_summary": map[string]any{
			"total_emission_kg": totalEmissionMTD,
			"total_trips":       totalTripsMTD,
		},
	})
}

func (h *ESGHandler) HandlePublishESGReport(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	id := r.PathValue("id")
	_, err := h.db.Exec(ctx, `UPDATE esg_reports SET status='PUBLISHED' WHERE id=$1`, id)
	if err != nil {
		http.Error(w, "update failed", http.StatusInternalServerError)
		return
	}
	esgJSON(w, http.StatusOK, map[string]string{"id": id, "status": "PUBLISHED"})
}
