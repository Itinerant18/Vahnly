package http

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"

	dispatchDomain "github.com/platform/driver-delivery/internal/dispatch/domain"
	"github.com/platform/driver-delivery/internal/events"
	pricingSvc "github.com/platform/driver-delivery/internal/pricing/service"
	"go.opentelemetry.io/otel"
	"github.com/platform/driver-delivery/internal/observability"
)

const RedisPubSubChannel = "gateway:assignments:broadcast"
const RedisTelemetryChannel = "gateway:telemetry:broadcast"

// ActiveWebSocketSession encapsulates everything needed for active connection management
type ActiveWebSocketSession struct {
	MessageChan chan []byte
	Connection  *websocket.Conn
}

type GatewayHandler struct {
	dbPool            *pgxpool.Pool
	kafkaWriter       *kafka.Writer
	driverStateWriter *kafka.Writer
	pricingService    *pricingSvc.OrderPricingService
	clusterClient     *redis.ClusterClient
	upgrader          websocket.Upgrader

	// Thread-safe local session registry mapping active order IDs to WebSocket metadata
	localSessions sync.Map
}

func NewGatewayHandler(db *pgxpool.Pool, kw *kafka.Writer, ps *pricingSvc.OrderPricingService, client *redis.ClusterClient) *GatewayHandler {
	return &GatewayHandler{
		dbPool:      db,
		kafkaWriter: kw,
		// Dedicated producer for the "driver became available" half of the
		// driver.state.changed contract. Reuses the order-writer broker address so
		// no constructor wiring changes are needed across call sites.
		driverStateWriter: &kafka.Writer{
			Addr:         kw.Addr,
			Topic:        "driver.state.changed",
			Balancer:     &kafka.Hash{},
			RequiredAcks: kafka.RequireOne,
		},
		pricingService: ps,
		clusterClient:  client,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin: func(r *http.Request) bool {
				return true
			},
		},
	}
}

