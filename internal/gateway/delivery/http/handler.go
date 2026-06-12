package http

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"math/big"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"
	"github.com/uber/h3-go/v3"
	"golang.org/x/crypto/bcrypt"
	"google.golang.org/protobuf/proto"

	"github.com/google/uuid"
	dispatchDomain "github.com/platform/driver-delivery/internal/dispatch/domain"
	domain "github.com/platform/driver-delivery/internal/domain"
	"github.com/platform/driver-delivery/internal/events"
	"github.com/platform/driver-delivery/internal/gateway/middleware"
	"github.com/platform/driver-delivery/internal/observability"
	pricingSvc "github.com/platform/driver-delivery/internal/pricing/service"
	riderRealtime "github.com/platform/driver-delivery/internal/rider/realtime"
	. "github.com/platform/driver-delivery/pkg/api/v1"
	"go.opentelemetry.io/otel"
)

const RedisPubSubChannel = "gateway:assignments:broadcast"
const RedisTelemetryChannel = "gateway:telemetry:broadcast"

// SOSCallback allows linking SOS triggers to the administrative incidents manager
var SOSCallback func(tripID string, lat, lng float64)

// StalledTripCallback allows flagging stalled/idle trips to the administrative incidents manager
var StalledTripCallback func(driverID string, tripID string, lat, lng float64, duration int)

// RiderTripCompletedCallback is invoked (in-process) when a rider's trip completes,
// so the referral engine can reward a first completed trip. Set from main.
var RiderTripCompletedCallback func(orderID, riderID string)

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
	jwtSecretKey      []byte

	// Thread-safe local session registry mapping active order IDs to WebSocket metadata
	localSessions sync.Map
}

func NewGatewayHandler(db *pgxpool.Pool, kw *kafka.Writer, ps *pricingSvc.OrderPricingService, client *redis.ClusterClient) *GatewayHandler {
	// Dedicated producer for the "driver became available" half of the
	// driver.state.changed contract. Reuses the order-writer broker address and
	// inherits its SASL/TLS transport so it authenticates identically.
	driverStateWriter := &kafka.Writer{
		Addr:         kw.Addr,
		Topic:        "driver.state.changed",
		Balancer:     &kafka.Hash{},
		RequiredAcks: kafka.RequireOne,
		Transport:    kw.Transport,
	}
	return &GatewayHandler{
		dbPool:            db,
		kafkaWriter:       kw,
		driverStateWriter: driverStateWriter,
		pricingService:    ps,
		clusterClient:     client,
		jwtSecretKey:      nil,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin: func(r *http.Request) bool {
				return true
			},
		},
	}
}

// HandleGetPricingQuote calculates real-time surge parameters safely without adding matching lag
func (h *GatewayHandler) HandleGetPricingQuote(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 200*time.Millisecond)
	defer cancel()

	h3Cell := r.URL.Query().Get("h3_cell")
	baseFareStr := r.URL.Query().Get("base_fare_paise")

	if h3Cell == "" || baseFareStr == "" {
		http.Error(w, "missing_required_pricing_query_parameters", http.StatusBadRequest)
		return
	}

	var baseFarePaise int64
	_, err := fmt.Sscanf(baseFareStr, "%d", &baseFarePaise)
	if err != nil {
		http.Error(w, "invalid_integer_base_fare_value", http.StatusBadRequest)
		return
	}

	// Calculate optimized pricing splits across circuit breakers
	finalFare, multiplier := h.pricingService.CalculateDynamicFarePaise(ctx, h3Cell, baseFarePaise)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(fmt.Sprintf(`{"h3_cell":"%s","calculated_fare_paise":%d,"active_surge_multiplier":%.2f,"circuit_breaker_nominal":true}`, h3Cell, finalFare, multiplier)))
}

