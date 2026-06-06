package http

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type SurgeFreezeRequest struct {
	CityPrefix    string  `json:"city_prefix"`
	H3Cell        string  `json:"h3_cell"`
	MaxMultiplier float64 `json:"max_multiplier"`
	DurationMins  int     `json:"duration_minutes"`
}

type FareConfig struct {
	CityPrefix                  string    `json:"city_prefix"`
	CarType                     string    `json:"car_type"`
	TripType                    string    `json:"trip_type"`
	BaseFarePaise               int64     `json:"base_fare_paise"`
	PerKmFarePaise              int64     `json:"per_km_fare_paise"`
	PerMinuteFarePaise          int64     `json:"per_minute_fare_paise"`
	MinimumFarePaise            int64     `json:"minimum_fare_paise"`
	NightChargeStart            string    `json:"night_charge_start"` // "23:00"
	NightChargeEnd              string    `json:"night_charge_end"`   // "05:00"
	NightChargeMultiplier       float64   `json:"night_charge_multiplier"`
	WaitChargeAfterMinutes      int       `json:"wait_charge_after_minutes"`
	WaitChargePerMinutePaise    int64     `json:"wait_charge_per_minute_paise"`
	CancellationFeeRiderPaise   int64     `json:"cancellation_fee_rider_paise"`
	CancellationFeeDriverPaise  int64     `json:"cancellation_fee_driver_paise"`
	D4MCareChargePaise          int64     `json:"d4m_care_charge_paise"`
	OutstationPerDayPaise       int64     `json:"outstation_per_day_paise"`
	OutstationKmOutsideCityPaise int64     `json:"outstation_km_outside_city_paise"`
	OutstationDriverAllowance   int64     `json:"outstation_driver_allowance_paise"`
	OutstationNightHaltPaise    int64     `json:"outstation_night_halt_paise"`
	TaxPercent                  float64   `json:"tax_percent"`
	PlatformFeePaise            int64     `json:"platform_fee_paise"`
	ConvenienceFeePaise         int64     `json:"convenience_fee_paise"`
	EffectiveFrom               time.Time `json:"effective_from"`
	EffectiveTo                 time.Time `json:"effective_to"`
	VersionID                   int64     `json:"version_id"`
	CreatedBy                   string    `json:"created_by"`
	ChangeReason                string    `json:"change_reason"`
	CreatedAt                   time.Time `json:"created_at"`
}

type AutoSurgeRule struct {
	MinDemandSupplyRatio float64 `json:"min_demand_supply_ratio"`
	Multiplier           float64 `json:"multiplier"`
}

type SurgeRules struct {
	AutoRules    []AutoSurgeRule `json:"auto_rules"`
	SurgeCap     float64         `json:"surge_cap"`
	CooldownSecs int             `json:"cooldown_seconds"`
}

type TakeRateTier struct {
	MinTrips   int     `json:"min_trips"`
	MaxTrips   int     `json:"max_trips"`
	TakeRatePct float64 `json:"take_rate_percent"`
}

type CommissionSettings struct {
	CityPrefix            string         `json:"city_prefix"`
	CarType               string         `json:"car_type"`
	ModelType             string         `json:"model_type"` // "TIERED", "SUBSCRIPTION"
	Tiers                 []TakeRateTier `json:"tiers,omitempty"`
	SubscriptionFlatPaise int64          `json:"subscription_flat_paise,omitempty"`
	SubscriptionPeriod    string         `json:"subscription_period,omitempty"` // "DAILY", "WEEKLY"
}

type PricingAdminHandler struct {
	dbPool        *pgxpool.Pool
	clusterClient *redis.ClusterClient
	logger        *log.Logger
}

func NewPricingAdminHandler(dbPool *pgxpool.Pool, clusterClient *redis.ClusterClient, logger *log.Logger) *PricingAdminHandler {
	return &PricingAdminHandler{
		dbPool:        dbPool,
		clusterClient: clusterClient,
		logger:        logger,
	}
}

