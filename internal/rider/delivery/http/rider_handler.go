package http

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/platform/driver-delivery/internal/rider/repository"
	"github.com/platform/driver-delivery/internal/rider/service"
)

// RiderHandler serves the rider auth + onboarding HTTP API. All responses use
// the envelope {"success":true,"data":...} or {"success":false,"error","code"}.
type RiderHandler struct {
	repo       repository.RiderRepository
	auth       *service.AuthService
	onboarding *service.OnboardingService
	referral   *service.ReferralService
	logger     *log.Logger
}

func NewRiderHandler(repo repository.RiderRepository, auth *service.AuthService, onboarding *service.OnboardingService, referral *service.ReferralService, logger *log.Logger) *RiderHandler {
	return &RiderHandler{repo: repo, auth: auth, onboarding: onboarding, referral: referral, logger: logger}
}

// ---- response envelope helpers ----

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeData(w http.ResponseWriter, status int, data any) {
	writeJSON(w, status, map[string]any{"success": true, "data": data})
}

func writeError(w http.ResponseWriter, status int, msg, code string) {
	writeJSON(w, status, map[string]any{"success": false, "error": msg, "code": code})
}

// writeServiceError maps service/repository sentinel errors to HTTP responses.
func (h *RiderHandler) writeServiceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, service.ErrInvalidPhone),
		errors.Is(err, service.ErrInvalidName),
		errors.Is(err, service.ErrInvalidEmail),
		errors.Is(err, service.ErrInvalidDOB),
		errors.Is(err, service.ErrUnderage),
		errors.Is(err, service.ErrInvalidGender),
		errors.Is(err, service.ErrLocationOutOfBounds),
		errors.Is(err, service.ErrMissingCarField):
		writeError(w, http.StatusBadRequest, err.Error(), "ERR_VALIDATION")
	case errors.Is(err, service.ErrOTPRateLimited):
		w.Header().Set("Retry-After", "3600")
		writeError(w, http.StatusTooManyRequests, err.Error(), "ERR_RATE_LIMITED")
	case errors.Is(err, service.ErrOTPNotFound),
		errors.Is(err, service.ErrOTPInvalid),
		errors.Is(err, service.ErrOTPMaxAttempts):
		writeError(w, http.StatusUnauthorized, err.Error(), "ERR_OTP")
	case errors.Is(err, service.ErrMaxEmergencyContacts):
		writeError(w, http.StatusConflict, err.Error(), "ERR_MAX_CONTACTS")
	case errors.Is(err, service.ErrRiderInactive):
		writeError(w, http.StatusForbidden, err.Error(), "ERR_INACTIVE")
	case errors.Is(err, pgx.ErrNoRows):
		writeError(w, http.StatusNotFound, "resource not found", "ERR_NOT_FOUND")
	default:
		if h.logger != nil {
			h.logger.Printf("[RIDER] internal error: %v", err)
		}
		writeError(w, http.StatusInternalServerError, "internal server error", "ERR_INTERNAL")
	}
}

func decodeJSON(r *http.Request, dst any) error {
	return json.NewDecoder(r.Body).Decode(dst)
}

// riderID returns the authenticated rider id, writing a 401 and returning false
// if the rider is missing from context (should not happen behind Require).
func (h *RiderHandler) riderID(w http.ResponseWriter, r *http.Request) (string, bool) {
	rider, ok := GetRiderFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing authenticated rider", "ERR_UNAUTHENTICATED")
		return "", false
	}
	return rider.ID, true
}

func parsePagination(r *http.Request) (limit, offset int) {
	limit, offset = 20, 0
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}
	return limit, offset
}

// ---- Public auth endpoints ----

