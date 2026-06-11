package reconciler

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/platform/driver-delivery/internal/messaging/kafkacfg"
	"github.com/platform/driver-delivery/internal/observability"
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
	w := &kafka.Writer{
		Addr:         kafka.TCP(brokers...),
		Topic:        "order.assigned", // Targets the exact event destination of the matching pipeline
		Balancer:     &kafka.Hash{},
		RequiredAcks: kafka.RequireOne,
	}
	kafkacfg.FromEnv().ApplyToWriter(w)
	return &OrderReconcilerSyncWorker{
		dbPool:         db,
		kafkaWriter:    w,
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
			w.AssertLedgerBalance(ctx, cityPrefix)
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

// AssertLedgerBalance is the non-blocking, read-only financial-integrity check — the
// safe form of a hard DB balance constraint. A blocking constraint would reject the
// platform's intentional unbalanced writes (e.g. the mid-trip lone-credit discrepancy
// signal in driver_trip_handler.go), so instead each sweep flags every order in this
// region whose double-entry sum != 0 via structured logs + Prometheus, touching no data.
func (w *OrderReconcilerSyncWorker) AssertLedgerBalance(ctx context.Context, cityPrefix string) {
	scanCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()

	// Canonical imbalance query, mirroring LedgerAdminHandler.HandleGetLedgerDiscrepancies,
	// scoped to this reconciler's region shard.
	const query = `
		SELECT order_id,
		       SUM(CASE WHEN entry_type = 'DEBIT' THEN amount_paise ELSE -amount_paise END) AS discrepancy_paise,
		       COUNT(*) AS entry_count
		FROM financial_ledger_entries
		WHERE city_prefix = $1
		GROUP BY order_id
		HAVING SUM(CASE WHEN entry_type = 'DEBIT' THEN amount_paise ELSE -amount_paise END) != 0
		ORDER BY MAX(created_at) DESC
		LIMIT 500;`

	rows, err := w.dbPool.Query(scanCtx, query, cityPrefix)
	if err != nil {
		observability.LedgerImbalanceSweepsTotal.WithLabelValues("error").Inc()
		log.Printf("[LEDGER_IMBALANCE_ERROR] balance assertion query failed for region %s: %v", cityPrefix, err)
		return
	}
	defer rows.Close()

	imbalanced := 0
	for rows.Next() {
		var orderID string
		var discrepancyPaise int64
		var entryCount int
		if err := rows.Scan(&orderID, &discrepancyPaise, &entryCount); err != nil {
			continue
		}
		imbalanced++
		// Cap per-order logging; the gauge carries the full count for alerting.
		if imbalanced <= 50 {
			log.Printf("[LEDGER_IMBALANCE] region=%s order=%s discrepancy_paise=%d entries=%d (debit-credit != 0)",
				cityPrefix, orderID, discrepancyPaise, entryCount)
		}
	}

	observability.LedgerImbalancedOrders.WithLabelValues(cityPrefix).Set(float64(imbalanced))
	if imbalanced > 0 {
		observability.LedgerImbalanceSweepsTotal.WithLabelValues("imbalanced").Inc()
		log.Printf("[LEDGER_IMBALANCE_SUMMARY] region=%s imbalanced_orders=%d — reconcile via /api/v1/admin/ledger/discrepancies", cityPrefix, imbalanced)
	} else {
		observability.LedgerImbalanceSweepsTotal.WithLabelValues("clean").Inc()
	}
}

func (w *OrderReconcilerSyncWorker) Close() error {
	return w.kafkaWriter.Close()
}
