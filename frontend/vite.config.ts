import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dashboard talks to the gateway and the analytics SSE service (:8089).
// Calling those absolute origins from the browser would trip CORS, so in dev we serve
// everything same-origin from :3000 and proxy the API paths to the right backend.
// The gateway container publishes host :8085 (see docker-compose public-gateway,
// "8085:8080"); :8080 is left free for other local tooling.
// Override targets with API_GATEWAY_URL / ANALYTICS_SSE_URL if your hosts differ.
const GATEWAY = process.env.API_GATEWAY_URL ?? 'http://localhost:8085';
const ANALYTICS = process.env.ANALYTICS_SSE_URL ?? 'http://localhost:8089';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Split heavy, independently-cacheable vendors out of the main chunk so a
        // dashboard code change doesn't bust the cache for React/map/router bundles.
        // (recharts is not a dependency of this admin app, so it is intentionally absent.)
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-map': ['leaflet', 'react-leaflet'],
          'vendor-router': ['react-router-dom'],
        },
      },
    },
  },
  server: {
    port: 5000,
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