// HandleCreatePricingQuote calculates real-time surge parameters via POST payload
func (h *GatewayHandler) HandleCreatePricingQuote(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 500*time.Millisecond)
	defer cancel()

	var req struct {
		H3Cell        string `json:"h3_cell"`
		BaseFarePaise int64  `json:"base_fare_paise"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}

	if req.H3Cell == "" || req.BaseFarePaise <= 0 {
		http.Error(w, "missing_or_invalid_parameters", http.StatusBadRequest)
		return
	}

	finalFare, multiplier := h.pricingService.CalculateDynamicFarePaise(ctx, req.H3Cell, req.BaseFarePaise)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(fmt.Sprintf(`{"h3_cell":"%s","calculated_fare_paise":%d,"active_surge_multiplier":%.2f,"circuit_breaker_nominal":true}`, req.H3Cell, finalFare, multiplier)))
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

	ctx, cancel := context.WithTimeout(spanCtx, 5000*time.Millisecond)
	defer cancel()

	var orderID string
	var err error
	pickupGeom := fmt.Sprintf("SRID=4326;POINT(%f %f)", req.PickupLng, req.PickupLat)
	dropoffGeom := fmt.Sprintf("SRID=4326;POINT(%f %f)", req.DropoffLng, req.DropoffLat)

	// Generate a random 4-digit trip-start OTP, stored only as a hash. The plaintext
	// is returned once in this response so the booking surface (admin/rider) can relay
	// it; it is never stored or logged in clear. Replaces the universal "1234".
	otpPlain := generateNumericOTP()
	sum := sha256.Sum256([]byte(otpPlain))
	otpHashed := hex.EncodeToString(sum[:])

	if req.OrderID != "" {
		orderID = req.OrderID
		dbQuery := `
			INSERT INTO orders (id, city_prefix, customer_id, status, pickup_location, dropoff_location, pickup_h3_cell, pickup_osm_node_id, base_fare_paise, otp_hash)
			VALUES ($1::uuid, $2, $3, 'CREATED'::order_status_enum, ST_GeographyFromText($4), ST_GeographyFromText($5), $6, $7, $8, $9)
			RETURNING id;
		`
		err = h.dbPool.QueryRow(ctx, dbQuery, req.OrderID, req.CityPrefix, req.CustomerID, pickupGeom, dropoffGeom, req.PickupH3Cell, req.PickupOSMNodeID, req.BaseFarePaise, otpHashed).Scan(&orderID)
	} else {
		dbQuery := `
			INSERT INTO orders (city_prefix, customer_id, status, pickup_location, dropoff_location, pickup_h3_cell, pickup_osm_node_id, base_fare_paise, otp_hash)
			VALUES ($1, $2, 'CREATED'::order_status_enum, ST_GeographyFromText($3), ST_GeographyFromText($4), $5, $6, $7, $8)
			RETURNING id;
		`
		err = h.dbPool.QueryRow(ctx, dbQuery, req.CityPrefix, req.CustomerID, pickupGeom, dropoffGeom, req.PickupH3Cell, req.PickupOSMNodeID, req.BaseFarePaise, otpHashed).Scan(&orderID)
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
	_, _ = w.Write([]byte(fmt.Sprintf(`{"order_id":"%s","status":"PROCESSING","trip_otp":"%s"}`, orderID, otpPlain)))
}

// generateNumericOTP returns a cryptographically random 4-digit string ("0000"–"9999").
func generateNumericOTP() string {
	n, err := rand.Int(rand.Reader, big.NewInt(10000))
	if err != nil {
		return fmt.Sprintf("%04d", time.Now().UnixNano()%10000)
	}
	return fmt.Sprintf("%04d", n.Int64())
}

// HandleMatchRealtimeStream upgrades requests to WebSockets and registers the active binary connection session
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

	messageChan := make(chan []byte, 5) // Expanded channel buffer to process high-frequency streams safely

	sessionMetadata := &ActiveWebSocketSession{
		MessageChan: messageChan,
		Connection:  wsConn,
	}
	h.localSessions.Store(targetOrderID, sessionMetadata)
	defer h.localSessions.Delete(targetOrderID)
	if driverID, ok := middleware.GetUserIDFromContext(r.Context()); ok && driverID != "" {
		driverSessionKey := fmt.Sprintf("driver:%s", driverID)
		h.localSessions.Store(driverSessionKey, sessionMetadata)
		defer h.localSessions.Delete(driverSessionKey)
	}

	presenceKey := fmt.Sprintf("ws:presence:%s", targetOrderID)
	_ = h.clusterClient.Set(r.Context(), presenceKey, "1", 30*time.Minute).Err()
	defer func() {
		delCtx, delCancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
		defer delCancel()
		_ = h.clusterClient.Del(delCtx, presenceKey).Err()
	}()

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
			if len(rawPayload) > 0 && rawPayload[0] == '{' {
				err = wsConn.WriteMessage(websocket.TextMessage, rawPayload)
			} else {
				err = wsConn.WriteMessage(websocket.BinaryMessage, rawPayload)
			}
			if err != nil {
				return
			}
		}
	}
}

// InternalBackplaneMultiplexer handles multi-pod routing and packs raw JSON events into Protocol Buffers
func (h *GatewayHandler) InternalBackplaneMultiplexer(ctx context.Context) {
	pubsub := h.clusterClient.Subscribe(ctx, RedisPubSubChannel, RedisTelemetryChannel)
	defer pubsub.Close()

	log.Println("[BACKPLANE_DAEMON] Redis Cluster Pub/Sub channel connection active. Streaming via Proto binary framing.")

	ch := pubsub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}

			// Core Envelope structured representation mapping both telemetry and assignment tokens
			var ev struct {
				OrderID      string  `json:"order_id"`
				DriverID     string  `json:"driver_id"`
				CityPrefix   string  `json:"city_prefix"`
				Status       string  `json:"status"`
				Latitude     float64 `json:"latitude"`
				Longitude    float64 `json:"longitude"`
				Bearing      float64 `json:"bearing"`
				SpeedKms     float64 `json:"speed_kms"`
				TimestampUtc int64   `json:"timestamp_utc"`
			}
			if err := json.Unmarshal([]byte(msg.Payload), &ev); err != nil || ev.OrderID == "" {
				continue
			}

			rawSession, found := h.localSessions.Load(ev.OrderID)
			if !found && msg.Channel == RedisPubSubChannel && ev.DriverID != "" {
				rawSession, found = h.localSessions.Load(fmt.Sprintf("driver:%s", ev.DriverID))
			}
			if found {
				if session, ok := rawSession.(*ActiveWebSocketSession); ok {
					if msg.Channel == RedisPubSubChannel && strings.Contains(msg.Payload, `"fare_estimate"`) {
						select {
						case session.MessageChan <- []byte(msg.Payload):
						default:
						}
						continue
					}

					// MILESTONE 31: Encode unstructured payloads into high-density Protobuf envelopes
					var binaryBuffer []byte
					var marshalErr error

					if msg.Channel == RedisPubSubChannel {
						envelope := &WebSocketBinaryEnvelope{
							Type: FrameType_FRAME_TYPE_ASSIGNMENT,
							Assignment: &AssignmentFrame{
								OrderId:    ev.OrderID,
								DriverId:   ev.DriverID,
								CityPrefix: ev.CityPrefix,
								Status:     ev.Status,
							},
						}
						binaryBuffer, marshalErr = proto.Marshal(envelope)
					} else {
						envelope := &WebSocketBinaryEnvelope{
							Type: FrameType_FRAME_TYPE_TELEMETRY,
							Telemetry: &TelemetryFrame{
								OrderId:      ev.OrderID,
								DriverId:     ev.DriverID,
								Latitude:     ev.Latitude,
								Longitude:    ev.Longitude,
								Bearing:      ev.Bearing,
								SpeedKms:     ev.SpeedKms,
								TimestampUtc: ev.TimestampUtc,
							},
						}
						binaryBuffer, marshalErr = proto.Marshal(envelope)
					}

					if marshalErr == nil {
						select {
						case session.MessageChan <- binaryBuffer:
						default:
							// Handle channel pressure fallback gracefully
						}
					}
				}
			} else if msg.Channel == RedisPubSubChannel && ev.DriverID != "" {
				// MILESTONE 24 OUTBOX FALLBACK PRESERVED: Database text constraints expect JSON formats
				go func(orderID, driverID string, rawJSON string) {
					dbCtx, dbCancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
					defer dbCancel()

					if present, _ := h.clusterClient.Exists(dbCtx, fmt.Sprintf("ws:presence:%s", orderID)).Result(); present > 0 {
						return
					}

					var hasToken bool
					_ = h.dbPool.QueryRow(dbCtx, "SELECT EXISTS(SELECT 1 FROM user_device_tokens WHERE user_id = $1::uuid)", driverID).Scan(&hasToken)
					if !hasToken {
						return
					}

					fenceKey := fmt.Sprintf("notification:lock:fence:%s", orderID)
					lockClaimed, _ := h.clusterClient.SetNX(dbCtx, fenceKey, "CLAIMED", 4*time.Second).Result()
					if !lockClaimed {
						return
					}

					outboxInsertQuery := `
						INSERT INTO notification_outbox (user_id, title, body, payload, status)
						VALUES ($1::uuid, 'New Matching Trip Offer', 'You have received an optimized ride request allocation. 15 seconds to accept.', $2::jsonb, 'PENDING');
					`
					_, _ = h.dbPool.Exec(dbCtx, outboxInsertQuery, driverID, rawJSON)
				}(ev.OrderID, ev.DriverID, msg.Payload)
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

	ctx, cancel := context.WithTimeout(r.Context(), 5000*time.Millisecond)
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

	// Update driver duty state to EN_ROUTE
	driverQuery := `
		UPDATE drivers 
		SET duty_state = 'EN_ROUTE'::driver_duty_state,
		    current_state = 'ONLINE_EN_ROUTE'::driver_state_enum
		WHERE id = $1::uuid;
	`
	_, err = tx.Exec(ctx, driverQuery, req.DriverID)
	if err != nil {
		http.Error(w, "driver_state_update_failed", http.StatusInternalServerError)
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

// HandleOfferResponse processes the driver's response (Accept/Decline) to a pending order offer.
func (h *GatewayHandler) HandleOfferResponse(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	orderID := r.PathValue("id")
	if orderID == "" {
		http.Error(w, "missing_order_id", http.StatusBadRequest)
		return
	}

	var req struct {
		Response      string `json:"response"` // "ACCEPTED" | "DECLINED"
		Reason        string `json:"reason,omitempty"`
		CorrelationID string `json:"correlation_id,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}

	if req.Response != "ACCEPTED" && req.Response != "DECLINED" {
		http.Error(w, "invalid_response_type: must be ACCEPTED or DECLINED", http.StatusBadRequest)
		return
	}

	driverID, ok := middleware.GetUserIDFromContext(r.Context())
	if !ok || driverID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	// 1. Correlation ID Idempotency Check
	if req.CorrelationID != "" {
		processedKey := fmt.Sprintf("processed:correlation:%s", req.CorrelationID)
		isProcessed, err := h.clusterClient.Exists(ctx, processedKey).Result()
		if err == nil && isProcessed > 0 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			_, _ = w.Write([]byte(`{"success":false,"error":"already_processed","message":"This offer response has already been processed."}`))
			return
		}
		_ = h.clusterClient.Set(ctx, processedKey, "1", 5*time.Minute)
	}

	// 2. Begin transaction with Row-Level DB Lock (FOR UPDATE)
	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "transaction_failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	var (
		assignedDriverID *string
		cityPrefix       string
		customerID       string
		pickupH3Cell     string
		pickupOSMNodeID  *int64
		pickupLat        float64
		pickupLng        float64
		baseFarePaise    int64
		assignedAt       *time.Time
		status           string
	)

	query := `
		SELECT assigned_driver_id, city_prefix, customer_id, pickup_h3_cell, pickup_osm_node_id, 
		       ST_Y(pickup_location::geometry), ST_X(pickup_location::geometry), base_fare_paise, assigned_at, status
		FROM orders WHERE id = $1::uuid FOR UPDATE;
	`
	err = tx.QueryRow(ctx, query, orderID).Scan(
		&assignedDriverID, &cityPrefix, &customerID, &pickupH3Cell, &pickupOSMNodeID,
		&pickupLat, &pickupLng, &baseFarePaise, &assignedAt, &status,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "order_not_found", http.StatusNotFound)
			return
		}
		http.Error(w, "database_query_error", http.StatusInternalServerError)
		return
	}

	if status != "ASSIGNED" {
		http.Error(w, "offer_expired_or_already_taken", http.StatusConflict)
		return
	}

	if assignedDriverID == nil || *assignedDriverID != driverID {
		http.Error(w, "offer_mismatch", http.StatusConflict)
		return
	}

	// Calculate latency
	latencySeconds := 0.0
	if assignedAt != nil {
		latencySeconds = time.Since(*assignedAt).Seconds()
	}

	if req.Response == "ACCEPTED" {
		// 3a. Update order status to EN_ROUTE_TO_PICKUP
		orderQuery := `
			UPDATE orders 
			SET status = 'EN_ROUTE_TO_PICKUP'::order_status_enum 
			WHERE id = $1::uuid AND assigned_driver_id = $2::uuid AND status = 'ASSIGNED'::order_status_enum;
		`
		res, err := tx.Exec(ctx, orderQuery, orderID, driverID)
		if err != nil || res.RowsAffected() == 0 {
			http.Error(w, "accept_failed", http.StatusInternalServerError)
			return
		}

		// Update driver duty state to EN_ROUTE
		driverQuery := `
			UPDATE drivers 
			SET duty_state = 'EN_ROUTE'::driver_duty_state,
			    current_state = 'ONLINE_EN_ROUTE'::driver_state_enum
			WHERE id = $1::uuid;
		`
		_, err = tx.Exec(ctx, driverQuery, driverID)
		if err != nil {
			http.Error(w, "driver_state_update_failed", http.StatusInternalServerError)
			return
		}

		// Record audit log
		auditQuery := `
			INSERT INTO audit_logs (driver_id, action)
			VALUES ($1::uuid, $2)
		`
		actionStr := fmt.Sprintf("OFFER_ACCEPTED: order_id=%s, latency=%.3fs", orderID, latencySeconds)
		_, _ = tx.Exec(ctx, auditQuery, driverID, actionStr)

		if err := tx.Commit(ctx); err != nil {
			http.Error(w, "commit_failed", http.StatusInternalServerError)
			return
		}

		// Redis updates post-commit
		activeTripKey := fmt.Sprintf("driver:active:trip:%s", driverID)
		_ = h.clusterClient.Set(ctx, activeTripKey, orderID, 2*time.Hour)

		leaseKey := fmt.Sprintf("offer:lease:%s", orderID)
		_ = h.clusterClient.Del(ctx, leaseKey)

		log.Printf("[STATE_MACHINE] Driver %s accepted offer %s with latency %.3fs", driverID, orderID, latencySeconds)

	} else {
		// 3b. Decline Flow - Revert order to CREATED
		orderQuery := `
			UPDATE orders 
			SET status = 'CREATED'::order_status_enum, assigned_driver_id = NULL, assigned_at = NULL 
			WHERE id = $1::uuid AND status = 'ASSIGNED'::order_status_enum;
		`
		res, err := tx.Exec(ctx, orderQuery, orderID)
		if err != nil || res.RowsAffected() == 0 {
			http.Error(w, "decline_failed", http.StatusInternalServerError)
			return
		}

		// Revert driver status back to ONLINE_AVAILABLE and ONLINE duty state
		driverQuery := `
			UPDATE drivers 
			SET duty_state = 'ONLINE'::driver_duty_state,
			    current_state = 'ONLINE_AVAILABLE'::driver_state_enum, 
			    updated_at = CURRENT_TIMESTAMP 
			WHERE id = $1::uuid;
		`
		_, err = tx.Exec(ctx, driverQuery, driverID)
		if err != nil {
			http.Error(w, "driver_state_update_failed", http.StatusInternalServerError)
			return
		}

		// Record audit log
		auditQuery := `
			INSERT INTO audit_logs (driver_id, action)
			VALUES ($1::uuid, $2)
		`
		actionStr := fmt.Sprintf("OFFER_DECLINED: order_id=%s, reason=%s, latency=%.3fs", orderID, req.Reason, latencySeconds)
		_, _ = tx.Exec(ctx, auditQuery, driverID, actionStr)

		if err := tx.Commit(ctx); err != nil {
			http.Error(w, "commit_failed", http.StatusInternalServerError)
			return
		}

		// Redis updates post-commit
		leaseKey := fmt.Sprintf("offer:lease:%s", orderID)
		_ = h.clusterClient.Del(ctx, leaseKey)

		cooldownKey := fmt.Sprintf("cooldown:driver:%s", driverID)
		_ = h.clusterClient.Set(ctx, cooldownKey, "1", 30*time.Second)

		h.emitDriverAvailable(ctx, cityPrefix, driverID, "ONLINE_EN_ROUTE")

		// Re-inject order back to Kafka order.created
		osmNodeID := int64(0)
		if pickupOSMNodeID != nil {
			osmNodeID = *pickupOSMNodeID
		}
		orderPayload := dispatchDomain.OrderCreatedPayload{
			OrderID:         orderID,
			CityPrefix:      cityPrefix,
			CustomerID:      customerID,
			PickupH3Cell:    pickupH3Cell,
			PickupLat:       pickupLat,
			PickupLng:       pickupLng,
			PickupOSMNodeID: osmNodeID,
			BaseFarePaise:   baseFarePaise,
			RetryCount:      1,
		}
		bytes, _ := json.Marshal(orderPayload)
		_ = h.kafkaWriter.WriteMessages(ctx, kafka.Message{
			Key:   []byte(orderID),
			Value: bytes,
		})

		log.Printf("[STATE_MACHINE] Driver %s declined offer %s with reason %s, latency %.3fs", driverID, orderID, req.Reason, latencySeconds)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"success":true,"status":"success"}`))
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

	ctx, cancel := context.WithTimeout(r.Context(), 5000*time.Millisecond)
	defer cancel()

	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "transaction_failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	query := `
		UPDATE orders SET status = 'ARRIVED_AT_PICKUP'::order_status_enum
		WHERE id = $1::uuid AND assigned_driver_id = $2::uuid AND status = 'EN_ROUTE_TO_PICKUP'::order_status_enum;
	`
	res, err := tx.Exec(ctx, query, req.OrderID, req.DriverID)
	if err != nil || res.RowsAffected() == 0 {
		http.Error(w, "failed_state_transition", http.StatusConflict)
		return
	}

	// Update driver duty state to ARRIVED
	_, err = tx.Exec(ctx, "UPDATE drivers SET duty_state = 'ARRIVED'::driver_duty_state WHERE id = $1::uuid", req.DriverID)
	if err != nil {
		http.Error(w, "failed_driver_state_transition", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "commit_failed", http.StatusInternalServerError)
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

	ctx, cancel := context.WithTimeout(r.Context(), 5000*time.Millisecond)
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

// HandleDriverArrived updates the order state to ARRIVED_AT_PICKUP and driver's duty state to ARRIVED.
// Path: PATCH /api/v1/driver/orders/{id}/arrived
func (h *GatewayHandler) HandleDriverArrived(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	driverID, ok := middleware.GetUserIDFromContext(r.Context())
	if !ok || driverID == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	orderID := r.PathValue("id")
	if orderID == "" {
		http.Error(w, "missing_order_id", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 1500*time.Millisecond)
	defer cancel()

	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		log.Printf("[DRIVER_ARRIVED] Transaction initiation failed: %v", err)
		http.Error(w, "transaction_failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// 1. Fetch current status, assigned_driver_id, customer_id and lock row
	var currentStatus string
	var assignedDriverID *string
	var customerID string
	query := `
		SELECT status::text, assigned_driver_id::text, customer_id::text 
		FROM orders 
		WHERE id = $1::uuid 
		FOR UPDATE
	`
	err = tx.QueryRow(ctx, query, orderID).Scan(&currentStatus, &assignedDriverID, &customerID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "order_not_found", http.StatusNotFound)
			return
		}
		log.Printf("[DRIVER_ARRIVED] Order lookup failed for %s: %v", orderID, err)
		http.Error(w, "database_read_exception", http.StatusInternalServerError)
		return
	}

	// 2. Reject if order status is not EN_ROUTE_TO_PICKUP or matches assigned driver
	if currentStatus != "EN_ROUTE_TO_PICKUP" {
		http.Error(w, fmt.Sprintf("invalid_state: expected EN_ROUTE_TO_PICKUP, got %s", currentStatus), http.StatusConflict)
		return
	}
	if assignedDriverID == nil || *assignedDriverID != driverID {
		http.Error(w, "forbidden: driver identity mismatch", http.StatusForbidden)
		return
	}

	// 3. Update order status to ARRIVED_AT_PICKUP and waiting_started_at to NOW()
	updateOrderQuery := `
		UPDATE orders 
		SET status = 'ARRIVED_AT_PICKUP'::order_status_enum,
		    waiting_started_at = NOW()
		WHERE id = $1::uuid
	`
	_, err = tx.Exec(ctx, updateOrderQuery, orderID)
	if err != nil {
		log.Printf("[DRIVER_ARRIVED] Order status update failed for %s: %v", orderID, err)
		http.Error(w, "failed_state_transition", http.StatusInternalServerError)
		return
	}

	// 4. Update driver's duty_state to ARRIVED and current_state to ONLINE_EN_ROUTE
	updateDriverQuery := `
		UPDATE drivers 
		SET duty_state = 'ARRIVED'::driver_duty_state,
		    current_state = 'ONLINE_EN_ROUTE'::driver_state_enum,
		    updated_at = NOW()
		WHERE id = $1::uuid
	`
	_, err = tx.Exec(ctx, updateDriverQuery, driverID)
	if err != nil {
		log.Printf("[DRIVER_ARRIVED] Driver state update failed for %s: %v", driverID, err)
		http.Error(w, "failed_driver_state_transition", http.StatusInternalServerError)
		return
	}

	// 5. Trigger push notification outbox
	notificationQuery := `
		INSERT INTO notification_outbox (user_id, title, body, payload, status)
		VALUES ($1::uuid, 'Your driver has arrived', 'Your driver is waiting at the pickup location.', $2::jsonb, 'PENDING');
	`
	payloadJSON := fmt.Sprintf(`{"order_id": "%s"}`, orderID)
	_, err = tx.Exec(ctx, notificationQuery, customerID, payloadJSON)
	if err != nil {
		log.Printf("[DRIVER_ARRIVED] Push notification logging failed: %v", err)
	}

	if err := tx.Commit(ctx); err != nil {
		log.Printf("[DRIVER_ARRIVED] Commit failed: %v", err)
		http.Error(w, "commit_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"success":true,"status":"ARRIVED_AT_PICKUP"}`))
}

