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

type GatewayHandler struct {
	dbPool         *pgxpool.Pool
	kafkaWriter    *kafka.Writer
	pricingService *pricingSvc.OrderPricingService
	clusterClient  *redis.ClusterClient
	upgrader       websocket.Upgrader

	// MILESTONE 14: Thread-safe local memory registry mapping active 
	// WebSocket communication channels currently hosted on *this specific pod node*
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

// HandleGetPricingQuote handles O(1) reads from the sharded Redis surge matrix cache
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

// HandleMatchRealtimeStream upgrades requests to WebSockets and binds them to local message channels
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

	// Create an isolated message synchronization channel for this rider connection
	messageChan := make(chan []byte, 2)
	h.localSessions.Store(targetOrderID, messageChan)
	
	// Ensure cleanup occurs if the socket is closed or disconnected by the client app
	defer h.localSessions.Delete(targetOrderID)

	log.Printf("[GATEWAY_NODE_SESSION] Local memory registration locked for order connection: %s", targetOrderID)

	// Keep-alive connection deadlines
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
				log.Printf("[GATEWAY_WS_WRITE_FAIL] Failed flushing frame to socket: %v", err)
				return
			}
			
			log.Printf("[GATEWAY_WS_BROADCAST_SUCCESS] Match notification successfully piped to device for order: %s", targetOrderID)
			return // Assignment delivered, close loop cleanly
		}
	}
}

// InternalBackplaneMultiplexer listens to the Redis Pub/Sub backplane and forwards matching events to the local socket channels
func (h *GatewayHandler) InternalBackplaneMultiplexer(ctx context.Context) {
	pubsub := h.clusterClient.Subscribe(ctx, RedisPubSubChannel)
	defer pubsub.Close()

	log.Println("[BACKPLANE_DAEMON] Redis Cluster Pub/Sub channel connection active.")

	ch := pubsub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}

			// Parse message payloads safely
			var event struct {
				OrderID  string `json:"order_id"`
				DriverID string `json:"driver_id"`
			}
			
			if err := json.Unmarshal([]byte(msg.Payload), &event); err != nil {
				continue
			}

			// Check if this pod hosts an active socket channel for the incoming order ID
			if chRaw, found := h.localSessions.Load(event.OrderID); found {
				if sessionChan, ok := chRaw.(chan []byte); ok {
					select {
					case sessionChan <- []byte(msg.Payload):
						log.Printf("[BACKPLANE_ROUTER] Distributed match event routed internally to active socket channel for order: %s", event.OrderID)
					default:
						// Prevent channel blocking if the buffer is full
					}
				}
			}
		}
	}
}
