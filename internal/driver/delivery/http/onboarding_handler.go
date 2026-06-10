package http

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/platform/driver-delivery/internal/crypto"
	"github.com/platform/driver-delivery/internal/domain"
	"github.com/platform/driver-delivery/internal/gateway/middleware"
	"github.com/platform/driver-delivery/internal/storage/objectstore"
)

type QuizRequest struct {
	Answers map[string]int `json:"answers"` // Map of QID (string) -> Option index
}

type QuizResponse struct {
	Passed bool `json:"passed"`
	Score  int  `json:"score"`
}

type OnboardingHandler struct {
	dbPool *pgxpool.Pool
	cipher *crypto.FieldCipher
	store  *objectstore.S3Store
}

func NewOnboardingHandler(dbPool *pgxpool.Pool) *OnboardingHandler {
	return &OnboardingHandler{
		dbPool: dbPool,
	}
}

// SetFieldCipher injects the at-rest cipher used to encrypt sensitive bank
// fields (step 5). Without it, bank-detail persistence is rejected rather than
// stored in plaintext.
func (h *OnboardingHandler) SetFieldCipher(c *crypto.FieldCipher) {
	h.cipher = c
}

// SetObjectStore injects the durable document store. When unset/disabled, uploads
// fall back to local disk (dev only, not durable across replicas).
func (h *OnboardingHandler) SetObjectStore(s *objectstore.S3Store) {
	h.store = s
}

// HandleSaveStep stores step-specific form payload atomically inside driver_data JSONB and advances the step index
func (h *OnboardingHandler) HandleSaveStep(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	driverID, ok := middleware.GetUserIDFromContext(r.Context())
	if !ok || driverID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Read step_id from path
	stepIDStr := r.PathValue("step_id")
	stepID, err := strconv.Atoi(stepIDStr)
	if err != nil || stepID < 1 || stepID > 8 {
		http.Error(w, "Invalid onboarding step ID", http.StatusBadRequest)
		return
	}

	var partialData map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&partialData); err != nil {
		http.Error(w, "Invalid request JSON payload", http.StatusBadRequest)
		return
	}

	// Enforce per-step completeness server-side so a client cannot advance the
	// onboarding step counter by posting an empty or partial payload.
	if missing := missingRequiredField(stepID, partialData); missing != "" {
		http.Error(w, "Missing required field: "+missing, http.StatusBadRequest)
		return
	}

	// Bank details (step 5) are persisted to the encrypted driver_bank_details
	// table below, never to the onboarding_data JSONB blob. Strip them here so
	// no account number or holder name is ever written in plaintext.
	jsonSource := partialData
	if stepID == 5 {
		jsonSource = map[string]interface{}{}
		for k, v := range partialData {
			switch k {
			case "accountNo", "ifscCode", "holderName", "upiId", "cancelledCheque":
				// routed to driver_bank_details (account_number encrypted)
			default:
				jsonSource[k] = v
			}
		}
	}

	jsonData, err := json.Marshal(jsonSource)
	if err != nil {
		http.Error(w, "Failed to encode data payload", http.StatusInternalServerError)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// Atomic Transaction (Begin -> Commit)
	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "Transaction initiation failed", http.StatusInternalServerError)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Merge onboarding data JSONB and update onboarding step
	var query string
	var queryErr error
	if stepID == 7 {
		ip := r.Header.Get("X-Forwarded-For")
		if ip == "" {
			ip = r.Header.Get("X-Real-IP")
		}
		if ip == "" {
			host, _, err := net.SplitHostPort(r.RemoteAddr)
			if err == nil {
				ip = host
			} else {
				ip = r.RemoteAddr
			}
		}

		drvUUID, parseErr := uuid.Parse(driverID)
		if parseErr != nil {
			http.Error(w, "Invalid driver UUID format", http.StatusBadRequest)
			return
		}

		auditData := domain.TermsAudit{
			DriverID:   drvUUID,
			Version:    "1.0",
			AcceptedAt: time.Now(),
			IPAddress:  ip,
			UserAgent:  r.Header.Get("User-Agent"),
		}

		query = `
			UPDATE drivers 
			SET onboarding_data = COALESCE(onboarding_data, '{}'::jsonb) || $1,
			    onboarding_step = $2,
			    terms_accepted_at = $3,
			    terms_version = $4,
			    terms_ip_address = $5,
			    updated_at = NOW()
			WHERE id = $6
		`
		_, queryErr = tx.Exec(ctx, query, jsonData, stepID, auditData.AcceptedAt, auditData.Version, auditData.IPAddress, driverID)
	} else {
		query = `
			UPDATE drivers 
			SET onboarding_data = COALESCE(onboarding_data, '{}'::jsonb) || $1,
			    onboarding_step = $2,
			    updated_at = NOW()
			WHERE id = $3
		`
		_, queryErr = tx.Exec(ctx, query, jsonData, stepID, driverID)
	}

	if queryErr != nil {
		http.Error(w, "Failed to commit onboarding step", http.StatusInternalServerError)
		return
	}

	// Route normalized/sensitive step payloads to their dedicated tables in the
	// same transaction so a partial write rolls back with the step update.
	switch stepID {
	case 3:
		if err := h.upsertKYCDocuments(ctx, tx, driverID, partialData); err != nil {
			http.Error(w, "Failed to persist KYC documents", http.StatusInternalServerError)
			return
		}
	case 5:
		if err := h.upsertBankDetails(ctx, tx, driverID, partialData); err != nil {
			http.Error(w, "Failed to persist bank details", http.StatusInternalServerError)
			return
		}
	}

	err = tx.Commit(ctx)
	if err != nil {
		http.Error(w, "Transaction commit failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success":         true,
		"onboarding_step": stepID,
	})
}