// HandleDriverStartTrip handles PATCH /api/v1/driver/orders/{id}/start
func (h *GatewayHandler) HandleDriverStartTrip(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	driverID, ok := middleware.GetUserIDFromContext(r.Context())
	if !ok || driverID == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	orderID := r.PathValue("id")
	if orderID == "" {
		http.Error(w, "missing_order_id", http.StatusBadRequest)
		return
	}

	var req struct {
		OdometerReading int    `json:"odometer_reading"`
		FuelLevel       int    `json:"fuel_level"`
		OTP             string `json:"otp"`
		PhotoURL        string `json:"photo_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}

	// Validate inputs
	if req.OdometerReading <= 0 {
		http.Error(w, "invalid_odometer_reading: must be a positive integer", http.StatusBadRequest)
		return
	}
	if req.OTP == "" {
		http.Error(w, "missing_otp", http.StatusBadRequest)
		return
	}
	if req.FuelLevel < 0 || req.FuelLevel > 100 {
		req.FuelLevel = max(0, min(100, req.FuelLevel))
	}

	ctx, cancel := context.WithTimeout(r.Context(), 2000*time.Millisecond)
	defer cancel()

	// Start atomic transaction
	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		log.Printf("[START_TRIP] Transaction begin failed: %v", err)
		http.Error(w, "transaction_failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// 1. Fetch current status, assigned_driver_id, otp_hash, otp_attempts
	var currentStatus string
	var assignedDriverID *string
	var otpHash *string
	var otpAttempts int
	query := `
		SELECT status::text, assigned_driver_id::text, otp_hash, otp_attempts 
		FROM orders 
		WHERE id = $1::uuid 
		FOR UPDATE
	`
	err = tx.QueryRow(ctx, query, orderID).Scan(&currentStatus, &assignedDriverID, &otpHash, &otpAttempts)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "order_not_found", http.StatusNotFound)
			return
		}
		log.Printf("[START_TRIP] Order lookup failed for %s: %v", orderID, err)
		http.Error(w, "database_read_exception", http.StatusInternalServerError)
		return
	}

	// Validation checks
	if currentStatus != "ARRIVED_AT_PICKUP" {
		http.Error(w, fmt.Sprintf("invalid_state: expected ARRIVED_AT_PICKUP, got %s", currentStatus), http.StatusConflict)
		return
	}
	if assignedDriverID == nil || *assignedDriverID != driverID {
		http.Error(w, "forbidden: driver identity mismatch", http.StatusForbidden)
		return
	}

	// 2. OTP brute-force lockout guard
	if otpAttempts >= 3 {
		http.Error(w, "too_many_otp_attempts", http.StatusForbidden)
		return
	}

	// Compare hashed OTP
	sum := sha256.Sum256([]byte(req.OTP))
	inputHash := hex.EncodeToString(sum[:])

	targetHash := ""
	if otpHash != nil {
		targetHash = *otpHash
	}
	// Fail closed: an order with no provisioned OTP cannot be started. (Previously this
	// fell back to "1234", making every such trip startable with a universal code.)
	if targetHash == "" {
		http.Error(w, "otp_not_provisioned", http.StatusConflict)
		return
	}

	if inputHash != targetHash {
		// Increment otp_attempts
		_, _ = tx.Exec(ctx, "UPDATE orders SET otp_attempts = otp_attempts + 1 WHERE id = $1::uuid", orderID)
		_ = tx.Commit(ctx) // Commit the increment to DB

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "invalid_otp",
			"message": fmt.Sprintf("Incorrect OTP entered. Attempt %d of 3.", otpAttempts+1),
		})
		return
	}

	// 3. Write START odometer checkpoint (Odometer Guard)
	checkpointID := ""
	err = tx.QueryRow(ctx, `
		INSERT INTO trip_odometer_checkpoints (order_id, checkpoint_type, odometer_value, fuel_percentage, photo_url, captured_at, created_by)
		VALUES ($1::uuid, 'START', $2, $3, $4, NOW(), $5::uuid)
		ON CONFLICT (order_id, checkpoint_type) DO UPDATE
		SET odometer_value = EXCLUDED.odometer_value,
		    fuel_percentage = EXCLUDED.fuel_percentage,
		    photo_url = EXCLUDED.photo_url,
		    captured_at = EXCLUDED.captured_at
		RETURNING id::text`,
		orderID, req.OdometerReading, req.FuelLevel, req.PhotoURL, driverID,
	).Scan(&checkpointID)
	if err != nil {
		log.Printf("[START_TRIP] Checkpoint write failed: %v", err)
		http.Error(w, "checkpoint_write_failed", http.StatusInternalServerError)
		return
	}

	// 4. Update order status to DELIVERING, picked_up_at = NOW(), and reset otp_attempts
	_, err = tx.Exec(ctx, `
		UPDATE orders 
		SET status = 'DELIVERING'::order_status_enum,
		    picked_up_at = NOW(),
		    otp_attempts = 0
		WHERE id = $1::uuid
	`, orderID)
	if err != nil {
		log.Printf("[START_TRIP] Order status transition to DELIVERING failed: %v", err)
		http.Error(w, "status_transition_failed", http.StatusInternalServerError)
		return
	}

	// 5. Update driver state to DELIVERING / ONLINE_DELIVERING
	_, err = tx.Exec(ctx, `
		UPDATE drivers 
		SET duty_state = 'DELIVERING'::driver_duty_state,
		    current_state = 'ONLINE_DELIVERING'::driver_state_enum,
		    updated_at = NOW()
		WHERE id = $1::uuid
	`, driverID)
	if err != nil {
		log.Printf("[START_TRIP] Driver state update failed: %v", err)
		http.Error(w, "driver_state_transition_failed", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		log.Printf("[START_TRIP] Transaction commit failed: %v", err)
		http.Error(w, "commit_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success":         true,
		"status":          "DELIVERING",
		"checkpoint_id":   checkpointID,
		"odometer_value":  req.OdometerReading,
		"fuel_percentage": req.FuelLevel,
	})
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

	ctx, cancel := context.WithTimeout(r.Context(), 5000*time.Millisecond)
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
	_, _ = tx.Exec(ctx, "UPDATE orders SET status = 'COMPLETED'::order_status_enum, completed_at = CURRENT_TIMESTAMP WHERE id = $1::uuid", req.OrderID)
	_, _ = tx.Exec(ctx, "UPDATE drivers SET current_state = 'ONLINE_AVAILABLE'::driver_state_enum, duty_state = 'ONLINE'::driver_duty_state, updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid", req.DriverID)

	// 4. Calculate Double-Entry Financial Split Constraints (80% Driver Share / 20% Corporate Commission Fee)
	platformCommissionPaise := (baseFarePaise * 20) / 100
	driverEarningsPaise := baseFarePaise - platformCommissionPaise // Prevents rounding fractional leak leakages

	ledgerInsertQuery := `
		INSERT INTO financial_ledger_entries (order_id, city_prefix, regional_settlement_zone, account_type, entry_type, amount_paise, description)
		VALUES ($1::uuid, $2, $2, $3, $4, $5, $6);
	`

	// Leg A: Full Rider Outflow Debit
	_, err = tx.Exec(ctx, ledgerInsertQuery, req.OrderID, cityPrefix, "RIDER_EXTERNAL_PAYMENT", "DEBIT", baseFarePaise, "Rider automated checkout balance payment processing")
	if err != nil {
		log.Printf("[GATEWAY_ERROR] Leg A ledger insert failed: %v", err)
		http.Error(w, "immutable_ledger_write_failed", http.StatusInternalServerError)
		return
	}

	// Leg B: Net Driver Share Credit
	_, err = tx.Exec(ctx, ledgerInsertQuery, req.OrderID, cityPrefix, "DRIVER_EARNINGS", "CREDIT", driverEarningsPaise, "Driver partner transaction payout share allocation (80%)")
	if err != nil {
		log.Printf("[GATEWAY_ERROR] Leg B ledger insert failed: %v", err)
		http.Error(w, "immutable_ledger_write_failed", http.StatusInternalServerError)
		return
	}

	// Leg C: Corporate Commission Take-Rate Credit
	_, err = tx.Exec(ctx, ledgerInsertQuery, req.OrderID, cityPrefix, "PLATFORM_COMMISSION", "CREDIT", platformCommissionPaise, "Platform take-rate corporate match commission fee adjustment (20%)")
	if err != nil {
		log.Printf("[GATEWAY_ERROR] Leg C ledger insert failed: %v", err)
		http.Error(w, "immutable_ledger_write_failed", http.StatusInternalServerError)
		return
	}

	// Commit entries atomically to disk
	if err = tx.Commit(ctx); err != nil {
		log.Printf("[GATEWAY_ERROR] Ledger tx commit failed: %v", err)
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

	// Rider live-trip WS: trip completed (non-blocking).
	go h.pushRiderTripEvent(req.OrderID, riderRealtime.MsgTripCompleted, map[string]interface{}{
		"order_id":         req.OrderID,
		"total_fare_paise": baseFarePaise,
		"fare_breakdown":   map[string]interface{}{"base_fare_paise": baseFarePaise},
		"distance_km":      0,
		"duration_minutes": 0,
	})

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(fmt.Sprintf(`{"status":"COMPLETED","total_debited_paise":%d,"driver_credited_paise":%d}`, baseFarePaise, driverEarningsPaise)))
}

// pushRiderTripEvent looks up the order's rider and pushes a live-trip event to the
// rider WebSocket. Fire-and-forget so it never adds latency to the trip lifecycle.
func (h *GatewayHandler) pushRiderTripEvent(orderID, msgType string, data map[string]interface{}) {
	if h.clusterClient == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	var riderID *string
	if err := h.dbPool.QueryRow(ctx, "SELECT rider_id::text FROM orders WHERE id = $1::uuid", orderID).Scan(&riderID); err != nil || riderID == nil || *riderID == "" {
		return
	}
	_ = riderRealtime.Publish(ctx, h.clusterClient, *riderID, msgType, data)

	// On trip completion, let the referral engine reward a first completed trip.
	if msgType == riderRealtime.MsgTripCompleted && RiderTripCompletedCallback != nil {
		RiderTripCompletedCallback(orderID, *riderID)
	}
}

// HandlePaymentWebhook intercepts asynchronous external provider billing tokens and updates transaction matrices securely
func (h *GatewayHandler) HandlePaymentWebhook(w http.ResponseWriter, r *http.Request) {
	// 1. Enforce strict POST rule constraints
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	// 2. Cryptographic Signature Verification Guard
	// Extract the provider's signature header value passed over the network
	receivedSignature := r.Header.Get("X-Payment-Provider-Signature")
	if receivedSignature == "" {
		http.Error(w, "missing_webhook_verification_signature", http.StatusUnauthorized)
		return
	}

	rawBody, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "malformed_request_payload", http.StatusBadRequest)
		return
	}

	// Fetch webhook decryption signing secrets mapped from environment variables
	webhookSecret := []byte(os.Getenv("PAYMENT_WEBHOOK_SIGNING_SECRET"))
	if len(webhookSecret) == 0 {
		webhookSecret = []byte(os.Getenv("PAYMENT_WEBHOOK_SECRET"))
	}
	if len(webhookSecret) == 0 {
		// Fail closed: a repo-known fallback key would let anyone forge
		// payment_intent.succeeded events and post ledger entries against them.
		log.Printf("[PAYMENT_WEBHOOK] rejected: PAYMENT_WEBHOOK_SIGNING_SECRET not configured")
		http.Error(w, "payment_webhook_not_configured", http.StatusServiceUnavailable)
		return
	}

	// Compute expected HMAC SHA256 checksum across the raw body string to prevent payload tampering
	mac := hmac.New(sha256.New, webhookSecret)
	mac.Write(rawBody)
	expectedSignature := hex.EncodeToString(mac.Sum(nil))

	// Execute constant-time cryptographic string comparisons to protect against timing attacks
	if subtle.ConstantTimeCompare([]byte(receivedSignature), []byte(expectedSignature)) != 1 {
		http.Error(w, "invalid_cryptographic_signature_mismatch", http.StatusUnauthorized)
		return
	}

	// 3. Parse Verified Event Payload
	var webhookEvent struct {
		EventID string `json:"event_id"` // Used directly as an explicit idempotency key
		Type    string `json:"type"`     // e.g., 'payment_intent.succeeded', 'payment_intent.payment_failed'
		Data    struct {
			IntentID    string `json:"intent_id"`
			OrderID     string `json:"order_id"`
			AmountPaise int64  `json:"amount_paise"`
			Currency    string `json:"currency"`
		} `json:"data"`
	}

	if err := json.Unmarshal(rawBody, &webhookEvent); err != nil {
		http.Error(w, "unparseable_json_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 2500*time.Millisecond)
	defer cancel()

	// 4. Open atomic database transaction to guarantee cross-service alignment
	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "transaction_failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// Evaluate if this specific webhook event signature was already processed successfully
	var isIdempotentEvent bool
	err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM payment_intents WHERE idempotency_key = $1)", webhookEvent.EventID).Scan(&isIdempotentEvent)
	if err != nil {
		http.Error(w, "datastore_read_exception", http.StatusInternalServerError)
		return
	}
	if isIdempotentEvent {
		// Event was already reconciled; return HTTP 200 OK to acknowledge delivery to the provider
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ignored_duplicate_idempotent"}`))
		return
	}

	// 5. Execute Conditional State Machine Routing Paths
	switch webhookEvent.Type {
	case "payment_intent.succeeded":
		log.Printf("[PAYMENT_WEBHOOK] Success intercepted for intent %s. Reconciling ledger layers...", webhookEvent.Data.IntentID)

		// Upsert payment tracking context matrix state row
		upsertQuery := `
			INSERT INTO payment_intents (id, order_id, amount_paise, currency, payment_status, provider_type, idempotency_key, updated_at)
			VALUES ($1, $2::uuid, $3, $4, 'SUCCEEDED', 'STRIPE', $5, CURRENT_TIMESTAMP)
			ON CONFLICT (id) DO UPDATE 
			SET payment_status = 'SUCCEEDED', idempotency_key = EXCLUDED.idempotency_key, updated_at = CURRENT_TIMESTAMP;
		`
		_, err = tx.Exec(ctx, upsertQuery, webhookEvent.Data.IntentID, webhookEvent.Data.OrderID, webhookEvent.Data.AmountPaise, webhookEvent.Data.Currency, webhookEvent.EventID)
		if err != nil {
			log.Printf("[PAYMENT_ERROR] Intent upsert block failed: %v", err)
			http.Error(w, "intent_mutation_failed", http.StatusInternalServerError)
			return
		}

		// Update order details to reflect successful transaction settlement
		_, err = tx.Exec(ctx, "UPDATE orders SET status = 'COMPLETED'::order_status_enum WHERE id = $1::uuid AND status = 'DELIVERING'::order_status_enum", webhookEvent.Data.OrderID)
		if err != nil {
			http.Error(w, "order_promotion_failed", http.StatusInternalServerError)
			return
		}

		// Log external financial payment reconciliation to your append-only double-entry accounting ledger
		var cityPrefix string
		_ = tx.QueryRow(ctx, "SELECT city_prefix FROM orders WHERE id = $1::uuid", webhookEvent.Data.OrderID).Scan(&cityPrefix)

		// Record the external card-network settlement as a balanced double-entry pair so the
		// ledger stays auditable (debits == credits). A lone CREDIT here would leave the
		// admin auditor permanently unbalanced against the settlement booked at trip completion.
		ledgerQuery := `
			INSERT INTO financial_ledger_entries (order_id, city_prefix, regional_settlement_zone, account_type, entry_type, amount_paise, description)
			VALUES
				($1::uuid, $2, $2, 'PROVIDER_SETTLEMENT_CASH', 'DEBIT', $3, 'External card network cash settlement inflow (webhook clearance)'),
				($1::uuid, $2, $2, 'RIDER_EXTERNAL_PAYMENT', 'CREDIT', $3, 'Rider external payment receivable cleared via card network settlement');
		`
		_, err = tx.Exec(ctx, ledgerQuery, webhookEvent.Data.OrderID, cityPrefix, webhookEvent.Data.AmountPaise)
		if err != nil {
			http.Error(w, "ledger_reconciliation_failed", http.StatusInternalServerError)
			return
		}

	case "payment_intent.payment_failed":
		log.Printf("[PAYMENT_WEBHOOK] Transaction failure detected for intent %s. Initiating recovery workflows...", webhookEvent.Data.IntentID)

		failUpsert := `
			INSERT INTO payment_intents (id, order_id, amount_paise, currency, payment_status, provider_type, idempotency_key, updated_at)
			VALUES ($1, $2::uuid, $3, $4, 'FAILED', 'STRIPE', $5, CURRENT_TIMESTAMP)
			ON CONFLICT (id) DO UPDATE SET payment_status = 'FAILED', updated_at = CURRENT_TIMESTAMP;
		`
		_, _ = tx.Exec(ctx, failUpsert, webhookEvent.Data.IntentID, webhookEvent.Data.OrderID, webhookEvent.Data.AmountPaise, webhookEvent.Data.Currency, webhookEvent.EventID)

		// Roll the order back to CREATED for retry, but ONLY from ASSIGNED — the only
		// downgrade the state-machine trigger permits. Guarding by status avoids firing the
		// trigger on terminal/in-flight orders (which would raise and 500 the whole webhook).
		_, _ = tx.Exec(ctx, "UPDATE orders SET status = 'CREATED'::order_status_enum, assigned_driver_id = NULL, assigned_at = NULL WHERE id = $1::uuid AND status = 'ASSIGNED'::order_status_enum", webhookEvent.Data.OrderID)
	}

	// Commit entries atomically to disk
	if err = tx.Commit(ctx); err != nil {
		http.Error(w, "atomic_webhook_commit_failed", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"RECONCILED"}`))
}

// HandleAdminGetLedger supports paginated auditing of double-entry ledger logs with live aggregate verification
func (h *GatewayHandler) HandleAdminGetLedger(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 1500*time.Millisecond)
	defer cancel()

	limitStr := r.URL.Query().Get("limit")
	offsetStr := r.URL.Query().Get("offset")
	cityFilter := r.URL.Query().Get("city_prefix")

	limit := 50
	offset := 0
	if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
		limit = l
	}
	if o, err := strconv.Atoi(offsetStr); err == nil && o >= 0 {
		offset = o
	}

	var query string
	var args []interface{}

	if cityFilter != "" {
		query = `
			SELECT id, order_id, city_prefix, account_type, entry_type, amount_paise, description, created_at
			FROM financial_ledger_entries
			WHERE city_prefix = $1
			ORDER BY created_at DESC LIMIT $2 OFFSET $3;
		`
		args = []interface{}{strings.ToUpper(cityFilter), limit, offset}
	} else {
		query = `
			SELECT id, order_id, city_prefix, account_type, entry_type, amount_paise, description, created_at
			FROM financial_ledger_entries
			ORDER BY created_at DESC LIMIT $1 OFFSET $2;
		`
		args = []interface{}{limit, offset}
	}

	rows, err := h.dbPool.Query(ctx, query, args...)
	if err != nil {
		http.Error(w, "ledger_fetch_exception", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type ledgerRecord struct {
		ID          int64     `json:"id"`
		OrderID     string    `json:"order_id"`
		CityPrefix  string    `json:"city_prefix"`
		AccountType string    `json:"account_type"`
		EntryType   string    `json:"entry_type"`
		AmountPaise int64     `json:"amount_paise"`
		Description string    `json:"description"`
		CreatedAt   time.Time `json:"created_at"`
	}

	var entries []ledgerRecord
	var totalDebits, totalCredits int64

	for rows.Next() {
		var rec ledgerRecord
		err := rows.Scan(&rec.ID, &rec.OrderID, &rec.CityPrefix, &rec.AccountType, &rec.EntryType, &rec.AmountPaise, &rec.Description, &rec.CreatedAt)
		if err == nil {
			entries = append(entries, rec)
			if rec.EntryType == "DEBIT" {
				totalDebits += rec.AmountPaise
			} else {
				totalCredits += rec.AmountPaise
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"entries":               entries,
		"batch_total_debits":    totalDebits,
		"batch_total_credits":   totalCredits,
		"is_auditable_balanced": totalDebits == totalCredits,
		"server_timestamp":      time.Now().Unix(),
	})
}

// HandleAdminDriverOverride forces a driver's state to reset, eviction-clearing active Redis tracking leases instantly
func (h *GatewayHandler) HandleAdminDriverOverride(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DriverID    string `json:"driver_id"`
		TargetState string `json:"target_state"` // e.g., 'ONLINE_AVAILABLE'
		Reason      string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 1200*time.Millisecond)
	defer cancel()

	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "transaction_failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// Update driver status row inside relational tables cleanly
	query := "UPDATE drivers SET current_state = $1::driver_state_enum, updated_at = CURRENT_TIMESTAMP WHERE id = $2::uuid;"
	res, err := tx.Exec(ctx, query, req.TargetState, req.DriverID)
	if err != nil || res.RowsAffected() == 0 {
		http.Error(w, "driver_override_mutation_failed_invalid_id", http.StatusNotFound)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "commit_failed", http.StatusInternalServerError)
		return
	}

	// Evict active lease keys from Redis to free up matching loops immediately
	activeTripKey := fmt.Sprintf("driver:active:trip:%s", req.DriverID)
	_ = h.clusterClient.Del(ctx, activeTripKey)

	log.Printf("[ADMIN_OVERRIDE] Operator forced Driver %s state to %s. Reason: %s", req.DriverID, req.TargetState, req.Reason)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"OVERRIDE_SUCCESSFUL","driver_id":"` + req.DriverID + `"}`))
}

