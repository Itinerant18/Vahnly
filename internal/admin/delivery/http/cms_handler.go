package http

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type CMSHandler struct {
	dbPool *pgxpool.Pool
	logger *log.Logger
}

func NewCMSHandler(dbPool *pgxpool.Pool, logger *log.Logger) *CMSHandler {
	return &CMSHandler{dbPool: dbPool, logger: logger}
}

// ── Pages ────────────────────────────────────────────────────────────────────

type CMSPage struct {
	ID             int        `json:"id"`
	Slug           string     `json:"slug"`
	Title          string     `json:"title"`
	PageType       string     `json:"page_type"`
	Status         string     `json:"status"`
	MinAppVersion  string     `json:"min_app_version"`
	CreatedByEmail string     `json:"created_by_email"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
	PublishedAt    *time.Time `json:"published_at"`
}

type CMSContentVersion struct {
	ID             int       `json:"id"`
	PageID         int       `json:"page_id"`
	LanguageCode   string    `json:"language_code"`
	ContentBody    string    `json:"content_body"`
	Version        int       `json:"version"`
	IsCurrent      bool      `json:"is_current"`
	CreatedByEmail string    `json:"created_by_email"`
	CreatedAt      time.Time `json:"created_at"`
}

func (h *CMSHandler) HandleGetPages(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pageType := r.URL.Query().Get("page_type")
	status := r.URL.Query().Get("status")

	query := `SELECT id, slug, title, page_type, status, min_app_version, created_by_email, created_at, updated_at, published_at
	          FROM cms_pages WHERE 1=1`
	var args []interface{}
	idx := 1
	if pageType != "" {
		query += fmt.Sprintf(" AND page_type = $%d", idx)
		args = append(args, pageType)
		idx++
	}
	if status != "" {
		query += fmt.Sprintf(" AND status = $%d", idx)
		args = append(args, status)
	}
	query += " ORDER BY page_type, title"

	rows, err := h.dbPool.Query(ctx, query, args...)
	if err != nil {
		h.logger.Printf("[CMS] list pages failed: %v", err)
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	pages := make([]CMSPage, 0)
	for rows.Next() {
		var p CMSPage
		if err := rows.Scan(&p.ID, &p.Slug, &p.Title, &p.PageType, &p.Status, &p.MinAppVersion,
			&p.CreatedByEmail, &p.CreatedAt, &p.UpdatedAt, &p.PublishedAt); err == nil {
			pages = append(pages, p)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"pages": pages})
}

func (h *CMSHandler) HandleCreatePage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Slug          string `json:"slug"`
		Title         string `json:"title"`
		PageType      string `json:"page_type"`
		MinAppVersion string `json:"min_app_version"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Slug == "" || req.Title == "" {
		http.Error(w, "invalid_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	adminEmail := r.Header.Get("X-Admin-Email")
	var id int
	err := h.dbPool.QueryRow(ctx,
		`INSERT INTO cms_pages (slug, title, page_type, status, min_app_version, created_by_email)
		 VALUES ($1, $2, $3, 'DRAFT', $4, $5) RETURNING id`,
		req.Slug, req.Title, req.PageType, req.MinAppVersion, adminEmail,
	).Scan(&id)
	if err != nil {
		h.logger.Printf("[CMS] create page failed: %v", err)
		http.Error(w, "db_error_or_slug_conflict", http.StatusConflict)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]any{"id": id})
}

func (h *CMSHandler) HandleGetPageDetail(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	idStr := r.PathValue("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "invalid_id", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var p CMSPage
	err = h.dbPool.QueryRow(ctx,
		`SELECT id, slug, title, page_type, status, min_app_version, created_by_email, created_at, updated_at, published_at
		 FROM cms_pages WHERE id = $1`, id,
	).Scan(&p.ID, &p.Slug, &p.Title, &p.PageType, &p.Status, &p.MinAppVersion,
		&p.CreatedByEmail, &p.CreatedAt, &p.UpdatedAt, &p.PublishedAt)
	if err != nil {
		http.Error(w, "page_not_found", http.StatusNotFound)
		return
	}

	// Fetch current content versions per language
	rows, err := h.dbPool.Query(ctx,
		`SELECT id, page_id, language_code, content_body, version, is_current, created_by_email, created_at
		 FROM cms_content_versions WHERE page_id = $1 AND is_current = true ORDER BY language_code`, id)
	if err != nil {
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	versions := make([]CMSContentVersion, 0)
	for rows.Next() {
		var v CMSContentVersion
		if err := rows.Scan(&v.ID, &v.PageID, &v.LanguageCode, &v.ContentBody, &v.Version, &v.IsCurrent, &v.CreatedByEmail, &v.CreatedAt); err == nil {
			versions = append(versions, v)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"page": p, "content": versions})
}

func (h *CMSHandler) HandleSaveContent(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	idStr := r.PathValue("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "invalid_id", http.StatusBadRequest)
		return
	}

	var req struct {
		LanguageCode string `json:"language_code"`
		ContentBody  string `json:"content_body"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ContentBody == "" {
		http.Error(w, "invalid_payload", http.StatusBadRequest)
		return
	}
	if req.LanguageCode == "" {
		req.LanguageCode = "en"
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	adminEmail := r.Header.Get("X-Admin-Email")
	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "tx_init_failed", http.StatusInternalServerError)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Determine next version number
	var nextVersion int
	_ = tx.QueryRow(ctx,
		`SELECT COALESCE(MAX(version), 0) + 1 FROM cms_content_versions WHERE page_id = $1 AND language_code = $2`,
		id, req.LanguageCode).Scan(&nextVersion)

	// Mark previous current as non-current
	_, _ = tx.Exec(ctx,
		`UPDATE cms_content_versions SET is_current = false WHERE page_id = $1 AND language_code = $2`,
		id, req.LanguageCode)

	// Insert new version
	var newID int
	err = tx.QueryRow(ctx,
		`INSERT INTO cms_content_versions (page_id, language_code, content_body, version, is_current, created_by_email)
		 VALUES ($1, $2, $3, $4, true, $5) RETURNING id`,
		id, req.LanguageCode, req.ContentBody, nextVersion, adminEmail,
	).Scan(&newID)
	if err != nil {
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}

	// Touch parent page updated_at
	_, _ = tx.Exec(ctx, `UPDATE cms_pages SET updated_at = NOW() WHERE id = $1`, id)

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "tx_commit_failed", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"version_id": newID, "version": nextVersion})
}

func (h *CMSHandler) HandlePublishPage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	idStr := r.PathValue("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "invalid_id", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	_, err = h.dbPool.Exec(ctx,
		`UPDATE cms_pages SET status = 'PUBLISHED', published_at = NOW(), updated_at = NOW() WHERE id = $1`, id)
	if err != nil {
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"status":"PUBLISHED"}`))
}

func (h *CMSHandler) HandleGetVersionHistory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	idStr := r.PathValue("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "invalid_id", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	lang := r.URL.Query().Get("language")
	if lang == "" {
		lang = "en"
	}

	rows, err := h.dbPool.Query(ctx,
		`SELECT id, page_id, language_code, content_body, version, is_current, created_by_email, created_at
		 FROM cms_content_versions WHERE page_id = $1 AND language_code = $2 ORDER BY version DESC LIMIT 20`,
		id, lang)
	if err != nil {
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	versions := make([]CMSContentVersion, 0)
	for rows.Next() {
		var v CMSContentVersion
		if err := rows.Scan(&v.ID, &v.PageID, &v.LanguageCode, &v.ContentBody, &v.Version, &v.IsCurrent, &v.CreatedByEmail, &v.CreatedAt); err == nil {
			versions = append(versions, v)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"versions": versions})
}

// ── i18n Strings ─────────────────────────────────────────────────────────────

type I18NString struct {
	ID           int       `json:"id"`
	KeyName      string    `json:"key_name"`
	Namespace    string    `json:"namespace"`
	LanguageCode string    `json:"language_code"`
	Value        string    `json:"value"`
	Description  string    `json:"description"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (h *CMSHandler) HandleGetI18NStrings(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	q := r.URL.Query()
	ns := q.Get("namespace")
	lang := q.Get("language")
	search := q.Get("search")
	limit := parseBoundedQueryInt(q.Get("limit"), 100, 1, 500)
	offset := parseBoundedQueryInt(q.Get("offset"), 0, 0, 100000)

	query := `SELECT id, key_name, namespace, language_code, value, COALESCE(description,''), updated_at FROM i18n_strings WHERE 1=1`
	var args []interface{}
	idx := 1
	if ns != "" {
		query += fmt.Sprintf(" AND namespace = $%d", idx)
		args = append(args, ns)
		idx++
	}
	if lang != "" {
		query += fmt.Sprintf(" AND language_code = $%d", idx)
		args = append(args, lang)
		idx++
	}
	if search != "" {
		query += fmt.Sprintf(" AND (key_name ILIKE $%d OR value ILIKE $%d)", idx, idx)
		args = append(args, "%"+search+"%")
		idx++
	}

	var total int64
	_ = h.dbPool.QueryRow(ctx, "SELECT COUNT(*) FROM i18n_strings WHERE 1=1"+(query[len(`SELECT id, key_name, namespace, language_code, value, COALESCE(description,''), updated_at FROM i18n_strings WHERE 1=1`):]), args...).Scan(&total)

	query += fmt.Sprintf(" ORDER BY namespace, key_name, language_code LIMIT $%d OFFSET $%d", idx, idx+1)
	args = append(args, limit, offset)

	rows, err := h.dbPool.Query(ctx, query, args...)
	if err != nil {
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	strings := make([]I18NString, 0)
	for rows.Next() {
		var s I18NString
		if err := rows.Scan(&s.ID, &s.KeyName, &s.Namespace, &s.LanguageCode, &s.Value, &s.Description, &s.UpdatedAt); err == nil {
			strings = append(strings, s)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"strings": strings, "total": total})
}

func (h *CMSHandler) HandleUpsertI18NString(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		KeyName      string `json:"key_name"`
		Namespace    string `json:"namespace"`
		LanguageCode string `json:"language_code"`
		Value        string `json:"value"`
		Description  string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.KeyName == "" || req.Value == "" {
		http.Error(w, "invalid_payload", http.StatusBadRequest)
		return
	}
	if req.LanguageCode == "" {
		req.LanguageCode = "en"
	}
	if req.Namespace == "" {
		req.Namespace = "common"
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	adminEmail := r.Header.Get("X-Admin-Email")
	_, err := h.dbPool.Exec(ctx,
		`INSERT INTO i18n_strings (key_name, namespace, language_code, value, description, updated_by_email, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, NOW())
		 ON CONFLICT (key_name, namespace, language_code)
		 DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description,
		               updated_by_email = EXCLUDED.updated_by_email, updated_at = NOW()`,
		req.KeyName, req.Namespace, req.LanguageCode, req.Value, req.Description, adminEmail,
	)
	if err != nil {
		h.logger.Printf("[CMS] upsert i18n failed: %v", err)
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"ok"}`))
}

// ── Assets ───────────────────────────────────────────────────────────────────

type CMSAsset struct {
	ID            int       `json:"id"`
	AssetType     string    `json:"asset_type"`
	Platform      string    `json:"platform"`
	Title         string    `json:"title"`
	FileURL       string    `json:"file_url"`
	ThumbnailURL  string    `json:"thumbnail_url"`
	MinAppVersion string    `json:"min_app_version"`
	Status        string    `json:"status"`
	DisplayOrder  int       `json:"display_order"`
	CreatedAt     time.Time `json:"created_at"`
}

func (h *CMSHandler) HandleGetAssets(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	assetType := r.URL.Query().Get("asset_type")
	platform := r.URL.Query().Get("platform")

	query := `SELECT id, asset_type, platform, title, file_url, thumbnail_url, min_app_version, status, display_order, created_at
	          FROM cms_assets WHERE 1=1`
	var args []interface{}
	idx := 1
	if assetType != "" {
		query += fmt.Sprintf(" AND asset_type = $%d", idx)
		args = append(args, assetType)
		idx++
	}
	if platform != "" {
		query += fmt.Sprintf(" AND platform = $%d", idx)
		args = append(args, platform)
		idx++
	}
	query += " ORDER BY asset_type, display_order"

	rows, err := h.dbPool.Query(ctx, query, args...)
	if err != nil {
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	assets := make([]CMSAsset, 0)
	for rows.Next() {
		var a CMSAsset
		if err := rows.Scan(&a.ID, &a.AssetType, &a.Platform, &a.Title, &a.FileURL, &a.ThumbnailURL, &a.MinAppVersion, &a.Status, &a.DisplayOrder, &a.CreatedAt); err == nil {
			assets = append(assets, a)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"assets": assets})
}

func (h *CMSHandler) HandleCreateAsset(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		AssetType     string `json:"asset_type"`
		Platform      string `json:"platform"`
		Title         string `json:"title"`
		FileURL       string `json:"file_url"`
		ThumbnailURL  string `json:"thumbnail_url"`
		MinAppVersion string `json:"min_app_version"`
		DisplayOrder  int    `json:"display_order"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.FileURL == "" || req.AssetType == "" {
		http.Error(w, "invalid_payload", http.StatusBadRequest)
		return
	}
	if req.Platform == "" {
		req.Platform = "ALL"
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	adminEmail := r.Header.Get("X-Admin-Email")
	var id int
	err := h.dbPool.QueryRow(ctx,
		`INSERT INTO cms_assets (asset_type, platform, title, file_url, thumbnail_url, min_app_version, display_order, created_by_email)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
		req.AssetType, req.Platform, req.Title, req.FileURL, req.ThumbnailURL, req.MinAppVersion, req.DisplayOrder, adminEmail,
	).Scan(&id)
	if err != nil {
		h.logger.Printf("[CMS] create asset failed: %v", err)
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]any{"id": id})
}

func (h *CMSHandler) HandleUpdateAssetStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	idStr := r.PathValue("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "invalid_id", http.StatusBadRequest)
		return
	}
	var req struct {
		Status       string `json:"status"`
		DisplayOrder *int   `json:"display_order"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid_payload", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	if req.Status != "" {
		_, _ = h.dbPool.Exec(ctx, `UPDATE cms_assets SET status = $1, updated_at = NOW() WHERE id = $2`, req.Status, id)
	}
	if req.DisplayOrder != nil {
		_, _ = h.dbPool.Exec(ctx, `UPDATE cms_assets SET display_order = $1, updated_at = NOW() WHERE id = $2`, *req.DisplayOrder, id)
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"updated"}`))
}
