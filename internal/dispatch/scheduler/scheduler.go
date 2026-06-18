// Package scheduler replays future-dated ("scheduled") bookings onto the order.created
// stream near their pickup time. The rider service stores the dispatch payload verbatim in
// scheduled_dispatch_queue at booking time; this sweeper claims due rows and re-emits them,
// so a scheduled order enters the matcher exactly once, ~lead-time before pickup.
package scheduler

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/segmentio/kafka-go"

	"github.com/platform/driver-delivery/internal/dispatch/domain"
	"github.com/platform/driver-delivery/internal/messaging/kafkacfg"
)

// claimBatchSize bounds how many due orders one tick publishes — backpressure against a
// large backlog (e.g. many bookings for the same hour) flooding the matcher at once.
const claimBatchSize = 100

type Scheduler struct {
	db     *pgxpool.Pool
	writer *kafka.Writer
	tick   time.Duration
}

func New(db *pgxpool.Pool, brokers []string) *Scheduler {
	sec := kafkacfg.FromEnv()
	w := &kafka.Writer{
		Addr:         kafka.TCP(brokers...),
		Topic:        "order.created",
		Balancer:     &kafka.Hash{},
		RequiredAcks: kafka.RequireOne,
	}
	sec.ApplyToWriter(w)
	return &Scheduler{db: db, writer: w, tick: 30 * time.Second}
}

// Run sweeps for due scheduled bookings every tick until ctx is cancelled.
func (s *Scheduler) Run(ctx context.Context) {
	t := time.NewTicker(s.tick)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			_ = s.writer.Close()
			return
		case <-t.C:
			s.dispatchDue(ctx)
		}
	}
}

type dueOrder struct {
	id      string
	payload []byte
}

func (s *Scheduler) dispatchDue(ctx context.Context) {
	cctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	// Read due, undispatched rows (no row locks held across the Kafka publish below).
	leadInterval := fmt.Sprintf("%d seconds", int(domain.ScheduledDispatchLead().Seconds()))
	rows, err := s.db.Query(cctx, `
		SELECT order_id::text, payload FROM scheduled_dispatch_queue
		WHERE dispatched_at IS NULL AND scheduled_at <= NOW() + $1::interval
		ORDER BY scheduled_at
		LIMIT $2`, leadInterval, claimBatchSize)
	if err != nil {
		log.Printf("[SCHEDULER] due query failed: %v", err)
		return
	}

	var batch []dueOrder
	for rows.Next() {
		var d dueOrder
		if scanErr := rows.Scan(&d.id, &d.payload); scanErr == nil {
			batch = append(batch, d)
		}
	}
	rows.Close()
	if rows.Err() != nil {
		log.Printf("[SCHEDULER] row iteration error: %v", rows.Err())
	}

	for _, d := range batch {
		// Publish FIRST, then mark dispatched (at-least-once). A crash between the two
		// re-publishes next tick — the matcher dedupes a duplicate order.created via its
		// guarded CREATED->ASSIGNED transition, so an extra publish is harmless while a lost
		// one is not. The guarded mark (dispatched_at IS NULL) keeps concurrent pods from
		// re-marking; a rare double-publish across pods is likewise absorbed by the matcher.
		if err := s.writer.WriteMessages(cctx, kafka.Message{Key: []byte(d.id), Value: d.payload}); err != nil {
			log.Printf("[SCHEDULER] publish failed for %s: %v — retry next tick", d.id, err)
			continue
		}
		if _, mErr := s.db.Exec(cctx, `
			UPDATE scheduled_dispatch_queue SET dispatched_at = NOW()
			WHERE order_id = $1::uuid AND dispatched_at IS NULL`, d.id); mErr != nil {
			log.Printf("[SCHEDULER] mark dispatched failed for %s: %v — will re-publish next tick", d.id, mErr)
			continue
		}
		log.Printf("[SCHEDULER] dispatched scheduled order %s onto order.created", d.id)
	}
}
