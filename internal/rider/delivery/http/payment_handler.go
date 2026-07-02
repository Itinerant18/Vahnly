package http

import (
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PaymentHandler serves the rider saved-payment-methods API. Tokenization is
// out of scope here: cards are stored as brand + last4 only (never the PAN),
// UPI as the VPA. method_type is reused from rider_saved_payment_methods.
type PaymentHandler struct {
	db     *pgxpool.Pool
	logger *log.Logger
}

func NewPaymentHandler(db *pgxpool.Pool, logger *log.Logger) *PaymentHandler {
	return &PaymentHandler{db: db, logger: logger}
}

func (h *PaymentHandler) internal(w http.ResponseWriter, err error) {
	if h.logger != nil {
		h.logger.Printf("[RIDER_PAYMENT] internal error: %v", err)
	}
	writeError(w, http.StatusInternalServerError, "internal server error", "ERR_INTERNAL")
}

type savedCard struct {
	ID       string `json:"id"`
	Brand    string `json:"brand"`
	Last4    string `json:"last4"`
	ExpMonth int    `json:"exp_month"`
	ExpYear  int    `json:"exp_year"`
	Default  bool   `json:"is_default"`
}

type upiMethod struct {
	ID      string `json:"id"`
	VPA     string `json:"vpa"`
	Default bool   `json:"is_default"`
}

type paymentMethodsResponse struct {
	Cards []savedCard `json:"cards"`
	UPIs  []upiMethod `json:"upis"`
}

// listMethods reads every active payment method for the rider and splits them
// into the cards/upis shape the frontend expects. display_label encodes the
// human-readable summary; provider holds the card brand for CARD rows.
func (h *PaymentHandler) listMethods(w http.ResponseWriter, r *http.Request, riderID string) {
	rows, err := h.db.Query(r.Context(), `
		SELECT id::text, method_type, COALESCE(provider, ''), COALESCE(display_label, ''), is_default
		FROM rider_saved_payment_methods
		WHERE rider_id = $1::uuid AND is_active
		ORDER BY is_default DESC, created_at DESC`, riderID)
	if err != nil {
		h.internal(w, err)
		return
	}
	defer rows.Close()

	resp := paymentMethodsResponse{Cards: []savedCard{}, UPIs: []upiMethod{}}
	for rows.Next() {
		var id, methodType, provider, label string
		var isDefault bool
		if err := rows.Scan(&id, &methodType, &provider, &label, &isDefault); err != nil {
			h.internal(w, err)
			return
		}
		switch methodType {
		case "CARD":
			// display_label encodes "last4|exp_month|exp_year".
			last4, expM, expY := decodeCardLabel(label)
			resp.Cards = append(resp.Cards, savedCard{
				ID: id, Brand: provider, Last4: last4, ExpMonth: expM, ExpYear: expY, Default: isDefault,
			})
		case "UPI":
			resp.UPIs = append(resp.UPIs, upiMethod{ID: id, VPA: label, Default: isDefault})
		}
	}
	if err := rows.Err(); err != nil {
		h.internal(w, err)
		return
	}
	writeData(w, http.StatusOK, resp)
}

func (h *PaymentHandler) HandleListPaymentMethods(w http.ResponseWriter, r *http.Request) {
	riderID, ok := riderIDFromContext(w, r)
	if !ok {
		return
	}
	h.listMethods(w, r, riderID)
}

type addPaymentMethodRequest struct {
	Type       string `json:"type"`
	VPA        string `json:"vpa"`
	CardNumber string `json:"card_number"`
	ExpMonth   int    `json:"exp_month"`
	ExpYear    int    `json:"exp_year"`
	Name       string `json:"name"`
}

func (h *PaymentHandler) HandleAddPaymentMethod(w http.ResponseWriter, r *http.Request) {
	riderID, ok := riderIDFromContext(w, r)
	if !ok {
		return
	}
	var req addPaymentMethodRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", "ERR_BAD_REQUEST")
		return
	}

	switch strings.ToUpper(req.Type) {
	case "CARD":
		digits := onlyDigits(req.CardNumber)
		if len(digits) < 4 {
			writeError(w, http.StatusBadRequest, "card_number is required", "ERR_VALIDATION")
			return
		}
		if req.ExpMonth < 1 || req.ExpMonth > 12 || req.ExpYear < 2000 || req.ExpYear > 2100 {
			writeError(w, http.StatusBadRequest, "invalid card expiry", "ERR_VALIDATION")
			return
		}
		brand := cardBrand(digits)
		last4 := digits[len(digits)-4:]
		label := encodeCardLabel(last4, req.ExpMonth, req.ExpYear)
		// provider_token is NOT NULL: store a non-reversible reference, never the PAN.
		token := "tok_card_" + last4
		if _, err := h.db.Exec(r.Context(), `
			INSERT INTO rider_saved_payment_methods (rider_id, method_type, provider, provider_token, display_label)
			VALUES ($1::uuid, 'CARD', $2, $3, $4)`, riderID, brand, token, label); err != nil {
			h.internal(w, err)
			return
		}
	case "UPI":
		vpa := strings.TrimSpace(req.VPA)
		if !strings.Contains(vpa, "@") {
			writeError(w, http.StatusBadRequest, "a valid UPI id is required", "ERR_VALIDATION")
			return
		}
		token := "tok_upi_" + vpa
		if _, err := h.db.Exec(r.Context(), `
			INSERT INTO rider_saved_payment_methods (rider_id, method_type, provider, provider_token, display_label)
			VALUES ($1::uuid, 'UPI', 'UPI', $2, $3)`, riderID, token, vpa); err != nil {
			h.internal(w, err)
			return
		}
	default:
		writeError(w, http.StatusBadRequest, "type must be CARD or UPI", "ERR_VALIDATION")
		return
	}

	h.listMethods(w, r, riderID)
}

