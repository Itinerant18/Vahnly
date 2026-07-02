package http

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SupportHandler serves the rider support-ticket API, scoped to
// creator_type='RIDER' on the shared support_tickets / ticket_messages tables.
type SupportHandler struct {
	db     *pgxpool.Pool
	logger *log.Logger
}

func NewSupportHandler(db *pgxpool.Pool, logger *log.Logger) *SupportHandler {
	return &SupportHandler{db: db, logger: logger}
}

func (h *SupportHandler) internal(w http.ResponseWriter, err error) {
	if h.logger != nil {
		h.logger.Printf("[RIDER_SUPPORT] internal error: %v", err)
	}
	writeError(w, http.StatusInternalServerError, "internal server error", "ERR_INTERNAL")
}

// riderSupportCategories mirrors the support_tickets category CHECK allow-list;
// anything else is normalized to OTHER.
var riderSupportCategories = map[string]bool{
	"TRIP": true, "PAYMENT": true, "DRIVER_BEHAVIOR": true, "LOST_ITEM": true,
	"ACCOUNT": true, "SAFETY": true, "OTHER": true, "VEHICLE": true,
}

type supportTicketMessage struct {
	ID        string    `json:"id"`
	TicketID  string    `json:"ticket_id"`
	Sender    string    `json:"sender"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"created_at"`
}

type supportTicket struct {
	ID        string                 `json:"id"`
	Subject   string                 `json:"subject"`
	Category  string                 `json:"category"`
	Status    string                 `json:"status"`
	OrderID   *string                `json:"order_id,omitempty"`
	UserType  string                 `json:"user_type,omitempty"`
	CreatedAt time.Time              `json:"created_at"`
	Messages  []supportTicketMessage `json:"messages,omitempty"`
}

// mapSenderType projects DB sender_type onto the frontend RIDER|AGENT contract.
func mapSenderType(t string) string {
	if t == "USER" {
		return "RIDER"
	}
	return "AGENT"
}

// riderContact fetches the rider's display name + phone for the ticket creator fields.
func (h *SupportHandler) riderContact(ctx context.Context, riderID string) (name, phone string) {
	var n *string
	_ = h.db.QueryRow(ctx, `SELECT name, phone FROM riders WHERE id = $1::uuid`, riderID).Scan(&n, &phone)
	if n != nil {
		name = *n
	}
	if name == "" {
		name = "Rider"
	}
	return name, phone
}

type createTicketRequest struct {
	Category string `json:"category"`
	Subject  string `json:"subject"`
	Message  string `json:"message"`
	OrderID  string `json:"order_id"`
}

func (h *SupportHandler) HandleCreateTicket(w http.ResponseWriter, r *http.Request) {
	riderID, ok := riderIDFromContext(w, r)
	if !ok {
		return
	}
	var req createTicketRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", "ERR_BAD_REQUEST")
		return
	}
	if strings.TrimSpace(req.Subject) == "" || strings.TrimSpace(req.Message) == "" {
		writeError(w, http.StatusBadRequest, "subject and message are required", "ERR_VALIDATION")
		return
	}
	category := strings.ToUpper(strings.TrimSpace(req.Category))
	if !riderSupportCategories[category] {
		category = "OTHER"
	}
	var orderID *string
	if strings.TrimSpace(req.OrderID) != "" {
		o := req.OrderID
		orderID = &o
	}

	ctx := r.Context()
	name, phone := h.riderContact(ctx, riderID)
	if phone == "" {
		phone = "N/A"
	}
	sla := time.Now().Add(24 * time.Hour)

	var ticketID string
	var created bool
	for attempt := 0; attempt < 4; attempt++ {
		ticketID = "DFU-" + strings.ToUpper(uuid.NewString()[0:5])
		_, err := h.db.Exec(ctx, `
			INSERT INTO support_tickets
				(id, creator_id, creator_type, creator_name, creator_phone, channel, subject, description,
				 priority, status, category, tags, sla_deadline, linked_trip_id, created_at, updated_at)
			VALUES ($1, $2::uuid, 'RIDER', $3, $4, 'CHAT', $5, $6, 'MEDIUM', 'OPEN', $7, '{}', $8, $9::uuid, NOW(), NOW())`,
			ticketID, riderID, name, phone, req.Subject, req.Message, category, sla, orderID)
		if err == nil {
			created = true
			break
		}
		// Retry only on PK collision; surface anything else.
		if !strings.Contains(strings.ToLower(err.Error()), "duplicate") {
			h.internal(w, err)
			return
		}
	}
	if !created {
		h.internal(w, errors.New("could not allocate ticket id"))
		return
	}

	// Seed the thread with the opening message (sender_type USER satisfies the CHECK).
	// The ticket row exists either way; losing the rider's complaint text silently
	// would leave an empty thread, so at least log the failure.
	if _, mErr := h.db.Exec(ctx, `
		INSERT INTO ticket_messages (ticket_id, sender_id, sender_name, sender_type, message_type, content, created_at)
		VALUES ($1, $2::uuid, $3, 'USER', 'CHAT', $4, NOW())`,
		ticketID, riderID, name, req.Message); mErr != nil && h.logger != nil {
		h.logger.Printf("[RIDER_SUPPORT] ticket %s created but opening message insert failed: %v", ticketID, mErr)
	}

	writeData(w, http.StatusCreated, supportTicket{
		ID: ticketID, Subject: req.Subject, Category: category, Status: "OPEN",
		OrderID: orderID, UserType: "RIDER", CreatedAt: time.Now().UTC(),
	})
}