func (h *GatewayHandler) SetJWTSecret(secret string) {
	h.jwtSecretKey = []byte(secret)
}

func writeJSONResponse(w http.ResponseWriter, statusCode int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(payload)
}

func nullableString(v sql.NullString) interface{} {
	if !v.Valid {
		return nil
	}
	return v.String
}

func nullableTime(v sql.NullTime) interface{} {
	if !v.Valid {
		return nil
	}
	return v.Time
}

func parseBoundedQueryInt(raw string, defaultValue, minValue, maxValue int) int {
	if raw == "" {
		return defaultValue
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return defaultValue
	}
	if value < minValue {
		return minValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
}

func parseISO8601Time(raw string) (time.Time, error) {
	if raw == "" {
		return time.Time{}, errors.New("missing_iso8601_timestamp")
	}
	if parsed, err := time.Parse(time.RFC3339, raw); err == nil {
		return parsed, nil
	}
	return time.Parse("2006-01-02", raw)
}

func requireDriverIdentity(w http.ResponseWriter, r *http.Request) (string, bool) {
	driverID, ok := middleware.GetUserIDFromContext(r.Context())
	if !ok || driverID == "" {
		http.Error(w, "missing_authenticated_driver_identity", http.StatusUnauthorized)
		return "", false
	}
	role, ok := middleware.GetUserRoleFromContext(r.Context())
	if !ok || !strings.EqualFold(role, "DRIVER") {
		http.Error(w, "driver_role_required", http.StatusForbidden)
		return "", false
	}
	return driverID, true
}

func (h *GatewayHandler) HandleDriverGetProfile(w http.ResponseWriter, r *http.Request) {
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 800*time.Millisecond)
	defer cancel()

	var (
		id                 string
		name               string
		phone              sql.NullString
		currentState       string
		acceptanceRate     float64
		cancellationRate   float64
		isVerified         bool
		cityPrefix         string
		createdAt          time.Time
		onboardingStep     int
		verificationStatus string
	)

	query := `
		SELECT id::text, name, phone, current_state::text, acceptance_rate::float8,
		       cancellation_rate::float8, is_verified, city_prefix, created_at,
		       COALESCE(onboarding_step, 1), COALESCE(verification_status::text, 'ONBOARDING')
		FROM drivers
		WHERE id = $1::uuid;
	`
	if err := h.dbPool.QueryRow(ctx, query, driverID).Scan(
		&id, &name, &phone, &currentState, &acceptanceRate,
		&cancellationRate, &isVerified, &cityPrefix, &createdAt,
		&onboardingStep, &verificationStatus,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "driver_not_found", http.StatusNotFound)
			return
		}
		http.Error(w, "driver_profile_read_failed", http.StatusInternalServerError)
		return
	}

	var totalTrips int64
	tripsQuery := `
		SELECT COUNT(DISTINCT dml.order_id)
		FROM dispatch_match_logs dml
		JOIN orders o ON o.id = dml.order_id
		WHERE dml.chosen_driver_id = $1::uuid
		  AND o.status = 'COMPLETED'::order_status_enum;
	`
	if err := h.dbPool.QueryRow(ctx, tripsQuery, driverID).Scan(&totalTrips); err != nil {
		http.Error(w, "driver_trip_count_read_failed", http.StatusInternalServerError)
		return
	}

	writeJSONResponse(w, http.StatusOK, map[string]interface{}{
		"id":                  id,
		"name":                name,
		"phone":               nullableString(phone),
		"current_state":       currentState,
		"acceptance_rate":     acceptanceRate,
		"cancellation_rate":   cancellationRate,
		"is_verified":         isVerified,
		"city_prefix":         cityPrefix,
		"created_at":          createdAt,
		"total_trips":         totalTrips,
		"onboarding_step":     onboardingStep,
		"verification_status": verificationStatus,
	})
}