func (h *PaymentHandler) HandleDeletePaymentMethod(w http.ResponseWriter, r *http.Request) {
	riderID, ok := riderIDFromContext(w, r)
	if !ok {
		return
	}
	tag, err := h.db.Exec(r.Context(), `
		UPDATE rider_saved_payment_methods SET is_active = false
		WHERE id = $1::uuid AND rider_id = $2::uuid`, r.PathValue("methodId"), riderID)
	if err != nil {
		h.internal(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "payment method not found", "ERR_NOT_FOUND")
		return
	}
	writeData(w, http.StatusOK, map[string]any{"message": "payment method removed"})
}

func (h *PaymentHandler) HandleSetDefaultPaymentMethod(w http.ResponseWriter, r *http.Request) {
	riderID, ok := riderIDFromContext(w, r)
	if !ok {
		return
	}
	methodID := r.PathValue("methodId")
	tx, err := h.db.Begin(r.Context())
	if err != nil {
		h.internal(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	if _, err := tx.Exec(r.Context(), `UPDATE rider_saved_payment_methods SET is_default = false WHERE rider_id = $1::uuid`, riderID); err != nil {
		h.internal(w, err)
		return
	}
	tag, err := tx.Exec(r.Context(), `
		UPDATE rider_saved_payment_methods SET is_default = true
		WHERE id = $1::uuid AND rider_id = $2::uuid AND is_active`, methodID, riderID)
	if err != nil {
		h.internal(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "payment method not found", "ERR_NOT_FOUND")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		h.internal(w, err)
		return
	}
	writeData(w, http.StatusOK, map[string]any{"message": "default payment method updated"})
}

// HandleVerifyUPI is a stub: a VPA is considered valid if it contains '@'.
// RIDER-scoped so the route sits behind the rider auth middleware.
func (h *PaymentHandler) HandleVerifyUPI(w http.ResponseWriter, r *http.Request) {
	if _, ok := riderIDFromContext(w, r); !ok {
		return
	}
	vpa := strings.TrimSpace(r.URL.Query().Get("id"))
	if !strings.Contains(vpa, "@") {
		writeError(w, http.StatusBadRequest, "invalid UPI id", "ERR_VALIDATION")
		return
	}
	writeData(w, http.StatusOK, map[string]any{"valid": true, "name": ""})
}

// ---- helpers ----

func onlyDigits(s string) string {
	var b strings.Builder
	for _, c := range s {
		if c >= '0' && c <= '9' {
			b.WriteRune(c)
		}
	}
	return b.String()
}

// cardBrand derives the brand from the first digit (4=VISA, 5=MASTERCARD, else CARD).
func cardBrand(digits string) string {
	if len(digits) == 0 {
		return "CARD"
	}
	switch digits[0] {
	case '4':
		return "VISA"
	case '5':
		return "MASTERCARD"
	default:
		return "CARD"
	}
}

// encodeCardLabel/decodeCardLabel pack the displayable card fields into the
// existing display_label column ("last4|exp_month|exp_year").
func encodeCardLabel(last4 string, expM, expY int) string {
	return last4 + "|" + strconv.Itoa(expM) + "|" + strconv.Itoa(expY)
}

func decodeCardLabel(label string) (last4 string, expM, expY int) {
	parts := strings.Split(label, "|")
	if len(parts) > 0 {
		last4 = parts[0]
	}
	if len(parts) > 1 {
		expM, _ = strconv.Atoi(parts[1])
	}
	if len(parts) > 2 {
		expY, _ = strconv.Atoi(parts[2])
	}
	return last4, expM, expY
}

// riderIDFromContext is the shared rider-id accessor used by the supplementary
// rider handlers (payments, insurance, support, notification prefs, nearby).
func riderIDFromContext(w http.ResponseWriter, r *http.Request) (string, bool) {
	rider, ok := GetRiderFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing authenticated rider", "ERR_UNAUTHENTICATED")
		return "", false
	}
	return rider.ID, true
}
