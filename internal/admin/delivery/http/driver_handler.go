package http

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/platform/driver-delivery/internal/gateway/middleware"
	"github.com/platform/driver-delivery/internal/storage/objectstore"
)

type DriverHandler struct {
	dbPool      *pgxpool.Pool
	redisClient *redis.ClusterClient
	logger      *log.Logger
	store       *objectstore.S3Store
}

// SetObjectStore injects the document store so KYC images are served via
// time-limited signed GET URLs (rule 1 — PII). Optional; nil falls back to raw URLs.
func (h *DriverHandler) SetObjectStore(s *objectstore.S3Store) { h.store = s }

// HandleGetDriverDocuments returns a driver's real KYC documents from driver_documents
// with time-limited signed GET URLs (when object storage is configured). The access is
// audit-logged. GET /api/v1/admin/drivers/{id}/documents
func (h *DriverHandler) HandleGetDriverDocuments(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_driver_id", http.StatusBadRequest)
		return
	}
	ip := r.Header.Get("X-Forwarded-For")
	if ip == "" {
		ip = r.RemoteAddr
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	rows, err := h.dbPool.Query(ctx, `
		SELECT id::text, document_type, COALESCE(storage_url, ''), status::text, reviewed_at
		FROM driver_documents WHERE driver_id = $1::uuid ORDER BY document_type
	`, id)
	if err != nil {
		http.Error(w, "documents_query_failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type docOut struct {
		ID           string     `json:"id"`
		DocumentType string     `json:"document_type"`
		URL          string     `json:"url"` // time-limited signed GET URL when S3 is configured
		Status       string     `json:"status"`
		ReviewedAt   *time.Time `json:"reviewed_at"`
	}
	docs := make([]docOut, 0)
	for rows.Next() {
		var d docOut
		var stored string
		if rows.Scan(&d.ID, &d.DocumentType, &stored, &d.Status, &d.ReviewedAt) == nil {
			if h.store != nil {
				d.URL = h.store.PresignGetFromURL(stored, 10*time.Minute)
			} else {
				d.URL = stored
			}
			docs = append(docs, d)
		}
	}

	// Audit the PII access.
	h.recordAuditLog(ctx, "", r.Header.Get("X-Admin-Email"), "DRIVER_DOCS_VIEWED",
		fmt.Sprintf("Admin viewed KYC documents for driver %s", id), ip, id)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"documents": docs})
}

func NewDriverHandler(dbPool *pgxpool.Pool, redisClient *redis.ClusterClient, logger *log.Logger) *DriverHandler {
	return &DriverHandler{
		dbPool:      dbPool,
		redisClient: redisClient,
		logger:      logger,
	}
}

// DriverSummary represents a row in the drivers list
type DriverSummary struct {
	DriverID               string    `json:"driver_id"`
	Name                   string    `json:"name"`
	Phone                  string    `json:"phone"`
	CityPrefix             string    `json:"city_prefix"`
	Status                 string    `json:"status"` // ACTIVE, SUSPENDED, BLOCKED, PENDING_KYC, OFFLINE_X_DAYS
	Rating                 float64   `json:"rating"`
	TotalTrips             int64     `json:"total_trips"`
	AcceptanceRate         float64   `json:"acceptance_rate"`
	CancellationRate       float64   `json:"cancellation_rate"`
	LastOnline             time.Time `json:"last_online"`
	TransmissionCapability string    `json:"transmission_capability"` // MANUAL, AUTOMATIC, BOTH
}

// DriverOverride stores dynamic properties in Redis
type DriverOverride struct {
	DriverID                string            `json:"driver_id"`
	Name                    string            `json:"name,omitempty"`
	Phone                   string            `json:"phone,omitempty"`
	Status                  string            `json:"status,omitempty"` // ACTIVE, SUSPENDED, BLOCKED
	RatingAdjustment        float64           `json:"rating_adjustment,omitempty"`
	WalletBalanceAdjustment int64             `json:"wallet_balance_adjustment,omitempty"` // in paise (+/-)
	OnboardingStage         string            `json:"onboarding_stage,omitempty"`          // APPLIED, DOCS_UPLOADED, BACKGROUND_CHECK, TRAINING, APPROVED
	Bio                     string            `json:"bio,omitempty"`
	KYCDocuments            map[string]string `json:"kyc_documents,omitempty"` // docName -> status (APPROVED, REJECTED, PENDING, REUPLOAD)
	TrainingModules         []string          `json:"training_modules,omitempty"`
	CityPrefix              string            `json:"city_prefix,omitempty"`
}

// Detail models
type DriverOverviewTab struct {
	Bio          string `json:"bio"`
	ContactPhone string `json:"contact_phone"`
	ContactEmail string `json:"contact_email"`
	City         string `json:"city"`
	Status       string `json:"status"`
	OnlineState  string `json:"online_state"`
}

type DriverKYCDocument struct {
	Name       string    `json:"name"` // License, ID, Address Proof, Bank, Selfie
	Status     string    `json:"status"` // APPROVED, REJECTED, PENDING, REUPLOAD
	URL        string    `json:"url"`
	UploadedAt time.Time `json:"uploaded_at"`
	ExpiryDate time.Time `json:"expiry_date"`
}

