package http

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NotifPrefsHandler serves the rider notification-preferences API backed by the
// rider_notification_preferences JSONB table (migration 000108).
type NotifPrefsHandler struct {
	db     *pgxpool.Pool
	logger *log.Logger
}

func NewNotifPrefsHandler(db *pgxpool.Pool, logger *log.Logger) *NotifPrefsHandler {
	return &NotifPrefsHandler{db: db, logger: logger}
}

func (h *NotifPrefsHandler) internal(w http.ResponseWriter, err error) {
	if h.logger != nil {
		h.logger.Printf("[RIDER_NOTIF_PREFS] internal error: %v", err)
	}
	writeError(w, http.StatusInternalServerError, "internal server error", "ERR_INTERNAL")
}

type notifChannelPrefs struct {
	Push  bool `json:"push"`
	SMS   bool `json:"sms"`
	Email bool `json:"email"`
}

type notificationPreferences struct {
	TripUpdates    notifChannelPrefs `json:"trip_updates"`
	Promotions     notifChannelPrefs `json:"promotions"`
	SafetyAlerts   notifChannelPrefs `json:"safety_alerts"`
	DocumentExpiry notifChannelPrefs `json:"document_expiry"`
}

// defaultNotificationPreferences: push on, SMS/email off for every category.
func defaultNotificationPreferences() notificationPreferences {
	on := notifChannelPrefs{Push: true, SMS: false, Email: false}
	return notificationPreferences{
		TripUpdates: on, Promotions: on, SafetyAlerts: on, DocumentExpiry: on,
	}
}

func (h *NotifPrefsHandler) HandleGetPreferences(w http.ResponseWriter, r *http.Request) {
	riderID, ok := riderIDFromContext(w, r)
	if !ok {
		return
	}
	var raw []byte
	err := h.db.QueryRow(r.Context(),
		`SELECT preferences FROM rider_notification_preferences WHERE rider_id = $1::uuid`, riderID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		writeData(w, http.StatusOK, defaultNotificationPreferences())
		return
	}
	if err != nil {
		h.internal(w, err)
		return
	}
	// Start from defaults so any category absent from stored JSON falls back to push-on.
	prefs := defaultNotificationPreferences()
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &prefs)
	}
	writeData(w, http.StatusOK, prefs)
}

func (h *NotifPrefsHandler) HandleUpdatePreferences(w http.ResponseWriter, r *http.Request) {
	riderID, ok := riderIDFromContext(w, r)
	if !ok {
		return
	}
	var prefs notificationPreferences
	if err := decodeJSON(r, &prefs); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", "ERR_BAD_REQUEST")
		return
	}
	raw, err := json.Marshal(prefs)
	if err != nil {
		h.internal(w, err)
		return
	}
	if _, err := h.db.Exec(r.Context(), `
		INSERT INTO rider_notification_preferences (rider_id, preferences, updated_at)
		VALUES ($1::uuid, $2, now())
		ON CONFLICT (rider_id) DO UPDATE SET preferences = EXCLUDED.preferences, updated_at = now()`,
		riderID, raw); err != nil {
		h.internal(w, err)
		return
	}
	writeData(w, http.StatusOK, prefs)
}
