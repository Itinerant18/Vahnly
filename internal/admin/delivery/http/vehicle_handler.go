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

type VehicleHandler struct {
	dbPool      *pgxpool.Pool
	redisClient *redis.ClusterClient
	logger      *log.Logger
}

func NewVehicleHandler(dbPool *pgxpool.Pool, redisClient *redis.ClusterClient, logger *log.Logger) *VehicleHandler {
	return &VehicleHandler{
		dbPool:      dbPool,
		redisClient: redisClient,
		logger:      logger,
	}
}

type Vehicle struct {
	Plate               string    `json:"plate"`
	Model               string    `json:"model"`
	Type                string    `json:"type"` // Hatchback, Sedan, SUV, Premium
	Transmission        string    `json:"transmission"` // Manual, Automatic
	Fuel                string    `json:"fuel"` // Petrol, Diesel, EV, CNG
	Year                int       `json:"year"`
	OwnerID             string    `json:"owner_id"`
	OwnerName           string    `json:"owner_name"`
	OwnerType           string    `json:"owner_type"` // DRIVER, RIDER
	City                string    `json:"city"`
	TripsCount          int64     `json:"trips_count"`
	LastServiced        time.Time `json:"last_serviced"`
	RCStatus            string    `json:"rc_status"` // VERIFIED, EXPIRED, EXPIRING_SOON
	RCExpiryDate        time.Time `json:"rc_expiry_date"`
	InsuranceStatus     string    `json:"insurance_status"` // VERIFIED, EXPIRED, EXPIRING_SOON
	InsuranceExpiryDate time.Time `json:"insurance_expiry_date"`
	PUCStatus           string    `json:"puc_status"` // VERIFIED, EXPIRED, EXPIRING_SOON
	PUCExpiryDate       time.Time `json:"puc_expiry_date"`
	FlaggedIssues       []string  `json:"flagged_issues"`
	ReminderSentAt      time.Time `json:"reminder_sent_at,omitempty"`
}

type VehicleOverride struct {
	RCStatus            string    `json:"rc_status,omitempty"`
	RCExpiryDate        time.Time `json:"rc_expiry_date,omitempty"`
	InsuranceStatus     string    `json:"insurance_status,omitempty"`
	InsuranceExpiryDate time.Time `json:"insurance_expiry_date,omitempty"`
	PUCStatus           string    `json:"puc_status,omitempty"`
	PUCExpiryDate       time.Time `json:"puc_expiry_date,omitempty"`
	FlaggedIssues       []string  `json:"flagged_issues,omitempty"`
	LastServiced        time.Time `json:"last_serviced,omitempty"`
}

type PredefinedVehicle struct {
	Model        string
	Type         string
	Transmission string
	Fuel         string
	Year         int
}

var predefinedVehicles = []PredefinedVehicle{
	{"Maruti Swift", "Hatchback", "Manual", "Petrol", 2020},
	{"Hyundai i20", "Hatchback", "Manual", "Petrol", 2021},
	{"Honda City", "Sedan", "Automatic", "Petrol", 2019},
	{"Hyundai Verna", "Sedan", "Automatic", "Diesel", 2022},
	{"Toyota Fortuner", "SUV", "Automatic", "Diesel", 2018},
	{"Maruti Brezza", "SUV", "Manual", "CNG", 2021},
	{"Tata Nexon EV", "SUV", "Automatic", "EV", 2023},
	{"BMW 3 Series", "Premium", "Automatic", "Petrol", 2022},
	{"Audi A4", "Premium", "Automatic", "Petrol", 2021},
}

func hashPlate(plate string) uint32 {
	var hash uint32 = 2166136261
	for i := 0; i < len(plate); i++ {
		hash ^= uint32(plate[i])
		hash *= 16777619
	}
	return hash
}

