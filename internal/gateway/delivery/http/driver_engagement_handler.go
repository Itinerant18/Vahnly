package http

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DriverEngagementHandler backs the driver-account Incentives, Performance,
// Notifications, Profile and Referrals screens. Every endpoint is scoped to the
// authenticated driver via requireDriverIdentity — identity comes from the
// verified JWT, never a client header. Money values are paise integers.
type DriverEngagementHandler struct {
	dbPool *pgxpool.Pool
}

func NewDriverEngagementHandler(dbPool *pgxpool.Pool) *DriverEngagementHandler {
	return &DriverEngagementHandler{dbPool: dbPool}
}

// referralCodeFor derives a stable, human-readable referral code from the driver
// UUID. Deterministic (no randomness), uppercase, 8 chars — the same scheme used
// elsewhere for short codes (riders.referral_code VARCHAR(8)).
func referralCodeFor(driverID string) string {
	clean := strings.ToUpper(strings.ReplaceAll(driverID, "-", ""))
	if len(clean) >= 8 {
		return "DRV" + clean[:5]
	}
	return "DRV" + clean
}

// ─── Incentives ────────────────────────────────────────────────────────────────

type questItem struct {
	Title     string `json:"title"`
	Desc      string `json:"desc"`
	Completed int    `json:"completed"`
	Total     int    `json:"total"`
	Reward    int    `json:"reward"` // rupees (matches the page's +₹{reward} render)
	Expiry    string `json:"expiry"`
}

type surgeZoneItem struct {
	Zone       string `json:"zone"`
	Multiplier string `json:"multiplier"`
}