func (h *PricingAdminHandler) HandleEnforcePriceCap(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

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

	if req.CityPrefix == "" || req.H3Cell == "" || req.MaxMultiplier < 1.0 || req.DurationMins <= 0 {
		http.Error(w, "invalid_override_parameters", http.StatusUnprocessableEntity)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	matrixKey := fmt.Sprintf("surge:matrix:%s:%s", req.CityPrefix, req.H3Cell)
	multiplierValue := strconv.FormatFloat(req.MaxMultiplier, 'f', 4, 64)
	overrideDuration := time.Duration(req.DurationMins) * time.Minute

	err := h.clusterClient.Set(ctx, matrixKey, multiplierValue, overrideDuration).Err()
	if err != nil {
		h.logger.Printf("[CLUSTER_LOCK_EXCEPTION] Failed to write emergency freeze to Redis node: %v", err)
		http.Error(w, "cache_synchronization_failure", http.StatusInternalServerError)
		return
	}

	h.logger.Printf("[PRICE_VALVE_ACTIVATED] Admin overridden key %s set to %s for %d minutes", 
		matrixKey, multiplierValue, req.DurationMins)

	h.recordAuditLog(ctx, "00000000-0000-0000-0000-000000000000", "admin@platform.com", "PRICING_SURGE_FREEZE", 
		fmt.Sprintf("Enforced emergency surge freeze multiplier cap %f on cell %s in city %s", req.MaxMultiplier, req.H3Cell, req.CityPrefix), getClientIP(r))

	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"SURGE_DEFLATION_VALVE_ENGAGED"}`))
}

func (h *PricingAdminHandler) HandleGetFares(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	q := r.URL.Query()
	city := q.Get("city")
	carType := q.Get("car_type")
	tripType := q.Get("trip_type")

	if city == "" || carType == "" || tripType == "" {
		http.Error(w, "missing_query_parameters", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	activeKey := fmt.Sprintf("pricing:fare:active:%s:%s:%s", city, carType, tripType)
	val, err := h.clusterClient.Get(ctx, activeKey).Result()

	var config FareConfig
	if err == nil && val != "" {
		_ = json.Unmarshal([]byte(val), &config)
	} else {
		// Return deterministic defaults
		config = FareConfig{
			CityPrefix:                 city,
			CarType:                    carType,
			TripType:                   tripType,
			BaseFarePaise:              15000,
			PerKmFarePaise:             1800,
			PerMinuteFarePaise:         200,
			MinimumFarePaise:           8000,
			NightChargeStart:           "23:00",
			NightChargeEnd:             "05:00",
			NightChargeMultiplier:      1.25,
			WaitChargeAfterMinutes:      5,
			WaitChargePerMinutePaise:    300,
			CancellationFeeRiderPaise:   5000,
			CancellationFeeDriverPaise:  2000,
			D4MCareChargePaise:          1500,
			TaxPercent:                  5.0,
			PlatformFeePaise:            2000,
			ConvenienceFeePaise:         1000,
			EffectiveFrom:               time.Now(),
			EffectiveTo:                 time.Now().AddDate(1, 0, 0),
			VersionID:                   1,
			CreatedBy:                   "system@platform.com",
			ChangeReason:                "Initial system setup baseline",
			CreatedAt:                   time.Now(),
		}
		if tripType == "outstation" {
			config.OutstationPerDayPaise = 250000
			config.OutstationKmOutsideCityPaise = 2200
			config.OutstationDriverAllowance = 40000
			config.OutstationNightHaltPaise = 20000
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(config)
}

func (h *PricingAdminHandler) HandleGetFareHistory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	q := r.URL.Query()
	city := q.Get("city")
	carType := q.Get("car_type")
	tripType := q.Get("trip_type")

	if city == "" || carType == "" || tripType == "" {
		http.Error(w, "missing_query_parameters", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	historyKey := fmt.Sprintf("pricing:fare:history:%s:%s:%s", city, carType, tripType)
	elements, err := h.clusterClient.LRange(ctx, historyKey, 0, -1).Result()

	var history []FareConfig
	if err == nil {
		for _, el := range elements {
			var config FareConfig
			if err := json.Unmarshal([]byte(el), &config); err == nil {
				history = append(history, config)
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(history)
}

func (h *PricingAdminHandler) HandlePostFare(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req FareConfig
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid_json_body", http.StatusBadRequest)
		return
	}

	if req.CityPrefix == "" || req.CarType == "" || req.TripType == "" {
		http.Error(w, "missing_fare_configuration_triples", http.StatusBadRequest)
		return
	}

	adminEmail := r.Header.Get("X-Admin-Email")
	if adminEmail == "" {
		adminEmail = "admin@platform.com"
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	req.CreatedBy = adminEmail
	req.CreatedAt = time.Now()
	req.VersionID = time.Now().UnixNano()

	activeKey := fmt.Sprintf("pricing:fare:active:%s:%s:%s", req.CityPrefix, req.CarType, req.TripType)
	historyKey := fmt.Sprintf("pricing:fare:history:%s:%s:%s", req.CityPrefix, req.CarType, req.TripType)

	payloadBytes, err := json.Marshal(req)
	if err != nil {
		http.Error(w, "failed_to_serialize_config", http.StatusInternalServerError)
		return
	}

	// Overwrite active config in Redis
	err = h.clusterClient.Set(ctx, activeKey, payloadBytes, 0).Err()
	if err != nil {
		http.Error(w, "redis_write_failed", http.StatusInternalServerError)
		return
	}

	// Push to version history list in Redis
	_ = h.clusterClient.LPush(ctx, historyKey, payloadBytes).Err()

	h.recordAuditLog(ctx, "00000000-0000-0000-0000-000000000000", adminEmail, "FARE_CONFIG_VERSIONED", 
		fmt.Sprintf("Created version %d for city %s class %s (%s). Reason: %s", req.VersionID, req.CityPrefix, req.CarType, req.TripType, req.ChangeReason), getClientIP(r))

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"status":"SUCCESS"}`))
}

