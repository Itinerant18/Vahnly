package consumer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"strings"
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
	"github.com/platform/driver-delivery/internal/messaging/kafkacfg"
	"github.com/platform/driver-delivery/internal/observability"
	"github.com/platform/driver-delivery/internal/rider/realtime"
	"go.opentelemetry.io/otel"
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
	orderRetryWriter   *kafka.Writer
	dlq                *kafkacfg.DLQ
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

	// MILESTONE 8: Ingestion Velocity Tracker Extensions
	lastFlushTime      time.Time
	rollingArrivalRate float64 // EWMA orders calculated per second
}

func NewOrderCreatedConsumer(brokers []string, groupID string, scanner *repository.SpatialScanner, redisClient *redis.ClusterClient, db *pgxpool.Pool, algoStrategy string, optionalArgs ...matcher.ETACorrector) *OrderCreatedConsumer {
	var etaCorrector matcher.ETACorrector
	if len(optionalArgs) > 0 {
		etaCorrector = optionalArgs[0]
	}
	sec := kafkacfg.FromEnv()
	c := &OrderCreatedConsumer{
		kafkaReader: kafka.NewReader(kafka.ReaderConfig{
			Brokers:        brokers,
			Topic:          "order.created",
			GroupID:        groupID,
			MinBytes:       10,
			MaxBytes:       10e6,
			CommitInterval: 0,
			Dialer:         sec.Dialer(),
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
		orderRetryWriter: &kafka.Writer{
			Addr:         kafka.TCP(brokers...),
			Topic:        "order.created",
			Balancer:     &kafka.Hash{},
			RequiredAcks: kafka.RequireOne,
		},
		dlq:                kafkacfg.NewDLQ(brokers, "order.created.dlq", sec),
		spatialScanner:     scanner,
		redisClusterClient: redisClient,
		dbPool:             db,
		etaCorrector:       etaCorrector,
		batchWindow:        300 * time.Millisecond, // Default/Initial baseline window
		maxBatchSize:       150,                    // Hard limit protection boundary
		orderBuffer:        make([]domain.OrderCreatedPayload, 0),
		currentAlgo:        algoStrategy,
		lastFlushTime:      time.Now(),
		rollingArrivalRate: 0.0,
	}
	// Secure all producers with the same SASL/TLS as the reader.
	sec.ApplyToWriter(c.kafkaWriter)
	sec.ApplyToWriter(c.driverStateWriter)
	sec.ApplyToWriter(c.orderRetryWriter)
	return c
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
				if errors.Is(err, context.Canceled) || ctx.Err() != nil || errors.Is(err, io.EOF) || strings.Contains(err.Error(), "closed") {
					return
				}
				log.Printf("Kafka bus read error: %v", err)
				continue
			}

			// MILESTONE 18: Extract distributed trace context attributes from Kafka headers
			carrier := observability.KafkaHeaderCarrier{Headers: &msg.Headers}
			extractedCtx := otel.GetTextMapPropagator().Extract(ctx, carrier)

			var order domain.OrderCreatedPayload
			if err := json.Unmarshal(msg.Value, &order); err != nil {
				// Unprocessable payload: route to the DLQ for inspection/replay, then
				// commit so it doesn't block or silently vanish from the partition.
				if dlqErr := c.dlq.Publish(ctx, msg, "json_unmarshal_failed: "+err.Error()); dlqErr != nil {
					log.Printf("Malformed JSON event AND DLQ publish failed (will not commit, retry later): dlq=%v parse=%v", dlqErr, err)
					continue // leave uncommitted so we retry rather than lose the event
				}
				log.Printf("Malformed JSON event routed to order.created.dlq: %v", err)
				_ = c.kafkaReader.CommitMessages(ctx, msg)
				continue
			}

			order.KafkaMessageContext = msg
			order.StoredContext = extractedCtx

			// Start a processing execution span linked to the parent trace context
			tracer := otel.GetTracerProvider().Tracer(observability.GlobalTracerName)
			_, span := tracer.Start(extractedCtx, "order_consumer.PipelineAggregationStage")
			span.End() // Closes briefly to satisfy local metrics profile mappings

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
				// Reinstate timer matching active dynamically shifted duration metrics
				c.windowTimer.Reset(c.batchWindow)
				c.mu.Unlock()
				continue
			}

			batchToProcess := c.orderBuffer
			c.orderBuffer = make([]domain.OrderCreatedPayload, 0)

			// MILESTONE 8 ALGORITHM: EWMA Velocity Balancing Computation Phase
			now := time.Now()
			elapsedSeconds := now.Sub(c.lastFlushTime).Seconds()
			c.lastFlushTime = now

			if elapsedSeconds > 0 {
				momentaryRate := float64(len(batchToProcess)) / elapsedSeconds
				if c.rollingArrivalRate == 0.0 {
					c.rollingArrivalRate = momentaryRate // Seed value on startup execution
				} else {
					// Smooth weighting coefficient filter (alpha = 0.3)
					c.rollingArrivalRate = (0.3 * momentaryRate) + (0.7 * c.rollingArrivalRate)
				}
			}

			// Dynamically adapt batch window scale matching rolling marketplace ingestion constraints
			if c.rollingArrivalRate < 10.0 {
				c.batchWindow = 100 * time.Millisecond // Low off-peak rate: drop latency for rapid pairings
			} else if c.rollingArrivalRate > 60.0 {
				c.batchWindow = 400 * time.Millisecond // High peak rate: extend window for combinatorial mapping pool sizes
			} else {
				// Linear scale transposition matching steady localized growth steps
				c.batchWindow = time.Duration(100+int((c.rollingArrivalRate-10.0)*6.0)) * time.Millisecond
			}

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

			parentCtx := o.StoredContext
			if parentCtx == nil {
				parentCtx = ctx
			}
			orderCtx, cancel := context.WithTimeout(parentCtx, 350*time.Millisecond)
			defer cancel()

			candidates, err := c.spatialScanner.ScanNearbyDrivers(orderCtx, o.CityPrefix, o.PickupH3Cell)
			if err != nil || len(candidates) == 0 {
				log.Printf("Greedy worker starvation or failure on order %s. Routing to re-queue.", o.OrderID)
				observability.OrdersUnmatchedTotal.WithLabelValues("starvation").Inc()
				c.requeueUnmatchedOrder(ctx, o)
				mu.Lock()
				collectedMessages = append(collectedMessages, o.KafkaMessageContext)
				mu.Unlock()
				return
			}

			// Filter out candidates on active match cooldown
			var validCandidates []matcher.CandidateDriver
			for _, d := range candidates {
				cooldownKey := fmt.Sprintf("cooldown:driver:%s", d.DriverID)
				exists, err := c.redisClusterClient.Exists(orderCtx, cooldownKey).Result()
				if err == nil && exists > 0 {
					continue // Skip this driver; they recently declined or timed out an offer
				}
				validCandidates = append(validCandidates, d)
			}

			if len(validCandidates) == 0 {
				log.Printf("Greedy worker starvation after cooldown filter on order %s. Routing to re-queue.", o.OrderID)
				observability.OrdersUnmatchedTotal.WithLabelValues("starvation").Inc()
				c.requeueUnmatchedOrder(ctx, o)
				mu.Lock()
				collectedMessages = append(collectedMessages, o.KafkaMessageContext)
				mu.Unlock()
				return
			}

			optimalMatch, matchErr := matcher.EvaluateGreedyMatch(orderCtx, o, o.PickupOSMNodeID, validCandidates, c.etaCorrector)
			if matchErr != nil {
				log.Printf("Greedy match failed for order %s: %v. Routing to recovery path.", o.OrderID, matchErr)
				observability.OrdersUnmatchedTotal.WithLabelValues("match_failure").Inc()
				c.requeueUnmatchedOrder(ctx, o)
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

			mu.Lock()
			collectedMessages = append(collectedMessages, o.KafkaMessageContext)
			mu.Unlock()

			emitParentCtx := o.StoredContext
			if emitParentCtx == nil {
				emitParentCtx = ctx
			}
			emitCtx, emitCancel := context.WithTimeout(emitParentCtx, 2*time.Second)
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

func (c *OrderCreatedConsumer) executeHungarianBatchPool(ctx context.Context, orders []domain.OrderCreatedPayload) {
	batchCtx, cancel := context.WithTimeout(ctx, 400*time.Millisecond)
	defer cancel()

	driverLocationMap := make(map[string][]matcher.CandidateDriver)
	uniqueDriverTracker := make(map[string]matcher.CandidateDriver)
	var mapMu sync.Mutex
	var wg sync.WaitGroup

	for _, order := range orders {
		wg.Add(1)
		go func(o domain.OrderCreatedPayload) {
			defer wg.Done()
			candidates, err := c.spatialScanner.ScanNearbyDrivers(batchCtx, o.CityPrefix, o.PickupH3Cell)
			if err != nil {
				return
			}

			// Filter out candidates on active match cooldown
			var validCandidates []matcher.CandidateDriver
			for _, d := range candidates {
				cooldownKey := fmt.Sprintf("cooldown:driver:%s", d.DriverID)
				exists, err := c.redisClusterClient.Exists(batchCtx, cooldownKey).Result()
				if err == nil && exists > 0 {
					continue // Skip this driver; they recently declined or timed out an offer
				}
				validCandidates = append(validCandidates, d)
			}

			mapMu.Lock()
			driverLocationMap[o.OrderID] = validCandidates
			for _, d := range validCandidates {
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
	matches, err := matcher.EvaluateHungarianBatch(batchCtx, orders, uniqueDrivers, driverLocationMap, c.etaCorrector)
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
			matchedCity := ""
			if oEvent, found := orderMap[matchItem.OrderID]; found {
				matchedCity = oEvent.CityPrefix
			}
			observability.OrdersMatchedTotal.WithLabelValues("HUNGARIAN", matchedCity).Inc()
			matchedOrderIDs[matchItem.OrderID] = true
			// Collect offset BEFORE emit — DB already mutated, partition must advance regardless
			if oEvent, found := orderMap[matchItem.OrderID]; found {
				if err := c.evictAssignedDriver(ctx, oEvent.CityPrefix, &matchItem); err != nil {
					log.Printf("Redis spatial eviction failed for driver %s: %v", matchItem.DriverID, err)
				}
				collectedMessages = append(collectedMessages, oEvent.KafkaMessageContext)
			}

			// Use a fresh context for emits so the tight batchCtx doesn't starve them
			var emitParentCtx context.Context = ctx
			if oEvent, found := orderMap[matchItem.OrderID]; found && oEvent.StoredContext != nil {
				emitParentCtx = oEvent.StoredContext
			}
			emitCtx, emitCancel := context.WithTimeout(emitParentCtx, 2*time.Second)
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
				log.Printf("Marketplace Starvation (HUNGARIAN): No available drivers near cell %s. Routing to re-queue.", o.PickupH3Cell)
				observability.OrdersUnmatchedTotal.WithLabelValues("starvation").Inc()
			} else {
				log.Printf("Hungarian: Order %s had %d candidates but no valid assignment (contention conflict). Routing to re-queue.", o.OrderID, len(driverLocationMap[o.OrderID]))
				observability.OrdersUnmatchedTotal.WithLabelValues("fully_allocated").Inc()
			}
			c.requeueUnmatchedOrder(ctx, o) // MILESTONE 3
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

// MILESTONE 3: Execute state-bounded re-injection onto the stream with exponential delay backing
func (c *OrderCreatedConsumer) requeueUnmatchedOrder(ctx context.Context, o domain.OrderCreatedPayload) {
	const maxMarketplaceRetries = 3
	if o.RetryCount >= maxMarketplaceRetries {
		log.Printf("[DLQ_EXPIRED] Order %s crossed max execution threshold (%d). Discarding booking request permanently.", o.OrderID, maxMarketplaceRetries)
		observability.OrdersUnmatchedTotal.WithLabelValues("dlq_expired").Inc()
		return
	}

	o.RetryCount++
	payloadBytes, err := json.Marshal(o)
	if err != nil {
		log.Printf("Failed marshaling retry context payload: %v", err)
		return
	}

	// Calculate a backoff delay value based on retry depth to prevent network thrashing
	backoffWait := time.Duration(o.RetryCount*150) * time.Millisecond

	go func(delay time.Duration, key string, val []byte) {
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay): // Holds execution line briefly matching backoff constraints
			writeCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()

			var msgHeaders []kafka.Header
			carrier := observability.KafkaHeaderCarrier{Headers: &msgHeaders}
			injectCtx := o.StoredContext
			if injectCtx == nil {
				injectCtx = writeCtx
			}
			otel.GetTextMapPropagator().Inject(injectCtx, carrier)

			err := c.orderRetryWriter.WriteMessages(writeCtx, kafka.Message{
				Key:     []byte(key),
				Value:   val,
				Headers: msgHeaders,
			})
			if err != nil {
				log.Printf("[REQUEUE_STREAM_ERROR] Failed re-emitting order %s onto bus: %v", key, err)
			} else {
				log.Printf("[REQUEUE_SUCCESS] Order %s successfully re-injected onto stream. Retry Depth: %d/%d", key, o.RetryCount, maxMarketplaceRetries)
			}
		}
	}(backoffWait, o.OrderID, payloadBytes)
}

func (c *OrderCreatedConsumer) commitAssignmentTransaction(ctx context.Context, match *matcher.MatchResult) error {
	tx, err := c.dbPool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

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

	// Guard the driver update the same way the order update is guarded: only transition
	// an ONLINE_AVAILABLE driver. Two concurrent batches (GREEDY goroutines, or two pods
	// on different Kafka partitions) can both scan the same driver in their ZSET window;
	// the first commit wins, the second sees RowsAffected == 0 and the transaction rolls
	// back so its order is re-queued and matched to a different driver.
	driverQuery := `
		UPDATE drivers
		SET current_state = 'ONLINE_EN_ROUTE'::driver_state_enum, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1::uuid AND current_state = 'ONLINE_AVAILABLE'::driver_state_enum;
	`
	res, err = tx.Exec(ctx, driverQuery, match.DriverID)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return fmt.Errorf("driver_already_allocated: %s", match.DriverID)
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

	err = tx.Commit(ctx)
	if err != nil {
		return err
	}

	// Post-commit: Initialize the 15-second tracking lease inside the Redis Cluster
	leaseKey := fmt.Sprintf("offer:lease:%s", match.OrderID)
	err = c.redisClusterClient.Set(ctx, leaseKey, match.DriverID, 15*time.Second).Err()
	if err != nil {
		log.Printf("[WARNING] Failed setting Redis offer lease for order %s: %v", match.OrderID, err)
	}

	return nil
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

	var msgHeaders []kafka.Header
	carrier := observability.KafkaHeaderCarrier{Headers: &msgHeaders}
	otel.GetTextMapPropagator().Inject(ctx, carrier)

	return c.driverStateWriter.WriteMessages(ctx, kafka.Message{
		Key:     []byte(driverID),
		Value:   bytes,
		Headers: msgHeaders,
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

	var msgHeaders []kafka.Header
	carrier := observability.KafkaHeaderCarrier{Headers: &msgHeaders}
	otel.GetTextMapPropagator().Inject(ctx, carrier)

	// Rider live-trip WS: order assigned. Fire-and-forget so it never adds latency
	// to the matching/assignment hot path (rule #3).
	go c.pushRiderAssigned(match.OrderID, match.DriverID, match.EstimatedEtaSeconds)

	return c.kafkaWriter.WriteMessages(ctx, kafka.Message{
		Key:     []byte(match.OrderID),
		Value:   bytes,
		Headers: msgHeaders,
	})
}

// pushRiderAssigned enriches the assignment (driver + garage car) and pushes
// rider.order.assigned to the rider WS, with a notification_outbox FCM backup.
func (c *OrderCreatedConsumer) pushRiderAssigned(orderID, driverID string, etaSeconds int) {
	if c.redisClusterClient == nil || c.dbPool == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	var riderID, driverName, carMake, carModel, carTransmission *string
	var driverRating *float64
	err := c.dbPool.QueryRow(ctx, `
		SELECT o.rider_id::text, d.name, d.rating, g.make, g.model, g.transmission
		FROM orders o
		LEFT JOIN drivers d ON d.id = o.assigned_driver_id
		LEFT JOIN rider_garage g ON g.id = o.garage_car_id
		WHERE o.id = $1::uuid`, orderID).Scan(&riderID, &driverName, &driverRating, &carMake, &carModel, &carTransmission)
	if err != nil || riderID == nil || *riderID == "" {
		return
	}

	vehicleContext := ""
	if carMake != nil && carModel != nil {
		vehicleContext = fmt.Sprintf("Driving your %s %s", *carMake, *carModel)
	}
	data := map[string]interface{}{
		"order_id":               orderID,
		"driver_id":              driverID,
		"driver_name":            derefStr(driverName),
		"driver_photo":           "",
		"driver_rating":          derefFloat(driverRating),
		"driver_trips_count":     0,
		"transmission_expertise": derefStr(carTransmission),
		"eta_minutes":            etaSeconds / 60,
		"eta_km":                 0,
		"vehicle_context":        vehicleContext,
	}
	_ = realtime.Publish(ctx, c.redisClusterClient, *riderID, realtime.MsgOrderAssigned, data)

	// FCM backup via the transactional outbox.
	if payload, mErr := json.Marshal(data); mErr == nil {
		_, _ = c.dbPool.Exec(ctx, `
			INSERT INTO notification_outbox (user_id, title, body, payload, status)
			VALUES ($1::uuid, 'Driver assigned', $2, $3::jsonb, 'PENDING')`,
			*riderID, vehicleContext, payload)
	}
}

func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func derefFloat(f *float64) float64 {
	if f == nil {
		return 0
	}
	return *f
}

func (c *OrderCreatedConsumer) Close() error {
	_ = c.kafkaReader.Close()
	_ = c.driverStateWriter.Close()
	_ = c.orderRetryWriter.Close()
	_ = c.dlq.Close()
	return c.kafkaWriter.Close()
}

// MatchPayload defines match details sent downstream
type MatchPayload struct {
	OrderID       string  `json:"order_id"`
	DriverID      string  `json:"driver_id"`
	RiderName     string  `json:"rider_name"`
	RiderRating   float64 `json:"rider_rating"`
	PickupAddress string  `json:"pickup_address"`
	DropAddress   string  `json:"drop_address"`
	TripType      string  `json:"trip_type"`
	ETAMinutes    int     `json:"eta_minutes"`
	EstimatedFare int64   `json:"estimated_fare"`
}

// OrderConsumer processes match events and sends them down driver WebSocket connections
type OrderConsumer struct {
	webSocketManager *WebSocketManager
	dispatchEngine   *DispatchEngine
}

// NewOrderConsumer creates a new OrderConsumer
func NewOrderConsumer(redisClient *redis.ClusterClient) *OrderConsumer {
	return &OrderConsumer{
		webSocketManager: &WebSocketManager{redisClusterClient: redisClient},
		dispatchEngine:   &DispatchEngine{redisClusterClient: redisClient},
	}
}

// ProcessMatch listens to Kafka topic "dispatch.matches"
func (c *OrderConsumer) ProcessMatch(matchEvent MatchPayload) {
	// Construct the exact payload expected by the frontend Modal
	offerPayload := map[string]interface{}{
		"type": "OFFER_PENDING",
		"data": map[string]interface{}{
			"order_id":        matchEvent.OrderID,
			"rider_name":      matchEvent.RiderName,
			"rider_rating":    matchEvent.RiderRating,
			"pickup_address":  matchEvent.PickupAddress,
			"drop_address":    matchEvent.DropAddress,
			"trip_type":       matchEvent.TripType, // CITY, OUTSTATION
			"eta_minutes":     matchEvent.ETAMinutes,
			"fare_estimate":   matchEvent.EstimatedFare,
			"expires_in_secs": 15, // The strict countdown window
		},
	}

	// Push down the driver's specific WebSocket channel
	err := c.webSocketManager.SendToUser(matchEvent.DriverID, offerPayload)
	if err != nil {
		// If socket fails, release the match back to the greedy matcher instantly
		c.dispatchEngine.ReleaseMatch(matchEvent.OrderID)
	}
}

// WebSocketManager handles active driver WebSocket message transmissions
type WebSocketManager struct {
	redisClusterClient *redis.ClusterClient
}

// SendToUser pushes a message down the driver's specific WebSocket connection
func (w *WebSocketManager) SendToUser(driverID string, payload interface{}) error {
	if w.redisClusterClient != nil {
		bytes, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		// Publish to the broadcast channel so the gateway session handles it
		return w.redisClusterClient.Publish(context.Background(), "gateway:assignments:broadcast", string(bytes)).Err()
	}
	return nil
}

// DispatchEngine manages order dispatch lifecycle state
type DispatchEngine struct {
	redisClusterClient *redis.ClusterClient
}

// ReleaseMatch releases the match back to the matcher
func (e *DispatchEngine) ReleaseMatch(orderID string) {
	// Clean up lease and reset order status
	ctx := context.Background()
	if e.redisClusterClient != nil {
		leaseKey := fmt.Sprintf("offer:lease:%s", orderID)
		_ = e.redisClusterClient.Del(ctx, leaseKey).Err()
	}
}