func (h *RiderHandler) HandleSendOTP(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Phone string `json:"phone"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", "ERR_BAD_REQUEST")
		return
	}
	if err := h.auth.SendOTP(r.Context(), req.Phone); err != nil {
		h.writeServiceError(w, err)
		return
	}
	writeData(w, http.StatusOK, map[string]any{"message": "OTP sent", "expires_in_seconds": 300})
}

func (h *RiderHandler) HandleVerifyOTP(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Phone          string `json:"phone"`
		OTP            string `json:"otp"`
		ReferredByCode string `json:"referred_by_code"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", "ERR_BAD_REQUEST")
		return
	}

	rider, token, err := h.auth.VerifyOTP(r.Context(), req.Phone, req.OTP)
	if err != nil {
		if errors.Is(err, service.ErrNewRider) {
			// Brand-new rider: issue a session token so the client can complete
			// onboarding, and flag the new-user state.
			newToken, tErr := h.auth.IssueSession(r.Context(), rider)
			if tErr != nil {
				h.writeServiceError(w, tErr)
				return
			}
			// Attach the referral (best-effort, off the response path).
			if h.referral != nil && req.ReferredByCode != "" {
				go h.referral.AttachReferral(context.Background(), rider.ID, req.ReferredByCode)
			}
			writeData(w, http.StatusOK, map[string]any{
				"token":        newToken,
				"rider":        rider,
				"is_new_rider": true,
			})
			return
		}
		h.writeServiceError(w, err)
		return
	}
	writeData(w, http.StatusOK, map[string]any{
		"token":        token,
		"rider":        rider,
		"is_new_rider": false,
	})
}

type RiderGoogleLoginRequest struct {
	IDToken        string `json:"id_token"`
	Phone          string `json:"phone,omitempty"`
	OTP            string `json:"otp,omitempty"`
	Name           string `json:"name,omitempty"`
	ReferredByCode string `json:"referred_by_code,omitempty"`
}

