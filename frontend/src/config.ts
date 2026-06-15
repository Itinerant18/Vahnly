// Centralized endpoint configuration so hosts are not hard-coded across components.
// Values come from Vite env vars (the VITE_* keys exposed on import.meta.env at build
// time); otherwise they fall back to same-origin / local-dev defaults.

// REST API gateway. Default is EMPTY (same-origin) so every admin request is RELATIVE and
// routes through the Vite dev proxy (see vite.config.ts) / a production reverse proxy —
// which keeps the HttpOnly session cookie (CRIT-004) flowing automatically.
// Set VITE_GATEWAY_BASE_URL to an absolute origin when the dashboard is hosted somewhere
// that CANNOT proxy /api to the gateway (e.g. Firebase Hosting). In that cross-origin mode
// the gateway must allow this origin via ALLOWED_ORIGINS and every admin request must send
// `credentials: 'include'` so the cookie is attached.
export const API_GATEWAY_BASE_URL = (import.meta.env.VITE_GATEWAY_BASE_URL as string | undefined) ?? '';

// WebSocket base. Derived from the gateway origin (http→ws / https→wss) when an absolute
// gateway is configured; otherwise the local dev default. WS authenticates via a single-use
// ticket minted over the cookie-authenticated HTTP channel, so the upgrade needs no cookie.
export const WS_GATEWAY_BASE_URL = API_GATEWAY_BASE_URL
  ? API_GATEWAY_BASE_URL.replace(/^http/, 'ws')
  : 'ws://localhost:8085';

// Standalone spatial analytics SSE service (Milestone 19).
export const ANALYTICS_SSE_BASE_URL = (import.meta.env.VITE_ANALYTICS_BASE_URL as string | undefined) ?? '';
