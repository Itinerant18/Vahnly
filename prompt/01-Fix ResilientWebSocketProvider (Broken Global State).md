BUG FIX — ResilientWebSocketProvider connects to dispatch stream without required order_id, causing permanent 400 error and broken global driver state.

## Files

- `client-app/src/lib/providers/ResilientWebSocketProvider.tsx` — line 55
- `client-app/src/services/dispatchStream.ts` — lines 34-42 (for reference on how dispatch stream connects)

## The Problem

`ResilientWebSocketProvider` connects to `/api/v1/dispatch/stream?ticket=...` WITHOUT an `order_id` query param.
The backend handler `HandleMatchRealtimeStream` (handler.go:270) requires `order_id` and returns `400 missing_target_order_id`.
The provider retries 10x with exponential backoff then permanently gives up.
As a result: `orderStatus`, `driverState`, `surgeMultiplier` global context values NEVER update.

## What dispatch stream is actually for

Look at `dispatchStream.ts` — it handles: `order.assigned`, `surge.zone.updated`, `driver.state.changed` JSON text events.
The GLOBAL state stream (surge, driver state) should NOT require an order_id — it's a driver-level connection, not an order-level one.
The order_id requirement is a backend constraint for a DIFFERENT handler path.

## Fix options — implement whichever is appropriate after reading the files

### Option A (preferred): Use a driver-level session key instead of order_id

In `ResilientWebSocketProvider.tsx`, when building the WS URL:

- After minting the WS ticket via `POST /api/v1/ws/ticket`, append `?ticket={ticket}&session_id=driver-{DRIVER_ID}` instead of `order_id`
- Check `dispatchStream.ts` line 34 — it passes `stream-session-{driverID}` as the session identifier. Use the EXACT same pattern here.
- The backend stores sessions under both `stream-session-{DRIVER_ID}` AND `driver:{DRIVER_ID}` keys — both work for delivery

### Option B (fallback): Replace WebSocket with REST polling for global state

If the backend truly requires `order_id` for ALL dispatch stream connections:

- Replace `ResilientWebSocketProvider` with a polling mechanism
- Poll `GET /api/v1/driver/status` every 10 seconds for `driverState`
- Poll `GET /api/v1/pricing/surge?city={cityPrefix}` every 30 seconds for `surgeMultiplier`
- Use `useEffect` + `setInterval` inside the provider — clean up on unmount
- Keep the same context shape so all consumers of `useResilientWS()` or the provider context don't need to change

## Rules

- Read `ResilientWebSocketProvider.tsx` fully before changing anything
- Read `dispatchStream.ts` to understand the working connection pattern
- Do NOT change the retry logic, just fix the connection URL or replace the mechanism
- The provider must still export the same context values (`orderStatus`, `driverState`, `surgeMultiplier`)
- After fixing, add a comment: `// Fixed: was connecting without session_id causing 400`