func (h *RiderHandler) HandleRiderGoogleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req RiderGoogleLoginRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", "ERR_BAD_REQUEST")
		return
	}

	if req.IDToken == "" {
		writeError(w, http.StatusBadRequest, "Missing Google ID token", "ERR_VALIDATION")
		return
	}

	// Verify ID token via Google TokenInfo API
	tokenInfoUrl := "https://oauth2.googleapis.com/tokeninfo?id_token=" + url.QueryEscape(req.IDToken)
	resp, err := http.Get(tokenInfoUrl)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "Failed to verify ID token with Google", "ERR_UNAUTHENTICATED")
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		writeError(w, http.StatusUnauthorized, "Invalid Google ID token", "ERR_UNAUTHENTICATED")
		return
	}

	var googleClaims struct {
		Email         string      `json:"email"`
		EmailVerified interface{} `json:"email_verified"`
		Name          string      `json:"name"`
		Sub           string      `json:"sub"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&googleClaims); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to decode Google token response", "ERR_INTERNAL")
		return
	}

	if googleClaims.Email == "" {
		writeError(w, http.StatusBadRequest, "Google account does not provide email", "ERR_VALIDATION")
		return
	}

	emailVerified := false
	if googleClaims.EmailVerified != nil {
		switch v := googleClaims.EmailVerified.(type) {
		case bool:
			emailVerified = v
		case string:
			emailVerified = (v == "true")
		}
	}

	if !emailVerified {
		writeError(w, http.StatusUnauthorized, "Google email not verified", "ERR_UNAUTHENTICATED")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	rider, err := h.repo.GetRiderByEmail(ctx, googleClaims.Email)
	if err == nil {
		// Rider is already registered by email. Touch last login.
		_ = h.repo.TouchLastLogin(ctx, rider.ID)

		token, err := h.auth.IssueSession(r.Context(), rider)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}

		writeData(w, http.StatusOK, map[string]any{
			"token":        token,
			"rider":        rider,
			"is_new_rider": false,
		})
		return
	}

	if !errors.Is(err, pgx.ErrNoRows) {
		h.writeServiceError(w, err)
		return
	}

	// User is not registered by email yet. Check if we have a phone number to register.
	if req.Phone == "" {
		writeData(w, http.StatusOK, map[string]any{
			"registered": false,
			"email":      googleClaims.Email,
			"name":       googleClaims.Name,
		})
		return
	}

	// The phone number is safety-critical here (the rider owns the car the driver will
	// operate), so it must be proven via OTP before it is attached to a Google account —
	// both when creating a new rider and when linking the email onto an existing phone-only
	// record (which would otherwise allow taking over someone else's number).
	if err := h.auth.VerifyPhoneOTP(ctx, req.Phone, req.OTP); err != nil {
		h.writeServiceError(w, err)
		return
	}

	// Check if a rider already exists with this phone number.
	existingRider, err := h.repo.GetRiderByPhone(ctx, req.Phone)
	if err == nil {
		// Rider exists by phone. Check if they already have an email.
		if existingRider.Email != nil && *existingRider.Email != "" {
			if strings.ToLower(*existingRider.Email) != strings.ToLower(googleClaims.Email) {
				writeError(w, http.StatusConflict, "Phone number already registered with another email", "ERR_CONFLICT")
				return
			}
		}

		// Link Google email to the existing phone-only record.
		existingRider.Email = &googleClaims.Email
		existingRider.EmailVerified = true
		regName := req.Name
		if regName == "" {
			regName = googleClaims.Name
		}
		if regName != "" {
			existingRider.Name = &regName
		}

		updatedRider, err := h.repo.UpdateRider(ctx, existingRider)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}
		rider = updatedRider
	} else if errors.Is(err, pgx.ErrNoRows) {
		// Completely new rider, register them.
		regName := req.Name
		if regName == "" {
			regName = googleClaims.Name
		}
		if regName == "" {
			regName = "Google Rider"
		}

		newRider, err := h.repo.CreateRiderWithEmail(ctx, req.Phone, googleClaims.Email, regName)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}
		rider = newRider

		// Attach referral (best-effort, background)
		if h.referral != nil && req.ReferredByCode != "" {
			go h.referral.AttachReferral(context.Background(), rider.ID, req.ReferredByCode)
		}
	} else {
		h.writeServiceError(w, err)
		return
	}

	token, err := h.auth.IssueSession(r.Context(), rider)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}

	writeData(w, http.StatusOK, map[string]any{
		"token":        token,
		"rider":        rider,
		"is_new_rider": true,
	})
}

// ---- Profile ----

func (h *RiderHandler) HandleGetMe(w http.ResponseWriter, r *http.Request) {
	rider, ok := GetRiderFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing authenticated rider", "ERR_UNAUTHENTICATED")
		return
	}
	writeData(w, http.StatusOK, rider)
}

func (h *RiderHandler) HandleUpdateMe(w http.ResponseWriter, r *http.Request) {
	id, ok := h.riderID(w, r)
	if !ok {
		return
	}
	var req service.UpdateProfileRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", "ERR_BAD_REQUEST")
		return
	}
	rider, err := h.onboarding.UpdateProfile(r.Context(), id, req)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	writeData(w, http.StatusOK, rider)
}

// ---- DPDP: data portability + erasure ----

// HandleExportMyData returns the authenticated rider's personal data as a portable
// JSON document (DPDP data-portability right).
func (h *RiderHandler) HandleExportMyData(w http.ResponseWriter, r *http.Request) {
	id, ok := h.riderID(w, r)
	if !ok {
		return
	}
	export, err := h.repo.ExportRiderData(r.Context(), id)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	w.Header().Set("Content-Disposition", `attachment; filename="my-data-export.json"`)
	writeData(w, http.StatusOK, export)
}

// HandleDeleteMyAccount erases the rider's account: direct identifiers are scrubbed
// and pure-PII tables purged, while financial/tax/trip records are retained for the
// statutory window (DPDP right to erasure). Idempotent — a second call on an
// already-deleted account returns 404 (no active rider row matched).
func (h *RiderHandler) HandleDeleteMyAccount(w http.ResponseWriter, r *http.Request) {
	id, ok := h.riderID(w, r)
	if !ok {
		return
	}
	if err := h.repo.SoftDeleteRiderAccount(r.Context(), id); err != nil {
		h.writeServiceError(w, err)
		return
	}
	writeData(w, http.StatusOK, map[string]any{"message": "account deleted", "rider_id": id})
}

// ---- Garage ----

func (h *RiderHandler) HandleAddCar(w http.ResponseWriter, r *http.Request) {
	id, ok := h.riderID(w, r)
	if !ok {
		return
	}
	var req service.GarageCarRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", "ERR_BAD_REQUEST")
		return
	}
	req.ID = "" // create path
	car, err := h.onboarding.AddGarageCar(r.Context(), id, req)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	writeData(w, http.StatusCreated, car)
}

func (h *RiderHandler) HandleListCars(w http.ResponseWriter, r *http.Request) {
	id, ok := h.riderID(w, r)
	if !ok {
		return
	}
	cars, err := h.repo.GetGarageCars(r.Context(), id)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	writeData(w, http.StatusOK, cars)
}

func (h *RiderHandler) HandleUpdateCar(w http.ResponseWriter, r *http.Request) {
	id, ok := h.riderID(w, r)
	if !ok {
		return
	}
	var req service.GarageCarRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", "ERR_BAD_REQUEST")
		return
	}
	req.ID = r.PathValue("carId")
	car, err := h.onboarding.AddGarageCar(r.Context(), id, req)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	writeData(w, http.StatusOK, car)
}

func (h *RiderHandler) HandleDeleteCar(w http.ResponseWriter, r *http.Request) {
	id, ok := h.riderID(w, r)
	if !ok {
		return
	}
	if err := h.repo.DeleteGarageCar(r.Context(), r.PathValue("carId"), id); err != nil {
		h.writeServiceError(w, err)
		return
	}
	writeData(w, http.StatusOK, map[string]any{"message": "car removed"})
}

func (h *RiderHandler) HandleSetDefaultCar(w http.ResponseWriter, r *http.Request) {
	id, ok := h.riderID(w, r)
	if !ok {
		return
	}
	if err := h.repo.SetDefaultCar(r.Context(), r.PathValue("carId"), id); err != nil {
		h.writeServiceError(w, err)
		return
	}
	writeData(w, http.StatusOK, map[string]any{"message": "default car updated"})
}

// ---- Saved places ----

func (h *RiderHandler) HandleAddPlace(w http.ResponseWriter, r *http.Request) {
	id, ok := h.riderID(w, r)
	if !ok {
		return
	}
	var req service.SavePlaceRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", "ERR_BAD_REQUEST")
		return
	}
	place, err := h.onboarding.SavePlace(r.Context(), id, req)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	writeData(w, http.StatusCreated, place)
}

func (h *RiderHandler) HandleListPlaces(w http.ResponseWriter, r *http.Request) {
	id, ok := h.riderID(w, r)
	if !ok {
		return
	}
	places, err := h.repo.GetSavedPlaces(r.Context(), id)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	writeData(w, http.StatusOK, places)
}

func (h *RiderHandler) HandleDeletePlace(w http.ResponseWriter, r *http.Request) {
	id, ok := h.riderID(w, r)
	if !ok {
		return
	}
	if err := h.repo.DeleteSavedPlace(r.Context(), r.PathValue("placeId"), id); err != nil {
		h.writeServiceError(w, err)
		return
	}
	writeData(w, http.StatusOK, map[string]any{"message": "place removed"})
}

// ---- Emergency contacts ----

func (h *RiderHandler) HandleAddEmergencyContact(w http.ResponseWriter, r *http.Request) {
	id, ok := h.riderID(w, r)
	if !ok {
		return
	}
	var req service.EmergencyContactRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", "ERR_BAD_REQUEST")
		return
	}
	req.ID = "" // create path — subject to the 3-contact cap
	if err := h.onboarding.AddEmergencyContact(r.Context(), id, req); err != nil {
		h.writeServiceError(w, err)
		return
	}
	writeData(w, http.StatusCreated, map[string]any{"message": "emergency contact added"})
}

func (h *RiderHandler) HandleListEmergencyContacts(w http.ResponseWriter, r *http.Request) {
	id, ok := h.riderID(w, r)
	if !ok {
		return
	}
	contacts, err := h.repo.GetEmergencyContacts(r.Context(), id)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	writeData(w, http.StatusOK, contacts)
}

func (h *RiderHandler) HandleUpdateEmergencyContact(w http.ResponseWriter, r *http.Request) {
	id, ok := h.riderID(w, r)
	if !ok {
		return
	}
	var req service.EmergencyContactRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", "ERR_BAD_REQUEST")
		return
	}
	req.ID = r.PathValue("contactId")
	if err := h.onboarding.AddEmergencyContact(r.Context(), id, req); err != nil {
		h.writeServiceError(w, err)
		return
	}
	writeData(w, http.StatusOK, map[string]any{"message": "emergency contact updated"})
}

func (h *RiderHandler) HandleDeleteEmergencyContact(w http.ResponseWriter, r *http.Request) {
	id, ok := h.riderID(w, r)
	if !ok {
		return
	}
	if err := h.repo.DeleteEmergencyContact(r.Context(), r.PathValue("contactId"), id); err != nil {
		h.writeServiceError(w, err)
		return
	}
	writeData(w, http.StatusOK, map[string]any{"message": "emergency contact removed"})
}

// ---- Wallet ----

func (h *RiderHandler) HandleGetWallet(w http.ResponseWriter, r *http.Request) {
	id, ok := h.riderID(w, r)
	if !ok {
		return
	}
	wallet, err := h.repo.GetOrCreateWallet(r.Context(), id)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	writeData(w, http.StatusOK, wallet)
}

func (h *RiderHandler) HandleGetWalletTransactions(w http.ResponseWriter, r *http.Request) {
	id, ok := h.riderID(w, r)
	if !ok {
		return
	}
	limit, offset := parsePagination(r)
	txns, total, err := h.repo.GetWalletTransactions(r.Context(), id, limit, offset)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	writeData(w, http.StatusOK, map[string]any{
		"transactions": txns,
		"total":        total,
		"limit":        limit,
		"offset":       offset,
	})
}

// HandleWalletTopup is intentionally not implemented: wallet top-up requires a
// payment-gateway integration that is out of scope for the auth/onboarding build.
func (h *RiderHandler) HandleWalletTopup(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "wallet top-up requires payment gateway integration", "ERR_NOT_IMPLEMENTED")
}

// ---- Device tokens ----

func (h *RiderHandler) HandleAddDeviceToken(w http.ResponseWriter, r *http.Request) {
	id, ok := h.riderID(w, r)
	if !ok {
		return
	}
	var req struct {
		Token    string `json:"device_token"`
		Platform string `json:"platform"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", "ERR_BAD_REQUEST")
		return
	}
	if req.Token == "" || req.Platform == "" {
		writeError(w, http.StatusBadRequest, "device_token and platform are required", "ERR_VALIDATION")
		return
	}
	if err := h.repo.SaveDeviceToken(r.Context(), id, req.Token, req.Platform); err != nil {
		h.writeServiceError(w, err)
		return
	}
	writeData(w, http.StatusOK, map[string]any{"message": "device token registered"})
}

