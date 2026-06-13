// TASK 4 — Kolkata evening rush dispatch test.
//
// Simulates: 200 drivers online at minute 0; 500 bookings over 10 minutes; ~50/min peak.
// Measures order -> ASSIGNED latency (p50<8s, p95<25s, p99<60s) and unmatched rate (<5%).
//
// Two scenarios run together:
//   * drivers  (exec: driverAgent)  — 200 VUs go ONLINE at t=0, then heartbeat location and
//                                     poll/accept dispatch offers for the whole window. This
//                                     is REQUIRED: without drivers accepting offers, no order
//                                     ever reaches ASSIGNED and dispatch latency is undefined.
//   * riders   (exec: riderAgent)   — arrival-rate booking load, each booking polls
//                                     GET /api/v1/rider/orders/active until ASSIGNED.
//
// Verified offer flow: GET /api/v1/driver/offer -> {order:{order_id},offer_expires_in_seconds};
// PATCH /api/v1/driver/orders/{orderId}/offer-response {response:"ACCEPTED", correlation_id}.
//
// NOT observable from k6 (collect from Prometheus/Grafana during the run, per EXECUTION RULE 3):
//   - Redis H3 cache hit rate, PostgreSQL QPS, driver utilization, and the backend's own
//     dfu_dispatch_latency_seconds histogram. k6 measures the client-observed latency only.
//
//   k6 run -e BASE_URL=http://localhost:8085 -e RIDER_TOKENS_FILE=tokens.json \
//          -e DRIVERS=200 load-tests/dispatch-rush.js
//   Scale down:  -e DRIVERS=50 -e RIDER_RATE_PEAK=15

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import {
  BASE_URL, authHeaders, randomKolkataPoint, KOLKATA_CENTRE,
  TRIP_TYPE, CAR_TYPE, TRANSMISSION, CITY_PREFIX, STATUS_ASSIGNED,
} from './config.js';
import {
  loadRiderTokens, riderTokenForVU, ensureDriver, goOnline, sendLocation,
} from './lib/auth.js';

const RIDER_TOKENS = loadRiderTokens();
const DRIVERS = Number(__ENV.DRIVERS || 200);
const WINDOW_SECONDS = Number(__ENV.WINDOW_SECONDS || 600); // 10-minute booking window
const RIDER_RATE_PEAK = Number(__ENV.RIDER_RATE_PEAK || 50); // bookings/min at peak
const ASSIGN_TIMEOUT_MS = Number(__ENV.ASSIGN_TIMEOUT_MS || 60000);

const dispatchLatency = new Trend('dispatch_latency_ms', true); // order -> ASSIGNED
const unmatched = new Rate('unmatched_rate');
const offersAccepted = new Counter('offers_accepted');
const bookings = new Counter('bookings_created');

export const options = {
  scenarios: {
    drivers: {
      executor: 'per-vu-iterations',
      exec: 'driverAgent',
      vus: DRIVERS,
      iterations: 1,
      startTime: '0s',
      maxDuration: `${WINDOW_SECONDS + 120}s`,
    },
    riders: {
      executor: 'ramping-arrival-rate',
      exec: 'riderAgent',
      startTime: '20s', // let drivers come online first
      startRate: 5,
      timeUnit: '1m',
      preAllocatedVUs: Math.max(50, Number(__ENV.RIDER_VUS || 120)),
      maxVUs: Number(__ENV.RIDER_MAX_VUS || 300),
      stages: [
        { duration: '3m', target: 30 },              // build
        { duration: '1m', target: RIDER_RATE_PEAK }, // peak ~50/min
        { duration: '5m', target: 40 },              // sustained rush
        { duration: '1m', target: 0 },
      ],
    },
  },
  thresholds: {
    'dispatch_latency_ms': ['p(50)<8000', 'p(95)<25000', 'p(99)<60000'],
    unmatched_rate: ['rate<0.05'],
    http_req_failed: ['rate<0.02'],
  },
};

