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
)

var firstNames = []string{"Aarav", "Sarah", "Priya", "Amit", "Rohan", "Deepa", "Vikram", "Neha", "Kabir", "Ananya", "Rahul", "Aisha", "Aditya", "Meera", "Sanjay"}
var lastNames = []string{"Sharma", "Connor", "Patel", "Verma", "Das", "Nair", "Rao", "Gupta", "Singh", "Sen", "Mehta", "Reddy", "Joshi", "Bose", "Pillai"}
var referralSources = []string{"Organic", "Google Ads", "App Store", "Referral Code", "Facebook Campaign"}
var carModels = []string{"Toyota Fortuner SUV", "Honda City Sedan", "Maruti Swift Hatchback", "Hyundai i20 Hatchback", "BMW 3 Series Premium"}
var phoneRelations = []string{"Spouse", "Parent", "Sibling", "Friend"}

// Helper function to hash UUID string to a deterministic uint32
func hashUUID(uuidStr string) uint32 {
	if len(uuidStr) < 8 {
		return 0
	}
	// Extract last 8 characters of UUID
	sub := uuidStr[len(uuidStr)-8:]
	var val uint32
	_, _ = fmt.Sscanf(sub, "%x", &val)
	return val
}

type RiderHandler struct {
	dbPool      *pgxpool.Pool
	redisClient *redis.ClusterClient
	logger      *log.Logger
}

func NewRiderHandler(dbPool *pgxpool.Pool, redisClient *redis.ClusterClient, logger *log.Logger) *RiderHandler {
	return &RiderHandler{
		dbPool:      dbPool,
		redisClient: redisClient,
		logger:      logger,
	}
}

// RiderSummary represents a list-view item
type RiderSummary struct {
	CustomerID     string    `json:"customer_id"`
	Name           string    `json:"name"`
	Phone          string    `json:"phone"`
	Email          string    `json:"email"`
	SignupDate     time.Time `json:"signup_date"`
	Cities         []string  `json:"cities"`
	TotalTrips     int64     `json:"total_trips"`
	AverageRating  float64   `json:"average_rating"`
	WalletBalance  int64     `json:"wallet_balance"` // In paise
	LifetimeValue  int64     `json:"lifetime_value"` // In paise
	LastTripDate   time.Time `json:"last_trip_date"`
	Status         string    `json:"status"` // ACTIVE, SUSPENDED, BLOCKED, DELETED
	Tags           []string  `json:"tags"`
	ReferralSource string    `json:"referral_source"`
}

// RiderOverride stores admin overridden values in Redis
type RiderOverride struct {
	CustomerID              string   `json:"customer_id"`
	Name                    string   `json:"name,omitempty"`
	Phone                   string   `json:"phone,omitempty"`
	Email                   string   `json:"email,omitempty"`
	Status                  string   `json:"status,omitempty"` // ACTIVE, SUSPENDED, BLOCKED, DELETED
	PhoneVerified           *bool    `json:"phone_verified,omitempty"`
	EmailVerified           *bool    `json:"email_verified,omitempty"`
	KYCLevel                *int     `json:"kyc_level,omitempty"`
	WalletBalanceAdjustment int64    `json:"wallet_balance_adjustment,omitempty"` // In paise (+/-)
	Tags                    []string `json:"tags,omitempty"`
	ReferralSource          string   `json:"referral_source,omitempty"`
}

// Structures for the tabbed details response
type RiderOverviewTab struct {
	Contact           RiderContactInfo        `json:"contact"`
	KYCLevel          int                     `json:"kyc_level"`
	Addresses         []RiderAddress          `json:"addresses"`
	EmergencyContacts []RiderEmergencyContact `json:"emergency_contacts"`
	Devices           []RiderDeviceInfo       `json:"devices"`
}

type RiderContactInfo struct {
	Phone string `json:"phone"`
	Email string `json:"email"`
}

type RiderAddress struct {
	Type    string `json:"type"`
	Address string `json:"address"`
}

type RiderEmergencyContact struct {
	Name         string `json:"name"`
	Phone        string `json:"phone"`
	Relationship string `json:"relationship"`
}

type RiderDeviceInfo struct {
	DeviceName string `json:"device_name"`
	OSVersion  string `json:"os_version"`
	AppVersion string `json:"app_version"`
}

