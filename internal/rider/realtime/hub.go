package realtime

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"

	"github.com/platform/driver-delivery/internal/domain"
	"github.com/platform/driver-delivery/internal/gateway/middleware"
)

// RiderAuthenticator validates a rider JWT. *rider/service.AuthService satisfies it.
type RiderAuthenticator interface {
	RiderFromJWT(ctx context.Context, token string) (*domain.Rider, error)
}

type riderConn struct {
	ch   chan []byte
	conn *websocket.Conn
}

// Hub manages locally-connected rider WebSockets and forwards backplane events.
type Hub struct {
	sessions sync.Map // riderID -> *riderConn
	client   *redis.ClusterClient
	auth     RiderAuthenticator
	upgrader websocket.Upgrader
}

func NewHub(client *redis.ClusterClient, auth RiderAuthenticator) *Hub {
	return &Hub{
		client: client,
		auth:   auth,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin:     func(r *http.Request) bool { return true },
		},
	}
}

// HandleRiderStream upgrades an authenticated rider to a WebSocket registered under
// ws:rider:{rider_id}. Identity (rider_id) is taken from the request context, which
// the WS-ticket middleware injects after validating a single-use ?ticket=. The token
// is never carried in the URL. Server→client only.
func (h *Hub) HandleRiderStream(w http.ResponseWriter, r *http.Request) {
	riderID, ok := middleware.GetUserIDFromContext(r.Context())
	if !ok || riderID == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if role, _ := middleware.GetUserRoleFromContext(r.Context()); !strings.EqualFold(role, domain.RoleRider) {
		http.Error(w, "forbidden_non_rider", http.StatusForbidden)
		return
	}

	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[RIDER_WS] upgrade failed for rider %s: %v", riderID, err)
		return
	}
	defer conn.Close()

	rc := &riderConn{ch: make(chan []byte, 16), conn: conn}
	h.sessions.Store(riderID, rc)
	defer h.sessions.Delete(riderID)

	if h.client != nil {
		presenceKey := "ws:rider:presence:" + riderID
		_ = h.client.Set(r.Context(), presenceKey, "1", 30*time.Minute).Err()
		defer func() {
			delCtx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
			defer cancel()
			_ = h.client.Del(delCtx, presenceKey).Err()
		}()
	}

	// Reader pump: discard inbound frames; its only job is to detect disconnect.
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	go func() {
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				cancel()
				return
			}
		}
	}()

	const writeWait = 10 * time.Second
	ping := time.NewTicker(25 * time.Second)
	defer ping.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case raw, ok := <-rc.ch:
			if !ok {
				return
			}
			_ = conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := conn.WriteMessage(websocket.TextMessage, raw); err != nil {
				return
			}
		case <-ping.C:
			_ = conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// RunBackplane subscribes to the rider broadcast channel and forwards each event
// to the locally-connected rider (if present). Run once per gateway pod.
func (h *Hub) RunBackplane(ctx context.Context) {
	if h.client == nil {
		return
	}
	pubsub := h.client.Subscribe(ctx, RiderBroadcastChannel)
	defer pubsub.Close()
	log.Println("[RIDER_WS] backplane subscribed to", RiderBroadcastChannel)

	ch := pubsub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			var env Envelope
			if err := json.Unmarshal([]byte(msg.Payload), &env); err != nil || env.RiderID == "" {
				continue
			}
			h.DeliverLocal(env.RiderID, env.Type, env.Data)
		}
	}
}

// DeliverLocal forwards a {type, data} message to a locally-connected rider.
// Returns false when the rider is not connected to this pod. Non-blocking: drops
// the message if the rider's send buffer is full (slow consumer protection).
func (h *Hub) DeliverLocal(riderID, msgType string, data json.RawMessage) bool {
	raw, found := h.sessions.Load(riderID)
	if !found {
		return false
	}
	rc, ok := raw.(*riderConn)
	if !ok {
		return false
	}
	payload, err := json.Marshal(ClientMessage{Type: msgType, Data: data})
	if err != nil {
		return false
	}
	select {
	case rc.ch <- payload:
		return true
	default:
		return false
	}
}