export function setup() {
  if (!RIDER_TOKENS.length) {
    throw new Error(
      'No rider tokens. See load-tests/provision/provision-rider-tokens.md and pass ' +
      '-e RIDER_TOKENS_FILE=tokens.json (provision enough distinct riders for peak concurrency).',
    );
  }
}

// ---- Driver: go online, heartbeat, accept offers for the whole window ---------------------
export function driverAgent() {
  // Unique driver index per VU so each VU is a distinct registered driver.
  const idx = __VU;
  const drv = ensureDriver(idx);
  if (!drv) return;

  // Cluster drivers around the city centre so they're inside the geofence and near demand.
  const home = {
    lat: KOLKATA_CENTRE.lat + (Math.random() - 0.5) * 0.05,
    lng: KOLKATA_CENTRE.lng + (Math.random() - 0.5) * 0.05,
  };
  goOnline(drv.token, home);

  const deadline = Date.now() + WINDOW_SECONDS * 1000;
  const headers = authHeaders(drv.token);
  while (Date.now() < deadline) {
    sendLocation(drv.token, drv.driverId, home);

    const offerRes = http.get(`${BASE_URL}/api/v1/driver/offer`, {
      headers, tags: { name: 'driver_offer_poll' },
    });
    if (offerRes.status === 200) {
      const orderId = offerRes.json('order.order_id');
      if (orderId) {
        const accept = http.patch(
          `${BASE_URL}/api/v1/driver/orders/${orderId}/offer-response`,
          JSON.stringify({ response: 'ACCEPTED', correlation_id: `load-${idx}-${orderId}` }),
          { headers, tags: { name: 'driver_offer_accept' } },
        );
        if (accept.status === 200) offersAccepted.add(1);
      }
    }
    sleep(3);
  }
}

// ---- Rider: book and time the order -> ASSIGNED transition ---------------------------------
export function riderAgent() {
  const token = riderTokenForVU(RIDER_TOKENS, __VU);
  if (!token) return;
  const headers = authHeaders(token);
  const pickup = randomKolkataPoint();
  const drop = randomKolkataPoint();

  const res = http.post(
    `${BASE_URL}/api/v1/rider/orders`,
    JSON.stringify({
      pickup_lat: pickup.lat, pickup_lng: pickup.lng, pickup_address: 'Rush pickup, Kolkata',
      dropoff_lat: drop.lat, dropoff_lng: drop.lng, dropoff_address: 'Rush drop, Kolkata',
      trip_type: TRIP_TYPE, duration_hours: 8,
      one_time_car: { make: 'Maruti', model: 'Dzire', car_type: CAR_TYPE, transmission: TRANSMISSION },
      payment_method: 'CASH', city: CITY_PREFIX,
    }),
    { headers, tags: { name: 'book_driver' } },
  );
  if (!check(res, { 'booking 201': (r) => r.status === 201 })) {
    return; // ErrActiveOrderExists (409) means too few rider tokens for the concurrency.
  }
  bookings.add(1);
  const orderId = res.json('data.order.id');
  const t0 = Date.now();

  // Poll the active order until ASSIGNED or timeout.
  let assigned = false;
  while (Date.now() - t0 < ASSIGN_TIMEOUT_MS) {
    sleep(1);
    const active = http.get(`${BASE_URL}/api/v1/rider/orders/active`, {
      headers, tags: { name: 'poll_active' },
    });
    if (active.status === 200 && active.json('data.order.status') === STATUS_ASSIGNED) {
      dispatchLatency.add(Date.now() - t0);
      assigned = true;
      break;
    }
  }
  unmatched.add(!assigned);

  // Free the rider for reuse (cancel whatever state it's in).
  if (orderId) {
    http.del(`${BASE_URL}/api/v1/rider/orders/${orderId}/cancel`, null, {
      headers, tags: { name: 'cancel_order' },
    });
  }
}