func projectVehicleProperties(plate string, v *Vehicle) {
	h := hashPlate(plate)
	pv := predefinedVehicles[h%uint32(len(predefinedVehicles))]
	v.Model = pv.Model
	v.Type = pv.Type
	v.Transmission = pv.Transmission
	v.Fuel = pv.Fuel
	v.Year = pv.Year

	// RC Status & Expiry Date (valid for 15 years from Year, or hash-based)
	rcExpiry := time.Date(pv.Year+15, time.Month((h%12)+1), int((h%28)+1), 0, 0, 0, 0, time.UTC)
	v.RCExpiryDate = rcExpiry
	if rcExpiry.Before(time.Now()) {
		v.RCStatus = "EXPIRED"
	} else if rcExpiry.Before(time.Now().AddDate(0, 0, 30)) {
		v.RCStatus = "EXPIRING_SOON"
	} else {
		v.RCStatus = "VERIFIED"
	}

	// Insurance Status & Expiry Date
	var insExpiry time.Time
	if h%10 == 0 {
		insExpiry = time.Now().AddDate(0, 0, -int(h%15+1)) // expired 1 to 15 days ago
	} else if h%10 == 1 {
		insExpiry = time.Now().AddDate(0, 0, int(h%15+1))  // expiring in 1 to 15 days
	} else {
		insExpiry = time.Now().AddDate(0, 0, int(h%300+30)) // expiring in 30 to 330 days
	}
	v.InsuranceExpiryDate = insExpiry
	if insExpiry.Before(time.Now()) {
		v.InsuranceStatus = "EXPIRED"
	} else if insExpiry.Before(time.Now().AddDate(0, 0, 30)) {
		v.InsuranceStatus = "EXPIRING_SOON"
	} else {
		v.InsuranceStatus = "VERIFIED"
	}

	// PUC Status & Expiry Date
	var pucExpiry time.Time
	if h%15 == 0 {
		pucExpiry = time.Now().AddDate(0, 0, -int(h%15+1))
	} else if h%15 == 1 {
		pucExpiry = time.Now().AddDate(0, 0, int(h%15+1))
	} else {
		pucExpiry = time.Now().AddDate(0, 0, int(h%180+30))
	}
	v.PUCExpiryDate = pucExpiry
	if pucExpiry.Before(time.Now()) {
		v.PUCStatus = "EXPIRED"
	} else if pucExpiry.Before(time.Now().AddDate(0, 0, 30)) {
		v.PUCStatus = "EXPIRING_SOON"
	} else {
		v.PUCStatus = "VERIFIED"
	}

	// Last Serviced
	v.LastServiced = time.Now().AddDate(0, -int((h%6)+1), -int(h%28))

	// Flagged Issues
	if h%8 == 0 {
		v.FlaggedIssues = []string{"Brake pads wearing out", "AC cooling insufficient"}
	} else if h%8 == 1 {
		v.FlaggedIssues = []string{"Slight rattle in front left suspension"}
	} else if h%8 == 2 {
		v.FlaggedIssues = []string{"Left tail light bulb broken"}
	} else {
		v.FlaggedIssues = []string{}
	}
}

func (h *VehicleHandler) mergeVehicleOverrides(ctx context.Context, v *Vehicle) {
	overrideKey := "vehicle:override:" + v.Plate
	val, err := h.redisClient.Get(ctx, overrideKey).Result()
	if err == nil && val != "" {
		var override VehicleOverride
		if err := json.Unmarshal([]byte(val), &override); err == nil {
			if override.RCStatus != "" {
				v.RCStatus = override.RCStatus
			}
			if !override.RCExpiryDate.IsZero() {
				v.RCExpiryDate = override.RCExpiryDate
			}
			if override.InsuranceStatus != "" {
				v.InsuranceStatus = override.InsuranceStatus
			}
			if !override.InsuranceExpiryDate.IsZero() {
				v.InsuranceExpiryDate = override.InsuranceExpiryDate
			}
			if override.PUCStatus != "" {
				v.PUCStatus = override.PUCStatus
			}
			if !override.PUCExpiryDate.IsZero() {
				v.PUCExpiryDate = override.PUCExpiryDate
			}
			if override.FlaggedIssues != nil {
				v.FlaggedIssues = override.FlaggedIssues
			}
			if !override.LastServiced.IsZero() {
				v.LastServiced = override.LastServiced
			}
		}
	}

	reminderKey := "vehicle:reminder:" + v.Plate
	remVal, err := h.redisClient.Get(ctx, reminderKey).Result()
	if err == nil && remVal != "" {
		if t, err := time.Parse(time.RFC3339, remVal); err == nil {
			v.ReminderSentAt = t
		}
	}
}

