// Centralized endpoint configuration so hosts are not hard-coded across components.
// Values can be overridden at build/run time via environment variables; otherwise they
// fall back to local development defaults.

// REST + WebSocket public API gateway (Milestones 14, 15, 20, 25, 27).
export const API_GATEWAY_BASE_URL = process.env.NEXT_PUBLIC_API_GATEWAY || 'http://localhost:8085';
export const WS_GATEWAY_BASE_URL = process.env.NEXT_PUBLIC_WS_GATEWAY || 'ws://localhost:8085';

// Standalone spatial analytics SSE service (Milestone 19).
export const ANALYTICS_SSE_BASE_URL = process.env.NEXT_PUBLIC_ANALYTICS_URL || 'http://localhost:8089';
