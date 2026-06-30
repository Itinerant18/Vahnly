# Debugging: Rider Booking → Driver Not Receiving

## Goal
Debug why driver side does not receive bookings when rider books a ride.

## Investigation Method
- End-to-end trace of rider order creation → Kafka → dispatch matching → WebSocket delivery to driver
- Static code analysis only (no runtime verification)

## Flow Traced

### 1. Rider Creates Booking
- `POST /api/v1/rider/orders` → `BookingService.CreateOrder` (`internal/rider/service/booking_service.go:365`)
- Inserts order into Postgres
- Publishes to **Kafka topic `"order.created"`** via `KafkaEventPublisher` (`booking_service.go:562`)
- Returns `{ order, fare_estimate, otp }` to rider

### 2. Dispatch Service Consumes
- `cmd/dispatch/main.go` — separate service, must be running independently
- `OrderCreatedConsumer` (`internal/dispatch/consumer/order_consumer.go:85`) reads Kafka `order.created`
- Buffers orders, processes in batches (window: 100-400ms depending on arrival rate)

### 3. Matching Engine
- `SpatialScanner.ScanNearbyDrivers()` (`internal/dispatch/repository/spatial_scanner.go:24`)
  - Queries Redis sorted set `drivers:zset:{cityPrefix}:{h3Cell}`
  - 30-second stale window (`staleThreshold = now - 30`)
  - Progressive ring expansion (k=1 to k=3)
- Filters candidates on cooldown (drivers who recently declined)
- Runs GREEDY or HUNGARIAN matching algorithm
- Publishes assignment to **Kafka `"order.assigned"`** (`order_consumer.go:354`)

### 4. Gateway Fanout
- `startKafkaToRedisFanoutWorker` (`cmd/gateway/main.go:1391`)
- Consumes `order.assigned` and `order.cancelled` from Kafka
- Publishes to **Redis PubSub `gateway:assignments:broadcast`** (`handler.go RedisPubSubChannel`)

### 5. Backplane Multiplexer Delivers to Driver WebSocket
- `InternalBackplaneMultiplexer` (`internal/gateway/delivery/http/handler.go:362`)
- Looks up session by `ev.OrderID` in `localSessions` (sync.Map)
- Falls back to `driver:{ev.DriverID}` key
- Sends binary protobuf frame to WebSocket connection

### 6. Driver WebSocket Connections
| Connection | Source | `order_id` | Status | Effect |
|---|---|---|---|---|
| Global state WS | `ResilientWebSocketProvider.tsx:55` | **(none)** | **FAILS** — backend returns 400 | Global state (`orderStatus`, `driverState`, `surgeMultiplier`) never updates |
| Assignment WS | `dispatchStream.ts:34` / `driver/page.tsx:480` | `stream-session-{DRIVER_ID}` | ✅ Connects | Registers `localSessions["driver:{DRIVER_ID}"]` → assignments deliverable |

---

## Issues Found

### 🔴 Issue 1: Global WebSocket Provider Always Fails
**File:** `client-app/src/lib/providers/ResilientWebSocketProvider.tsx:55`
**Problem:** Connects to `/api/v1/dispatch/stream?ticket=...` **without** `order_id` query parameter. Backend handler `HandleMatchRealtimeStream` (`handler.go:270`) requires `order_id` and rejects with `400 missing_target_order_id`.
**Impact:** The provider retries 10 times with exponential backoff, then gives up. Since this provider wraps the app and processes JSON text events (`order.assigned`, `surge.zone.updated`, `driver.state.changed`), all global state derived from WebSocket events is permanently broken