// HandleGetPricingQuote processes O(1) reads from the sharded Redis surge matrix cache
func (h *GatewayHandler) HandleGetPricingQuote(w http.ResponseWriter, r *http.Request) {
	city := r.URL.Query().Get("city_prefix")
	cell := r.URL.Query().Get("h3_cell")
	baseFareStr := r.URL.Query().Get("base_fare_paise")

	if city == "" || cell == "" || baseFareStr == "" {
		http.Error(w, "missing_required_parameters", http.StatusBadRequest)
		return
	}

	baseFare, err := strconv.ParseInt(baseFareStr, 10, 64)
	if err != nil || baseFare <= 0 {
		http.Error(w, "base_fare_paise must be a positive integer", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 50*time.Millisecond)
	defer cancel()

	finalFare, multiplier, err := h.pricingService.CalculateFare(ctx, city, cell, baseFare)
	
	resp := map[string]interface{}{
		"city_prefix":      city,
		"pickup_h3_cell":   cell,
		"base_fare_paise":  baseFare,
		"final_fare_paise": finalFare,
		"surge_multiplier": multiplier,
		"timestamp":        time.Now().Unix(),
	}

	w.Header().Set("Content-Type", "application/json")
	if err != nil {
		w.WriteHeader(http.StatusPartialContent) 
	} else {
		w.WriteHeader(http.StatusOK)
	}
	_ = json.NewEncoder(w).Encode(resp)
}

// HandleCreateOrder writes the booking intent to PostGIS and forwards it to Kafka
func (h *GatewayHandler) HandleCreateOrder(w http.ResponseWriter, r *http.Request) {
	var req struct {
		OrderID         string  `json:"order_id"`
		CityPrefix      string  `json:"city_prefix"`
		CustomerID      string  `json:"customer_id"`
		PickupH3Cell    string  `json:"pickup_h3_cell"`
		PickupLat       float64 `json:"pickup_lat"`
		PickupLng       float64 `json:"pickup_lng"`
		PickupOSMNodeID int64   `json:"pickup_osm_node_id"`
		DropoffLat      float64 `json:"dropoff_lat"`
		DropoffLng      float64 `json:"dropoff_lng"`
		BaseFarePaise   int64   `json:"base_fare_paise"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}

	// MILESTONE 18: Initialize root tracking span at the public API border
	tracer := otel.GetTracerProvider().Tracer(observability.GlobalTracerName)
	spanCtx, span := tracer.Start(r.Context(), "gateway.CreateOrderReceived")
	defer span.End()

	ctx, cancel := context.WithTimeout(spanCtx, 1000*time.Millisecond)
	defer cancel()

	var orderID string
	var err error
	pickupGeom := fmt.Sprintf("SRID=4326;POINT(%f %f)", req.PickupLng, req.PickupLat)
	dropoffGeom := fmt.Sprintf("SRID=4326;POINT(%f %f)", req.DropoffLng, req.DropoffLat)

	if req.OrderID != "" {
		orderID = req.OrderID
		dbQuery := `
			INSERT INTO orders (id, city_prefix, customer_id, status, pickup_location, dropoff_location, pickup_h3_cell, pickup_osm_node_id, base_fare_paise)
			VALUES ($1::uuid, $2, $3, 'CREATED'::order_status_enum, ST_GeographyFromText($4), ST_GeographyFromText($5), $6, $7, $8)
			RETURNING id;
		`
		err = h.dbPool.QueryRow(ctx, dbQuery, req.OrderID, req.CityPrefix, req.CustomerID, pickupGeom, dropoffGeom, req.PickupH3Cell, req.PickupOSMNodeID, req.BaseFarePaise).Scan(&orderID)
	} else {
		dbQuery := `
			INSERT INTO orders (city_prefix, customer_id, status, pickup_location, dropoff_location, pickup_h3_cell, pickup_osm_node_id, base_fare_paise)
			VALUES ($1, $2, 'CREATED'::order_status_enum, ST_GeographyFromText($3), ST_GeographyFromText($4), $5, $6, $7)
			RETURNING id;
		`
		err = h.dbPool.QueryRow(ctx, dbQuery, req.CityPrefix, req.CustomerID, pickupGeom, dropoffGeom, req.PickupH3Cell, req.PickupOSMNodeID, req.BaseFarePaise).Scan(&orderID)
	}

	if err != nil {
		log.Printf("[GATEWAY_ERROR] PostGIS order mutation failed: %v", err)
		http.Error(w, "datastore_mutation_exception", http.StatusInternalServerError)
		return
	}

	payload := dispatchDomain.OrderCreatedPayload{
		OrderID:         orderID,
		CityPrefix:      req.CityPrefix,
		CustomerID:      req.CustomerID,
		PickupH3Cell:    req.PickupH3Cell,
		PickupLat:       req.PickupLat,
		PickupLng:       req.PickupLng,
		PickupOSMNodeID: req.PickupOSMNodeID,
		BaseFarePaise:   req.BaseFarePaise,
		RetryCount:      0,
	}
	bytes, _ := json.Marshal(payload)

	// MILESTONE 18: Package trace parameters inside Kafka transmission headers
	var msgHeaders []kafka.Header
	carrier := observability.KafkaHeaderCarrier{Headers: &msgHeaders}
	otel.GetTextMapPropagator().Inject(ctx, carrier)

	err = h.kafkaWriter.WriteMessages(ctx, kafka.Message{
		Key:     []byte(orderID),
		Value:   bytes,
		Headers: msgHeaders, // Inject the tracing metadata bundle securely
	})
	if err != nil {
		log.Printf("[GATEWAY_ERROR] Failed emitting onto order.created: %v", err)
		http.Error(w, "broker_stream_exception", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_, _ = w.Write([]byte(fmt.Sprintf(`{"order_id":"%s","status":"PROCESSING"}`, orderID)))
}

// HandleMatchRealtimeStream upgrades requests to WebSockets and registers the active connection session
func (h *GatewayHandler) HandleMatchRealtimeStream(w http.ResponseWriter, r *http.Request) {
	targetOrderID := r.URL.Query().Get("order_id")
	if targetOrderID == "" {
		http.Error(w, "missing_target_order_id", http.StatusBadRequest)
		return
	}

	wsConn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[GATEWAY_WS_ERROR] Protocol upgrade failed: %v", err)
		return
	}
	defer wsConn.Close()

	messageChan := make(chan []byte, 2)
	
	// MILESTONE 16 REGISTER: Store both the message channel and connection handle to manage graceful shutdowns
	sessionMetadata := &ActiveWebSocketSession{
		MessageChan: messageChan,
		Connection:  wsConn,
	}
	h.localSessions.Store(targetOrderID, sessionMetadata)
	defer h.localSessions.Delete(targetOrderID)

	const writeWait = 10 * time.Second
	
	for {
		select {
		case <-r.Context().Done():
			return
		case rawPayload, active := <-messageChan:
			if !active {
				return
			}
			
			_ = wsConn.SetWriteDeadline(time.Now().Add(writeWait))
			err = wsConn.WriteMessage(websocket.TextMessage, rawPayload)
			if err != nil {
				return
			}
			// Keep the connection open: after the initial assignment frame the same
			// socket streams live telemetry coordinates (Milestone 20) until the client
			// disconnects, the channel closes, or the request context is cancelled.
		}
	}
}

// InternalBackplaneMultiplexer handles multi-pod routing of both assignments and live telemetry coordinates
func (h *GatewayHandler) InternalBackplaneMultiplexer(ctx context.Context) {
	pubsub := h.clusterClient.Subscribe(ctx, RedisPubSubChannel, RedisTelemetryChannel)
	defer pubsub.Close()

	log.Println("[BACKPLANE_DAEMON] Redis Cluster Pub/Sub channel connection active for assignments and metrics.")

	ch := pubsub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}

			// Parse incoming data payload packet frames generically to isolate target order IDs
			var routingEnvelope struct {
				OrderID  string `json:"order_id"`
				DriverID string `json:"driver_id"`
			}
			if err := json.Unmarshal([]byte(msg.Payload), &routingEnvelope); err != nil || routingEnvelope.OrderID == "" {
				continue
			}

			// If the active socket session lives on *this* pod, forward coordinates up to the client device
			rawSession, found := h.localSessions.Load(routingEnvelope.OrderID)
			if found {
				if session, ok := rawSession.(*ActiveWebSocketSession); ok {
					select {
					case session.MessageChan <- []byte(msg.Payload):
					default:
					}
				}
			} else if msg.Channel == RedisPubSubChannel && routingEnvelope.DriverID != "" {
				// MILESTONE 24 OUTBOX ACCUMULATION FALLBACK:
				// If this is an assignment broadcast and the target session is missing locally, 
				// verify if any alternate pod handles it. If not found cluster-wide, write an outbox push record.
				go func(orderID, driverID string, rawJSON string) {
					dbCtx, dbCancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
					defer dbCancel()

					// Check if a cluster-wide token mapping exists for this backgrounded driver
					var hasToken bool
					_ = h.dbPool.QueryRow(dbCtx, "SELECT EXISTS(SELECT 1 FROM user_device_tokens WHERE user_id = $1::uuid)", driverID).Scan(&hasToken)
					if !hasToken {
						return // Skip if no push registration exists for this user ID
					}

					// Verify if another pod recently claimed this order ID before logging an outbox record
					fenceKey := fmt.Sprintf("notification:lock:fence:%s", orderID)
					lockClaimed, _ := h.clusterClient.SetNX(dbCtx, fenceKey, "CLAIMED", 4*time.Second).Result()
					if !lockClaimed {
						return // Prevent duplicate notifications across multiple horizontal gateway pods
					}

					outboxInsertQuery := `
						INSERT INTO notification_outbox (user_id, title, body, payload, status)
						VALUES ($1::uuid, 'New Matching Trip Offer', 'You have received an optimized ride request allocation. 15 seconds to accept.', $2::jsonb, 'PENDING');
					`
					_, err := h.dbPool.Exec(dbCtx, outboxInsertQuery, driverID, rawJSON)
					if err != nil {
						log.Printf("[OUTBOX_FALLBACK_ERROR] Failed committing append-only push record to datastore: %v", err)
					} else {
						log.Printf("[OUTBOX_FALLBACK_COMMITTED] Driver connection offline. Match payload saved to outbox for Order: %s", orderID)
					}
				}(routingEnvelope.OrderID, routingEnvelope.DriverID, msg.Payload)
			}
		}
	}
}

// DrainAndSignalWebSockets executes the CloseGoingAway handshake protocol across all active connections
func (h *GatewayHandler) DrainAndSignalWebSockets(ctx context.Context) {
	log.Println("[DRAIN_ENGINE] Intercepted container shutdown signal. Initiating WebSocket connection draining...")
	
	var wg sync.WaitGroup
	
	h.localSessions.Range(func(key, value interface{}) bool {
		session, ok := value.(*ActiveWebSocketSession)
		if !ok {
			return true
		}

		wg.Add(1)
		go func(orderID string, s *ActiveWebSocketSession) {
			defer wg.Done()

			// Set a tight write deadline so a slow client connection can't stall the container shutdown
			_ = s.Connection.SetWriteDeadline(time.Now().Add(1500 * time.Millisecond))
			
			// Format and send a CloseGoingAway control frame to signal the client app to reconnect elsewhere
			closeFrame := websocket.FormatCloseMessage(websocket.CloseGoingAway, "Server node undergoes rolling maintenance. Reconnecting.")
			err := s.Connection.WriteMessage(websocket.CloseMessage, closeFrame)
			if err != nil {
				log.Printf("[DRAIN_ENGINE] Handshake frame send failed for order %s: %v", orderID, err)
			}

			// Close the local channel cleanly
			close(s.MessageChan)
		}(key.(string), session)

		return true
	})

	// Wait for all active connection draining handshakes to finish or hit the context timeout
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-ctx.Done():
		log.Println("[DRAIN_ENGINE] Warning: Draining grace window exceeded. Forcing connection truncation.")
	case <-done:
		log.Println("[DRAIN_ENGINE] Coordinated WebSocket connection draining completed cleanly. Zero clients dropped abruptly.")
	}
}

// HandleAcceptOrder hard locks the driver assignment and advances the trip lifecycle status
func (h *GatewayHandler) HandleAcceptOrder(w http.ResponseWriter, r *http.Request) {
	var req struct {
		OrderID  string `json:"order_id"`
		DriverID string `json:"driver_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 800*time.Millisecond)
	defer cancel()

	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "transaction_failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	query := `
		UPDATE orders 
		SET status = 'EN_ROUTE_TO_PICKUP'::order_status_enum 
		WHERE id = $1::uuid AND assigned_driver_id = $2::uuid AND status = 'ASSIGNED'::order_status_enum;
	`

	res, err := tx.Exec(ctx, query, req.OrderID, req.DriverID)
	if err != nil || res.RowsAffected() == 0 {
		http.Error(w, "offer_lock_failed_or_expired", http.StatusConflict)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "commit_failed", http.StatusInternalServerError)
		return
	}

	// MILESTONE 20 LEASE SET: Map driver tracking sessions to active order IDs inside the cluster cache
	activeTripKey := fmt.Sprintf("driver:active:trip:%s", req.DriverID)
	_ = h.clusterClient.Set(ctx, activeTripKey, req.OrderID, 2*time.Hour)

	leaseKey := fmt.Sprintf("offer:lease:%s", req.OrderID)
	_ = h.clusterClient.Del(ctx, leaseKey)

	log.Printf("[STATE_MACHINE] Driver %s successfully accepted trip order %s", req.DriverID, req.OrderID)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"EN_ROUTE_TO_PICKUP"}`))
}