// GET /api/v1/driver/incentives
// Quest progress is computed from the driver's COMPLETED order counts (today and
// this calendar week). Referral code is derived from the driver id. Surge zones
// come from manual_surge_zones when present, else a small sensible static set.
func (h *DriverEngagementHandler) GetIncentives(w http.ResponseWriter, r *http.Request) {
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	var tripsToday, tripsWeek int
	_ = h.dbPool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE status = 'COMPLETED' AND completed_at >= date_trunc('day', NOW())),
			COUNT(*) FILTER (WHERE status = 'COMPLETED' AND completed_at >= date_trunc('week', NOW()))
		FROM orders
		WHERE assigned_driver_id = $1::uuid
	`, driverID).Scan(&tripsToday, &tripsWeek)

	quests := []questItem{
		{
			Title:     "Daily Dash",
			Desc:      "Complete 10 trips today to earn a bonus.",
			Completed: minInt(tripsToday, 10),
			Total:     10,
			Reward:    500,
			Expiry:    "Expires in 3 days",
		},
		{
			Title:     "Peak Pro",
			Desc:      "Complete 2 trips during peak hours.",
			Completed: minInt(tripsToday, 2),
			Total:     2,
			Reward:    1200,
			Expiry:    "Expires in 5 days",
		},
		{
			Title:     "Weekly Warrior",
			Desc:      "Complete 15 trips this week.",
			Completed: minInt(tripsWeek, 15),
			Total:     15,
			Reward:    300,
			Expiry:    "No expiration",
		},
	}

	// Surge zones from the live manual_surge_zones table where available.
	surgeZones := make([]surgeZoneItem, 0, 3)
	rows, err := h.dbPool.Query(ctx, `
		SELECT name, multiplier
		FROM manual_surge_zones
		WHERE is_active AND expires_at > NOW()
		ORDER BY multiplier DESC
		LIMIT 3
	`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var name string
			var mult float64
			if rows.Scan(&name, &mult) == nil {
				surgeZones = append(surgeZones, surgeZoneItem{Zone: name, Multiplier: formatMultiplier(mult)})
			}
		}
		rows.Close()
	}
	if len(surgeZones) == 0 {
		surgeZones = []surgeZoneItem{
			{Zone: "Airport Terminal", Multiplier: "1.4x"},
			{Zone: "Central Business District", Multiplier: "1.3x"},
			{Zone: "Tech Park", Multiplier: "1.5x"},
		}
	}

	writeJSONResponse(w, http.StatusOK, map[string]any{
		"referral_code": referralCodeFor(driverID),
		"quests":        quests,
		"surge_zones":   surgeZones,
		"trips_today":   tripsToday,
		"trips_week":    tripsWeek,
	})
}

// formatMultiplier renders a NUMERIC(3,2) surge multiplier as e.g. "1.4x".
func formatMultiplier(m float64) string {
	s := strconv.FormatFloat(m, 'f', -1, 64)
	return s + "x"
}

// ─── Performance ───────────────────────────────────────────────────────────────

type reviewItem struct {
	Name   string `json:"name"`
	Rating int    `json:"rating"`
	Date   string `json:"date"`
	Text   string `json:"text"`
}

// GET /api/v1/driver/performance
// Rating comes from drivers.rating; trips/acceptance/completion are computed from
// the orders table; tier is derived from rating + total trips.
func (h *DriverEngagementHandler) GetPerformance(w http.ResponseWriter, r *http.Request) {
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	var rating float64
	var acceptanceRate, cancellationRate float64
	_ = h.dbPool.QueryRow(ctx, `
		SELECT COALESCE(rating, 5.0), COALESCE(acceptance_rate, 1.0), COALESCE(cancellation_rate, 0.0)
		FROM drivers WHERE id = $1::uuid
	`, driverID).Scan(&rating, &acceptanceRate, &cancellationRate)

	// Trip mix: total assigned, completed, cancelled — drives completion rate.
	var totalAssigned, completed, cancelled int
	_ = h.dbPool.QueryRow(ctx, `
		SELECT
			COUNT(*),
			COUNT(*) FILTER (WHERE status = 'COMPLETED'),
			COUNT(*) FILTER (WHERE status = 'CANCELLED')
		FROM orders WHERE assigned_driver_id = $1::uuid
	`, driverID).Scan(&totalAssigned, &completed, &cancelled)

	completionRate := 100.0
	if totalAssigned > 0 {
		completionRate = round1(float64(completed) / float64(totalAssigned) * 100.0)
	}
	acceptancePct := round1(acceptanceRate * 100.0)
	cancellationPct := round1(cancellationRate * 100.0)

	// Rating breakdown: distribution of rider ratings left for this driver.
	breakdown := map[string]int{"5": 0, "4": 0, "3": 0, "2": 0, "1": 0}
	if brows, berr := h.dbPool.Query(ctx, `
		SELECT rider_rating_for_driver, COUNT(*)
		FROM orders
		WHERE assigned_driver_id = $1::uuid AND rider_rating_for_driver IS NOT NULL
		GROUP BY rider_rating_for_driver
	`, driverID); berr == nil {
		defer brows.Close()
		for brows.Next() {
			var star, cnt int
			if brows.Scan(&star, &cnt) == nil {
				breakdown[strconv.Itoa(star)] = cnt
			}
		}
		brows.Close()
	}

	// Recent reviews: rider comments on completed trips, newest first.
	reviews := make([]reviewItem, 0, 5)
	if rrows, rerr := h.dbPool.Query(ctx, `
		SELECT COALESCE(rider_rating_for_driver, 5),
		       COALESCE(rider_review_comment, ''),
		       COALESCE(completed_at, created_at)
		FROM orders
		WHERE assigned_driver_id = $1::uuid
		  AND rider_review_comment IS NOT NULL
		  AND rider_review_comment <> ''
		ORDER BY COALESCE(completed_at, created_at) DESC
		LIMIT 5
	`, driverID); rerr == nil {
		defer rrows.Close()
		for rrows.Next() {
			var star int
			var comment string
			var when time.Time
			if rrows.Scan(&star, &comment, &when) == nil {
				reviews = append(reviews, reviewItem{
					Name:   "Rider",
					Rating: star,
					Date:   when.Format("2006-01-02"),
					Text:   comment,
				})
			}
		}
		rrows.Close()
	}

	writeJSONResponse(w, http.StatusOK, map[string]any{
		"rating":           round2(rating),
		"total_trips":      completed,
		"acceptance_rate":  acceptancePct,
		"completion_rate":  completionRate,
		"cancellation":     cancellationPct,
		"tier":             tierFor(rating, completed),
		"rating_breakdown": breakdown,
		"recent_reviews":   reviews,
	})
}

// tierFor derives the loyalty tier from rating and completed-trip count, matching
// the four-tier ladder shown on the performance page.
func tierFor(rating float64, trips int) string {
	switch {
	case rating >= 4.9 && trips >= 500:
		return "PLATINUM"
	case rating >= 4.7 && trips >= 200:
		return "GOLD"
	case rating >= 4.5 && trips >= 50:
		return "SILVER"
	default:
		return "BRONZE"
	}
}

// ─── Notifications ─────────────────────────────────────────────────────────────

// PATCH /api/v1/driver/notifications/{id}/read
// Mirrors the rider HandleMarkNotificationRead pattern: marks one of the driver's
// own notifications read. Scoped by driver_id so a driver cannot touch another's.
func (h *DriverEngagementHandler) MarkNotificationRead(w http.ResponseWriter, r *http.Request) {
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}
	notifID := r.PathValue("id")
	if strings.TrimSpace(notifID) == "" {
		http.Error(w, "missing_notification_id", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	tag, err := h.dbPool.Exec(ctx, `
		UPDATE driver_notifications
		SET is_read = TRUE, opened_at = NOW()
		WHERE id = $1::uuid AND driver_id = $2::uuid
	`, notifID, driverID)
	if err != nil {
		http.Error(w, "notification_update_failed", http.StatusInternalServerError)
		return
	}
	if tag.RowsAffected() == 0 {
		http.Error(w, "notification_not_found", http.StatusNotFound)
		return
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{"success": true})
}

// ─── Profile ───────────────────────────────────────────────────────────────────

type driverProfile struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Bio   *string `json:"bio"`
	Phone *string `json:"phone"`
	Email *string `json:"email"`
}

// PATCH /api/v1/driver/profile  body: {bio?, name?}
// Updates only the fields supplied (COALESCE keeps the existing value when a field
// is omitted) and returns the updated profile.
func (h *DriverEngagementHandler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}
	var req struct {
		Bio            *string `json:"bio"`
		Name           *string `json:"name"`
		CanDriveManual *bool   `json:"can_drive_manual"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}
	if req.Name != nil {
		trimmed := strings.TrimSpace(*req.Name)
		if trimmed == "" {
			http.Error(w, "name_cannot_be_empty", http.StatusBadRequest)
			return
		}
		req.Name = &trimmed
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	// can_drive_manual is the driver's transmission skill; it gates manual-car bookings in
	// the matcher (picked up on the driver's next go-online, which writes it to the profile
	// hash the scanner reads).
	var p driverProfile
	err := h.dbPool.QueryRow(ctx, `
		UPDATE drivers
		SET name = COALESCE($1, name),
		    bio  = COALESCE($2, bio),
		    can_drive_manual = COALESCE($3, can_drive_manual),
		    updated_at = NOW()
		WHERE id = $4::uuid
		RETURNING id::text, name, bio, phone, email
	`, req.Name, req.Bio, req.CanDriveManual, driverID).Scan(&p.ID, &p.Name, &p.Bio, &p.Phone, &p.Email)
	if err == pgx.ErrNoRows {
		http.Error(w, "driver_not_found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "profile_update_failed", http.StatusInternalServerError)
		return
	}
	writeJSONResponse(w, http.StatusOK, p)
}

// ─── KYC Documents ─────────────────────────────────────────────────────────────

type kycDocItem struct {
	DocType    string  `json:"doc_type"`
	Status     string  `json:"status"`
	StorageURL string  `json:"storage_url"`
	UploadedAt *string `json:"uploaded_at"`
}

// GET /api/v1/driver/me/documents
// Lists the driver's uploaded KYC documents from driver_documents — the same table
// the onboarding HandleUploadDocument writes to. driver_documents has no created_at
// column, so uploaded_at is derived from reviewed_at when present.
func (h *DriverEngagementHandler) ListMyDocuments(w http.ResponseWriter, r *http.Request) {
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	docs := make([]kycDocItem, 0)
	rows, err := h.dbPool.Query(ctx, `
		SELECT document_type, status::text, storage_url, reviewed_at
		FROM driver_documents
		WHERE driver_id = $1::uuid
		ORDER BY document_type
	`, driverID)
	if err != nil {
		http.Error(w, "documents_query_failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var d kycDocItem
		var reviewedAt *time.Time
		if rows.Scan(&d.DocType, &d.Status, &d.StorageURL, &reviewedAt) == nil {
			if reviewedAt != nil {
				s := reviewedAt.Format(time.RFC3339)
				d.UploadedAt = &s
			}
			docs = append(docs, d)
		}
	}
	writeJSONResponse(w, http.StatusOK, docs)
}

// ─── Referrals ─────────────────────────────────────────────────────────────────

// GET /api/v1/driver/referrals
// No driver-referrals table exists yet, so the code is derived from the driver id
// and the counts/earnings are zeroed (never random) until a referrals table lands.
func (h *DriverEngagementHandler) GetReferrals(w http.ResponseWriter, r *http.Request) {
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{
		"code":           referralCodeFor(driverID),
		"joined_count":   0,
		"pending_count":  0,
		"earnings_paise": 0,
	})
}

// ─── helpers ───────────────────────────────────────────────────────────────────

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func round1(v float64) float64 { return math.Round(v*10) / 10 }
func round2(v float64) float64 { return math.Round(v*100) / 100 }
