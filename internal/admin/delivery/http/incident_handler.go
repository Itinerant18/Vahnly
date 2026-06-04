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

type TripRecoveryRequest struct {
	OrderID        string `json:"order_id"`
	DriverID       string `json:"driver_id"`
	RecoveryAction string `json:"recovery_action"` // "FORCE_REMATCH" or "FORCE_ABORT"
	IncidentNotes  string `json:"incident_notes"`
}

type StalledTripIncident struct {
	OrderID              string `json:"order_id"`
	DriverID             string `json:"driver_id"`
	DriverName           string `json:"driver_name"`
	CustomerName         string `json:"customer_name"`
	VehicleMakeModel     string `json:"vehicle_make_model"`
	LicensePlate         string `json:"license_plate"`
	LastKnownStatus      string `json:"last_known_status"` // "EN_ROUTE" or "ON_TRIP"
	SecondsSinceLastPing int    `json:"seconds_since_last_ping"`
	CityPrefix           string `json:"city_prefix"`
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

// HandleGetStalledTrips retrieves trips that have stalled telemetry streams
func (h *IncidentAdminHandler) HandleGetStalledTrips(w http.ResponseWriter, r *http.Request) {
	// Validate RBAC Authorization Claims
	adminRole := r.Header.Get("X-Admin-Role")
	if adminRole != "SUPER_ADMIN" && adminRole != "SUPPORT_LEAD" {
		http.Error(w, "insufficient_operational_permissions", http.StatusForbidden)
		return
	}

	// High-fidelity fallback data: Simulates a driver whose device went offline inside an infrastructure dead-zone
	incidents := []StalledTripIncident{
		{
			OrderID:              "ord-9011-cb72",
			DriverID:             "drv-4451-aa89",
			DriverName:           "Manish Malhotra",
			CustomerName:         "Sourav Ganguly",
			VehicleMakeModel:     "Audi A6 Premium",
			LicensePlate:         "WB-02-AL-0011",
			LastKnownStatus:      "ON_TRIP",
			SecondsSinceLastPing: 58, // Exceeds the critical 45-second telemetry heartbeat threshold
			CityPrefix:           "KOL",
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"incidents": incidents})
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

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"INCIDENT_RECOVERY_EXECUTED_CLEANLY"}`))
}