// HandleDeclineOrder processes manual rejections, freeing the driver and re-injecting the booking request to Kafka
func (h *GatewayHandler) HandleDeclineOrder(w http.ResponseWriter, r *http.Request) {
	var req struct {
		OrderID    string `json:"order_id"`
		DriverID   string `json:"driver_id"`
		CityPrefix string `json:"city_prefix"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 1500*time.Millisecond)
	defer cancel()

	// Execute rollback process cleanly
	err := h.RollbackAssignmentToCreated(ctx, req.OrderID, req.DriverID, req.CityPrefix)
	if err != nil {
		log.Printf("[STATE_MACHINE_ERROR] Rejection rollback failed for order %s: %v", req.OrderID, err)
		http.Error(w, "state_rollback_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"RE_QUEUED"}`))
}

// RollbackAssignmentToCreated returns the entities back to baseline matching loops atomically
func (h *GatewayHandler) RollbackAssignmentToCreated(ctx context.Context, orderID, driverID, cityPrefix string) error {
	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// 1. Revert order status back to CREATED
	orderQuery := `
		UPDATE orders 
		SET status = 'CREATED'::order_status_enum, assigned_driver_id = NULL, assigned_at = NULL 
		WHERE id = $1::uuid AND status = 'ASSIGNED'::order_status_enum;
	`

	var orderPayload dispatchDomain.OrderCreatedPayload
	var assignedDriverID string

	// Extract payload fields to compile the exact re-queue configuration block
	fetchQuery := `
		SELECT assigned_driver_id, city_prefix, customer_id, pickup_h3_cell, pickup_osm_node_id, ST_Y(pickup_location::geometry), ST_X(pickup_location::geometry), base_fare_paise
		FROM orders WHERE id = $1::uuid;
	`
	err = tx.QueryRow(ctx, fetchQuery, orderID).Scan(
		&assignedDriverID, &orderPayload.CityPrefix, &orderPayload.CustomerID,
		&orderPayload.PickupH3Cell, &orderPayload.PickupOSMNodeID, &orderPayload.PickupLat, &orderPayload.PickupLng,
		&orderPayload.BaseFarePaise,
	)
	if err != nil {
		return err
	}
	orderPayload.OrderID = orderID

	// Verify the caller-supplied driver actually owns this assignment before freeing it,
	// so a spoofed/buggy decline can't flip an arbitrary driver to ONLINE_AVAILABLE.
	if assignedDriverID != driverID {
		return fmt.Errorf("driver %s is not the assigned driver for order %s", driverID, orderID)
	}

	res, err := tx.Exec(ctx, orderQuery, orderID)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return fmt.Errorf("order %s status update failed: status is not ASSIGNED", orderID)
	}

	// 2. Revert driver status back to ONLINE_AVAILABLE
	driverQuery := `
		UPDATE drivers 
		SET current_state = 'ONLINE_AVAILABLE'::driver_state_enum, updated_at = CURRENT_TIMESTAMP 
		WHERE id = $1::uuid;
	`
	_, err = tx.Exec(ctx, driverQuery, driverID)
	if err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}

	// 3. Clear lease and drop a 30s match cooldown key in Redis to prevent immediate re-matching
	leaseKey := fmt.Sprintf("offer:lease:%s", orderID)
	cooldownKey := fmt.Sprintf("cooldown:driver:%s", driverID)
	
	_ = h.clusterClient.Del(ctx, leaseKey)
	_ = h.clusterClient.Set(ctx, cooldownKey, "1", 30*time.Second).Err()

	// Driver returned to the available pool: announce it so surge supply + heatmap recover.
	h.emitDriverAvailable(ctx, cityPrefix, driverID, "ONLINE_EN_ROUTE")

	// 4. Re-inject the order onto the Kafka topic stream to preserve request execution
	orderPayload.RetryCount = 1
	bytes, _ := json.Marshal(orderPayload)
	return h.kafkaWriter.WriteMessages(ctx, kafka.Message{
		Key:   []byte(orderID),
		Value: bytes,
	})
}

