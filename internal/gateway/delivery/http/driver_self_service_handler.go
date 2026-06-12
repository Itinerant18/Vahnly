package http

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"
	"golang.org/x/crypto/bcrypt"

	"github.com/platform/driver-delivery/internal/gateway/middleware"
	"github.com/platform/driver-delivery/internal/storage/objectstore"
)

// DriverSelfServiceHandler backs the driver Vehicle-management, Support and
// Settings screens. Every endpoint is scoped to the authenticated driver via
// requireDriverIdentity — identity comes from the verified JWT, never a header.
type DriverSelfServiceHandler struct {
	dbPool        *pgxpool.Pool
	redis         *redis.ClusterClient
	store         *objectstore.S3Store
	supportWriter *kafka.Writer
	logger        *log.Logger
}

func NewDriverSelfServiceHandler(dbPool *pgxpool.Pool, rc *redis.ClusterClient, store *objectstore.S3Store, supportWriter *kafka.Writer, logger *log.Logger) *DriverSelfServiceHandler {
	return &DriverSelfServiceHandler{dbPool: dbPool, redis: rc, store: store, supportWriter: supportWriter, logger: logger}
}

var activeTripStatuses = []string{"ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_AT_PICKUP", "DELIVERING"}

// uploadDriverFile persists an uploaded file to object storage (durable) or local
// disk (dev fallback), mirroring the onboarding upload path. Returns the public URL.
func (h *DriverSelfServiceHandler) uploadDriverFile(ctx context.Context, prefix string, file io.Reader, filename, contentType string) (string, error) {
	base := filepath.Base(strings.ReplaceAll(filename, "\\", "/"))
	safe := fmt.Sprintf("%s-%s", uuid.NewString(), strings.ReplaceAll(base, " ", "_"))
	if h.store != nil && h.store.Enabled() {
		data, err := io.ReadAll(file)
		if err != nil {
			return "", err
		}
		putCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		defer cancel()
		return h.store.PutObject(putCtx, fmt.Sprintf("%s/%s", prefix, safe), data, contentType)
	}
	dir := filepath.Join("public/uploads", prefix)
	_ = os.MkdirAll(dir, os.ModePerm)
	out, err := os.Create(filepath.Join(dir, safe))
	if err != nil {
		return "", err
	}
	defer out.Close()
	if _, err := io.Copy(out, file); err != nil {
		return "", err
	}
	return "/uploads/" + prefix + "/" + safe, nil
}

// ─── Vehicle Management ───────────────────────────────────────────────────────

type vehicleDoc struct {
	DocumentType string  `json:"document_type"`
	StorageURL   string  `json:"storage_url"`
	ExpiryDate   *string `json:"expiry_date"`
	Status       string  `json:"status"` // VALID | EXPIRING | EXPIRED | MISSING
}

type vehicleItem struct {
	ID           string       `json:"id"`
	Make         string       `json:"make"`
	Model        string       `json:"model"`
	Year         int          `json:"year"`
	Plate        string       `json:"plate"`
	FuelType     string       `json:"fuel_type"`
	CarType      string       `json:"car_type"`
	Transmission string       `json:"transmission"`
	Documents    []vehicleDoc `json:"documents"`
}

// docStatus derives a slot status from the expiry date (≤30 days = EXPIRING).
func docStatus(expiry *time.Time) string {
	if expiry == nil {
		return "VALID" // submitted without an expiry — treat as on file
	}
	now := time.Now()
	if expiry.Before(now) {
		return "EXPIRED"
	}
	if expiry.Before(now.AddDate(0, 0, 30)) {
		return "EXPIRING"
	}
	return "VALID"
}

