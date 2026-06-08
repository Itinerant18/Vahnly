package http

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type CorporateHandler struct {
	dbPool *pgxpool.Pool
	logger *log.Logger
}

func NewCorporateHandler(dbPool *pgxpool.Pool, logger *log.Logger) *CorporateHandler {
	return &CorporateHandler{dbPool: dbPool, logger: logger}
}

// ── Accounts ──────────────────────────────────────────────────────────────────

type CorporateAccount struct {
	ID                  string  `json:"id"`
	CompanyName         string  `json:"company_name"`
	GSTIN               string  `json:"gstin"`
	BillingEmail        string  `json:"billing_email"`
	BillingAddress      string  `json:"billing_address"`
	CityPrefix          string  `json:"city_prefix"`
	PlanType            string  `json:"plan_type"`
	IsActive            bool    `json:"is_active"`
	CreditLimitPaise    int64   `json:"credit_limit_paise"`
	CurrentBalancePaise int64   `json:"current_balance_paise"`
	ContractStartDate   *string `json:"contract_start_date"`
	ContractEndDate     *string `json:"contract_end_date"`
	PrimaryContactName  string  `json:"primary_contact_name"`
	PrimaryContactPhone string  `json:"primary_contact_phone"`
	SSOProvider         string  `json:"sso_provider"`
	SSODomain           string  `json:"sso_domain"`
	CreatedBy           string  `json:"created_by"`
	CreatedAt           string  `json:"created_at"`
	// Computed
	EmployeeCount int `json:"employee_count"`
}

func (h *CorporateHandler) HandleGetAccounts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()

	q := r.URL.Query()
	search := q.Get("search")
	plan := q.Get("plan_type")

	base := `FROM corporate_accounts ca WHERE 1=1`
	var args []interface{}
	idx := 1
	if search != "" {
		base += fmt.Sprintf(" AND ca.company_name ILIKE $%d", idx)
		args = append(args, "%"+search+"%")
		idx++
	}
	if plan != "" {
		base += fmt.Sprintf(" AND ca.plan_type = $%d", idx)
		args = append(args, plan)
		idx++
	}

	var total int64
	_ = h.dbPool.QueryRow(ctx, "SELECT COUNT(*) "+base, args...).Scan(&total)

	limit := parseBoundedQueryInt(q.Get("limit"), 50, 1, 200)
	offset := parseBoundedQueryInt(q.Get("offset"), 0, 0, 1_000_000)

	rows, err := h.dbPool.Query(ctx,
		`SELECT ca.id::TEXT, ca.company_name, ca.gstin, ca.billing_email, ca.billing_address,
		        ca.city_prefix, ca.plan_type, ca.is_active, ca.credit_limit_paise, ca.current_balance_paise,
		        ca.contract_start_date::TEXT, ca.contract_end_date::TEXT,
		        ca.primary_contact_name, ca.primary_contact_phone, ca.sso_provider, ca.sso_domain,
		        ca.created_by, ca.created_at::TEXT,
		        COUNT(ce.id) AS employee_count
		 `+base+`
		 LEFT JOIN corporate_employees ce ON ce.corporate_id = ca.id AND ce.is_active = true
		 GROUP BY ca.id
		 ORDER BY ca.company_name
		 LIMIT $`+fmt.Sprint(idx)+` OFFSET $`+fmt.Sprint(idx+1),
		append(args, limit, offset)...)
	if err != nil {
		h.logger.Printf("[CORP] list accounts failed: %v", err)
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	accounts := make([]CorporateAccount, 0)
	for rows.Next() {
		var a CorporateAccount
		if err := rows.Scan(&a.ID, &a.CompanyName, &a.GSTIN, &a.BillingEmail, &a.BillingAddress,
			&a.CityPrefix, &a.PlanType, &a.IsActive, &a.CreditLimitPaise, &a.CurrentBalancePaise,
			&a.ContractStartDate, &a.ContractEndDate,
			&a.PrimaryContactName, &a.PrimaryContactPhone, &a.SSOProvider, &a.SSODomain,
			&a.CreatedBy, &a.CreatedAt, &a.EmployeeCount); err == nil {
			accounts = append(accounts, a)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"accounts": accounts, "total": total})
}

