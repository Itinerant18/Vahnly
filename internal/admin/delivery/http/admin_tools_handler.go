package http

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type AdminToolsHandler struct {
	db     *pgxpool.Pool
	logger *log.Logger
}

func NewAdminToolsHandler(db *pgxpool.Pool, logger *log.Logger) *AdminToolsHandler {
	return &AdminToolsHandler{db: db, logger: logger}
}

func toolsJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// ── Impersonation ─────────────────────────────────────────────────────────────

func (h *AdminToolsHandler) HandleGetImpersonationSessions(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	type Session struct {
		ID           string     `json:"id"`
		AdminEmail   string     `json:"admin_email"`
		TargetType   string     `json:"target_type"`
		TargetID     string     `json:"target_id"`
		Reason       string     `json:"reason"`
		Status       string     `json:"status"`
		ActionsTaken int        `json:"actions_taken"`
		StartedAt    time.Time  `json:"started_at"`
		EndedAt      *time.Time `json:"ended_at,omitempty"`
	}

	rows, err := h.db.Query(ctx, `SELECT id, admin_email, target_type, target_id, reason, status, actions_taken, started_at, ended_at FROM impersonation_sessions ORDER BY started_at DESC LIMIT 50`)
	if err != nil {
		h.logger.Printf("GetImpersonationSessions: %v", err)
		http.Error(w, "query error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	result := []Session{}
	for rows.Next() {
		var s Session
		if err := rows.Scan(&s.ID, &s.AdminEmail, &s.TargetType, &s.TargetID, &s.Reason, &s.Status, &s.ActionsTaken, &s.StartedAt, &s.EndedAt); err != nil {
			continue
		}
		result = append(result, s)
	}
	toolsJSON(w, http.StatusOK, map[string]any{"sessions": result})
}

func (h *AdminToolsHandler) HandleStartImpersonation(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var body struct {
		AdminEmail string `json:"admin_email"`
		TargetType string `json:"target_type"`
		TargetID   string `json:"target_id"`
		Reason     string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	var newID string
	err := h.db.QueryRow(ctx, `INSERT INTO impersonation_sessions (admin_id, admin_email, target_type, target_id, reason, status) VALUES (gen_random_uuid(),$1,$2,$3,$4,'ACTIVE') RETURNING id`,
		body.AdminEmail, body.TargetType, body.TargetID, body.Reason).Scan(&newID)
	if err != nil {
		http.Error(w, "insert failed", http.StatusInternalServerError)
		return
	}
	toolsJSON(w, http.StatusCreated, map[string]string{"id": newID, "status": "ACTIVE"})
}

func (h *AdminToolsHandler) HandleEndImpersonation(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	id := r.PathValue("id")
	_, err := h.db.Exec(ctx, `UPDATE impersonation_sessions SET status='ENDED', ended_at=NOW() WHERE id=$1`, id)
	if err != nil {
		http.Error(w, "update failed", http.StatusInternalServerError)
		return
	}
	toolsJSON(w, http.StatusOK, map[string]string{"id": id, "status": "ENDED"})
}

// ── Bulk Operations ───────────────────────────────────────────────────────────

func (h *AdminToolsHandler) HandleGetBulkOperations(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	type BulkOp struct {
		ID             string          `json:"id"`
		OperationType  string          `json:"operation_type"`
		Status         string          `json:"status"`
		TotalCount     int             `json:"total_count"`
		ProcessedCount int             `json:"processed_count"`
		FailedCount    int             `json:"failed_count"`
		CreatedBy      string          `json:"created_by"`
		ApprovedBy     *string         `json:"approved_by,omitempty"`
		Note           string          `json:"note"`
		Payload        json.RawMessage `json:"payload"`
		CreatedAt      time.Time       `json:"created_at"`
		CompletedAt    *time.Time      `json:"completed_at,omitempty"`
	}

	rows, err := h.db.Query(ctx, `SELECT id, operation_type, status, total_count, processed_count, failed_count, created_by, approved_by, note, payload, created_at, completed_at FROM bulk_operations ORDER BY created_at DESC LIMIT 50`)
	if err != nil {
		http.Error(w, "query error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	result := []BulkOp{}
	for rows.Next() {
		var op BulkOp
		if err := rows.Scan(&op.ID, &op.OperationType, &op.Status, &op.TotalCount, &op.ProcessedCount, &op.FailedCount, &op.CreatedBy, &op.ApprovedBy, &op.Note, &op.Payload, &op.CreatedAt, &op.CompletedAt); err != nil {
			continue
		}
		result = append(result, op)
	}
	toolsJSON(w, http.StatusOK, map[string]any{"operations": result})
}

func (h *AdminToolsHandler) HandleApproveBulkOperation(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	id := r.PathValue("id")
	var body struct {
		ApprovedBy string `json:"approved_by"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	_, err := h.db.Exec(ctx, `UPDATE bulk_operations SET status='APPROVED', approved_by=$1, approved_at=NOW() WHERE id=$2`, body.ApprovedBy, id)
	if err != nil {
		http.Error(w, "update failed", http.StatusInternalServerError)
		return
	}
	toolsJSON(w, http.StatusOK, map[string]string{"id": id, "status": "APPROVED"})
}

// ── Cron / Job Monitor ────────────────────────────────────────────────────────

func (h *AdminToolsHandler) HandleGetCronJobs(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	type CronJob struct {
		ID                  string     `json:"id"`
		JobName             string     `json:"job_name"`
		Description         string     `json:"description"`
		CronExpr            string     `json:"cron_expr"`
		LastRunAt           *time.Time `json:"last_run_at,omitempty"`
		NextRunAt           *time.Time `json:"next_run_at,omitempty"`
		LastStatus          string     `json:"last_status"`
		LastDurationMs      int        `json:"last_duration_ms"`
		LastRowsProcessed   int        `json:"last_rows_processed"`
		ConsecutiveFailures int        `json:"consecutive_failures"`
		IsEnabled           bool       `json:"is_enabled"`
	}

	rows, err := h.db.Query(ctx, `SELECT id, job_name, description, cron_expr, last_run_at, next_run_at, last_status, last_duration_ms, last_rows_processed, consecutive_failures, is_enabled FROM cron_jobs ORDER BY job_name`)
	if err != nil {
		http.Error(w, "query error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	jobs := []CronJob{}
	for rows.Next() {
		var j CronJob
		if err := rows.Scan(&j.ID, &j.JobName, &j.Description, &j.CronExpr, &j.LastRunAt, &j.NextRunAt, &j.LastStatus, &j.LastDurationMs, &j.LastRowsProcessed, &j.ConsecutiveFailures, &j.IsEnabled); err != nil {
			continue
		}
		jobs = append(jobs, j)
	}

	type Run struct {
		ID            string     `json:"id"`
		JobName       string     `json:"job_name"`
		StartedAt     time.Time  `json:"started_at"`
		FinishedAt    *time.Time `json:"finished_at,omitempty"`
		Status        string     `json:"status"`
		RowsProcessed int        `json:"rows_processed"`
		Error         string     `json:"error"`
	}

	runRows, _ := h.db.Query(ctx, `SELECT id, job_name, started_at, finished_at, status, rows_processed, error FROM cron_job_runs ORDER BY started_at DESC LIMIT 20`)
	runs := []Run{}
	if runRows != nil {
		defer runRows.Close()
		for runRows.Next() {
			var run Run
			if err := runRows.Scan(&run.ID, &run.JobName, &run.StartedAt, &run.FinishedAt, &run.Status, &run.RowsProcessed, &run.Error); err != nil {
				continue
			}
			runs = append(runs, run)
		}
	}

	toolsJSON(w, http.StatusOK, map[string]any{"jobs": jobs, "recent_runs": runs})
}

func (h *AdminToolsHandler) HandleToggleCronJob(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	id := r.PathValue("id")
	_, err := h.db.Exec(ctx, `UPDATE cron_jobs SET is_enabled = NOT is_enabled WHERE id=$1`, id)
	if err != nil {
		http.Error(w, "update failed", http.StatusInternalServerError)
		return
	}
	toolsJSON(w, http.StatusOK, map[string]string{"id": id, "status": "toggled"})
}

// ── Data Export Marketplace ───────────────────────────────────────────────────

func (h *AdminToolsHandler) HandleGetExportQueries(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	type ExportQuery struct {
		ID            string          `json:"id"`
		Name          string          `json:"name"`
		Description   string          `json:"description"`
		Category      string          `json:"category"`
		QueryTemplate string          `json:"query_template"`
		ParamsSchema  json.RawMessage `json:"params_schema"`
		IsPublic      bool            `json:"is_public"`
		DownloadCount int             `json:"download_count"`
	}

	rows, err := h.db.Query(ctx, `SELECT id, name, description, category, query_template, params_schema, is_public, download_count FROM export_queries ORDER BY category, name`)
	if err != nil {
		http.Error(w, "query error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	result := []ExportQuery{}
	for rows.Next() {
		var q ExportQuery
		if err := rows.Scan(&q.ID, &q.Name, &q.Description, &q.Category, &q.QueryTemplate, &q.ParamsSchema, &q.IsPublic, &q.DownloadCount); err != nil {
			continue
		}
		result = append(result, q)
	}
	toolsJSON(w, http.StatusOK, map[string]any{"queries": result})
}

func (h *AdminToolsHandler) HandleGetExportJobs(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	type ExportJob struct {
		ID            string          `json:"id"`
		QueryName     string          `json:"query_name"`
		Status        string          `json:"status"`
		Params        json.RawMessage `json:"params"`
		RowCount      int             `json:"row_count"`
		FileSizeBytes int             `json:"file_size_bytes"`
		FileURL       string          `json:"file_url"`
		CreatedBy     string          `json:"created_by"`
		CreatedAt     time.Time       `json:"created_at"`
		CompletedAt   *time.Time      `json:"completed_at,omitempty"`
	}

	rows, err := h.db.Query(ctx, `SELECT id, query_name, status, params, row_count, file_size_bytes, file_url, created_by, created_at, completed_at FROM export_jobs ORDER BY created_at DESC LIMIT 30`)
	if err != nil {
		http.Error(w, "query error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	result := []ExportJob{}
	for rows.Next() {
		var j ExportJob
		if err := rows.Scan(&j.ID, &j.QueryName, &j.Status, &j.Params, &j.RowCount, &j.FileSizeBytes, &j.FileURL, &j.CreatedBy, &j.CreatedAt, &j.CompletedAt); err != nil {
			continue
		}
		result = append(result, j)
	}
	toolsJSON(w, http.StatusOK, map[string]any{"jobs": result})
}

func (h *AdminToolsHandler) HandleSubmitExportJob(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var body struct {
		QueryID   string          `json:"query_id"`
		QueryName string          `json:"query_name"`
		Params    json.RawMessage `json:"params"`
		CreatedBy string          `json:"created_by"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	var newID string
	err := h.db.QueryRow(ctx, `INSERT INTO export_jobs (query_id, query_name, params, created_by, status) VALUES ($1,$2,$3,$4,'QUEUED') RETURNING id`,
		body.QueryID, body.QueryName, body.Params, body.CreatedBy).Scan(&newID)
	if err != nil {
		http.Error(w, "insert failed", http.StatusInternalServerError)
		return
	}
	// Increment download counter
	_, _ = h.db.Exec(ctx, `UPDATE export_queries SET download_count = download_count + 1 WHERE id=$1`, body.QueryID)
	toolsJSON(w, http.StatusCreated, map[string]string{"id": newID, "status": "QUEUED"})
}
