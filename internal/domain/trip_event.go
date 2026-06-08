package domain

import (
	"time"

	"github.com/google/uuid"
)

// GPSPing represents high-fidelity context for active trip telemetry
type GPSPing struct {
	OrderID     uuid.UUID `json:"order_id"`
	Timestamp   time.Time `json:"timestamp"`
	Lat         float64   `json:"lat"`
	Lng         float64   `json:"lng"`
	Speed       float64   `json:"speed"`
	Heading     float64   `json:"heading"`
	Battery     int       `json:"battery"`      // Feature 13 requirement
	NetworkType string    `json:"network_type"` // Feature 13 requirement
}
