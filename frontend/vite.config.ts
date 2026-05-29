import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dashboard talks to the gateway (:8080) and the analytics SSE service (:8089).
// Calling those absolute origins from the browser would trip CORS, so in dev we serve
// everything same-origin from :3000 and proxy the API paths to the right backend.
// Override targets with API_GATEWAY_URL / ANALYTICS_SSE_URL if your hosts differ.
const GATEWAY = process.env.API_GATEWAY_URL ?? 'http://localhost:8080';
const ANALYTICS = process.env.ANALYTICS_SSE_URL ?? 'http://localhost:8089';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      // Most specific first: analytics SSE goes to the analytics service.
      '/api/v1/analytics': { target: ANALYTICS, changeOrigin: true },
      // Real-time dispatch WebSocket stream.
      '/api/v1/dispatch/stream': { target: GATEWAY.replace(/^http/, 'ws'), ws: true, changeOrigin: true },
      // Everything else under /api/v1 is the public gateway.
      '/api/v1': { target: GATEWAY, changeOrigin: true },
    },
  },
});