func (h *SupportHandler) HandleListTickets(w http.ResponseWriter, r *http.Request) {
	riderID, ok := riderIDFromContext(w, r)
	if !ok {
		return
	}
	rows, err := h.db.Query(r.Context(), `
		SELECT id, subject, category, status, linked_trip_id::text, created_at
		FROM support_tickets
		WHERE creator_id = $1::uuid AND creator_type = 'RIDER'
		ORDER BY created_at DESC`, riderID)
	if err != nil {
		h.internal(w, err)
		return
	}
	defer rows.Close()

	tickets := make([]supportTicket, 0)
	for rows.Next() {
		var t supportTicket
		var orderID *string
		if err := rows.Scan(&t.ID, &t.Subject, &t.Category, &t.Status, &orderID, &t.CreatedAt); err != nil {
			h.internal(w, err)
			return
		}
		t.OrderID = orderID
		t.UserType = "RIDER"
		tickets = append(tickets, t)
	}
	if err := rows.Err(); err != nil {
		h.internal(w, err)
		return
	}
	writeData(w, http.StatusOK, tickets)
}

func (h *SupportHandler) HandleGetTicket(w http.ResponseWriter, r *http.Request) {
	riderID, ok := riderIDFromContext(w, r)
	if !ok {
		return
	}
	ticketID := r.PathValue("id")
	ctx := r.Context()

	var t supportTicket
	var orderID *string
	err := h.db.QueryRow(ctx, `
		SELECT id, subject, category, status, linked_trip_id::text, created_at
		FROM support_tickets
		WHERE id = $1 AND creator_id = $2::uuid AND creator_type = 'RIDER'`,
		ticketID, riderID).Scan(&t.ID, &t.Subject, &t.Category, &t.Status, &orderID, &t.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "ticket not found", "ERR_NOT_FOUND")
		return
	}
	if err != nil {
		h.internal(w, err)
		return
	}
	t.OrderID = orderID
	t.UserType = "RIDER"

	messages := make([]supportTicketMessage, 0)
	rows, qerr := h.db.Query(ctx, `
		SELECT id::text, sender_type, COALESCE(content, ''), created_at
		FROM ticket_messages WHERE ticket_id = $1 ORDER BY created_at ASC`, ticketID)
	if qerr != nil {
		// A failed messages query must not masquerade as an empty thread.
		h.internal(w, qerr)
		return
	}
	{
		defer rows.Close()
		for rows.Next() {
			var m supportTicketMessage
			var senderType string
			if err := rows.Scan(&m.ID, &senderType, &m.Body, &m.CreatedAt); err != nil {
				h.internal(w, err)
				return
			}
			m.TicketID = ticketID
			m.Sender = mapSenderType(senderType)
			messages = append(messages, m)
		}
	}
	t.Messages = messages
	writeData(w, http.StatusOK, t)
}

type replyTicketRequest struct {
	Message string `json:"message"`
}

func (h *SupportHandler) HandleReplyTicket(w http.ResponseWriter, r *http.Request) {
	riderID, ok := riderIDFromContext(w, r)
	if !ok {
		return
	}
	ticketID := r.PathValue("id")
	var req replyTicketRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", "ERR_BAD_REQUEST")
		return
	}
	if strings.TrimSpace(req.Message) == "" {
		writeError(w, http.StatusBadRequest, "message is required", "ERR_VALIDATION")
		return
	}
	ctx := r.Context()

	var owned bool
	var name *string
	if err := h.db.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM support_tickets WHERE id = $1 AND creator_id = $2::uuid AND creator_type = 'RIDER'),
		       (SELECT name FROM riders WHERE id = $2::uuid)`,
		ticketID, riderID).Scan(&owned, &name); err != nil {
		// A DB outage must surface as 500, not "ticket not found".
		h.internal(w, err)
		return
	}
	if !owned {
		writeError(w, http.StatusNotFound, "ticket not found", "ERR_NOT_FOUND")
		return
	}
	senderName := "Rider"
	if name != nil && *name != "" {
		senderName = *name
	}
	if _, err := h.db.Exec(ctx, `
		INSERT INTO ticket_messages (ticket_id, sender_id, sender_name, sender_type, message_type, content, created_at)
		VALUES ($1, $2::uuid, $3, 'USER', 'CHAT', $4, NOW())`,
		ticketID, riderID, senderName, req.Message); err != nil {
		h.internal(w, err)
		return
	}
	_, _ = h.db.Exec(ctx, `UPDATE support_tickets SET updated_at = NOW() WHERE id = $1`, ticketID)
	writeData(w, http.StatusOK, map[string]any{"message": "reply added"})
}
