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
	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"

	"github.com/platform/driver-delivery/internal/dispatch/domain"
	"github.com/platform/driver-delivery/internal/dispatch/matcher"
	"github.com/platform/driver-delivery/internal/dispatch/repository"
	"github.com/platform/driver-delivery/internal/events"
	"github.com/platform/driver-delivery/internal/observability"
)

const maxHungarianCommitWorkers = 16

type hungarianCommitResult struct {
	match    matcher.MatchResult
	err      error
	duration time.Duration
}

type OrderCreatedConsumer struct {
	kafkaReader        *kafka.Reader
	kafkaWriter        *kafka.Writer
	driverStateWriter  *kafka.Writer
	spatialScanner     *repository.SpatialScanner
	redisClusterClient *redis.ClusterClient
	dbPool             *pgxpool.Pool
	etaCorrector       matcher.ETACorrector

	// Batch window synchronization structures
	mu           sync.Mutex
	batchWindow  time.Duration
	maxBatchSize int
	orderBuffer  []domain.OrderCreatedPayload
	windowTimer  *time.Timer
	currentAlgo  string
}

func NewOrderCreatedConsumer(brokers []string, groupID string, scanner *repository.SpatialScanner, redisClient *redis.ClusterClient, db *pgxpool.Pool, algoStrategy string, optionalArgs ...matcher.ETACorrector) *OrderCreatedConsumer {
	var etaCorrector matcher.ETACorrector
	if len(optionalArgs) > 0 {
		etaCorrector = optionalArgs[0]
	}
	return &OrderCreatedConsumer{
		kafkaReader: kafka.NewReader(kafka.ReaderConfig{
			Brokers:        brokers,
			Topic:          "order.created",
			GroupID:        groupID,
			MinBytes:       10,
			MaxBytes:       10e6,
			CommitInterval: 0, // Explicit synchronous manual commits only
		}),
		kafkaWriter: &kafka.Writer{
			Addr:         kafka.TCP(brokers...),
			Topic:        "order.assigned",
			Balancer:     &kafka.Hash{},
			RequiredAcks: kafka.RequireOne,
		},
		driverStateWriter: &kafka.Writer{
			Addr:         kafka.TCP(brokers...),
			Topic:        "driver.state.changed",
			Balancer:     &kafka.Hash{},
			RequiredAcks: kafka.RequireOne,
		},
		spatialScanner:     scanner,
		redisClusterClient: redisClient,
		dbPool:             db,
		etaCorrector:       etaCorrector,
		batchWindow:        300 * time.Millisecond,
		maxBatchSize:       150,
		orderBuffer:        make([]domain.OrderCreatedPayload, 0),
		currentAlgo:        algoStrategy,
	}
}

func (c *OrderCreatedConsumer) StartExecutionPipeline(ctx context.Context) {
	log.Printf("Starting Order Matching Engine loop. Running strategy: %s", c.currentAlgo)

	c.mu.Lock()
	c.windowTimer = time.NewTimer(c.batchWindow)
	c.mu.Unlock()

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
				_ = c.kafkaReader.CommitMessages(ctx, msg)
				continue
			}

			order.KafkaMessageContext = msg

			c.mu.Lock()
			c.orderBuffer = append(c.orderBuffer, order)

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
	c.windowTimer.Reset(0)
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

			batchToProcess := c.orderBuffer
			c.orderBuffer = make([]domain.OrderCreatedPayload, 0)
			c.windowTimer.Reset(c.batchWindow)
			c.mu.Unlock()

			c.executeMatchingBatch(ctx, batchToProcess)
		}
	}
}

