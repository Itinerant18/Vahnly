package http

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type MarketingHandler struct {
	dbPool *pgxpool.Pool
	logger *log.Logger
}

func NewMarketingHandler(dbPool *pgxpool.Pool, logger *log.Logger) *MarketingHandler {
	return &MarketingHandler{dbPool: dbPool, logger: logger}
}

type MarketingSegment struct {
	ID          int            `json:"id"`
	Name        string         `json:"name"`
	Description *string        `json:"description"`
	Filters     map[string]any `json:"filters"`
	Size        int            `json:"size"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
}

type CampaignVariant struct {
	ID         int            `json:"id"`
	CampaignID int            `json:"campaign_id"`
	Name       string         `json:"name"`
	Content    map[string]any `json:"content"`
	Weight     float64        `json:"weight"`
	CreatedAt  time.Time      `json:"created_at"`
}

type MarketingCampaign struct {
	ID              int               `json:"id"`
	Name            string            `json:"name"`
	SegmentID       *int              `json:"segment_id"`
	SegmentName     *string           `json:"segment_name"`
	Channel         string            `json:"channel"`       // PUSH, SMS, EMAIL, IN_APP_BANNER, WHATSAPP
	ScheduleType    string            `json:"schedule_type"` // IMMEDIATE, SCHEDULED, RECURRING, TRIGGER_BASED
	ScheduleTime    *time.Time        `json:"schedule_time"`
	RecurrenceCron  *string           `json:"recurrence_cron"`
	TriggerEvent    *string           `json:"trigger_event"`
	ThrottlingLimit *int              `json:"throttling_limit"`
	QuietHoursStart *int              `json:"quiet_hours_start"`
	QuietHoursEnd   *int              `json:"quiet_hours_end"`
	Status          string            `json:"status"` // DRAFT, SCHEDULED, ACTIVE, COMPLETED, PAUSED
	CreatedAt       time.Time         `json:"created_at"`
	UpdatedAt       time.Time         `json:"updated_at"`
	Variants        []CampaignVariant `json:"variants"`
}

type CampaignConversion struct {
	ID         int       `json:"id"`
	CampaignID int       `json:"campaign_id"`
	VariantID  int       `json:"variant_id"`
	UserID     string    `json:"user_id"`
	UserType   string    `json:"user_type"`
	ActionType string    `json:"action_type"` // DELIVERED, OPENED, CLICKED, BOOKING
	Timestamp  time.Time `json:"timestamp"`
}

type InAppBanner struct {
	ID          int       `json:"id"`
	Title       string    `json:"title"`
	Body        string    `json:"body"`
	ImageURL    *string   `json:"image_url"`
	DeepLink    *string   `json:"deep_link"`
	Placement   string    `json:"placement"` // HOME_SCREEN, BOOKING_CONFIRM, POST_TRIP
	SegmentID   *int      `json:"segment_id"`
	SegmentName *string   `json:"segment_name"`
	Status      string    `json:"status"` // ACTIVE, INACTIVE
	StartTime   time.Time `json:"start_time"`
	EndTime     time.Time `json:"end_time"`
	CreatedAt   time.Time `json:"created_at"`
}

type PushTemplate struct {
	ID            int       `json:"id"`
	Name          string    `json:"name"`
	TitleTemplate string    `json:"title_template"`
	BodyTemplate  string    `json:"body_template"`
	ImageURL      *string   `json:"image_url"`
	DeepLink      *string   `json:"deep_link"`
	Variables     []string  `json:"variables"`
	CreatedAt     time.Time `json:"created_at"`
}

type DLTSMSTemplate struct {
	ID              int       `json:"id"`
	SenderID        string    `json:"sender_id"`
	DLTTemplateID   string    `json:"dlt_template_id"`
	ApprovedContent string    `json:"approved_content"`
	Status          string    `json:"status"` // APPROVED, PENDING, REJECTED
	CreatedAt       time.Time `json:"created_at"`
}

type EmailTemplate struct {
	ID          int       `json:"id"`
	Name        string    `json:"name"`
	Subject     string    `json:"subject"`
	HTMLContent string    `json:"html_content"`
	Variables   []string  `json:"variables"`
	CreatedAt   time.Time `json:"created_at"`
}

type SenderDomain struct {
	ID         int       `json:"id"`
	Domain     string    `json:"domain"`
	Verified   bool      `json:"verified"`
	DKIMStatus string    `json:"dkim_status"` // VERIFIED, PENDING, FAILED
	SPFStatus  string    `json:"spf_status"`  // VERIFIED, PENDING, FAILED
	CreatedAt  time.Time `json:"created_at"`
}

// 1. HandleGetSegments & HandleCreateSegment & HandleDeleteSegment
func (h *MarketingHandler) HandleGetSegments(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	rows, err := h.dbPool.Query(ctx, `
		SELECT id, name, description, filters, size, created_at, updated_at 
		FROM marketing_segments 
		ORDER BY created_at DESC
	`)
	if err != nil {
		h.logger.Printf("[MARKETING_ERROR] Failed querying segments: %v", err)
		http.Error(w, "internal_db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	segments := make([]MarketingSegment, 0)
	for rows.Next() {
		var item MarketingSegment
		var desc sql.NullString
		var filtersBytes []byte
		err := rows.Scan(&item.ID, &item.Name, &desc, &filtersBytes, &item.Size, &item.CreatedAt, &item.UpdatedAt)
		if err == nil {
			if desc.Valid {
				item.Description = &desc.String
			}
			item.Filters = make(map[string]any)
			_ = json.Unmarshal(filtersBytes, &item.Filters)
			segments = append(segments, item)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(segments)
}

func (h *MarketingHandler) HandleCreateSegment(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Name        string         `json:"name"`
		Description string         `json:"description"`
		Filters     map[string]any `json:"filters"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
		http.Error(w, "invalid_json_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	filtersBytes, _ := json.Marshal(req.Filters)
	// Random mock size estimation for saved segments:
	size := 100 + (time.Now().UnixNano() % 4900)

	var id int
	err := h.dbPool.QueryRow(ctx, `
		INSERT INTO marketing_segments (name, description, filters, size) 
		VALUES ($1, $2, $3, $4) 
		RETURNING id
	`, req.Name, req.Description, filtersBytes, size).Scan(&id)

	if err != nil {
		h.logger.Printf("[MARKETING_ERROR] Failed inserting segment: %v", err)
		http.Error(w, "database_insert_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_, _ = w.Write([]byte(fmt.Sprintf(`{"id":%d,"size":%d}`, id, size)))
}

func (h *MarketingHandler) HandleDeleteSegment(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_segment_id", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	_, err := h.dbPool.Exec(ctx, "DELETE FROM marketing_segments WHERE id = $1", id)
	if err != nil {
		h.logger.Printf("[MARKETING_ERROR] Failed deleting segment: %v", err)
		http.Error(w, "database_delete_failed", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"SUCCESS"}`))
}

// 2. HandleEstimateSegment
func (h *MarketingHandler) HandleEstimateSegment(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var filters map[string]any
	_ = json.NewDecoder(r.Body).Decode(&filters)

	// Mock estimate engine based on parsed attributes
	estimate := 1500
	if filters != nil {
		if c, ok := filters["city"]; ok && c != "" {
			estimate = 800
		}
		if t, ok := filters["min_trips"]; ok {
			if tripsVal, valOk := t.(float64); valOk && tripsVal > 10 {
				estimate -= 300
			}
		}
	}
	if estimate < 10 {
		estimate = 12
	}

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(fmt.Sprintf(`{"estimated_size":%d}`, estimate)))
}

// 3. HandleGetCampaigns & HandleCreateCampaign
func (h *MarketingHandler) HandleGetCampaigns(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	rows, err := h.dbPool.Query(ctx, `
		SELECT 
			c.id, c.name, c.segment_id, s.name, c.channel, c.schedule_type, c.schedule_time,
			c.recurrence_cron, c.trigger_event, c.throttling_limit, c.quiet_hours_start,
			c.quiet_hours_end, c.status, c.created_at, c.updated_at
		FROM marketing_campaigns c
		LEFT JOIN marketing_segments s ON s.id = c.segment_id
		ORDER BY c.created_at DESC
	`)
	if err != nil {
		h.logger.Printf("[MARKETING_ERROR] Failed querying campaigns: %v", err)
		http.Error(w, "internal_db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	campaigns := make([]MarketingCampaign, 0)
	for rows.Next() {
		var item MarketingCampaign
		var segID, quietStart, quietEnd, throttle sql.NullInt32
		var segName, recurrence, trigger, channel, schedType sql.NullString
		var schedTime sql.NullTime
		err := rows.Scan(
			&item.ID, &item.Name, &segID, &segName, &channel, &schedType, &schedTime,
			&recurrence, &trigger, &throttle, &quietStart, &quietEnd, &item.Status,
			&item.CreatedAt, &item.UpdatedAt,
		)
		if err == nil {
			if segID.Valid {
				val := int(segID.Int32)
				item.SegmentID = &val
			}
			if segName.Valid {
				item.SegmentName = &segName.String
			}
			if channel.Valid {
				item.Channel = channel.String
			}
			if schedType.Valid {
				item.ScheduleType = schedType.String
			}
			if schedTime.Valid {
				item.ScheduleTime = &schedTime.Time
			}
			if recurrence.Valid {
				item.RecurrenceCron = &recurrence.String
			}
			if trigger.Valid {
				item.TriggerEvent = &trigger.String
			}
			if throttle.Valid {
				val := int(throttle.Int32)
				item.ThrottlingLimit = &val
			}
			if quietStart.Valid {
				val := int(quietStart.Int32)
				item.QuietHoursStart = &val
			}
			if quietEnd.Valid {
				val := int(quietEnd.Int32)
				item.QuietHoursEnd = &val
			}
			item.Variants = make([]CampaignVariant, 0)
			campaigns = append(campaigns, item)
		}
	}

	// Fetch variants for each campaign
	for i := range campaigns {
		vRows, err := h.dbPool.Query(ctx, `
			SELECT id, name, content, weight, created_at 
			FROM campaign_variants 
			WHERE campaign_id = $1
		`, campaigns[i].ID)
		if err == nil {
			for vRows.Next() {
				var v CampaignVariant
				var contentBytes []byte
				err := vRows.Scan(&v.ID, &v.Name, &contentBytes, &v.Weight, &v.CreatedAt)
				if err == nil {
					v.CampaignID = campaigns[i].ID
					v.Content = make(map[string]any)
					_ = json.Unmarshal(contentBytes, &v.Content)
					campaigns[i].Variants = append(campaigns[i].Variants, v)
				}
			}
			vRows.Close()
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(campaigns)
}

func (h *MarketingHandler) HandleCreateCampaign(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Name            string  `json:"name"`
		SegmentID       *int    `json:"segment_id"`
		Channel         string  `json:"channel"`
		ScheduleType    string  `json:"schedule_type"`
		ScheduleTime    *string `json:"schedule_time"`
		RecurrenceCron  *string `json:"recurrence_cron"`
		TriggerEvent    *string `json:"trigger_event"`
		ThrottlingLimit *int    `json:"throttling_limit"`
		QuietHoursStart *int    `json:"quiet_hours_start"`
		QuietHoursEnd   *int    `json:"quiet_hours_end"`
		Variants        []struct {
			Name    string         `json:"name"`
			Content map[string]any `json:"content"`
			Weight  float64        `json:"weight"`
		} `json:"variants"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" || req.Channel == "" || req.ScheduleType == "" {
		http.Error(w, "invalid_json_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "transaction_init_failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	var schedTime *time.Time
	if req.ScheduleTime != nil && *req.ScheduleTime != "" {
		if t, err := time.Parse(time.RFC3339, *req.ScheduleTime); err == nil {
			schedTime = &t
		}
	}

	var campaignID int
	query := `
		INSERT INTO marketing_campaigns (
			name, segment_id, channel, schedule_type, schedule_time, recurrence_cron, 
			trigger_event, throttling_limit, quiet_hours_start, quiet_hours_end, status
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'DRAFT')
		RETURNING id
	`
	err = tx.QueryRow(ctx, query,
		req.Name, req.SegmentID, strings.ToUpper(req.Channel), strings.ToUpper(req.ScheduleType),
		schedTime, req.RecurrenceCron, req.TriggerEvent, req.ThrottlingLimit,
		req.QuietHoursStart, req.QuietHoursEnd,
	).Scan(&campaignID)

	if err != nil {
		h.logger.Printf("[MARKETING_ERROR] Failed inserting campaign: %v", err)
		http.Error(w, "database_insert_failed", http.StatusInternalServerError)
		return
	}

	// Insert A/B Variants
	for _, v := range req.Variants {
		contentBytes, _ := json.Marshal(v.Content)
		_, err = tx.Exec(ctx, `
			INSERT INTO campaign_variants (campaign_id, name, content, weight)
			VALUES ($1, $2, $3, $4)
		`, campaignID, v.Name, contentBytes, v.Weight)
		if err != nil {
			h.logger.Printf("[MARKETING_ERROR] Failed inserting variant: %v", err)
			http.Error(w, "database_insert_failed", http.StatusInternalServerError)
			return
		}
	}

	if err = tx.Commit(ctx); err != nil {
		http.Error(w, "transaction_commit_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_, _ = w.Write([]byte(fmt.Sprintf(`{"id":%d}`, campaignID)))
}

// 4. HandleUpdateCampaignStatus
func (h *MarketingHandler) HandleUpdateCampaignStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_campaign_id", http.StatusBadRequest)
		return
	}

	var req struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Status == "" {
		http.Error(w, "invalid_status_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	_, err := h.dbPool.Exec(ctx, "UPDATE marketing_campaigns SET status = $1, updated_at = NOW() WHERE id = $2", strings.ToUpper(req.Status), id)
	if err != nil {
		h.logger.Printf("[MARKETING_ERROR] Failed updating campaign status: %v", err)
		http.Error(w, "database_update_failed", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"SUCCESS"}`))
}

// 5. HandleGetCampaignAnalytics
func (h *MarketingHandler) HandleGetCampaignAnalytics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_campaign_id", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// Aggregate metrics (delivered, opened, clicked, booking) group by variant
	query := `
		SELECT 
			variant_id,
			COUNT(CASE WHEN action_type = 'DELIVERED' THEN 1 END) as delivered,
			COUNT(CASE WHEN action_type = 'OPENED' THEN 1 END) as opened,
			COUNT(CASE WHEN action_type = 'CLICKED' THEN 1 END) as clicked,
			COUNT(CASE WHEN action_type = 'BOOKING' THEN 1 END) as booking
		FROM campaign_conversions
		WHERE campaign_id = $1
		GROUP BY variant_id
	`
	rows, err := h.dbPool.Query(ctx, query, id)
	if err != nil {
		h.logger.Printf("[MARKETING_ERROR] Failed querying metrics: %v", err)
		http.Error(w, "internal_db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type VariantMetric struct {
		VariantID int   `json:"variant_id"`
		Delivered int64 `json:"delivered"`
		Opened    int64 `json:"opened"`
		Clicked   int64 `json:"clicked"`
		Booking   int64 `json:"booking"`
	}

	metrics := make([]VariantMetric, 0)
	for rows.Next() {
		var m VariantMetric
		if err := rows.Scan(&m.VariantID, &m.Delivered, &m.Opened, &m.Clicked, &m.Booking); err == nil {
			metrics = append(metrics, m)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(metrics)
}

// 6. HandleRecordConversion
func (h *MarketingHandler) HandleRecordConversion(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_campaign_id", http.StatusBadRequest)
		return
	}

	var req struct {
		VariantID  int    `json:"variant_id"`
		UserID     string `json:"user_id"`
		UserType   string `json:"user_type"`
		ActionType string `json:"action_type"` // DELIVERED, OPENED, CLICKED, BOOKING
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.UserID == "" || req.UserType == "" || req.ActionType == "" {
		http.Error(w, "invalid_json_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	_, err := h.dbPool.Exec(ctx, `
		INSERT INTO campaign_conversions (campaign_id, variant_id, user_id, user_type, action_type)
		VALUES ($1, $2, $3::uuid, $4, $5)
	`, id, req.VariantID, req.UserID, strings.ToUpper(req.UserType), strings.ToUpper(req.ActionType))

	if err != nil {
		h.logger.Printf("[MARKETING_ERROR] Failed saving conversion: %v", err)
		http.Error(w, "database_insert_failed", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	_, _ = w.Write([]byte(`{"status":"SUCCESS"}`))
}

// 7. HandleGetBanners & HandleCreateBanner & HandleToggleBannerStatus
func (h *MarketingHandler) HandleGetBanners(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	rows, err := h.dbPool.Query(ctx, `
		SELECT b.id, b.title, b.body, b.image_url, b.deep_link, b.placement, b.segment_id, s.name, b.status, b.start_time, b.end_time, b.created_at
		FROM in_app_banners b
		LEFT JOIN marketing_segments s ON s.id = b.segment_id
		ORDER BY b.created_at DESC
	`)
	if err != nil {
		h.logger.Printf("[MARKETING_ERROR] Failed querying banners: %v", err)
		http.Error(w, "internal_db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	banners := make([]InAppBanner, 0)
	for rows.Next() {
		var item InAppBanner
		var image, link, segName sql.NullString
		var segID sql.NullInt32
		err := rows.Scan(
			&item.ID, &item.Title, &item.Body, &image, &link, &item.Placement,
			&segID, &segName, &item.Status, &item.StartTime, &item.EndTime, &item.CreatedAt,
		)
		if err == nil {
			if image.Valid {
				item.ImageURL = &image.String
			}
			if link.Valid {
				item.DeepLink = &link.String
			}
			if segID.Valid {
				val := int(segID.Int32)
				item.SegmentID = &val
			}
			if segName.Valid {
				item.SegmentName = &segName.String
			}
			banners = append(banners, item)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(banners)
}

func (h *MarketingHandler) HandleCreateBanner(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Title     string  `json:"title"`
		Body      string  `json:"body"`
		ImageURL  *string `json:"image_url"`
		DeepLink  *string `json:"deep_link"`
		Placement string  `json:"placement"` // HOME_SCREEN, BOOKING_CONFIRM, POST_TRIP
		SegmentID *int    `json:"segment_id"`
		StartTime string  `json:"start_time"`
		EndTime   string  `json:"end_time"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Title == "" || req.Body == "" || req.Placement == "" {
		http.Error(w, "invalid_json_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	start, errStart := time.Parse(time.RFC3339, req.StartTime)
	end, errEnd := time.Parse(time.RFC3339, req.EndTime)
	if errStart != nil || errEnd != nil {
		start = time.Now()
		end = time.Now().AddDate(0, 1, 0)
	}

	var id int
	query := `
		INSERT INTO in_app_banners (title, body, image_url, deep_link, placement, segment_id, status, start_time, end_time)
		VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', $7, $8)
		RETURNING id
	`
	err := h.dbPool.QueryRow(ctx, query, req.Title, req.Body, req.ImageURL, req.DeepLink, strings.ToUpper(req.Placement), req.SegmentID, start, end).Scan(&id)
	if err != nil {
		h.logger.Printf("[MARKETING_ERROR] Failed inserting banner: %v", err)
		http.Error(w, "database_insert_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_, _ = w.Write([]byte(fmt.Sprintf(`{"id":%d}`, id)))
}

func (h *MarketingHandler) HandleToggleBannerStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_banner_id", http.StatusBadRequest)
		return
	}

	var req struct {
		Status string `json:"status"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	status := strings.ToUpper(req.Status)
	if status != "ACTIVE" && status != "INACTIVE" {
		status = "INACTIVE"
	}

	_, err := h.dbPool.Exec(ctx, "UPDATE in_app_banners SET status = $1 WHERE id = $2", status, id)
	if err != nil {
		h.logger.Printf("[MARKETING_ERROR] Failed toggling banner: %v", err)
		http.Error(w, "database_update_failed", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"SUCCESS"}`))
}

// 8. HandleGetPushTemplates & HandleCreatePushTemplate
func (h *MarketingHandler) HandleGetPushTemplates(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	rows, err := h.dbPool.Query(ctx, "SELECT id, name, title_template, body_template, image_url, deep_link, variables, created_at FROM push_templates ORDER BY created_at DESC")
	if err != nil {
		h.logger.Printf("[MARKETING_ERROR] Failed querying push templates: %v", err)
		http.Error(w, "internal_db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	templates := make([]PushTemplate, 0)
	for rows.Next() {
		var item PushTemplate
		var image, link sql.NullString
		err := rows.Scan(&item.ID, &item.Name, &item.TitleTemplate, &item.BodyTemplate, &image, &link, &item.Variables, &item.CreatedAt)
		if err == nil {
			if image.Valid {
				item.ImageURL = &image.String
			}
			if link.Valid {
				item.DeepLink = &link.String
			}
			templates = append(templates, item)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(templates)
}

func (h *MarketingHandler) HandleCreatePushTemplate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Name          string   `json:"name"`
		TitleTemplate string   `json:"title_template"`
		BodyTemplate  string   `json:"body_template"`
		ImageURL      *string  `json:"image_url"`
		DeepLink      *string  `json:"deep_link"`
		Variables     []string `json:"variables"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" || req.TitleTemplate == "" || req.BodyTemplate == "" {
		http.Error(w, "invalid_json_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	vars := req.Variables
	if vars == nil {
		vars = []string{}
	}

	var id int
	query := `
		INSERT INTO push_templates (name, title_template, body_template, image_url, deep_link, variables)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`
	err := h.dbPool.QueryRow(ctx, query, req.Name, req.TitleTemplate, req.BodyTemplate, req.ImageURL, req.DeepLink, vars).Scan(&id)
	if err != nil {
		h.logger.Printf("[MARKETING_ERROR] Failed inserting push template: %v", err)
		http.Error(w, "database_insert_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_, _ = w.Write([]byte(fmt.Sprintf(`{"id":%d}`, id)))
}

// 9. HandleGetSMSTemplates & HandleCreateSMSTemplate
func (h *MarketingHandler) HandleGetSMSTemplates(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	rows, err := h.dbPool.Query(ctx, "SELECT id, sender_id, dlt_template_id, approved_content, status, created_at FROM dlt_sms_templates ORDER BY created_at DESC")
	if err != nil {
		h.logger.Printf("[MARKETING_ERROR] Failed querying DLT templates: %v", err)
		http.Error(w, "internal_db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	templates := make([]DLTSMSTemplate, 0)
	for rows.Next() {
		var item DLTSMSTemplate
		err := rows.Scan(&item.ID, &item.SenderID, &item.DLTTemplateID, &item.ApprovedContent, &item.Status, &item.CreatedAt)
		if err == nil {
			templates = append(templates, item)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(templates)
}

func (h *MarketingHandler) HandleCreateSMSTemplate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		SenderID        string `json:"sender_id"`
		DLTTemplateID   string `json:"dlt_template_id"`
		ApprovedContent string `json:"approved_content"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.SenderID == "" || req.DLTTemplateID == "" || req.ApprovedContent == "" {
		http.Error(w, "invalid_json_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var id int
	query := `
		INSERT INTO dlt_sms_templates (sender_id, dlt_template_id, approved_content, status)
		VALUES ($1, $2, $3, 'APPROVED')
		RETURNING id
	`
	err := h.dbPool.QueryRow(ctx, query, req.SenderID, req.DLTTemplateID, req.ApprovedContent).Scan(&id)
	if err != nil {
		h.logger.Printf("[MARKETING_ERROR] Failed inserting DLT template: %v", err)
		http.Error(w, "database_insert_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_, _ = w.Write([]byte(fmt.Sprintf(`{"id":%d}`, id)))
}

// 10. HandleGetEmailTemplates & HandleCreateEmailTemplate
func (h *MarketingHandler) HandleGetEmailTemplates(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	rows, err := h.dbPool.Query(ctx, "SELECT id, name, subject, html_content, variables, created_at FROM email_templates ORDER BY created_at DESC")
	if err != nil {
		h.logger.Printf("[MARKETING_ERROR] Failed querying email templates: %v", err)
		http.Error(w, "internal_db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	templates := make([]EmailTemplate, 0)
	for rows.Next() {
		var item EmailTemplate
		err := rows.Scan(&item.ID, &item.Name, &item.Subject, &item.HTMLContent, &item.Variables, &item.CreatedAt)
		if err == nil {
			templates = append(templates, item)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(templates)
}

func (h *MarketingHandler) HandleCreateEmailTemplate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Name        string   `json:"name"`
		Subject     string   `json:"subject"`
		HTMLContent string   `json:"html_content"`
		Variables   []string `json:"variables"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" || req.Subject == "" || req.HTMLContent == "" {
		http.Error(w, "invalid_json_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	vars := req.Variables
	if vars == nil {
		vars = []string{}
	}

	var id int
	query := `
		INSERT INTO email_templates (name, subject, html_content, variables)
		VALUES ($1, $2, $3, $4)
		RETURNING id
	`
	err := h.dbPool.QueryRow(ctx, query, req.Name, req.Subject, req.HTMLContent, vars).Scan(&id)
	if err != nil {
		h.logger.Printf("[MARKETING_ERROR] Failed inserting email template: %v", err)
		http.Error(w, "database_insert_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_, _ = w.Write([]byte(fmt.Sprintf(`{"id":%d}`, id)))
}

// 11. HandleGetDomains & HandleCreateDomain & HandleVerifyDomain
func (h *MarketingHandler) HandleGetDomains(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	rows, err := h.dbPool.Query(ctx, "SELECT id, domain, verified, dkim_status, spf_status, created_at FROM sender_domains ORDER BY created_at DESC")
	if err != nil {
		h.logger.Printf("[MARKETING_ERROR] Failed querying domains: %v", err)
		http.Error(w, "internal_db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	domains := make([]SenderDomain, 0)
	for rows.Next() {
		var item SenderDomain
		err := rows.Scan(&item.ID, &item.Domain, &item.Verified, &item.DKIMStatus, &item.SPFStatus, &item.CreatedAt)
		if err == nil {
			domains = append(domains, item)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(domains)
}

func (h *MarketingHandler) HandleCreateDomain(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Domain string `json:"domain"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Domain == "" {
		http.Error(w, "invalid_json_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var id int
	query := `
		INSERT INTO sender_domains (domain, verified, dkim_status, spf_status)
		VALUES ($1, false, 'PENDING', 'PENDING')
		RETURNING id
	`
	err := h.dbPool.QueryRow(ctx, query, req.Domain).Scan(&id)
	if err != nil {
		h.logger.Printf("[MARKETING_ERROR] Failed inserting domain: %v", err)
		http.Error(w, "database_insert_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_, _ = w.Write([]byte(fmt.Sprintf(`{"id":%d}`, id)))
}

func (h *MarketingHandler) HandleVerifyDomain(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_domain_id", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// Simulate DNS check and mark as verified
	query := "UPDATE sender_domains SET verified = true, dkim_status = 'VERIFIED', spf_status = 'VERIFIED' WHERE id = $1"
	_, err := h.dbPool.Exec(ctx, query, id)
	if err != nil {
		h.logger.Printf("[MARKETING_ERROR] Failed verifying domain: %v", err)
		http.Error(w, "database_update_failed", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"SUCCESS"}`))
}