// GET /api/v1/driver/vehicles
func (h *DriverSelfServiceHandler) ListVehicles(w http.ResponseWriter, r *http.Request) {
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	rows, err := h.dbPool.Query(ctx, `
		SELECT id::text, make, model, COALESCE(year, 0), COALESCE(fuel_type, ''),
		       COALESCE(car_type, ''), license_plate, transmission
		FROM driver_vehicles WHERE driver_id = $1::uuid AND is_active ORDER BY created_at DESC
	`, driverID)
	if err != nil {
		http.Error(w, "vehicles_query_failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	vehicles := make([]vehicleItem, 0)
	for rows.Next() {
		var v vehicleItem
		if rows.Scan(&v.ID, &v.Make, &v.Model, &v.Year, &v.FuelType, &v.CarType, &v.Plate, &v.Transmission) == nil {
			vehicles = append(vehicles, v)
		}
	}
	rows.Close()

	// Attach the RC / INSURANCE / PUC slots for each vehicle.
	for i := range vehicles {
		byType := map[string]vehicleDoc{}
		drows, derr := h.dbPool.Query(ctx, `
			SELECT document_type, storage_url, expiry_date FROM vehicle_documents WHERE vehicle_id = $1::uuid
		`, vehicles[i].ID)
		if derr == nil {
			for drows.Next() {
				var dt, url string
				var exp *time.Time
				if drows.Scan(&dt, &url, &exp) == nil {
					var expStr *string
					if exp != nil {
						s := exp.Format("2006-01-02")
						expStr = &s
					}
					byType[dt] = vehicleDoc{DocumentType: dt, StorageURL: url, ExpiryDate: expStr, Status: docStatus(exp)}
				}
			}
			drows.Close()
		}
		slots := make([]vehicleDoc, 0, 3)
		for _, t := range []string{"RC", "INSURANCE", "PUC"} {
			if d, present := byType[t]; present {
				slots = append(slots, d)
			} else {
				slots = append(slots, vehicleDoc{DocumentType: t, Status: "MISSING"})
			}
		}
		vehicles[i].Documents = slots
	}

	writeJSONResponse(w, http.StatusOK, map[string]any{"vehicles": vehicles})
}

// POST /api/v1/driver/vehicles
func (h *DriverSelfServiceHandler) CreateVehicle(w http.ResponseWriter, r *http.Request) {
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}
	var req struct {
		Make         string `json:"make"`
		Model        string `json:"model"`
		Year         int    `json:"year"`
		Plate        string `json:"plate"`
		FuelType     string `json:"fuel_type"`
		CarType      string `json:"car_type"`
		Transmission string `json:"transmission"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(req.Make) == "" || strings.TrimSpace(req.Model) == "" || strings.TrimSpace(req.Plate) == "" {
		http.Error(w, "make_model_plate_required", http.StatusBadRequest)
		return
	}
	if req.Transmission == "" {
		req.Transmission = "MANUAL"
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	var id string
	err := h.dbPool.QueryRow(ctx, `
		INSERT INTO driver_vehicles (driver_id, make, model, year, fuel_type, car_type, license_plate, transmission, is_active)
		VALUES ($1::uuid, $2, $3, $4, $5, $6, UPPER($7), UPPER($8), true)
		RETURNING id::text
	`, driverID, req.Make, req.Model, req.Year, req.FuelType, strings.ToUpper(req.CarType), strings.TrimSpace(req.Plate), req.Transmission).Scan(&id)
	if err != nil {
		http.Error(w, "vehicle_insert_failed", http.StatusInternalServerError)
		return
	}
	writeJSONResponse(w, http.StatusCreated, vehicleItem{
		ID: id, Make: req.Make, Model: req.Model, Year: req.Year, Plate: strings.ToUpper(req.Plate),
		FuelType: req.FuelType, CarType: strings.ToUpper(req.CarType), Transmission: req.Transmission,
		Documents: []vehicleDoc{
			{DocumentType: "RC", Status: "MISSING"},
			{DocumentType: "INSURANCE", Status: "MISSING"},
			{DocumentType: "PUC", Status: "MISSING"},
		},
	})
}

var vehicleDocCol = map[string]string{"RC": "rc_status", "INSURANCE": "insurance_status", "PUC": "puc_status"}

// POST /api/v1/driver/vehicles/{id}/documents  (multipart: document_type, file, expiry_date)
func (h *DriverSelfServiceHandler) UploadVehicleDocument(w http.ResponseWriter, r *http.Request) {
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}
	vehicleID := r.PathValue("id")
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		http.Error(w, "file_too_large", http.StatusBadRequest)
		return
	}
	docType := strings.ToUpper(r.FormValue("document_type"))
	if _, valid := vehicleDocCol[docType]; !valid {
		http.Error(w, "invalid_document_type", http.StatusBadRequest)
		return
	}
	var expiry *time.Time
	if e := r.FormValue("expiry_date"); e != "" {
		if t, err := time.Parse("2006-01-02", e); err == nil {
			expiry = &t
		}
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "missing_file", http.StatusBadRequest)
		return
	}
	defer file.Close()

	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()

	// Ownership check — the vehicle must belong to the authenticated driver.
	var owned bool
	_ = h.dbPool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM driver_vehicles WHERE id = $1::uuid AND driver_id = $2::uuid AND is_active)`, vehicleID, driverID).Scan(&owned)
	if !owned {
		http.Error(w, "vehicle_not_found", http.StatusNotFound)
		return
	}

	url, uerr := h.uploadDriverFile(ctx, "vehicle-docs/"+vehicleID, file, header.Filename, header.Header.Get("Content-Type"))
	if uerr != nil {
		http.Error(w, "upload_failed", http.StatusBadGateway)
		return
	}

	tx, terr := h.dbPool.Begin(ctx)
	if terr != nil {
		http.Error(w, "tx_failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)
	// One document per (vehicle, type): replace any prior upload.
	_, _ = tx.Exec(ctx, `DELETE FROM vehicle_documents WHERE vehicle_id = $1::uuid AND document_type = $2`, vehicleID, docType)
	if _, err := tx.Exec(ctx, `
		INSERT INTO vehicle_documents (vehicle_id, document_type, storage_url, expiry_date, status)
		VALUES ($1::uuid, $2, $3, $4, 'SUBMITTED')
	`, vehicleID, docType, url, expiry); err != nil {
		http.Error(w, "document_insert_failed", http.StatusInternalServerError)
		return
	}
	_, _ = tx.Exec(ctx, fmt.Sprintf("UPDATE driver_vehicles SET %s = 'SUBMITTED', updated_at = NOW() WHERE id = $1::uuid", vehicleDocCol[docType]), vehicleID)
	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "commit_failed", http.StatusInternalServerError)
		return
	}

	var expStr *string
	if expiry != nil {
		s := expiry.Format("2006-01-02")
		expStr = &s
	}
	writeJSONResponse(w, http.StatusOK, vehicleDoc{DocumentType: docType, StorageURL: url, ExpiryDate: expStr, Status: docStatus(expiry)})
}

// DELETE /api/v1/driver/vehicles/{id}  (soft delete; blocked during an active trip)
func (h *DriverSelfServiceHandler) DeleteVehicle(w http.ResponseWriter, r *http.Request) {
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}
	vehicleID := r.PathValue("id")
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	var activeTrips int
	_ = h.dbPool.QueryRow(ctx, `
		SELECT COUNT(*) FROM orders WHERE assigned_driver_id = $1::uuid AND status = ANY($2)
	`, driverID, activeTripStatuses).Scan(&activeTrips)
	if activeTrips > 0 {
		http.Error(w, "cannot_delete_during_active_trip", http.StatusConflict)
		return
	}

	res, err := h.dbPool.Exec(ctx, `UPDATE driver_vehicles SET is_active = false, updated_at = NOW() WHERE id = $1::uuid AND driver_id = $2::uuid`, vehicleID, driverID)
	if err != nil {
		http.Error(w, "delete_failed", http.StatusInternalServerError)
		return
	}
	if res.RowsAffected() == 0 {
		http.Error(w, "vehicle_not_found", http.StatusNotFound)
		return
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{"status": "DELETED"})
}