func (c *OrderCreatedConsumer) executeMatchingBatch(ctx context.Context, orders []domain.OrderCreatedPayload) {
	if len(orders) == 0 {
		return
	}

	batchStart := time.Now()
	observability.BatchSizeHistogram.Observe(float64(len(orders)))

	// 1. Route to Global Hungarian Solver if specified by the runtime configuration
	if c.currentAlgo == "HUNGARIAN" {
		c.executeHungarianBatchPool(ctx, orders)
		observability.BatchDurationSeconds.WithLabelValues("HUNGARIAN").Observe(time.Since(batchStart).Seconds())
		return
	}

	// 2. Fallback to fixed high-speed parallel greedy loop execution paths
	var wg sync.WaitGroup
	var (
		collectedMessages []kafka.Message
		mu                sync.Mutex
	)

	for _, order := range orders {
		wg.Add(1)
		go func(o domain.OrderCreatedPayload) {
			defer wg.Done()

			orderCtx, cancel := context.WithTimeout(ctx, 350*time.Millisecond)
			defer cancel()

			candidates, metrics, err := c.spatialScanner.ScanNearbyDrivers(orderCtx, o.CityPrefix, o.PickupH3Cell)
			if err != nil || len(candidates) == 0 {
				log.Printf("Greedy worker starvation or failure on order %s. Advancing offset.", o.OrderID)
				observability.OrdersUnmatchedTotal.WithLabelValues("starvation").Inc()
				mu.Lock()
				collectedMessages = append(collectedMessages, o.KafkaMessageContext)
				mu.Unlock()
				return
			}

			optimalMatch, matchErr := matcher.EvaluateGreedyMatch(orderCtx, o, o.PickupOSMNodeID, candidates, c.etaCorrector, metrics)
			if matchErr != nil {
				log.Printf("Greedy match failed for order %s: %v. Advancing offset.", o.OrderID, matchErr)
				observability.OrdersUnmatchedTotal.WithLabelValues("match_failure").Inc()
				mu.Lock()
				collectedMessages = append(collectedMessages, o.KafkaMessageContext)
				mu.Unlock()
				return
			}

			txStart := time.Now()
			err = c.commitAssignmentTransaction(orderCtx, optimalMatch)
			if err != nil {
				observability.DBTransactionDurationSeconds.WithLabelValues("error").Observe(time.Since(txStart).Seconds())
				if errors.Is(err, pgx.ErrNoRows) {
					// Idempotency: order already assigned by a concurrent worker
					mu.Lock()
					collectedMessages = append(collectedMessages, o.KafkaMessageContext)
					mu.Unlock()
				}
				return
			}
			observability.DBTransactionDurationSeconds.WithLabelValues("success").Observe(time.Since(txStart).Seconds())
			observability.OrdersMatchedTotal.WithLabelValues("GREEDY", o.CityPrefix).Inc()
			if err := c.evictAssignedDriver(ctx, o.CityPrefix, optimalMatch); err != nil {
				log.Printf("Redis spatial eviction failed for driver %s: %v", optimalMatch.DriverID, err)
			}

			// Collect offset BEFORE emit attempts — DB is already mutated so we must
			// advance the partition regardless of downstream publish success.
			mu.Lock()
			collectedMessages = append(collectedMessages, o.KafkaMessageContext)
			mu.Unlock()

			// Use a fresh context for downstream Kafka emits so the tight orderCtx
			// deadline doesn't starve fire-and-forget event notifications.
			emitCtx, emitCancel := context.WithTimeout(ctx, 2*time.Second)
			defer emitCancel()

			if err := c.emitAssignedEvent(emitCtx, optimalMatch); err != nil {
				log.Printf("order.assigned emit failed for order %s: %v", o.OrderID, err)
				observability.KafkaEmitErrorsTotal.WithLabelValues("order.assigned").Inc()
			}
			if err := c.emitDriverStateChanged(emitCtx, o.CityPrefix, optimalMatch.DriverH3Cell, optimalMatch.DriverID, "ONLINE_AVAILABLE", "ONLINE_EN_ROUTE"); err != nil {
				log.Printf("Driver state event publish failed for driver %s: %v", optimalMatch.DriverID, err)
				observability.KafkaEmitErrorsTotal.WithLabelValues("driver.state.changed").Inc()
			}
		}(order)
	}
	wg.Wait()

	observability.BatchDurationSeconds.WithLabelValues("GREEDY").Observe(time.Since(batchStart).Seconds())

	if len(collectedMessages) > 0 {
		_ = c.kafkaReader.CommitMessages(ctx, collectedMessages...)
	}
}

