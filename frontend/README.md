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

## Operations Control Room (Milestone 27)

A Vite + React + Tailwind dashboard (`src/admin/ControlRoomDashboard.tsx`) mounted by
`src/main.tsx`. It shows the live SSE supply heatmap, a driver state-override form, and the
double-entry ledger auditor with a balance banner.

```bash
cd frontend
npm install
npm run dev        # serves http://localhost:3000
```

The dev server proxies API calls so the browser stays same-origin (no CORS):

| Browser path | Proxied to |
|--------------|-----------|
| `/api/v1/analytics/*` | analytics SSE service `:8089` |
| `/api/v1/dispatch/stream` (ws) | gateway `:8080` |
| `/api/v1/*` | gateway `:8080` |

Override the proxy targets with `API_GATEWAY_URL` / `ANALYTICS_SSE_URL` env vars.

**Prereqs to see data:** the backend stack must be up (`docker compose up -d --build`) and
producing it. The ledger view (`/api/v1/admin/ledger`) is **ADMIN-gated** — store a valid
ADMIN-role JWT in `localStorage.admin_jwt_token` or the call returns 401 and the table stays
empty. The heatmap populates as drivers return to `ONLINE_AVAILABLE` (trip complete/decline).

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Vite dev server on :3000 (with API proxy) |
| `npm run build` | Type-check then production build |
| `npm run typecheck` | `tsc --noEmit` only |

## Configuration

Endpoint bases default to **empty (same-origin)** so the dashboard uses relative paths
behind the proxy. Native mobile clients (no same origin) must pass absolute hosts via
`API_GATEWAY_URL` / `ANALYTICS_SSE_URL` / `WS_GATEWAY_URL` or the `ClientCoreEngine`
constructor — see `src/config.ts`.