func (h *PricingAdminHandler) HandleRevertFare(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	type RevertRequest struct {
		CityPrefix string `json:"city_prefix"`
		CarType    string `json:"car_type"`
		TripType   string `json:"trip_type"`
		VersionID  int64  `json:"version_id"`
	}

	var req RevertRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid_json_body", http.StatusBadRequest)
		return
	}

	if req.CityPrefix == "" || req.CarType == "" || req.TripType == "" || req.VersionID == 0 {
		http.Error(w, "missing_reversion_parameters", http.StatusBadRequest)
		return
	}

	adminEmail := r.Header.Get("X-Admin-Email")
	if adminEmail == "" {
		adminEmail = "admin@platform.com"
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	activeKey := fmt.Sprintf("pricing:fare:active:%s:%s:%s", req.CityPrefix, req.CarType, req.TripType)
	historyKey := fmt.Sprintf("pricing:fare:history:%s:%s:%s", req.CityPrefix, req.CarType, req.TripType)

	elements, err := h.clusterClient.LRange(ctx, historyKey, 0, -1).Result()
	if err != nil {
		http.Error(w, "reversion_history_fetch_failed", http.StatusInternalServerError)
		return
	}

	var foundConfig *FareConfig
	for _, el := range elements {
		var config FareConfig
		if err := json.Unmarshal([]byte(el), &config); err == nil && config.VersionID == req.VersionID {
			foundConfig = &config
			break
		}
	}

	if foundConfig == nil {
		http.Error(w, "version_not_found", http.StatusNotFound)
		return
	}

	// Update active configuration key
	foundConfig.CreatedAt = time.Now()
	foundConfig.CreatedBy = adminEmail
	foundConfig.ChangeReason = fmt.Sprintf("Rollback to historic version: %d", req.VersionID)

	revertedBytes, _ := json.Marshal(foundConfig)
	_ = h.clusterClient.Set(ctx, activeKey, revertedBytes, 0).Err()
	_ = h.clusterClient.LPush(ctx, historyKey, revertedBytes).Err()

	h.recordAuditLog(ctx, "00000000-0000-0000-0000-000000000000", adminEmail, "FARE_CONFIG_REVERTED", 
		fmt.Sprintf("Reverted active configuration for %s %s to historical version %d", req.CityPrefix, req.CarType, req.VersionID), getClientIP(r))

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"status":"SUCCESS"}`))
}

func (h *PricingAdminHandler) HandleGetSurgeRules(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	rulesKey := "pricing:surge:rules"
	val, err := h.clusterClient.Get(ctx, rulesKey).Result()

	var rules SurgeRules
	if err == nil && val != "" {
		_ = json.Unmarshal([]byte(val), &rules)
	} else {
		// Default rules
		rules = SurgeRules{
			AutoRules: []AutoSurgeRule{
				{MinDemandSupplyRatio: 1.1, Multiplier: 1.15},
				{MinDemandSupplyRatio: 1.3, Multiplier: 1.35},
				{MinDemandSupplyRatio: 1.6, Multiplier: 1.60},
				{MinDemandSupplyRatio: 2.0, Multiplier: 2.00},
			},
			SurgeCap:     3.5,
			CooldownSecs: 600,
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(rules)
}

func (h *PricingAdminHandler) HandlePostSurgeRules(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req SurgeRules
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid_json_body", http.StatusBadRequest)
		return
	}

	adminEmail := r.Header.Get("X-Admin-Email")
	if adminEmail == "" {
		adminEmail = "admin@platform.com"
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	rulesKey := "pricing:surge:rules"
	payloadBytes, err := json.Marshal(req)
	if err != nil {
		http.Error(w, "failed_to_serialize_surge_rules", http.StatusInternalServerError)
		return
	}

	err = h.clusterClient.Set(ctx, rulesKey, payloadBytes, 0).Err()
	if err != nil {
		http.Error(w, "redis_write_failed", http.StatusInternalServerError)
		return
	}

	h.recordAuditLog(ctx, "00000000-0000-0000-0000-000000000000", adminEmail, "SURGE_RULES_UPDATED", 
		fmt.Sprintf("Updated automated surge parameters. Surge Cap: %fx, Cooldown: %ds", req.SurgeCap, req.CooldownSecs), getClientIP(r))

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"status":"SUCCESS"}`))
}

