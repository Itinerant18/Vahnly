# Drivers-for-U Frontend

Client-side TypeScript for the dispatch platform. Two concerns live here:

| Area | Path | Purpose |
|------|------|---------|
| Mobile networking core | `src/network/` | Resilient API + WebSocket client used by the driver/rider apps |
| Operations dashboard | `src/admin/` | React control-room panel for ops/finance teams |
| Endpoint config | `src/config.ts` | Single source of truth for gateway/analytics hosts (env-overridable) |

## `src/network`

- **`ClientCoreEngine`** — hardened HTTP client. Attaches the JWT bearer token and
  `X-Region-Prefix` anycast header, and a **stable** `X-Idempotency-Key` that is reused
  across automatic transient retries (network / 5xx) so a retried mutation is never
  processed twice by the gateway.
- **`ResilientStreamManager`** — WebSocket manager. Reconnects with full-jitter
  exponential backoff and treats a server `CloseGoingAway` (1001) frame as a signal to
  re-home onto a healthy pod.
- **`TelemetryRingBuffer`** — bounded offline GPS buffer. Evicts the oldest packet past
  the size limit and flushes cached points on reconnect, removing exactly the flushed
  packets by reference (safe against concurrent pushes/evictions during the flush).

## Setup

```bash
cd frontend
npm install
npm run typecheck
```

## Configuration

Endpoints default to localhost and can be overridden via environment variables
(`API_GATEWAY_URL`, `ANALYTICS_SSE_URL`, `WS_GATEWAY_URL`) — see `src/config.ts`.
