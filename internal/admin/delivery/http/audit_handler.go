package http

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type AuditHandler struct {
	dbPool *pgxpool.Pool
	logger *log.Logger
}

func NewAuditHandler(dbPool *pgxpool.Pool, logger *log.Logger) *AuditHandler {
	return &AuditHandler{dbPool: dbPool, logger: logger}
}

type AuditLogEntry struct {
	ID          string          `json:"id"`
	AdminID     string          `json:"admin_id"`
	AdminEmail  string          `json:"admin_email"`
	AdminRole   string          `json:"admin_role"`
	Action      string          `json:"action"`
	Module      string          `json:"module"`
	EntityType  string          `json:"entity_type"`
	EntityID    string          `json:"entity_id"`
	Details     *string         `json:"details"`
	BeforeValue json.RawMessage `json:"before_value"`
	AfterValue  json.RawMessage `json:"after_value"`
	IPAddress   string          `json:"ip_address"`
	UserAgent   string          `json:"user_agent"`
	CreatedAt   time.Time       `json:"created_at"`
}

// HandleGetAuditLogs returns paginated audit entries.
// Filters: ?admin_email=&action=&module=&entity_type=&entity_id=&from=&to=&limit=&offset=
func (h *AuditHandler) HandleGetAuditLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	q := r.URL.Query()
	limit := parseBoundedQueryInt(q.Get("limit"), 50, 1, 200)
	offset := parseBoundedQueryInt(q.Get("offset"), 0, 0, 10_000_000)
	from, to := parseDateRange(r)

	base := `FROM admin_audit_logs WHERE created_at >= $1 AND created_at < $2`
	args := []interface{}{from, to}
	idx := 3

	addFilter := func(col, val string) {
		if val != "" {
			base += fmt.Sprintf(" AND %s ILIKE $%d", col, idx)
			args = append(args, "%"+val+"%")
			idx++
		}
	}
	addFilter("admin_email", q.Get("admin_email"))
	addFilter("admin_role", q.Get("admin_role"))
	addFilter("action", q.Get("action"))
	addFilter("module", q.Get("module"))
	addFilter("entity_type", q.Get("entity_type"))
	if v := q.Get("entity_id"); v != "" {
		base += fmt.Sprintf(" AND entity_id = $%d", idx)
		args = append(args, v)
		idx++
	}

	var total int64
	_ = h.dbPool.QueryRow(ctx, "SELECT COUNT(*) "+base, args...).Scan(&total)

	sel := `SELECT id::TEXT, admin_id::TEXT, admin_email, admin_role, action, module,
	               entity_type, entity_id, details,
	               COALESCE(before_value::TEXT, 'null'),
	               COALESCE(after_value::TEXT, 'null'),
	               ip_address, user_agent, created_at `
	query := sel + base + fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", idx, idx+1)
	args = append(args, limit, offset)

	rows, err := h.dbPool.Query(ctx, query, args...)
	if err != nil {
		h.logger.Printf("[AUDIT] query failed: %v", err)
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	entries := make([]AuditLogEntry, 0)
	for rows.Next() {
		var e AuditLogEntry
		var beforeRaw, afterRaw string
		if err := rows.Scan(&e.ID, &e.AdminID, &e.AdminEmail, &e.AdminRole, &e.Action,
			&e.Module, &e.EntityType, &e.EntityID, &e.Details,
			&beforeRaw, &afterRaw, &e.IPAddress, &e.UserAgent, &e.CreatedAt); err == nil {
			e.BeforeValue = json.RawMessage(beforeRaw)
			e.AfterValue = json.RawMessage(afterRaw)
			entries = append(entries, e)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"logs":   entries,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

// HandleGetAuditActions returns distinct action values (for filter dropdown).
func (h *AuditHandler) HandleGetAuditActions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	type DistinctRow struct {
		Action string `json:"action"`
		Module string `json:"module"`
		Count  int64  `json:"count"`
	}
	rows, err := h.dbPool.Query(ctx,
		`SELECT action, module, COUNT(*) FROM admin_audit_logs GROUP BY action, module ORDER BY COUNT(*) DESC LIMIT 100`)
	if err != nil {
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	result := make([]DistinctRow, 0)
	for rows.Next() {
		var row DistinctRow
		if err := rows.Scan(&row.Action, &row.Module, &row.Count); err == nil {
			result = append(result, row)
		}
	}

	// Distinct modules
	modules := make([]string, 0)
	seen := map[string]bool{}
	for _, r := range result {
		if r.Module != "" && !seen[r.Module] {
			modules = append(modules, r.Module)
			seen[r.Module] = true
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"actions": result, "modules": modules})
}

// HandleExportAuditCSV downloads audit logs as CSV (same filters as HandleGetAuditLogs).
func (h *AuditHandler) HandleExportAuditCSV(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()

	from, to := parseDateRange(r)
	q := r.URL.Query()
	base := `FROM admin_audit_logs WHERE created_at >= $1 AND created_at < $2`
	args := []interface{}{from, to}
	idx := 3
	if v := q.Get("module"); v != "" {
		base += fmt.Sprintf(" AND module = $%d", idx)
		args = append(args, v)
		idx++
	}
	if v := q.Get("admin_email"); v != "" {
		base += fmt.Sprintf(" AND admin_email ILIKE $%d", idx)
		args = append(args, "%"+v+"%")
	}

	query := `SELECT id::TEXT, admin_email, admin_role, action, module, entity_type, entity_id, ip_address, created_at ` +
		base + " ORDER BY created_at DESC LIMIT 10000"

	rows, err := h.dbPool.Query(ctx, query, args...)
	if err != nil {
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="audit_logs.csv"`)
	_, _ = fmt.Fprintln(w, "id,admin_email,admin_role,action,module,entity_type,entity_id,ip_address,timestamp")
	for rows.Next() {
		var id, email, role, action, module, entityType, entityID, ip string
		var ts time.Time
		if err := rows.Scan(&id, &email, &role, &action, &module, &entityType, &entityID, &ip, &ts); err == nil {
			_, _ = fmt.Fprintf(w, `%s,%s,%s,%s,%s,%s,%s,%s,%s`+"\n",
				id, email, role, action, module, entityType, entityID, ip, ts.Format(time.RFC3339))
		}
	}
}

// HandleRetentionCleanup deletes audit logs older than ?days= days (SUPER_ADMIN only).
func (h *AuditHandler) HandleRetentionCleanup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	days := parseBoundedQueryInt(r.URL.Query().Get("days"), 365, 90, 3650)
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	res, err := h.dbPool.Exec(ctx,
		`DELETE FROM admin_audit_logs WHERE created_at < NOW() - ($1 || ' days')::INTERVAL`, days)
	if err != nil {
		h.logger.Printf("[AUDIT] retention cleanup failed: %v", err)
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"deleted_count":   res.RowsAffected(),
		"older_than_days": days,
	})
}

// WriteAuditLog records an admin action. Safe to call from any handler; silently drops on error.
// adminRole, module, entityType, entityID are optional enrichment fields.
func WriteAuditLog(ctx context.Context, pool *pgxpool.Pool, adminID, adminEmail, adminRole, action, module, entityType, entityID, details, ip string) {
	bg, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, _ = pool.Exec(bg,
		`INSERT INTO admin_audit_logs
		 (admin_id, admin_email, admin_role, action, module, entity_type, entity_id, details, ip_address, user_agent)
		 VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, '')`,
		adminID, adminEmail, adminRole, action, module, entityType, entityID,
		strings.TrimSpace(details), ip)
	_ = ctx // original ctx unused; we use bg to avoid inheriting a cancelled context
}