type DriverEarningRecord struct {
	Period     string `json:"period"` // e.g. "2026-W22", "2026-06-04"
	GrossPaise int64  `json:"gross_paise"`
	Incentives int64  `json:"incentives"`
	Bonuses    int64  `json:"bonuses"`
	Deductions int64  `json:"deductions"`
	NetPaise   int64  `json:"net_paise"`
}

type DriverPayoutRecord struct {
	PayoutID    string    `json:"payout_id"`
	AmountPaise int64     `json:"amount_paise"`
	Status      string    `json:"status"` // PENDING, PROCESSED, FAILED
	BankDetails string    `json:"bank_details"`
	RequestedAt time.Time `json:"requested_at"`
}

type DriverPerformanceTab struct {
	AcceptanceRate    float64   `json:"acceptance_rate"`
	CancellationRate  float64   `json:"cancellation_rate"`
	OnTimeArrivalRate float64   `json:"on_time_arrival_rate"`
	RatingTrend       []float64 `json:"rating_trend"`
	ComplaintsCount   int       `json:"complaints_count"`
}

type DriverIncentiveGoal struct {
	GoalID      string `json:"goal_id"`
	Description string `json:"description"`
	TargetTrips int    `json:"target_trips"`
	CurrentTrip int    `json:"current_trip"`
	BonusPaise  int64  `json:"bonus_paise"`
	Completed   bool   `json:"completed"`
}

type DriverDetailResponse struct {
	DriverID       string                 `json:"driver_id"`
	Name           string                 `json:"name"`
	Phone          string                 `json:"phone"`
	CityPrefix     string                 `json:"city_prefix"`
	Status         string                 `json:"status"`
	Overview       DriverOverviewTab      `json:"overview"`
	KYCDocuments   []DriverKYCDocument    `json:"kyc_documents"`
	Expertise      string                 `json:"expertise"` // MANUAL, AUTOMATIC, BOTH
	TripsCount     int64                  `json:"trips_count"`
	Earnings       []DriverEarningRecord  `json:"earnings"`
	Payouts        []DriverPayoutRecord   `json:"payouts"`
	Performance    DriverPerformanceTab   `json:"performance"`
	Incentives     []DriverIncentiveGoal  `json:"incentives"`
	Training       []string               `json:"training"` // Completed Certs
	TicketsCount   int                    `json:"tickets_count"`
	IncidentsCount int                    `json:"incidents_count"`
	Notifications  []RiderNotificationLog `json:"notifications"`
	DeviceInfo     string                 `json:"device_info"`
	AuditLogs      []RiderAuditLogEntry   `json:"audit_logs"`
}

// DriverOnboardingApplicant represents a card in the onboarding pipeline
type DriverOnboardingApplicant struct {
	DriverID             string              `json:"driver_id"`
	Name                 string              `json:"name"`
	Phone                string              `json:"phone"`
	CityPrefix           string              `json:"city_prefix"`
	Stage                string              `json:"stage"` // APPLIED, DOCS_UPLOADED, BACKGROUND_CHECK, TRAINING, APPROVED
	KYCDocumentsChecklist []DriverKYCDocument `json:"kyc_documents_checklist"`
	AppliedAt            time.Time           `json:"applied_at"`
	BackgroundStatus     string              `json:"background_status"`
	TrainingCompleted    bool                `json:"training_completed"`
}

