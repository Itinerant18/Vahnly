// Package realtime provides the rider-facing live trip WebSocket fan-out. It
// mirrors the driver-side gateway hub: services PUBLISH rider-targeted events to
// a Redis pub/sub channel, and every gateway pod's Hub forwards them to the
// locally-connected rider's WebSocket.
package realtime

import (
	"context"
	"encoding/json"

	"github.com/redis/go-redis/v9"
)

// RiderBroadcastChannel is the Redis pub/sub channel carrying rider-targeted
// events across gateway pods.
const RiderBroadcastChannel = "gateway:rider:broadcast"

// Rider WebSocket message types (the client TypeScript union mirrors these).
const (
	MsgOrderAssigned  = "rider.order.assigned"
	MsgDriverLocation = "rider.driver.location"
	MsgDriverArrived  = "rider.driver.arrived"
	MsgTripStarted    = "rider.trip.started"
	MsgTripCompleted  = "rider.trip.completed"
	MsgTripCancelled  = "rider.trip.cancelled"
	MsgNotification   = "rider.notification"
	MsgRideCheck      = "rider.ride_check"
)

// Envelope is the backplane wire format: rider_id routes the message, type +
// data are forwarded to the client.
type Envelope struct {
	RiderID string          `json:"rider_id"`
	Type    string          `json:"type"`
	Data    json.RawMessage `json:"data"`
}

// ClientMessage is what a connected rider receives: {type, data}.
type ClientMessage struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

// Publish marshals data and publishes a rider-targeted event to the backplane.
// No-op (nil error) when the client or riderID is missing, so callers can fire
// it best-effort without guarding.
func Publish(ctx context.Context, client *redis.ClusterClient, riderID, msgType string, data any) error {
	if client == nil || riderID == "" {
		return nil
	}
	raw, err := json.Marshal(data)
	if err != nil {
		return err
	}
	payload, err := json.Marshal(Envelope{RiderID: riderID, Type: msgType, Data: raw})
	if err != nil {
		return err
	}
	return client.Publish(ctx, RiderBroadcastChannel, payload).Err()
}
