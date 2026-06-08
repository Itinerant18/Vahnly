package consumer

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"time"

	"github.com/platform/driver-delivery/internal/observability"
	"github.com/platform/driver-delivery/internal/telemetry/domain"
	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"
	"github.com/uber/h3-go/v3"
)

// lwwCASScript is the Last-Write-Wins gate. It compares the incoming handoff
// timestamp (ARGV[1], unix-nanos) against the last-applied one stored at KEYS[1].
// Returns 1 and stamps the new value only when the incoming claim is strictly
// newer; returns 0 (reject) when an equal or newer claim already won. The check
// and the write are atomic server-side, so two regions racing to claim the same
// driver cannot both succeed.
var lwwCASScript = redis.NewScript(`
local cur = redis.call('GET', KEYS[1])
if cur and tonumber(cur) >= tonumber(ARGV[1]) then
  return 0
end
redis.call('SET', KEYS[1], ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1
`)

// lwwShouldApply is the pure decision the Lua script encodes: an incoming claim
// supersedes the stored one only if it is strictly newer. Equal timestamps are
// treated as already-applied so duplicate/retried handoffs are idempotent.
func lwwShouldApply(incomingNanos, storedNanos int64) bool {
	return storedNanos == 0 || incomingNanos > storedNanos
}

type HandoffConsumer struct {
	reader        *kafka.Reader
	redisClient   *redis.ClusterClient
	currentRegion string
}

func NewHandoffConsumer(brokers []string, topic, groupID, currentRegion string, redis *redis.ClusterClient) *HandoffConsumer {
	r := kafka.NewReader(kafka.ReaderConfig{
		Brokers:  brokers,
		Topic:    topic,
		GroupID:  groupID, // e.g., "dispatch-handoff-kolkata"
		MinBytes: 10,
		MaxBytes: 10e6,
	})
	return &HandoffConsumer{reader: r, redisClient: redis, currentRegion: currentRegion}
}

