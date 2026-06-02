package http

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

type SurgeFreezeRequest struct {
	CityPrefix    string  `json:"city_prefix"`
	H3Cell        string  `json:"h3_cell"`
	MaxMultiplier float64 `json:"max_multiplier"`
	DurationMins  int     `json:"duration_minutes"`
}

type PricingAdminHandler struct {
	clusterClient *redis.ClusterClient
	logger        *log.Logger
}

func NewPricingAdminHandler(clusterClient *redis.ClusterClient, logger *log.Logger) *PricingAdminHandler {
	return &PricingAdminHandler{
		clusterClient: clusterClient,
		logger:        logger,
	}
}

// HandleEnforcePriceCap writes a persistent ceiling multiplier directly into the Redis cluster matrix
func (h *PricingAdminHandler) HandleEnforcePriceCap(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	// RBAC Context Check: Ensure middleware has verified administrative identity vectors
	adminRole := r.Header.Get("X-Admin-Role")
	if adminRole != "SUPER_ADMIN" && adminRole != "MARKET_CONTROLLER" {
		http.Error(w, "unauthorized_operational_clearance", http.StatusForbidden)
		return
	}

	var req SurgeFreezeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}

	// Validation constraints over emergency inputs
	if req.CityPrefix == "" || req.H3Cell == "" || req.MaxMultiplier < 1.0 || req.DurationMins <= 0 {
		http.Error(w, "invalid_override_parameters", http.StatusUnprocessableEntity)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	// Maintain key naming consistency without city-bracket hashtagging 
	// This ensures uniform load distribution across all cluster nodes
	matrixKey := fmt.Sprintf("surge:matrix:%s:%s", req.CityPrefix, req.H3Cell)
	multiplierValue := strconv.FormatFloat(req.MaxMultiplier, 'f', 4, 64)
	overrideDuration := time.Duration(req.DurationMins) * time.Minute

	// Execute high-priority SET to overwrite the automated 60-second values
	err := h.clusterClient.Set(ctx, matrixKey, multiplierValue, overrideDuration).Err()
	if err != nil {
		h.logger.Printf("[CLUSTER_LOCK_EXCEPTION] Failed to write emergency freeze to Redis node: %v", err)
		http.Error(w, "cache_synchronization_failure", http.StatusInternalServerError)
		return
	}

	h.logger.Printf("[PRICE_VALVE_ACTIVATED] Admin overridden key %s set to %s for %d minutes", 
		matrixKey, multiplierValue, req.DurationMins)

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"SURGE_DEFLATION_VALVE_ENGAGED"}`))
}