// emitDriverAvailable publishes the "driver re-entered the available pool" half of the
// driver.state.changed contract. Without this, the surge supply aggregator and the
// heatmap analytics consumer only ever observe drivers LEAVING the pool, so their
// counters drift to (and stay at) zero. The driver's current H3 cell is sourced from the
// telemetry tracker key written by the ingestion service. Best-effort: a missing cell or
// broker error is logged and skipped so it never blocks the trip lifecycle response.
func (h *GatewayHandler) emitDriverAvailable(ctx context.Context, cityPrefix, driverID, previousState string) {
	cellKey := fmt.Sprintf("driver:{%s:%s}:current_cell", cityPrefix, driverID)
	h3Cell, err := h.clusterClient.Get(ctx, cellKey).Result()
	if err != nil || h3Cell == "" {
		return
	}

	payload := events.DriverStateChangedEvent{
		DriverID:      driverID,
		CityPrefix:    cityPrefix,
		PreviousState: previousState,
		CurrentState:  "ONLINE_AVAILABLE",
		H3Cell:        h3Cell,
		Timestamp:     time.Now(),
	}
	bytes, mErr := json.Marshal(payload)
	if mErr != nil {
		return
	}
	if wErr := h.driverStateWriter.WriteMessages(ctx, kafka.Message{Key: []byte(driverID), Value: bytes}); wErr != nil {
		log.Printf("[STATE_EVENT_WARN] Failed emitting ONLINE_AVAILABLE for driver %s: %v", driverID, wErr)
	}
}