func (h *CorporateHandler) HandleCreateAccount(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	var req CorporateAccount
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.CompanyName == "" {
		http.Error(w, "invalid_payload", http.StatusBadRequest)
		return
	}
	if req.PlanType == "" {
		req.PlanType = "STANDARD"
	}
	if req.CityPrefix == "" {
		req.CityPrefix = "KOL"
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	adminEmail := r.Header.Get("X-Admin-Email")
	var id string
	err := h.dbPool.QueryRow(ctx,
		`INSERT INTO corporate_accounts
		 (company_name, gstin, billing_email, billing_address, city_prefix, plan_type,
		  credit_limit_paise, primary_contact_name, primary_contact_phone, sso_provider, sso_domain, created_by)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id::TEXT`,
		req.CompanyName, req.GSTIN, req.BillingEmail, req.BillingAddress, req.CityPrefix, req.PlanType,
		req.CreditLimitPaise, req.PrimaryContactName, req.PrimaryContactPhone, req.SSOProvider, req.SSODomain, adminEmail,
	).Scan(&id)
	if err != nil {
		h.logger.Printf("[CORP] create account failed: %v", err)
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]any{"id": id})
}

func (h *CorporateHandler) HandleUpdateAccount(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	id := r.PathValue("id")
	var req CorporateAccount
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid_payload", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	_, _ = h.dbPool.Exec(ctx,
		`UPDATE corporate_accounts SET
		    company_name=$2, gstin=$3, billing_email=$4, billing_address=$5,
		    plan_type=$6, credit_limit_paise=$7, primary_contact_name=$8,
		    primary_contact_phone=$9, is_active=$10, updated_at=NOW()
		 WHERE id=$1::uuid`,
		id, req.CompanyName, req.GSTIN, req.BillingEmail, req.BillingAddress,
		req.PlanType, req.CreditLimitPaise, req.PrimaryContactName, req.PrimaryContactPhone, req.IsActive)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"updated"}`))
}

// ── Employees ─────────────────────────────────────────────────────────────────

type CorporateEmployee struct {
	ID                string `json:"id"`
	CorporateID       string `json:"corporate_id"`
	Name              string `json:"name"`
	Email             string `json:"email"`
	Phone             string `json:"phone"`
	EmployeeID        string `json:"employee_id"`
	Department        string `json:"department"`
	CostCenter        string `json:"cost_center"`
	Role              string `json:"role"`
	IsActive          bool   `json:"is_active"`
	MonthlyLimitPaise int64  `json:"monthly_limit_paise"`
	CreatedAt         string `json:"created_at"`
}

func (h *CorporateHandler) HandleGetEmployees(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	corpID := r.PathValue("id")
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	q := r.URL.Query()
	search := q.Get("search")
	dept := q.Get("department")
	limit := parseBoundedQueryInt(q.Get("limit"), 100, 1, 500)
	offset := parseBoundedQueryInt(q.Get("offset"), 0, 0, 100000)

	base := `FROM corporate_employees WHERE corporate_id = $1::uuid`
	args := []interface{}{corpID}
	idx := 2
	if search != "" {
		base += fmt.Sprintf(" AND (name ILIKE $%d OR email ILIKE $%d)", idx, idx)
		args = append(args, "%"+search+"%")
		idx++
	}
	if dept != "" {
		base += fmt.Sprintf(" AND department = $%d", idx)
		args = append(args, dept)
		idx++
	}

	var total int64
	_ = h.dbPool.QueryRow(ctx, "SELECT COUNT(*) "+base, args...).Scan(&total)

	rows, err := h.dbPool.Query(ctx,
		`SELECT id::TEXT, corporate_id::TEXT, name, email, phone, employee_id, department,
		        cost_center, role, is_active, monthly_limit_paise, created_at::TEXT `+
			base+fmt.Sprintf(" ORDER BY name LIMIT $%d OFFSET $%d", idx, idx+1),
		append(args, limit, offset)...)
	if err != nil {
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	employees := make([]CorporateEmployee, 0)
	for rows.Next() {
		var e CorporateEmployee
		if err := rows.Scan(&e.ID, &e.CorporateID, &e.Name, &e.Email, &e.Phone, &e.EmployeeID,
			&e.Department, &e.CostCenter, &e.Role, &e.IsActive, &e.MonthlyLimitPaise, &e.CreatedAt); err == nil {
			employees = append(employees, e)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"employees": employees, "total": total})
}

func (h *CorporateHandler) HandleAddEmployee(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	corpID := r.PathValue("id")
	var req CorporateEmployee
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Email == "" {
		http.Error(w, "invalid_payload", http.StatusBadRequest)
		return
	}
	if req.Role == "" {
		req.Role = "EMPLOYEE"
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	var empID string
	err := h.dbPool.QueryRow(ctx,
		`INSERT INTO corporate_employees (corporate_id, name, email, phone, employee_id, department, cost_center, role, monthly_limit_paise)
		 VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (corporate_id, email) DO UPDATE
		 SET name=$2, phone=$4, department=$6, cost_center=$7, role=$8, monthly_limit_paise=$9
		 RETURNING id::TEXT`,
		corpID, req.Name, req.Email, req.Phone, req.EmployeeID,
		req.Department, req.CostCenter, req.Role, req.MonthlyLimitPaise,
	).Scan(&empID)
	if err != nil {
		h.logger.Printf("[CORP] add employee failed: %v", err)
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]any{"id": empID})
}

// HandleBulkUploadEmployees parses a CSV: name,email,phone,employee_id,department,cost_center,role
func (h *CorporateHandler) HandleBulkUploadEmployees(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	corpID := r.PathValue("id")
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	inserted, skipped := 0, 0
	var errDetails []string

	scanner := bufio.NewScanner(r.Body)
	lineNum := 0
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		lineNum++
		if lineNum == 1 || line == "" {
			continue
		} // skip header and blank lines
		cols := strings.Split(line, ",")
		if len(cols) < 3 {
			skipped++
			errDetails = append(errDetails, fmt.Sprintf("line %d: insufficient columns", lineNum))
			continue
		}
		name := strings.TrimSpace(cols[0])
		email := strings.TrimSpace(cols[1])
		phone := ""
		if len(cols) > 2 {
			phone = strings.TrimSpace(cols[2])
		}
		empID := ""
		if len(cols) > 3 {
			empID = strings.TrimSpace(cols[3])
		}
		dept := ""
		if len(cols) > 4 {
			dept = strings.TrimSpace(cols[4])
		}
		cc := ""
		if len(cols) > 5 {
			cc = strings.TrimSpace(cols[5])
		}
		role := "EMPLOYEE"
		if len(cols) > 6 {
			r := strings.ToUpper(strings.TrimSpace(cols[6]))
			if r == "ADMIN" || r == "MANAGER" {
				role = r
			}
		}

		if email == "" {
			skipped++
			continue
		}
		var dummy string
		err := h.dbPool.QueryRow(ctx,
			`INSERT INTO corporate_employees (corporate_id, name, email, phone, employee_id, department, cost_center, role)
			 VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (corporate_id, email) DO NOTHING RETURNING id::TEXT`,
			corpID, name, email, phone, empID, dept, cc, role,
		).Scan(&dummy)
		if err == pgx.ErrNoRows {
			skipped++
		} else if err != nil {
			skipped++
			errDetails = append(errDetails, fmt.Sprintf("line %d: %v", lineNum, err))
		} else {
			inserted++
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"inserted": inserted,
		"skipped":  skipped,
		"errors":   errDetails,
	})
}

func (h *CorporateHandler) HandleUpdateEmployee(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	corpID := r.PathValue("id")
	empID := r.PathValue("empId")
	var req CorporateEmployee
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid_payload", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	_, _ = h.dbPool.Exec(ctx,
		`UPDATE corporate_employees SET name=$3, phone=$4, department=$5, cost_center=$6,
		        role=$7, is_active=$8, monthly_limit_paise=$9
		 WHERE id=$1::uuid AND corporate_id=$2::uuid`,
		empID, corpID, req.Name, req.Phone, req.Department, req.CostCenter,
		req.Role, req.IsActive, req.MonthlyLimitPaise)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"updated"}`))
}

