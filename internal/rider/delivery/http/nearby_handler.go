package http

import (
	"log"
	"math"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5/pgxpool"
)

// NearbyHandler returns a deterministic set of nearby driver markers for the map
// idle state. It is a stub (no DB lookup): positions are jittered around the
// requested point so the UI shows ambient supply without leaking real drivers.
type NearbyHandler struct {
	logger *log.Logger
}

// NewNearbyHandler keeps the db parameter for signature parity with the other
// rider handlers, even though no query is run.
func NewNearbyHandler(_ *pgxpool.Pool, logger *log.Logger) *NearbyHandler {
	return &NearbyHandler{logger: logger}
}

type nearbyDriver struct {
	ID      string  `json:"id"`
	Lat     float64 `json:"lat"`
	Lng     float64 `json:"lng"`
	Bearing float64 `json:"bearing"`
}

func (h *NearbyHandler) HandleNearbyDrivers(w http.ResponseWriter, r *http.Request) {
	if _, ok := riderIDFromContext(w, r); !ok {
		return
	}

	// Default to Kolkata when lat/lng are missing or unparseable.
	lat := parseFloatDefault(r.URL.Query().Get("lat"), 22.5726)
	lng := parseFloatDefault(r.URL.Query().Get("lng"), 88.3639)

	// 5 deterministic markers (within the 4-6 range): fixed angles/distances so the
	// same coordinates always yield the same layout (no flicker on poll).
	type offset struct {
		distanceM float64
		bearing   float64
	}
	offsets := []offset{
		{350, 30}, {600, 110}, {800, 200}, {1050, 280}, {500, 340},
	}

	// metresPerDegLat is ~constant; longitude shrinks by cos(latitude).
	const metresPerDegLat = 111_320.0
	metresPerDegLng := metresPerDegLat * math.Cos(lat*math.Pi/180)

	drivers := make([]nearbyDriver, 0, len(offsets))
	for i, o := range offsets {
		rad := o.bearing * math.Pi / 180
		dLat := (o.distanceM * math.Cos(rad)) / metresPerDegLat
		dLng := (o.distanceM * math.Sin(rad)) / metresPerDegLng
		drivers = append(drivers, nearbyDriver{
			ID:      "nearby-" + strconv.Itoa(i+1),
			Lat:     lat + dLat,
			Lng:     lng + dLng,
			Bearing: o.bearing,
		})
	}

	writeData(w, http.StatusOK, map[string]any{"drivers": drivers})
}

func parseFloatDefault(s string, def float64) float64 {
	if s == "" {
		return def
	}
	// ParseFloat accepts "NaN"/"Inf" without error; NaN/Inf coordinates make the
	// JSON encoder fail after the 200 header is written. Clamp to real geo bounds.
	if f, err := strconv.ParseFloat(s, 64); err == nil && f >= -180 && f <= 180 {
		return f
	}
	return def
}