// HandleArriveAtPickup moves trip states from EN_ROUTE_TO_PICKUP to ARRIVED
func (h *GatewayHandler) HandleArriveAtPickup(w http.ResponseWriter, r *http.Request) {
	var req struct {
		OrderID  string `json:"order_id"`
		DriverID string `json:"driver_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 800*time.Millisecond)
	defer cancel()

	query := `
		UPDATE orders SET status = 'ARRIVED_AT_PICKUP'::order_status_enum
		WHERE id = $1::uuid AND assigned_driver_id = $2::uuid AND status = 'EN_ROUTE_TO_PICKUP'::order_status_enum;
	`
	res, err := h.dbPool.Exec(ctx, query, req.OrderID, req.DriverID)
	if err != nil || res.RowsAffected() == 0 {
		http.Error(w, "failed_state_transition", http.StatusConflict)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"status":"ARRIVED_AT_PICKUP"}`))
}

// HandleStartTrip transitions orders into active transit status (DELIVERING)
func (h *GatewayHandler) HandleStartTrip(w http.ResponseWriter, r *http.Request) {
	var req struct {
		OrderID  string `json:"order_id"`
		DriverID string `json:"driver_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 800*time.Millisecond)
	defer cancel()

	query := `
		UPDATE orders SET status = 'DELIVERING'::order_status_enum
		WHERE id = $1::uuid AND assigned_driver_id = $2::uuid AND status = 'ARRIVED_AT_PICKUP'::order_status_enum;
	`
	res, err := h.dbPool.Exec(ctx, query, req.OrderID, req.DriverID)
	if err != nil || res.RowsAffected() == 0 {
		http.Error(w, "failed_state_transition", http.StatusConflict)
		return
	}

	// Update vehicle state mapping inside relational components as well
	_, _ = h.dbPool.Exec(ctx, "UPDATE drivers SET current_state = 'ONLINE_DELIVERING'::driver_state_enum WHERE id = $1::uuid", req.DriverID)

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"status":"DELIVERING"}`))
}

