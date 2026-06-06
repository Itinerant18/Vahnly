package http

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type SupportHandler struct {
	dbPool *pgxpool.Pool
	logger *log.Logger
}

func NewSupportHandler(dbPool *pgxpool.Pool, logger *log.Logger) *SupportHandler {
	return &SupportHandler{dbPool: dbPool, logger: logger}
}

type SupportTicket struct {
	ID                string     `json:"id"`
	CreatorID         string     `json:"creator_id"`
	CreatorType       string     `json:"creator_type"`
	CreatorName       string     `json:"creator_name"`
	CreatorPhone      string     `json:"creator_phone"`
	Channel           string     `json:"channel"`
	Subject           string     `json:"subject"`
	Description       string     `json:"description"`
	Priority          string     `json:"priority"`
	Status            string     `json:"status"`
	Category          string     `json:"category"`
	AssignedAgentID   *string    `json:"assigned_agent_id"`
	AssignedAgentName *string    `json:"assigned_agent_name"`
	Tags              []string   `json:"tags"`
	SLADeadline       time.Time  `json:"sla_deadline"`
	SLABreach         bool       `json:"sla_breach"`
	EscalatedTo       *string    `json:"escalated_to"`
	LinkedTripID      *string    `json:"linked_trip_id"`
	ResolutionType    *string    `json:"resolution_type"`
	ResolutionReason  *string    `json:"resolution_reason"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
	ClosedAt          *time.Time `json:"closed_at"`
}

type TicketMessage struct {
	ID             int       `json:"id"`
	TicketID       string    `json:"ticket_id"`
	SenderID       string    `json:"sender_id"`
	SenderName     string    `json:"sender_name"`
	SenderType     string    `json:"sender_type"`
	MessageType    string    `json:"message_type"`
	Content        string    `json:"content"`
	AttachmentURLs []string  `json:"attachment_urls"`
	CreatedAt      time.Time `json:"created_at"`
}

type LostFoundItem struct {
	ID                 int        `json:"id"`
	TicketID           *string    `json:"ticket_id"`
	TripID             *string    `json:"trip_id"`
	ReporterID         string     `json:"reporter_id"`
	ReporterType       string     `json:"reporter_type"`
	ItemDescription    string     `json:"item_description"`
	Status             string     `json:"status"`
	DriverContacted    bool       `json:"driver_contacted"`
	ReturnTrackingCode *string    `json:"return_tracking_code"`
	ReturnMethod       *string    `json:"return_method"`
	Notes              *string    `json:"notes"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

type SupportMacro struct {
	ShortcutCode string    `json:"shortcut_code"`
	Category     string    `json:"category"`
	Title        string    `json:"title"`
	TemplateText string    `json:"template_text"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type FAQArticle struct {
	ID        int       `json:"id"`
	Title     string    `json:"title"`
	Category  string    `json:"category"`
	Content   string    `json:"content"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type TicketCSAT struct {
	TicketID    string    `json:"ticket_id"`
	Rating      int       `json:"rating"`
	Comment     *string   `json:"comment"`
	SubmittedAt time.Time `json:"submitted_at"`
}

type TicketDetailResponse struct {
	Ticket   SupportTicket   `json:"ticket"`
	Messages []TicketMessage `json:"messages"`
	CSAT     *TicketCSAT     `json:"csat,omitempty"`
}

// HandleGetTickets gets support tickets list with filtering and search
func (h *SupportHandler) HandleGetTickets(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	q := r.URL.Query()
	limit := parseBoundedQueryInt(q.Get("limit"), 50, 1, 100)
	offset := parseBoundedQueryInt(q.Get("offset"), 0, 0, 100000)

	status := q.Get("status")
	priority := q.Get("priority")
	category := q.Get("category")
	agentID := q.Get("assigned_agent_id")
	slaBreach := q.Get("sla_breach")
	search := q.Get("search")

	query := `
		SELECT 
			t.id, t.creator_id, t.creator_type, t.creator_name, t.creator_phone,
			t.channel, t.subject, t.description, t.priority, t.status, t.category,
			t.assigned_agent_id, a.full_name as assigned_agent_name, t.tags,
			t.sla_deadline, t.escalated_to, t.linked_trip_id, t.resolution_type, t.resolution_reason,
			t.created_at, t.updated_at, t.closed_at
		FROM support_tickets t
		LEFT JOIN system_admins a ON a.id = t.assigned_agent_id
		WHERE 1=1
	`
	var args []interface{}
	argIdx := 1

	if status != "" {
		query += fmt.Sprintf(" AND t.status = $%d", argIdx)
		args = append(args, strings.ToUpper(status))
		argIdx++
	}
	if priority != "" {
		query += fmt.Sprintf(" AND t.priority = $%d", argIdx)
		args = append(args, strings.ToUpper(priority))
		argIdx++
	}
	if category != "" {
		query += fmt.Sprintf(" AND t.category = $%d", argIdx)
		args = append(args, strings.ToUpper(category))
		argIdx++
	}
	if agentID != "" {
		query += fmt.Sprintf(" AND t.assigned_agent_id = $%d::uuid", argIdx)
		args = append(args, agentID)
		argIdx++
	}
	if slaBreach == "true" {
		query += " AND t.sla_deadline < NOW() AND t.status IN ('OPEN', 'PENDING')"
	}
	if search != "" {
		query += fmt.Sprintf(" AND (t.id ILIKE $%d OR t.subject ILIKE $%d OR t.description ILIKE $%d OR t.creator_name ILIKE $%d)", argIdx, argIdx, argIdx, argIdx)
		args = append(args, "%"+search+"%")
		argIdx++
	}

	countQuery := "SELECT COUNT(*) FROM (" + query + ") count_t"
	var total int64
	err := h.dbPool.QueryRow(ctx, countQuery, args...).Scan(&total)
	if err != nil {
		h.logger.Printf("[SUPPORT_ERROR] Failed counting tickets: %v", err)
		http.Error(w, "internal_db_error", http.StatusInternalServerError)
		return
	}

	query += fmt.Sprintf(" ORDER BY t.created_at DESC LIMIT $%d OFFSET $%d", argIdx, argIdx+1)
	args = append(args, limit, offset)

	rows, err := h.dbPool.Query(ctx, query, args...)
	if err != nil {
		h.logger.Printf("[SUPPORT_ERROR] Failed querying tickets: %v", err)
		http.Error(w, "internal_db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	tickets := make([]SupportTicket, 0)
	for rows.Next() {
		var item SupportTicket
		var agentIDStr, agentName, escalated, tripID, resType, resReason sql.NullString
		var closedAtVal sql.NullTime
		err := rows.Scan(
			&item.ID, &item.CreatorID, &item.CreatorType, &item.CreatorName, &item.CreatorPhone,
			&item.Channel, &item.Subject, &item.Description, &item.Priority, &item.Status, &item.Category,
			&agentIDStr, &agentName, &item.Tags, &item.SLADeadline, &escalated, &tripID, &resType, &resReason,
			&item.CreatedAt, &item.UpdatedAt, &closedAtVal,
		)
		if err == nil {
			if agentIDStr.Valid { item.AssignedAgentID = &agentIDStr.String }
			if agentName.Valid { item.AssignedAgentName = &agentName.String }
			if escalated.Valid { item.EscalatedTo = &escalated.String }
			if tripID.Valid { item.LinkedTripID = &tripID.String }
			if resType.Valid { item.ResolutionType = &resType.String }
			if resReason.Valid { item.ResolutionReason = &resReason.String }
			if closedAtVal.Valid { item.ClosedAt = &closedAtVal.Time }

			item.SLABreach = item.SLADeadline.Before(time.Now()) && (item.Status == "OPEN" || item.Status == "PENDING")
			tickets = append(tickets, item)
		} else {
			h.logger.Printf("[SUPPORT_ERROR] Row scan failed: %v", err)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"tickets": tickets,
		"total":   total,
	})
}

// HandleGetTicketDetail gets detailed ticket info with message threads
func (h *SupportHandler) HandleGetTicketDetail(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_ticket_id", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var item SupportTicket
	var agentIDStr, agentName, escalated, tripID, resType, resReason sql.NullString
	var closedAtVal sql.NullTime

	query := `
		SELECT 
			t.id, t.creator_id, t.creator_type, t.creator_name, t.creator_phone,
			t.channel, t.subject, t.description, t.priority, t.status, t.category,
			t.assigned_agent_id, a.full_name as assigned_agent_name, t.tags,
			t.sla_deadline, t.escalated_to, t.linked_trip_id, t.resolution_type, t.resolution_reason,
			t.created_at, t.updated_at, t.closed_at
		FROM support_tickets t
		LEFT JOIN system_admins a ON a.id = t.assigned_agent_id
		WHERE t.id = $1
	`
	err := h.dbPool.QueryRow(ctx, query, id).Scan(
		&item.ID, &item.CreatorID, &item.CreatorType, &item.CreatorName, &item.CreatorPhone,
		&item.Channel, &item.Subject, &item.Description, &item.Priority, &item.Status, &item.Category,
		&agentIDStr, &agentName, &item.Tags, &item.SLADeadline, &escalated, &tripID, &resType, &resReason,
		&item.CreatedAt, &item.UpdatedAt, &closedAtVal,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "ticket_not_found", http.StatusNotFound)
			return
		}
		http.Error(w, "database_query_error", http.StatusInternalServerError)
		return
	}

	if agentIDStr.Valid { item.AssignedAgentID = &agentIDStr.String }
	if agentName.Valid { item.AssignedAgentName = &agentName.String }
	if escalated.Valid { item.EscalatedTo = &escalated.String }
	if tripID.Valid { item.LinkedTripID = &tripID.String }
	if resType.Valid { item.ResolutionType = &resType.String }
	if resReason.Valid { item.ResolutionReason = &resReason.String }
	if closedAtVal.Valid { item.ClosedAt = &closedAtVal.Time }
	item.SLABreach = item.SLADeadline.Before(time.Now()) && (item.Status == "OPEN" || item.Status == "PENDING")

	// Fetch Messages
	msgQuery := `
		SELECT id, ticket_id, sender_id, sender_name, sender_type, message_type, content, attachment_urls, created_at
		FROM ticket_messages
		WHERE ticket_id = $1
		ORDER BY created_at ASC
	`
	rows, err := h.dbPool.Query(ctx, msgQuery, id)
	if err != nil {
		h.logger.Printf("[SUPPORT_ERROR] Failed querying ticket messages: %v", err)
		http.Error(w, "database_query_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	messages := make([]TicketMessage, 0)
	for rows.Next() {
		var msg TicketMessage
		err := rows.Scan(&msg.ID, &msg.TicketID, &msg.SenderID, &msg.SenderName, &msg.SenderType, &msg.MessageType, &msg.Content, &msg.AttachmentURLs, &msg.CreatedAt)
		if err == nil {
			messages = append(messages, msg)
		}
	}

	// Fetch CSAT if exists
	var csat TicketCSAT
	var csatComment sql.NullString
	csatQuery := `SELECT ticket_id, rating, comment, submitted_at FROM ticket_csat WHERE ticket_id = $1`
	var csatPtr *TicketCSAT
	err = h.dbPool.QueryRow(ctx, csatQuery, id).Scan(&csat.TicketID, &csat.Rating, &csatComment, &csat.SubmittedAt)
	if err == nil {
		if csatComment.Valid { csat.Comment = &csatComment.String }
		csatPtr = &csat
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(TicketDetailResponse{
		Ticket:   item,
		Messages: messages,
		CSAT:     csatPtr,
	})
}

// HandleCreateTicket logs a new support ticket manual intake
func (h *SupportHandler) HandleCreateTicket(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		CreatorID    string  `json:"creator_id"`
		CreatorType  string  `json:"creator_type"`
		CreatorName  string  `json:"creator_name"`
		CreatorPhone string  `json:"creator_phone"`
		Channel      string  `json:"channel"`
		Subject      string  `json:"subject"`
		Description  string  `json:"description"`
		Priority     string  `json:"priority"`
		Category     string  `json:"category"`
		LinkedTripID *string `json:"linked_trip_id"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid_json_payload", http.StatusBadRequest)
		return
	}

	if req.CreatorID == "" || req.CreatorType == "" || req.CreatorName == "" || req.Channel == "" || req.Subject == "" || req.Description == "" {
		http.Error(w, "missing_required_fields", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// Compute SLA Deadline based on priority
	var slaDuration time.Duration
	switch strings.ToUpper(req.Priority) {
	case "URGENT":
		slaDuration = 1 * time.Hour
	case "HIGH":
		slaDuration = 4 * time.Hour
	case "LOW":
		slaDuration = 72 * time.Hour
	default:
		req.Priority = "MEDIUM"
		slaDuration = 24 * time.Hour
	}
	slaDeadline := time.Now().Add(slaDuration)

	// Generate ticket ID
	ticketID := fmt.Sprintf("TKT-%d", (time.Now().UnixNano()/1000)%100000)

	query := `
		INSERT INTO support_tickets (
			id, creator_id, creator_type, creator_name, creator_phone,
			channel, subject, description, priority, status, category,
			sla_deadline, linked_trip_id
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'OPEN', $10, $11, $12)
	`
	_, err := h.dbPool.Exec(ctx, query,
		ticketID, req.CreatorID, strings.ToUpper(req.CreatorType), req.CreatorName, req.CreatorPhone,
		strings.ToUpper(req.Channel), req.Subject, req.Description, strings.ToUpper(req.Priority),
		strings.ToUpper(req.Category), slaDeadline, req.LinkedTripID,
	)
	if err != nil {
		h.logger.Printf("[SUPPORT_ERROR] Failed creating ticket: %v", err)
		http.Error(w, "database_insert_failed", http.StatusInternalServerError)
		return
	}

	// Insert initial ticket description as the first user message
	msgQuery := `
		INSERT INTO ticket_messages (ticket_id, sender_id, sender_name, sender_type, message_type, content)
		VALUES ($1, $2, $3, $4, $5, $6)
	`
	senderType := "USER"
	msgType := "CHAT"
	if strings.ToUpper(req.Channel) == "EMAIL" {
		msgType = "EMAIL"
	} else if strings.ToUpper(req.Channel) == "PHONE" {
		msgType = "CALL_NOTE"
	}
	_, _ = h.dbPool.Exec(ctx, msgQuery, ticketID, req.CreatorID, req.CreatorName, senderType, msgType, req.Description)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_, _ = w.Write([]byte(fmt.Sprintf(`{"id":"%s"}`, ticketID)))
}

// HandleBulkAssignTickets bulk assigns a list of ticket IDs to a specified admin agent
func (h *SupportHandler) HandleBulkAssignTickets(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		IDs     []string `json:"ids"`
		AgentID string   `json:"agent_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.IDs) == 0 || req.AgentID == "" {
		http.Error(w, "invalid_assign_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	query := "UPDATE support_tickets SET assigned_agent_id = $1::uuid, updated_at = NOW() WHERE id = ANY($2)"
	_, err := h.dbPool.Exec(ctx, query, req.AgentID, req.IDs)
	if err != nil {
		h.logger.Printf("[SUPPORT_ERROR] Failed bulk assigning tickets: %v", err)
		http.Error(w, "database_update_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"SUCCESS"}`))
}

// HandleMergeTickets merges a source ticket into a target ticket
func (h *SupportHandler) HandleMergeTickets(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		SourceID string `json:"source_ticket_id"`
		TargetID string `json:"target_ticket_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.SourceID == "" || req.TargetID == "" {
		http.Error(w, "invalid_merge_payload", http.StatusBadRequest)
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

	// Verify both tickets exist
	var sourceExists, targetExists bool
	_ = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM support_tickets WHERE id = $1)", req.SourceID).Scan(&sourceExists)
	_ = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM support_tickets WHERE id = $1)", req.TargetID).Scan(&targetExists)

	if !sourceExists || !targetExists {
		http.Error(w, "ticket_not_found", http.StatusNotFound)
		return
	}

	// Move messages
	_, err = tx.Exec(ctx, "UPDATE ticket_messages SET ticket_id = $1 WHERE ticket_id = $2", req.TargetID, req.SourceID)
	if err != nil {
		http.Error(w, "failed_moving_messages", http.StatusInternalServerError)
		return
	}

	// Move Lost items
	_, _ = tx.Exec(ctx, "UPDATE lost_found_items SET ticket_id = $1 WHERE ticket_id = $2", req.TargetID, req.SourceID)

	// Close source ticket
	closeQuery := `
		UPDATE support_tickets 
		SET status = 'CLOSED', resolution_type = 'MESSAGE', resolution_reason = $2, closed_at = NOW(), updated_at = NOW() 
		WHERE id = $1
	`
	reason := fmt.Sprintf("Merged into ticket %s", req.TargetID)
	_, err = tx.Exec(ctx, closeQuery, req.SourceID, reason)
	if err != nil {
		http.Error(w, "failed_closing_source_ticket", http.StatusInternalServerError)
		return
	}

	// Insert system message in target thread
	sysMsg := fmt.Sprintf("System Note: Ticket %s was merged into this ticket. All conversation history has been consolidated.", req.SourceID)
	_, err = tx.Exec(ctx, `
		INSERT INTO ticket_messages (ticket_id, sender_id, sender_name, sender_type, message_type, content)
		VALUES ($1, '00000000-0000-0000-0000-000000000000', 'System', 'SYSTEM', 'INTERNAL_NOTE', $2)
	`, req.TargetID, sysMsg)
	if err != nil {
		http.Error(w, "failed_inserting_merge_message", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "transaction_commit_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"MERGED"}`))
}

// HandleUpdateTicketTags updates tag array for a ticket
func (h *SupportHandler) HandleUpdateTicketTags(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_ticket_id", http.StatusBadRequest)
		return
	}

	var req struct {
		Tags []string `json:"tags"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid_tags_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	query := "UPDATE support_tickets SET tags = $1, updated_at = NOW() WHERE id = $2"
	_, err := h.dbPool.Exec(ctx, query, req.Tags, id)
	if err != nil {
		h.logger.Printf("[SUPPORT_ERROR] Failed updating tags: %v", err)
		http.Error(w, "database_update_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"TAGS_UPDATED"}`))
}

// HandlePostMessage appends a new message/response to a ticket
func (h *SupportHandler) HandlePostMessage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_ticket_id", http.StatusBadRequest)
		return
	}

	var req struct {
		SenderID       string   `json:"sender_id"`
		SenderName     string   `json:"sender_name"`
		SenderType     string   `json:"sender_type"`
		MessageType    string   `json:"message_type"`
		Content        string   `json:"content"`
		AttachmentURLs []string `json:"attachment_urls"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Content == "" || req.SenderType == "" || req.MessageType == "" {
		http.Error(w, "invalid_message_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "transaction_init_failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// Verify ticket status
	var currentStatus string
	err = tx.QueryRow(ctx, "SELECT status FROM support_tickets WHERE id = $1 FOR UPDATE", id).Scan(&currentStatus)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "ticket_not_found", http.StatusNotFound)
			return
		}
		http.Error(w, "database_query_error", http.StatusInternalServerError)
		return
	}

	// Insert message
	msgQuery := `
		INSERT INTO ticket_messages (ticket_id, sender_id, sender_name, sender_type, message_type, content, attachment_urls)
		VALUES ($1, $2::uuid, $3, $4, $5, $6, $7)
	`
	senderID := req.SenderID
	if senderID == "" {
		senderID = "00000000-0000-0000-0000-000000000000"
	}
	_, err = tx.Exec(ctx, msgQuery, id, senderID, req.SenderName, strings.ToUpper(req.SenderType), strings.ToUpper(req.MessageType), req.Content, req.AttachmentURLs)
	if err != nil {
		h.logger.Printf("[SUPPORT_ERROR] Failed inserting message: %v", err)
		http.Error(w, "database_insert_failed", http.StatusInternalServerError)
		return
	}

	// Update ticket timestamp
	// If agent replies and ticket was OPEN, transition it to PENDING (waiting on customer response)
	newStatus := currentStatus
	if strings.ToUpper(req.SenderType) == "AGENT" && currentStatus == "OPEN" && strings.ToUpper(req.MessageType) != "INTERNAL_NOTE" {
		newStatus = "PENDING"
	}
	// If user replies and ticket was PENDING, transition back to OPEN
	if strings.ToUpper(req.SenderType) == "USER" && currentStatus == "PENDING" {
		newStatus = "OPEN"
	}

	_, err = tx.Exec(ctx, "UPDATE support_tickets SET status = $1, updated_at = NOW() WHERE id = $2", newStatus, id)
	if err != nil {
		http.Error(w, "database_update_failed", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "transaction_commit_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(fmt.Sprintf(`{"status":"MESSAGE_POSTED","ticket_status":"%s"}`, newStatus)))
}

// HandleEscalateTicket escalates a support ticket to L2, Safety or Finance
func (h *SupportHandler) HandleEscalateTicket(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_ticket_id", http.StatusBadRequest)
		return
	}

	var req struct {
		EscalatedTo string `json:"escalated_to"`
		Notes       string `json:"notes"`
		AgentName   string `json:"agent_name"`
		AgentID     string `json:"agent_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.EscalatedTo == "" {
		http.Error(w, "invalid_escalate_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "transaction_init_failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// Update ticket escalated_to
	query := "UPDATE support_tickets SET escalated_to = $1, status = 'OPEN', updated_at = NOW() WHERE id = $2"
	_, err = tx.Exec(ctx, query, strings.ToUpper(req.EscalatedTo), id)
	if err != nil {
		http.Error(w, "database_update_failed", http.StatusInternalServerError)
		return
	}

	// Insert escalation internal note message
	escalationText := fmt.Sprintf("Ticket escalated to %s. Notes: %s", strings.ToUpper(req.EscalatedTo), req.Notes)
	senderID := req.AgentID
	if senderID == "" {
		senderID = "00000000-0000-0000-0000-000000000000"
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO ticket_messages (ticket_id, sender_id, sender_name, sender_type, message_type, content)
		VALUES ($1, $2::uuid, $3, 'AGENT', 'INTERNAL_NOTE', $4)
	`, id, senderID, req.AgentName, escalationText)
	if err != nil {
		http.Error(w, "database_insert_failed", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "transaction_commit_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"ESCALATED"}`))
}

// HandleResolveTicket marks a ticket resolved with reasons
func (h *SupportHandler) HandleResolveTicket(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_ticket_id", http.StatusBadRequest)
		return
	}

	var req struct {
		ResolutionType   string `json:"resolution_type"`
		ResolutionReason string `json:"resolution_reason"`
		AgentName        string `json:"agent_name"`
		AgentID          string `json:"agent_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ResolutionType == "" || req.ResolutionReason == "" {
		http.Error(w, "invalid_resolve_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "transaction_init_failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	query := `
		UPDATE support_tickets 
		SET status = 'RESOLVED', resolution_type = $1, resolution_reason = $2, updated_at = NOW() 
		WHERE id = $3
	`
	_, err = tx.Exec(ctx, query, strings.ToUpper(req.ResolutionType), req.ResolutionReason, id)
	if err != nil {
		http.Error(w, "database_update_failed", http.StatusInternalServerError)
		return
	}

	// Add system resolution message
	resolutionText := fmt.Sprintf("Support Ticket resolved by %s.\nResolution: %s\nReason: %s", req.AgentName, req.ResolutionType, req.ResolutionReason)
	senderID := req.AgentID
	if senderID == "" {
		senderID = "00000000-0000-0000-0000-000000000000"
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO ticket_messages (ticket_id, sender_id, sender_name, sender_type, message_type, content)
		VALUES ($1, $2::uuid, 'System', 'SYSTEM', 'CHAT', $3)
	`, id, senderID, resolutionText)
	if err != nil {
		http.Error(w, "database_insert_failed", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "transaction_commit_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"RESOLVED"}`))
}

// HandleCloseTicket transitions a ticket to CLOSED and stamps closed_at
func (h *SupportHandler) HandleCloseTicket(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_ticket_id", http.StatusBadRequest)
		return
	}

	var req struct {
		AgentName string `json:"agent_name"`
		AgentID   string `json:"agent_id"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "transaction_init_failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	query := "UPDATE support_tickets SET status = 'CLOSED', closed_at = NOW(), updated_at = NOW() WHERE id = $1"
	_, err = tx.Exec(ctx, query, id)
	if err != nil {
		http.Error(w, "database_update_failed", http.StatusInternalServerError)
		return
	}

	// Add system closed message
	senderID := req.AgentID
	if senderID == "" {
		senderID = "00000000-0000-0000-0000-000000000000"
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO ticket_messages (ticket_id, sender_id, sender_name, sender_type, message_type, content)
		VALUES ($1, $2::uuid, 'System', 'SYSTEM', 'CHAT', 'Support Ticket was marked as closed. Customer satisfaction survey sent.')
	`, id, senderID)
	if err != nil {
		http.Error(w, "database_insert_failed", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "transaction_commit_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"CLOSED"}`))
}

// HandleSubmitCSAT submits CSAT rating score
func (h *SupportHandler) HandleSubmitCSAT(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_ticket_id", http.StatusBadRequest)
		return
	}

	var req struct {
		Rating  int    `json:"rating"`
		Comment string `json:"comment"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Rating < 1 || req.Rating > 5 {
		http.Error(w, "invalid_rating_value", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	query := `
		INSERT INTO ticket_csat (ticket_id, rating, comment, submitted_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (ticket_id) DO UPDATE SET rating = $2, comment = $3, submitted_at = NOW()
	`
	_, err := h.dbPool.Exec(ctx, query, id, req.Rating, req.Comment)
	if err != nil {
		h.logger.Printf("[SUPPORT_ERROR] Failed inserting CSAT: %v", err)
		http.Error(w, "database_insert_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"CSAT_SUBMITTED"}`))
}

// HandleGetLostFoundItems retrieves all lost & found item logs
func (h *SupportHandler) HandleGetLostFoundItems(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	q := r.URL.Query()
	status := q.Get("status")
	search := q.Get("search")

	query := `
		SELECT id, ticket_id, trip_id, reporter_id, reporter_type, item_description, status, driver_contacted, return_tracking_code, return_method, notes, created_at, updated_at
		FROM lost_found_items
		WHERE 1=1
	`
	var args []interface{}
	argIdx := 1

	if status != "" {
		query += fmt.Sprintf(" AND status = $%d", argIdx)
		args = append(args, strings.ToUpper(status))
		argIdx++
	}
	if search != "" {
		query += fmt.Sprintf(" AND (item_description ILIKE $%d OR notes ILIKE $%d)", argIdx, argIdx)
		args = append(args, "%"+search+"%")
		argIdx++
	}

	query += " ORDER BY created_at DESC"

	rows, err := h.dbPool.Query(ctx, query, args...)
	if err != nil {
		h.logger.Printf("[SUPPORT_ERROR] Failed querying lost items: %v", err)
		http.Error(w, "database_query_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	items := make([]LostFoundItem, 0)
	for rows.Next() {
		var item LostFoundItem
		var tktID, tripID, tracking, method, notes sql.NullString
		err := rows.Scan(
			&item.ID, &tktID, &tripID, &item.ReporterID, &item.ReporterType, &item.ItemDescription, &item.Status, &item.DriverContacted, &tracking, &method, &notes, &item.CreatedAt, &item.UpdatedAt,
		)
		if err == nil {
			if tktID.Valid { item.TicketID = &tktID.String }
			if tripID.Valid { item.TripID = &tripID.String }
			if tracking.Valid { item.ReturnTrackingCode = &tracking.String }
			if method.Valid { item.ReturnMethod = &method.String }
			if notes.Valid { item.Notes = &notes.String }
			items = append(items, item)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(items)
}

// HandleCreateLostFoundItem creates a lost & found report
func (h *SupportHandler) HandleCreateLostFoundItem(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		TicketID        *string `json:"ticket_id"`
		TripID          *string `json:"trip_id"`
		ReporterID      string  `json:"reporter_id"`
		ReporterType    string  `json:"reporter_type"`
		ItemDescription string  `json:"item_description"`
		Notes           *string `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ReporterID == "" || req.ReporterType == "" || req.ItemDescription == "" {
		http.Error(w, "invalid_lost_found_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	query := `
		INSERT INTO lost_found_items (ticket_id, trip_id, reporter_id, reporter_type, item_description, status, driver_contacted, notes)
		VALUES ($1, $2::uuid, $3, $4, $5, 'REPORTED', false, $6)
		RETURNING id
	`
	var id int
	err := h.dbPool.QueryRow(ctx, query, req.TicketID, req.TripID, req.ReporterID, strings.ToUpper(req.ReporterType), req.ItemDescription, req.Notes).Scan(&id)
	if err != nil {
		h.logger.Printf("[SUPPORT_ERROR] Failed inserting lost item: %v", err)
		http.Error(w, "database_insert_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_, _ = w.Write([]byte(fmt.Sprintf(`{"id":%d}`, id)))
}

// HandleUpdateLostFoundItem updates status, driver contact and tracking of a lost item
func (h *SupportHandler) HandleUpdateLostFoundItem(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch && r.Method != http.MethodPost { // support both for easy routing
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_item_id", http.StatusBadRequest)
		return
	}

	var req struct {
		Status             string  `json:"status"`
		DriverContacted    *bool   `json:"driver_contacted"`
		ReturnTrackingCode *string `json:"return_tracking_code"`
		ReturnMethod       *string `json:"return_method"`
		Notes              *string `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "transaction_init_failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// Fetch current lost item to find the linked ticket
	var ticketID sql.NullString
	err = tx.QueryRow(ctx, "SELECT ticket_id FROM lost_found_items WHERE id = $1 FOR UPDATE", id).Scan(&ticketID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "lost_item_not_found", http.StatusNotFound)
			return
		}
		http.Error(w, "database_query_error", http.StatusInternalServerError)
		return
	}

	// Update columns dynamically
	query := "UPDATE lost_found_items SET updated_at = NOW()"
	var args []interface{}
	argIdx := 1

	if req.Status != "" {
		query += fmt.Sprintf(", status = $%d", argIdx)
		args = append(args, strings.ToUpper(req.Status))
		argIdx++
	}
	if req.DriverContacted != nil {
		query += fmt.Sprintf(", driver_contacted = $%d", argIdx)
		args = append(args, *req.DriverContacted)
		argIdx++
	}
	if req.ReturnTrackingCode != nil {
		query += fmt.Sprintf(", return_tracking_code = $%d", argIdx)
		args = append(args, *req.ReturnTrackingCode)
		argIdx++
	}
	if req.ReturnMethod != nil {
		query += fmt.Sprintf(", return_method = $%d", argIdx)
		args = append(args, *req.ReturnMethod)
		argIdx++
	}
	if req.Notes != nil {
		query += fmt.Sprintf(", notes = $%d", argIdx)
		args = append(args, *req.Notes)
		argIdx++
	}

	query += fmt.Sprintf(" WHERE id = $%d", argIdx)
	args = append(args, id)

	_, err = tx.Exec(ctx, query, args...)
	if err != nil {
		h.logger.Printf("[SUPPORT_ERROR] Failed updating lost item: %v", err)
		http.Error(w, "database_update_failed", http.StatusInternalServerError)
		return
	}

	// If a status was updated and a ticket is linked, insert a system message note about the update
	if req.Status != "" && ticketID.Valid {
		updateText := fmt.Sprintf("Lost & Found Item status updated to %s.", req.Status)
		if req.ReturnTrackingCode != nil && *req.ReturnTrackingCode != "" {
			updateText += fmt.Sprintf(" Tracking details: %s via %s", *req.ReturnTrackingCode, *req.ReturnMethod)
		}
		_, _ = tx.Exec(ctx, `
			INSERT INTO ticket_messages (ticket_id, sender_id, sender_name, sender_type, message_type, content)
			VALUES ($1, '00000000-0000-0000-0000-000000000000', 'System', 'SYSTEM', 'CHAT', $2)
		`, ticketID.String, updateText)
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "transaction_commit_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"UPDATED"}`))
}

// HandleGetMacros retrieves all macros
func (h *SupportHandler) HandleGetMacros(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	rows, err := h.dbPool.Query(ctx, "SELECT shortcut_code, category, title, template_text, created_at, updated_at FROM support_macros ORDER BY shortcut_code ASC")
	if err != nil {
		h.logger.Printf("[SUPPORT_ERROR] Failed querying macros: %v", err)
		http.Error(w, "database_query_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	macros := make([]SupportMacro, 0)
	for rows.Next() {
		var macro SupportMacro
		err := rows.Scan(&macro.ShortcutCode, &macro.Category, &macro.Title, &macro.TemplateText, &macro.CreatedAt, &macro.UpdatedAt)
		if err == nil {
			macros = append(macros, macro)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(macros)
}

// HandleCreateMacro creates a support macro
func (h *SupportHandler) HandleCreateMacro(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ShortcutCode string `json:"shortcut_code"`
		Category     string `json:"category"`
		Title        string `json:"title"`
		TemplateText string `json:"template_text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ShortcutCode == "" || req.Category == "" || req.Title == "" || req.TemplateText == "" {
		http.Error(w, "invalid_macro_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	query := `
		INSERT INTO support_macros (shortcut_code, category, title, template_text)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (shortcut_code) DO UPDATE SET category = $2, title = $3, template_text = $4, updated_at = NOW()
	`
	_, err := h.dbPool.Exec(ctx, query, req.ShortcutCode, req.Category, req.Title, req.TemplateText)
	if err != nil {
		h.logger.Printf("[SUPPORT_ERROR] Failed inserting macro: %v", err)
		http.Error(w, "database_insert_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_, _ = w.Write([]byte(`{"status":"CREATED"}`))
}

// HandleGetFAQs retrieves FAQ articles
func (h *SupportHandler) HandleGetFAQs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	rows, err := h.dbPool.Query(ctx, "SELECT id, title, category, content, status, created_at, updated_at FROM faq_articles WHERE status = 'PUBLISHED' ORDER BY id ASC")
	if err != nil {
		h.logger.Printf("[SUPPORT_ERROR] Failed querying faqs: %v", err)
		http.Error(w, "database_query_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	faqs := make([]FAQArticle, 0)
	for rows.Next() {
		var faq FAQArticle
		err := rows.Scan(&faq.ID, &faq.Title, &faq.Category, &faq.Content, &faq.Status, &faq.CreatedAt, &faq.UpdatedAt)
		if err == nil {
			faqs = append(faqs, faq)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(faqs)
}

// HandleCreateFAQ creates an FAQ article
func (h *SupportHandler) HandleCreateFAQ(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Title    string `json:"title"`
		Category string `json:"category"`
		Content  string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Title == "" || req.Category == "" || req.Content == "" {
		http.Error(w, "invalid_faq_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	query := `INSERT INTO faq_articles (title, category, content, status) VALUES ($1, $2, $3, 'PUBLISHED') RETURNING id`
	var id int
	err := h.dbPool.QueryRow(ctx, query, req.Title, req.Category, req.Content).Scan(&id)
	if err != nil {
		h.logger.Printf("[SUPPORT_ERROR] Failed inserting faq: %v", err)
		http.Error(w, "database_insert_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_, _ = w.Write([]byte(fmt.Sprintf(`{"id":%d}`, id)))
}

// HandleGetSupportStats retrieves agent queue and performance numbers
func (h *SupportHandler) HandleGetSupportStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	agentID := r.URL.Query().Get("agent_id")
	if agentID == "" {
		// fallback to any seeded admin if no agent_id passed
		var idStr string
		_ = h.dbPool.QueryRow(ctx, "SELECT id::text FROM system_admins WHERE email = 'aniketkarmakar018@gmail.com' LIMIT 1").Scan(&idStr)
		agentID = idStr
	}

	var myQueueCount, breachedCount, resolvedToday, resolvedThisWeek int64
	var avgCSAT float64

	// My queue count
	_ = h.dbPool.QueryRow(ctx, "SELECT COUNT(*) FROM support_tickets WHERE assigned_agent_id = $1::uuid AND status IN ('OPEN', 'PENDING')", agentID).Scan(&myQueueCount)

	// Breached count
	_ = h.dbPool.QueryRow(ctx, "SELECT COUNT(*) FROM support_tickets WHERE assigned_agent_id = $1::uuid AND status IN ('OPEN', 'PENDING') AND sla_deadline < NOW()", agentID).Scan(&breachedCount)

	// Resolved Today
	_ = h.dbPool.QueryRow(ctx, "SELECT COUNT(*) FROM support_tickets WHERE assigned_agent_id = $1::uuid AND status = 'RESOLVED' AND updated_at >= CURRENT_DATE", agentID).Scan(&resolvedToday)

	// Resolved this week
	_ = h.dbPool.QueryRow(ctx, "SELECT COUNT(*) FROM support_tickets WHERE assigned_agent_id = $1::uuid AND status = 'RESOLVED' AND updated_at >= NOW() - INTERVAL '7 days'", agentID).Scan(&resolvedThisWeek)

	// Average CSAT
	err := h.dbPool.QueryRow(ctx, `
		SELECT COALESCE(AVG(c.rating), 0.0) 
		FROM ticket_csat c
		JOIN support_tickets t ON t.id = c.ticket_id
		WHERE t.assigned_agent_id = $1::uuid
	`, agentID).Scan(&avgCSAT)
	if err != nil {
		avgCSAT = 5.0 // default fallback
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"my_queue_count":     myQueueCount,
		"breached_count":     breachedCount,
		"resolved_today":     resolvedToday,
		"resolved_this_week": resolvedThisWeek,
		"average_csat":       avgCSAT,
	})
}

// HandleClickToCall triggers call integration mock and creates call recording logs
func (h *SupportHandler) HandleClickToCall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		TicketID  *string `json:"ticket_id"`
		Phone     string  `json:"phone"`
		AgentName string  `json:"agent_name"`
		AgentID   string  `json:"agent_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Phone == "" {
		http.Error(w, "invalid_phone_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	callID := fmt.Sprintf("REC-%d", (time.Now().UnixNano()/1000)%100000)
	duration := 85 // mock call duration in seconds

	if req.TicketID != nil && *req.TicketID != "" {
		// Append a call recording log as a message
		msgQuery := `
			INSERT INTO ticket_messages (ticket_id, sender_id, sender_name, sender_type, message_type, content)
			VALUES ($1, $2::uuid, $3, 'AGENT', 'CALL_NOTE', $4)
		`
		content := fmt.Sprintf("Outbound Call Completed.\nRecipient: %s\nDuration: %d seconds\nCall ID: %s (recording attached)", req.Phone, duration, callID)
		senderID := req.AgentID
		if senderID == "" {
			senderID = "00000000-0000-0000-0000-000000000000"
		}
		_, err := h.dbPool.Exec(ctx, msgQuery, *req.TicketID, senderID, req.AgentName, content)
		if err != nil {
			h.logger.Printf("[SUPPORT_ERROR] Failed logging call recording message: %v", err)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(fmt.Sprintf(`{"status":"CALL_COMPLETED","call_id":"%s","duration_seconds":%d}`, callID, duration)))
}
