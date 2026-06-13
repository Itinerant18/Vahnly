// Authentication + actor helpers for the load-test suite.
//
// AUTH REALITY (verified in internal/rider/service/auth_service.go and
// internal/driver/delivery/http/auth_handler.go):
//
//  * DRIVERS are fully automatable: register (password) -> login -> JWT. The scripts can
//    bootstrap a fleet of drivers entirely headlessly.
//
//  * RIDERS use OTP. The OTP is a crypto-random 6-digit code, bcrypt-hashed in the DB and
//    delivered ONLY via LogSMSSender ("[RIDER_SMS] OTP for ... is ..." in the gateway log).
//    It is never returned by the API and there is NO test/dev bypass. Therefore a rider JWT
//    cannot be minted from inside k6. Rider tokens must be PRE-PROVISIONED out of band and
//    supplied to the test as a JSON array via -e RIDER_TOKENS_FILE=tokens.json
//    (see load-tests/provision/provision-rider-tokens.md). Each rider can hold only ONE
//    active order at a time (booking_service.go:259), so provide one token per concurrent VU.

import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, JSON_HEADERS, authHeaders, CITY_PREFIX } from '../config.js';

// ---- Rider token pool (pre-provisioned) ---------------------------------------------------

// Load once in init context. Returns [] if not supplied so scripts can warn clearly.
export function loadRiderTokens() {
  const path = __ENV.RIDER_TOKENS_FILE;
  if (!path) return [];
  try {
    const raw = open(path); // init-context only
    const parsed = JSON.parse(raw);
    // Accept either ["jwt", ...] or [{token:"jwt"}, ...]
    return parsed.map((t) => (typeof t === 'string' ? t : t.token)).filter(Boolean);
  } catch (e) {
    return [];
  }
}

// Deterministic per-VU token assignment so each VU acts as a distinct rider.
export function riderTokenForVU(pool, vuId) {
  if (!pool.length) return null;
  return pool[(vuId - 1) % pool.length];
}

// ---- Driver bootstrap (fully headless) ----------------------------------------------------

// A stable, geofence-valid phone for a synthetic driver index. +91 + 9 + 9-digit zero-pad.
export function driverPhone(idx) {
  return `+919${String(idx).padStart(9, '0')}`;
}

const DRIVER_PASSWORD = __ENV.DRIVER_PASSWORD || 'LoadTest!123';

// Idempotent: register (ignore 409 already-exists) then login -> { token, driverId }.
export function ensureDriver(idx) {
  const phone = driverPhone(idx);
  const reg = http.post(
    `${BASE_URL}/api/v1/driver/register`,
    JSON.stringify({
      name: `LoadDriver ${idx}`,
      phone,
      email: `loaddriver${idx}@example.test`,
      password: DRIVER_PASSWORD,
      city_prefix: CITY_PREFIX,
    }),
    { headers: JSON_HEADERS, tags: { name: 'driver_register' } },
  );
  // 201 created or 409 already registered are both fine for an idempotent bootstrap.
  check(reg, { 'driver register ok|exists': (r) => r.status === 201 || r.status === 409 });

  const login = http.post(
    `${BASE_URL}/api/v1/driver/login`,
    JSON.stringify({
      phone,
      password: DRIVER_PASSWORD,
      device_id: `load-${idx}`,
      app_version: 'loadtest/1.0',
      geo_location: '88.3639,22.5726',
    }),
    { headers: JSON_HEADERS, tags: { name: 'driver_login' } },
  );
  const ok = check(login, { 'driver login 200': (r) => r.status === 200 });
  if (!ok) return null;
  const body = login.json();
  return { token: body.token, driverId: body.driver_id };
}

export function goOnline(token, point) {
  return http.post(
    `${BASE_URL}/api/v1/driver/duty`,
    JSON.stringify({ state: 'ONLINE', latitude: point.lat, longitude: point.lng }),
    { headers: authHeaders(token), tags: { name: 'driver_online' } },
  );
}

export function sendLocation(token, driverId, point) {
  return http.post(
    `${BASE_URL}/api/v1/driver/location`,
    JSON.stringify({
      driver_id: driverId,
      city_prefix: CITY_PREFIX,
      latitude: point.lat,
      longitude: point.lng,
      bearing: Math.floor(Math.random() * 360),
      speed_kms: 20 + Math.random() * 20,
      battery: 80,
      network_type: 'wifi',
    }),
    { headers: authHeaders(token), tags: { name: 'driver_location' } },
  );
}

// ---- WebSocket ticket (rider or driver JWT -> single-use 30s ticket) -----------------------

export function mintWsTicket(token) {
  const res = http.post(`${BASE_URL}/api/v1/ws/ticket`, null, {
    headers: authHeaders(token),
    tags: { name: 'ws_ticket' },
  });
  if (res.status !== 200) return null;
  return res.json('ticket');
}