// executeHungarianBatchPool resolves matching logic globally across all buffered entries
func (c *OrderCreatedConsumer) executeHungarianBatchPool(ctx context.Context, orders []domain.OrderCreatedPayload) {
	batchCtx, cancel := context.WithTimeout(ctx, 400*time.Millisecond)
	defer cancel()

	driverLocationMap := make(map[string][]matcher.CandidateDriver)
	orderMetricsMap := make(map[string]matcher.MarketplaceMetrics)
	uniqueDriverTracker := make(map[string]matcher.CandidateDriver)
	var mapMu sync.Mutex
	var wg sync.WaitGroup

	// Fetch candidates across cells concurrently using separate threads to satisfy the SLA limits
	for _, order := range orders {
		wg.Add(1)
		go func(o domain.OrderCreatedPayload) {
			defer wg.Done()
			candidates, metrics, err := c.spatialScanner.ScanNearbyDrivers(batchCtx, o.CityPrefix, o.PickupH3Cell)
			if err != nil {
				return
			}

			mapMu.Lock()
			driverLocationMap[o.OrderID] = candidates
			orderMetricsMap[o.OrderID] = metrics
			for _, d := range candidates {
				uniqueDriverTracker[d.DriverID] = d
			}
			mapMu.Unlock()
		}(order)
	}
	wg.Wait()

	var uniqueDrivers []matcher.CandidateDriver
	for _, d := range uniqueDriverTracker {
		uniqueDrivers = append(uniqueDrivers, d)
	}

	observability.CostMatrixDimension.Observe(float64(max(len(orders), len(uniqueDrivers))))

	// Pass compiled pools directly to the global solver
	matches, err := matcher.EvaluateHungarianBatch(batchCtx, orders, uniqueDrivers, driverLocationMap, c.etaCorrector, orderMetricsMap)
	if err != nil {
		log.Printf("[HUNGARIAN_BATCH_ERROR] Matrix optimization failed: %v", err)
		return
	}

	var collectedMessages []kafka.Message
	orderMap := make(map[string]domain.OrderCreatedPayload)
	for _, o := range orders {
		orderMap[o.OrderID] = o
	}

	matchedOrderIDs := make(map[string]bool)
	failedCommitOrderIDs := make(map[string]bool)

	for _, result := range c.commitHungarianMatches(batchCtx, matches) {
		matchItem := result.match
		if result.err == nil {
			observability.DBTransactionDurationSeconds.WithLabelValues("success").Observe(result.duration.Seconds())
			observability.OrdersMatchedTotal.WithLabelValues("HUNGARIAN", "").Inc()
			matchedOrderIDs[matchItem.OrderID] = true
			// Collect offset BEFORE emit — DB already mutated, partition must advance regardless
			if oEvent, found := orderMap[matchItem.OrderID]; found {
				if err := c.evictAssignedDriver(ctx, oEvent.CityPrefix, &matchItem); err != nil {
					log.Printf("Redis spatial eviction failed for driver %s: %v", matchItem.DriverID, err)
				}
				collectedMessages = append(collectedMessages, oEvent.KafkaMessageContext)
			}

			// Use a fresh context for emits so the tight batchCtx doesn't starve them
			emitCtx, emitCancel := context.WithTimeout(ctx, 2*time.Second)
			if err := c.emitAssignedEvent(emitCtx, &matchItem); err != nil {
				log.Printf("order.assigned emit failed for order %s: %v", matchItem.OrderID, err)
				observability.KafkaEmitErrorsTotal.WithLabelValues("order.assigned").Inc()
			}
			if oEvent, found := orderMap[matchItem.OrderID]; found {
				if err := c.emitDriverStateChanged(emitCtx, oEvent.CityPrefix, matchItem.DriverH3Cell, matchItem.DriverID, "ONLINE_AVAILABLE", "ONLINE_EN_ROUTE"); err != nil {
					log.Printf("Driver state event publish failed for driver %s: %v", matchItem.DriverID, err)
					observability.KafkaEmitErrorsTotal.WithLabelValues("driver.state.changed").Inc()
				}
			}
			emitCancel()
		} else if errors.Is(result.err, pgx.ErrNoRows) {
			observability.DBTransactionDurationSeconds.WithLabelValues("idempotent").Observe(result.duration.Seconds())
			// Idempotency: already assigned by a concurrent batch
			matchedOrderIDs[matchItem.OrderID] = true
			if oEvent, found := orderMap[matchItem.OrderID]; found {
				collectedMessages = append(collectedMessages, oEvent.KafkaMessageContext)
			}
		} else {
			observability.DBTransactionDurationSeconds.WithLabelValues("error").Observe(result.duration.Seconds())
			failedCommitOrderIDs[matchItem.OrderID] = true
		}
	}

	// Advance offsets for all solver-unmatched orders; retry transient DB failures.
	for _, o := range orders {
		if failedCommitOrderIDs[o.OrderID] {
			log.Printf("Hungarian: DB commit failed for order %s. Leaving offset uncommitted for retry.", o.OrderID)
			continue
		}
		if !matchedOrderIDs[o.OrderID] {
			if len(driverLocationMap[o.OrderID]) == 0 {
				log.Printf("Marketplace Starvation (HUNGARIAN): No available drivers near cell %s. Advancing offset.", o.PickupH3Cell)
				observability.OrdersUnmatchedTotal.WithLabelValues("starvation").Inc()
			} else {
				log.Printf("Hungarian: Order %s had %d candidates but no valid assignment (all drivers allocated). Advancing offset.", o.OrderID, len(driverLocationMap[o.OrderID]))
				observability.OrdersUnmatchedTotal.WithLabelValues("fully_allocated").Inc()
			}
			collectedMessages = append(collectedMessages, o.KafkaMessageContext)
		}
	}

	// Acknowledge all processed offsets cleanly inside a single network pass
	if len(collectedMessages) > 0 {
		if err := c.kafkaReader.CommitMessages(ctx, collectedMessages...); err != nil {
			log.Printf("[HUNGARIAN_COMMIT_ERROR] Failed batch partition progression: %v", err)
		}
	}
}

