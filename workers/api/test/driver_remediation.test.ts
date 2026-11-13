import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import driver from '../src/routes/driver';
import type { Env, AuthClaims } from '../src/types';

// ─── Test Harness Setup ────────────────────────────────────────────────────────
// Wrap driver router with an authentication extraction middleware to simulate JWT claims
function createTestApp() {
  const app = new Hono<{ Bindings: Env; Variables: { user?: AuthClaims } }>();

  app.use('*', async (c, next) => {
    const authHeader = c.req.header('Authorization');
    if (authHeader?.startsWith('Bearer admin-')) {
      c.set('user', { user_id: 'admin-uuid', role: 'ADMIN', city_scope: 'KOL' });
    } else if (authHeader?.startsWith('Bearer ')) {
      const driverId = authHeader.slice(7).trim();
      c.set('user', { user_id: driverId, role: 'DRIVER', city_scope: 'KOL' });
    }
    await next();
  });

  app.route('/', driver);
  return app;
}

// ─── Mock Database Helper ──────────────────────────────────────────────────────
interface MockOrderRecord {
  id: string;
  driver_id: string | null;
  status: string;
  start_otp: string;
  otp_attempts: number;
  total_fare_paise: number;
  city_prefix: string;
  scheduled_at?: string | null;
  trip_type?: string | null;
  pickup_lat?: number;
  pickup_lng?: number;
  dropoff_lat?: number;
  dropoff_lng?: number;
  base_fare_paise?: number;
  assigned_at?: string | null;
  rider_name?: string | null;
  rider_phone?: string | null;
  customer_id?: string | null;
}

interface MockCheckpoint {
  id: string;
  order_id: string;
  checkpoint_type: 'START' | 'END';
  odometer_value: number;
  fuel_percentage: number;
  photo_url: string;
  captured_at: string;
  created_by?: string;
}

interface MockDriverRecord {
  id: string;
  name: string;
  phone: string;
  email: string;
  city_prefix: string;
  is_verified: boolean;
  current_state: string;
  rating: number;
  acceptance_rate: number;
  onboarding_data?: any;
}