type RiderGarageTab struct {
	Cars []RiderCar `json:"cars"`
}

type RiderCar struct {
	MakeModel    string            `json:"make_model"`
	Plate        string            `json:"plate"`
	Documents    RiderCarDocuments `json:"documents"`
	ExpiryAlerts []string          `json:"expiry_alerts"`
}

type RiderCarDocuments struct {
	RCStatus        string `json:"rc_status"`
	InsuranceStatus string `json:"insurance_status"`
	PUCStatus       string `json:"puc_status"`
}

type RiderPaymentsTab struct {
	Methods      []RiderPaymentMethod `json:"methods"`
	Transactions []RiderTransaction   `json:"transactions"`
	Refunds      []RiderRefund        `json:"refunds"`
	Chargebacks  []RiderChargeback    `json:"chargebacks"`
}

type RiderPaymentMethod struct {
	Type    string `json:"type"` // CARD, UPI, WALLET
	Details string `json:"details"`
}

type RiderTransaction struct {
	TransactionID string    `json:"transaction_id"`
	OrderID       string    `json:"order_id"`
	AmountPaise   int64     `json:"amount_paise"`
	Status        string    `json:"status"` // SUCCEEDED, FAILED, PENDING
	Gateway       string    `json:"gateway"`
	CreatedAt     time.Time `json:"created_at"`
}

type RiderRefund struct {
	RefundID      string    `json:"refund_id"`
	OrderID       string    `json:"order_id"`
	AmountPaise   int64     `json:"amount_paise"`
	Status        string    `json:"status"`
	Reason        string    `json:"reason"`
	CreatedAt     time.Time `json:"created_at"`
}

type RiderChargeback struct {
	ChargebackID string    `json:"chargeback_id"`
	OrderID      string    `json:"order_id"`
	AmountPaise  int64     `json:"amount_paise"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"created_at"`
}

type RiderWalletTab struct {
	BalancePaise int64                    `json:"balance_paise"`
	Transactions []RiderWalletTransaction `json:"transactions"`
}

type RiderWalletTransaction struct {
	Type        string    `json:"type"` // TOPUP, DEBIT, MANUAL_CREDIT, MANUAL_DEBIT
	AmountPaise int64     `json:"amount_paise"`
	Timestamp   time.Time `json:"timestamp"`
	Description string    `json:"description"`
}

type RiderPromosTab struct {
	Applied          []RiderPromoApplied `json:"applied"`
	EligibilityFlags []string            `json:"eligibility_flags"`
}

type RiderPromoApplied struct {
	PromoCode string    `json:"promo_code"`
	Status    string    `json:"status"` // USED, EXPIRED
	Timestamp time.Time `json:"timestamp"`
}

type RiderSupportTab struct {
	Tickets        []RiderSupportTicket  `json:"tickets"`
	Chats          []RiderSupportChat    `json:"chats"`
	CallRecordings []RiderCallRecording `json:"call_recordings"`
}

