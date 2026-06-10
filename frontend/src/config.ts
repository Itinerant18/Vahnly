// Centralized endpoint configuration so hosts are not hard-coded across components.
// Values can be overridden at build/run time via environment variables; otherwise they
// fall back to local development defaults.

// Declared loosely so this module typechecks without requiring @types/node.
declare const process: { env?: Record<string, string | undefined> } | undefined;

function readEnv(key: string, fallback: string): string {
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key] as string;
  }
  return fallback;
}

// Defaults are EMPTY (same-origin) so the browser dashboard issues relative requests that
// the Vite dev proxy (see vite.config.ts) / a production reverse proxy routes to the right
// backend — this sidesteps cross-origin CORS entirely. Native mobile clients that have no
// same origin must supply absolute hosts via these env vars (or the ClientCoreEngine
// constructor's apiBaseUrl argument).

// REST API gateway. Default is EMPTY (same-origin) so every admin request is RELATIVE and
// routes through the Vite dev proxy / production reverse proxy. This is required for the
// HttpOnly session cookie (CRIT-004) to be sent automatically — a cross-origin absolute
// base would drop the cookie unless every call opted into credentials+CORS. Override with
// API_GATEWAY_URL only for a same-origin-incapable setup (then set ADMIN_FRONTEND_URL on
// the gateway and send credentials on requests).
export const API_GATEWAY_BASE_URL = readEnv('API_GATEWAY_URL', '');
// WebSocket base stays absolute: WS authenticates via a single-use ticket (minted over the
// cookie-authenticated HTTP channel), so it never needs the cookie on the upgrade itself.
export const WS_GATEWAY_BASE_URL = readEnv('WS_GATEWAY_URL', 'ws://localhost:8085');

// Standalone spatial analytics SSE service (Milestone 19).
export const ANALYTICS_SSE_BASE_URL = readEnv('ANALYTICS_SSE_URL', '');