// ── Trip Policies ─────────────────────────────────────────────────────────────

type CorporateTripPolicy struct {
	ID                     int      `json:"id"`
	CorporateID            string   `json:"corporate_id"`
	PolicyName             string   `json:"policy_name"`
	MaxFarePaise           int64    `json:"max_fare_paise"`
	AllowedTripTypes       []string `json:"allowed_trip_types"`
	AllowedCarTypes        []string `json:"allowed_car_types"`
	RequiresApproval       bool     `json:"requires_approval"`
	ApprovalThresholdPaise int64    `json:"approval_threshold_paise"`
	AllowedHoursStart      int      `json:"allowed_hours_start"`
	AllowedHoursEnd        int      `json:"allowed_hours_end"`
	AllowedDays            []string `json:"allowed_days"`
	CostCenterRequired     bool     `json:"cost_center_required"`
	IsDefault              bool     `json:"is_default"`
}

func (h *CorporateHandler) HandleGetPolicies(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	corpID := r.PathValue("id")
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	rows, err := h.dbPool.Query(ctx,
		`SELECT id, corporate_id::TEXT, policy_name, max_fare_paise, allowed_trip_types, allowed_car_types,
		        requires_approval, approval_threshold_paise, allowed_hours_start, allowed_hours_end,
		        allowed_days, cost_center_required, is_default
		 FROM corporate_trip_policies WHERE corporate_id = $1::uuid ORDER BY is_default DESC, id`, corpID)
	if err != nil {
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	policies := make([]CorporateTripPolicy, 0)
	for rows.Next() {
		var p CorporateTripPolicy
		if err := rows.Scan(&p.ID, &p.CorporateID, &p.PolicyName, &p.MaxFarePaise,
			&p.AllowedTripTypes, &p.AllowedCarTypes, &p.RequiresApproval, &p.ApprovalThresholdPaise,
			&p.AllowedHoursStart, &p.AllowedHoursEnd, &p.AllowedDays,
			&p.CostCenterRequired, &p.IsDefault); err == nil {
			policies = append(policies, p)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"policies": policies})
}

func (h *CorporateHandler) HandleUpsertPolicy(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodPatch {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	corpID := r.PathValue("id")
	var req CorporateTripPolicy
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.PolicyName == "" {
		http.Error(w, "invalid_payload", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	if req.ID > 0 {
		_, _ = h.dbPool.Exec(ctx,
			`UPDATE corporate_trip_policies SET policy_name=$2, max_fare_paise=$3, allowed_trip_types=$4,
			        allowed_car_types=$5, requires_approval=$6, approval_threshold_paise=$7,
			        allowed_hours_start=$8, allowed_hours_end=$9, allowed_days=$10,
			        cost_center_required=$11, is_default=$12, updated_at=NOW() WHERE id=$1 AND corporate_id=$13::uuid`,
			req.ID, req.PolicyName, req.MaxFarePaise, req.AllowedTripTypes, req.AllowedCarTypes,
			req.RequiresApproval, req.ApprovalThresholdPaise, req.AllowedHoursStart, req.AllowedHoursEnd,
			req.AllowedDays, req.CostCenterRequired, req.IsDefault, corpID)
	} else {
		_ = h.dbPool.QueryRow(ctx,
			`INSERT INTO corporate_trip_policies
			 (corporate_id, policy_name, max_fare_paise, allowed_trip_types, allowed_car_types,
			  requires_approval, approval_threshold_paise, allowed_hours_start, allowed_hours_end,
			  allowed_days, cost_center_required, is_default)
			 VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
			corpID, req.PolicyName, req.MaxFarePaise, req.AllowedTripTypes, req.AllowedCarTypes,
			req.RequiresApproval, req.ApprovalThresholdPaise, req.AllowedHoursStart, req.AllowedHoursEnd,
			req.AllowedDays, req.CostCenterRequired, req.IsDefault).Scan(&req.ID)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"id": req.ID})
}

// ── Invoices ──────────────────────────────────────────────────────────────────

type CorporateInvoice struct {
	ID            string  `json:"id"`
	CorporateID   string  `json:"corporate_id"`
	InvoiceNumber string  `json:"invoice_number"`
	PeriodStart   string  `json:"period_start"`
	PeriodEnd     string  `json:"period_end"`
	TotalTrips    int     `json:"total_trips"`
	SubtotalPaise int64   `json:"subtotal_paise"`
	GSTPaise      int64   `json:"gst_paise"`
	TotalPaise    int64   `json:"total_paise"`
	Status        string  `json:"status"`
	DueDate       *string `json:"due_date"`
	PaidAt        *string `json:"paid_at"`
	PDFURL        string  `json:"pdf_url"`
	Notes         string  `json:"notes"`
	CreatedAt     string  `json:"created_at"`
}

func (h *CorporateHandler) HandleGetInvoices(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	corpID := r.PathValue("id")
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	rows, err := h.dbPool.Query(ctx,
		`SELECT id::TEXT, corporate_id::TEXT, invoice_number, period_start::TEXT, period_end::TEXT,
		        total_trips, subtotal_paise, gst_paise, total_paise, status,
		        due_date::TEXT, paid_at::TEXT, pdf_url, notes, created_at::TEXT
		 FROM corporate_invoices WHERE corporate_id = $1::uuid ORDER BY period_start DESC`, corpID)
	if err != nil {
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	invoices := make([]CorporateInvoice, 0)
	for rows.Next() {
		var inv CorporateInvoice
		if err := rows.Scan(&inv.ID, &inv.CorporateID, &inv.InvoiceNumber, &inv.PeriodStart, &inv.PeriodEnd,
			&inv.TotalTrips, &inv.SubtotalPaise, &inv.GSTPaise, &inv.TotalPaise, &inv.Status,
			&inv.DueDate, &inv.PaidAt, &inv.PDFURL, &inv.Notes, &inv.CreatedAt); err == nil {
			invoices = append(invoices, inv)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"invoices": invoices})
}

func (h *CorporateHandler) HandleGenerateInvoice(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	corpID := r.PathValue("id")
	var req struct {
		PeriodStart string `json:"period_start"` // YYYY-MM-DD
		PeriodEnd   string `json:"period_end"`
		Notes       string `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.PeriodStart == "" {
		http.Error(w, "invalid_payload", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	// Compute trip aggregate for this corporate account in period
	// In production: join orders with corporate_id; here use a simple aggregate
	var totalTrips int
	var subtotalPaise int64
	_ = h.dbPool.QueryRow(ctx,
		`SELECT COUNT(*), COALESCE(SUM(base_fare_paise),0)
		 FROM orders
		 WHERE corporate_id = $1::uuid AND status = 'COMPLETED'
		   AND created_at >= $2::DATE AND created_at < ($3::DATE + INTERVAL '1 day')`,
		corpID, req.PeriodStart, req.PeriodEnd,
	).Scan(&totalTrips, &subtotalPaise)

	gstPaise := int64(float64(subtotalPaise) * 0.18)
	totalPaise := subtotalPaise + gstPaise

	// Generate invoice number: INV-{COMPANY_SHORT}-{YYYYMM}
	var companyShort string
	_ = h.dbPool.QueryRow(ctx, `SELECT UPPER(SUBSTRING(company_name FROM 1 FOR 4)) FROM corporate_accounts WHERE id=$1::uuid`, corpID).Scan(&companyShort)
	month := req.PeriodStart[:7] // YYYY-MM
	invoiceNumber := fmt.Sprintf("INV-%s-%s", strings.ReplaceAll(companyShort, " ", ""), strings.ReplaceAll(month, "-", ""))

	adminEmail := r.Header.Get("X-Admin-Email")
	var id string
	err := h.dbPool.QueryRow(ctx,
		`INSERT INTO corporate_invoices
		 (corporate_id, invoice_number, period_start, period_end, total_trips,
		  subtotal_paise, gst_paise, total_paise, status, due_date, notes, created_by)
		 VALUES ($1::uuid,$2,$3::DATE,$4::DATE,$5,$6,$7,$8,'DRAFT',($3::DATE + INTERVAL '45 days')::DATE,$9,$10)
		 ON CONFLICT (invoice_number) DO NOTHING RETURNING id::TEXT`,
		corpID, invoiceNumber, req.PeriodStart, req.PeriodEnd, totalTrips,
		subtotalPaise, gstPaise, totalPaise, req.Notes, adminEmail,
	).Scan(&id)
	if err == pgx.ErrNoRows {
		http.Error(w, "invoice_already_exists_for_period", http.StatusConflict)
		return
	}
	if err != nil {
		h.logger.Printf("[CORP] generate invoice failed: %v", err)
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"id":             id,
		"invoice_number": invoiceNumber,
		"total_trips":    totalTrips,
		"total_paise":    totalPaise,
	})
}

func (h *CorporateHandler) HandleUpdateInvoiceStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	invID := r.PathValue("invId")
	var req struct {
		Status string `json:"status"`
		Notes  string `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid_payload", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	extra := ""
	if req.Status == "PAID" {
		extra = ", paid_at = NOW()"
	}
	_, _ = h.dbPool.Exec(ctx,
		`UPDATE corporate_invoices SET status=$2, notes=CASE WHEN $3!='' THEN $3 ELSE notes END,
		        updated_at=NOW()`+extra+` WHERE id=$1::uuid`,
		invID, req.Status, req.Notes)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"updated"}`))
}

// ── Corporate Analytics ───────────────────────────────────────────────────────

func (h *CorporateHandler) HandleGetCorporateAnalytics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	corpID := r.PathValue("id")
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	from, to := parseDateRange(r)

	var totalTrips, totalRevenue int64
	_ = h.dbPool.QueryRow(ctx,
		`SELECT COUNT(*), COALESCE(SUM(base_fare_paise),0)
		 FROM orders WHERE corporate_id=$1::uuid AND status='COMPLETED' AND created_at>=$2 AND created_at<$3`,
		corpID, from, to).Scan(&totalTrips, &totalRevenue)

	var totalEmployees int64
	_ = h.dbPool.QueryRow(ctx, `SELECT COUNT(*) FROM corporate_employees WHERE corporate_id=$1::uuid AND is_active=true`, corpID).Scan(&totalEmployees)

	// Daily trips
	type DayTrip struct {
		Day     string `json:"day"`
		Trips   int64  `json:"trips"`
		Revenue int64  `json:"revenue_paise"`
	}
	dailyRows, _ := h.dbPool.Query(ctx,
		`SELECT DATE(created_at)::TEXT, COUNT(*), COALESCE(SUM(base_fare_paise),0)
		 FROM orders WHERE corporate_id=$1::uuid AND status='COMPLETED' AND created_at>=$2 AND created_at<$3
		 GROUP BY DATE(created_at) ORDER BY 1`, corpID, from, to)
	dailyTrips := make([]DayTrip, 0)
	if dailyRows != nil {
		for dailyRows.Next() {
			var dt DayTrip
			if err := dailyRows.Scan(&dt.Day, &dt.Trips, &dt.Revenue); err == nil {
				dailyTrips = append(dailyTrips, dt)
			}
		}
		dailyRows.Close()
	}

	// Top spenders by department
	type DeptRow struct {
		Department string `json:"department"`
		Trips      int64  `json:"trips"`
		Revenue    int64  `json:"revenue_paise"`
	}
	deptRows, _ := h.dbPool.Query(ctx,
		`SELECT ce.department, COUNT(o.id), COALESCE(SUM(o.base_fare_paise),0)
		 FROM orders o
		 JOIN corporate_employees ce ON ce.corporate_id = $1::uuid
		 WHERE o.corporate_id = $1::uuid AND o.status = 'COMPLETED' AND o.created_at >= $2 AND o.created_at < $3
		 GROUP BY ce.department ORDER BY 3 DESC LIMIT 10`, corpID, from, to)
	deptBreakdown := make([]DeptRow, 0)
	if deptRows != nil {
		for deptRows.Next() {
			var dr DeptRow
			if err := deptRows.Scan(&dr.Department, &dr.Trips, &dr.Revenue); err == nil {
				deptBreakdown = append(deptBreakdown, dr)
			}
		}
		deptRows.Close()
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"total_trips":         totalTrips,
		"total_revenue_paise": totalRevenue,
		"total_employees":     totalEmployees,
		"daily_trips":         dailyTrips,
		"by_department":       deptBreakdown,
	})
}