func (hc *HandoffConsumer) Start(ctx context.Context) {
	log.Printf("Starting Global Region Handoff Consumer for [%s]", hc.currentRegion)
	for {
		m, err := hc.reader.FetchMessage(ctx)
		if err != nil {
			// Check if context has been cancelled for a graceful shutdown
			select {
			case <-ctx.Done():
				log.Printf("Shutting down handoff consumer for [%s]", hc.currentRegion)
				return
			default:
				log.Printf("handoff consumer error: %v", err)
				time.Sleep(1 * time.Second)
				continue
			}
		}

		var event domain.RegionHandoffEvent
		if err := json.Unmarshal(m.Value, &event); err != nil {
			log.Printf("Dropped malformed handoff event: %v", err)
			_ = hc.reader.CommitMessages(ctx, m)
			continue
		}

		// Only process if THIS cluster is the target region
		if event.TargetRegion == hc.currentRegion {
			// Last-Write-Wins gate: in an active-active topology a driver may be
			// claimed by two regions during a transition, or events may arrive out
			// of order. Discard any claim that is not strictly newer than the one
			// already applied, so we never resurrect a stale location.
			applied, lwwErr := hc.acquireLWW(ctx, event.DriverID, event.CrossedAt)
			if lwwErr != nil {
				// On a gate failure, fail open and hydrate — losing a driver from
				// dispatch is worse than a rare duplicate. Log for observability.
				log.Printf("[LWW] gate error for driver %s, hydrating anyway: %v", event.DriverID, lwwErr)
			} else if !applied {
				log.Printf("[LWW REJECT] Stale handoff for driver %s (crossed %s) ignored; newer state already won",
					event.DriverID, event.CrossedAt.Format(time.RFC3339Nano))
				observability.RegionHandoffsTotal.WithLabelValues("rejected_stale", event.TargetRegion).Inc()
				if cErr := hc.reader.CommitMessages(ctx, m); cErr != nil {
					log.Printf("Failed committing rejected handoff message: %v", cErr)
				}
				continue
			}

			log.Printf("[HANDOFF RECEIVED] Hydrating driver %s from %s to %s",
				event.DriverID, event.OriginRegion, event.TargetRegion)

			// 1. Hydrate into local Redis Spatial Index (Geo ZSET)
			err = hc.redisClient.GeoAdd(ctx, "driver:locations:"+hc.currentRegion, &redis.GeoLocation{
				Name:      event.DriverID,
				Longitude: event.LastLongitude,
				Latitude:  event.LastLatitude,
			}).Err()

			if err == nil {
				// 2. Pre-warm driver session cache (e.g., active surge multiplier inheritance)
				hc.redisClient.HSet(ctx, "driver:session:"+event.DriverID, "active_surge", event.SurgeMultiplier)

				// Determine cityPrefix mapping
				cityPrefix := "KOL"
				if event.TargetRegion == "howrah" {
					cityPrefix = "HWH"
				}

				// 3. Hydrate into local sharded H3 index ZSET so dispatch matcher finds them
				latRad := event.LastLatitude * (math.Pi / 180.0)
				lngRad := event.LastLongitude * (math.Pi / 180.0)
				centerCoord := h3.GeoCoord{Latitude: latRad, Longitude: lngRad}
				resolution8Cell := h3.FromGeo(centerCoord, 8)
				h3CellStr := h3.ToString(resolution8Cell)

				spatialZSetKey := fmt.Sprintf("drivers:zset:%s:%s", cityPrefix, h3CellStr)
				nowEpoch := float64(time.Now().Unix())
				
				pipe := hc.redisClient.Pipeline()
				pipe.ZAdd(ctx, spatialZSetKey, redis.Z{Score: nowEpoch, Member: event.DriverID})
				pipe.Expire(ctx, spatialZSetKey, 24*time.Hour)

				// Also write status, current cell, and profile to completely hydrate driver state
				statusKey  := fmt.Sprintf("driver:{%s:%s}:status",       cityPrefix, event.DriverID)
				trackerKey := fmt.Sprintf("driver:{%s:%s}:current_cell", cityPrefix, event.DriverID)
				profileKey := fmt.Sprintf("driver:{%s:%s}:profile",      cityPrefix, event.DriverID)

				pipe.Set(ctx, statusKey, "ONLINE_AVAILABLE", 30*time.Second)
				pipe.Set(ctx, trackerKey, h3CellStr, 24*time.Hour)
				pipe.HSet(ctx, profileKey,
					"osm_node_id",              "1001",
					"acceptance_rate",          "0.95",
					"cancellation_probability", "0.05",
				)
				pipe.Expire(ctx, profileKey, 24*time.Hour)

				_, pErr := pipe.Exec(ctx)
				if pErr != nil {
					log.Printf("Failed hydrating spatial ZSET and status profiles for driver %s: %v", event.DriverID, pErr)
				} else {
					// Migration complete: record end-to-end latency from boundary
					// crossing to local hydration, and count the committed handoff.
					observability.MigrationLatencySeconds.
						WithLabelValues(event.OriginRegion, event.TargetRegion).
						Observe(time.Since(event.CrossedAt).Seconds())
					observability.RegionHandoffsTotal.WithLabelValues("hydrated", event.TargetRegion).Inc()
				}
			} else {
				log.Printf("Failed GeoAdd spatial hydration for driver %s: %v", event.DriverID, err)
			}
		}

		// Acknowledge globally
		if err := hc.reader.CommitMessages(ctx, m); err != nil {
			log.Printf("Failed committing handoff message: %v", err)
		}
	}
}

// acquireLWW runs the Last-Write-Wins compare-and-set for a driver handoff.
// Returns true if this claim is the newest seen and the local shard should
// hydrate it; false if a newer (or equal) claim already won. The LWW key is
// hash-tagged on the driver ID so all of a driver's claims hash to one slot.
func (hc *HandoffConsumer) acquireLWW(ctx context.Context, driverID string, crossedAt time.Time) (bool, error) {
	key := "driver:lww:{" + driverID + "}"
	incoming := crossedAt.UnixNano()
	ttlMs := (24 * time.Hour).Milliseconds()
	res, err := lwwCASScript.Run(ctx, hc.redisClient, []string{key}, incoming, ttlMs).Int()
	if err != nil {
		return false, err
	}
	return res == 1, nil
}

func (hc *HandoffConsumer) Close() error {
	return hc.reader.Close()
}