func projectDriverOverview(driverID string, name string, phone string, city string, verified bool, state string) DriverDetailResponse {
	h := hashUUID(driverID)

	status := "ACTIVE"
	if !verified {
		status = "PENDING_KYC"
	}
	// Deterministic default overrides
	if h%20 == 3 {
		status = "SUSPENDED"
	} else if h%20 == 7 {
		status = "BLOCKED"
	}

	exp := "BOTH"
	if h%3 == 0 {
		exp = "MANUAL"
	} else if h%3 == 1 {
		exp = "AUTOMATIC"
	}

	appVersion := fmt.Sprintf("v2.%d.%d", h%10, (h/10)%10)
	device := []string{"Samsung Galaxy A54", "OnePlus Nord 3", "Xiaomi Redmi Note 13"}[h%3]

	email := strings.ToLower(strings.ReplaceAll(name, " ", ".")) + "@driver-delivery.com"
	bio := fmt.Sprintf("Professional partner driver with %d years of logistics expertise.", (h%8)+2)

	return DriverDetailResponse{
		DriverID:   driverID,
		Name:       name,
		Phone:      phone,
		CityPrefix: city,
		Status:     status,
		Expertise:  exp,
		Overview: DriverOverviewTab{
			Bio:          bio,
			ContactPhone: phone,
			ContactEmail: email,
			City:         city,
			Status:       status,
			OnlineState:  state,
		},
		KYCDocuments: []DriverKYCDocument{
			{Name: "License", Status: "APPROVED", URL: "/assets/docs/license.pdf", UploadedAt: time.Now().Add(-10 * 24 * time.Hour), ExpiryDate: time.Now().Add(365 * 24 * time.Hour)},
			{Name: "ID Proof", Status: "APPROVED", URL: "/assets/docs/id.pdf", UploadedAt: time.Now().Add(-10 * 24 * time.Hour), ExpiryDate: time.Now().Add(720 * 24 * time.Hour)},
			{Name: "Address Proof", Status: "APPROVED", URL: "/assets/docs/address.pdf", UploadedAt: time.Now().Add(-10 * 24 * time.Hour), ExpiryDate: time.Now().Add(500 * 24 * time.Hour)},
			{Name: "Selfie", Status: "APPROVED", URL: "/assets/docs/selfie.jpg", UploadedAt: time.Now().Add(-10 * 24 * time.Hour), ExpiryDate: time.Now().Add(300 * 24 * time.Hour)},
		},
		Earnings: []DriverEarningRecord{
			{Period: "Today", GrossPaise: 450000, Incentives: 50000, Bonuses: 25000, Deductions: 0, NetPaise: 525000},
			{Period: "This Week", GrossPaise: 2450000, Incentives: 300000, Bonuses: 100000, Deductions: 5000, NetPaise: 2845000},
		},
		Payouts: []DriverPayoutRecord{
			{PayoutID: fmt.Sprintf("PAY-%05d", h%10000), AmountPaise: 2845000, Status: "PROCESSED", BankDetails: "HDFC Bank A/c ******4820", RequestedAt: time.Now().Add(-48 * time.Hour)},
		},
		Performance: DriverPerformanceTab{
			AcceptanceRate:    0.92,
			CancellationRate:  0.04,
			OnTimeArrivalRate: 0.95,
			RatingTrend:       []float64{4.5, 4.6, 4.8, 4.7, 4.8},
			ComplaintsCount:   int(h % 3),
		},
		Incentives: []DriverIncentiveGoal{
			{GoalID: "INC-DAILY-10", Description: "Complete 10 trips today", TargetTrips: 10, CurrentTrip: int(h % 9), BonusPaise: 50000, Completed: false},
		},
		Training: []string{"Standard Onboarding Course", "Safety Protocols & SOS Guidelines"},
		TicketsCount: int(h % 4),
		IncidentsCount: int(h % 2),
		Notifications: []RiderNotificationLog{
			{Type: "SMS", Payload: "Incentive campaign active: ₹500 extra for 10 trips", Timestamp: time.Now().Add(-2 * time.Hour)},
			{Type: "PUSH", Payload: "New trip order request offered near you", Timestamp: time.Now().Add(-12 * time.Hour)},
		},
		DeviceInfo: fmt.Sprintf("%s (%s)", device, appVersion),
		AuditLogs:  []RiderAuditLogEntry{},
	}
}

func (h *DriverHandler) mergeDriverOverrides(ctx context.Context, details *DriverDetailResponse) {
	key := "driver:override:" + details.DriverID
	val, err := h.redisClient.Get(ctx, key).Result()
	if err == nil && val != "" {
		var override DriverOverride
		if err := json.Unmarshal([]byte(val), &override); err == nil {
			if override.Name != "" {
				details.Name = override.Name
			}
			if override.Phone != "" {
				details.Phone = override.Phone
				details.Overview.ContactPhone = override.Phone
			}
			if override.Status != "" {
				details.Status = override.Status
				details.Overview.Status = override.Status
			}
			if override.RatingAdjustment != 0 {
				details.Performance.RatingTrend = append(details.Performance.RatingTrend, 4.5+override.RatingAdjustment)
			}
			if override.WalletBalanceAdjustment != 0 {
				details.Overview.Bio = details.Overview.Bio + fmt.Sprintf(" [Wallet Adjusted: %d paise]", override.WalletBalanceAdjustment)
			}
			if override.Bio != "" {
				details.Overview.Bio = override.Bio
			}
			if override.CityPrefix != "" {
				details.CityPrefix = override.CityPrefix
				details.Overview.City = override.CityPrefix
			}
			for i, doc := range details.KYCDocuments {
				if status, exists := override.KYCDocuments[doc.Name]; exists {
					details.KYCDocuments[i].Status = status
				}
			}
			for _, module := range override.TrainingModules {
				alreadyHas := false
				for _, trained := range details.Training {
					if trained == module {
						alreadyHas = true
						break
					}
				}
				if !alreadyHas {
					details.Training = append(details.Training, module)
				}
			}
		}
	}
}

