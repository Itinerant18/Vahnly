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
	ID          string   `json:"id"`
	OrderID     string   `json:"order_id"`
	ClaimType   string   `json:"claim_type"`
	Description string   `json:"description"`
	Status      string   `json:"status"`
	AmountPaise *int64   `json:"amount_paise,omitempty"`
	Photos      []string `json:"photos,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
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