// ─── Support ──────────────────────────────────────────────────────────────────

var supportCategories = map[string]bool{"TRIP": true, "PAYMENT": true, "ACCOUNT": true, "SAFETY": true, "OTHER": true, "VEHICLE": true}

// POST /api/v1/driver/support/tickets
func (h *DriverSelfServiceHandler) CreateTicket(w http.ResponseWriter, r *http.Request) {
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}
	var req struct {
		Category    string   `json:"category"`
		Subject     string   `json:"subject"`
		Description string   `json:"description"`
		OrderID     string   `json:"order_id"`
		Attachments []string `json:"attachments"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}
	req.Category = strings.ToUpper(strings.TrimSpace(req.Category))
	if !supportCategories[req.Category] {
		http.Error(w, "invalid_category", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(req.Subject) == "" || strings.TrimSpace(req.Description) == "" {
		http.Error(w, "subject_and_description_required", http.StatusBadRequest)
		return
	}
	if req.Attachments == nil {
		req.Attachments = []string{}
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	var name string
	var phone *string
	_ = h.dbPool.QueryRow(ctx, `SELECT name, phone FROM drivers WHERE id = $1::uuid`, driverID).Scan(&name, &phone)
	if name == "" {
		name = "Driver"
	}
	phoneStr := ""
	if phone != nil {
		phoneStr = *phone
	}

	// SAFETY tickets are URGENT with a tight SLA.
	priority, sla := "MEDIUM", time.Now().Add(24*time.Hour)
	if req.Category == "SAFETY" {
		priority, sla = "URGENT", time.Now().Add(time.Hour)
	}

	var orderID *string
	if s := strings.TrimSpace(req.OrderID); s != "" {
		orderID = &s
	}

	// Generate a human ticket number (DFU-XXXXX); retry on the rare PK collision.
	var ticketID string
	for attempt := 0; attempt < 4; attempt++ {
		ticketID = "DFU-" + strings.ToUpper(uuid.NewString()[0:5])
		_, err := h.dbPool.Exec(ctx, `
			INSERT INTO support_tickets
				(id, creator_id, creator_type, creator_name, creator_phone, channel, subject, description,
				 priority, status, category, tags, sla_deadline, linked_trip_id, attachments, created_at, updated_at)
			VALUES ($1, $2::uuid, 'DRIVER', $3, $4, 'CHAT', $5, $6, $7, 'OPEN', $8, '{}', $9, $10::uuid, $11, NOW(), NOW())
		`, ticketID, driverID, name, phoneStr, req.Subject, req.Description, priority, req.Category, sla, orderID, req.Attachments)
		if err == nil {
			break
		}
		if attempt == 3 {
			h.logger.Printf("[SUPPORT] ticket insert failed: %v", err)
			http.Error(w, "ticket_insert_failed", http.StatusInternalServerError)
			return
		}
	}

	// Seed the thread with the opening message.
	_, _ = h.dbPool.Exec(ctx, `
		INSERT INTO ticket_messages (ticket_id, sender_id, sender_name, sender_type, message_type, content, attachment_urls, created_at)
		VALUES ($1, $2::uuid, $3, 'DRIVER', 'TEXT', $4, $5, NOW())
	`, ticketID, driverID, name, req.Description, req.Attachments)

	if h.supportWriter != nil {
		evt, _ := json.Marshal(map[string]any{"ticket_number": ticketID, "creator_id": driverID, "category": req.Category, "priority": priority})
		if werr := h.supportWriter.WriteMessages(ctx, kafka.Message{Key: []byte(ticketID), Value: evt}); werr != nil {
			h.logger.Printf("[SUPPORT] kafka publish failed: %v", werr)
		}
	}

	writeJSONResponse(w, http.StatusCreated, map[string]any{"ticket_number": ticketID, "status": "OPEN", "priority": priority})
}

// POST /api/v1/driver/support/attachments  (multipart: file) → { url }
// Stored under the support-attachments prefix (S3_BUCKET_SUPPORT_ATTACHMENTS in a
// dedicated-bucket deployment; here the shared bucket + prefix in dev).
func (h *DriverSelfServiceHandler) UploadSupportAttachment(w http.ResponseWriter, r *http.Request) {
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		http.Error(w, "file_too_large", http.StatusBadRequest)
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "missing_file", http.StatusBadRequest)
		return
	}
	defer file.Close()
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	url, uerr := h.uploadDriverFile(ctx, "support-attachments/"+driverID, file, header.Filename, header.Header.Get("Content-Type"))
	if uerr != nil {
		http.Error(w, "upload_failed", http.StatusBadGateway)
		return
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{"url": url})
}

type ticketListItem struct {
	TicketNumber string    `json:"ticket_number"`
	Category     string    `json:"category"`
	Subject      string    `json:"subject"`
	Status       string    `json:"status"`
	Priority     string    `json:"priority"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// GET /api/v1/driver/support/tickets?limit=&offset=
func (h *DriverSelfServiceHandler) ListTickets(w http.ResponseWriter, r *http.Request) {
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}
	limit := 20
	if n, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && n > 0 && n <= 100 {
		limit = n
	}
	offset := 0
	if n, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil && n >= 0 {
		offset = n
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	rows, err := h.dbPool.Query(ctx, `
		SELECT id, category, subject, status, priority, created_at, updated_at
		FROM support_tickets WHERE creator_id = $1::uuid AND creator_type = 'DRIVER'
		ORDER BY created_at DESC LIMIT $2 OFFSET $3
	`, driverID, limit, offset)
	if err != nil {
		http.Error(w, "tickets_query_failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	list := make([]ticketListItem, 0)
	for rows.Next() {
		var t ticketListItem
		if rows.Scan(&t.TicketNumber, &t.Category, &t.Subject, &t.Status, &t.Priority, &t.CreatedAt, &t.UpdatedAt) == nil {
			list = append(list, t)
		}
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{"tickets": list, "limit": limit, "offset": offset})
}

type ticketMessage struct {
	SenderType     string    `json:"sender_type"`
	SenderName     string    `json:"sender_name"`
	Content        string    `json:"content"`
	AttachmentURLs []string  `json:"attachment_urls"`
	CreatedAt      time.Time `json:"created_at"`
}

// GET /api/v1/driver/support/tickets/{id}
func (h *DriverSelfServiceHandler) GetTicket(w http.ResponseWriter, r *http.Request) {
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}
	ticketID := r.PathValue("id")
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	var t ticketListItem
	var desc string
	err := h.dbPool.QueryRow(ctx, `
		SELECT id, category, subject, status, priority, created_at, updated_at, description
		FROM support_tickets WHERE id = $1 AND creator_id = $2::uuid AND creator_type = 'DRIVER'
	`, ticketID, driverID).Scan(&t.TicketNumber, &t.Category, &t.Subject, &t.Status, &t.Priority, &t.CreatedAt, &t.UpdatedAt, &desc)
	if err == pgx.ErrNoRows {
		http.Error(w, "ticket_not_found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "ticket_query_failed", http.StatusInternalServerError)
		return
	}

	messages := make([]ticketMessage, 0)
	if rows, qerr := h.dbPool.Query(ctx, `
		SELECT sender_type, COALESCE(sender_name, ''), content, COALESCE(attachment_urls, '{}'), created_at
		FROM ticket_messages WHERE ticket_id = $1 ORDER BY created_at ASC
	`, ticketID); qerr == nil {
		defer rows.Close()
		for rows.Next() {
			var m ticketMessage
			if rows.Scan(&m.SenderType, &m.SenderName, &m.Content, &m.AttachmentURLs, &m.CreatedAt) == nil {
				messages = append(messages, m)
			}
		}
	}

	writeJSONResponse(w, http.StatusOK, map[string]any{"ticket": t, "description": desc, "messages": messages})
}

// POST /api/v1/driver/support/tickets/{id}/reply
func (h *DriverSelfServiceHandler) ReplyTicket(w http.ResponseWriter, r *http.Request) {
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}
	ticketID := r.PathValue("id")
	var req struct {
		Message     string   `json:"message"`
		Attachments []string `json:"attachments"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Message) == "" {
		http.Error(w, "message_required", http.StatusBadRequest)
		return
	}
	if req.Attachments == nil {
		req.Attachments = []string{}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	var name string
	var owned bool
	_ = h.dbPool.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM support_tickets WHERE id = $1 AND creator_id = $2::uuid AND creator_type = 'DRIVER'),
		       (SELECT name FROM drivers WHERE id = $2::uuid)
	`, ticketID, driverID).Scan(&owned, &name)
	if !owned {
		http.Error(w, "ticket_not_found", http.StatusNotFound)
		return
	}
	if _, err := h.dbPool.Exec(ctx, `
		INSERT INTO ticket_messages (ticket_id, sender_id, sender_name, sender_type, message_type, content, attachment_urls, created_at)
		VALUES ($1, $2::uuid, $3, 'DRIVER', 'TEXT', $4, $5, NOW())
	`, ticketID, driverID, name, req.Message, req.Attachments); err != nil {
		http.Error(w, "reply_insert_failed", http.StatusInternalServerError)
		return
	}
	_, _ = h.dbPool.Exec(ctx, `UPDATE support_tickets SET updated_at = NOW() WHERE id = $1`, ticketID)
	writeJSONResponse(w, http.StatusOK, map[string]any{"status": "SENT"})
}

// ─── Settings ─────────────────────────────────────────────────────────────────

// PATCH /api/v1/driver/notifications/preferences
func (h *DriverSelfServiceHandler) UpdateNotificationPrefs(w http.ResponseWriter, r *http.Request) {
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}
	var req struct {
		TripOffers bool `json:"trip_offers"`
		Earnings   bool `json:"earnings"`
		Promotions bool `json:"promotions"`
		Safety     bool `json:"safety"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}
	prefs, _ := json.Marshal(req)
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if _, err := h.dbPool.Exec(ctx, `UPDATE drivers SET notification_prefs = $1::jsonb, updated_at = NOW() WHERE id = $2::uuid`, string(prefs), driverID); err != nil {
		http.Error(w, "prefs_update_failed", http.StatusInternalServerError)
		return
	}
	writeJSONResponse(w, http.StatusOK, json.RawMessage(prefs))
}

// PATCH /api/v1/driver/profile/language
func (h *DriverSelfServiceHandler) UpdateLanguage(w http.ResponseWriter, r *http.Request) {
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}
	var req struct {
		Language string `json:"language"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}
	lang := strings.ToLower(strings.TrimSpace(req.Language))
	if lang != "en" && lang != "hi" && lang != "bn" {
		http.Error(w, "unsupported_language", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if _, err := h.dbPool.Exec(ctx, `UPDATE drivers SET preferred_language = $1, updated_at = NOW() WHERE id = $2::uuid`, lang, driverID); err != nil {
		http.Error(w, "language_update_failed", http.StatusInternalServerError)
		return
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{"preferred_language": lang})
}

// POST /api/v1/driver/auth/change-password
func (h *DriverSelfServiceHandler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}
	var req struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}
	if len(req.NewPassword) < 8 {
		http.Error(w, "new_password_too_short", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	var hash string
	if err := h.dbPool.QueryRow(ctx, `SELECT COALESCE(password_hash, '') FROM drivers WHERE id = $1::uuid`, driverID).Scan(&hash); err != nil {
		http.Error(w, "driver_not_found", http.StatusNotFound)
		return
	}
	if hash == "" || bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.CurrentPassword)) != nil {
		http.Error(w, "current_password_incorrect", http.StatusUnauthorized)
		return
	}
	newHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		http.Error(w, "hash_failed", http.StatusInternalServerError)
		return
	}
	if _, err := h.dbPool.Exec(ctx, `UPDATE drivers SET password_hash = $1, updated_at = NOW() WHERE id = $2::uuid`, string(newHash), driverID); err != nil {
		http.Error(w, "password_update_failed", http.StatusInternalServerError)
		return
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{"status": "PASSWORD_CHANGED"})
}