// HandleCompleteTrip concludes journey lifetimes, runs an idempotency fence, and locks in precise financial ledger splits
func (h *GatewayHandler) HandleCompleteTrip(w http.ResponseWriter, r *http.Request) {
	var req struct {
		OrderID  string `json:"order_id"`
		DriverID string `json:"driver_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 2000*time.Millisecond)
	defer cancel()

	// 1. Idempotency Fence: Prevent duplicate billing/settlement execution under network retries
	idempotencyKey := fmt.Sprintf("idempotency:settlement:%s", req.OrderID)
	setSuccess, err := h.clusterClient.SetNX(ctx, idempotencyKey, "PROCESSING", 10*time.Minute).Result()
	if err != nil {
		http.Error(w, "cache_verification_failure", http.StatusInternalServerError)
		return
	}
	
	if !setSuccess {
		// If the key exists, evaluate if it is processing or already finalized safely
		status, _ := h.clusterClient.Get(ctx, idempotencyKey).Result()
		if status == "SUCCESS" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"COMPLETED","msg":"already_settled_idempotent"}`))
			return
		}
		http.Error(w, "transaction_settlement_in_flight", http.StatusConflict)
		return
	}

	// Safety cleanup fallback: delete fence token if a panic or error forces a rollback before a commit
	var settlementStatus string
	defer func() {
		if settlementStatus != "SUCCESS" {
			_ = h.clusterClient.Del(context.Background(), idempotencyKey)
		}
	}()

	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "transaction_failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// 2. Fetch base fare and prefix within exclusive row-level transactional lock (FOR UPDATE)
	var baseFarePaise int64
	var cityPrefix string
	fetchQuery := `
		SELECT base_fare_paise, city_prefix FROM orders 
		WHERE id = $1::uuid AND assigned_driver_id = $2::uuid AND status = 'DELIVERING'::order_status_enum 
		FOR UPDATE;
	`
	
	err = tx.QueryRow(ctx, fetchQuery, req.OrderID, req.DriverID).Scan(&baseFarePaise, &cityPrefix)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "order_not_found_or_invalid_state_transition", http.StatusNotFound)
			return
		}
		http.Error(w, "datastore_read_exception", http.StatusInternalServerError)
		return
	}

	// 3. Promote relational status configurations safely
	_, _ = tx.Exec(ctx, "UPDATE orders SET status = 'COMPLETED'::order_status_enum WHERE id = $1::uuid", req.OrderID)
	_, _ = tx.Exec(ctx, "UPDATE drivers SET current_state = 'ONLINE_AVAILABLE'::driver_state_enum, updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid", req.DriverID)

	// 4. Calculate Double-Entry Financial Split Constraints (80% Driver Share / 20% Corporate Commission Fee)
	platformCommissionPaise := (baseFarePaise * 20) / 100
	driverEarningsPaise := baseFarePaise - platformCommissionPaise // Prevents rounding fractional leak leakages

	ledgerInsertQuery := `
		INSERT INTO financial_ledger_entries (order_id, city_prefix, account_type, entry_type, amount_paise, description)
		VALUES ($1::uuid, $2, $3, $4, $5, $6);
	`

	// Leg A: Full Rider Outflow Debit
	_, err = tx.Exec(ctx, ledgerInsertQuery, req.OrderID, cityPrefix, "RIDER_EXTERNAL_PAYMENT", "DEBIT", baseFarePaise, "Rider automated checkout balance payment processing")
	if err != nil {
		http.Error(w, "immutable_ledger_write_failed", http.StatusInternalServerError)
		return
	}

	// Leg B: Net Driver Share Credit
	_, err = tx.Exec(ctx, ledgerInsertQuery, req.OrderID, cityPrefix, "DRIVER_EARNINGS", "CREDIT", driverEarningsPaise, "Driver partner transaction payout share allocation (80%)")
	if err != nil {
		http.Error(w, "immutable_ledger_write_failed", http.StatusInternalServerError)
		return
	}

	// Leg C: Corporate Commission Take-Rate Credit
	_, err = tx.Exec(ctx, ledgerInsertQuery, req.OrderID, cityPrefix, "PLATFORM_COMMISSION", "CREDIT", platformCommissionPaise, "Platform take-rate corporate match commission fee adjustment (20%)")
	if err != nil {
		http.Error(w, "immutable_ledger_write_failed", http.StatusInternalServerError)
		return
	}

	// Commit entries atomically to disk
	if err = tx.Commit(ctx); err != nil {
		http.Error(w, "immutable_ledger_write_failed", http.StatusInternalServerError)
		return
	}

	// 5. Success: Transition the idempotency lock record to prevent future sweep overrides
	settlementStatus = "SUCCESS"
	_ = h.clusterClient.Set(ctx, idempotencyKey, "SUCCESS", 24*time.Hour).Err()

	// Clear driver journey session tracking lines from active cache
	activeTripKey := fmt.Sprintf("driver:active:trip:%s", req.DriverID)
	_ = h.clusterClient.Del(ctx, activeTripKey)

	// Driver returned to the available pool: announce it so surge supply + heatmap recover.
	h.emitDriverAvailable(ctx, cityPrefix, req.DriverID, "ONLINE_DELIVERING")

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(fmt.Sprintf(`{"status":"COMPLETED","total_debited_paise":%d,"driver_credited_paise":%d}`, baseFarePaise, driverEarningsPaise)))
}

