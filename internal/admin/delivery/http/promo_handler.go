package http

import (
	"context"
	"crypto/rand"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type PromoHandler struct {
	dbPool      *pgxpool.Pool
	redisClient *redis.ClusterClient
	logger      *log.Logger
}

func NewPromoHandler(dbPool *pgxpool.Pool, redisClient *redis.ClusterClient, logger *log.Logger) *PromoHandler {
	return &PromoHandler{
		dbPool:      dbPool,
		redisClient: redisClient,
		logger:      logger,
	}
}

type PromoCode struct {
	Code              string    `json:"code"`
	PromoType         string    `json:"promo_type"` // PERCENT, FLAT, FREE_RIDE, CASHBACK, FIRST_RIDE
	Value             float64   `json:"value"`      // discount % or flat rupees
	MaxDiscountPaise  int64     `json:"max_discount_paise"`
	MinFarePaise      int64     `json:"min_fare_paise"`
	TripTypes         []string  `json:"trip_types"`
	CarTypes          []string  `json:"car_types"`
	Cities            []string  `json:"cities"`
	PaymentMethods    []string  `json:"payment_methods"`
	UserSegment       string    `json:"user_segment"` // ALL, NEW, VIP
	UsageCapTotal     int       `json:"usage_cap_total"`
	UsageCapPerUser   int       `json:"usage_cap_per_user"`
	ValidFrom         time.Time `json:"valid_from"`
	ValidTo           time.Time `json:"valid_to"`
	Stackable         bool      `json:"stackable"`
	Status            string    `json:"status"` // DRAFT, SCHEDULED, ACTIVE, PAUSED, EXPIRED
	RedemptionsCount  int       `json:"redemptions_count"`
	CreatedAt         time.Time `json:"created_at"`
}

type BannerOffer struct {
	ID         string    `json:"id"`
	BannerText string    `json:"banner_text"`
	CityPrefix string    `json:"city_prefix"`
	IsActive   bool      `json:"is_active"`
	ValidFrom  time.Time `json:"valid_from"`
	ValidTo    time.Time `json:"valid_to"`
}

type ReferralRule struct {
	ReferrerRole string `json:"referrer_role"` // RIDER, DRIVER
	RefereeRole  string `json:"referee_role"`  // RIDER, DRIVER
	TriggerType  string `json:"trigger_type"`  // SIGNUP, FIRST_TRIP, NTH_TRIP
	TriggerCount int    `json:"trigger_count"`
	RewardType   string `json:"reward_type"` // WALLET_CREDIT, FREE_RIDE, CASH
	RewardAmount int64  `json:"reward_amount_paise"`
}

type ReferralSettings struct {
	Rules          []ReferralRule `json:"rules"`
	BlockSameDevice bool           `json:"block_same_device"`
	BlockIPCluster  bool           `json:"block_ip_cluster"`
}

type LoyaltyTier struct {
	TierName         string  `json:"tier_name"` // SILVER, GOLD, PLATINUM
	MinTrips         int     `json:"min_trips"`
	PerkDiscountPct  float64 `json:"perk_discount_percent"`
	PerkPriorityDisp bool    `json:"perk_priority_dispatch"`
	PerkFreeCare     bool    `json:"perk_free_care"`
}

type LoyaltySettings struct {
	Tiers []LoyaltyTier `json:"tiers"`
}

type PromoAnalytics struct {
	Code         string  `json:"code"`
	Redemptions  int     `json:"redemptions"`
	GMVImpact    int64   `json:"gmv_impact_paise"`
	MarketingROI float64 `json:"marketing_roi_percent"`
}

func (h *PromoHandler) HandleGetPromos(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// Canonical promo_codes table — the same store the booking/fare path reads and
	// writes. No Redis index, no hardcoded WELCOME50/SAVEMORE fallback.
	rows, err := h.dbPool.Query(ctx, `
		SELECT code, discount_type, discount_value, max_discount_paise, min_fare_paise,
		       max_redemptions, per_rider_limit, total_redeemed, COALESCE(city_prefix, ''),
		       valid_from, valid_until, is_active, created_at
		FROM promo_codes
		ORDER BY created_at DESC`)
	if err != nil {
		h.logger.Printf("[PROMOS_ERROR] promo_codes query failed: %v", err)
		http.Error(w, "database_query_failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	promos := make([]PromoCode, 0)
	now := time.Now()
	for rows.Next() {
		var code, dtype, city string
		var dvalue, maxDisc, minFare int64
		var totalRedeemed, perUser int
		var maxRed *int
		var validFrom, createdAt time.Time
		var validUntil *time.Time
		var isActive bool
		if err := rows.Scan(&code, &dtype, &dvalue, &maxDisc, &minFare, &maxRed, &perUser,
			&totalRedeemed, &city, &validFrom, &validUntil, &isActive, &createdAt); err != nil {
			continue
		}
		// discount_value stores paise for FLAT, the percent for PERCENT.
		value := float64(dvalue)
		if dtype == "FLAT" {
			value = float64(dvalue) / 100.0
		}
		status := "ACTIVE"
		if !isActive {
			status = "PAUSED"
		} else if validUntil != nil && validUntil.Before(now) {
			status = "EXPIRED"
		}
		cities := []string{}
		if city != "" {
			cities = []string{city}
		}
		validTo := time.Time{}
		if validUntil != nil {
			validTo = *validUntil
		}
		capTotal := 0
		if maxRed != nil {
			capTotal = *maxRed
		}
		// Targeting fields (trip/car/payment/segment/stackable) have no column in
		// promo_codes yet, so they come back as empty defaults.
		promos = append(promos, PromoCode{
			Code: code, PromoType: dtype, Value: value,
			MaxDiscountPaise: maxDisc, MinFarePaise: minFare,
			TripTypes: []string{}, CarTypes: []string{}, Cities: cities, PaymentMethods: []string{},
			UserSegment: "ALL", UsageCapTotal: capTotal, UsageCapPerUser: perUser,
			ValidFrom: validFrom, ValidTo: validTo, Stackable: false,
			Status: status, RedemptionsCount: totalRedeemed, CreatedAt: createdAt,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(promos)
}

func (h *PromoHandler) HandlePostPromo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req PromoCode
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid_json_body", http.StatusBadRequest)
		return
	}

	if req.Code == "" || req.PromoType == "" {
		http.Error(w, "missing_required_fields", http.StatusBadRequest)
		return
	}

	// Reject "discount forever" / unlimited promos. A promo must have a future expiry,
	// a coherent validity window, a positive value, and a total usage cap.
	now := time.Now()
	if req.ValidFrom.IsZero() {
		req.ValidFrom = now
	}
	if req.ValidTo.IsZero() || !req.ValidTo.After(now) {
		http.Error(w, "promo_valid_to_must_be_in_future", http.StatusUnprocessableEntity)
		return
	}
	if !req.ValidTo.After(req.ValidFrom) {
		http.Error(w, "promo_valid_to_must_be_after_valid_from", http.StatusUnprocessableEntity)
		return
	}
	if req.Value <= 0 {
		http.Error(w, "promo_value_must_be_positive", http.StatusUnprocessableEntity)
		return
	}
	if req.UsageCapTotal <= 0 {
		http.Error(w, "promo_usage_cap_total_required", http.StatusUnprocessableEntity)
		return
	}

	adminEmail := r.Header.Get("X-Admin-Email")
	if adminEmail == "" {
		adminEmail = "admin@platform.com"
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	req.Code = strings.ToUpper(strings.TrimSpace(req.Code))
	if req.Status == "" {
		req.Status = "ACTIVE"
	}
	req.CreatedAt = time.Now()

	discountType := "FLAT"
	if strings.EqualFold(req.PromoType, "PERCENT") {
		discountType = "PERCENT"
	}
	discountValue := int64(req.Value)
	if discountType == "FLAT" {
		discountValue = int64(req.Value * 100) // admin sends flat rupees; promo_codes stores paise
	}
	perUser := req.UsageCapPerUser
	if perUser <= 0 {
		perUser = 1
	}
	isActive := req.Status == "" || strings.EqualFold(req.Status, "ACTIVE")

	// Upsert into the canonical promo_codes table the booking/fare path reads. Targeting
	// fields (trip/car/payment/segment/stackable) have no column yet and aren't persisted.
	if _, err := h.dbPool.Exec(ctx, `
		INSERT INTO promo_codes (code, discount_type, discount_value, max_discount_paise,
			min_fare_paise, max_redemptions, per_rider_limit, valid_from, valid_until, is_active)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (code) DO UPDATE SET
			discount_type = EXCLUDED.discount_type, discount_value = EXCLUDED.discount_value,
			max_discount_paise = EXCLUDED.max_discount_paise, min_fare_paise = EXCLUDED.min_fare_paise,
			max_redemptions = EXCLUDED.max_redemptions, per_rider_limit = EXCLUDED.per_rider_limit,
			valid_from = EXCLUDED.valid_from, valid_until = EXCLUDED.valid_until,
			is_active = EXCLUDED.is_active, updated_at = now()`,
		req.Code, discountType, discountValue, req.MaxDiscountPaise, req.MinFarePaise,
		req.UsageCapTotal, perUser, req.ValidFrom, req.ValidTo, isActive); err != nil {
		h.logger.Printf("[PROMOS_ERROR] promo_codes upsert failed: %v", err)
		http.Error(w, "database_write_failed", http.StatusInternalServerError)
		return
	}

	h.recordAuditLog(ctx, "00000000-0000-0000-0000-000000000000", adminEmail, "PROMO_CODE_CREATED",
		fmt.Sprintf("Created promo code %s type %s value %f status %s", req.Code, req.PromoType, req.Value, req.Status), getClientIP(r))

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"status":"SUCCESS"}`))
}

func (h *PromoHandler) HandlePostPromosBulk(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	adminEmail := r.Header.Get("X-Admin-Email")
	if adminEmail == "" {
		adminEmail = "admin@platform.com"
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var reader *csv.Reader

	// Check if upload is a multipart form file or raw text body
	if strings.Contains(r.Header.Get("Content-Type"), "multipart/form-data") {
		file, _, err := r.FormFile("file")
		if err != nil {
			http.Error(w, "multipart_file_upload_failed", http.StatusBadRequest)
			return
		}
		defer file.Close()
		reader = csv.NewReader(file)
	} else {
		// Read directly from raw body string
		reader = csv.NewReader(r.Body)
	}

	records, err := reader.ReadAll()
	if err != nil {
		http.Error(w, "csv_parsing_failed", http.StatusBadRequest)
		return
	}

	successCount := 0
	for idx, row := range records {
		// Skip header if matches format
		if idx == 0 && (strings.EqualFold(row[0], "code") || strings.EqualFold(row[0], "promocode")) {
			continue
		}
		if len(row) < 3 {
			continue
		}

		code := strings.ToUpper(strings.TrimSpace(row[0]))
		pType := strings.ToUpper(strings.TrimSpace(row[1]))
		val, _ := strconv.ParseFloat(row[2], 64)

		minFare := int64(5000) // Default 50 rupees
		if len(row) > 3 {
			if f, err := strconv.ParseInt(row[3], 10, 64); err == nil {
				minFare = f
			}
		}

		discountType := "FLAT"
		if strings.EqualFold(pType, "PERCENT") {
			discountType = "PERCENT"
		}
		discountValue := int64(val)
		if discountType == "FLAT" {
			discountValue = int64(val * 100)
		}
		if _, err := h.dbPool.Exec(ctx, `
			INSERT INTO promo_codes (code, discount_type, discount_value, min_fare_paise,
				max_discount_paise, per_rider_limit, valid_from, valid_until, is_active)
			VALUES ($1, $2, $3, $4, 15000, 1, now(), now() + interval '1 year', true)
			ON CONFLICT (code) DO NOTHING`,
			code, discountType, discountValue, minFare); err == nil {
			successCount++
		}
	}

	h.recordAuditLog(ctx, "00000000-0000-0000-0000-000000000000", adminEmail, "PROMO_CODES_BULK_UPLOAD", 
		fmt.Sprintf("Bulk parsed and uploaded %d promo codes via CSV import stream", successCount), getClientIP(r))

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(fmt.Sprintf(`{"status":"SUCCESS", "uploaded_count":%d}`, successCount)))
}

func (h *PromoHandler) HandlePostPromoState(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	code := r.PathValue("code")
	if code == "" {
		http.Error(w, "missing_promo_code", http.StatusBadRequest)
		return
	}

	type StateRequest struct {
		Status string `json:"status"` // ACTIVE, PAUSED, EXPIRED
	}

	var req StateRequest
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

	// ACTIVE -> is_active true; PAUSED/EXPIRED -> false. The booking path reads is_active.
	isActive := strings.EqualFold(req.Status, "ACTIVE")
	tag, err := h.dbPool.Exec(ctx,
		`UPDATE promo_codes SET is_active = $1, updated_at = now() WHERE code = $2`,
		isActive, strings.ToUpper(strings.TrimSpace(code)))
	if err != nil {
		http.Error(w, "database_write_failed", http.StatusInternalServerError)
		return
	}
	if tag.RowsAffected() == 0 {
		http.Error(w, "promo_not_found", http.StatusNotFound)
		return
	}

	h.recordAuditLog(ctx, "00000000-0000-0000-0000-000000000000", adminEmail, "PROMO_STATE_TRANSITION",
		fmt.Sprintf("Transited promo code %s state to %s", code, req.Status), getClientIP(r))

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"status":"SUCCESS"}`))
}

func (h *PromoHandler) HandleGetPromoAnalytics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	code := r.PathValue("code")
	if code == "" {
		http.Error(w, "missing_promo_code", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var promoID string
	if err := h.dbPool.QueryRow(ctx, `SELECT id::text FROM promo_codes WHERE code = $1`,
		strings.ToUpper(strings.TrimSpace(code))).Scan(&promoID); err != nil {
		http.Error(w, "promo_not_found", http.StatusNotFound)
		return
	}

	// Real redemptions + GMV from the orders those redemptions belong to.
	var redemptions int
	var gmvImpactPaise int64
	_ = h.dbPool.QueryRow(ctx, `
		SELECT COUNT(*), COALESCE(SUM(o.base_fare_paise), 0)
		FROM promo_redemptions pr
		LEFT JOIN orders o ON o.id = pr.order_id
		WHERE pr.promo_code_id = $1::uuid`, promoID).Scan(&redemptions, &gmvImpactPaise)

	// MarketingROI has no cost/attribution source — report 0 rather than a hash invention.
	analytics := PromoAnalytics{
		Code:         code,
		Redemptions:  redemptions,
		GMVImpact:    gmvImpactPaise,
		MarketingROI: 0,
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(analytics)
}

func (h *PromoHandler) HandleGetBanners(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	val, err := h.redisClient.Get(ctx, "promo:banners").Result()
	var banners []BannerOffer
	if err == nil && val != "" {
		_ = json.Unmarshal([]byte(val), &banners)
	} else {
		// Mock defaults
		banners = []BannerOffer{
			{
				ID:         "banner-1",
				BannerText: "Monsoon Surge deflated: Get 20% off auto-applied on all Premium trips in Kolkata shard this weekend!",
				CityPrefix: "KOL",
				IsActive:   true,
				ValidFrom:  time.Now(),
				ValidTo:    time.Now().AddDate(0, 0, 5),
			},
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(banners)
}

func (h *PromoHandler) HandlePostBanners(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req []BannerOffer
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

	payloadBytes, err := json.Marshal(req)
	if err != nil {
		http.Error(w, "failed_to_serialize_banners", http.StatusInternalServerError)
		return
	}

	err = h.redisClient.Set(ctx, "promo:banners", payloadBytes, 0).Err()
	if err != nil {
		http.Error(w, "redis_write_failed", http.StatusInternalServerError)
		return
	}

	h.recordAuditLog(ctx, "00000000-0000-0000-0000-000000000000", adminEmail, "BANNERS_CONFIG_UPDATED", 
		"Updated auto-applied app promotional banners", getClientIP(r))

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"status":"SUCCESS"}`))
}

func (h *PromoHandler) HandleGetReferralSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	val, err := h.redisClient.Get(ctx, "promo:referral:settings").Result()
	var settings ReferralSettings
	if err == nil && val != "" {
		_ = json.Unmarshal([]byte(val), &settings)
	} else {
		// Mock defaults
		settings = ReferralSettings{
			BlockSameDevice: true,
			BlockIPCluster:  true,
			Rules: []ReferralRule{
				{
					ReferrerRole: "RIDER",
					RefereeRole:  "RIDER",
					TriggerType:  "FIRST_TRIP",
					TriggerCount: 1,
					RewardType:   "WALLET_CREDIT",
					RewardAmount: 10000, // ₹100
				},
				{
					ReferrerRole: "RIDER",
					RefereeRole:  "DRIVER",
					TriggerType:  "NTH_TRIP",
					TriggerCount: 5,
					RewardType:   "CASH",
					RewardAmount: 50000, // ₹500
				},
			},
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(settings)
}

func (h *PromoHandler) HandlePostReferralSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req ReferralSettings
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

	payloadBytes, err := json.Marshal(req)
	if err != nil {
		http.Error(w, "failed_to_serialize_referral_settings", http.StatusInternalServerError)
		return
	}

	err = h.redisClient.Set(ctx, "promo:referral:settings", payloadBytes, 0).Err()
	if err != nil {
		http.Error(w, "redis_write_failed", http.StatusInternalServerError)
		return
	}

	h.recordAuditLog(ctx, "00000000-0000-0000-0000-000000000000", adminEmail, "REFERRAL_RULES_UPDATED", 
		"Updated referral reward triggers and fraud parameters", getClientIP(r))

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"status":"SUCCESS"}`))
}

func (h *PromoHandler) HandleGetLoyaltySettings(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	val, err := h.redisClient.Get(ctx, "promo:loyalty:settings").Result()
	var settings LoyaltySettings
	if err == nil && val != "" {
		_ = json.Unmarshal([]byte(val), &settings)
	} else {
		// Mock defaults
		settings = LoyaltySettings{
			Tiers: []LoyaltyTier{
				{TierName: "SILVER", MinTrips: 10, PerkDiscountPct: 5.0, PerkPriorityDisp: false, PerkFreeCare: false},
				{TierName: "GOLD", MinTrips: 25, PerkDiscountPct: 10.0, PerkPriorityDisp: true, PerkFreeCare: false},
				{TierName: "PLATINUM", MinTrips: 50, PerkDiscountPct: 15.0, PerkPriorityDisp: true, PerkFreeCare: true},
			},
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(settings)
}

func (h *PromoHandler) HandlePostLoyaltySettings(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req LoyaltySettings
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

	payloadBytes, err := json.Marshal(req)
	if err != nil {
		http.Error(w, "failed_to_serialize_loyalty_settings", http.StatusInternalServerError)
		return
	}

	err = h.redisClient.Set(ctx, "promo:loyalty:settings", payloadBytes, 0).Err()
	if err != nil {
		http.Error(w, "redis_write_failed", http.StatusInternalServerError)
		return
	}

	h.recordAuditLog(ctx, "00000000-0000-0000-0000-000000000000", adminEmail, "LOYALTY_TIERS_UPDATED", 
		"Updated loyalty tier trip thresholds and perks matrices", getClientIP(r))

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"status":"SUCCESS"}`))
}

func (h *PromoHandler) recordAuditLog(ctx context.Context, adminID string, email string, action string, details string, ip string) {
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

// promoCharset excludes ambiguous chars (0/O, 1/I/L) for readable codes.
const promoCharset = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

// HandleGeneratePromoCode returns a unique 8-char alphanumeric promo code, checking
// the promo_codes table for collisions before returning (rule 3 — uniqueness).
// GET /api/v1/admin/promo-codes/generate
func (h *PromoHandler) HandleGeneratePromoCode(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	var code string
	for attempt := 0; attempt < 12; attempt++ {
		buf := make([]byte, 8)
		if _, err := rand.Read(buf); err != nil {
			http.Error(w, "code_generation_failed", http.StatusInternalServerError)
			return
		}
		b := make([]byte, 8)
		for i := range buf {
			b[i] = promoCharset[int(buf[i])%len(promoCharset)]
		}
		code = string(b)
		var exists bool
		if err := h.dbPool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM promo_codes WHERE code = $1)", code).Scan(&exists); err != nil {
			http.Error(w, "uniqueness_check_failed", http.StatusInternalServerError)
			return
		}
		if !exists {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]string{"code": code})
			return
		}
	}
	http.Error(w, "could_not_generate_unique_code", http.StatusInternalServerError)
}