func (h *RiderHandler) HandleDeleteDeviceToken(w http.ResponseWriter, r *http.Request) {
	id, ok := h.riderID(w, r)
	if !ok {
		return
	}
	if err := h.repo.DeactivateDeviceToken(r.Context(), id, r.PathValue("token")); err != nil {
		h.writeServiceError(w, err)
		return
	}
	writeData(w, http.StatusOK, map[string]any{"message": "device token removed"})
}

// ---- Referral + notifications ----

func (h *RiderHandler) HandleGetReferral(w http.ResponseWriter, r *http.Request) {
	id, ok := h.riderID(w, r)
	if !ok {
		return
	}
	referrals, err := h.repo.GetRiderReferrals(r.Context(), id)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	writeData(w, http.StatusOK, referrals)
}

func (h *RiderHandler) HandleListNotifications(w http.ResponseWriter, r *http.Request) {
	id, ok := h.riderID(w, r)
	if !ok {
		return
	}
	limit, offset := parsePagination(r)
	notifs, err := h.repo.GetNotifications(r.Context(), id, limit, offset)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	writeData(w, http.StatusOK, notifs)
}

func (h *RiderHandler) HandleMarkNotificationRead(w http.ResponseWriter, r *http.Request) {
	id, ok := h.riderID(w, r)
	if !ok {
		return
	}
	if err := h.repo.MarkNotificationRead(r.Context(), r.PathValue("id"), id); err != nil {
		h.writeServiceError(w, err)
		return
	}
	writeData(w, http.StatusOK, map[string]any{"message": "notification marked read"})
}
