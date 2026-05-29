package notification

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type OutboxNotificationDaemon struct {
	dbPool        *pgxpool.Pool
	sweepInterval time.Duration
	maxRetryLimit int
}

type PendingNotification struct {
	ID          int64
	UserID      string
	Title       string
	Body        string
	PayloadJSON []byte
}

func NewOutboxNotificationDaemon(db *pgxpool.Pool) *OutboxNotificationDaemon {
	return &OutboxNotificationDaemon{
		dbPool:        db,
		sweepInterval: 2 * time.Second, // Evaluates the pending transactional outbox index table every 2 seconds
		maxRetryLimit: 3,
	}
}

// StartProcessingLoop drives the persistent append-only outbox sweeping worker thread
func (d *OutboxNotificationDaemon) StartProcessingLoop(ctx context.Context) {
	log.Println("[NOTIFICATION_ENGINE] Initializing asynchronous transactional push outbox engine daemon...")
	ticker := time.NewTicker(d.sweepInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			d.processPendingOutboxEntries(ctx)
		}
	}
}

func (d *OutboxNotificationDaemon) processPendingOutboxEntries(ctx context.Context) {
	sweepCtx, cancel := context.WithTimeout(ctx, 3500*time.Millisecond)
	defer cancel()

	// Pull pending records that haven't crossed the maximum retry threshold
	query := `
		SELECT id, user_id, title, body, payload 
		FROM notification_outbox 
		WHERE status = 'PENDING' AND retry_count < $1
		ORDER BY created_at ASC 
		LIMIT 20;
	`
	rows, err := d.dbPool.Query(sweepCtx, query, d.maxRetryLimit)
	if err != nil {
		return
	}
	defer rows.Close()

	var batch []PendingNotification
	for rows.Next() {
		var n PendingNotification
		if err := rows.Scan(&n.ID, &n.UserID, &n.Title, &n.Body, &n.PayloadJSON); err == nil {
			batch = append(batch, n)
		}
	}

	if len(batch) == 0 {
		return
	}

	log.Printf("[NOTIFICATION_ENGINE] Processing batch of %d backgrounded push entries...", len(batch))

	for _, item := range batch {
		d.dispatchPushNotification(ctx, item)
	}
}

func (d *OutboxNotificationDaemon) dispatchPushNotification(ctx context.Context, item PendingNotification) {
	workerCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	// Extract target user device push routing token attributes
	var token, platform string
	tokenQuery := "SELECT device_token, platform_type FROM user_device_tokens WHERE user_id = $1::uuid;"
	err := d.dbPool.QueryRow(workerCtx, tokenQuery, item.UserID).Scan(&token, &platform)
	if err != nil {
		// Log error and update tracking status if the device token cannot be resolved
		updateQuery := `
			UPDATE notification_outbox 
			SET status = 'FAILED', error_log = $1, processed_at = CURRENT_TIMESTAMP, retry_count = retry_count + 1 
			WHERE id = $2;
		`
		_, _ = d.dbPool.Exec(workerCtx, updateQuery, fmt.Sprintf("token_mapping_missing: %v", err), item.ID)
		return
	}

	// Mock third-party provider push orchestration handshake logic
	// In production, integrate standard client frameworks: "github.com/appleboy/go-fcm" or "github.com/sideshow/apns2"
	success := d.simulateExternalNotificationProviderCall(token, platform, item.Title, item.Body, item.PayloadJSON)

	if success {
		// Payout success: mark record state as SENT cleanly
		successQuery := "UPDATE notification_outbox SET status = 'SENT', processed_at = CURRENT_TIMESTAMP WHERE id = $1;"
		_, _ = d.dbPool.Exec(workerCtx, successQuery, item.ID)
		tokenPreview := token
		if len(tokenPreview) > 8 {
			tokenPreview = tokenPreview[:8]
		}
		log.Printf("[NOTIFICATION_SENT] Push alert successfully delivered via %s to device token: %s...", platform, tokenPreview)
	} else {
		// Requeue update fallback loop
		failQuery := "UPDATE notification_outbox SET retry_count = retry_count + 1, error_log = 'provider_timeout' WHERE id = $1;"
		_, _ = d.dbPool.Exec(workerCtx, failQuery, item.ID)
	}
}

func (d *OutboxNotificationDaemon) simulateExternalNotificationProviderCall(token, platform, title, body string, payload []byte) bool {
	// Emulate external network latency overhead constraints
	time.Sleep(45 * time.Millisecond)
	return true
}