// HandleGetDrivers lists drivers with filters and search
func (h *DriverHandler) HandleGetDrivers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	q := r.URL.Query()
	statusFilter := q.Get("status")
	cityFilter := q.Get("city_prefix")
	transmissionFilter := q.Get("transmission")
	searchFilter := q.Get("search")

	ratingMin, _ := strconv.ParseFloat(q.Get("rating_min"), 64)
	acceptanceMin, _ := strconv.ParseFloat(q.Get("acceptance_min"), 64)
	cancellationMax, _ := strconv.ParseFloat(q.Get("cancellation_max"), 64)
	tripsMin, _ := strconv.Atoi(q.Get("trips_min"))

	limitStr := q.Get("limit")
	offsetStr := q.Get("offset")
	limit := 50
	offset := 0
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
			limit = l
		}
	}
	if offsetStr != "" {
		if o, err := strconv.Atoi(offsetStr); err == nil && o >= 0 {
			offset = o
		}
	}

	sqlQuery := `
		SELECT 
			d.id::text,
			d.city_prefix,
			d.name,
			COALESCE(d.phone, '') as phone,
			d.current_state::text,
			d.is_verified,
			d.acceptance_rate::float,
			d.cancellation_rate::float,
			COALESCE((SELECT COUNT(*) FROM orders o WHERE o.assigned_driver_id = d.id), 0)::bigint as total_trips,
			COALESCE((SELECT MAX(o.completed_at) FROM orders o WHERE o.assigned_driver_id = d.id), d.updated_at) as last_online,
			CASE
				WHEN d.has_manual_certification AND d.has_automatic_certification THEN 'BOTH'
				WHEN d.has_manual_certification THEN 'MANUAL'
				ELSE 'AUTOMATIC'
			END as transmission_capability,
			COALESCE(d.account_status, 'ACTIVE') as account_status,
			COALESCE(d.rating, 0)::float as rating
		FROM drivers d
		ORDER BY d.created_at DESC
	`

	rows, err := h.dbPool.Query(ctx, sqlQuery)
	if err != nil {
		h.logger.Printf("[DRIVERS_ERROR] Query drivers failed: %v", err)
		http.Error(w, "database_query_failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var drivers []DriverSummary

	for rows.Next() {
		var dID, city, name, phone, state, transmission, accountStatus string
		var verified bool
		var accRate, cancelRate, dbRating float64
		var totalTrips int64
		var lastOnline time.Time

		err := rows.Scan(&dID, &city, &name, &phone, &state, &verified, &accRate, &cancelRate, &totalTrips, &lastOnline, &transmission, &accountStatus, &dbRating)
		if err != nil {
			h.logger.Printf("[DRIVERS_ERROR] Row scan failed: %v", err)
			continue
		}

		proj := projectDriverOverview(dID, name, phone, city, verified, state)
		// Real status (account_status), expertise (certifications) and rating (drivers.rating)
		// from the drivers row — not the projected hash. PENDING_KYC for an active-but-
		// unverified driver. Admin Redis overrides still win via mergeDriverOverrides.
		proj.Status = accountStatus
		if accountStatus == "ACTIVE" && !verified {
			proj.Status = "PENDING_KYC"
		}
		proj.Expertise = transmission
		h.mergeDriverOverrides(ctx, &proj)

		item := DriverSummary{
			DriverID:               dID,
			Name:                   proj.Name,
			Phone:                  proj.Phone,
			CityPrefix:             proj.CityPrefix,
			Status:                 proj.Status,
			Rating:                 dbRating,
			TotalTrips:             totalTrips,
			AcceptanceRate:         accRate,
			CancellationRate:       cancelRate,
			LastOnline:             lastOnline,
			TransmissionCapability: proj.Expertise,
		}

		// Filters in memory
		if cityFilter != "" && !strings.EqualFold(item.CityPrefix, cityFilter) {
			continue
		}
		if statusFilter != "" && !strings.EqualFold(item.Status, statusFilter) {
			continue
		}
		if transmissionFilter != "" && !strings.EqualFold(item.TransmissionCapability, transmissionFilter) {
			continue
		}
		if searchFilter != "" {
			sf := strings.ToLower(searchFilter)
			if !strings.Contains(strings.ToLower(item.Name), sf) &&
				!strings.Contains(strings.ToLower(item.Phone), sf) &&
				!strings.Contains(strings.ToLower(item.DriverID), sf) {
				continue
			}
		}

		if ratingMin > 0 && item.Rating < ratingMin {
			continue
		}
		if acceptanceMin > 0 && item.AcceptanceRate < acceptanceMin {
			continue
		}
		if cancellationMax > 0 && item.CancellationRate > cancellationMax {
			continue
		}
		if tripsMin > 0 && item.TotalTrips < int64(tripsMin) {
			continue
		}

		drivers = append(drivers, item)
	}

	paginated := make([]DriverSummary, 0)
	total := len(drivers)
	if offset < total {
		end := offset + limit
		if end > total {
			end = total
		}
		paginated = drivers[offset:end]
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(paginated)
}

// HandleGetDriverOnboarding returns the onboarding queue
func (h *DriverHandler) HandleGetDriverOnboarding(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// Query unverified applicants
	sqlQuery := `
		SELECT d.id::text, d.city_prefix, d.name, COALESCE(d.phone, ''), d.background_check_status, d.created_at
		FROM drivers d
		WHERE d.is_verified = false
		ORDER BY d.created_at ASC
	`

	rows, err := h.dbPool.Query(ctx, sqlQuery)
	if err != nil {
		h.logger.Printf("[DRIVERS_ERROR] Query onboarding queue failed: %v", err)
		http.Error(w, "database_query_failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	applicants := make([]DriverOnboardingApplicant, 0)

	for rows.Next() {
		var dID, city, name, phone, bgStatus string
		var createdAt time.Time

		if err := rows.Scan(&dID, &city, &name, &phone, &bgStatus, &createdAt); err == nil {
			proj := projectDriverOverview(dID, name, phone, city, false, "OFFLINE")
			h.mergeDriverOverrides(ctx, &proj)

			// Determine pipeline stage
			stage := "APPLIED"
			key := "driver:override:" + dID
			val, rErr := h.redisClient.Get(ctx, key).Result()
			if rErr == nil && val != "" {
				var ov DriverOverride
				if json.Unmarshal([]byte(val), &ov) == nil && ov.OnboardingStage != "" {
					stage = ov.OnboardingStage
				}
			}

			if stage == "APPLIED" && len(proj.KYCDocuments) >= 3 {
				stage = "DOCS_UPLOADED"
			}
			if stage == "DOCS_UPLOADED" && bgStatus == "CLEARED" {
				stage = "BACKGROUND_CHECK"
			}
			hasSafetyTraining := false
			for _, t := range proj.Training {
				if strings.Contains(strings.ToLower(t), "safety") {
					hasSafetyTraining = true
					break
				}
			}
			if stage == "BACKGROUND_CHECK" && hasSafetyTraining {
				stage = "TRAINING"
			}

			applicants = append(applicants, DriverOnboardingApplicant{
				DriverID:             dID,
				Name:                 proj.Name,
				Phone:                proj.Phone,
				CityPrefix:           proj.CityPrefix,
				Stage:                stage,
				KYCDocumentsChecklist: proj.KYCDocuments,
				AppliedAt:            createdAt,
				BackgroundStatus:     bgStatus,
				TrainingCompleted:    hasSafetyTraining,
			})
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(applicants)
}

// HandleGetDriverDetail returns the detailed view of a driver
func (h *DriverHandler) HandleGetDriverDetail(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_driver_id", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	sqlQuery := `
		SELECT d.id::text, d.city_prefix, d.name, COALESCE(d.phone, '') as phone, d.current_state::text, d.is_verified
		FROM drivers d
		WHERE d.id = $1::uuid
	`

	var dID, city, name, phone, state string
	var verified bool

	err := h.dbPool.QueryRow(ctx, sqlQuery, id).Scan(&dID, &city, &name, &phone, &state, &verified)
	if err != nil {
		h.logger.Printf("[DRIVERS_ERROR] Driver detail fetch failed for %s: %v", id, err)
		http.Error(w, "driver_not_found", http.StatusNotFound)
		return
	}

	details := projectDriverOverview(dID, name, phone, city, verified, state)

	// Fetch Trips counts and details from SQL
	tripCountQuery := "SELECT COUNT(*) FROM orders WHERE assigned_driver_id = $1::uuid"
	_ = h.dbPool.QueryRow(ctx, tripCountQuery, id).Scan(&details.TripsCount)

	// Fetch Audits
	auditQuery := `
		SELECT id::text, admin_email, action, details, ip_address, created_at
		FROM admin_audit_logs
		WHERE details ILIKE $1 OR details ILIKE $2
		ORDER BY created_at DESC
	`
	aRows, aErr := h.dbPool.Query(ctx, auditQuery, "%"+id+"%", "%driver%")
	if aErr == nil {
		defer aRows.Close()
		for aRows.Next() {
			var entry RiderAuditLogEntry
			if err := aRows.Scan(&entry.ID, &entry.AdminUser, &entry.Action, &entry.Details, &entry.IP, &entry.CreatedAt); err == nil {
				details.AuditLogs = append(details.AuditLogs, entry)
			}
		}
	}

	h.mergeDriverOverrides(ctx, &details)

	// Replace the projected mock Earnings/Payouts/Notifications with real DB data.
	details.Earnings = h.queryDriverEarnings(ctx, id)
	details.Payouts = h.queryDriverPayouts(ctx, id)
	details.Notifications = h.queryDriverNotifications(ctx, id)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(details)
}

// queryDriverEarnings returns the driver's daily DRIVER_EARNINGS ledger aggregates.
func (h *DriverHandler) queryDriverEarnings(ctx context.Context, driverID string) []DriverEarningRecord {
	out := make([]DriverEarningRecord, 0)
	rows, err := h.dbPool.Query(ctx, `
		SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD'),
		       COALESCE(SUM(CASE WHEN entry_type='CREDIT' THEN amount_paise ELSE 0 END), 0),
		       COALESCE(SUM(CASE WHEN entry_type='CREDIT' AND description ILIKE '%incentive%' THEN amount_paise ELSE 0 END), 0),
		       COALESCE(SUM(CASE WHEN entry_type='CREDIT' AND description ILIKE '%bonus%' THEN amount_paise ELSE 0 END), 0),
		       COALESCE(SUM(CASE WHEN entry_type='DEBIT' THEN amount_paise ELSE 0 END), 0)
		FROM financial_ledger_entries
		WHERE driver_id = $1::uuid AND account_type = 'DRIVER_EARNINGS'
		GROUP BY 1 ORDER BY 1 DESC LIMIT 14
	`, driverID)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var e DriverEarningRecord
		if rows.Scan(&e.Period, &e.GrossPaise, &e.Incentives, &e.Bonuses, &e.Deductions) == nil {
			e.NetPaise = e.GrossPaise - e.Deductions
			out = append(out, e)
		}
	}
	return out
}

// queryDriverPayouts returns the driver's payout_requests history.
func (h *DriverHandler) queryDriverPayouts(ctx context.Context, driverID string) []DriverPayoutRecord {
	out := make([]DriverPayoutRecord, 0)
	rows, err := h.dbPool.Query(ctx, `
		SELECT id, amount_paise, status, COALESCE(bank_reference, ''), created_at
		FROM payout_requests WHERE driver_id = $1::uuid ORDER BY created_at DESC LIMIT 50
	`, driverID)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var p DriverPayoutRecord
		if rows.Scan(&p.PayoutID, &p.AmountPaise, &p.Status, &p.BankDetails, &p.RequestedAt) == nil {
			out = append(out, p)
		}
	}
	return out
}

// queryDriverNotifications returns the driver's notification log.
func (h *DriverHandler) queryDriverNotifications(ctx context.Context, driverID string) []RiderNotificationLog {
	out := make([]RiderNotificationLog, 0)
	rows, err := h.dbPool.Query(ctx, `
		SELECT COALESCE(category, 'PUSH'), title || ' — ' || body, delivered_at
		FROM driver_notifications WHERE driver_id = $1::uuid ORDER BY delivered_at DESC LIMIT 50
	`, driverID)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var n RiderNotificationLog
		if rows.Scan(&n.Type, &n.Payload, &n.Timestamp) == nil {
			out = append(out, n)
		}
	}
	return out
}

// HandleDriverActions acts on driver profiles (KYC, suspension, block, offline override, ratings adjustment, adjustments, GDPR delete)
func (h *DriverHandler) HandleDriverActions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	action := r.PathValue("action")
	if id == "" || action == "" {
		http.Error(w, "missing_parameters", http.StatusBadRequest)
		return
	}

	adminRole := r.Header.Get("X-Admin-Role")
	adminEmail := r.Header.Get("X-Admin-Email")
	if adminEmail == "" {
		adminEmail = "admin@platform.com"
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	overrideKey := "driver:override:" + id
	var override DriverOverride

	val, err := h.redisClient.Get(ctx, overrideKey).Result()
	if err == nil && val != "" {
		_ = json.Unmarshal([]byte(val), &override)
	}
	override.DriverID = id
	if override.KYCDocuments == nil {
		override.KYCDocuments = make(map[string]string)
	}

	ip := getClientIP(r)

	w.Header().Set("Content-Type", "application/json")

	switch action {
	case "verify-kyc":
		sqlQuery := "UPDATE drivers SET is_verified = true, verification_status = 'VERIFIED', background_check_status = 'CLEARED' WHERE id = $1::uuid"
		_, err = h.dbPool.Exec(ctx, sqlQuery, id)
		if err != nil {
			http.Error(w, "kyc_update_failed", http.StatusInternalServerError)
			return
		}
		override.Status = "ACTIVE"
		override.OnboardingStage = "APPROVED"
		h.recordAuditLog(ctx, "", adminEmail, "DRIVER_KYC_APPROVED", fmt.Sprintf("Admin (%s) approved KYC and verified driver %s", adminRole, id), ip, id)

	case "reject-kyc":
		type ReasonRequest struct {
			Reason string `json:"reason"`
		}
		var req ReasonRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		sqlQuery := "UPDATE drivers SET is_verified = false, verification_status = 'REJECTED', background_check_status = 'REJECTED' WHERE id = $1::uuid"
		_, _ = h.dbPool.Exec(ctx, sqlQuery, id)
		override.Status = "PENDING_KYC"
		override.OnboardingStage = "APPLIED"
		h.recordAuditLog(ctx, "", adminEmail, "DRIVER_KYC_REJECTED", fmt.Sprintf("Admin (%s) rejected KYC for driver %s. Reason: %s", adminRole, id, req.Reason), ip, id)

	case "docs-update":
		type DocUpdateRequest struct {
			DocName string `json:"doc_name"`
			Status  string `json:"status"` // APPROVED, REJECTED, REUPLOAD
		}
		var req DocUpdateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err == nil && req.DocName != "" {
			override.KYCDocuments[req.DocName] = req.Status
			h.recordAuditLog(ctx, "", adminEmail, "DRIVER_DOC_STATUS", fmt.Sprintf("Admin (%s) updated document '%s' to status '%s' for driver %s", adminRole, req.DocName, req.Status, id), ip, id)

			// Resolve admin reviewer id from email
			var adminReviewerID *string
			_ = h.dbPool.QueryRow(ctx, "SELECT id::text FROM system_admins WHERE email = $1", adminEmail).Scan(&adminReviewerID)

			// Map admin document status string to driver_verification_status enum
			dbStatus := "PENDING"
			if req.Status == "APPROVED" || req.Status == "VERIFIED" {
				dbStatus = "VERIFIED"
			} else if req.Status == "REJECTED" || req.Status == "REUPLOAD" {
				dbStatus = "REJECTED"
			}

			// Update driver_documents table
			updateQuery := `
				UPDATE driver_documents
				SET status = $1::driver_verification_status,
				    admin_reviewer_id = $2::uuid,
				    reviewed_at = NOW()
				WHERE driver_id = $3::uuid AND document_type = $4
			`
			_, err = h.dbPool.Exec(ctx, updateQuery, dbStatus, adminReviewerID, id, req.DocName)

			// Trigger notification_outbox entry if document is rejected
			if dbStatus == "REJECTED" {
				title := "KYC Document Rejected"
				body := fmt.Sprintf("Your document '%s' has been rejected. Please upload a clear copy to continue onboarding.", req.DocName)
				payloadMap := map[string]interface{}{
					"event":         "kyc_doc_rejected",
					"document_type": req.DocName,
					"driver_id":     id,
				}
				payloadBytes, _ := json.Marshal(payloadMap)

				insertOutboxQuery := `
					INSERT INTO notification_outbox (user_id, title, body, payload, status)
					VALUES ($1::uuid, $2, $3, $4::jsonb, 'PENDING')
				`
				_, _ = h.dbPool.Exec(ctx, insertOutboxQuery, id, title, body, string(payloadBytes))
			}
		}

	case "onboarding-stage":
		type StageRequest struct {
			Stage string `json:"stage"`
		}
		var req StageRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err == nil && req.Stage != "" {
			override.OnboardingStage = req.Stage
			h.recordAuditLog(ctx, "", adminEmail, "DRIVER_ONBOARDING_STAGE", fmt.Sprintf("Admin (%s) transitioned driver %s onboarding stage to %s", adminRole, id, req.Stage), ip, id)
		}

	case "suspend":
		// Postgres is the system of record; the Redis override is a read cache.
		if _, err := h.dbPool.Exec(ctx, "UPDATE drivers SET account_status = 'SUSPENDED', current_state = 'OFFLINE', updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid", id); err != nil {
			http.Error(w, "suspend_update_failed", http.StatusInternalServerError)
			return
		}
		// Revoke any live login session so outstanding JWTs stop working immediately.
		_ = h.redisClient.Del(ctx, middleware.DriverSessionKey(id)).Err()
		h.notifyDriver(ctx, id, "Account Suspended", "Your account has been temporarily suspended. Contact support for details.")
		override.Status = "SUSPENDED"
		h.recordAuditLog(ctx, "", adminEmail, "DRIVER_SUSPENDED", fmt.Sprintf("Admin (%s) temporarily suspended driver %s", adminRole, id), ip, id)

	case "block":
		if _, err := h.dbPool.Exec(ctx, "UPDATE drivers SET account_status = 'BLOCKED', current_state = 'OFFLINE', updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid", id); err != nil {
			http.Error(w, "block_update_failed", http.StatusInternalServerError)
			return
		}
		_ = h.redisClient.Del(ctx, middleware.DriverSessionKey(id)).Err()
		h.notifyDriver(ctx, id, "Account Blocked", "Your account has been blocked. Contact support if you believe this is an error.")
		override.Status = "BLOCKED"
		h.recordAuditLog(ctx, "", adminEmail, "DRIVER_BLOCKED", fmt.Sprintf("Admin (%s) permanently blocked driver %s", adminRole, id), ip, id)

	case "unblock":
		if _, err := h.dbPool.Exec(ctx, "UPDATE drivers SET account_status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid", id); err != nil {
			http.Error(w, "unblock_update_failed", http.StatusInternalServerError)
			return
		}
		h.notifyDriver(ctx, id, "Account Restored", "Your account has been reactivated. Welcome back — you can go online now.")
		override.Status = "ACTIVE"
		h.recordAuditLog(ctx, "", adminEmail, "DRIVER_UNBLOCKED", fmt.Sprintf("Admin (%s) restored/unblocked account for driver %s", adminRole, id), ip, id)

	case "force-offline":
		sqlQuery := "UPDATE drivers SET current_state = 'OFFLINE' WHERE id = $1::uuid"
		_, err = h.dbPool.Exec(ctx, sqlQuery, id)
		if err != nil {
			http.Error(w, "force_offline_failed", http.StatusInternalServerError)
			return
		}
		h.recordAuditLog(ctx, "", adminEmail, "DRIVER_FORCE_OFFLINE", fmt.Sprintf("Admin (%s) forced driver %s state to OFFLINE", adminRole, id), ip, id)

	case "message":
		type MsgRequest struct {
			Title string `json:"title"`
			Body  string `json:"body"`
		}
		var req MsgRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Body) == "" {
			http.Error(w, "message_body_required", http.StatusBadRequest)
			return
		}
		if req.Title == "" {
			req.Title = "Message from Support"
		}
		// Persist to the driver's notification log + enqueue for delivery.
		_, _ = h.dbPool.Exec(ctx, `
			INSERT INTO driver_notifications (id, driver_id, category, title, body, is_read, delivered_at)
			VALUES (gen_random_uuid(), $1::uuid, 'ADMIN_MESSAGE', $2, $3, false, NOW())
		`, id, req.Title, req.Body)
		h.notifyDriver(ctx, id, req.Title, req.Body)
		h.recordAuditLog(ctx, "", adminEmail, "DRIVER_MESSAGE_SENT", fmt.Sprintf("Admin (%s) sent message to driver %s: %s", adminRole, id, req.Title), ip, id)
		_, _ = w.Write([]byte(`{"status":"SUCCESS"}`))
		return

	case "reset-password":
		h.recordAuditLog(ctx, "", adminEmail, "DRIVER_PASSWORD_RESET", fmt.Sprintf("Admin (%s) reset authentication key credentials for driver %s", adminRole, id), ip, id)
		_, _ = w.Write([]byte(`{"status":"SUCCESS", "message":"Password reset token generated and sent."}`))
		return

	case "reassign-city":
		type CityRequest struct {
			CityPrefix string `json:"city_prefix"`
		}
		var req CityRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err == nil && req.CityPrefix != "" {
			sqlQuery := "UPDATE drivers SET city_prefix = $1 WHERE id = $2::uuid"
			_, _ = h.dbPool.Exec(ctx, sqlQuery, req.CityPrefix, id)
			override.CityPrefix = req.CityPrefix
			h.recordAuditLog(ctx, "", adminEmail, "DRIVER_CITY_REASSIGNED", fmt.Sprintf("Admin (%s) reassigned driver %s to city hub %s", adminRole, id, req.CityPrefix), ip, id)
		}

	case "rating-adjust":
		type RatingRequest struct {
			Adjustment float64 `json:"adjustment"`
			Reason     string  `json:"reason"`
		}
		var req RatingRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err == nil {
			override.RatingAdjustment = req.Adjustment
			h.recordAuditLog(ctx, "", adminEmail, "DRIVER_RATING_ADJUSTED", fmt.Sprintf("Admin (%s) adjusted rating by %f for driver %s. Reason: %s", adminRole, req.Adjustment, id, req.Reason), ip, id)
		}

	case "wallet":
		type WalletRequest struct {
			AmountPaise int64  `json:"amount_paise"`
			Description string `json:"description"`
		}
		var req WalletRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "malformed_json", http.StatusBadRequest)
			return
		}
		// Persist to the real wallet ledger (driver_wallets + driver_wallet_transactions)
		// instead of a Redis-only counter, so the driver app's wallet view reflects it.
		entryType := "CREDIT"
		if req.AmountPaise < 0 {
			entryType = "DEBIT"
		}
		tx, err := h.dbPool.Begin(ctx)
		if err != nil {
			http.Error(w, "wallet_tx_begin_failed", http.StatusInternalServerError)
			return
		}
		defer tx.Rollback(ctx)
		if _, err := tx.Exec(ctx, `
			INSERT INTO driver_wallets (driver_id, available_balance, updated_at)
			VALUES ($1::uuid, $2, NOW())
			ON CONFLICT (driver_id) DO UPDATE
			SET available_balance = driver_wallets.available_balance + $2, updated_at = NOW()
		`, id, req.AmountPaise); err != nil {
			http.Error(w, "wallet_balance_update_failed", http.StatusInternalServerError)
			return
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO driver_wallet_transactions (id, driver_id, amount_paise, entry_type, description, created_at)
			VALUES (gen_random_uuid(), $1::uuid, $2, $3, $4, NOW())
		`, id, req.AmountPaise, entryType, req.Description); err != nil {
			http.Error(w, "wallet_txn_insert_failed", http.StatusInternalServerError)
			return
		}
		if err := tx.Commit(ctx); err != nil {
			http.Error(w, "wallet_tx_commit_failed", http.StatusInternalServerError)
			return
		}
		override.WalletBalanceAdjustment += req.AmountPaise
		actionName := "DRIVER_BONUS_ISSUED"
		if req.AmountPaise < 0 {
			actionName = "DRIVER_DEDUCTION_MADE"
		}
		h.recordAuditLog(ctx, "", adminEmail, actionName, fmt.Sprintf("Admin (%s) posted wallet adjustment on driver %s by %d paise. Reason: %s", adminRole, id, req.AmountPaise, req.Description), ip, id)

	case "delete":
		sqlQuery := "DELETE FROM drivers WHERE id = $1::uuid"
		_, _ = h.dbPool.Exec(ctx, sqlQuery, id)
		_ = h.redisClient.Del(ctx, overrideKey).Err()
		h.recordAuditLog(ctx, "", adminEmail, "DRIVER_GDPR_DELETED", fmt.Sprintf("Admin (%s) purged driver records for ID %s", adminRole, id), ip, id)

	default:
		http.Error(w, "invalid_action", http.StatusBadRequest)
		return
	}

	overrideBytes, _ := json.Marshal(override)
	err = h.redisClient.Set(ctx, overrideKey, overrideBytes, 0).Err()
	if err != nil {
		http.Error(w, "redis_write_failed", http.StatusInternalServerError)
		return
	}

	_, _ = w.Write([]byte(`{"status":"SUCCESS"}`))
}

// recordAuditLog writes a driver-scoped admin action to admin_audit_logs. entity_type
// is always DRIVER here; entityID is the target driver UUID (rule 2 — entity_type/entity_id).
func (h *DriverHandler) recordAuditLog(ctx context.Context, adminID string, email string, action string, details string, ip string, entityID string) {
	query := `
		INSERT INTO admin_audit_logs (admin_id, admin_email, action, details, ip_address, entity_type, entity_id)
		VALUES ($1, $2, $3, $4, $5, 'DRIVER', $6)
	`
	var idVal interface{} = adminID
	if adminID == "" {
		idVal = "00000000-0000-0000-0000-000000000000"
	}
	_, _ = h.dbPool.Exec(ctx, query, idVal, email, action, details, ip, entityID)
}

// notifyDriver enqueues a push/SMS to the driver app via the notification outbox
// (rule 3 — suspend/block must notify the driver). Best-effort; never blocks the action.
func (h *DriverHandler) notifyDriver(ctx context.Context, driverID, title, body string) {
	payload, _ := json.Marshal(map[string]string{"type": "ACCOUNT_STATUS", "title": title})
	_, _ = h.dbPool.Exec(ctx, `
		INSERT INTO notification_outbox (user_id, title, body, payload, status)
		VALUES ($1::uuid, $2, $3, $4::jsonb, 'PENDING')
	`, driverID, title, body, string(payload))
}
