package http

import "testing"

// A driver holds more than one dispatch-stream socket (offer consumer + status chip).
// The per-driver set must keep all of them so a fresh offer fans out to every socket;
// the old flat last-writer-wins key dropped offers onto whichever registered last.
func TestDriverSessionSet_HoldsMultipleAndSurvivesRemoval(t *testing.T) {
	h := &GatewayHandler{}
	s1 := &ActiveWebSocketSession{MessageChan: make(chan []byte, 1)}
	s2 := &ActiveWebSocketSession{MessageChan: make(chan []byte, 1)}

	h.addDriverSession("drv-1", s1)
	h.addDriverSession("drv-1", s2)

	if got := h.driverSessionList("drv-1"); len(got) != 2 {
		t.Fatalf("expected 2 sockets for drv-1, got %d", len(got))
	}

	// One socket closing must not strand the offer — the survivor still receives it.
	h.removeDriverSession("drv-1", s1)
	got := h.driverSessionList("drv-1")
	if len(got) != 1 || got[0] != s2 {
		t.Fatalf("expected only s2 to survive removal, got %v", got)
	}

	// Unknown driver -> nil targets, so the multiplexer falls through to the FCM outbox
	// instead of panicking.
	if got := h.driverSessionList("unknown"); got != nil {
		t.Fatalf("expected nil for unknown driver, got %v", got)
	}
}
