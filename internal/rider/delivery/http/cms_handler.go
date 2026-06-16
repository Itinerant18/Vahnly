package http

import (
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CMSHandler serves public legal/policy documents from cms_pages +
// cms_content_versions. No auth — these render on unauthenticated screens.
type CMSHandler struct {
	db     *pgxpool.Pool
	logger *log.Logger
}

func NewCMSHandler(db *pgxpool.Pool, logger *log.Logger) *CMSHandler {
	return &CMSHandler{db: db, logger: logger}
}

// cmsTypeToSlug maps the frontend document type to the cms_pages.slug seeded in
// migration 000044, plus a default human title for the placeholder fallback.
var cmsTypeToSlug = map[string]struct{ slug, title string }{
	"TERMS_OF_SERVICE":    {"terms-and-conditions", "Terms of Service"},
	"PRIVACY_POLICY":      {"privacy-policy", "Privacy Policy"},
	"CANCELLATION_POLICY": {"cancellation-policy", "Cancellation Policy"},
	"REFUND_POLICY":       {"refund-policy", "Refund Policy"},
}

func (h *CMSHandler) HandleGetDocument(w http.ResponseWriter, r *http.Request) {
	docType := r.URL.Query().Get("type")
	meta, known := cmsTypeToSlug[docType]
	if !known {
		writeError(w, http.StatusBadRequest, "unknown document type", "ERR_VALIDATION")
		return
	}

	var title, body string
	var updatedAt time.Time
	err := h.db.QueryRow(r.Context(), `
		SELECT p.title, v.content_body, GREATEST(p.updated_at, v.created_at)
		FROM cms_pages p
		JOIN cms_content_versions v ON v.page_id = p.id AND v.is_current
		WHERE p.slug = $1 AND p.status = 'PUBLISHED'
		ORDER BY v.created_at DESC
		LIMIT 1`, meta.slug).Scan(&title, &body, &updatedAt)

	if errors.Is(err, pgx.ErrNoRows) {
		// Render a placeholder (200, not 404) so the app screen is never blank.
		writeData(w, http.StatusOK, map[string]any{
			"type":  docType,
			"title": meta.title,
			"html":  "<p>Coming soon.</p>",
		})
		return
	}
	if err != nil {
		if h.logger != nil {
			h.logger.Printf("[RIDER_CMS] internal error: %v", err)
		}
		writeError(w, http.StatusInternalServerError, "internal server error", "ERR_INTERNAL")
		return
	}

	writeData(w, http.StatusOK, map[string]any{
		"type":       docType,
		"title":      title,
		"html":       body,
		"updated_at": updatedAt,
	})
}
