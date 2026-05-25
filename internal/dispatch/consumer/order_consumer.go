package consumer

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/segmentio/kafka-go"
	
	"github.com/platform/driver-delivery/internal/dispatch/domain"
	"github.com/platform/driver-delivery/internal/dispatch/matcher"
	"github.com/platform/driver-delivery/internal/dispatch/repository"
)

type OrderCreatedConsumer struct {
	kafkaReader    *kafka.Reader
	kafkaWriter    *kafka.Writer
	spatialScanner *repository.SpatialScanner
	dbPool         *pgxpool.Pool
	
	// Batch window synchronization structures
	mu            sync.Mutex
	batchWindow   time.Duration
	maxBatchSize  int
	orderBuffer   []domain.OrderCreatedPayload
	windowTimer   *time.Timer
	currentAlgo   string // Runtime strategy flag: 'GREEDY', 'HUNGARIAN', 'AUCTION'
}

func NewOrderCreatedConsumer(brokers []string, groupID string, scanner *repository.SpatialScanner, db *pgxpool.Pool, algoStrategy string) *OrderCreatedConsumer {
	return &OrderCreatedConsumer{
		kafkaReader: kafka.NewReader(kafka.ReaderConfig{
			Brokers:        brokers,
			Topic:          "order.created", // [cite: 76]
			GroupID:        groupID,         // Concurrency balancing via KEDA [cite: 33, 107]
			MinBytes:       10,
			MaxBytes:       10e6,
			CommitInterval: 0,               // Explicit synchronous manual commits only
		}),
		kafkaWriter: &kafka.Writer{
			Addr:         kafka.TCP(brokers...),
			Topic:        "order.assigned", // [cite: 76]
			Balancer:     &kafka.Hash{},    // Partitioned by order_id [cite: 76]
			RequiredAcks: kafka.RequireOne,
		},
		spatialScanner: scanner,
		dbPool:         db,
		batchWindow:    300 * time.Millisecond, // Configurable 200-400ms window [cite: 61]
		maxBatchSize:   150,                    // Size trigger mandate [cite: 62]
		orderBuffer:    make([]domain.OrderCreatedPayload, 0),
		currentAlgo:    algoStrategy,           // Strategy Pattern abstraction [cite: 70]
	}
}

// StartExecutionPipeline starts the time-windowed event consumer loop
func (c *OrderCreatedConsumer) StartExecutionPipeline(ctx context.Context) {
	log.Printf("Starting Order Matching Engine loop. Running strategy: %s", c.currentAlgo)
	
	c.mu.Lock()
	c.windowTimer = time.NewTimer(c.batchWindow)
	c.mu.Unlock()

	// Background worker processing discrete batch windows when timers expire
	go c.processBatchLoop(ctx)

	for {
		select {
		case <-ctx.Done():
			return
		default:
			msg, err := c.kafkaReader.FetchMessage(ctx)
			if err != nil {
				if errors.Is(err, context.Canceled) {
					return
				}
				log.Printf("Kafka bus read error: %v", err)
				continue
			}

			var order domain.OrderCreatedPayload
			if err := json.Unmarshal(msg.Value, &order); err != nil {
				log.Printf("Malformed JSON event dropped: %v", err)
				_ = c.kafkaReader.CommitMessages(ctx, msg) // Evict broken packets
				continue
			}
			
			// Store message context to allow explicit offset commit post-assignment
			order.KafkaMessageContext = msg

			c.mu.Lock()
			c.orderBuffer = append(c.orderBuffer, order)
			
			// Immediate evaluation trigger if volume threshold exceeded [cite: 62]
			if len(c.orderBuffer) >= c.maxBatchSize {
				c.triggerBatchFlush()
			}
			c.mu.Unlock()
		}
	}
}

func (c *OrderCreatedConsumer) triggerBatchFlush() {
	if !c.windowTimer.Stop() {
		select {
		case <-c.windowTimer.C:
		default:
		}
	}
	c.windowTimer.Reset(0) // Forces immediate selection channel case execution
}

func (c *OrderCreatedConsumer) processBatchLoop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-c.windowTimer.C:
			c.mu.Lock()
			if len(c.orderBuffer) == 0 {
				c.windowTimer.Reset(c.batchWindow)
				c.mu.Unlock()
				continue
			}

			// Extract data pool from memory context and clear active slice
			batchToProcess := c.orderBuffer
			c.orderBuffer = make([]domain.OrderCreatedPayload, 0)
			c.windowTimer.Reset(c.batchWindow)
			c.mu.Unlock()

			// Route multi-order batch to execution solver
			c.executeMatchingBatch(ctx, batchToProcess)
		}
	}
}