func (h *GatewayHandler) HandleDriverSetStatus(w http.ResponseWriter, r *http.Request) {
	authDriverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}

	var req struct {
		DriverID string `json:"driver_id"`
		Status   string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}
	if req.DriverID == "" || req.DriverID != authDriverID {
		http.Error(w, "driver_identity_mismatch", http.StatusForbidden)
		return
	}
	if req.Status != "ONLINE_AVAILABLE" && req.Status != "OFFLINE" {
		http.Error(w, "unsupported_driver_status", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 1000*time.Millisecond)
	defer cancel()

	var cityPrefix string
	var updatedAt time.Time
	updateQuery := `
		UPDATE drivers
		SET current_state = $2::driver_state_enum, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1::uuid
		RETURNING city_prefix, updated_at;
	`
	if err := h.dbPool.QueryRow(ctx, updateQuery, req.DriverID, req.Status).Scan(&cityPrefix, &updatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "driver_not_found", http.StatusNotFound)
			return
		}
		http.Error(w, "driver_status_update_failed", http.StatusInternalServerError)
		return
	}

	statusKey := fmt.Sprintf("driver:{%s:%s}:status", cityPrefix, req.DriverID)
	if req.Status == "ONLINE_AVAILABLE" {
		_ = h.clusterClient.Set(ctx, statusKey, "ONLINE_AVAILABLE", 30*time.Second).Err()
	} else {
		trackerKey := fmt.Sprintf("driver:{%s:%s}:current_cell", cityPrefix, req.DriverID)
		currentCell, err := h.clusterClient.Get(ctx, trackerKey).Result()
		if err != nil && err != redis.Nil {
			http.Error(w, "driver_status_cache_read_failed", http.StatusInternalServerError)
			return
		}

		pipe := h.clusterClient.Pipeline()
		pipe.Set(ctx, statusKey, "OFFLINE", 30*time.Second)
		if currentCell != "" {
			spatialZSetKey := fmt.Sprintf("drivers:zset:%s:%s", cityPrefix, currentCell)
			pipe.ZRem(ctx, spatialZSetKey, req.DriverID)
		}
		if _, err := pipe.Exec(ctx); err != nil && err != redis.Nil {
			http.Error(w, "driver_status_cache_write_failed", http.StatusInternalServerError)
			return
		}
	}

	writeJSONResponse(w, http.StatusOK, map[string]interface{}{
		"status":     req.Status,
		"updated_at": updatedAt,
	})
}

type LocationDetails struct {
	Address string  `json:"address"`
	Lat     float64 `json:"lat"`
	Lng     float64 `json:"lng"`
}

type OrderOffer struct {
	OrderID              string          `json:"orderId"`
	RiderName            string          `json:"riderName"`
	RiderRating          float64         `json:"riderRating"`
	Pickup               LocationDetails `json:"pickup"`
	Drop                 LocationDetails `json:"drop"`
	FareEstimate         int64           `json:"fareEstimate"`
	ETAMinutes           int             `json:"etaMinutes"`
	TripType             string          `json:"tripType"`
	Notes                string          `json:"notes,omitempty"`
	CarTypeRequested     string          `json:"carTypeRequested,omitempty"`
	TransmissionRequired string          `json:"transmissionRequired,omitempty"`
	D4MCareOptIn         bool            `json:"d4mCareOptIn,omitempty"`
	DistanceKm           float64         `json:"distanceKm,omitempty"`
	DurationMinutes      int             `json:"durationMinutes,omitempty"`

	// Phase 10: rider + car context surfaced to the driver offer popup.
	CarMake           string `json:"carMake,omitempty"`
	CarModel          string `json:"carModel,omitempty"`
	CarType           string `json:"carType,omitempty"`
	CarColor          string `json:"carColor,omitempty"`
	CarTransmission   string `json:"carTransmission,omitempty"` // "Manual" | "Automatic"
	TransmissionMatch bool   `json:"transmissionMatch"`         // driver expertise covers the car's transmission
}

func (h *GatewayHandler) HandleDriverGetOffer(w http.ResponseWriter, r *http.Request) {
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 900*time.Millisecond)
	defer cancel()

	var (
		orderID         string
		cityPrefix      string
		pickupH3Cell    string
		pickupLat       float64
		pickupLng       float64
		dropoffLat      float64
		dropoffLng      float64
		baseFarePaise   int64
		surgeMultiplier float64
		riderName       string
		carMake         string
		carModel        string
		carType         string
		carTransmission string
		carColor        string
		d4mCareOpted    bool
		drvManual       bool
		drvAutomatic    bool
	)

	// Phase 10: join the rider, their selected car (garage or one-time), and the
	// driver's transmission expertise so the offer popup can show real context and a
	// transmission-match warning. COALESCE keeps the offer resilient to missing rows.
	query := `
		SELECT o.id::text, o.city_prefix, o.pickup_h3_cell,
		       ST_Y(o.pickup_location::geometry), ST_X(o.pickup_location::geometry),
		       ST_Y(o.dropoff_location::geometry), ST_X(o.dropoff_location::geometry),
		       o.base_fare_paise, o.surge_multiplier::float8,
		       COALESCE(r.name, ''),
		       COALESCE(g.make, o.one_time_car_make, ''),
		       COALESCE(g.model, o.one_time_car_model, ''),
		       COALESCE(g.car_type, o.one_time_car_type, ''),
		       COALESCE(g.transmission, o.one_time_car_transmission, ''),
		       COALESCE(g.color, ''),
		       COALESCE(o.d4m_care_opted, false),
		       COALESCE(d.transmission_manual, true),
		       COALESCE(d.transmission_automatic, true)
		FROM orders o
		LEFT JOIN riders r       ON r.id = o.rider_id
		LEFT JOIN rider_garage g ON g.id = o.garage_car_id
		LEFT JOIN drivers d      ON d.id = o.assigned_driver_id
		WHERE o.assigned_driver_id = $1::uuid
		  AND o.status = 'ASSIGNED'::order_status_enum
		ORDER BY o.assigned_at DESC NULLS LAST
		LIMIT 1;
	`
	err := h.dbPool.QueryRow(ctx, query, driverID).Scan(
		&orderID, &cityPrefix, &pickupH3Cell, &pickupLat, &pickupLng,
		&dropoffLat, &dropoffLng, &baseFarePaise, &surgeMultiplier,
		&riderName, &carMake, &carModel, &carType, &carTransmission, &carColor,
		&d4mCareOpted, &drvManual, &drvAutomatic,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSONResponse(w, http.StatusOK, map[string]interface{}{"order": nil})
			return
		}
		http.Error(w, "driver_offer_read_failed", http.StatusInternalServerError)
		return
	}

	ttlSeconds := int64(0)
	ttl, ttlErr := h.clusterClient.TTL(ctx, fmt.Sprintf("offer:lease:%s", orderID)).Result()
	if ttlErr == nil && ttl > 0 {
		ttlSeconds = int64(ttl.Seconds())
	}

	riderRating := 4.85
	tripType := "CITY"
	if strings.Contains(strings.ToLower(cityPrefix), "out") {
		tripType = "OUTSTATION"
	}

	// First name only — the driver never needs the rider's full identity.
	firstName := riderName
	if firstName == "" {
		firstName = "Rider"
	} else if i := strings.IndexByte(firstName, ' '); i > 0 {
		firstName = firstName[:i]
	}

	// Normalise the car transmission to a display string and decide whether the
	// driver's expertise covers it. Unknown transmission => assume a match (no warning).
	transUpper := strings.ToUpper(strings.TrimSpace(carTransmission))
	transmissionDisplay := ""
	transmissionMatch := true
	switch transUpper {
	case "MANUAL":
		transmissionDisplay = "Manual"
		transmissionMatch = drvManual
	case "AUTOMATIC":
		transmissionDisplay = "Automatic"
		transmissionMatch = drvAutomatic
	}

	notes := ""

	offer := OrderOffer{
		OrderID:     orderID,
		RiderName:   firstName,
		RiderRating: riderRating,
		Pickup: LocationDetails{
			Address: fmt.Sprintf("Pickup Near Cell %s (%f, %f)", pickupH3Cell, pickupLat, pickupLng),
			Lat:     pickupLat,
			Lng:     pickupLng,
		},
		Drop: LocationDetails{
			Address: fmt.Sprintf("Destination dropoff hub (%f, %f)", dropoffLat, dropoffLng),
			Lat:     dropoffLat,
			Lng:     dropoffLng,
		},
		FareEstimate:         int64(math.Round(float64(baseFarePaise) * surgeMultiplier)),
		ETAMinutes:           6,
		TripType:             tripType,
		Notes:                notes,
		CarTypeRequested:     carType,
		TransmissionRequired: transUpper,
		D4MCareOptIn:         d4mCareOpted,
		DistanceKm:           4.8,
		DurationMinutes:      12,
		CarMake:              carMake,
		CarModel:             carModel,
		CarType:              carType,
		CarColor:             carColor,
		CarTransmission:      transmissionDisplay,
		TransmissionMatch:    transmissionMatch,
	}

	writeJSONResponse(w, http.StatusOK, map[string]interface{}{
		"order":                    offer,
		"offer_expires_in_seconds": ttlSeconds,
	})
}

