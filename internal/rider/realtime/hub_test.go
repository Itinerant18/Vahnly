package realtime

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/platform/driver-delivery/internal/domain"
	"github.com/platform/driver-delivery/internal/gateway/middleware"
)

// fakeAuth authenticates any token as a fixed rider.
type fakeAuth struct{ riderID string }

func (f fakeAuth) RiderFromJWT(_ context.Context, _ string) (*domain.Rider, error) {
	return &domain.Rider{ID: f.riderID, IsActive: true}, nil
}

// TestRiderWS_ReceivesOrderAssignedWithin500ms simulates: rider connects to the
// live-trip WS, a driver is assigned (DeliverLocal mirrors the backplane fan-out),
// and asserts the rider receives rider.order.assigned within 500ms (rule #4).
func TestRiderWS_ReceivesOrderAssignedWithin500ms(t *testing.T) {
	const riderID = "rider-itest-1"
	hub := NewHub(nil, fakeAuth{riderID: riderID}) // nil redis: local delivery only

	// HandleRiderStream now reads identity from the request context (injected by the
	// WS-ticket middleware in production). Simulate that injection here.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := middleware.InjectClaims(r.Context(), &middleware.CustomClaims{UserID: riderID, Role: domain.RoleRider})
		hub.HandleRiderStream(w, r.WithContext(ctx))
	}))
	defer srv.Close()

	wsURL := strings.Replace(srv.URL, "http://", "ws://", 1) + "/ws/rider?ticket=test"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial rider ws: %v", err)
	}
	defer conn.Close()

	// Wait until the server registered the session (HandleRiderStream runs after
	// the upgrade), then deliver the assignment.
	assigned := map[string]any{
		"order_id":        "order-1",
		"driver_id":       "driver-1",
		"driver_name":     "Aniket",
		"vehicle_context": "Driving your Maruti Swift",
		"eta_minutes":     4,
	}
	data, _ := json.Marshal(assigned)

	deadline := time.Now().Add(500 * time.Millisecond)
	delivered := false
	for time.Now().Before(deadline) {
		if hub.DeliverLocal(riderID, MsgOrderAssigned, data) {
			delivered = true
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if !delivered {
		t.Fatal("assignment was not delivered to a registered session within 500ms")
	}

	_ = conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
	_, raw, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read rider ws message: %v", err)
	}

	var msg ClientMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		t.Fatalf("unmarshal client message: %v", err)
	}
	if msg.Type != MsgOrderAssigned {
		t.Fatalf("expected %s, got %s", MsgOrderAssigned, msg.Type)
	}

	var got map[string]any
	if err := json.Unmarshal(msg.Data, &got); err != nil {
		t.Fatalf("unmarshal data: %v", err)
	}
	if got["vehicle_context"] != "Driving your Maruti Swift" {
		t.Errorf("vehicle_context mismatch: %v", got["vehicle_context"])
	}
}

// TestDeliverLocal_NoSessionReturnsFalse ensures delivery to an unconnected rider
// reports a miss (so callers can fall back to FCM).
func TestDeliverLocal_NoSessionReturnsFalse(t *testing.T) {
	hub := NewHub(nil, fakeAuth{riderID: "x"})
	if hub.DeliverLocal("not-connected", MsgNotification, json.RawMessage(`{}`)) {
		t.Fatal("expected false for an unconnected rider")
	}
}
