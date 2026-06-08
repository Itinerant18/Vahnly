package http

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type DriverComplianceProfile struct {
	ID                        string    `json:"id"`
	Name                      string    `json:"name"`
	Phone                     string    `json:"phone"`
	LicenseNumber             string    `json:"license_number"`
	CityPrefix                string    `json:"city_prefix"`
	HasManualCertification    bool      `json:"has_manual_certification"`
	HasAutomaticCertification bool      `json:"has_automatic_certification"`
	IsLuxuryQualified         bool      `json:"is_luxury_qualified"`
	BackgroundCheckStatus     string    `json:"background_check_status"`
	CurrentState              string    `json:"current_state"`
	AppliedAt                 time.Time `json:"applied_at"`
}

type ActiveDriverTelemetry struct {
	DriverID       string  `json:"driver_id"`
	Name           string  `json:"name"`
	Phone          string  `json:"phone"`
	CurrentState   string  `json:"current_state"`
	SpeedKMS       float64 `json:"speed_kms"`
	Bearing        float64 `json:"bearing"`
	CurrentOrderID *string `json:"current_order_id"`
	LastPingUTC    string  `json:"last_ping_utc"`
}

type DuplicateCheckRequest struct {
	FieldName string `json:"field_name"`
	Value     string `json:"value"`
}

type VerifyDriverRequest struct {
	DriverID                  string `json:"driver_id"`
	Approve                   bool   `json:"approve"`
	HasManualCertification    bool   `json:"has_manual_certification"`
	HasAutomaticCertification bool   `json:"has_automatic_certification"`
	IsLuxuryQualified         bool   `json:"is_luxury_qualified"`
	BackgroundCheckStatus     string `json:"background_check_status"`
}

type DriverComplianceHandler struct {
	dbPool        *pgxpool.Pool
	clusterClient *redis.ClusterClient
	logger        *log.Logger
}

func NewDriverComplianceHandler(dbPool *pgxpool.Pool, client *redis.ClusterClient, logger *log.Logger) *DriverComplianceHandler {
	return &DriverComplianceHandler{
		dbPool:        dbPool,
		clusterClient: client,
		logger:        logger,
	}
}

// HandleGetPendingDrivers returns all drivers where is_verified is false
func (h *DriverComplianceHandler) HandleGetPendingDrivers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	query := `
		SELECT id::text, name, COALESCE(phone, ''), COALESCE(dl_number, ''), city_prefix,
		       has_manual_certification, has_automatic_certification, is_luxury_qualified,
		       background_check_status, current_state::text, created_at
		FROM drivers
		WHERE is_verified = false
		ORDER BY created_at DESC;
	`

	rows, err := h.dbPool.Query(ctx, query)
	if err != nil {
		h.logger.Printf("[COMPLIANCE_ERROR] Failed to query pending drivers: %v", err)
		http.Error(w, "database_query_failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	drivers := make([]DriverComplianceProfile, 0)
	for rows.Next() {
		var d DriverComplianceProfile
		if err := rows.Scan(
			&d.ID, &d.Name, &d.Phone, &d.LicenseNumber, &d.CityPrefix,
			&d.HasManualCertification, &d.HasAutomaticCertification, &d.IsLuxuryQualified,
			&d.BackgroundCheckStatus, &d.CurrentState, &d.AppliedAt,
		); err != nil {
			h.logger.Printf("[COMPLIANCE_ERROR] Failed to scan pending driver: %v", err)
			continue
		}
		drivers = append(drivers, d)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"drivers": drivers,
	})
}

