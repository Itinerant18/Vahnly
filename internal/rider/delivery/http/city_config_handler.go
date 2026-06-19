package http

import (
	"log"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// CityConfigHandler exposes the booking-relevant slice of regional_cities to the
// rider app: operating hours and supported trip tiers. The full registry is
// admin-only; this is the read-only view the booking sheet / scheduler need.
type CityConfigHandler struct {
	dbPool *pgxpool.Pool
	logger *log.Logger
}

func NewCityConfigHandler(dbPool *pgxpool.Pool, logger *log.Logger) *CityConfigHandler {
	return &CityConfigHandler{dbPool: dbPool, logger: logger}
}

// HandleGetCityConfig returns operating hours + supported trip types for a city.
// Falls back to defaults (06:00–23:00, all tiers) when the city row or a field is
// unset, so the picker always has usable bounds.
func (h *CityConfigHandler) HandleGetCityConfig(w http.ResponseWriter, r *http.Request) {
	if _, ok := riderIDFromContext(w, r); !ok {
		return
	}

	city := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("city")))
	if city == "" {
		city = "KOL" // matches the booking service's default city
	}

	start, end := "06:00", "23:00"
	tripTypes := []string{} // empty = all tiers allowed

	var s, e *string
	var tt []string
	err := h.dbPool.QueryRow(r.Context(), `
		SELECT to_char(operating_hours_start, 'HH24:MI'),
		       to_char(operating_hours_end,   'HH24:MI'),
		       COALESCE(supported_trip_types, '{}')
		FROM regional_cities WHERE city_prefix = $1`, city).Scan(&s, &e, &tt)
	if err == nil {
		if s != nil && *s != "" {
			start = *s
		}
		if e != nil && *e != "" {
			end = *e
		}
		if tt != nil {
			tripTypes = tt
		}
	}
	// err != nil (no row / transient DB issue): keep defaults — the picker degrades
	// gracefully rather than failing.

	writeData(w, http.StatusOK, map[string]any{
		"city_prefix":           city,
		"operating_hours_start": start,
		"operating_hours_end":   end,
		"supported_trip_types":  tripTypes,
	})
}
