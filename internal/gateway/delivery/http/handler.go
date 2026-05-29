package http

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"

	dispatchDomain "github.com/platform/driver-delivery/internal/dispatch/domain"
	pricingSvc "github.com/platform/driver-delivery/internal/pricing/service"
)

const RedisPubSubChannel = "gateway:assignments:broadcast"

// ActiveWebSocketSession encapsulates everything needed for active connection management
type ActiveWebSocketSession struct {
	MessageChan chan []byte
	Connection  *websocket.Conn
}

type GatewayHandler struct {
	dbPool         *pgxpool.Pool
	kafkaWriter    *kafka.Writer
	pricingService *pricingSvc.OrderPricingService
	clusterClient  *redis.ClusterClient
	upgrader       websocket.Upgrader

	// Thread-safe local session registry mapping active order IDs to WebSocket metadata
	localSessions sync.Map
}

func NewGatewayHandler(db *pgxpool.Pool, kw *kafka.Writer, ps *pricingSvc.OrderPricingService, client *redis.ClusterClient) *GatewayHandler {
	return &GatewayHandler{
		dbPool:         db,
		kafkaWriter:    kw,
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

	baseFare, _ := strconv.ParseInt(baseFareStr, 10, 64)
	
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

	ctx, cancel := context.WithTimeout(r.Context(), 1000*time.Millisecond)
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

	err = h.kafkaWriter.WriteMessages(ctx, kafka.Message{
		Key:   []byte(orderID),
		Value: bytes,
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
			return 
		}
	}
}

// InternalBackplaneMultiplexer routes Redis Pub/Sub events directly to local socket sessions
func (h *GatewayHandler) InternalBackplaneMultiplexer(ctx context.Context) {
	pubsub := h.clusterClient.Subscribe(ctx, RedisPubSubChannel)
	defer pubsub.Close()

	log.Println("[BACKPLANE_DAEMON] Redis Cluster Pub/Sub channel active.")

	ch := pubsub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}

			var event struct {
				OrderID  string `json:"order_id"`
				DriverID string `json:"driver_id"`
			}
			
			if err := json.Unmarshal([]byte(msg.Payload), &event); err != nil {
				continue
			}

			if rawSession, found := h.localSessions.Load(event.OrderID); found {
				if session, ok := rawSession.(*ActiveWebSocketSession); ok {
					select {
					case session.MessageChan <- []byte(msg.Payload):
					default:
					}
				}
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

	// Advance order status from ASSIGNED to EN_ROUTE_TO_PICKUP
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

	// Clear the active lease tracking key from the cluster memory space
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

	// Extract payload fields to compile the exact re-queue configuration block
	fetchQuery := `
		SELECT id, city_prefix, customer_id, pickup_h3_cell, pickup_osm_node_id, ST_Y(pickup_location::geometry), ST_X(pickup_location::geometry), base_fare_paise
		FROM orders WHERE id = $1::uuid;
	`
	err = tx.QueryRow(ctx, fetchQuery, orderID).Scan(
		&orderPayload.OrderID, &orderPayload.CityPrefix, &orderPayload.CustomerID,
		&orderPayload.PickupH3Cell, &orderPayload.PickupOSMNodeID, &orderPayload.PickupLat, &orderPayload.PickupLng,
		&orderPayload.BaseFarePaise,
	)
	if err != nil {
		return err
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

	// 4. Re-inject the order onto the Kafka topic stream to preserve request execution
	orderPayload.RetryCount = 1
	bytes, _ := json.Marshal(orderPayload)
	return h.kafkaWriter.WriteMessages(ctx, kafka.Message{
		Key:   []byte(orderID),
		Value: bytes,
	})
}