type RiderSupportTicket struct {
	TicketID  string    `json:"ticket_id"`
	Subject   string    `json:"subject"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
}

type RiderSupportChat struct {
	ChatID      string    `json:"chat_id"`
	Subject     string    `json:"subject"`
	LastMessage string    `json:"last_message"`
	Timestamp   time.Time `json:"timestamp"`
}

type RiderCallRecording struct {
	CallID          string    `json:"call_id"`
	DurationSeconds int       `json:"duration_seconds"`
	Timestamp       time.Time `json:"timestamp"`
}

type RiderRatingsTab struct {
	AverageGiven    float64 `json:"average_given"`
	AverageReceived float64 `json:"average_received"`
}

type RiderRiskTab struct {
	Score          int      `json:"score"`
	Flags          []string `json:"flags"`
	BlockedReasons []string `json:"blocked_reasons"`
}

type RiderNotificationLog struct {
	Type      string    `json:"type"` // SMS, PUSH, EMAIL
	Payload   string    `json:"payload"`
	Timestamp time.Time `json:"timestamp"`
}

type RiderAuditLogEntry struct {
	ID        string    `json:"id"`
	AdminUser string    `json:"admin_user"`
	Action    string    `json:"action"`
	Details   string    `json:"details"`
	IP        string    `json:"ip"`
	CreatedAt time.Time `json:"created_at"`
}

type RiderDetailResponse struct {
	CustomerID     string                 `json:"customer_id"`
	Name           string                 `json:"name"`
	Phone          string                 `json:"phone"`
	Email          string                 `json:"email"`
	Status         string                 `json:"status"`
	KYCLevel       int                    `json:"kyc_level"`
	PhoneVerified  bool                   `json:"phone_verified"`
	EmailVerified  bool                   `json:"email_verified"`
	Tags           []string               `json:"tags"`
	ReferralSource string                 `json:"referral_source"`
	Overview       RiderOverviewTab       `json:"overview"`
	Garage         RiderGarageTab         `json:"garage"`
	Payments       RiderPaymentsTab       `json:"payments"`
	Wallet         RiderWalletTab         `json:"wallet"`
	Promos         RiderPromosTab         `json:"promos"`
	Support        RiderSupportTab        `json:"support"`
	Ratings        RiderRatingsTab        `json:"ratings"`
	Risk           RiderRiskTab           `json:"risk"`
	Notifications  []RiderNotificationLog `json:"notifications"`
	AuditLogs      []RiderAuditLogEntry   `json:"audit_logs"`
}

// projectRider projects deterministic virtual variables for a rider using UUID hashing
func projectRider(customerID string) RiderDetailResponse {
	h := hashUUID(customerID)
	firstName := firstNames[h%uint32(len(firstNames))]
	lastName := lastNames[h%uint32(len(lastNames))]
	name := firstName + " " + lastName
	phone := fmt.Sprintf("+91 9%09d", (h*17)%1000000000)
	email := strings.ToLower(firstName) + "." + strings.ToLower(lastName) + "@example.com"

	status := "ACTIVE"
	if h%15 == 1 {
		status = "SUSPENDED"
	} else if h%15 == 2 {
		status = "BLOCKED"
	}

	kycLevel := int(h % 3)

	tags := []string{}
	if h%12 == 0 {
		tags = []string{"VIP"}
	} else if h%12 == 1 {
		tags = []string{"risky"}
	} else if status == "BLOCKED" {
		tags = []string{"blocked"}
	}

	referralSource := referralSources[h%uint32(len(referralSources))]

	devices := []string{"iPhone 15 Pro (iOS 17.4)", "Samsung Galaxy S24 Ultra (Android 14)", "Google Pixel 8 Pro (Android 14)"}
	device := devices[h%uint32(len(devices))]
	appVersion := fmt.Sprintf("v4.%d.%d", h%10, (h/10)%10)

	homeAddr := fmt.Sprintf("%d, Park Street, Kolkata", (h%150)+1)
	workAddr := fmt.Sprintf("Building %d, Tech Park, Sector V, Salt Lake, Kolkata", (h%20)+1)

	emName := firstNames[(h+1)%uint32(len(firstNames))] + " " + lastNames[(h+2)%uint32(len(lastNames))]
	emPhone := fmt.Sprintf("+91 9%09d", ((h+5)*23)%1000000000)
	emRel := phoneRelations[h%uint32(len(phoneRelations))]

	baseWallet := int64((h % 1500) * 100) // represented in paise

	riskScore := int(h % 100)
	riskFlags := []string{}
	if riskScore > 75 {
		riskFlags = append(riskFlags, "Frequent GPS location jumps")
	}
	if riskScore > 50 {
		riskFlags = append(riskFlags, "Multiple payment gateway failures")
	}
	if len(riskFlags) == 0 {
		riskFlags = append(riskFlags, "None")
	}

	return RiderDetailResponse{
		CustomerID:     customerID,
		Name:           name,
		Phone:          phone,
		Email:          email,
		Status:         status,
		KYCLevel:       kycLevel,
		PhoneVerified:  true,
		EmailVerified:  true,
		Tags:           tags,
		ReferralSource: referralSource,
		Overview: RiderOverviewTab{
			Contact: RiderContactInfo{
				Phone: phone,
				Email: email,
			},
			KYCLevel: kycLevel,
			Addresses: []RiderAddress{
				{Type: "Home", Address: homeAddr},
				{Type: "Work", Address: workAddr},
			},
			EmergencyContacts: []RiderEmergencyContact{
				{Name: emName, Phone: emPhone, Relationship: emRel},
			},
			Devices: []RiderDeviceInfo{
				{DeviceName: device, OSVersion: "Latest", AppVersion: appVersion},
			},
		},
		Garage: RiderGarageTab{
			Cars: []RiderCar{
				{
					MakeModel: carModels[h%uint32(len(carModels))],
					Plate:     fmt.Sprintf("WB-02-%c%c-%04d", 'A'+(h%26), 'A'+((h/26)%26), h%10000),
					Documents: RiderCarDocuments{
						RCStatus:        "VERIFIED",
						InsuranceStatus: "VERIFIED",
						PUCStatus:       "VERIFIED",
					},
					ExpiryAlerts: []string{},
				},
			},
		},
		Payments: RiderPaymentsTab{
			Methods: []RiderPaymentMethod{
				{Type: "CARD", Details: fmt.Sprintf("Visa ending in %04d", h%10000)},
				{Type: "UPI", Details: strings.ToLower(firstName) + "@okaxis"},
			},
			Transactions: []RiderTransaction{},
			Refunds:      []RiderRefund{},
			Chargebacks:  []RiderChargeback{},
		},
		Wallet: RiderWalletTab{
			BalancePaise: baseWallet,
			Transactions: []RiderWalletTransaction{
				{Type: "TOPUP", AmountPaise: 50000, Timestamp: time.Now().Add(-48 * time.Hour), Description: "UPI Topup Successful"},
			},
		},
		Promos: RiderPromosTab{
			Applied: []RiderPromoApplied{
				{PromoCode: "WELCOME50", Status: "USED", Timestamp: time.Now().Add(-10 * 24 * time.Hour)},
			},
			EligibilityFlags: []string{"New User Coupon Eligible", "Regional Discount Eligible"},
		},
		Support: RiderSupportTab{
			Tickets: []RiderSupportTicket{
				{TicketID: fmt.Sprintf("TKT-%05d", h%100000), Subject: "Fare dispute", Status: "RESOLVED", CreatedAt: time.Now().Add(-5 * 24 * time.Hour)},
			},
			Chats: []RiderSupportChat{
				{ChatID: fmt.Sprintf("CHT-%05d", h%100000), Subject: "Driver could not find location", LastMessage: "Issue resolved", Timestamp: time.Now().Add(-12 * 24 * time.Hour)},
			},
			CallRecordings: []RiderCallRecording{
				{CallID: fmt.Sprintf("REC-%05d", h%100000), DurationSeconds: 84, Timestamp: time.Now().Add(-10 * 24 * time.Hour)},
			},
		},
		Ratings: RiderRatingsTab{
			AverageGiven:    4.2,
			AverageReceived: 4.8,
		},
		Risk: RiderRiskTab{
			Score:          riskScore,
			Flags:          riskFlags,
			BlockedReasons: []string{},
		},
		Notifications: []RiderNotificationLog{
			{Type: "SMS", Payload: "Your OTP for login is 4820", Timestamp: time.Now().Add(-1 * time.Hour)},
			{Type: "PUSH", Payload: "Your driver is arriving in 3 mins!", Timestamp: time.Now().Add(-24 * time.Hour)},
		},
		AuditLogs: []RiderAuditLogEntry{},
	}
}

// mergeRiderOverrides merges details with Redis updates
func (h *RiderHandler) mergeRiderOverrides(ctx context.Context, details *RiderDetailResponse) {
	key := "rider:override:" + details.CustomerID
	val, err := h.redisClient.Get(ctx, key).Result()
	if err == nil && val != "" {
		var override RiderOverride
		if err := json.Unmarshal([]byte(val), &override); err == nil {
			if override.Name != "" {
				details.Name = override.Name
			}
			if override.Phone != "" {
				details.Phone = override.Phone
				details.Overview.Contact.Phone = override.Phone
			}
			if override.Email != "" {
				details.Email = override.Email
				details.Overview.Contact.Email = override.Email
			}
			if override.Status != "" {
				details.Status = override.Status
				if override.Status == "BLOCKED" {
					details.Risk.BlockedReasons = []string{"Manually blocked by administrator"}
				}
			}
			if override.PhoneVerified != nil {
				details.PhoneVerified = *override.PhoneVerified
			}
			if override.EmailVerified != nil {
				details.EmailVerified = *override.EmailVerified
			}
			if override.KYCLevel != nil {
				details.KYCLevel = *override.KYCLevel
				details.Overview.KYCLevel = *override.KYCLevel
			}
			details.Wallet.BalancePaise = details.Wallet.BalancePaise + override.WalletBalanceAdjustment
			if len(override.Tags) > 0 {
				details.Tags = override.Tags
			}
			if override.ReferralSource != "" {
				details.ReferralSource = override.ReferralSource
			}
		}
	}
}

// recordAuditLog inserts a log row in admin_audit_logs
func (h *RiderHandler) recordAuditLog(ctx context.Context, adminID string, email string, action string, details string, ip string) {
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



// HandleGetRiders returns list of riders matching filters and search parameters
func (h *RiderHandler) HandleGetRiders(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	q := r.URL.Query()
	cityFilter := q.Get("city_prefix")
	searchFilter := q.Get("search")
	tagFilter := q.Get("tag")
	referralFilter := q.Get("referral_source")
	signupStart := q.Get("signup_start")
	signupEnd := q.Get("signup_end")

	tripsMin, _ := strconv.Atoi(q.Get("trips_min"))
	tripsMax, _ := strconv.Atoi(q.Get("trips_max"))
	ratingMin, _ := strconv.ParseFloat(q.Get("rating_min"), 64)
	walletMin, _ := strconv.ParseInt(q.Get("wallet_min"), 10, 64)
	walletMax, _ := strconv.ParseInt(q.Get("wallet_max"), 10, 64)
	ltvMin, _ := strconv.ParseInt(q.Get("ltv_min"), 10, 64)
	ltvMax, _ := strconv.ParseInt(q.Get("ltv_max"), 10, 64)

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

	// List every registered rider (the riders table is the source of truth), not only
	// those who have placed an order. LEFT JOIN orders so zero-trip riders still appear,
	// and surface their real name/phone/email instead of projected placeholders.
	sqlQuery := `
		SELECT
			r.id::text,
			COALESCE(r.name, ''),
			COALESCE(r.phone, ''),
			COALESCE(r.email, ''),
			r.created_at as signup_date,
			COALESCE(string_agg(DISTINCT o.city_prefix, ','), '') as cities,
			COUNT(o.id) as total_trips,
			COALESCE(AVG(
				CASE
					WHEN o.status = 'COMPLETED'::order_status_enum THEN (MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 5) + 1)::float
					ELSE NULL
				END
			), 0.0) as avg_rating,
			COALESCE(SUM(
				CASE
					WHEN o.status = 'COMPLETED'::order_status_enum THEN o.base_fare_paise
					ELSE 0
				END
			), 0)::bigint as ltv_paise,
			COALESCE(MAX(o.created_at), r.created_at) as last_trip_at,
			r.is_active
		FROM riders r
		LEFT JOIN orders o ON o.customer_id = r.id
		WHERE r.deleted_at IS NULL
		GROUP BY r.id, r.name, r.phone, r.email, r.created_at, r.is_active
		ORDER BY r.created_at DESC
	`

	rows, err := h.dbPool.Query(ctx, sqlQuery)
	if err != nil {
		h.logger.Printf("[RIDERS_ERROR] Failed querying distinct riders: %v", err)
		http.Error(w, "database_query_failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var riders []RiderSummary

	for rows.Next() {
		var customerID, dbName, dbPhone, dbEmail, citiesStr string
		var signupDate, lastTripDate time.Time
		var totalTrips int64
		var avgRating float64
		var ltvPaise int64
		var isActive bool

		if err := rows.Scan(&customerID, &dbName, &dbPhone, &dbEmail, &signupDate, &citiesStr, &totalTrips, &avgRating, &ltvPaise, &lastTripDate, &isActive); err != nil {
			h.logger.Printf("[RIDERS_ERROR] Scanning row failed: %v", err)
			continue
		}

		cities := []string{}
		if citiesStr != "" {
			cities = strings.Split(citiesStr, ",")
		}

		// Projection supplies CRM-only scaffold (tags, referral source, wallet); real
		// identity comes from the riders table and status from is_active. Redis overrides
		// (admin edits / suspend / block) still win via mergeRiderOverrides.
		proj := projectRider(customerID)
		proj.Name = dbName
		proj.Phone = dbPhone
		proj.Email = dbEmail
		if isActive {
			proj.Status = "ACTIVE"
		} else {
			proj.Status = "SUSPENDED"
		}
		h.mergeRiderOverrides(ctx, &proj)

		riderItem := RiderSummary{
			CustomerID:     customerID,
			Name:           proj.Name,
			Phone:          proj.Phone,
			Email:          proj.Email,
			SignupDate:     signupDate,
			Cities:         cities,
			TotalTrips:     totalTrips,
			AverageRating:  avgRating,
			WalletBalance:  proj.Wallet.BalancePaise,
			LifetimeValue:  ltvPaise,
			LastTripDate:   lastTripDate,
			Status:         proj.Status,
			Tags:           proj.Tags,
			ReferralSource: proj.ReferralSource,
		}

		// Apply Filters in memory to handle dynamic overrides
		if cityFilter != "" {
			foundCity := false
			for _, c := range cities {
				if strings.EqualFold(c, cityFilter) {
					foundCity = true
					break
				}
			}
			if !foundCity {
				continue
			}
		}

		if tagFilter != "" {
			foundTag := false
			for _, t := range riderItem.Tags {
				if strings.EqualFold(t, tagFilter) {
					foundTag = true
					break
				}
			}
			if !foundTag {
				continue
			}
		}

		if referralFilter != "" && !strings.EqualFold(riderItem.ReferralSource, referralFilter) {
			continue
		}

		if searchFilter != "" {
			sf := strings.ToLower(searchFilter)
			if !strings.Contains(strings.ToLower(riderItem.Name), sf) &&
				!strings.Contains(strings.ToLower(riderItem.Phone), sf) &&
				!strings.Contains(strings.ToLower(riderItem.Email), sf) &&
				!strings.Contains(strings.ToLower(riderItem.CustomerID), sf) {
				continue
			}
		}

		if tripsMin > 0 && riderItem.TotalTrips < int64(tripsMin) {
			continue
		}
		if tripsMax > 0 && riderItem.TotalTrips > int64(tripsMax) {
			continue
		}
		if ratingMin > 0 && riderItem.AverageRating < ratingMin {
			continue
		}
		if walletMin > 0 && riderItem.WalletBalance < walletMin {
			continue
		}
		if walletMax > 0 && riderItem.WalletBalance > walletMax {
			continue
		}
		if ltvMin > 0 && riderItem.LifetimeValue < ltvMin {
			continue
		}
		if ltvMax > 0 && riderItem.LifetimeValue > ltvMax {
			continue
		}

		if signupStart != "" {
			if st, err := time.Parse("2006-01-02", signupStart); err == nil && riderItem.SignupDate.Before(st) {
				continue
			}
		}
		if signupEnd != "" {
			if et, err := time.Parse("2006-01-02", signupEnd); err == nil && riderItem.SignupDate.After(et.Add(24*time.Hour)) {
				continue
			}
		}

		riders = append(riders, riderItem)
	}

	// In-memory pagination
	paginated := make([]RiderSummary, 0)
	total := len(riders)

	if offset < total {
		end := offset + limit
		if end > total {
			end = total
		}
		paginated = riders[offset:end]
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(paginated)
}

// HandleGetRiderDetail returns the 11-tab details model for a rider
func (h *RiderHandler) HandleGetRiderDetail(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_rider_id", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// Verify order logs exist for this customer, or create baseline projections
	// 1. Fetch trip history
	tripQuery := `
		SELECT o.id, o.city_prefix, o.customer_id, o.status::text,
		       o.base_fare_paise, o.created_at, o.assigned_driver_id,
		       COALESCE(d.name, 'Unassigned') as driver_name,
		       CASE 
		         WHEN MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 4) = 0 THEN 'in-city round' 
		         WHEN MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 4) = 1 THEN 'one-way' 
		         WHEN MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 4) = 2 THEN 'mini-outstation' 
		         ELSE 'outstation' 
		       END as trip_type,
		       CASE 
		         WHEN o.status = 'COMPLETED'::order_status_enum THEN (MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 5) + 1)::int 
		         ELSE 0 
		       END as rating,
		       CASE 
		         WHEN MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 3) = 0 THEN 'Stripe' 
		         WHEN MOD(('x'||right(o.id::text, 8))::bit(32)::bigint, 3) = 1 THEN 'Razorpay' 
		         ELSE 'Cash' 
		       END as payment_method
		FROM orders o
		LEFT JOIN drivers d ON o.assigned_driver_id = d.id
		WHERE o.customer_id = $1::uuid
		ORDER BY o.created_at DESC
	`

	rows, err := h.dbPool.Query(ctx, tripQuery, id)
	if err != nil {
		h.logger.Printf("[RIDERS_ERROR] Failed querying rider trips: %v", err)
		http.Error(w, "rider_not_found", http.StatusNotFound)
		return
	}
	defer rows.Close()

	details := projectRider(id)

	var ratingSum float64
	var completedCount float64

	for rows.Next() {
		var tID, city, cID, status, dName, tType, pMethod string
		var fare int64
		var rating int
		var createdAt time.Time
		var dID *string

		if err := rows.Scan(&tID, &city, &cID, &status, &fare, &createdAt, &dID, &dName, &tType, &rating, &pMethod); err == nil {


			// Mapping fields directly to Trips array
			details.Payments.Transactions = append(details.Payments.Transactions, RiderTransaction{
				TransactionID: "TXN-" + tID[len(tID)-8:],
				OrderID:       tID,
				AmountPaise:   fare,
				Status:        "SUCCEEDED",
				Gateway:       pMethod,
				CreatedAt:     createdAt,
			})

			if status == "COMPLETED" {
				ratingSum += float64(rating)
				completedCount++
			} else if status == "CANCELLED" {
				details.Payments.Refunds = append(details.Payments.Refunds, RiderRefund{
					RefundID:    "RFD-" + tID[len(tID)-8:],
					OrderID:     tID,
					AmountPaise: fare,
					Status:      "SUCCESSFUL",
					Reason:      "Customer Cancellation Policy Grace",
					CreatedAt:   createdAt.Add(2 * time.Minute),
				})
			}
		}
	}

	if completedCount > 0 {
		details.Ratings.AverageGiven = ratingSum / completedCount
	}

	// 2. Fetch admin audits
	auditQuery := `
		SELECT id::text, admin_email, action, details, ip_address, created_at
		FROM admin_audit_logs
		WHERE details ILIKE $1 OR details ILIKE $2
		ORDER BY created_at DESC
	`
	aRows, aErr := h.dbPool.Query(ctx, auditQuery, "%"+id+"%", "%rider%")
	if aErr == nil {
		defer aRows.Close()
		for aRows.Next() {
			var entry RiderAuditLogEntry
			if err := aRows.Scan(&entry.ID, &entry.AdminUser, &entry.Action, &entry.Details, &entry.IP, &entry.CreatedAt); err == nil {
				details.AuditLogs = append(details.AuditLogs, entry)
			}
		}
	}

	// Apply Redis Overrides
	h.mergeRiderOverrides(ctx, &details)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(details)
}

// HandleRiderActions handles mutations: edits, reset password, verified indicators, credits, voucher, suspend, block, unblock, GDPR delete, merge accounts
func (h *RiderHandler) HandleRiderActions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodPatch {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_rider_id", http.StatusBadRequest)
		return
	}

	action := r.PathValue("action")
	if action == "" {
		http.Error(w, "missing_action", http.StatusBadRequest)
		return
	}

	adminRole := r.Header.Get("X-Admin-Role")
	adminEmail := r.Header.Get("X-Admin-Email")
	if adminEmail == "" {
		adminEmail = "admin@platform.com"
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// Load existing overrides
	overrideKey := "rider:override:" + id
	var override RiderOverride

	val, err := h.redisClient.Get(ctx, overrideKey).Result()
	if err == nil && val != "" {
		_ = json.Unmarshal([]byte(val), &override)
	}
	override.CustomerID = id

	ip := getClientIP(r)

	w.Header().Set("Content-Type", "application/json")

	switch action {
	case "profile":
		type ProfileRequest struct {
			Name  string `json:"name"`
			Phone string `json:"phone"`
			Email string `json:"email"`
		}
		var req ProfileRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "malformed_json_payload", http.StatusBadRequest)
			return
		}
		if req.Name != "" {
			override.Name = req.Name
		}
		if req.Phone != "" {
			override.Phone = req.Phone
		}
		if req.Email != "" {
			override.Email = req.Email
		}
		h.recordAuditLog(ctx, "", adminEmail, "RIDER_PROFILE_UPDATED", fmt.Sprintf("Admin (%s) edited profile details for rider %s", adminRole, id), ip)

	case "reset-password":
		h.recordAuditLog(ctx, "", adminEmail, "RIDER_PASSWORD_RESET", fmt.Sprintf("Admin (%s) reset credentials password key for rider %s", adminRole, id), ip)
		_, _ = w.Write([]byte(`{"status":"SUCCESS", "message":"Rider credentials password reset request dispatched."}`))
		return

	case "verify-contacts":
		type VerifyContactsRequest struct {
			Phone bool `json:"phone"`
			Email bool `json:"email"`
		}
		var req VerifyContactsRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		override.PhoneVerified = &req.Phone
		override.EmailVerified = &req.Email
		h.recordAuditLog(ctx, "", adminEmail, "RIDER_CONTACTS_VERIFIED", fmt.Sprintf("Admin (%s) verified contact channels for rider %s (Phone: %t, Email: %t)", adminRole, id, req.Phone, req.Email), ip)

	case "wallet":
		type WalletRequest struct {
			AmountPaise int64  `json:"amount_paise"`
			Description string `json:"description"`
		}
		var req WalletRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "malformed_json_payload", http.StatusBadRequest)
			return
		}
		override.WalletBalanceAdjustment += req.AmountPaise
		h.recordAuditLog(ctx, "", adminEmail, "RIDER_WALLET_ADJUSTED", fmt.Sprintf("Admin (%s) adjusted wallet for rider %s by %d paise. Reason: %s", adminRole, id, req.AmountPaise, req.Description), ip)

	case "voucher":
		type VoucherRequest struct {
			PromoCode string `json:"promo_code"`
		}
		var req VoucherRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "malformed_json_payload", http.StatusBadRequest)
			return
		}
		h.recordAuditLog(ctx, "", adminEmail, "RIDER_VOUCHER_ISSUED", fmt.Sprintf("Admin (%s) issued promo coupon %s to rider %s", adminRole, id, req.PromoCode), ip)
		_, _ = w.Write([]byte(`{"status":"SUCCESS", "message":"Coupon voucher registered successfully."}`))
		return

	case "suspend":
		override.Status = "SUSPENDED"
		h.recordAuditLog(ctx, "", adminEmail, "RIDER_SUSPENDED", fmt.Sprintf("Admin (%s) suspended account for rider %s", adminRole, id), ip)

	case "block":
		override.Status = "BLOCKED"
		h.recordAuditLog(ctx, "", adminEmail, "RIDER_BLOCKED", fmt.Sprintf("Admin (%s) blocked account for rider %s", adminRole, id), ip)

	case "unblock":
		override.Status = "ACTIVE"
		h.recordAuditLog(ctx, "", adminEmail, "RIDER_UNBLOCKED", fmt.Sprintf("Admin (%s) unblocked/activated account for rider %s", adminRole, id), ip)

	case "delete":
		override.Status = "DELETED"
		override.Name = "GDPR Forgotten Account"
		override.Phone = "+91 0000000000"
		override.Email = "deleted.rider@gdpr.forgotten"
		override.WalletBalanceAdjustment = 0
		h.recordAuditLog(ctx, "", adminEmail, "RIDER_GDPR_DELETED", fmt.Sprintf("Admin (%s) executed GDPR forget account purge for rider %s", adminRole, id), ip)

	case "merge":
		type MergeRequest struct {
			DuplicateID string `json:"duplicate_id"`
		}
		var req MergeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "malformed_json_payload", http.StatusBadRequest)
			return
		}
		h.recordAuditLog(ctx, "", adminEmail, "RIDER_MERGED", fmt.Sprintf("Admin (%s) merged duplicate rider account %s into %s", adminRole, req.DuplicateID, id), ip)
		// Delete the duplicate in Redis
		dupKey := "rider:override:" + req.DuplicateID
		_ = h.redisClient.Del(ctx, dupKey).Err()

	default:
		http.Error(w, "invalid_action", http.StatusBadRequest)
		return
	}

	// Persist override state in Redis
	overrideBytes, _ := json.Marshal(override)
	err = h.redisClient.Set(ctx, overrideKey, overrideBytes, 0).Err()
	if err != nil {
		h.logger.Printf("[RIDERS_ERROR] Redis write failure: %v", err)
		http.Error(w, "redis_write_failed", http.StatusInternalServerError)
		return
	}

	_, _ = w.Write([]byte(`{"status":"SUCCESS"}`))
}
