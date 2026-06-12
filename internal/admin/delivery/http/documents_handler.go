package http

import (
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

type DocumentsHandler struct {
	dbPool *pgxpool.Pool
	logger *log.Logger
}

func NewDocumentsHandler(dbPool *pgxpool.Pool, logger *log.Logger) *DocumentsHandler {
	return &DocumentsHandler{dbPool: dbPool, logger: logger}
}

type VaultDocument struct {
	ID               string     `json:"id"`
	EntityType       string     `json:"entity_type"`
	EntityID         string     `json:"entity_id"`
	DocType          string     `json:"doc_type"`
	DisplayName      string     `json:"display_name"`
	FileURL          string     `json:"file_url"`
	FileSizeBytes    int        `json:"file_size_bytes"`
	MimeType         string     `json:"mime_type"`
	Version          int        `json:"version"`
	Tags             []string   `json:"tags"`
	ExpiryDate       *string    `json:"expiry_date"`
	UploadedByEmail  string     `json:"uploaded_by_email"`
	Status           string     `json:"status"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

type DocAccessEntry struct {
	ID              int64     `json:"id"`
	DocumentID      string    `json:"document_id"`
	AccessedByEmail string    `json:"accessed_by_email"`
	AccessType      string    `json:"access_type"`
	IPAddress       string    `json:"ip_address"`
	CreatedAt       time.Time `json:"created_at"`
}

// HandleGetDocuments searches the vault with filters: entity_type, entity_id, doc_type, tags, status, expiry_before
func (h *DocumentsHandler) HandleGetDocuments(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()

	q := r.URL.Query()
	limit := parseBoundedQueryInt(q.Get("limit"), 50, 1, 200)
	offset := parseBoundedQueryInt(q.Get("offset"), 0, 0, 1_000_000)

	base := `FROM documents_vault WHERE status != 'DELETED'`
	var args []interface{}
	idx := 1

	if v := q.Get("entity_type"); v != "" {
		base += fmt.Sprintf(" AND entity_type = $%d", idx); args = append(args, strings.ToUpper(v)); idx++
	}
	if v := q.Get("entity_id"); v != "" {
		base += fmt.Sprintf(" AND entity_id = $%d", idx); args = append(args, v); idx++
	}
	if v := q.Get("doc_type"); v != "" {
		base += fmt.Sprintf(" AND doc_type = $%d", idx); args = append(args, strings.ToUpper(v)); idx++
	}
	if v := q.Get("status"); v != "" {
		base += fmt.Sprintf(" AND status = $%d", idx); args = append(args, strings.ToUpper(v)); idx++
	}
	if v := q.Get("search"); v != "" {
		base += fmt.Sprintf(" AND (display_name ILIKE $%d OR entity_id ILIKE $%d)", idx, idx)
		args = append(args, "%"+v+"%"); idx++
	}
	if v := q.Get("expiry_before"); v != "" {
		base += fmt.Sprintf(" AND expiry_date <= $%d", idx); args = append(args, v); idx++
	}
	if v := q.Get("tag"); v != "" {
		base += fmt.Sprintf(" AND $%d = ANY(tags)", idx); args = append(args, v); idx++
	}

	var total int64
	_ = h.dbPool.QueryRow(ctx, "SELECT COUNT(*) "+base, args...).Scan(&total)

	query := `SELECT id::TEXT, entity_type, entity_id, doc_type, display_name, file_url, file_size_bytes, mime_type,
	                 version, tags, expiry_date::TEXT, uploaded_by_email, status, created_at, updated_at ` +
		base + fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", idx, idx+1)
	args = append(args, limit, offset)

	rows, err := h.dbPool.Query(ctx, query, args...)
	if err != nil {
		h.logger.Printf("[DOCS] query failed: %v", err)
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	docs := make([]VaultDocument, 0)
	for rows.Next() {
		var d VaultDocument
		var expiry *string
		if err := rows.Scan(&d.ID, &d.EntityType, &d.EntityID, &d.DocType, &d.DisplayName, &d.FileURL,
			&d.FileSizeBytes, &d.MimeType, &d.Version, &d.Tags, &expiry,
			&d.UploadedByEmail, &d.Status, &d.CreatedAt, &d.UpdatedAt); err == nil {
			d.ExpiryDate = expiry
			docs = append(docs, d)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"documents": docs, "total": total})
}

// HandleGetDocumentDetail returns a single document with its access log
func (h *DocumentsHandler) HandleGetDocumentDetail(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	id := r.PathValue("id")
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var d VaultDocument
	var expiry *string
	err := h.dbPool.QueryRow(ctx,
		`SELECT id::TEXT, entity_type, entity_id, doc_type, display_name, file_url, file_size_bytes, mime_type,
		        version, tags, expiry_date::TEXT, uploaded_by_email, status, created_at, updated_at
		 FROM documents_vault WHERE id = $1::uuid`, id,
	).Scan(&d.ID, &d.EntityType, &d.EntityID, &d.DocType, &d.DisplayName, &d.FileURL,
		&d.FileSizeBytes, &d.MimeType, &d.Version, &d.Tags, &expiry,
		&d.UploadedByEmail, &d.Status, &d.CreatedAt, &d.UpdatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			http.Error(w, "document_not_found", http.StatusNotFound)
			return
		}
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	d.ExpiryDate = expiry

	// Record VIEW access synchronously so the compliance audit entry for a sensitive KYC
	// document view is not lost if the pod shuts down mid-request (the previous fire-and-
	// forget goroutine could be killed before the insert committed).
	adminEmail := r.Header.Get("X-Admin-Email")
	if _, logErr := h.dbPool.Exec(ctx,
		`INSERT INTO documents_access_log (document_id, accessed_by_email, access_type, ip_address) VALUES ($1::uuid, $2, 'VIEW', $3)`,
		id, adminEmail, r.RemoteAddr); logErr != nil {
		h.logger.Printf("[DOC_ACCESS_LOG] failed recording VIEW for doc %s: %v", id, logErr)
	}

	// Fetch access log
	rows, err := h.dbPool.Query(ctx,
		`SELECT id, document_id::TEXT, accessed_by_email, access_type, ip_address, created_at
		 FROM documents_access_log WHERE document_id = $1::uuid ORDER BY created_at DESC LIMIT 50`, id)
	if err != nil {
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	accessLog := make([]DocAccessEntry, 0)
	for rows.Next() {
		var e DocAccessEntry
		if err := rows.Scan(&e.ID, &e.DocumentID, &e.AccessedByEmail, &e.AccessType, &e.IPAddress, &e.CreatedAt); err == nil {
			accessLog = append(accessLog, e)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"document": d, "access_log": accessLog})
}

// HandleUpdateTags updates the tags array on a document
func (h *DocumentsHandler) HandleUpdateTags(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodPatch {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	id := r.PathValue("id")
	var req struct {
		Tags []string `json:"tags"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid_payload", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	_, err := h.dbPool.Exec(ctx,
		`UPDATE documents_vault SET tags = $1, updated_at = NOW() WHERE id = $2::uuid`, req.Tags, id)
	if err != nil {
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}

	adminEmail := r.Header.Get("X-Admin-Email")
	_, _ = h.dbPool.Exec(ctx,
		`INSERT INTO documents_access_log (document_id, accessed_by_email, access_type, ip_address) VALUES ($1::uuid, $2, 'TAG', $3)`,
		id, adminEmail, r.RemoteAddr)

	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"updated"}`))
}

// HandleDeleteDocument soft-deletes a document
func (h *DocumentsHandler) HandleDeleteDocument(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	id := r.PathValue("id")
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	res, err := h.dbPool.Exec(ctx,
		`UPDATE documents_vault SET status = 'DELETED', updated_at = NOW() WHERE id = $1::uuid AND status != 'DELETED'`, id)
	if err != nil || res.RowsAffected() == 0 {
		http.Error(w, "document_not_found_or_already_deleted", http.StatusNotFound)
		return
	}

	adminEmail := r.Header.Get("X-Admin-Email")
	_, _ = h.dbPool.Exec(ctx,
		`INSERT INTO documents_access_log (document_id, accessed_by_email, access_type, ip_address) VALUES ($1::uuid, $2, 'DELETE', $3)`,
		id, adminEmail, r.RemoteAddr)

	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"DELETED"}`))
}