function createMockDb(
  initialOrders: MockOrderRecord[] = [],
  initialPayouts: any[] = [],
  initialCheckpoints: MockCheckpoint[] = [],
  initialDrivers: MockDriverRecord[] = []
) {
  const orders = new Map<string, MockOrderRecord>(initialOrders.map((o) => [o.id, { ...o }]));
  const payouts = [...initialPayouts];
  const checkpoints = new Map<string, MockCheckpoint>(
    initialCheckpoints.map((c) => [`${c.order_id}:${c.checkpoint_type}`, { ...c }])
  );
  const declines = new Set<string>();
  const drivers = new Map<string, MockDriverRecord>(
    initialDrivers.map((d) => [d.id, { ...d }])
  );

  // Seed default driver if not provided
  if (!drivers.has('driver-1')) {
    drivers.set('driver-1', {
      id: 'driver-1',
      name: 'Ramesh Kumar',
      phone: '+919876543210',
      email: 'ramesh@vahanly.com',
      city_prefix: 'KOL',
      is_verified: true,
      current_state: 'ONLINE_AVAILABLE',
      rating: 4.88,
      acceptance_rate: 0.94,
      onboarding_data: {},
    });
  }

  const mockSql: any = async (strings: TemplateStringsArray, ...values: any[]) => {
    const rawSql = strings.join('?').trim();

    // 0. Driver Profile & Emergency Contact
    if (rawSql.includes('FROM drivers') && rawSql.includes('WHERE id =')) {
      const driverId = values[0];
      const d = drivers.get(driverId);
      if (!d) return [];
      return [{ ...d }];
    }

    if (rawSql.includes('UPDATE drivers') && rawSql.includes('onboarding_data')) {
      const driverId = values[1];
      const d = drivers.get(driverId);
      if (d) {
        const contactData = JSON.parse(values[0]);
        d.onboarding_data = {
          ...(d.onboarding_data || {}),
          emergency_contact: contactData,
        };
      }
      return [];
    }

    // 1. Odometer Checkpoints
    if (rawSql.includes('SELECT odometer_value FROM trip_odometer_checkpoints')) {
      const orderId = values[0];
      const type = values[1] || 'START';
      const cp = checkpoints.get(`${orderId}:${type}`);
      return cp ? [{ odometer_value: cp.odometer_value }] : [];
    }

    if (rawSql.includes('SELECT') && rawSql.includes('FROM trip_odometer_checkpoints')) {
      const orderId = values[0];
      const list = Array.from(checkpoints.values()).filter((c) => c.order_id === orderId);
      return list.map((c) => ({
        id: c.id,
        order_id: c.order_id,
        checkpoint_type: c.checkpoint_type,
        odometer_reading: c.odometer_value,
        fuel_level: c.fuel_percentage,
        photo_url: c.photo_url,
        captured_at: c.captured_at,
      }));
    }

    if (rawSql.includes('INSERT INTO trip_odometer_checkpoints')) {
      const orderId = values[0];
      const checkpointType = values[1] as 'START' | 'END';
      const odometerValue = values[2];
      const fuelPercentage = values[3];
      const photoUrl = values[4] || '';
      const createdBy = values[5];
      const id = `cp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const capturedAt = new Date().toISOString();
      const cp: MockCheckpoint = {
        id,
        order_id: orderId,
        checkpoint_type: checkpointType,
        odometer_value: odometerValue,
        fuel_percentage: fuelPercentage,
        photo_url: photoUrl,
        captured_at: capturedAt,
        created_by: createdBy,
      };
      checkpoints.set(`${orderId}:${checkpointType}`, cp);
      return [{ id, captured_at: capturedAt }];
    }

    // 2. Dispatch Offer query (GET /api/v1/driver/offer)
    if (rawSql.includes('FROM orders o') && rawSql.includes("o.status IN ('ASSIGNED', 'OFFER_PENDING')")) {
      const driverId = values[0];
      for (const order of orders.values()) {
        if (
          order.driver_id === driverId &&
          (order.status === 'ASSIGNED' || order.status === 'OFFER_PENDING')
        ) {
          return [
            {
              id: order.id,
              status: order.status,
              rider_name: order.rider_name || 'Subhash Roy',
              rider_phone: order.rider_phone || '+919830012345',
              rider_rating: 4.8,
              pickup_address: 'Salt Lake Sector V',
              pickup_lat: order.pickup_lat || 22.58,
              pickup_lng: order.pickup_lng || 88.42,
              dropoff_address: 'Kolkata Airport (CCU)',
              dropoff_lat: order.dropoff_lat || 22.65,
              dropoff_lng: order.dropoff_lng || 88.44,
              base_fare_paise: order.base_fare_paise || 38000,
              surge_multiplier: 1.0,
              trip_type: order.trip_type || 'CITY',
              car_type: 'Sedan',
              car_transmission: 'Manual',
              assigned_at: order.assigned_at || new Date().toISOString(),
            },
          ];
        }
      }
      return [];
    }

    // 3. Scheduled Offers: Open city advance bookings (GET /api/v1/driver/scheduled-offers)
    if (rawSql.includes('FROM orders o') && rawSql.includes('o.driver_id IS NULL')) {
      const city = values[0];
      const driverId = values[1];
      const available = Array.from(orders.values()).filter(
        (o) =>
          (!city || o.city_prefix === city) &&
          !o.driver_id &&
          o.status === 'CREATED' &&
          o.scheduled_at &&
          !declines.has(`${o.id}:${driverId}`)
      );
      return available.map((o) => ({
        id: o.id,
        scheduled_at: o.scheduled_at,
        trip_type: o.trip_type || 'CITY',
        pickup_lat: o.pickup_lat || 22.57,
        pickup_lng: o.pickup_lng || 88.36,
        base_fare_paise: o.base_fare_paise || 35000,
      }));
    }

    // 4. Scheduled Trips: Upcoming (GET /api/v1/driver/trips/upcoming)
    if (rawSql.includes('FROM orders') && rawSql.includes('scheduled_at > now()') && !rawSql.includes('o.driver_id IS NULL')) {
      const driverId = values[0];
      const upcoming = Array.from(orders.values()).filter(
        (o) =>
          o.driver_id === driverId &&
          o.scheduled_at &&
          ['ASSIGNED', 'CREATED', 'RESERVED'].includes(o.status)
      );
      return upcoming.map((o) => ({
        id: o.id,
        status: o.status,
        scheduled_at: o.scheduled_at,
        trip_type: o.trip_type || 'CITY',
        pickup_lat: o.pickup_lat || 22.57,
        pickup_lng: o.pickup_lng || 88.36,
        base_fare_paise: o.base_fare_paise || 35000,
      }));
    }

    // 5. Accept Scheduled Offer (POST /api/v1/driver/scheduled-offers/:id/accept)
    if (rawSql.includes('UPDATE orders') && rawSql.includes('SET driver_id =') && rawSql.includes('AND driver_id IS NULL')) {
      const driverId = values[0];
      const orderId = values[1];
      const order = orders.get(orderId);
      if (order && !order.driver_id && order.status === 'CREATED') {
        order.driver_id = driverId;
        order.status = 'ASSIGNED';
        order.assigned_at = new Date().toISOString();
        return [{ id: order.id }];
      }
      return [];
    }

    // 6. Decline Scheduled Offer / Offer decline table
    if (rawSql.includes('INSERT INTO scheduled_offer_declines')) {
      const orderId = values[0];
      const driverId = values[1];
      declines.add(`${orderId}:${driverId}`);
      return [];
    }

    // 7. Offer Response: ACCEPTED
    if (rawSql.includes('UPDATE orders') && rawSql.includes("SET status = 'ASSIGNED'") && rawSql.includes('assigned_at =')) {
      const orderId = values[0];
      const order = orders.get(orderId);
      if (order) {
        order.status = 'ASSIGNED';
        order.assigned_at = order.assigned_at || new Date().toISOString();
      }
      return [];
    }

    // 8. Offer Response: DECLINED (unassign)
    if (rawSql.includes('UPDATE orders') && rawSql.includes('SET driver_id = NULL') && rawSql.includes("status = 'CREATED'")) {
      const orderId = values[0];
      const driverId = values[1];
      const order = orders.get(orderId);
      if (order && order.driver_id === driverId) {
        order.driver_id = null;
        order.status = 'CREATED';
      }
      return [];
    }

    // 9. SELECT orders for verify-otp, arrived, end, events, or offer-response
    if (rawSql.includes('SELECT') && rawSql.includes('FROM orders')) {
      const orderId = values[0];
      const order = orders.get(orderId);
      if (!order) return [];
      return [
        {
          id: order.id,
          start_otp: order.start_otp,
          status: order.status,
          driver_id: order.driver_id,
          otp_attempts: order.otp_attempts,
          total_fare_paise: order.total_fare_paise,
          city_prefix: order.city_prefix,
          customer_id: order.customer_id || 'customer-1',
        },
      ];
    }

    // 10. UPDATE orders for verify-otp (attempt increment)
    if (rawSql.includes('UPDATE orders') && rawSql.includes('SET otp_attempts =')) {
      const nextAttempts = values[0];
      const orderId = values[1];
      const order = orders.get(orderId);
      if (order) order.otp_attempts = nextAttempts;
      return [];
    }

    // 11. UPDATE orders for verify-otp (successful transition to IN_TRANSIT)
    if (rawSql.includes('UPDATE orders') && rawSql.includes("SET status = 'IN_TRANSIT'")) {
      const orderId = values[0];
      const order = orders.get(orderId);
      if (order) {
        order.status = 'IN_TRANSIT';
        order.otp_attempts = 0;
      }
      return [];
    }

    // 12. UPDATE orders for arrived
    if (rawSql.includes('UPDATE orders') && rawSql.includes("SET status = 'ARRIVED'")) {
      const orderId = values[0];
      const order = orders.get(orderId);
      if (order) order.status = 'ARRIVED';
      return [];
    }

    // 13. UPDATE orders for events (tolls, parking)
    if (rawSql.includes('UPDATE orders') && rawSql.includes('SET total_fare_paise = total_fare_paise +')) {
      const added = values[0];
      const orderId = values[1];
      const order = orders.get(orderId);
      if (order) order.total_fare_paise += added;
      return [];
    }

    // 14. UPDATE orders for end (completed)
    if (rawSql.includes('UPDATE orders') && rawSql.includes("SET status = 'COMPLETED'")) {
      const orderId = values[0];
      const order = orders.get(orderId);
      if (order) order.status = 'COMPLETED';
      return [{ total_fare_paise: order?.total_fare_paise || 50000, city_prefix: 'KOL' }];
    }

    // 15. SELECT pending payouts
    if (rawSql.includes('SELECT id FROM driver_payouts') && rawSql.includes("status = 'REQUESTED'")) {
      const driverId = values[0];
      const pending = payouts.filter((p) => p.driver_id === driverId && p.status === 'REQUESTED');
      return pending;
    }

    // 16. INSERT into driver_payouts
    if (rawSql.includes('INSERT INTO driver_payouts')) {
      const driverId = values[0];
      const amountPaise = values[1];
      const newId = `payout-${Date.now()}`;
      payouts.push({ id: newId, driver_id: driverId, amount_paise: amountPaise, status: 'REQUESTED' });
      return [{ id: newId }];
    }

    return [];
  };

  return { mockSql, orders, payouts, checkpoints, declines, drivers };
}

function createMockEnv(mockSql: any): Env {
  return {
    __mockDb: mockSql,
    CITY_PREFIX: 'KOL',
    CITY_DISPATCH_DO: {
      getByName: () => ({
        setDriverStatus: async () => {},
      }),
    },
    ORDER_STREAM_DO: {
      getByName: () => ({
        broadcastJSON: async () => {},
      }),
    },
    RIDER_STREAM_DO: {
      getByName: () => ({
        pushTripEvent: async () => {},
      }),
    },
    EVENTS: {
      send: async () => {},
    },
  } as unknown as Env;
}

// ─── Test Suite: Trip Verification (verify-otp) ────────────────────────────────
describe('TASK-DRV-001: Hardened Trip OTP Verification & Authorization', () => {
  const app = createTestApp();

  it('rejects unauthenticated requests with 401', async () => {
    const { mockSql } = createMockDb();
    const env = createMockEnv(mockSql);

    const res = await app.request(
      '/api/v1/driver/orders/ord-1/verify-otp',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otp: '5842' }),
      },
      env
    );

    expect(res.status).toBe(401);
    const body: any = await res.json();
    expect(body.error).toBe('unauthorized');
  });

  it('rejects non-existent orders with 404', async () => {
    const { mockSql } = createMockDb([]);
    const env = createMockEnv(mockSql);

    const res = await app.request(
      '/api/v1/driver/orders/ord-missing/verify-otp',
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer driver-123',
        },
        body: JSON.stringify({ otp: '5842' }),
      },
      env
    );

    expect(res.status).toBe(404);
  });

  it('rejects an unauthorized driver attempting to verify another driver assigned order with 403', async () => {
    const { mockSql } = createMockDb([
      {
        id: 'ord-100',
        driver_id: 'driver-legitimate-owner',
        status: 'ARRIVED',
        start_otp: '5842',
        otp_attempts: 0,
        total_fare_paise: 50000,
        city_prefix: 'KOL',
      },
    ]);
    const env = createMockEnv(mockSql);

    const res = await app.request(
      '/api/v1/driver/orders/ord-100/verify-otp',
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer driver-unauthorized-intruder',
        },
        body: JSON.stringify({ otp: '5842' }),
      },
      env
    );

    expect(res.status).toBe(403);
    const body: any = await res.json();
    expect(body.error).toMatch(/forbidden: not assigned driver/);
  });

  it('rejects OTP verification if order is not in ARRIVED status (e.g., CREATED, COMPLETED)', async () => {
    const { mockSql } = createMockDb([
      {
        id: 'ord-created',
        driver_id: 'driver-1',
        status: 'CREATED',
        start_otp: '5842',
        otp_attempts: 0,
        total_fare_paise: 50000,
        city_prefix: 'KOL',
      },
    ]);
    const env = createMockEnv(mockSql);

    const res = await app.request(
      '/api/v1/driver/orders/ord-created/verify-otp',
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer driver-1',
        },
        body: JSON.stringify({ otp: '5842' }),
      },
      env
    );

    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error).toMatch(/order must be in ARRIVED status/);
  });

  it('returns 409 Conflict if order is already IN_TRANSIT (idempotency / replay guard)', async () => {
    const { mockSql } = createMockDb([
      {
        id: 'ord-transit',
        driver_id: 'driver-1',
        status: 'IN_TRANSIT',
        start_otp: '5842',
        otp_attempts: 0,
        total_fare_paise: 50000,
        city_prefix: 'KOL',
      },
    ]);
    const env = createMockEnv(mockSql);

    const res = await app.request(
      '/api/v1/driver/orders/ord-transit/verify-otp',
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer driver-1',
        },
        body: JSON.stringify({ otp: '5842' }),
      },
      env
    );

    expect(res.status).toBe(409);
    const body: any = await res.json();
    expect(body.error).toBe('trip already in transit');
  });

  it('REJECTS backdoor OTP 1234 when genuine order OTP is different', async () => {
    const { mockSql, orders } = createMockDb([
      {
        id: 'ord-secure',
        driver_id: 'driver-1',
        status: 'ARRIVED',
        start_otp: '7890', // Genuine challenge is 7890
        otp_attempts: 0,
        total_fare_paise: 50000,
        city_prefix: 'KOL',
      },
    ]);
    const env = createMockEnv(mockSql);

    const res = await app.request(
      '/api/v1/driver/orders/ord-secure/verify-otp',
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer driver-1',
        },
        body: JSON.stringify({ otp: '1234' }), // Submitting previous bypass code
      },
      env
    );

    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('invalid OTP');
    expect(body.remaining_attempts).toBe(2);

    // Verify state was NOT transitioned
    expect(orders.get('ord-secure')?.status).toBe('ARRIVED');
    expect(orders.get('ord-secure')?.otp_attempts).toBe(1);
  });

  it('ACCEPTS OTP 1234 when genuine order challenge genuinely is 1234 (no blacklisting bug)', async () => {
    const { mockSql, orders } = createMockDb([
      {
        id: 'ord-coincidental-1234',
        driver_id: 'driver-1',
        status: 'ARRIVED',
        start_otp: '1234', // Genuine challenge happens to be 1234
        otp_attempts: 0,
        total_fare_paise: 50000,
        city_prefix: 'KOL',
      },
    ]);
    const env = createMockEnv(mockSql);

    const res = await app.request(
      '/api/v1/driver/orders/ord-coincidental-1234/verify-otp',
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer driver-1',
        },
        body: JSON.stringify({ otp: '1234' }),
      },
      env
    );

    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.status).toBe('IN_TRANSIT');
    expect(orders.get('ord-coincidental-1234')?.status).toBe('IN_TRANSIT');
  });

  it('locks OTP verification after 3 failed attempts (anti-brute force)', async () => {
    const { mockSql } = createMockDb([
      {
        id: 'ord-locked',
        driver_id: 'driver-1',
        status: 'ARRIVED',
        start_otp: '9999',
        otp_attempts: 3, // Already failed 3 times
        total_fare_paise: 50000,
        city_prefix: 'KOL',
      },
    ]);
    const env = createMockEnv(mockSql);

    const res = await app.request(
      '/api/v1/driver/orders/ord-locked/verify-otp',
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer driver-1',
        },
        body: JSON.stringify({ otp: '9999' }), // Even correct OTP is locked
      },
      env
    );

    expect(res.status).toBe(403);
    const body: any = await res.json();
    expect(body.locked).toBe(true);
    expect(body.error).toMatch(/too_many_otp_attempts/);
  });
});

// ─── Test Suite: In-Transit Events (/events) ──────────────────────────────────
describe('TASK-DRV-003: In-Transit Order Events & Expense API', () => {
  const app = createTestApp();

  it('rejects unauthenticated expense event requests with 401', async () => {
    const { mockSql } = createMockDb();
    const env = createMockEnv(mockSql);

    const res = await app.request(
      '/api/v1/driver/orders/ord-1/events',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'TOLL', toll_amount_paise: 12000 }),
      },
      env
    );

    expect(res.status).toBe(401);
  });

  it('rejects invalid event types with 400', async () => {
    const { mockSql } = createMockDb();
    const env = createMockEnv(mockSql);

    const res = await app.request(
      '/api/v1/driver/orders/ord-1/events',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer driver-1',
        },
        body: JSON.stringify({ type: 'UNAUTHORIZED_CUSTOM_EVENT' }),
      },
      env
    );

    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error).toMatch(/invalid event type/);
  });

  it('rejects expenses exceeding single-transaction limits (₹5,000)', async () => {
    const { mockSql } = createMockDb();
    const env = createMockEnv(mockSql);

    const res = await app.request(
      '/api/v1/driver/orders/ord-1/events',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer driver-1',
        },
        body: JSON.stringify({ type: 'TOLL', toll_amount_paise: 600000 }), // ₹6,000
      },
      env
    );

    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error).toMatch(/expense amount exceeds single-transaction limit/);
  });

  it('accepts valid toll event during IN_TRANSIT and increments total fare', async () => {
    const { mockSql, orders } = createMockDb([
      {
        id: 'ord-toll-test',
        driver_id: 'driver-1',
        status: 'IN_TRANSIT',
        start_otp: '5842',
        otp_attempts: 0,
        total_fare_paise: 35000, // ₹350
        city_prefix: 'KOL',
      },
    ]);
    const env = createMockEnv(mockSql);

    const res = await app.request(
      '/api/v1/driver/orders/ord-toll-test/events',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer driver-1',
        },
        body: JSON.stringify({
          type: 'TOLL',
          toll_amount_paise: 12000, // ₹120 toll
          notes: 'Vidyasagar Setu Toll',
        }),
      },
      env
    );

    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.added_paise).toBe(12000);
    expect(body.new_total_fare_paise).toBe(47000); // 35000 + 12000

    // Verify order was updated in DB
    expect(orders.get('ord-toll-test')?.total_fare_paise).toBe(47000);
  });
});

// ─── Test Suite: Payouts Authorization & Guard ────────────────────────────────
describe('TASK-DRV-005: Payout Request Authorization & Validation Guard', () => {
  const app = createTestApp();

  it('rejects invalid, negative, or zero payout amounts with 400', async () => {
    const { mockSql } = createMockDb();
    const env = createMockEnv(mockSql);

    const res = await app.request(
      '/api/v1/driver/payouts/request',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer driver-1',
        },
        body: JSON.stringify({ amount_paise: -500 }),
      },
      env
    );

    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error).toMatch(/invalid amount/);
  });

  it('rejects amounts below minimum withdrawal threshold (< ₹100 / 10,000 paise)', async () => {
    const { mockSql } = createMockDb();
    const env = createMockEnv(mockSql);

    const res = await app.request(
      '/api/v1/driver/payouts/request',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer driver-1',
        },
        body: JSON.stringify({ amount_paise: 5000 }), // ₹50
      },
      env
    );

    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error).toMatch(/minimum payout amount is 10,000 paise/);
  });

  it('rejects duplicate payout requests when a payout is already under review with 409', async () => {
    const { mockSql } = createMockDb([], [
      { id: 'payout-existing', driver_id: 'driver-1', amount_paise: 25000, status: 'REQUESTED' },
    ]);
    const env = createMockEnv(mockSql);

    const res = await app.request(
      '/api/v1/driver/payouts/request',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer driver-1',
        },
        body: JSON.stringify({ amount_paise: 20000 }),
      },
      env
    );

    expect(res.status).toBe(409);
    const body: any = await res.json();
    expect(body.error).toMatch(/payout_already_pending/);
  });

  it('accepts valid payout request within permitted bounds', async () => {
    const { mockSql, payouts } = createMockDb();
    const env = createMockEnv(mockSql);

    const res = await app.request(
      '/api/v1/driver/payouts/request',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer driver-1',
        },
        body: JSON.stringify({ amount_paise: 50000 }), // ₹500
      },
      env
    );

    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.status).toBe('REQUESTED');
    expect(body.amount_paise).toBe(50000);
    expect(payouts.length).toBe(1);
  });
});

// ─── Test Suite: Vehicle Inspection & Odometer Checkpoints ─────────────────────
describe('TASK-DRV-004: Vehicle Inspection & Odometer Persistence', () => {
  const app = createTestApp();

  it('persists START odometer checkpoint on verify-otp when provided', async () => {
    const { mockSql, checkpoints } = createMockDb([
      {
        id: 'ord-odo-1',
        driver_id: 'driver-1',
        status: 'ARRIVED',
        start_otp: '7890',
        otp_attempts: 0,
        total_fare_paise: 50000,
        city_prefix: 'KOL',
      },
    ]);
    const env = createMockEnv(mockSql);

    const res = await app.request(
      '/api/v1/driver/orders/ord-odo-1/verify-otp',
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer driver-1',
        },
        body: JSON.stringify({
          otp: '7890',
          start_odometer: 45200,
          fuel_percentage: 85,
        }),
      },
      env
    );

    expect(res.status).toBe(200);
    const startCp = checkpoints.get('ord-odo-1:START');
    expect(startCp).toBeDefined();
    expect(startCp?.odometer_value).toBe(45200);
    expect(startCp?.fuel_percentage).toBe(85);
  });

  it('records START and END checkpoints via dedicated odometer endpoint', async () => {
    const { mockSql, checkpoints } = createMockDb([
      {
        id: 'ord-odo-2',
        driver_id: 'driver-1',
        status: 'ARRIVED',
        start_otp: '1111',
        otp_attempts: 0,
        total_fare_paise: 50000,
        city_prefix: 'KOL',
      },
    ]);
    const env = createMockEnv(mockSql);

    // 1. Submit START checkpoint
    const resStart = await app.request(
      '/api/v1/driver/orders/ord-odo-2/odometer',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer driver-1',
        },
        body: JSON.stringify({
          checkpoint_type: 'START',
          odometer_reading: 50100,
          fuel_level: 90,
          photo_url: 'https://cdn.example.com/start.jpg',
        }),
      },
      env
    );

    expect(resStart.status).toBe(200);
    const bodyStart: any = await resStart.json();
    expect(bodyStart.checkpoint_type).toBe('START');
    expect(bodyStart.odometer_reading).toBe(50100);
    expect(bodyStart.fuel_level).toBe(90);

    // 2. Submit END checkpoint
    const resEnd = await app.request(
      '/api/v1/driver/orders/ord-odo-2/odometer',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer driver-1',
        },
        body: JSON.stringify({
          checkpoint_type: 'END',
          odometer_reading: 50145,
          fuel_level: 80,
          photo_url: 'https://cdn.example.com/end.jpg',
        }),
      },
      env
    );

    expect(resEnd.status).toBe(200);
    const bodyEnd: any = await resEnd.json();
    expect(bodyEnd.checkpoint_type).toBe('END');
    expect(bodyEnd.odometer_reading).toBe(50145);
    expect(bodyEnd.fuel_level).toBe(80);
  });

  it('rejects END odometer reading lower than START reading with 400', async () => {
    const { mockSql } = createMockDb(
      [
        {
          id: 'ord-odo-3',
          driver_id: 'driver-1',
          status: 'IN_TRANSIT',
          start_otp: '1111',
          otp_attempts: 0,
          total_fare_paise: 50000,
          city_prefix: 'KOL',
        },
      ],
      [],
      [
        {
          id: 'cp-start-3',
          order_id: 'ord-odo-3',
          checkpoint_type: 'START',
          odometer_value: 50000,
          fuel_percentage: 90,
          photo_url: '',
          captured_at: new Date().toISOString(),
        },
      ]
    );
    const env = createMockEnv(mockSql);

    // Try ending trip with lower odometer reading (49900 < 50000)
    const res = await app.request(
      '/api/v1/driver/orders/ord-odo-3/end',
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer driver-1',
        },
        body: JSON.stringify({
          odometer_reading: 49900,
          fuel_level: 85,
        }),
      },
      env
    );

    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error).toMatch(/end odometer .* cannot be less than start odometer/);
  });
});

// ─── Test Suite: Dispatch Offer & Acceptance Loop ─────────────────────────────
describe('TASK-DRV-005: Dispatch Offer & Acceptance Loop', () => {
  const app = createTestApp();

  it('returns pending offer for driver on GET /api/v1/driver/offer', async () => {
    const { mockSql } = createMockDb([
      {
        id: 'ord-offer-1',
        driver_id: 'driver-1',
        status: 'ASSIGNED',
        start_otp: '5555',
        otp_attempts: 0,
        total_fare_paise: 42000,
        city_prefix: 'KOL',
        base_fare_paise: 42000,
        rider_name: 'Ananya Sen',
        rider_phone: '+919830198765',
      },
    ]);
    const env = createMockEnv(mockSql);

    const res = await app.request(
      '/api/v1/driver/offer',
      {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer driver-1',
        },
      },
      env
    );

    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.order).toBeDefined();
    expect(body.order.orderId).toBe('ord-offer-1');
    expect(body.order.riderName).toBe('Ananya Sen');
    expect(body.order.fareEstimate).toBe(420);
    expect(typeof body.offer_expires_in_seconds).toBe('number');
  });

  it('returns order: null when no active offer exists', async () => {
    const { mockSql } = createMockDb([]);
    const env = createMockEnv(mockSql);

    const res = await app.request(
      '/api/v1/driver/offer',
      {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer driver-1',
        },
      },
      env
    );

    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.order).toBeNull();
  });

  it('accepts offer and transitions driver to BUSY', async () => {
    const { mockSql, orders } = createMockDb([
      {
        id: 'ord-offer-2',
        driver_id: 'driver-1',
        status: 'ASSIGNED',
        start_otp: '5555',
        otp_attempts: 0,
        total_fare_paise: 42000,
        city_prefix: 'KOL',
      },
    ]);
    let updatedDriverStatus: string | null = null;
    const env = {
      ...createMockEnv(mockSql),
      CITY_DISPATCH_DO: {
        getByName: () => ({
          setDriverStatus: async (_dId: string, status: string) => {
            updatedDriverStatus = status;
          },
        }),
      },
    } as unknown as Env;

    const res = await app.request(
      '/api/v1/driver/orders/ord-offer-2/offer-response',
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer driver-1',
        },
        body: JSON.stringify({ response: 'ACCEPTED' }),
      },
      env
    );

    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.status).toBe('ACCEPTED');
    expect(updatedDriverStatus).toBe('BUSY');
    expect(orders.get('ord-offer-2')?.status).toBe('ASSIGNED');
  });

  it('declines offer, unassigns driver, and resets order to CREATED', async () => {
    const { mockSql, orders, declines } = createMockDb([
      {
        id: 'ord-offer-3',
        driver_id: 'driver-1',
        status: 'ASSIGNED',
        start_otp: '5555',
        otp_attempts: 0,
        total_fare_paise: 42000,
        city_prefix: 'KOL',
      },
    ]);
    let updatedDriverStatus: string | null = null;
    const env = {
      ...createMockEnv(mockSql),
      CITY_DISPATCH_DO: {
        getByName: () => ({
          setDriverStatus: async (_dId: string, status: string) => {
            updatedDriverStatus = status;
          },
        }),
      },
    } as unknown as Env;

    const res = await app.request(
      '/api/v1/driver/orders/ord-offer-3/offer-response',
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer driver-1',
        },
        body: JSON.stringify({ response: 'DECLINED', reason: 'TOO_FAR' }),
      },
      env
    );

    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.status).toBe('DECLINED');
    expect(updatedDriverStatus).toBe('ONLINE_AVAILABLE');

    const order = orders.get('ord-offer-3');
    expect(order?.driver_id).toBeNull();
    expect(order?.status).toBe('CREATED');
    expect(declines.has('ord-offer-3:driver-1')).toBe(true);
  });
});

// ─── Test Suite: Scheduled Bookings & Trip Planner ─────────────────────────────
describe('TASK-DRV-006: Scheduled Bookings & Trip Planner Offers', () => {
  const app = createTestApp();

  it('returns upcoming scheduled trips assigned to driver', async () => {
    const futureDate = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const { mockSql } = createMockDb([
      {
        id: 'ord-sched-1',
        driver_id: 'driver-1',
        status: 'ASSIGNED',
        start_otp: '1234',
        otp_attempts: 0,
        total_fare_paise: 65000,
        base_fare_paise: 65000,
        city_prefix: 'KOL',
        scheduled_at: futureDate,
        trip_type: 'OUTSTATION',
      },
    ]);
    const env = createMockEnv(mockSql);

    const res = await app.request(
      '/api/v1/driver/trips/upcoming',
      {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer driver-1',
        },
      },
      env
    );

    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.trips).toBeDefined();
    expect(body.trips.length).toBe(1);
    expect(body.trips[0].id).toBe('ord-sched-1');
    expect(body.trips[0].trip_type).toBe('OUTSTATION');
    expect(body.trips[0].base_fare_paise).toBe(65000);
  });

  it('allows early commitment to an unassigned scheduled offer', async () => {
    const futureDate = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
    const { mockSql, orders } = createMockDb([
      {
        id: 'ord-sched-2',
        driver_id: null,
        status: 'CREATED',
        start_otp: '9999',
        otp_attempts: 0,
        total_fare_paise: 80000,
        base_fare_paise: 80000,
        city_prefix: 'KOL',
        scheduled_at: futureDate,
        trip_type: 'CITY',
      },
    ]);
    const env = createMockEnv(mockSql);

    // 1. Get open offers
    const resList = await app.request(
      '/api/v1/driver/scheduled-offers',
      {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer driver-1',
        },
      },
      env
    );

    expect(resList.status).toBe(200);
    const bodyList: any = await resList.json();
    expect(bodyList.offers.length).toBe(1);
    expect(bodyList.offers[0].id).toBe('ord-sched-2');

    // 2. Accept offer
    const resAccept = await app.request(
      '/api/v1/driver/scheduled-offers/ord-sched-2/accept',
      {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer driver-1',
        },
      },
      env
    );

    expect(resAccept.status).toBe(200);
    const bodyAccept: any = await resAccept.json();
    expect(bodyAccept.status).toBe('ASSIGNED');
    expect(orders.get('ord-sched-2')?.driver_id).toBe('driver-1');
  });
});

// ─── Test Suite: Emergency Contact Profile Management ──────────────────────────
describe('TASK-DRV-007: Emergency Contact Profile Management', () => {
  const app = createTestApp();

  it('rejects emergency contact with invalid phone or missing name', async () => {
    const { mockSql } = createMockDb();
    const env = createMockEnv(mockSql);

    // Missing name
    const res1 = await app.request(
      '/api/v1/driver/profile/emergency-contact',
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer driver-1',
        },
        body: JSON.stringify({ name: '', phone: '+919830012345' }),
      },
      env
    );
    expect(res1.status).toBe(400);

    // Invalid phone (<10 digits)
    const res2 = await app.request(
      '/api/v1/driver/profile/emergency-contact',
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer driver-1',
        },
        body: JSON.stringify({ name: 'Rohit Roy', phone: '123' }),
      },
      env
    );
    expect(res2.status).toBe(400);
    const body2: any = await res2.json();
    expect(body2.error).toMatch(/valid phone number/);
  });

  it('successfully updates emergency contact and returns it on GET /api/v1/driver/me', async () => {
    const { mockSql, drivers } = createMockDb();
    const env = createMockEnv(mockSql);

    // 1. Update contact
    const resPatch = await app.request(
      '/api/v1/driver/profile/emergency-contact',
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer driver-1',
        },
        body: JSON.stringify({
          name: 'Sunita Kumar',
          relation: 'Spouse',
          phone: '+919876543219',
        }),
      },
      env
    );

    expect(resPatch.status).toBe(200);
    const bodyPatch: any = await resPatch.json();
    expect(bodyPatch.emergency_contact).toEqual({
      name: 'Sunita Kumar',
      relation: 'Spouse',
      phone: '+919876543219',
    });

    // 2. Fetch /driver/me and verify emergency_contact is present
    const resMe = await app.request(
      '/api/v1/driver/me',
      {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer driver-1',
        },
      },
      env
    );

    expect(resMe.status).toBe(200);
    const bodyMe: any = await resMe.json();
    expect(bodyMe.emergency_contact).toEqual({
      name: 'Sunita Kumar',
      relation: 'Spouse',
      phone: '+919876543219',
    });
  });
});
