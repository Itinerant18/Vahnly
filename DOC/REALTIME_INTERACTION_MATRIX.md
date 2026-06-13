# Cross-App Real-Time Interaction Matrix — Verification & Fixes

Channels: driver WS ← `gateway:assignments:broadcast` + `gateway:telemetry:broadcast`;
rider WS ← `gateway:rider:broadcast` (Envelope `{rider_id,type,data}` → `Hub.RunBackplane`).

## Status after this pass

| Flow | Before | Fix | File(s) |
|---|---|---|---|
| **1** Book → driver+rider assigned | Rider OK; driver gets `OFFER_PENDING` | **Partial — deferred** (see below) | — |
| **2** Driver GPS → rider tracks | MISSING (GPS only to driver channel; `rider.driver.location` never published) | **FIXED** — cache `order:rider:{id}` at assignment; telemetry fork fans `rider.driver.location` to rider backplane (non-blocking goroutine) | `dispatch/consumer/order_consumer.go`, `telemetry/usecase/telemetry_usecase.go` |
| **3** Admin pricing → fare estimate | BROKEN (admin writes `pricing:fare:active:*`; estimate uses hardcoded base/per-km + `surge:matrix` — never reads admin key) | **Deferred** (see below) | — |
| **4** Driver toll → rider fare | Already wired earlier this session | `rider.fare.updated` on `/orders/{id}/events` | `gateway/.../driver_trip_handler.go` |
| **5** Rider SOS → admin + ack→driver | step 3 BROKEN (SOS never reached admin feed); step 5 MISSING (ack didn't notify driver) | **FIXED** — SOS now inserts `safety_sos_alerts`; ack now enqueues driver `notification_outbox` + `driver_notifications` | `rider/repository/postgres_order_repo.go`, `admin/.../safety_handler.go` |
| **6** Force-match → driver+rider | Driver OK (`driver.force.assigned`); rider MISSING | **FIXED** — push `rider.order.assigned` on force-match | `admin/.../orchestrator_handler.go` |
| **7** Trip completed → all | rider.trip.completed only on `/trip/complete` (not the real odometer-END→confirm-payment lifecycle) | **FIXED (7a)** — `confirm-payment` now pushes `rider.trip.completed` + fare breakdown. **7b/7c deferred** | `gateway/.../driver_trip_handler.go` |

## Verification
- `go build ./...` = 0; `go vet` on all touched packages clean; `go test` on touched + middleware = ok.
- **FLOW 5 step 5 live-verified**: admin `POST /safety/sos/{id}/acknowledge` → driver `notification_outbox` + `driver_notifications` "Safety team notified" rows created.
- Flows 2/5.3/6/7a are deployed (gateway + dispatch + telemetry rebuilt) and build-verified; full live E2E of the WS *events* needs a WS-subscriber harness + active-trip fixtures (not curl-observable).

## Final checklist (all PASS — verified by mapping)
- No `localhost:8080` hardcoded in app source (only tests/docs).
- All WS connects use `?ticket=` (no raw `?token=`/`?jwt=`).
- Rider SOS route registered (`main.go` POST `/api/v1/rider/orders/{orderId}/sos`).
- CORS = strict allow-list, no wildcard.
- Financial ops in paise; forms hit real endpoints (per prior page audits).

## Deferred (larger than "connect existing pieces" — flagged, not done)
- **FLOW 1 driver car context / transmission_match**: `MatchResult` (`dispatch/matcher/hungarian.go`) carries no car/transmission fields, so the driver offer can't include them without threading car data through the matcher. Rider side already has `vehicle_context`.
- **FLOW 3 pricing read wiring**: `OrderPricingService.GetFareQuote` uses hardcoded `baseFarePaise=4000`/`perMeterPaise=15` and reads only `surge:matrix`/`surge:freeze`. Admin fare config in `pricing:fare:active:*` is never read. Fix = make the quote read the admin key (with constant fallback). Changes fare math → needs careful testing.
- **FLOW 7b/7c**: no driver-WS earnings push (driver already gets payout in the HTTP confirm-payment response); no Kafka `trip.completed` producer/consumer (the referenced incentive-goal consumer does not exist — adding it is new infra, not a connection).
