package reconciler

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/segmentio/kafka-go"
)

type OrderReconcilerSyncWorker struct {
	dbPool          *pgxpool.Pool
	kafkaWriter     *kafka.Writer
	syncInterval    time.Duration
	stuckThreshold  time.Duration
}

type ReconcileTarget struct {
	OrderID    string    `json:"order_id"`
	DriverID   string    `json:"driver_id"`
	AssignedAt time.Time `json:"-"`
}

func NewOrderReconcilerSyncWorker(db *pgxpool.Pool, brokers []string) *OrderReconcilerSyncWorker {
	return &OrderReconcilerSyncWorker{
		dbPool: db,
		kafkaWriter: &kafka.Writer{
			Addr:         kafka.TCP(brokers...),
			Topic:        "order.assigned", // Targets the exact event destination of the matching pipeline
			Balancer:     &kafka.Hash{},
			RequiredAcks: kafka.RequireOne,
		},
		syncInterval:   15 * time.Second, // Evaluates database state maps every 15 seconds
		stuckThreshold: 20 * time.Second, // Captures assignments un-progressed for more than 20 seconds
	}
}

// StartReconciliationLoop blocks and drives the periodic anti-entropy synchronization sweeps
func (w *OrderReconcilerSyncWorker) StartReconciliationLoop(ctx context.Context, cityPrefix string) {
	log.Printf("[RECONCILER_DAEMON] Starting self-healing anti-entropy sync worker for region [%s]", cityPrefix)
	ticker := time.NewTicker(w.syncInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Printf("[RECONCILER_DAEMON] Halting sync loop execution for region %s.", cityPrefix)
			return
		case <-ticker.C:
			w.ExecuteStateReconciliation(ctx, cityPrefix)
		}
	}
}

// ExecuteStateReconciliation scans relational states and patches any missing event frames
func (w *OrderReconcilerSyncWorker) ExecuteStateReconciliation(ctx context.Context, cityPrefix string) {
	scanCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	// Query targets stuck exactly in 'ASSIGNED' state that missed real-time network propagation
	// Bounded to elements under 10 minutes old to prevent re-injecting historic data cycles
	query := `
		SELECT id, assigned_driver_id, assigned_at 
		FROM orders 
		WHERE city_prefix = $1 
		  AND status = 'ASSIGNED'::order_status_enum 
		  AND assigned_at < NOW() - $2::interval
		  AND assigned_at > NOW() - INTERVAL '10 minutes';
	`

	intervalStr := fmt.Sprintf("%d seconds", int(w.stuckThreshold.Seconds()))
	rows, err := w.dbPool.Query(scanCtx, query, cityPrefix, intervalStr)
	if err != nil {
		log.Printf("[RECONCILER_ERROR] Failed scanning stuck database assignment maps: %v", err)
		return
	}
	defer rows.Close()

	var targets []ReconcileTarget
	for rows.Next() {
		var t ReconcileTarget
		if err := rows.Scan(&t.OrderID, &t.DriverID, &t.AssignedAt); err == nil {
			targets = append(targets, t)
		}
	}

	if len(targets) == 0 {
		return
	}

	log.Printf("[RECONCILER_DAEMON] Detected %d potentially stuck assignments. Compiling event repair pipelines...", len(targets))

	// 2. Stream missing events back onto the event backbone sequentially to prevent lock thrashing
	for _, target := range targets {
		emitCtx, emitCancel := context.WithTimeout(ctx, 2*time.Second)
		
		payload := map[string]interface{}{
			"order_id":    target.OrderID,
			"driver_id":   target.DriverID,
			"assigned_at": target.AssignedAt.Unix(),
			"reconciled":  true, // Tagged explicitly to allow auditing downstream
		}

		bytes, err := json.Marshal(payload)
		if err != nil {
			emitCancel()
			continue
		}

		err = w.kafkaWriter.WriteMessages(emitCtx, kafka.Message{
			Key:   []byte(target.OrderID),
			Value: bytes,
		})
		emitCancel()

		if err != nil {
			log.Printf("[RECONCILER_ERROR] Failed repairing event frame for order %s: %v", target.OrderID, err)
		} else {
			log.Printf("[RECONCILER_HEALED] Successfully repaired stream bridge for order %s. Notification broadcasted.", target.OrderID)
		}
	}
}

func (w *OrderReconcilerSyncWorker) Close() error {
	return w.kafkaWriter.Close()
}
