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
// the Vite dev proxy / a production reverse proxy routes to the right
// backend — this sidesteps cross-origin CORS entirely. Native mobile clients that have no
// same origin must supply absolute hosts via these env vars (or the ClientCoreEngine
// constructor's apiBaseUrl argument).

// REST + WebSocket public API gateway (Milestones 14, 15, 20, 25, 27).
export const API_GATEWAY_BASE_URL = readEnv('API_GATEWAY_URL', 'http://localhost:8080');
export const WS_GATEWAY_BASE_URL = readEnv('WS_GATEWAY_URL', 'ws://localhost:8080');

// Standalone spatial analytics SSE service (Milestone 19).
export const ANALYTICS_SSE_BASE_URL = readEnv('ANALYTICS_SSE_URL', 'http://localhost:8089');
