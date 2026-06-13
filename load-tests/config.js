// Shared configuration for the Drivers-for-u k6 load-test suite.
//
// All values are grounded in the real API (verified against cmd/gateway/main.go route
// registration and the rider/driver service request structs), NOT the original template
// guesses. Notable corrections vs. the task template:
//   - trip_type uses real values; the service treats any value containing "ROUND" as a
//     round trip (internal/rider/service/booking_service.go:154).
//   - Kolkata pickups MUST sit inside the seeded geofence (lat 22.45-22.65, lng 88.25-88.45,
//     migration 000002) or the order is rejected. We sample a safe inner box.
//   - Bookings use one_time_car so they don't require a pre-seeded garage car.

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:8085';

// Seeded Kolkata service area centre (migration 000002_seed_kolkata_region).
export const KOLKATA_CENTRE = { lat: 22.5726, lng: 88.3639 };

// Inner sample box, comfortably inside the geofence (22.45-22.65 / 88.25-88.45).
// lat 22.50-22.60, lng 88.30-88.40.
export function randomKolkataPoint() {
  return {
    lat: 22.5 + Math.random() * 0.1,
    lng: 88.3 + Math.random() * 0.1,
  };
}

// Real enum-ish values accepted by the booking service.
export const TRIP_TYPE = 'IN_CITY_ROUND'; // contains "ROUND" -> treated as round trip
export const CAR_TYPE = 'SEDAN';
export const TRANSMISSION = 'MANUAL';
export const CITY_PREFIX = 'KOL';

// Order lifecycle (internal/domain/rider_order.go): CREATED -> ASSIGNED -> EN_ROUTE_TO_PICKUP
// -> DELIVERING -> COMPLETED | CANCELLED. ASSIGNED == "driver matched".
export const STATUS_ASSIGNED = 'ASSIGNED';

export function authHeaders(token) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export const JSON_HEADERS = { 'Content-Type': 'application/json' };

// Shared thresholds (carried over from the task template, tag names match the http.* tags
// we attach in the scripts).
export const BOOKING_THRESHOLDS = {
  'http_req_duration{name:fare_estimate}': ['p(95)<500'],
  'http_req_duration{name:book_driver}': ['p(95)<1000'],
  http_req_failed: ['rate<0.01'],
};
