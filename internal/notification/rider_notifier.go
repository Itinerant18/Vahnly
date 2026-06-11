package notification

import (
	"context"
	"encoding/json"
	"log"

	"github.com/jackc/pgx/v5/pgxpool"
)

// FCMResult is the outcome of a push send. InvalidRegistration signals the token
// is dead and should be deactivated.
type FCMResult struct {
	InvalidRegistration bool
}

// FCMSender delivers a push to a single device token. The concrete provider
// integration (Firebase) is stubbed for now — see StubFCMSender.
type FCMSender interface {
	Send(ctx context.Context, token, platform, title, body string, data []byte) (FCMResult, error)
}

// StubFCMSender is a no-op sender used until a real FCM client is wired.
type StubFCMSender struct{}

func (StubFCMSender) Send(_ context.Context, token, platform, _, _ string, _ []byte) (FCMResult, error) {
	preview := token
	if len(preview) > 8 {
		preview = preview[:8]
	}
	log.Printf("[RIDER_PUSH] (stub) would send to %s token %s...", platform, preview)
	return FCMResult{}, nil
}

// RiderNotifier persists a rider notification and fans it out to the rider's
// active devices via FCM, deactivating dead tokens.
type RiderNotifier struct {
	dbPool *pgxpool.Pool
	fcm    FCMSender
}

func NewRiderNotifier(db *pgxpool.Pool, fcm FCMSender) *RiderNotifier {
	if fcm == nil {
		fcm = StubFCMSender{}
	}
	return &RiderNotifier{dbPool: db, fcm: fcm}
}

// NotifyRider inserts a rider_notifications row, then pushes to every active
// device token. A token returning InvalidRegistration is marked inactive.
func (n *RiderNotifier) NotifyRider(ctx context.Context, riderID, notifType, title, body string, data map[string]any) error {
	var payload any
	if len(data) > 0 {
		b, err := json.Marshal(data)
		if err != nil {
			return err
		}
		payload = b
	}

	if _, err := n.dbPool.Exec(ctx, `
		INSERT INTO rider_notifications (rider_id, type, title, body, data)
		VALUES ($1::uuid, $2, $3, $4, $5)`, riderID, notifType, title, body, payload); err != nil {
		return err
	}

	rows, err := n.dbPool.Query(ctx, `
		SELECT device_token, platform FROM rider_device_tokens
		WHERE rider_id = $1::uuid AND is_active`, riderID)
	if err != nil {
		return err
	}
	type tok struct{ token, platform string }
	var tokens []tok
	for rows.Next() {
		var t tok
		if err := rows.Scan(&t.token, &t.platform); err == nil {
			tokens = append(tokens, t)
		}
	}
	rows.Close()

	var rawData []byte
	if b, ok := payload.([]byte); ok {
		rawData = b
	}
	for _, t := range tokens {
		res, err := n.fcm.Send(ctx, t.token, t.platform, title, body, rawData)
		if err != nil {
			log.Printf("[RIDER_PUSH] send failed for rider %s: %v", riderID, err)
			continue
		}
		if res.InvalidRegistration {
			_, _ = n.dbPool.Exec(ctx, `UPDATE rider_device_tokens SET is_active = false WHERE device_token = $1`, t.token)
		}
	}
	return nil
}
