package http

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// InsuranceHandler serves the rider D4M-Care insurance claims + coverage API,
// backed by rider_insurance_claims (claims) and orders.d4m_care_opted (coverage).
type InsuranceHandler struct {
	db     *pgxpool.Pool
	logger *log.Logger
}

func NewInsuranceHandler(db *pgxpool.Pool, logger *log.Logger) *InsuranceHandler {
	return &InsuranceHandler{db: db, logger: logger}
}

func (h *InsuranceHandler) internal(w http.ResponseWriter, err error) {
	if h.logger != nil {
		h.logger.Printf("[RIDER_INSURANCE] internal error: %v", err)
	}
	writeError(w, http.StatusInternalServerError, "internal server error", "ERR_INTERNAL")
}

type insuranceClaim struct {
	ID          string    `json:"id"`
	OrderID     string    `json:"order_id"`
	ClaimType   string    `json:"claim_type"`
	Description string    `json:"description"`
	Status      string    `json:"status"`
	AmountPaise *int64    `json:"amount_paise,omitempty"`
	Photos      []string  `json:"photos,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

type adminInsuranceClaim struct {
	insuranceClaim
	RiderID   string `json:"rider_id"`
	RiderName string `json:"rider_name"`
}

func (h *InsuranceHandler) HandleListClaims(w http.ResponseWriter, r *http.Request) {
	riderID, ok := riderIDFromContext(w, r)
	if !ok {
		return
	}
	rows, err := h.db.Query(r.Context(), `
		SELECT id::text, order_id::text, COALESCE(claim_type, ''), COALESCE(description, ''), status, amount_paise, photos, created_at
		FROM rider_insurance_claims
		WHERE rider_id = $1::uuid
		ORDER BY created_at DESC`, riderID)
	if err != nil {
		h.internal(w, err)
		return
	}
	defer rows.Close()

	claims := make([]insuranceClaim, 0)
	for rows.Next() {
		var c insuranceClaim
		var photos []byte
		if err := rows.Scan(&c.ID, &c.OrderID, &c.ClaimType, &c.Description, &c.Status, &c.AmountPaise, &photos, &c.CreatedAt); err != nil {
			h.internal(w, err)
			return
		}
		c.Photos = decodePhotos(photos)
		claims = append(claims, c)
	}
	if err := rows.Err(); err != nil {
		h.internal(w, err)
		return
	}
	writeData(w, http.StatusOK, claims)
}

func (h *InsuranceHandler) AdminListClaims(w http.ResponseWriter, r *http.Request) {
	riderID := strings.TrimSpace(r.PathValue("riderId"))
	if riderID == "" {
		writeError(w, http.StatusBadRequest, "rider_id is required", "ERR_VALIDATION")
		return
	}

	rows, err := h.db.Query(r.Context(), `
		SELECT c.id::text, c.order_id::text, c.rider_id::text, COALESCE(r.name, 'Rider'),
		       COALESCE(c.claim_type, ''), COALESCE(c.description, ''), c.status, c.amount_paise, c.photos, c.created_at
		FROM rider_insurance_claims c
		LEFT JOIN riders r ON r.id = c.rider_id
		WHERE c.rider_id = $1::uuid
		ORDER BY c.created_at DESC`, riderID)
	if err != nil {
		h.internal(w, err)
		return
	}
	defer rows.Close()

	claims := make([]adminInsuranceClaim, 0)
	for rows.Next() {
		var c adminInsuranceClaim
		var photos []byte
		if err := rows.Scan(
			&c.ID, &c.OrderID, &c.RiderID, &c.RiderName,
			&c.ClaimType, &c.Description, &c.Status, &c.AmountPaise, &photos, &c.CreatedAt,
		); err != nil {
			h.internal(w, err)
			return
		}
		c.Photos = decodePhotos(photos)
		claims = append(claims, c)
	}
	if err := rows.Err(); err != nil {
		h.internal(w, err)
		return
	}
	writeData(w, http.StatusOK, claims)
}

// AdminListAllClaims backs GET /api/v1/admin/insurance/claims — every claim across
// all riders, newest first. Mirrors AdminListClaims but without the rider_id filter.
func (h *InsuranceHandler) AdminListAllClaims(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(r.Context(), `
		SELECT c.id::text, c.order_id::text, c.rider_id::text, COALESCE(r.name, 'Rider'),
		       COALESCE(c.claim_type, ''), COALESCE(c.description, ''), c.status, c.amount_paise, c.photos, c.created_at
		FROM rider_insurance_claims c
		LEFT JOIN riders r ON r.id = c.rider_id
		ORDER BY c.created_at DESC
		LIMIT 200`)
	if err != nil {
		h.internal(w, err)
		return
	}
	defer rows.Close()

	claims := make([]adminInsuranceClaim, 0)
	for rows.Next() {
		var c adminInsuranceClaim
		var photos []byte
		if err := rows.Scan(
			&c.ID, &c.OrderID, &c.RiderID, &c.RiderName,
			&c.ClaimType, &c.Description, &c.Status, &c.AmountPaise, &photos, &c.CreatedAt,
		); err != nil {
			h.internal(w, err)
			return
		}
		c.Photos = decodePhotos(photos)
		claims = append(claims, c)
	}
	if err := rows.Err(); err != nil {
		h.internal(w, err)
		return
	}
	writeData(w, http.StatusOK, claims)
}

func (h *InsuranceHandler) AdminGetClaim(w http.ResponseWriter, r *http.Request) {
	claimID := strings.TrimSpace(r.PathValue("claimId"))
	if claimID == "" {
		writeError(w, http.StatusBadRequest, "claim_id is required", "ERR_VALIDATION")
		return
	}

	claim, ok := h.adminClaimByID(w, r, claimID)
	if !ok {
		return
	}
	writeData(w, http.StatusOK, claim)
}

type adminUpdateClaimStatusRequest struct {
	Status string `json:"status"`
	Note   string `json:"note"`
}

func (h *InsuranceHandler) AdminUpdateClaimStatus(w http.ResponseWriter, r *http.Request) {
	claimID := strings.TrimSpace(r.PathValue("claimId"))
	if claimID == "" {
		writeError(w, http.StatusBadRequest, "claim_id is required", "ERR_VALIDATION")
		return
	}

	var req adminUpdateClaimStatusRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", "ERR_BAD_REQUEST")
		return
	}

	status, ok := adminClaimStatus(req.Status)
	if !ok {
		writeError(w, http.StatusBadRequest, "status must be approved, rejected, or pending", "ERR_VALIDATION")
		return
	}

	tag, err := h.db.Exec(r.Context(), `
		UPDATE rider_insurance_claims
		SET status = $2, updated_at = now()
		WHERE id = $1::uuid`, claimID, status)
	if err != nil {
		h.internal(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "claim not found", "ERR_NOT_FOUND")
		return
	}
	if h.logger != nil && strings.TrimSpace(req.Note) != "" {
		h.logger.Printf("[RIDER_INSURANCE] admin updated claim %s to %s: %s", claimID, status, strings.TrimSpace(req.Note))
	}

	claim, ok := h.adminClaimByID(w, r, claimID)
	if !ok {
		return
	}
	writeData(w, http.StatusOK, claim)
}

func adminClaimStatus(status string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "approved":
		return "APPROVED", true
	case "rejected":
		return "REJECTED", true
	case "pending":
		return "UNDER_REVIEW", true
	default:
		return "", false
	}
}

func (h *InsuranceHandler) adminClaimByID(w http.ResponseWriter, r *http.Request, claimID string) (adminInsuranceClaim, bool) {
	var c adminInsuranceClaim
	var photos []byte
	err := h.db.QueryRow(r.Context(), `
		SELECT c.id::text, c.order_id::text, c.rider_id::text, COALESCE(r.name, 'Rider'),
		       COALESCE(c.claim_type, ''), COALESCE(c.description, ''), c.status, c.amount_paise, c.photos, c.created_at
		FROM rider_insurance_claims c
		LEFT JOIN riders r ON r.id = c.rider_id
		WHERE c.id = $1::uuid`, claimID).Scan(
		&c.ID, &c.OrderID, &c.RiderID, &c.RiderName,
		&c.ClaimType, &c.Description, &c.Status, &c.AmountPaise, &photos, &c.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "claim not found", "ERR_NOT_FOUND")
		return adminInsuranceClaim{}, false
	}
	if err != nil {
		h.internal(w, err)
		return adminInsuranceClaim{}, false
	}
	c.Photos = decodePhotos(photos)
	return c, true
}

type fileClaimRequest struct {
	OrderID     string   `json:"order_id"`
	ClaimType   string   `json:"claim_type"`
	Description string   `json:"description"`
	AmountPaise *int64   `json:"amount_paise"`
	Photos      []string `json:"photos"`
}

func (h *InsuranceHandler) HandleFileClaim(w http.ResponseWriter, r *http.Request) {
	riderID, ok := riderIDFromContext(w, r)
	if !ok {
		return
	}
	var req fileClaimRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", "ERR_BAD_REQUEST")
		return
	}
	if strings.TrimSpace(req.OrderID) == "" {
		writeError(w, http.StatusBadRequest, "order_id is required", "ERR_VALIDATION")
		return
	}
	claimType := strings.ToUpper(strings.TrimSpace(req.ClaimType))
	switch claimType {
	case "ACCIDENT", "PROPERTY_DAMAGE", "OTHER":
	default:
		writeError(w, http.StatusBadRequest, "claim_type must be ACCIDENT, PROPERTY_DAMAGE, or OTHER", "ERR_VALIDATION")
		return
	}

	// Marshal the submitted photo URLs to a JSONB array for persistence.
	var photosJSON []byte
	if len(req.Photos) > 0 {
		photosJSON, _ = json.Marshal(req.Photos)
	}

	var c insuranceClaim
	var photosOut []byte
	err := h.db.QueryRow(r.Context(), `
		INSERT INTO rider_insurance_claims (order_id, rider_id, claim_type, description, status, amount_paise, photos)
		VALUES ($1::uuid, $2::uuid, $3, $4, 'OPEN', $5, $6)
		RETURNING id::text, order_id::text, claim_type, COALESCE(description, ''), status, amount_paise, photos, created_at`,
		req.OrderID, riderID, claimType, req.Description, req.AmountPaise, photosJSON).Scan(
		&c.ID, &c.OrderID, &c.ClaimType, &c.Description, &c.Status, &c.AmountPaise, &photosOut, &c.CreatedAt)
	if err != nil {
		h.internal(w, err)
		return
	}
	c.Photos = decodePhotos(photosOut)
	writeData(w, http.StatusCreated, c)
}

func (h *InsuranceHandler) HandleCoverage(w http.ResponseWriter, r *http.Request) {
	riderID, ok := riderIDFromContext(w, r)
	if !ok {
		return
	}
	orderID := r.PathValue("orderId")

	var d4mOpted bool
	err := h.db.QueryRow(r.Context(),
		`SELECT d4m_care_opted FROM orders WHERE id = $1::uuid AND rider_id = $2::uuid`,
		orderID, riderID).Scan(&d4mOpted)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "order not found", "ERR_NOT_FOUND")
		return
	}
	if err != nil {
		h.internal(w, err)
		return
	}

	resp := map[string]any{"order_id": orderID, "covered": d4mOpted}
	if d4mOpted {
		resp["plan"] = "D4M Care"
		resp["coverage_amount_paise"] = int64(50000000) // ₹5,00,000 cover
	}
	writeData(w, http.StatusOK, resp)
}

// decodePhotos unmarshals the JSONB photos column ([]string) into a slice;
// returns nil for a NULL/empty/malformed column so the field is omitted.
func decodePhotos(raw []byte) []string {
	if len(raw) == 0 {
		return nil
	}
	var photos []string
	if err := json.Unmarshal(raw, &photos); err != nil {
		return nil
	}
	return photos
}