func (h *PricingAdminHandler) HandleGetCommission(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	q := r.URL.Query()
	city := q.Get("city")
	carType := q.Get("car_type")

	if city == "" || carType == "" {
		http.Error(w, "missing_query_parameters", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	commKey := fmt.Sprintf("pricing:commission:%s:%s", city, carType)
	val, err := h.clusterClient.Get(ctx, commKey).Result()

	var settings CommissionSettings
	if err == nil && val != "" {
		_ = json.Unmarshal([]byte(val), &settings)
	} else {
		// Mock default tiered commissions
		settings = CommissionSettings{
			CityPrefix: city,
			CarType:    carType,
			ModelType:  "TIERED",
			Tiers: []TakeRateTier{
				{MinTrips: 0, MaxTrips: 15, TakeRatePct: 20.0},
				{MinTrips: 16, MaxTrips: 50, TakeRatePct: 15.0},
				{MinTrips: 51, MaxTrips: 9999, TakeRatePct: 12.0},
			},
			SubscriptionFlatPaise: 5000,
			SubscriptionPeriod:    "DAILY",
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(settings)
}

func (h *PricingAdminHandler) HandlePostCommission(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req CommissionSettings
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid_json_body", http.StatusBadRequest)
		return
	}

	if req.CityPrefix == "" || req.CarType == "" || req.ModelType == "" {
		http.Error(w, "missing_parameters", http.StatusBadRequest)
		return
	}

	adminEmail := r.Header.Get("X-Admin-Email")
	if adminEmail == "" {
		adminEmail = "admin@platform.com"
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	commKey := fmt.Sprintf("pricing:commission:%s:%s", req.CityPrefix, req.CarType)
	payloadBytes, err := json.Marshal(req)
	if err != nil {
		http.Error(w, "failed_to_serialize_commission_settings", http.StatusInternalServerError)
		return
	}

	err = h.clusterClient.Set(ctx, commKey, payloadBytes, 0).Err()
	if err != nil {
		http.Error(w, "redis_write_failed", http.StatusInternalServerError)
		return
	}

	h.recordAuditLog(ctx, "00000000-0000-0000-0000-000000000000", adminEmail, "DRIVER_COMMISSION_UPDATED", 
		fmt.Sprintf("Updated take-rate model for %s %s to %s", req.CityPrefix, req.CarType, req.ModelType), getClientIP(r))

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"status":"SUCCESS"}`))
}

func (h *PricingAdminHandler) recordAuditLog(ctx context.Context, adminID string, email string, action string, details string, ip string) {
	if h.dbPool == nil {
		return
	}
	query := `
		INSERT INTO admin_audit_logs (admin_id, admin_email, action, details, ip_address)
		VALUES ($1, $2, $3, $4, $5)
	`
	var idVal interface{} = adminID
	if adminID == "" {
		idVal = "00000000-0000-0000-0000-000000000000"
	}
	_, _ = h.dbPool.Exec(ctx, query, idVal, email, action, details, ip)
}
