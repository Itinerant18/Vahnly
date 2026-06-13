// TASK 3 — WebSocket stress: 500 concurrent rider connections held for 10 minutes.
//
// Endpoint (verified): mint a single-use ticket then upgrade.
//   POST /api/v1/ws/ticket   (rider Bearer JWT) -> {ticket, expires_in_seconds:30}
//   GET  /ws/rider?ticket=<ticket>              (WebSocket, server->client push only)
//
// IMPORTANT — what this test can and cannot assert:
//   The rider stream is PUSH-ONLY (internal/rider/realtime/hub.go): the server sends
//   rider.order.assigned / rider.driver.location / etc. A connected rider with no active
//   trip receives only protocol pings (server pings every ~25s). So the template's
//   "1 message every 5s" only happens during an active trip. This test therefore measures
//   what a pure WS test honestly can: connection-establishment success, 10-minute
//   STABILITY (no unexpected drops), and counts any frames actually delivered. To exercise
//   real message delivery >99% you must run dispatch-rush.js concurrently so trips push
//   telemetry to these sockets.
//
//   k6 run -e BASE_URL=http://localhost:8085 -e RIDER_TOKENS_FILE=tokens.json \
//          -e WS_CONNS=500 -e WS_HOLD_SECONDS=600 load-tests/websocket-stress.js

import ws from 'k6/ws';
import { check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { BASE_URL } from './config.js';
import { loadRiderTokens, riderTokenForVU, mintWsTicket } from './lib/auth.js';

const RIDER_TOKENS = loadRiderTokens();
const CONNS = Number(__ENV.WS_CONNS || 500);
const HOLD_SECONDS = Number(__ENV.WS_HOLD_SECONDS || 600); // 10 minutes

const connectSuccess = new Rate('ws_connect_success');
const messages = new Counter('ws_messages_received');
const drops = new Counter('ws_unexpected_drops');
const sessionSeconds = new Trend('ws_session_seconds');

export const options = {
  scenarios: {
    hold_connections: {
      executor: 'per-vu-iterations',
      vus: CONNS,
      iterations: 1,
      maxDuration: `${HOLD_SECONDS + 120}s`,
    },
  },
  thresholds: {
    ws_connect_success: ['rate>0.99'], // >99% of connections establish
    ws_unexpected_drops: ['count<5'],  // effectively "no drops after 10 minutes"
  },
};

export function setup() {
  if (!RIDER_TOKENS.length) {
    throw new Error(
      'No rider tokens. See load-tests/provision/provision-rider-tokens.md and pass ' +
      '-e RIDER_TOKENS_FILE=tokens.json. Ideally provision >= WS_CONNS distinct riders.',
    );
  }
}

export default function () {
  const token = riderTokenForVU(RIDER_TOKENS, __VU);
  const ticket = mintWsTicket(token);
  if (!ticket) {
    connectSuccess.add(false);
    return;
  }

  const url = `${BASE_URL.replace(/^http/, 'ws')}/ws/rider?ticket=${ticket}`;
  let opened = false;
  let closedCleanly = false;
  const start = Date.now();

  ws.connect(url, {}, (socket) => {
    socket.on('open', () => {
      opened = true;
      connectSuccess.add(true);
      // Hold the connection for the test window, then close cleanly.
      socket.setTimeout(() => {
        closedCleanly = true;
        socket.close();
      }, HOLD_SECONDS * 1000);
    });
    socket.on('message', () => messages.add(1));
    socket.on('error', () => {});
    socket.on('close', () => {
      sessionSeconds.add((Date.now() - start) / 1000);
      // Closed before we asked it to == an unexpected drop.
      if (opened && !closedCleanly) drops.add(1);
    });
  });

  if (!opened) connectSuccess.add(false);
  check(null, { 'connection opened': () => opened });
}
