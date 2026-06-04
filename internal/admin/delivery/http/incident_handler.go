package http

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"
)

type TripRecoveryRequest struct {
	OrderID        string `json:"order_id"`
	DriverID       string `json:"driver_id"`
	RecoveryAction string `json:"recovery_action"` // "FORCE_REMATCH" or "FORCE_ABORT"
	IncidentNotes  string `json:"incident_notes"`
}

type TripClaimRequest struct {
	OrderID string `json:"order_id"`
	AgentID string `json:"agent_id"`
}

type StalledTripIncident struct {
	OrderID              string  `json:"order_id"`
	DriverID             string  `json:"driver_id"`
	DriverName           string  `json:"driver_name"`
	CustomerName         string  `json:"customer_name"`
	VehicleMakeModel     string  `json:"vehicle_make_model"`
	LicensePlate         string  `json:"license_plate"`
	LastKnownStatus      string  `json:"last_known_status"` // "EN_ROUTE" or "ON_TRIP"
	SecondsSinceLastPing int     `json:"seconds_since_last_ping"`
	CityPrefix           string  `json:"city_prefix"`
	IncidentType         string  `json:"incident_type"`          // "SOS" | "FRAUD" | "SILENCE"
	IncidentStatus       string  `json:"incident_status"`        // "UNASSIGNED" | "INVESTIGATING" | "RESOLVED"
	AssignedAgentID      string  `json:"assigned_agent_id"`      // string identifier
	BearingDelta         float64 `json:"bearing_delta"`          // degrees
	CalculatedSpeed      float64 `json:"calculated_speed"`       // km/h
	IsMockProvider       bool    `json:"is_mock_provider"`       // Boolean check flag
	BatteryLevel         float64 `json:"battery_level"`          // percentage
	Latitude             float64 `json:"latitude"`
	Longitude            float64 `json:"longitude"`
}

type IncidentAdminHandler struct {
	dbPool        *pgxpool.Pool
	clusterClient *redis.ClusterClient
	kafkaWriter   *kafka.Writer
	logger        *log.Logger
	mu            sync.RWMutex
	incidents     []StalledTripIncident
}

func NewIncidentAdminHandler(
	dbPool *pgxpool.Pool,
	clusterClient *redis.ClusterClient,
	kafkaBrokers []string,
	logger *log.Logger,
) *IncidentAdminHandler {
	writer := &kafka.Writer{
		Addr:     kafka.TCP(kafkaBrokers...),
		Topic:    "order.created",
		Balancer: &kafka.LeastBytes{},
	}

	h := &IncidentAdminHandler{
		dbPool:        dbPool,
		clusterClient: clusterClient,
		kafkaWriter:   writer,
		logger:        logger,
	}

	h.incidents = []StalledTripIncident{
		{
			OrderID:              "ord-9011-cb72",
			DriverID:             "drv-4451-aa89",
			DriverName:           "Manish Malhotra",
			CustomerName:         "Sourav Ganguly",
			VehicleMakeModel:     "Audi A6 Premium",
			LicensePlate:         "WB-02-AL-0011",
			LastKnownStatus:      "ON_TRIP",
			SecondsSinceLastPing: 58,
			CityPrefix:           "KOL",
			IncidentType:         "SILENCE",
			IncidentStatus:       "UNASSIGNED",
			AssignedAgentID:      "",
			BearingDelta:         4.5,
			CalculatedSpeed:      22.4,
			IsMockProvider:       false,
			BatteryLevel:         68.0,
			Latitude:             22.5726,
			Longitude:            88.3639,
		},
		{
			OrderID:              "ord-8831-bb01",
			DriverID:             "drv-9902-aa11",
			DriverName:           "Amit Mishra",
			CustomerName:         "Priyanka Sen",
			VehicleMakeModel:     "Swift Dzire",
			LicensePlate:         "WB-04-BC-1234",
			LastKnownStatus:      "ON_TRIP",
			SecondsSinceLastPing: 2,
			CityPrefix:           "KOL",
			IncidentType:         "SOS",
			IncidentStatus:       "UNASSIGNED",
			AssignedAgentID:      "",
			BearingDelta:         12.8,
			CalculatedSpeed:      45.0,
			IsMockProvider:       false,
			BatteryLevel:         82.0,
			Latitude:             22.5832,
			Longitude:            88.3678,
		},
		{
			OrderID:              "ord-7711-ac90",
			DriverID:             "drv-7711-22aa",
			DriverName:           "Debashis Roy",
			CustomerName:         "Ayan Mukherji",
			VehicleMakeModel:     "Hyundai i20",
			LicensePlate:         "WB-06-DF-5678",
			LastKnownStatus:      "ON_TRIP",
			SecondsSinceLastPing: 12,
			CityPrefix:           "KOL",
			IncidentType:         "FRAUD",
			IncidentStatus:       "UNASSIGNED",
			AssignedAgentID:      "",
			BearingDelta:         0.0,
			CalculatedSpeed:      240.0,
			IsMockProvider:       true,
			BatteryLevel:         50.0,
			Latitude:             22.5901,
			Longitude:            88.3512,
		},
	}

	return h
}