// DELETE /api/v1/driver/account
// Soft delete: anonymize PII, keep financial records, revoke the session. Blocked
// while the driver has an active trip or pending order.
func (h *DriverSelfServiceHandler) DeleteAccount(w http.ResponseWriter, r *http.Request) {
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var activeTrips int
	_ = h.dbPool.QueryRow(ctx, `SELECT COUNT(*) FROM orders WHERE assigned_driver_id = $1::uuid AND status = ANY($2)`, driverID, activeTripStatuses).Scan(&activeTrips)
	if activeTrips > 0 {
		http.Error(w, "active_trip_in_progress", http.StatusConflict)
		return
	}

	// Anonymize PII; financial_ledger_entries / payout_requests are retained for audit.
	if _, err := h.dbPool.Exec(ctx, `
		UPDATE drivers
		SET name = 'Deleted Driver',
		    email = NULL,
		    phone = NULL,
		    dl_number = NULL,
		    bank_name = NULL,
		    bank_account_number = NULL,
		    bank_ifsc = NULL,
		    account_status = 'DELETED',
		    deleted_at = NOW(),
		    updated_at = NOW()
		WHERE id = $1::uuid
	`, driverID); err != nil {
		http.Error(w, "account_delete_failed", http.StatusInternalServerError)
		return
	}
	// Revoke the active login session so outstanding tokens stop working.
	if h.redis != nil {
		_ = h.redis.Del(ctx, middleware.DriverSessionKey(driverID)).Err()
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{"status": "ACCOUNT_DELETED"})
}
