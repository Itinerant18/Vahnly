package http

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"
)

// incidentsActiveKey is the Redis hash (field = order_id, value = JSON incident) backing
// the live incident/SOS queue. Redis-backed so the queue is shared across all gateway
// replicas and survives a restart — an in-process slice was pod-sticky and lost on crash.
const incidentsActiveKey = "incidents:active"

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

	return &IncidentAdminHandler{
		dbPool:        dbPool,
		clusterClient: clusterClient,
		kafkaWriter:   writer,
		logger:        logger,
	}
}

// AddIncident persists a new incident to the shared Redis-backed queue so it is visible
// across all gateway replicas and survives a restart.
func (h *IncidentAdminHandler) AddIncident(incident StalledTripIncident) {
	if h.clusterClient == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()
	payload, err := json.Marshal(incident)
	if err != nil {
		return
	}
	if err := h.clusterClient.HSet(ctx, incidentsActiveKey, incident.OrderID, payload).Err(); err != nil {
		h.logger.Printf("[INCIDENT_QUEUE] Failed to persist incident %s: %v", incident.OrderID, err)
	}
}

// loadIncidents returns every incident currently in the Redis-backed queue.
func (h *IncidentAdminHandler) loadIncidents(ctx context.Context) ([]StalledTripIncident, error) {
	out := make([]StalledTripIncident, 0)
	if h.clusterClient == nil {
		return out, nil
	}
	vals, err := h.clusterClient.HVals(ctx, incidentsActiveKey).Result()
	if err != nil {
		return nil, err
	}
	for _, v := range vals {
		var inc StalledTripIncident
		if json.Unmarshal([]byte(v), &inc) == nil {
			out = append(out, inc)
		}
	}
	return out, nil
}

// HandleGetStalledTrips retrieves trips that have stalled telemetry streams
func (h *IncidentAdminHandler) HandleGetStalledTrips(w http.ResponseWriter, r *http.Request) {
	// Validate RBAC Authorization Claims
	adminRole := r.Header.Get("X-Admin-Role")
	if adminRole != "SUPER_ADMIN" && adminRole != "SUPPORT_LEAD" {
		http.Error(w, "insufficient_operational_permissions", http.StatusForbidden)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	incidents, err := h.loadIncidents(ctx)
	if err != nil {
		http.Error(w, "incident_store_unavailable", http.StatusServiceUnavailable)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"incidents": incidents})
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

	if h.clusterClient == nil {
		http.Error(w, "incident_not_found", http.StatusNotFound)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	raw, err := h.clusterClient.HGet(ctx, incidentsActiveKey, req.OrderID).Result()
	if err != nil {
		http.Error(w, "incident_not_found", http.StatusNotFound)
		return
	}
	var incident StalledTripIncident
	if json.Unmarshal([]byte(raw), &incident) != nil {
		http.Error(w, "incident_not_found", http.StatusNotFound)
		return
	}
	incident.IncidentStatus = "INVESTIGATING"
	incident.AssignedAgentID = req.AgentID
	payload, _ := json.Marshal(incident)
	if err := h.clusterClient.HSet(ctx, incidentsActiveKey, req.OrderID, payload).Err(); err != nil {
		http.Error(w, "incident_store_unavailable", http.StatusServiceUnavailable)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"INCIDENT_CLAIMED_SUCCESSFULLY"}`))
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

	// Remove the now-handled incident from the shared active queue.
	if h.clusterClient != nil {
		_ = h.clusterClient.HDel(ctx, incidentsActiveKey, req.OrderID).Err()
	}

	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"INCIDENT_RECOVERY_EXECUTED_CLEANLY"}`))
}

// GetIncidents returns the active incidents from the shared Redis-backed queue.
func (h *IncidentAdminHandler) GetIncidents() []StalledTripIncident {
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()
	incidents, err := h.loadIncidents(ctx)
	if err != nil {
		return []StalledTripIncident{}
	}
	return incidents
}

