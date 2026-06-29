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
**Impact:** The provider retries 10 times with exponential backoff, then gives up. Since this provider wraps the app and processes JSON text events (`order.assigned`, `surge.zone.updated`, `driver.state.changed`), all global state derived from WebSocket events is permanently broken.

### 🔴 Issue 2: Kafka Publish Error Silently Discarded
**File:** `internal/rider/service/booking_service.go:562`
**Problem:** `_ = s.publisher.Publish(ctx, "order.created", orderID, payloadBytes)` — the error return value is explicitly discarded with `_`.
**Impact:** If Kafka is down or unreachable, the rider sees a successful booking response ("order created") but no dispatch event is ever published. The order remains unmatched forever with no error feedback to either rider or driver.

### 🔴 Issue 3: Dispatch Service Is Independent
**File:** `cmd/dispatch/main.go`
**Problem:** The dispatch service is a **separate binary** from the gateway. It must be deployed and running independently.
**Impact:** If only the gateway service is started, orders are created in Postgres but never consumed by the matching engine. No error is logged or surfaced.

### 🟡 Issue 4: Fake `order_id` Session Key
**File:** `client-app/src/services/dispatchStream.ts:34-42`
**Problem:** `connectDispatchStream("stream-session-{driverID}", ...)` uses a fake non-real order string. Backend stores session under both `"stream-session-{DRIVER_ID}"` and `"driver:{DRIVER_ID}"` (`handler.go:289-293`).
**Impact:** Assignment routing works via the `driver:{DRIVER_ID}` fallback key. However, any direct `localSessions.Load(orderUUID)` lookup for the real order ID will miss.

### 🟡 Issue 5: 30-Second Stale Window in Spatial Scanner
**File:** `internal/dispatch/repository/spatial_scanner.go:34`
**Problem:** `staleThreshold := now - 30` — drivers not reporting GPS within 30 seconds are excluded from the scan.
**Context:** Telemetry stream fires every 3-5s (`geolocation.watchPosition` with `{maximumAge:3000, timeout:5000}`). Should work normally but vulnerable to app backgrounding, network blips, or throttling.

### 🟡 Issue 6: Cooldown Filter Skips Drivers
**File:** `internal/dispatch/consumer/order_consumer.go:296`
**Problem:** Drivers who recently declined or timed out an offer are skipped via Redis `cooldown:driver:{ID}` key.
**Impact:** If a driver is incorrectly placed on cooldown (or the cooldown period is too long), they won't receive new offers.

### 🟢 Issue 7: Redis zset Cleanup
**File:** `internal/gateway/delivery/http/handler.go:2773`
**Problem:** `drivers:zset` keys have 24h TTL but entries accumulate stale scores within the set. Filtered by score query but wastes memory.

---

## Most Likely Root Causes (Ranked)

1. **Dispatch service not running** — most common deployment issue; order created but never matched
2. **Kafka unreachable** — publisher silently discards error; rider thinks booking succeeded
3. **Global WS state never updates** — even if assignments arrive, global context (surge, driver state) is broken
4. **Driver GPS lag >30s** — driver drops out of spatial scan

## Next Steps / Verification Needed

- [ ] Is the **dispatch service** (`cmd/dispatch/main.go`) deployed and running?
- [ ] Is **Kafka** accessible from both gateway and dispatch pods?
- [ ] In browser DevTools → Network → WS: are there **WebSocket connection errors** (400) or successful connections?
- [ ] Check if **Redis cluster** has drivers in `drivers:zset:{cityPrefix}:{h3Cell}` with recent timestamps
- [ ] Check if **Kafka topic `order.created`** has messages being produced
- [ ] Fix `ResilientWebSocketProvider.tsx` to pass a valid `order_id` or use a non-WS state sync mechanism

## Files Referenced
| File | Role |
|---|---|
| `client-app/src/lib/providers/ResilientWebSocketProvider.tsx` | Global WS provider (broken, no order_id) |
| `client-app/src/services/dispatchStream.ts` | Dispatch stream WS (fake session ID) |
| `client-app/src/app/driver/page.tsx` | Driver page — calls connectDispatchStream |
| `internal/gateway/delivery/http/handler.go` | WS handler, backplane multiplexer, location handler |
| `internal/rider/service/booking_service.go` | BookingService — creates order, publishes Kafka |
| `internal/dispatch/consumer/order_consumer.go` | OrderCreatedConsumer — dispatch matching pipeline |
| `internal/dispatch/repository/spatial_scanner.go` | SpatialScanner — Redis zset scan |
| `cmd/gateway/main.go` | Gateway main — Kafka fanout worker |
| `cmd/dispatch/main.go` | Dispatch main — independent matching service |