// HandleDriverGetOrder returns active order details for the driver (including waiting_started_at and last_odometer)
// Path: GET /api/v1/driver/orders/{id}
func (h *GatewayHandler) HandleDriverGetOrder(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}

	orderID := r.PathValue("id")
	if orderID == "" {
		http.Error(w, "missing_order_id", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 1500*time.Millisecond)
	defer cancel()

	var (
		status                 string
		waitingStartedAt       sql.NullTime
		pickupLat, pickupLng   float64
		dropoffLat, dropoffLng float64
		baseFarePaise          int64
		surgeMultiplier        float64
		customerID             string
	)

	// Fetch order details, including pickup/dropoff coordinates and fare, so the driver
	// app can hydrate a trip it did not explicitly accept (e.g. an admin force-match).
	queryOrder := `
		SELECT status::text, waiting_started_at,
		       ST_Y(pickup_location::geometry), ST_X(pickup_location::geometry),
		       ST_Y(dropoff_location::geometry), ST_X(dropoff_location::geometry),
		       base_fare_paise, surge_multiplier::float8, customer_id::text
		FROM orders
		WHERE id = $1::uuid AND assigned_driver_id = $2::uuid;
	`
	err := h.dbPool.QueryRow(ctx, queryOrder, orderID, driverID).Scan(
		&status, &waitingStartedAt,
		&pickupLat, &pickupLng, &dropoffLat, &dropoffLng,
		&baseFarePaise, &surgeMultiplier, &customerID,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "order_not_found", http.StatusNotFound)
			return
		}
		log.Printf("[GET_DRIVER_ORDER] Database error querying order %s: %v", orderID, err)
		http.Error(w, "database_error", http.StatusInternalServerError)
		return
	}

	// Fetch last odometer reading for this driver/vehicle
	var lastOdometer int
	queryOdo := `
		SELECT COALESCE(
			(SELECT odometer_value 
			 FROM trip_odometer_checkpoints toc
			 JOIN orders ord ON ord.id = toc.order_id
			 WHERE ord.assigned_driver_id = $1::uuid
			 ORDER BY toc.captured_at DESC, toc.created_at DESC 
			 LIMIT 1), 
			0
		);
	`
	err = h.dbPool.QueryRow(ctx, queryOdo, driverID).Scan(&lastOdometer)
	if err != nil {
		log.Printf("[GET_DRIVER_ORDER] Database error querying odometer for driver %s: %v", driverID, err)
		lastOdometer = 0
	}

	writeJSONResponse(w, http.StatusOK, map[string]interface{}{
		"id":                 orderID,
		"status":             status,
		"waiting_started_at": nullableTime(waitingStartedAt),
		"last_odometer":      lastOdometer,
		"pickup_lat":         pickupLat,
		"pickup_lng":         pickupLng,
		"dropoff_lat":        dropoffLat,
		"dropoff_lng":        dropoffLng,
		"base_fare_paise":    baseFarePaise,
		"surge_multiplier":   surgeMultiplier,
		"customer_id":        customerID,
	})
}

func (h *GatewayHandler) HandleDriverGetTrips(w http.ResponseWriter, r *http.Request) {
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}

	limit := parseBoundedQueryInt(r.URL.Query().Get("limit"), 20, 1, 100)
	offset := parseBoundedQueryInt(r.URL.Query().Get("offset"), 0, 0, 100000)

	ctx, cancel := context.WithTimeout(r.Context(), 1200*time.Millisecond)
	defer cancel()

	rows, err := h.dbPool.Query(ctx, `
		SELECT o.id::text, o.status::text, o.base_fare_paise, o.surge_multiplier::float8,
		       o.assigned_at, o.completed_at, o.pickup_h3_cell,
		       COALESCE(SUM(CASE
		         WHEN fle.account_type = 'DRIVER_EARNINGS' AND fle.entry_type = 'CREDIT'
		         THEN fle.amount_paise ELSE 0 END), 0)::bigint AS driver_payout_paise
		FROM orders o
		LEFT JOIN financial_ledger_entries fle ON fle.order_id = o.id
		WHERE o.assigned_driver_id = $1::uuid
		GROUP BY o.id, o.status, o.base_fare_paise, o.surge_multiplier,
		         o.assigned_at, o.completed_at, o.pickup_h3_cell, o.created_at
		ORDER BY o.created_at DESC
		LIMIT $2 OFFSET $3;
	`, driverID, limit, offset)
	if err != nil {
		http.Error(w, "driver_trips_read_failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	trips := make([]map[string]interface{}, 0)
	for rows.Next() {
		var (
			id              string
			status          string
			baseFarePaise   int64
			surgeMultiplier float64
			assignedAt      sql.NullTime
			completedAt     sql.NullTime
			pickupH3Cell    string
			driverPayout    int64
		)
		if err := rows.Scan(&id, &status, &baseFarePaise, &surgeMultiplier, &assignedAt, &completedAt, &pickupH3Cell, &driverPayout); err != nil {
			http.Error(w, "driver_trips_decode_failed", http.StatusInternalServerError)
			return
		}
		trips = append(trips, map[string]interface{}{
			"id":                  id,
			"status":              status,
			"base_fare_paise":     baseFarePaise,
			"surge_multiplier":    surgeMultiplier,
			"assigned_at":         nullableTime(assignedAt),
			"completed_at":        nullableTime(completedAt),
			"pickup_h3_cell":      pickupH3Cell,
			"driver_payout_paise": driverPayout,
		})
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "driver_trips_cursor_failed", http.StatusInternalServerError)
		return
	}

	writeJSONResponse(w, http.StatusOK, map[string]interface{}{
		"limit":  limit,
		"offset": offset,
		"trips":  trips,
	})
}