func (c *OrderCreatedConsumer) executeMatchingBatch(ctx context.Context, orders []domain.OrderCreatedPayload) {
	// Constrain entire matching computation to preserve SLA bounds [cite: 2]
	timeoutCtx, cancel := context.WithTimeout(ctx, 450*time.Millisecond)
	defer cancel()

	for _, order := range orders {
		// 1. Spatial Reduction Phase: Fetch candidates via O(1) Redis Cluster lookups [cite: 12, 23]
		candidates, err := c.spatialScanner.ScanNearbyDrivers(timeoutCtx, order.CityPrefix, order.PickupH3Cell)
		if err != nil {
			log.Printf("Spatial reduction mapping failed for order %s: %v", order.OrderID, err)
			continue
		}

		if len(candidates) == 0 {
			log.Printf("Marketplace Starvation: No available drivers near cell %s", order.PickupH3Cell)
			continue
		}

		// 2. Select Algorithm via Strategy Pattern based on runtime profiles [cite: 70, 71]
		var optimalMatch *matcher.MatchResult
		var matchErr error

		switch c.currentAlgo {
		case "HUNGARIAN": // Scaled approach for 500-5,000 concurrent metrics [cite: 69]
			optimalMatch, matchErr = matcher.EvaluateHungarianOptimization(timeoutCtx, order, candidates)
		case "GREEDY":    // Default deployment configuration [cite: 69]
			fallthrough
		default:
			optimalMatch, matchErr = matcher.EvaluateGreedyMatch(timeoutCtx, order, candidates)
		}

		if matchErr != nil {
			log.Printf("Combinatorial computation error on order %s: %v", order.OrderID, matchErr)
			continue
		}

		// 3. Persistent Transaction Verification & Mutex Commitment
		err = c.commitAssignmentTransaction(timeoutCtx, optimalMatch)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Printf("Idempotency Intercept: Order %s already mutated by concurrent worker", order.OrderID)
			} else {
				log.Printf("Critical database write failure: %v", err)
			}
			continue
		}

		// 4. Downstream Notification & Downstream Event Emission
		if err := c.emitAssignedEvent(timeoutCtx, optimalMatch); err != nil {
			log.Printf("Critical downstream event streaming partition lost: %v", err)
			continue
		}

		// 5. Explicitly acknowledge processing completion back to Kafka log
		_ = c.kafkaReader.CommitMessages(ctx, order.KafkaMessageContext)
	}
}

func (c *OrderCreatedConsumer) commitAssignmentTransaction(ctx context.Context, match *matcher.MatchResult) error {
	tx, err := c.dbPool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Enforce linear state trajectory constraint [cite: 19]
	query := `
		UPDATE orders
		SET 
			status = 'ASSIGNED'::order_status_enum,
			assigned_driver_id = $1::uuid,
			assigned_at = CURRENT_TIMESTAMP
		WHERE 
			id = $2::uuid 
			AND status = 'CREATED'::order_status_enum;
	`

	res, err := tx.Exec(ctx, query, match.DriverID, match.OrderID)
	if err != nil {
		return err
	}

	// If row count is 0, the state check failed or another thread processed the order [cite: 109]
	if res.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}

	// Update the localized driver status to ONLINE_EN_ROUTE in relational storage [cite: 38]
	driverQuery := `
		UPDATE drivers
		SET current_state = 'ONLINE_EN_ROUTE'::driver_state_enum, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1::uuid;
	`
	_, err = tx.Exec(ctx, driverQuery, match.DriverID)
	if err != nil {
		return err
	}

	// Log metrics metadata to the immutable audit ledger [cite: 99]
	logQuery := `
		INSERT INTO dispatch_match_logs (
			order_id, batch_window_started_at, batch_window_ended_at, 
			algorithm_used, total_candidates_evaluated, chosen_driver_id, 
			computed_eta_seconds, assignment_score
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
	`
	_, err = tx.Exec(ctx, logQuery, 
		match.OrderID, 
		time.Now().Add(-300*time.Millisecond), 
		time.Now(), 
		c.currentAlgo, 
		match.CandidatesCount, 
		match.DriverID, 
		match.EstimatedEtaSeconds, 
		match.Score,
	)
	if err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (c *OrderCreatedConsumer) emitAssignedEvent(ctx context.Context, match *matcher.MatchResult) error {
	payload := map[string]interface{}{
		"order_id":    match.OrderID,
		"driver_id":   match.DriverID,
		"assigned_at": time.Now().Unix(),
	}

	bytes, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	return c.kafkaWriter.WriteMessages(ctx, kafka.Message{
		Key:   []byte(match.OrderID), // Explicit hashing key for order.assigned [cite: 76]
		Value: bytes,
	})
}

func (c *OrderCreatedConsumer) Close() error {
	_ = c.kafkaReader.Close()
	return c.kafkaWriter.Close()
}
