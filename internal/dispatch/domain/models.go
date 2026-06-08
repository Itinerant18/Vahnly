package domain

import (
	"context"

	"github.com/segmentio/kafka-go"
)

type OrderCreatedPayload struct {
	OrderID         string  `json:"order_id"`
	CityPrefix      string  `json:"city_prefix"`
	CustomerID      string  `json:"customer_id"`
	PickupH3Cell    string  `json:"pickup_h3_cell"`
	PickupLat       float64 `json:"pickup_lat"`
	PickupLng       float64 `json:"pickup_lng"`
	PickupOSMNodeID int64   `json:"pickup_osm_node_id"`
	BaseFarePaise   int64   `json:"base_fare_paise"`
	RetryCount      int     `json:"retry_count"` // MILESTONE 3: Track allocation depth across batch re-queue passes

	// App-level pipeline logging parameter context
	KafkaMessageContext kafka.Message `json:"-"`

	// MILESTONE 18 / 19 trace context propagation store
	StoredContext context.Context `json:"-"`
}