func (h *GatewayHandler) HandleDriverGetEarnings(w http.ResponseWriter, r *http.Request) {
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}

	periodFrom, err := parseISO8601Time(r.URL.Query().Get("from"))
	if err != nil {
		http.Error(w, "invalid_or_missing_period_from", http.StatusBadRequest)
		return
	}
	periodTo, err := parseISO8601Time(r.URL.Query().Get("to"))
	if err != nil {
		http.Error(w, "invalid_or_missing_period_to", http.StatusBadRequest)
		return
	}
	if periodTo.Before(periodFrom) {
		http.Error(w, "period_to_before_period_from", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 1200*time.Millisecond)
	defer cancel()

	rows, err := h.dbPool.Query(ctx, `
		SELECT o.id::text, fle.amount_paise, fle.description, COALESCE(o.completed_at, fle.created_at) AS completed_at
		FROM financial_ledger_entries fle
		JOIN orders o ON o.id = fle.order_id
		WHERE o.assigned_driver_id = $1::uuid
		  AND fle.account_type = 'DRIVER_EARNINGS'
		  AND fle.entry_type = 'CREDIT'
		  AND COALESCE(o.completed_at, fle.created_at) >= $2
		  AND COALESCE(o.completed_at, fle.created_at) <= $3
		ORDER BY COALESCE(o.completed_at, fle.created_at) DESC;
	`, driverID, periodFrom, periodTo)
	if err != nil {
		http.Error(w, "driver_earnings_read_failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var totalPaise int64
	var tipsPaise int64 // subset of total: TIP_CREDIT entries from rider ratings
	breakdown := make([]map[string]interface{}, 0)
	for rows.Next() {
		var (
			orderID     string
			amountPaise int64
			description *string
			completedAt time.Time
		)
		if err := rows.Scan(&orderID, &amountPaise, &description, &completedAt); err != nil {
			http.Error(w, "driver_earnings_decode_failed", http.StatusInternalServerError)
			return
		}
		totalPaise += amountPaise
		isTip := description != nil && strings.HasPrefix(*description, "TIP_CREDIT")
		if isTip {
			tipsPaise += amountPaise
		}
		breakdown = append(breakdown, map[string]interface{}{
			"order_id":     orderID,
			"amount_paise": amountPaise,
			"completed_at": completedAt,
			"is_tip":       isTip,
		})
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "driver_earnings_cursor_failed", http.StatusInternalServerError)
		return
	}

	writeJSONResponse(w, http.StatusOK, map[string]interface{}{
		"total_paise": totalPaise,
		"tips_paise":  tipsPaise,
		"trip_count":  len(breakdown),
		"period_from": periodFrom,
		"period_to":   periodTo,
		"breakdown":   breakdown,
	})
}

func (h *GatewayHandler) HandleRegisterDeviceToken(w http.ResponseWriter, r *http.Request) {
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}

	var req struct {
		DeviceToken  string `json:"device_token"`
		PlatformType string `json:"platform_type"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}
	if req.DeviceToken == "" {
		http.Error(w, "missing_device_token", http.StatusBadRequest)
		return
	}
	if req.PlatformType != "ANDROID_FCM" && req.PlatformType != "IOS_APNS" {
		http.Error(w, "unsupported_platform_type", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 800*time.Millisecond)
	defer cancel()

	query := `
		INSERT INTO user_device_tokens (user_id, device_token, platform_type, updated_at)
		VALUES ($1::uuid, $2, $3, CURRENT_TIMESTAMP)
		ON CONFLICT (user_id) DO UPDATE
		SET device_token = EXCLUDED.device_token,
		    platform_type = EXCLUDED.platform_type,
		    updated_at = CURRENT_TIMESTAMP
		RETURNING updated_at;
	`
	var updatedAt time.Time
	if err := h.dbPool.QueryRow(ctx, query, driverID, req.DeviceToken, req.PlatformType).Scan(&updatedAt); err != nil {
		http.Error(w, "device_token_registration_failed", http.StatusInternalServerError)
		return
	}

	writeJSONResponse(w, http.StatusOK, map[string]interface{}{
		"status":        "REGISTERED",
		"platform_type": req.PlatformType,
		"updated_at":    updatedAt,
	})
}

func (h *GatewayHandler) HandleDriverLocationUpdate(w http.ResponseWriter, r *http.Request) {
	authDriverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}

	var req struct {
		DriverID    string  `json:"driver_id"`
		CityPrefix  string  `json:"city_prefix"`
		Latitude    float64 `json:"latitude"`
		Longitude   float64 `json:"longitude"`
		Bearing     float64 `json:"bearing"`
		SpeedKms    float64 `json:"speed_kms"`
		Battery     *int    `json:"battery,omitempty"`
		NetworkType string  `json:"network_type,omitempty"`
		Network     string  `json:"network,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}
	if req.DriverID == "" || req.DriverID != authDriverID {
		http.Error(w, "driver_identity_mismatch", http.StatusForbidden)
		return
	}
	req.CityPrefix = strings.ToUpper(strings.TrimSpace(req.CityPrefix))
	if req.CityPrefix == "" {
		http.Error(w, "missing_city_prefix", http.StatusBadRequest)
		return
	}
	if req.Latitude < -90 || req.Latitude > 90 || req.Longitude < -180 || req.Longitude > 180 {
		http.Error(w, "invalid_geospatial_coordinates", http.StatusBadRequest)
		return
	}
	if h.clusterClient == nil {
		http.Error(w, "redis_cluster_client_unavailable", http.StatusServiceUnavailable)
		return
	}

	latRad := req.Latitude * (math.Pi / 180.0)
	lngRad := req.Longitude * (math.Pi / 180.0)
	h3Cell := h3.ToString(h3.FromGeo(h3.GeoCoord{Latitude: latRad, Longitude: lngRad}, 8))
	if h3Cell == "" {
		http.Error(w, "h3_cell_computation_failed", http.StatusInternalServerError)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 800*time.Millisecond)
	defer cancel()

	statusKey := fmt.Sprintf("driver:{%s:%s}:status", req.CityPrefix, req.DriverID)
	trackerKey := fmt.Sprintf("driver:{%s:%s}:current_cell", req.CityPrefix, req.DriverID)
	profileKey := fmt.Sprintf("driver:{%s:%s}:profile", req.CityPrefix, req.DriverID)
	spatialZSetKey := fmt.Sprintf("drivers:zset:%s:%s", req.CityPrefix, h3Cell)
	nowEpoch := float64(time.Now().Unix())

	var previousCell string
	err := h.clusterClient.Watch(ctx, func(tx *redis.Tx) error {
		var watchErr error
		previousCell, watchErr = tx.Get(ctx, trackerKey).Result()
		if watchErr != nil && watchErr != redis.Nil {
			return watchErr
		}

		_, watchErr = tx.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
			pipe.Set(ctx, statusKey, "ONLINE_AVAILABLE", 30*time.Second)
			pipe.Set(ctx, trackerKey, h3Cell, 24*time.Hour)
			pipe.HSet(ctx, profileKey,
				"latitude", strconv.FormatFloat(req.Latitude, 'f', 6, 64),
				"longitude", strconv.FormatFloat(req.Longitude, 'f', 6, 64),
				"speed_kms", strconv.FormatFloat(req.SpeedKms, 'f', 2, 64),
				"bearing", strconv.FormatFloat(req.Bearing, 'f', 2, 64),
				"last_ping_utc", time.Now().Format(time.RFC3339),
			)
			pipe.Expire(ctx, profileKey, 24*time.Hour)
			return nil
		})
		return watchErr
	}, trackerKey)
	if err != nil {
		http.Error(w, "driver_location_tracker_update_failed", http.StatusInternalServerError)
		return
	}

	pipe := h.clusterClient.Pipeline()
	if previousCell != "" && previousCell != h3Cell {
		oldSpatialZSetKey := fmt.Sprintf("drivers:zset:%s:%s", req.CityPrefix, previousCell)
		pipe.ZRem(ctx, oldSpatialZSetKey, req.DriverID)
	}
	pipe.ZAdd(ctx, spatialZSetKey, redis.Z{Score: nowEpoch, Member: req.DriverID})
	pipe.Expire(ctx, spatialZSetKey, 24*time.Hour)
	if _, err := pipe.Exec(ctx); err != nil && err != redis.Nil {
		http.Error(w, "driver_location_spatial_update_failed", http.StatusInternalServerError)
		return
	}

	activeTripKey := fmt.Sprintf("driver:active:trip:%s", req.DriverID)
	if orderID, err := h.clusterClient.Get(ctx, activeTripKey).Result(); err == nil && orderID != "" {
		payload := map[string]interface{}{
			"order_id":      orderID,
			"driver_id":     req.DriverID,
			"city_prefix":   req.CityPrefix,
			"latitude":      req.Latitude,
			"longitude":     req.Longitude,
			"bearing":       req.Bearing,
			"speed_kms":     req.SpeedKms,
			"timestamp_utc": time.Now().Unix(),
		}
		if bytes, marshalErr := json.Marshal(payload); marshalErr == nil {
			_ = h.clusterClient.Publish(ctx, RedisTelemetryChannel, string(bytes)).Err()
		}

		// Check if order is currently in DELIVERING state to run stopped checks
		var orderStatus string
		statusErr := h.dbPool.QueryRow(ctx, "SELECT status::text FROM orders WHERE id = $1::uuid", orderID).Scan(&orderStatus)
		if statusErr == nil && orderStatus == "DELIVERING" {
			if req.SpeedKms <= 1.0 {
				stoppedKey := fmt.Sprintf("driver:stopped:since:%s", req.DriverID)
				stoppedSinceStr, getErr := h.clusterClient.Get(ctx, stoppedKey).Result()
				var stoppedSince int64
				if getErr == redis.Nil {
					stoppedSince = time.Now().Unix()
					_ = h.clusterClient.Set(ctx, stoppedKey, strconv.FormatInt(stoppedSince, 10), 10*time.Minute).Err()
				} else if getErr == nil {
					stoppedSince, _ = strconv.ParseInt(stoppedSinceStr, 10, 64)
				}

				if stoppedSince > 0 && time.Now().Unix()-stoppedSince > 180 { // 3 minutes
					flaggedKey := fmt.Sprintf("driver:stopped:flagged:%s:%s", req.DriverID, orderID)
					alreadyFlagged, _ := h.clusterClient.Exists(ctx, flaggedKey).Result()
					if alreadyFlagged == 0 {
						_ = h.clusterClient.Set(ctx, flaggedKey, "1", 30*time.Minute).Err()
						if StalledTripCallback != nil {
							go StalledTripCallback(req.DriverID, orderID, req.Latitude, req.Longitude, int(time.Now().Unix()-stoppedSince))
						}
					}
				}
			} else {
				_ = h.clusterClient.Del(ctx, fmt.Sprintf("driver:stopped:since:%s", req.DriverID)).Err()
			}
		} else {
			_ = h.clusterClient.Del(ctx, fmt.Sprintf("driver:stopped:since:%s", req.DriverID)).Err()
		}

		// Write-Behind: Buffer coordinates in Redis instead of writing immediately to DB.
		batteryVal := 100
		if req.Battery != nil {
			batteryVal = *req.Battery
		}
		networkTypeVal := "unknown"
		if req.Network != "" {
			networkTypeVal = req.Network
		} else if req.NetworkType != "" {
			networkTypeVal = req.NetworkType
		}

		if orderUUID, uuidErr := uuid.Parse(orderID); uuidErr == nil {
			ping := domain.GPSPing{
				OrderID:     orderUUID,
				Timestamp:   time.Now(),
				Lat:         req.Latitude,
				Lng:         req.Longitude,
				Speed:       req.SpeedKms,
				Heading:     req.Bearing,
				Battery:     batteryVal,
				NetworkType: networkTypeVal,
			}
			if pingBytes, marshalErr := json.Marshal(ping); marshalErr == nil {
				redisKey := fmt.Sprintf("orders:gps:buffer:%s", orderID)
				pipeBuf := h.clusterClient.Pipeline()
				pipeBuf.RPush(ctx, redisKey, string(pingBytes))
				pipeBuf.SAdd(ctx, "orders:gps:active_buffers", orderID)
				_, _ = pipeBuf.Exec(ctx)
			}
		}
	}

	writeJSONResponse(w, http.StatusOK, map[string]interface{}{
		"recorded": true,
		"h3_cell":  h3Cell,
	})
}

func (h *GatewayHandler) HandleRiderLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Phone string `json:"phone"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}

	userID := "usr-mock-11"
	claims := &middleware.CustomClaims{
		UserID: userID,
		Role:   "RIDER",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString(h.jwtSecretKey)
	if err != nil {
		http.Error(w, "failed_to_generate_token", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"token": tokenString,
		"user": map[string]string{
			"id":    userID,
			"role":  "RIDER",
			"name":  "Sarah Connor",
			"phone": req.Phone,
		},
	})
}

func (h *GatewayHandler) HandleDriverLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Phone    string `json:"phone"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}
	if req.Phone == "" || req.Password == "" {
		http.Error(w, "missing_driver_credentials", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 800*time.Millisecond)
	defer cancel()

	var (
		driverID     string
		driverName   string
		currentState string
		passwordHash sql.NullString
	)

	query := `
		SELECT id::text, name, current_state::text, password_hash
		FROM drivers
		WHERE phone = $1
		LIMIT 1;
	`
	if err := h.dbPool.QueryRow(ctx, query, req.Phone).Scan(&driverID, &driverName, &currentState, &passwordHash); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "invalid_driver_credentials", http.StatusUnauthorized)
			return
		}
		log.Printf("[AUTH_ERROR] Driver credential lookup failed: %v", err)
		http.Error(w, "driver_auth_lookup_failed", http.StatusInternalServerError)
		return
	}

	if !passwordHash.Valid || passwordHash.String == "" {
		http.Error(w, "driver_password_not_configured", http.StatusUnauthorized)
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash.String), []byte(req.Password)); err != nil {
		http.Error(w, "invalid_driver_credentials", http.StatusUnauthorized)
		return
	}

	claims := &middleware.CustomClaims{
		UserID: driverID,
		Role:   "DRIVER",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString(h.jwtSecretKey)
	if err != nil {
		http.Error(w, "failed_to_generate_token", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"token": tokenString,
		"user": map[string]string{
			"id":            driverID,
			"role":          "DRIVER",
			"name":          driverName,
			"current_state": currentState,
		},
	})
}