// AddIncident appends a new incident to the active monitoring queue in a thread-safe manner
func (h *IncidentAdminHandler) AddIncident(incident StalledTripIncident) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.incidents = append(h.incidents, incident)
}

// HandleGetStalledTrips retrieves trips that have stalled telemetry streams
func (h *IncidentAdminHandler) HandleGetStalledTrips(w http.ResponseWriter, r *http.Request) {
	// Validate RBAC Authorization Claims
	adminRole := r.Header.Get("X-Admin-Role")
	if adminRole != "SUPER_ADMIN" && adminRole != "SUPPORT_LEAD" {
		http.Error(w, "insufficient_operational_permissions", http.StatusForbidden)
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"incidents": h.incidents})
}

// HandleClaimIncident handles claiming of an active incident by a support agent
func (h *IncidentAdminHandler) HandleClaimIncident(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	// Validate RBAC Authorization Claims
	adminRole := r.Header.Get("X-Admin-Role")
	if adminRole != "SUPER_ADMIN" && adminRole != "SUPPORT_LEAD" {
		http.Error(w, "insufficient_operational_permissions", http.StatusForbidden)
		return
	}

	var req TripClaimRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}

	if req.OrderID == "" || req.AgentID == "" {
		http.Error(w, "missing_required_claim_fields", http.StatusUnprocessableEntity)
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	found := false
	for i, incident := range h.incidents {
		if incident.OrderID == req.OrderID {
			h.incidents[i].IncidentStatus = "INVESTIGATING"
			h.incidents[i].AssignedAgentID = req.AgentID
			found = true
			break
		}
	}

	if !found {
		http.Error(w, "incident_not_found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"INCIDENT_CLAIMED_SUCCESSFULLY"}`))
}

// HandleExecuteTripRecovery processes administrative interventions to resolve stranded orders
func (h *IncidentAdminHandler) HandleExecuteTripRecovery(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	// Validate RBAC Authorization Claims
	adminRole := r.Header.Get("X-Admin-Role")
	if adminRole != "SUPER_ADMIN" && adminRole != "SUPPORT_LEAD" {
		http.Error(w, "insufficient_operational_permissions", http.StatusForbidden)
		return
	}

	var req TripRecoveryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}

	if req.OrderID == "" || req.DriverID == "" || req.RecoveryAction == "" {
		http.Error(w, "missing_required_recovery_fields", http.StatusUnprocessableEntity)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// Begin an isolated atomic database transaction blocks to prevent partial state updates
	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "transaction_initialization_failure", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	if req.RecoveryAction == "FORCE_REMATCH" {
		// 1. Re-initialize order entry back to CREATED state and break current driver bindings
		updateOrderQuery := `
			UPDATE orders 
			SET status = 'CREATED'::order_status_enum, assigned_driver_id = NULL 
			WHERE id = $1::uuid AND status IN ('ASSIGNED'::order_status_enum, 'EN_ROUTE_TO_PICKUP'::order_status_enum, 'DELIVERING'::order_status_enum)
		`
		_, err = tx.Exec(ctx, updateOrderQuery, req.OrderID)
		if err != nil {
			http.Error(w, "database_order_mutation_failure", http.StatusInternalServerError)
			return
		}

		// 2. Force flag the compromised driver state to OFFLINE to protect system dispatch loops
		updateDriverQuery := `
			UPDATE drivers SET current_state = 'OFFLINE'::driver_state_enum, updated_at = NOW() WHERE id = $1::uuid
		`
		_, err = tx.Exec(ctx, updateDriverQuery, req.DriverID)
		if err != nil {
			http.Error(w, "database_driver_mutation_failure", http.StatusInternalServerError)
			return
		}

		// 3. Commit SQL statements
		if err := tx.Commit(ctx); err != nil {
			http.Error(w, "transaction_commit_failure", http.StatusInternalServerError)
			return
		}

		// 4. Evict driver session states and break concurrent routing fences inside Redis Cluster
		driverStateKey := fmt.Sprintf("driver:state:%s", req.DriverID)
		_ = h.clusterClient.Set(ctx, driverStateKey, "OFFLINE", 24*time.Hour).Err()
		_ = h.clusterClient.Del(ctx, fmt.Sprintf("driver:lock:%s", req.DriverID)).Err()

		// 5. Emit matching event frame to Kafka topic to let the Kuhn-Munkres engine re-pick it up
		kafkaPayload, _ := json.Marshal(map[string]string{
			"order_id":    req.OrderID,
			"city_prefix": "KOL",
			"status":      "CREATED",
		})
		
		err = h.kafkaWriter.WriteMessages(ctx, kafka.Message{
			Key:   []byte(req.OrderID),
			Value: kafkaPayload,
		})
		if err != nil {
			h.logger.Printf("[INCIDENT_RECOVERY_ERROR] Failed to emit re-match event to Kafka: %v", err)
		}

	} else if req.RecoveryAction == "FORCE_ABORT" {
		// Terminate trip context cleanly without scheduling a re-match event frame
		_, err = tx.Exec(ctx, "UPDATE orders SET status = 'CANCELLED'::order_status_enum WHERE id = $1::uuid", req.OrderID)
		if err != nil {
			http.Error(w, "database_order_abort_mutation_failure", http.StatusInternalServerError)
			return
		}
		
		_, err = tx.Exec(ctx, "UPDATE drivers SET current_state = 'OFFLINE'::driver_state_enum, updated_at = NOW() WHERE id = $1::uuid", req.DriverID)
		if err != nil {
			http.Error(w, "database_driver_abort_mutation_failure", http.StatusInternalServerError)
			return
		}
		
		if err := tx.Commit(ctx); err != nil {
			http.Error(w, "transaction_abort_commit_failure", http.StatusInternalServerError)
			return
		}
		_ = h.clusterClient.Set(ctx, fmt.Sprintf("driver:state:%s", req.DriverID), "OFFLINE", 24*time.Hour).Err()
	} else {
		http.Error(w, "unsupported_recovery_action_token", http.StatusBadRequest)
		return
	}

	h.mu.Lock()
	for i, incident := range h.incidents {
		if incident.OrderID == req.OrderID {
			h.incidents[i].IncidentStatus = "RESOLVED"
			break
		}
	}
	h.mu.Unlock()

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"INCIDENT_RECOVERY_EXECUTED_CLEANLY"}`))
}

// GetIncidents returns a copy of the active incidents
func (h *IncidentAdminHandler) GetIncidents() []StalledTripIncident {
	h.mu.RLock()
	defer h.mu.RUnlock()
	copied := make([]StalledTripIncident, len(h.incidents))
	copy(copied, h.incidents)
	return copied
}

