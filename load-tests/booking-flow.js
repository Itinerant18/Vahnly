// TASK 2 — Booking flow load test: fare estimate -> book driver.
//
// Endpoints (verified):
//   POST /api/v1/rider/fare-estimate  -> 200  {success,data:{h3_cell,fare_breakdown,...}}
//   POST /api/v1/rider/orders         -> 201  {success,data:{order:{id,status},otp}}
//   DELETE /api/v1/rider/orders/{id}/cancel    (release the one-active-order lock for reuse)
//
// Auth: rider Bearer JWT. Riders can't be logged in from k6 (OTP), so tokens are supplied
// via -e RIDER_TOKENS_FILE. Each VU is pinned to a distinct rider token (one active order
// per rider). After booking we cancel so the same rider can book again next iteration.
//
//   k6 run -e BASE_URL=http://localhost:8085 -e RIDER_TOKENS_FILE=tokens.json load-tests/booking-flow.js
//
// Scale down for limited infra (EXECUTION RULE 2):
//   k6 run -e MAX_VUS=50 ... load-tests/booking-flow.js

import http from 'k6/http';
import { check, sleep, fail } from 'k6';
import { Trend } from 'k6/metrics';
import {
  BASE_URL, authHeaders, randomKolkataPoint,
  TRIP_TYPE, CAR_TYPE, TRANSMISSION, CITY_PREFIX, BOOKING_THRESHOLDS,
} from './config.js';
import { loadRiderTokens, riderTokenForVU } from './lib/auth.js';

const RIDER_TOKENS = loadRiderTokens();
const PEAK = Number(__ENV.MAX_VUS || 200);
const HOLD = Math.max(1, Math.round(PEAK / 2));

const bookLatency = new Trend('book_to_201_ms', true);

export const options = {
  scenarios: {
    ramp_up: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: HOLD },  // ramp 0 -> half
        { duration: '5m', target: HOLD },  // hold
        { duration: '2m', target: PEAK },  // spike to peak
        { duration: '2m', target: 0 },     // ramp down
      ],
    },
  },
  thresholds: BOOKING_THRESHOLDS,
};

export function setup() {
  if (!RIDER_TOKENS.length) {
    fail(
      'No rider tokens. Provision them (load-tests/provision/provision-rider-tokens.md) and ' +
      'pass -e RIDER_TOKENS_FILE=tokens.json. Riders use OTP and cannot be logged in from k6.',
    );
  }
  console.log(`Loaded ${RIDER_TOKENS.length} rider tokens for up to ${PEAK} VUs.`);
}

export default function () {
  const token = riderTokenForVU(RIDER_TOKENS, __VU);
  if (!token) return;
  const headers = authHeaders(token);
  const pickup = randomKolkataPoint();
  const drop = randomKolkataPoint();

  // 1. Fare estimate
  const fareRes = http.post(
    `${BASE_URL}/api/v1/rider/fare-estimate`,
    JSON.stringify({
      pickup_lat: pickup.lat, pickup_lng: pickup.lng,
      dropoff_lat: drop.lat, dropoff_lng: drop.lng,
      trip_type: TRIP_TYPE, duration_hours: 8,
      car_type: CAR_TYPE, transmission: TRANSMISSION, city: CITY_PREFIX,
    }),
    { headers, tags: { name: 'fare_estimate' } },
  );
  check(fareRes, { 'fare estimate 200': (r) => r.status === 200 });

  sleep(1);

  // 2. Book driver (one_time_car avoids needing a seeded garage car)
  const t0 = Date.now();
  const bookRes = http.post(
    `${BASE_URL}/api/v1/rider/orders`,
    JSON.stringify({
      pickup_lat: pickup.lat, pickup_lng: pickup.lng, pickup_address: 'Load test pickup, Kolkata',
      dropoff_lat: drop.lat, dropoff_lng: drop.lng, dropoff_address: 'Load test drop, Kolkata',
      trip_type: TRIP_TYPE, duration_hours: 8,
      one_time_car: { make: 'Maruti', model: 'Dzire', car_type: CAR_TYPE, transmission: TRANSMISSION },
      payment_method: 'CASH', city: CITY_PREFIX,
    }),
    { headers, tags: { name: 'book_driver' } },
  );
  const booked = check(bookRes, { 'booking 201': (r) => r.status === 201 });
  if (booked) bookLatency.add(Date.now() - t0);

  sleep(2);

  // 3. Release the active-order lock so this rider can book again (best effort).
  if (booked) {
    const orderId = bookRes.json('data.order.id');
    if (orderId) {
      http.del(`${BASE_URL}/api/v1/rider/orders/${orderId}/cancel`, null, {
        headers, tags: { name: 'cancel_order' },
      });
    }
  }
}