func (h *VehicleHandler) HandleGetVehicles(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// 1. Query distinct drivers and orders to construct trip vehicles
	sqlOrders := `
		SELECT 
			o.id::text,
			o.assigned_driver_id::text,
			COALESCE(d.name, 'Unknown Driver') as driver_name,
			COALESCE(d.city_prefix, o.city_prefix) as city,
			o.customer_id::text
		FROM orders o
		LEFT JOIN drivers d ON o.assigned_driver_id = d.id
	`
	rows, err := h.dbPool.Query(ctx, sqlOrders)
	if err != nil {
		h.logger.Printf("[VEHICLES_ERROR] Failed to query orders: %v", err)
		http.Error(w, "database_query_failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	vehicleMap := make(map[string]*Vehicle)
	riderCustomerIDs := make(map[string]string) // customer_id -> city_prefix

	for rows.Next() {
		var orderID, driverIDOpt, driverName, city, customerID string
		err := rows.Scan(&orderID, &driverIDOpt, &driverName, &city, &customerID)
		if err != nil {
			h.logger.Printf("[VEHICLES_ERROR] Failed to scan row: %v", err)
			continue
		}

		if customerID != "" {
			riderCustomerIDs[customerID] = city
		}

		if driverIDOpt != "" && driverIDOpt != "00000000-0000-0000-0000-000000000000" {
			// Compute trip vehicle plate using order ID hash
			val := hashUUID(orderID)
			plate := fmt.Sprintf("WB-02-%c%c-%04d", 'A'+(val%26), 'A'+((val/26)%26), val%10000)

			v, exists := vehicleMap[plate]
			if !exists {
				v = &Vehicle{
					Plate:      plate,
					OwnerID:    driverIDOpt,
					OwnerName:  driverName,
					OwnerType:  "DRIVER",
					City:       city,
					TripsCount: 0,
				}
				projectVehicleProperties(plate, v)
				vehicleMap[plate] = v
			}
			v.TripsCount++
		}
	}

	// 2. Project Rider Garage Vehicles
	for customerID, city := range riderCustomerIDs {
		val := hashUUID(customerID)
		plate := fmt.Sprintf("WB-02-%c%c-%04d", 'A'+(val%26), 'A'+((val/26)%26), val%10000)

		if _, exists := vehicleMap[plate]; !exists {
			v := &Vehicle{
				Plate:      plate,
				OwnerID:    customerID,
				OwnerName:  projectRiderName(customerID),
				OwnerType:  "RIDER",
				City:       city,
				TripsCount: 0, // Garage cars have 0 recorded trips by default unless matches trip vehicle
			}
			projectVehicleProperties(plate, v)
			vehicleMap[plate] = v
		}
	}

	// Apply overrides and build result array
	var vehicles []Vehicle
	for _, v := range vehicleMap {
		h.mergeVehicleOverrides(ctx, v)
		vehicles = append(vehicles, *v)
	}

	// Apply Filters
	q := r.URL.Query()
	typeFilter := q.Get("type")
	transmissionFilter := q.Get("transmission")
	fuelFilter := q.Get("fuel")
	yearStr := q.Get("year")
	rcExpiredOnly := q.Get("rc_expired") == "true"
	insuranceExpiredOnly := q.Get("insurance_expired") == "true"
	searchFilter := q.Get("search")

	var filtered []Vehicle
	for _, v := range vehicles {
		if typeFilter != "" && !strings.EqualFold(v.Type, typeFilter) {
			continue
		}
		if transmissionFilter != "" && !strings.EqualFold(v.Transmission, transmissionFilter) {
			continue
		}
		if fuelFilter != "" && !strings.EqualFold(v.Fuel, fuelFilter) {
			continue
		}
		if yearStr != "" {
			if yr, err := strconv.Atoi(yearStr); err == nil && v.Year != yr {
				continue
			}
		}
		if rcExpiredOnly && v.RCStatus != "EXPIRED" {
			continue
		}
		if insuranceExpiredOnly && v.InsuranceStatus != "EXPIRED" {
			continue
		}
		if searchFilter != "" {
			sf := strings.ToLower(searchFilter)
			if !strings.Contains(strings.ToLower(v.Plate), sf) &&
				!strings.Contains(strings.ToLower(v.Model), sf) &&
				!strings.Contains(strings.ToLower(v.OwnerName), sf) {
				continue
			}
		}
		filtered = append(filtered, v)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(filtered)
}

func (h *VehicleHandler) HandleSendDocReminders(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	adminEmail := r.Header.Get("X-Admin-Email")
	if adminEmail == "" {
		adminEmail = "admin@platform.com"
	}

	// Fetch all vehicles to locate the ones with expired or expiring soon documents
	sqlOrders := `
		SELECT 
			o.id::text,
			o.assigned_driver_id::text,
			COALESCE(d.name, 'Unknown Driver') as driver_name,
			COALESCE(d.city_prefix, o.city_prefix) as city,
			o.customer_id::text
		FROM orders o
		LEFT JOIN drivers d ON o.assigned_driver_id = d.id
	`
	rows, err := h.dbPool.Query(ctx, sqlOrders)
	if err != nil {
		h.logger.Printf("[VEHICLES_ERROR] Reminders query failed: %v", err)
		http.Error(w, "database_query_failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	vehicleMap := make(map[string]*Vehicle)
	riderCustomerIDs := make(map[string]string)

	for rows.Next() {
		var orderID, driverIDOpt, driverName, city, customerID string
		if err := rows.Scan(&orderID, &driverIDOpt, &driverName, &city, &customerID); err == nil {
			if customerID != "" {
				riderCustomerIDs[customerID] = city
			}
			if driverIDOpt != "" && driverIDOpt != "00000000-0000-0000-0000-000000000000" {
				val := hashUUID(orderID)
				plate := fmt.Sprintf("WB-02-%c%c-%04d", 'A'+(val%26), 'A'+((val/26)%26), val%10000)
				if _, exists := vehicleMap[plate]; !exists {
					v := &Vehicle{
						Plate:     plate,
						OwnerName: driverName,
						OwnerType: "DRIVER",
					}
					projectVehicleProperties(plate, v)
					vehicleMap[plate] = v
				}
			}
		}
	}

	for customerID, city := range riderCustomerIDs {
		val := hashUUID(customerID)
		plate := fmt.Sprintf("WB-02-%c%c-%04d", 'A'+(val%26), 'A'+((val/26)%26), val%10000)
		if _, exists := vehicleMap[plate]; !exists {
			v := &Vehicle{
				Plate:     plate,
				OwnerName: projectRiderName(customerID),
				OwnerType: "RIDER",
				City:      city,
			}
			projectVehicleProperties(plate, v)
			vehicleMap[plate] = v
		}
	}

	nowStr := time.Now().Format(time.RFC3339)
	remindersSent := 0

	for plate, v := range vehicleMap {
		h.mergeVehicleOverrides(ctx, v)
		if v.RCStatus == "EXPIRED" || v.RCStatus == "EXPIRING_SOON" ||
			v.InsuranceStatus == "EXPIRED" || v.InsuranceStatus == "EXPIRING_SOON" ||
			v.PUCStatus == "EXPIRED" || v.PUCStatus == "EXPIRING_SOON" {
			
			reminderKey := "vehicle:reminder:" + plate
			err := h.redisClient.Set(ctx, reminderKey, nowStr, 0).Err()
			if err != nil {
				h.logger.Printf("[VEHICLES_ERROR] Failed to save reminder timestamp for %s: %v", plate, err)
				continue
			}
			remindersSent++
		}
	}

	// Write to Audit Log
	h.recordAuditLog(ctx, "00000000-0000-0000-0000-000000000000", adminEmail, "BULK_REMINDERS_SENT", fmt.Sprintf("Sent document renewal warnings to %d vehicles", remindersSent), getClientIP(r))

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(fmt.Sprintf(`{"status":"SUCCESS", "reminders_sent":%d}`, remindersSent)))
}

func (h *VehicleHandler) HandlePostVehicleOverride(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	plate := r.PathValue("plate")
	if plate == "" {
		http.Error(w, "missing_plate", http.StatusBadRequest)
		return
	}

	adminEmail := r.Header.Get("X-Admin-Email")
	if adminEmail == "" {
		adminEmail = "admin@platform.com"
	}

	var req VehicleOverride
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid_json_body", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	overrideKey := "vehicle:override:" + plate
	overrideBytes, err := json.Marshal(req)
	if err != nil {
		http.Error(w, "failed_to_serialize_override", http.StatusInternalServerError)
		return
	}

	err = h.redisClient.Set(ctx, overrideKey, overrideBytes, 0).Err()
	if err != nil {
		h.logger.Printf("[VEHICLES_ERROR] Redis save override failed for %s: %v", plate, err)
		http.Error(w, "redis_write_failed", http.StatusInternalServerError)
		return
	}

	h.recordAuditLog(ctx, "00000000-0000-0000-0000-000000000000", adminEmail, "VEHICLE_OVERRIDE_UPDATED", fmt.Sprintf("Updated manual overrides for vehicle %s", plate), getClientIP(r))

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"status":"SUCCESS"}`))
}

func (h *VehicleHandler) recordAuditLog(ctx context.Context, adminID string, email string, action string, details string, ip string) {
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

func projectRiderName(customerID string) string {
	h := hashUUID(customerID)
	firstName := firstNames[h%uint32(len(firstNames))]
	lastName := lastNames[h%uint32(len(lastNames))]
	return firstName + " " + lastName
}
