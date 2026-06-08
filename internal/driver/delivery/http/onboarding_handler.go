package http

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/platform/driver-delivery/internal/gateway/middleware"
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
}

func NewOnboardingHandler(dbPool *pgxpool.Pool) *OnboardingHandler {
	return &OnboardingHandler{
		dbPool: dbPool,
	}
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

	jsonData, err := json.Marshal(partialData)
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
	defer tx.Rollback(ctx)

	// Merge onboarding data JSONB and update onboarding step
	query := `
		UPDATE drivers 
		SET onboarding_data = COALESCE(onboarding_data, '{}'::jsonb) || $1,
		    onboarding_step = $2,
		    updated_at = NOW()
		WHERE id = $3
	`
	_, err = tx.Exec(ctx, query, jsonData, stepID, driverID)
	if err != nil {
		http.Error(w, "Failed to commit onboarding step", http.StatusInternalServerError)
		return
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

	// Create local upload folder if not exist (mock S3 storage)
	uploadDir := "public/uploads"
	_ = os.MkdirAll(uploadDir, os.ModePerm)

	fileUUID := uuid.New().String()
	ext := filepath.Ext(header.Filename)
	safeFilename := fmt.Sprintf("%s-%s%s", fileUUID, strings.ReplaceAll(header.Filename, " ", "_"), ext)
	filePath := filepath.Join(uploadDir, safeFilename)

	out, err := os.Create(filePath)
	if err != nil {
		http.Error(w, "Failed to save file to system", http.StatusInternalServerError)
		return
	}
	defer out.Close()

	_, err = io.Copy(out, file)
	if err != nil {
		http.Error(w, "Failed streaming file contents", http.StatusInternalServerError)
		return
	}

	// Create storage mock url
	storageURL := fmt.Sprintf("/uploads/%s", safeFilename)

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
	storageURL := fmt.Sprintf("https://driversforu-vault.s3.amazonaws.com/docs/%s/%s-%s", driverID, fileUUID, req.Filename)
	uploadURL := fmt.Sprintf("%s?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=mock-key&X-Amz-Signature=mock-sig", storageURL)

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
		_, _ = h.dbPool.Exec(ctx, query, driverID)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(QuizResponse{
		Passed: passed,
		Score:  score,
	})
}
