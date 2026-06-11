// Package monitor contains the rider-side trip anomaly monitor (Ride Check).
package monitor

import (
	"context"
	"encoding/json"
	"log"
	"math"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/platform/driver-delivery/internal/rider/realtime"
)

// EventPublisher publishes to a named Kafka topic. *rider/service.KafkaEventPublisher satisfies it.
type EventPublisher interface {
	Publish(ctx context.Context, topic, key string, value []byte) error
}

// RideCheckMonitor scans active (DELIVERING) trips for anomalies and alerts the
// rider. It runs as a background goroutine (the "Janitor" responsibility).
type RideCheckMonitor struct {
	dbPool    *pgxpool.Pool
	cache     *redis.ClusterClient
	publisher EventPublisher
	interval  time.Duration
}

func NewRideCheckMonitor(pool *pgxpool.Pool, cache *redis.ClusterClient, publisher EventPublisher) *RideCheckMonitor {
	return &RideCheckMonitor{dbPool: pool, cache: cache, publisher: publisher, interval: 30 * time.Second}
}

func (m *RideCheckMonitor) Run(ctx context.Context) {
	log.Println("[RIDE_CHECK] anomaly monitor started (30s interval)")
	ticker := time.NewTicker(m.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.scan(ctx)
		}
	}
}

func (m *RideCheckMonitor) scan(ctx context.Context) {
	scanCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	rows, err := m.dbPool.Query(scanCtx, `
		SELECT id::text, rider_id::text
		FROM orders
		WHERE status = 'DELIVERING'::order_status_enum AND rider_id IS NOT NULL`)
	if err != nil {
		log.Printf("[RIDE_CHECK] scan query failed: %v", err)
		return
	}
	type active struct{ orderID, riderID string }
	var actives []active
	for rows.Next() {
		var a active
		if err := rows.Scan(&a.orderID, &a.riderID); err == nil {
			actives = append(actives, a)
		}
	}
	rows.Close()

	for _, a := range actives {
		m.checkOrder(scanCtx, a.orderID, a.riderID)
	}
}

type gpsPoint struct {
	lat, lng float64
	at       time.Time
}

// checkOrder flags a no-movement anomaly: the driver moved < 100m over a window of
// at least 5 minutes. (Route-deviation > 500m needs a stored route geometry, which
// orders does not yet carry — left as a follow-up.)
func (m *RideCheckMonitor) checkOrder(ctx context.Context, orderID, riderID string) {
	rows, err := m.dbPool.Query(ctx, `
		SELECT latitude, longitude, captured_at
		FROM orders_gps_trail WHERE order_id = $1::uuid
		ORDER BY captured_at DESC LIMIT 5`, orderID)
	if err != nil {
		return
	}
	var pts []gpsPoint
	for rows.Next() {
		var p gpsPoint
		if err := rows.Scan(&p.lat, &p.lng, &p.at); err == nil {
			pts = append(pts, p)
		}
	}
	rows.Close()
	if len(pts) < 2 {
		return // not enough telemetry
	}

	latest := pts[0]
	oldest := pts[len(pts)-1]
	// Require at least a 5-minute window of data before judging "stalled".
	if latest.at.Sub(oldest.at) < 5*time.Minute {
		return
	}
	maxDisp := 0.0
	for _, p := range pts[1:] {
		if d := haversineMeters(latest.lat, latest.lng, p.lat, p.lng); d > maxDisp {
			maxDisp = d
		}
	}
	if maxDisp >= 100 {
		return // moving normally
	}

	m.raiseAnomaly(ctx, orderID, riderID, latest)
}

// raiseAnomaly alerts the rider once per 5-minute window, then escalates to support
// if the situation persists past 2 minutes (proxy for "rider did not respond").
func (m *RideCheckMonitor) raiseAnomaly(ctx context.Context, orderID, riderID string, loc gpsPoint) {
	sentKey := "ridecheck:sent:" + orderID
	escKey := "ridecheck:escalated:" + orderID

	first := true
	if m.cache != nil {
		// SetNX returns true the first time; false while the 5-min cooldown holds.
		ok, _ := m.cache.SetNX(ctx, sentKey, time.Now().Format(time.RFC3339), 5*time.Minute).Result()
		first = ok
	}

	if first {
		// 1. Rider WS ride-check prompt.
		_ = realtime.Publish(ctx, m.cache, riderID, realtime.MsgRideCheck, map[string]any{
			"order_id": orderID,
			"message":  "Everything ok?",
		})
		// 2. Persist a rider notification.
		_, _ = m.dbPool.Exec(ctx, `
			INSERT INTO rider_notifications (rider_id, type, title, body, data)
			VALUES ($1::uuid, 'RIDE_CHECK', 'Ride check', 'We noticed your trip has been stationary. Everything ok?', $2::jsonb)`,
			riderID, mustJSON(map[string]any{"order_id": orderID}))
		// 3. Anomaly event to Kafka.
		m.publish("trip.anomaly", orderID, map[string]any{
			"order_id": orderID, "rider_id": riderID, "anomaly": "NO_MOVEMENT",
			"lat": loc.lat, "lng": loc.lng,
		})
		return
	}

	// Persisted anomaly: escalate to support once, if the ride-check is older than 2 min.
	if m.cache == nil {
		return
	}
	sentAtStr, err := m.cache.Get(ctx, sentKey).Result()
	if err != nil {
		return
	}
	sentAt, err := time.Parse(time.RFC3339, sentAtStr)
	if err != nil || time.Since(sentAt) < 2*time.Minute {
		return
	}
	if claimed, _ := m.cache.SetNX(ctx, escKey, "1", 30*time.Minute).Result(); !claimed {
		return // already escalated
	}
	m.publish("incident.created", orderID, map[string]any{
		"order_id": orderID, "rider_id": riderID, "source": "RIDE_CHECK_NO_RESPONSE",
		"lat": loc.lat, "lng": loc.lng,
	})
}

func (m *RideCheckMonitor) publish(topic, key string, payload map[string]any) {
	if m.publisher == nil {
		return
	}
	if b, err := json.Marshal(payload); err == nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = m.publisher.Publish(ctx, topic, key, b)
	}
}

func mustJSON(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}

func haversineMeters(lat1, lng1, lat2, lng2 float64) float64 {
	const r = 6371000.0
	const d2r = math.Pi / 180.0
	dLat := (lat2 - lat1) * d2r
	dLng := (lng2 - lng1) * d2r
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*d2r)*math.Cos(lat2*d2r)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return r * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}