// HandleUploadDocument streams the file, writes it to disk (or mock S3) and creates driver_documents entry
func (h *OnboardingHandler) HandleUploadDocument(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	driverID, ok := middleware.GetUserIDFromContext(r.Context())
	if !ok || driverID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Max 10MB upload limits
	err := r.ParseMultipartForm(10 << 20)
	if err != nil {
		http.Error(w, "File upload size exceeds limit", http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "Missing file payload", http.StatusBadRequest)
		return
	}
	defer file.Close()

	docType := r.FormValue("document_type")
	if docType == "" {
		http.Error(w, "Missing document_type parameter", http.StatusBadRequest)
		return
	}

	fileUUID := uuid.New().String()
	// filepath.Base strips any directory components a malicious client embeds in the
	// upload filename (e.g. "../../etc/cron.d/x"); without it the path/key below can
	// be walked outside the intended prefix, yielding an arbitrary write.
	baseName := filepath.Base(strings.ReplaceAll(header.Filename, "\\", "/"))
	safeFilename := fmt.Sprintf("%s-%s", fileUUID, strings.ReplaceAll(baseName, " ", "_"))

	var storageURL string
	if h.store != nil && h.store.Enabled() {
		// Durable object storage: stream the file into memory (capped at 10MB by
		// ParseMultipartForm above) and PUT it to the bucket. Survives pod restarts and
		// is readable by the admin compliance service on any replica.
		data, readErr := io.ReadAll(file)
		if readErr != nil {
			http.Error(w, "Failed reading uploaded file", http.StatusInternalServerError)
			return
		}
		objectKey := fmt.Sprintf("driver-docs/%s/%s", driverID, safeFilename)
		putCtx, putCancel := context.WithTimeout(r.Context(), 20*time.Second)
		publicURL, putErr := h.store.PutObject(putCtx, objectKey, data, header.Header.Get("Content-Type"))
		putCancel()
		if putErr != nil {
			http.Error(w, "Failed to persist document to object storage", http.StatusBadGateway)
			return
		}
		storageURL = publicURL
	} else {
		// Local-disk fallback (dev only; not durable across replicas/restarts).
		uploadDir := "public/uploads"
		_ = os.MkdirAll(uploadDir, os.ModePerm)
		filePath := filepath.Join(uploadDir, safeFilename)
		out, createErr := os.Create(filePath)
		if createErr != nil {
			http.Error(w, "Failed to save file to system", http.StatusInternalServerError)
			return
		}
		if _, copyErr := io.Copy(out, file); copyErr != nil {
			_ = out.Close()
			http.Error(w, "Failed streaming file contents", http.StatusInternalServerError)
			return
		}
		_ = out.Close()
		storageURL = fmt.Sprintf("/uploads/%s", safeFilename)
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// Insert into driver_documents table
	query := `
		INSERT INTO driver_documents (driver_id, document_type, storage_url, status, reviewed_at)
		VALUES ($1, $2, $3, 'PENDING', NULL)
		RETURNING id
	`
	var docID string
	err = h.dbPool.QueryRow(ctx, query, driverID, docType, storageURL).Scan(&docID)
	if err != nil {
		http.Error(w, "Failed to register document metadata in database", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"document_id":  docID,
		"storage_url":  storageURL,
		"status":       "PENDING",
		"document_type": docType,
	})
}

// HandleGeneratePresignedURL generates a mock S3 pre-signed URL to bypass server bandwidth limits
func (h *OnboardingHandler) HandleGeneratePresignedURL(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	driverID, ok := middleware.GetUserIDFromContext(r.Context())
	if !ok || driverID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		Filename     string `json:"filename"`
		DocumentType string `json:"document_type"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	fileUUID := uuid.New().String()
	baseName := filepath.Base(strings.ReplaceAll(req.Filename, "\\", "/"))
	objectKey := fmt.Sprintf("driver-docs/%s/%s-%s", driverID, fileUUID, strings.ReplaceAll(baseName, " ", "_"))

	var uploadURL, storageURL string
	if h.store != nil && h.store.Enabled() {
		up, pub, presErr := h.store.PresignPut(objectKey, 15*time.Minute)
		if presErr != nil {
			http.Error(w, "Failed generating upload URL", http.StatusInternalServerError)
			return
		}
		uploadURL, storageURL = up, pub
	} else {
		// Mock fallback (dev only) — no real bucket configured.
		storageURL = fmt.Sprintf("https://driversforu-vault.s3.amazonaws.com/%s", objectKey)
		uploadURL = storageURL + "?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=mock-key&X-Amz-Signature=mock-sig"
	}

	// Pre-insert a pending driver document record linked to this URL
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	query := `
		INSERT INTO driver_documents (driver_id, document_type, storage_url, status)
		VALUES ($1, $2, $3, 'PENDING')
	`
	_, _ = h.dbPool.Exec(ctx, query, driverID, req.DocumentType, storageURL)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"upload_url":  uploadURL,
		"storage_url": storageURL,
	})
}

// HandleValidateQuiz checks the safety and etiquette answers and updates driver status if passed
func (h *OnboardingHandler) HandleValidateQuiz(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	driverID, ok := middleware.GetUserIDFromContext(r.Context())
	if !ok || driverID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req QuizRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	// Match index values against driver quiz config:
	// Q1: 1, Q2: 1, Q3: 3, Q4: 1, Q5: 0
	correctAnswers := map[string]int{
		"1": 1,
		"2": 1,
		"3": 3,
		"4": 1,
		"5": 0,
	}

	score := 0
	for qID, correctAnswer := range correctAnswers {
		if val, exists := req.Answers[qID]; exists && val == correctAnswer {
			score++
		}
	}

	passed := score >= 4 // Require 80% (at least 4/5 answers)

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	if passed {
		// Update driver verification status to PENDING (onboarding complete, awaiting admin approval)
		query := `
			UPDATE drivers
			SET verification_status = 'PENDING',
			    onboarding_step = 8,
			    updated_at = NOW()
			WHERE id = $1
		`
		if _, err := h.dbPool.Exec(ctx, query, driverID); err != nil {
			// Must not report a pass the system failed to record, or the driver
			// is stranded: client shows "complete" while status never advances.
			http.Error(w, "Failed to record quiz completion", http.StatusInternalServerError)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(QuizResponse{
		Passed: passed,
		Score:  score,
	})
}

// requiredStringFields lists the non-empty string fields each onboarding step
// must carry before the step counter is allowed to advance.
var requiredStringFields = map[int][]string{
	1: {"fullName", "dob", "gender"},
	2: {"permAddress", "currAddress", "city"},
	3: {"drivingLicense", "aadhaarId", "panCard"},
	5: {"accountNo", "ifscCode", "holderName"},
	6: {"emergencyName", "emergencyPhone"},
	7: {"signatureName"},
}

// missingRequiredField returns the name of the first required field absent or
// blank for the given step, or "" when the payload satisfies the step.
func missingRequiredField(stepID int, d map[string]interface{}) string {
	for _, f := range requiredStringFields[stepID] {
		if strings.TrimSpace(strField(d, f)) == "" {
			return f
		}
	}
	switch stepID {
	case 4:
		if _, ok := d["yearsOfExperience"]; !ok {
			return "yearsOfExperience"
		}
	case 7:
		if v, ok := d["agreedToTerms"].(bool); !ok || !v {
			return "agreedToTerms"
		}
	}
	return ""
}

// strField safely extracts a string value from a decoded JSON map.
func strField(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// upsertKYCDocuments writes the step-3 identity document URLs into the
// normalized driver_kyc_documents vault, resetting review status to PENDING.
func (h *OnboardingHandler) upsertKYCDocuments(ctx context.Context, tx pgx.Tx, driverID string, d map[string]interface{}) error {
	const q = `
		INSERT INTO driver_kyc_documents
			(driver_id, dl_front_url, aadhaar_url, pan_url, police_verification_url, verification_status, updated_at)
		VALUES ($1, $2, $3, $4, $5, 'PENDING', NOW())
		ON CONFLICT (driver_id) DO UPDATE SET
			dl_front_url = EXCLUDED.dl_front_url,
			aadhaar_url = EXCLUDED.aadhaar_url,
			pan_url = EXCLUDED.pan_url,
			police_verification_url = EXCLUDED.police_verification_url,
			verification_status = 'PENDING',
			updated_at = NOW()
	`
	_, err := tx.Exec(ctx, q,
		driverID,
		strField(d, "drivingLicense"),
		strField(d, "aadhaarId"),
		strField(d, "panCard"),
		strField(d, "policeVerification"),
	)
	return err
}

// upsertBankDetails writes the step-5 payout details into the normalized
// driver_bank_details table with the account number encrypted at rest.
func (h *OnboardingHandler) upsertBankDetails(ctx context.Context, tx pgx.Tx, driverID string, d map[string]interface{}) error {
	encAccount := ""
	if account := strField(d, "accountNo"); account != "" {
		if h.cipher == nil {
			return fmt.Errorf("field cipher not configured; refusing to store bank account in plaintext")
		}
		enc, err := h.cipher.Encrypt(account)
		if err != nil {
			return err
		}
		encAccount = enc
	}

	const q = `
		INSERT INTO driver_bank_details
			(driver_id, account_number, ifsc_code, holder_name, upi_id, cancelled_cheque_url, verified, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, false, NOW())
		ON CONFLICT (driver_id) DO UPDATE SET
			account_number = EXCLUDED.account_number,
			ifsc_code = EXCLUDED.ifsc_code,
			holder_name = EXCLUDED.holder_name,
			upi_id = EXCLUDED.upi_id,
			cancelled_cheque_url = EXCLUDED.cancelled_cheque_url,
			verified = false,
			updated_at = NOW()
	`
	_, err := tx.Exec(ctx, q,
		driverID,
		encAccount,
		strField(d, "ifscCode"),
		strField(d, "holderName"),
		strField(d, "upiId"),
		strField(d, "cancelledCheque"),
	)
	return err
}
