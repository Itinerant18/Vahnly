BUG FIX — dispatchStream.ts uses a fake non-UUID string as order_id, causing direct order-session lookups to miss.

## Files

- `client-app/src/services/dispatchStream.ts` — lines 34-42
- `client-app/src/app/driver/page.tsx` — line 480 (where connectDispatchStream is called)

## The Problem

`connectDispatchStream("stream-session-{driverID}", ...)` passes a fake string like `"stream-session-abc123"` as the session identifier.
The backend stores sessions under TWO keys:

1. The exact string passed (e.g., `"stream-session-abc123"`) ← fake, won't match real order UUIDs
2. `"driver:{DRIVER_ID}"` ← this fallback key is what actually works

When the backplane multiplexer tries `localSessions.Load(realOrderUUID)` for a freshly assigned order, it MISSES because the session was registered under the fake key, not the real order UUID.
Assignment only works via the `"driver:{DRIVER_ID}"` fallback — which is fragile and order-specific lookups never work.

## Fix

In `client-app/src/services/dispatchStream.ts`:

1. Read the driverID from wherever it's available (auth context, localStorage, or passed as param)
2. Change the session registration call to use the canonical driver key format:
   - Instead of: `connectDispatchStream("stream-session-{driverID}", ...)`
   - Use: `connectDispatchStream("driver-{driverID}", ...)` — matches backend's `"driver:{DRIVER_ID}"` pattern exactly
   - Check handler.go:289-293 to confirm the exact key format the backend registers under

3. In `client-app/src/app/driver/page.tsx` line 480:
   - Update the call to pass `driver-${driverProfile.id}` as the session key
   - Make sure `driverProfile.id` is the actual UUID from the JWT/auth state — NOT a local session ID

4. Add a comment above the call:

   ```typescript
   // Session key MUST match backend format: "driver:{UUID}"
   // Backend registers localSessions under this key for assignment delivery fallback
   // See: internal/gateway/delivery/http/handler.go:289-293
   ```

## Rules

- Do not change the WebSocket connection logic — only change the session key string
- Do not touch ResilientWebSocketProvider (that's a separate fix)
- After fixing, verify the key format matches exactly what handler.go registers
