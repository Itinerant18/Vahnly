# Driver App — Remaining Tasks Plan (Mid-Trip / Real-Time Polish)

Status snapshot after the "mid-trip features + connection/auth fixes" pass.

## Done (committed + verified)
- **FIX 1** Rider login path — `rider-app` uses `/api/v1/rider/auth/send-otp` + `/verify-otp` (was already correct).
- **FIX 2** Rider SOS route — `POST /api/v1/rider/orders/{orderId}/sos` registered (`cmd/gateway/main.go`).
- **FIX 3** WS ticket standardization — removed the `?jwt=` query fallback in `internal/gateway/middleware/ws_ticket.go` (no token ever in a URL). Driver (`/api/v1/dispatch/stream`) and rider (`/ws/rider`) streams are ticket-only. Added `POST /api/v1/ws-ticket` alias (serves both apps).
- **FIX 4** CORS hardening — allow-list from `ALLOWED_ORIGINS` (canonical) + `CORS_ALLOWED_ORIGINS` (alias) + native origins (`capacitor://localhost`, `http://localhost`, `ionic://localhost`). No wildcard.
- **TASK 2 (backend)** Mid-trip events — `HandleDriverAddOrderEvent` accepts `TOLL_ADDED|PARKING_ADDED|WAITING_ADDED`, recomputes fare, posts ledger, and publishes a targeted `rider.fare.updated` frame to the rider live-trip WS via `gateway:rider:broadcast`.

## Remaining

### TASK 1 — Connection State Indicator
**Files:** `client-app/src/app/driver/page.tsx`, `client-app/src/hooks/useResilientWebSocket.ts`, `client-app/src/network/ResilientStreamManager.ts`, `client-app/src/network/TelemetryRingBuffer.ts`

1. Surface a `connectionStatus` value (`CONNECTED | RECONNECTING | OFFLINE`) from `useResilientWebSocket`, derived from `ResilientStreamManager` callbacks:
   - `onConnect` → `CONNECTED`
   - `onDisconnect` → `RECONNECTING`
   - `onMaxRetriesExceeded` → `OFFLINE`
2. Top-bar chip in `driver/page.tsx`:
   - CONNECTED = green dot.
   - RECONNECTING = orange + spinner.
   - OFFLINE = red + "Tap to retry" → calls `manager.connect()`.
3. During RECONNECTING: set local duty state to not-available (do **not** hit the server); show a muted banner.
4. Telemetry queueing: while not CONNECTED, push GPS points into the existing `TelemetryRingBuffer` instead of sending. On `onConnect`, drain the buffer (oldest→newest) to the location endpoint, then resume live sends.
5. **Verify:** kill the gateway mid-duty → chip flips RECONNECTING→OFFLINE; restart → flips CONNECTED + buffered points flush (check `driver_locations`/telemetry).

### TASK 3 — Offer Popup Enhancement
**File:** `client-app/src/components/OfferPopup.tsx` (+ `DriverTripManager.tsx` for offer data plumbing)

Offer payload already carries `carColor/carMake/carModel/carType/carTransmission/transmissionMatch/d4mCareOptIn` (see `OrderOffer` in `api/client.ts`).
1. **Car context line:** `Driving their {carColor} {carMake} {carModel}` + sub `({carType} · {carTransmission})`.
2. **Transmission mismatch warning** when `transmissionMatch === false`: ⚠ `Requested: {carTransmission} — Your expertise: {driver cert}`.
3. **D4M Care badge** (shield icon) when `d4mCareOptIn === true`.
4. **Slide-to-Accept** (rule 1 — custom CSS, no library):
   - Track + draggable thumb; `pointerdown/move/up` (touch + mouse).
   - Accept only when dragged past ~90% of track width; snap back otherwise.
   - On complete → existing `acceptOffer` / `respondToOffer('ACCEPTED')`.
5. **Decline reason bottom sheet** (required before decline):
   - Options: `Too far | Need a break | Vehicle issue | Other`.
   - Decline button opens the sheet; `respondToOffer('DECLINED', reason)` only fires after a reason is chosen.

### TASK 4 — Post-Trip Rate Rider
**Backend (new):** `POST /api/v1/driver/orders/{id}/rate-rider` — body `{ rating:1-5, tags:[], comment }`. Add handler (scope to assigned driver + COMPLETED order), persist to `orders.rider_rating_for_driver` + a `rider_ratings`/tags store, register route.
**Frontend:** `client-app/src/app/driver/trip/rate/page.tsx`
1. Replace `driverConfirmPayment` rating path with `rateRider(token, orderId, {rating, tags, comment})` (keep payment-confirm separate if still needed).
2. Tags — positive: `On-time | Polite | Easy to deal with`; negative: `Rude | Late | Car in bad condition`.
3. Add a `comment` textarea.
4. After submit → choice screen: **Go Online** (`setDutyState('ONLINE')` → `/driver`) or **Take a break** (`OFFLINE` → `/driver`).
5. **i18n gap:** the screen uses `useTranslations('driverTripRate')` but that namespace is **missing** from `src/i18n/messages/{en,hi,bn}.json` — add a `driverTripRate` block (title, tags, ratings, buttons) or the labels render as keys.

## Cross-cutting
- After Tasks 1/3/4: `go build ./... && cd client-app && npm run build` must be exit 0.
- Restart the `:3000` dev server after any new client-app deps.
- Full E2E for Task 2's `rider.fare.updated` needs a live trip in `DELIVERING` with the rider WS connected.
