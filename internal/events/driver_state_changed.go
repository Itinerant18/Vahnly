package events

import "time"

// DriverStateChangedEvent is the Kafka contract shared by dispatch and surge.
type DriverStateChangedEvent struct {
	DriverID      string    `json:"driver_id"`
	CityPrefix    string    `json:"city_prefix"`
	PreviousState string    `json:"previous_state"`
	CurrentState  string    `json:"current_state"`
	H3Cell        string    `json:"h3_cell"`
	Timestamp     time.Time `json:"timestamp"`
}