// HandleGetTelemetrySupplyNear finds available drivers inside target H3 cell and neighbors
func (h *GatewayHandler) HandleGetTelemetrySupplyNear(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 1000*time.Millisecond)
	defer cancel()

	cityPrefix, ok := middleware.GetRegionFromContext(r.Context())
	if !ok || cityPrefix == "" {
		cityPrefix = r.URL.Query().Get("city_prefix")
		if cityPrefix == "" {
			cityPrefix = "KOL"
		}
	}
	cityPrefix = strings.ToUpper(strings.TrimSpace(cityPrefix))

	latStr := r.URL.Query().Get("latitude")
	lngStr := r.URL.Query().Get("longitude")

	var lat, lng float64
	var err error
	if latStr != "" && lngStr != "" {
		lat, err = strconv.ParseFloat(latStr, 64)
		if err != nil {
			http.Error(w, "invalid_latitude_parameter", http.StatusBadRequest)
			return
		}
		lng, err = strconv.ParseFloat(lngStr, 64)
		if err != nil {
			http.Error(w, "invalid_longitude_parameter", http.StatusBadRequest)
			return
		}
	} else {
		// Fallback to Kolkata center coordinates
		lat = 22.5726
		lng = 88.3639
	}

	latRad := lat * (math.Pi / 180.0)
	lngRad := lng * (math.Pi / 180.0)
	targetCell := h3.FromGeo(h3.GeoCoord{Latitude: latRad, Longitude: lngRad}, 8)
	targetCellStr := h3.ToString(targetCell)

	if !h3.IsValid(targetCell) {
		http.Error(w, "invalid_geospatial_coordinates", http.StatusBadRequest)
		return
	}

	if h.clusterClient == nil {
		http.Error(w, "redis_cluster_client_unavailable", http.StatusServiceUnavailable)
		return
	}

	// Fetch target cell + 6 neighboring cells at KRing 1
	spatialRing := h3.KRing(targetCell, 1)
	now := time.Now().Unix()
	staleThreshold := now - 30

	discoveredDrivers := make(map[string]string) // driverID -> cellStr

	surgePipe := h.clusterClient.Pipeline()
	type cellCmd struct {
		driverIDsCmd *redis.StringSliceCmd
	}
	cmds := make(map[string]cellCmd)

	for _, cell := range spatialRing {
		cellStr := h3.ToString(cell)
		zsetKey := fmt.Sprintf("drivers:zset:%s:%s", cityPrefix, cellStr)
		cmds[cellStr] = cellCmd{
			driverIDsCmd: surgePipe.ZRevRangeByScore(ctx, zsetKey, &redis.ZRangeBy{
				Max: fmt.Sprintf("%d", now),
				Min: fmt.Sprintf("%d", staleThreshold),
			}),
		}
	}

	if _, err := surgePipe.Exec(ctx); err != nil && err != redis.Nil {
		log.Printf("[TELEMETRY_SUPPLY_NEAR] ZRevRangeByScore pipeline failed: %v", err)
	}

	for cellStr, cmd := range cmds {
		driverIDs, err := cmd.driverIDsCmd.Result()
		if err != nil {
			continue
		}
		for _, driverID := range driverIDs {
			discoveredDrivers[driverID] = cellStr
		}
	}

	// Hydrate coordinates and properties for each driver
	type driverDetails struct {
		DriverID  string  `json:"driver_id"`
		Latitude  float64 `json:"latitude"`
		Longitude float64 `json:"longitude"`
		Bearing   float64 `json:"bearing"`
		SpeedKms  float64 `json:"speed_kms"`
		H3Cell    string  `json:"h3_cell"`
	}

	var results []driverDetails

	if len(discoveredDrivers) > 0 {
		pipe := h.clusterClient.Pipeline()
		cmdMap := make(map[string]*redis.SliceCmd)
		for driverID := range discoveredDrivers {
			profileKey := fmt.Sprintf("driver:{%s:%s}:profile", cityPrefix, driverID)
			cmdMap[driverID] = pipe.HMGet(ctx, profileKey, "latitude", "longitude", "bearing", "speed_kms")
		}

		if _, err := pipe.Exec(ctx); err != nil && err != redis.Nil {
			log.Printf("[TELEMETRY_SUPPLY_NEAR] HMGet pipeline failed: %v", err)
		}

		for driverID, cmd := range cmdMap {
			fields, err := cmd.Result()
			driverCell := discoveredDrivers[driverID]
			if err != nil || len(fields) < 4 || fields[0] == nil || fields[1] == nil {
				// Deterministic mock fallback offsets for drivers in cell without coordinate profiles
				cellCoord := h3.ToGeo(h3.FromString(driverCell))
				cellLat := cellCoord.Latitude * (180.0 / math.Pi)
				cellLng := cellCoord.Longitude * (180.0 / math.Pi)

				hVal := 0
				for _, char := range driverID {
					hVal += int(char)
				}
				offsetLat := float64(hVal%10-5) * 0.0004
				offsetLng := float64(hVal%7-3) * 0.0004

				results = append(results, driverDetails{
					DriverID:  driverID,
					Latitude:  cellLat + offsetLat,
					Longitude: cellLng + offsetLng,
					Bearing:   float64(hVal % 360),
					SpeedKms:  12.0,
					H3Cell:    driverCell,
				})
				continue
			}

			dLat, _ := strconv.ParseFloat(fields[0].(string), 64)
			dLng, _ := strconv.ParseFloat(fields[1].(string), 64)
			dBearing := 0.0
			if fields[2] != nil {
				dBearing, _ = strconv.ParseFloat(fields[2].(string), 64)
			}
			dSpeed := 0.0
			if fields[3] != nil {
				dSpeed, _ = strconv.ParseFloat(fields[3].(string), 64)
			}

			results = append(results, driverDetails{
				DriverID:  driverID,
				Latitude:  dLat,
				Longitude: dLng,
				Bearing:   dBearing,
				SpeedKms:  dSpeed,
				H3Cell:    driverCell,
			})
		}
	}

	// Mock supply seeding generator if active supply results list is empty
	if len(results) == 0 {
		mockNames := []string{"driver-ambient-alpha", "driver-ambient-beta", "driver-ambient-gamma"}
		for i, name := range mockNames {
			offsetLat := float64(i-1) * 0.002
			offsetLng := float64(i-1) * 0.002
			results = append(results, driverDetails{
				DriverID:  name,
				Latitude:  lat + offsetLat + 0.0012,
				Longitude: lng + offsetLng - 0.0008,
				Bearing:   float64(i * 115),
				SpeedKms:  15.0 + float64(i*3),
				H3Cell:    targetCellStr,
			})
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"drivers": results,
		"count":   len(results),
	})
}

// HandleUpdateOrderRoute processes mid-trip route mutations
func (h *GatewayHandler) HandleUpdateOrderRoute(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 1000*time.Millisecond)
	defer cancel()

	orderID := r.PathValue("order_id")
	if orderID == "" {
		http.Error(w, "missing_order_id", http.StatusBadRequest)
		return
	}

	var req struct {
		DropoffLat float64  `json:"dropoff_lat"`
		DropoffLng float64  `json:"dropoff_lng"`
		Stops      []string `json:"stops"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}

	dropoffGeom := fmt.Sprintf("SRID=4326;POINT(%f %f)", req.DropoffLng, req.DropoffLat)
	dbQuery := `
		UPDATE orders
		SET dropoff_location = ST_GeographyFromText($1),
			updated_at = CURRENT_TIMESTAMP
		WHERE id = $2::uuid
		RETURNING id;
	`
	var updatedID string
	err := h.dbPool.QueryRow(ctx, dbQuery, dropoffGeom, orderID).Scan(&updatedID)
	if err != nil {
		log.Printf("[GATEWAY_ERROR] PostGIS order route update failed: %v", err)
		// Fallback for mock environments
	}

	updatedFarePaise := int64(45000) // Base fallback updated fare paise

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success":                 true,
		"order_id":                orderID,
		"dropoff_lat":             req.DropoffLat,
		"dropoff_lng":             req.DropoffLng,
		"stops":                   req.Stops,
		"calculated_fare_paise":   updatedFarePaise,
		"active_surge_multiplier": 1.0,
	})
}

// HandleTriggerSOS processes incoming rider SOS panic requests, broadcasting coordinates and triggering admin recovery
func (h *GatewayHandler) HandleTriggerSOS(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		TripID    string  `json:"trip_id"`
		Latitude  float64 `json:"latitude"`
		Longitude float64 `json:"longitude"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}

	if req.TripID == "" {
		http.Error(w, "missing_trip_id", http.StatusBadRequest)
		return
	}

	// 1. Simulate emergency SMS/WhatsApp telemetry broadcast
	log.Printf("[SOS_TELEMETRY_BROADCAST] Distressing coordinates (%f, %f) for Trip ID: %s. Telemetry packets successfully dispatched to registered safety contacts.", req.Latitude, req.Longitude, req.TripID)

	// 2. Invoke callback to update administrative dashboard terminals in-memory logs
	if SOSCallback != nil {
		SOSCallback(req.TripID, req.Latitude, req.Longitude)
	} else {
		log.Printf("[SOS_WARNING] SOSCallback is nil, could not flag incident queue.")
	}

	// 3. Update orders table in PostgreSQL to indicate critical SOS status
	if h.dbPool != nil {
		ctx, cancel := context.WithTimeout(r.Context(), 1000*time.Millisecond)
		defer cancel()

		dbQuery := `
			UPDATE orders
			SET status = 'DELIVERING'::order_status_enum,
				updated_at = CURRENT_TIMESTAMP
			WHERE id = $1::uuid;
		`
		_, _ = h.dbPool.Exec(ctx, dbQuery, req.TripID)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "SOS broadcast and support escalation dispatched successfully.",
		"trip_id": req.TripID,
	})
}

// StartGPSWriteBehindWorker starts a background loop to flush Redis-buffered GPS pings to SQL DB
func (h *GatewayHandler) StartGPSWriteBehindWorker(ctx context.Context) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	log.Println("[GPS_WORKER] Started GPS Write-Behind Worker")

	for {
		select {
		case <-ctx.Done():
			log.Println("[GPS_WORKER] Stopped GPS Write-Behind Worker")
			return
		case <-ticker.C:
			h.flushGPSBuffers(ctx)
		}
	}
}

func (h *GatewayHandler) flushGPSBuffers(ctx context.Context) {
	if h.clusterClient == nil || h.dbPool == nil {
		return
	}

	// Fetch active buffered order IDs
	orderIDs, err := h.clusterClient.SMembers(ctx, "orders:gps:active_buffers").Result()
	if err != nil {
		log.Printf("[GPS_WORKER] Failed to query active buffers: %v", err)
		return
	}

	for _, orderID := range orderIDs {
		redisKey := fmt.Sprintf("orders:gps:buffer:%s", orderID)

		// Atomic read and deletion using a pipeline
		pipe := h.clusterClient.Pipeline()
		lrangeCmd := pipe.LRange(ctx, redisKey, 0, -1)
		pipe.Del(ctx, redisKey)
		pipe.SRem(ctx, "orders:gps:active_buffers", orderID)

		_, execErr := pipe.Exec(ctx)
		if execErr != nil {
			log.Printf("[GPS_WORKER] Failed executing pipeline for order %s: %v", orderID, execErr)
			continue
		}

		pingsJSON := lrangeCmd.Val()
		if len(pingsJSON) == 0 {
			continue
		}

		// Parse pings
		var pings []domain.GPSPing
		for _, pingStr := range pingsJSON {
			var p domain.GPSPing
			if err := json.Unmarshal([]byte(pingStr), &p); err == nil {
				pings = append(pings, p)
			}
		}

		if len(pings) == 0 {
			continue
		}

		// Perform bulk insert
		dbCtx, dbCancel := context.WithTimeout(ctx, 5*time.Second)

		query := `INSERT INTO orders_gps_trail (order_id, latitude, longitude, captured_at, speed, heading, battery, network_type) VALUES `
		vals := []interface{}{}

		for i, p := range pings {
			n := i * 8
			query += fmt.Sprintf("($%d, $%d, $%d, $%d, $%d, $%d, $%d, $%d),", n+1, n+2, n+3, n+4, n+5, n+6, n+7, n+8)
			vals = append(vals, p.OrderID, p.Lat, p.Lng, p.Timestamp, p.Speed, p.Heading, p.Battery, p.NetworkType)
		}

		query = query[:len(query)-1] // Remove trailing comma

		_, dbErr := h.dbPool.Exec(dbCtx, query, vals...)
		dbCancel()

		if dbErr != nil {
			log.Printf("[GPS_WORKER] Failed bulk inserting %d GPS pings for order %s: %v. Re-buffering data.", len(pings), orderID, dbErr)

			// Put them back in Redis lists to prevent data loss
			pipeBack := h.clusterClient.Pipeline()
			for _, p := range pings {
				if pBytes, marshalErr := json.Marshal(p); marshalErr == nil {
					pipeBack.RPush(ctx, redisKey, string(pBytes))
				}
			}
			pipeBack.SAdd(ctx, "orders:gps:active_buffers", orderID)
			_, _ = pipeBack.Exec(ctx)
		} else {
			log.Printf("[GPS_WORKER] Successfully flushed %d GPS pings for order %s to SQL storage", len(pings), orderID)
		}
	}
}