func (c *OrderCreatedConsumer) commitHungarianMatches(ctx context.Context, matches []matcher.MatchResult) []hungarianCommitResult {
	if len(matches) == 0 {
		return nil
	}

	workerCount := min(maxHungarianCommitWorkers, len(matches))
	jobs := make(chan matcher.MatchResult)
	results := make(chan hungarianCommitResult, len(matches))

	var wg sync.WaitGroup
	for worker := 0; worker < workerCount; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for match := range jobs {
				matchItem := match
				txStart := time.Now()
				err := c.commitAssignmentTransaction(ctx, &matchItem)
				results <- hungarianCommitResult{
					match:    matchItem,
					err:      err,
					duration: time.Since(txStart),
				}
			}
		}()
	}

	var enqueueErr error
enqueueMatches:
	for _, match := range matches {
		select {
		case jobs <- match:
		case <-ctx.Done():
			enqueueErr = ctx.Err()
			break enqueueMatches
		}
	}
	close(jobs)
	wg.Wait()
	close(results)

	collected := make([]hungarianCommitResult, 0, len(matches))
	for result := range results {
		collected = append(collected, result)
	}
	if enqueueErr != nil {
		for _, match := range matches[len(collected):] {
			collected = append(collected, hungarianCommitResult{
				match: match,
				err:   enqueueErr,
			})
		}
	}

	return collected
}

func (c *OrderCreatedConsumer) commitAssignmentTransaction(ctx context.Context, match *matcher.MatchResult) error {
	tx, err := c.dbPool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Enforce linear state trajectory constraint
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

	// If row count is 0, the state check failed or another thread processed the order
	if res.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}

	// Update the localized driver status to ONLINE_EN_ROUTE in relational storage
	driverQuery := `
		UPDATE drivers
		SET current_state = 'ONLINE_EN_ROUTE'::driver_state_enum, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1::uuid;
	`
	_, err = tx.Exec(ctx, driverQuery, match.DriverID)
	if err != nil {
		return err
	}

	// Log metrics metadata to the immutable audit ledger
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

func (c *OrderCreatedConsumer) evictAssignedDriver(ctx context.Context, cityPrefix string, match *matcher.MatchResult) error {
	evictCtx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	defer cancel()
	return c.spatialScanner.EvictDriverFromCell(evictCtx, cityPrefix, match.DriverH3Cell, match.DriverID)
}

func (c *OrderCreatedConsumer) emitDriverStateChanged(ctx context.Context, cityPrefix, h3Cell, driverID, previousState, currentState string) error {
	payload := events.DriverStateChangedEvent{
		DriverID:      driverID,
		CityPrefix:    cityPrefix,
		PreviousState: previousState,
		CurrentState:  currentState,
		H3Cell:        h3Cell,
		Timestamp:     time.Now(),
	}
	bytes, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return c.driverStateWriter.WriteMessages(ctx, kafka.Message{
		Key:   []byte(driverID),
		Value: bytes,
	})
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
		Key:   []byte(match.OrderID), // Explicit hashing key for order.assigned
		Value: bytes,
	})
}

func (c *OrderCreatedConsumer) Close() error {
	_ = c.kafkaReader.Close()
	_ = c.driverStateWriter.Close()
	return c.kafkaWriter.Close()
}
