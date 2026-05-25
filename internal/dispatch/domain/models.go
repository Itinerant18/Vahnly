package domain

import "github.com/segmentio/kafka-go"

type OrderCreatedPayload struct {
	OrderID        string  `json:"order_id"`
	CityPrefix     string  `json:"city_prefix"`
	CustomerID     string  `json:"customer_id"`
	PickupH3Cell   string  `json:"pickup_h3_cell"`
	PickupLat      float64 `json:"pickup_lat"`
	PickupLng      float64 `json:"pickup_lng"`
	BaseFarePaise  int64   `json:"base_fare_paise"`
	
	// App-level pipeline logging parameter context
	KafkaMessageContext kafka.Message `json:"-"`
}