// HandleGetPendingDriverDetail returns the profile of a single pending driver
func (h *DriverComplianceHandler) HandleGetPendingDriverDetail(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	driverID := r.PathValue("driver_id")
	if driverID == "" {
		http.Error(w, "missing_driver_id", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	query := `
		SELECT id::text, name, COALESCE(phone, ''), COALESCE(dl_number, ''), city_prefix,
		       has_manual_certification, has_automatic_certification, is_luxury_qualified,
		       background_check_status, current_state::text, created_at
		FROM drivers
		WHERE id = $1::uuid AND is_verified = false;
	`

	var d DriverComplianceProfile
	err := h.dbPool.QueryRow(ctx, query, driverID).Scan(
		&d.ID, &d.Name, &d.Phone, &d.LicenseNumber, &d.CityPrefix,
		&d.HasManualCertification, &d.HasAutomaticCertification, &d.IsLuxuryQualified,
		&d.BackgroundCheckStatus, &d.CurrentState, &d.AppliedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "driver_not_found", http.StatusNotFound)
			return
		}
		http.Error(w, "database_query_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(d)
}

// HandleDuplicateCheck verifies DL or Phone uniqueness
func (h *DriverComplianceHandler) HandleDuplicateCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req DuplicateCheckRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}

	if req.FieldName != "dl_number" && req.FieldName != "phone" {
		http.Error(w, "unsupported_validation_field", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	var query string
	if req.FieldName == "dl_number" {
		query = "SELECT EXISTS(SELECT 1 FROM drivers WHERE dl_number = $1);"
	} else {
		query = "SELECT EXISTS(SELECT 1 FROM drivers WHERE phone = $1);"
	}

	var exists bool
	if err := h.dbPool.QueryRow(ctx, query, req.Value).Scan(&exists); err != nil {
		http.Error(w, "validation_query_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"exists":  exists,
		"message": fmt.Sprintf("Field %s existence status evaluated.", req.FieldName),
	})
}

// HandleVerifyDriver approves or rejects a pending applicant
func (h *DriverComplianceHandler) HandleVerifyDriver(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req VerifyDriverRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}

	if req.DriverID == "" {
		http.Error(w, "missing_driver_id", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	if req.Approve {
		if req.BackgroundCheckStatus != "CLEARED" {
			http.Error(w, "background_check_clearance_required", http.StatusBadRequest)
			return
		}
		if !req.HasManualCertification && !req.HasAutomaticCertification {
			http.Error(w, "transmission_capability_required", http.StatusBadRequest)
			return
		}

		query := `
			UPDATE drivers
			SET is_verified = true,
			    has_manual_certification = $1,
			    has_automatic_certification = $2,
			    is_luxury_qualified = $3,
			    background_check_status = $4,
			    current_state = 'OFFLINE',
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = $5::uuid AND is_verified = false;
		`
		res, err := h.dbPool.Exec(ctx, query,
			req.HasManualCertification, req.HasAutomaticCertification, req.IsLuxuryQualified,
			req.BackgroundCheckStatus, req.DriverID,
		)
		if err != nil {
			http.Error(w, "verification_mutation_failed", http.StatusInternalServerError)
			return
		}
		if res.RowsAffected() == 0 {
			http.Error(w, "driver_not_found_or_already_verified", http.StatusNotFound)
			return
		}
	} else {
		// Rejection: Delete row
		query := "DELETE FROM drivers WHERE id = $1::uuid AND is_verified = false;"
		res, err := h.dbPool.Exec(ctx, query, req.DriverID)
		if err != nil {
			http.Error(w, "rejection_deletion_failed", http.StatusInternalServerError)
			return
		}
		if res.RowsAffected() == 0 {
			http.Error(w, "driver_not_found_or_already_verified", http.StatusNotFound)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"VERIFICATION_PROCESSED_SUCCESSFULLY"}`))
}

// HandleGetDriversInCell fetches active driver metrics within the specified H3 cell
func (h *DriverComplianceHandler) HandleGetDriversInCell(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	h3cell := r.PathValue("h3cell")
	if h3cell == "" {
		http.Error(w, "missing_h3_cell", http.StatusBadRequest)
		return
	}

	cityPrefix := r.Header.Get("X-Region-Prefix")
	if cityPrefix == "" {
		cityPrefix = "KOL"
	}
	cityPrefix = strings.ToUpper(strings.TrimSpace(cityPrefix))

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	spatialZSetKey := fmt.Sprintf("drivers:zset:%s:%s", cityPrefix, h3cell)
	driverIDs, err := h.clusterClient.ZRange(ctx, spatialZSetKey, 0, -1).Result()
	if err != nil && err != redis.Nil {
		h.logger.Printf("[COMPLIANCE_ERROR] Failed fetching zset members: %v", err)
		http.Error(w, "redis_read_failed", http.StatusInternalServerError)
		return
	}

	activeDrivers := make([]ActiveDriverTelemetry, 0)
	if len(driverIDs) == 0 {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"drivers": activeDrivers})
		return
	}

	// Fetch profile database values
	query := `
		SELECT id::text, name, COALESCE(phone, ''), current_state::text
		FROM drivers
		WHERE id = ANY($1::uuid[]);
	`
	rows, err := h.dbPool.Query(ctx, query, driverIDs)
	if err != nil {
		h.logger.Printf("[COMPLIANCE_ERROR] Failed fetching database profiles: %v", err)
		http.Error(w, "database_query_failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	dbDrivers := make(map[string]struct {
		Name         string
		Phone        string
		CurrentState string
	})

	for rows.Next() {
		var id, name, phone, state string
		if err := rows.Scan(&id, &name, &phone, &state); err == nil {
			dbDrivers[id] = struct {
				Name         string
				Phone        string
				CurrentState string
			}{Name: name, Phone: phone, CurrentState: state}
		}
	}

	for _, driverID := range driverIDs {
		dbInfo, exists := dbDrivers[driverID]
		if !exists {
			continue
		}

		profileKey := fmt.Sprintf("driver:{%s:%s}:profile", cityPrefix, driverID)
		activeTripKey := fmt.Sprintf("driver:active:trip:%s", driverID)

		// Read profile fields from Redis
		fields, err := h.clusterClient.HMGet(ctx, profileKey, "speed_kms", "bearing", "last_ping_utc").Result()
		var speed, bearing float64
		lastPing := time.Now().Format(time.RFC3339)

		if err == nil && len(fields) == 3 {
			if sVal, ok := fields[0].(string); ok {
				speed, _ = strconv.ParseFloat(sVal, 64)
			}
			if bVal, ok := fields[1].(string); ok {
				bearing, _ = strconv.ParseFloat(bVal, 64)
			}
			if pVal, ok := fields[2].(string); ok && pVal != "" {
				lastPing = pVal
			}
		}

		var currentOrderID *string
		orderID, oErr := h.clusterClient.Get(ctx, activeTripKey).Result()
		if oErr == nil && orderID != "" {
			currentOrderID = &orderID
		}

		activeDrivers = append(activeDrivers, ActiveDriverTelemetry{
			DriverID:       driverID,
			Name:           dbInfo.Name,
			Phone:          dbInfo.Phone,
			CurrentState:   dbInfo.CurrentState,
			SpeedKMS:       speed,
			Bearing:        bearing,
			CurrentOrderID: currentOrderID,
			LastPingUTC:    lastPing,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"drivers": activeDrivers,
	})
}