// HandleGetExpiringDocuments returns documents expiring within ?days= days (default 60)
func (h *DocumentsHandler) HandleGetExpiringDocuments(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	days := parseBoundedQueryInt(r.URL.Query().Get("days"), 60, 1, 365)
	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()

	rows, err := h.dbPool.Query(ctx,
		`SELECT id::TEXT, entity_type, entity_id, doc_type, display_name, file_url, file_size_bytes, mime_type,
		        version, tags, expiry_date::TEXT, uploaded_by_email, status, created_at, updated_at
		 FROM documents_vault
		 WHERE expiry_date IS NOT NULL
		   AND expiry_date <= CURRENT_DATE + $1::int
		   AND expiry_date >= CURRENT_DATE
		   AND status = 'ACTIVE'
		 ORDER BY expiry_date ASC`, days)
	if err != nil {
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	docs := make([]VaultDocument, 0)
	for rows.Next() {
		var d VaultDocument
		var expiry *string
		if err := rows.Scan(&d.ID, &d.EntityType, &d.EntityID, &d.DocType, &d.DisplayName, &d.FileURL,
			&d.FileSizeBytes, &d.MimeType, &d.Version, &d.Tags, &expiry,
			&d.UploadedByEmail, &d.Status, &d.CreatedAt, &d.UpdatedAt); err == nil {
			d.ExpiryDate = expiry
			docs = append(docs, d)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"documents": docs, "days_window": days})
}

// ── Privacy / GDPR Requests ──────────────────────────────────────────────────

type PrivacyRequest struct {
	ID               string     `json:"id"`
	RequestType      string     `json:"request_type"`
	RequesterType    string     `json:"requester_type"`
	RequesterID      string     `json:"requester_id"`
	RequesterEmail   string     `json:"requester_email"`
	RequesterPhone   string     `json:"requester_phone"`
	Status           string     `json:"status"`
	Notes            string     `json:"notes"`
	RejectionReason  *string    `json:"rejection_reason"`
	ProcessedByEmail *string    `json:"processed_by_email"`
	CompletedAt      *time.Time `json:"completed_at"`
	DeadlineAt       *time.Time `json:"deadline_at"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

func (h *DocumentsHandler) HandleGetPrivacyRequests(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	status := r.URL.Query().Get("status")
	base := `FROM privacy_requests WHERE 1=1`
	var args []interface{}
	idx := 1
	if status != "" {
		base += fmt.Sprintf(" AND status = $%d", idx); args = append(args, strings.ToUpper(status)); idx++
	}

	var total int64
	_ = h.dbPool.QueryRow(ctx, "SELECT COUNT(*) "+base, args...).Scan(&total)

	limit := parseBoundedQueryInt(r.URL.Query().Get("limit"), 50, 1, 200)
	offset := parseBoundedQueryInt(r.URL.Query().Get("offset"), 0, 0, 1_000_000)

	query := `SELECT id::TEXT, request_type, requester_type, requester_id::TEXT, requester_email, requester_phone,
	                 status, notes, rejection_reason, processed_by_email, completed_at, deadline_at, created_at, updated_at ` +
		base + fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", idx, idx+1)
	args = append(args, limit, offset)

	rows, err := h.dbPool.Query(ctx, query, args...)
	if err != nil {
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	reqs := make([]PrivacyRequest, 0)
	for rows.Next() {
		var req PrivacyRequest
		if err := rows.Scan(&req.ID, &req.RequestType, &req.RequesterType, &req.RequesterID,
			&req.RequesterEmail, &req.RequesterPhone, &req.Status, &req.Notes,
			&req.RejectionReason, &req.ProcessedByEmail, &req.CompletedAt, &req.DeadlineAt,
			&req.CreatedAt, &req.UpdatedAt); err == nil {
			reqs = append(reqs, req)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"requests": reqs, "total": total})
}

func (h *DocumentsHandler) HandleCreatePrivacyRequest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		RequestType    string `json:"request_type"`
		RequesterType  string `json:"requester_type"`
		RequesterID    string `json:"requester_id"`
		RequesterEmail string `json:"requester_email"`
		RequesterPhone string `json:"requester_phone"`
		Notes          string `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.RequesterEmail == "" {
		http.Error(w, "invalid_payload", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	var id string
	err := h.dbPool.QueryRow(ctx,
		`INSERT INTO privacy_requests
		 (request_type, requester_type, requester_id, requester_email, requester_phone, notes, deadline_at)
		 VALUES ($1, $2, $3::uuid, $4, $5, $6, NOW() + INTERVAL '30 days') RETURNING id::TEXT`,
		req.RequestType, req.RequesterType, req.RequesterID, req.RequesterEmail, req.RequesterPhone, req.Notes,
	).Scan(&id)
	if err != nil {
		h.logger.Printf("[DOCS] create privacy request failed: %v", err)
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]any{"id": id})
}

func (h *DocumentsHandler) HandleProcessPrivacyRequest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	id := r.PathValue("id")
	var req struct {
		Action          string `json:"action"` // "COMPLETE" | "REJECT"
		RejectionReason string `json:"rejection_reason"`
		Notes           string `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	adminEmail := r.Header.Get("X-Admin-Email")
	newStatus := "COMPLETED"
	if req.Action == "REJECT" {
		newStatus = "REJECTED"
	}

	res, err := h.dbPool.Exec(ctx,
		`UPDATE privacy_requests
		 SET status = $1, processed_by_email = $2, rejection_reason = $3,
		     notes = CASE WHEN $4 != '' THEN $4 ELSE notes END,
		     completed_at = NOW(), updated_at = NOW()
		 WHERE id = $5::uuid AND status IN ('PENDING','PROCESSING')`,
		newStatus, adminEmail, req.RejectionReason, req.Notes, id)
	if err != nil || res.RowsAffected() == 0 {
		http.Error(w, "request_not_found_or_already_processed", http.StatusConflict)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"status": newStatus})
}
