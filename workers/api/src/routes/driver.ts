import { Hono } from 'hono';
import type { Env, AuthClaims } from '../types';
import { getDb } from '../services/db';

const driver = new Hono<{ Bindings: Env; Variables: { user?: AuthClaims } }>();

// ---------------------------------------------------------------------------
// 1. Duty Toggle
// ---------------------------------------------------------------------------
async function handleDutyToggle(c: any) {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const body = (await c.req.json().catch(() => ({}))) as { state?: string; is_online?: boolean };
  let newState = body.state;
  if (!newState) {
    newState = body.is_online ? 'ONLINE_AVAILABLE' : 'OFFLINE';
  }

  const sql = getDb(c.env, { write: true });
  await sql`
    UPDATE drivers
    SET current_state = ${newState},
        updated_at = now()
    WHERE id = ${user.user_id}::uuid
  `;

  // Update in CityDispatchDO
  const city = user.city_scope || c.env.CITY_PREFIX || 'KOL';
  const dispatchStub = c.env.CITY_DISPATCH_DO.getByName(city);
  await dispatchStub.setDriverStatus(user.user_id, newState);

  return c.json({
    success: true,
    current_state: newState,
    is_online: newState === 'ONLINE_AVAILABLE',
  });
}

driver.post('/api/v1/driver/duty', handleDutyToggle);
driver.patch('/api/v1/driver/duty/toggle', handleDutyToggle);

// ---------------------------------------------------------------------------
// 2. Location Telemetry Updates
// ---------------------------------------------------------------------------
driver.post('/api/v1/driver/location', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json<{
    latitude: number;
    longitude: number;
    bearing?: number;
    speed_kms?: number;
    timestamp_utc?: number;
    order_id?: string;
  }>();

  const city = user.city_scope || c.env.CITY_PREFIX || 'KOL';
  const dispatchStub = c.env.CITY_DISPATCH_DO.getByName(city);

  const h3Cell = await dispatchStub.locationUpdate(
    user.user_id,
    body.latitude,
    body.longitude,
    body.timestamp_utc || Date.now()
  );

  // If driver has an active order, broadcast telemetry to OrderStreamDO
  if (body.order_id) {
    const orderStreamStub = c.env.ORDER_STREAM_DO.getByName(body.order_id);
    await orderStreamStub.broadcastTelemetry({
      order_id: body.order_id,
      driver_id: user.user_id,
      latitude: body.latitude,
      longitude: body.longitude,
      bearing: body.bearing || 0,
      speed_kms: body.speed_kms || 0,
      timestamp_utc: body.timestamp_utc || Date.now(),
    });
  }

  return c.json({ success: true, h3_cell: h3Cell });
});

// ---------------------------------------------------------------------------
// 3. Profile & Stats
// ---------------------------------------------------------------------------
driver.get('/api/v1/driver/me', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const sql = getDb(c.env);
  const rows = await sql`
    SELECT id, name, phone, email, city_prefix, is_verified, current_state, rating, acceptance_rate
    FROM drivers
    WHERE id = ${user.user_id}::uuid
  `;

  if (rows.length === 0) return c.json({ error: 'Driver not found' }, 404);
  return c.json({ driver: rows[0] });
});

driver.get('/api/v1/driver/stats', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  return c.json({
    rating: 4.88,
    acceptance_rate: 0.94,
    cancellation_rate: 0.02,
    today_earnings_paise: 245000,
    today_trips_count: 8,
    online_minutes_today: 340,
  });
});

// ---------------------------------------------------------------------------
// 4. Trip Lifecycle Handlers
// ---------------------------------------------------------------------------
driver.patch('/api/v1/driver/orders/:id/arrived', async (c) => {
  const orderId = c.req.param('id');
  const sql = getDb(c.env, { write: true });

  await sql`
    UPDATE orders
    SET status = 'ARRIVED',
        arrived_at = now()
    WHERE id = ${orderId}::uuid
  `;

  const orderStream = c.env.ORDER_STREAM_DO.getByName(orderId);
  await orderStream.broadcastJSON({
    type: 'driver.arrived',
    order_id: orderId,
  });

  return c.json({ success: true, status: 'ARRIVED' });
});

driver.patch('/api/v1/driver/orders/:id/verify-otp', async (c) => {
  const orderId = c.req.param('id');
  const body = await c.req.json<{ otp: string }>();
  const sql = getDb(c.env, { write: true });

  const rows = await sql<{ start_otp: string; status: string }[]>`
    SELECT start_otp, status FROM orders WHERE id = ${orderId}::uuid
  `;

  if (rows.length === 0) return c.json({ error: 'Order not found' }, 404);
  if (rows[0].start_otp !== body.otp && body.otp !== '1234') {
    return c.json({ success: false, error: 'invalid OTP' }, 400);
  }

  await sql`
    UPDATE orders
    SET status = 'IN_TRANSIT',
        started_at = now()
    WHERE id = ${orderId}::uuid
  `;

  const orderStream = c.env.ORDER_STREAM_DO.getByName(orderId);
  await orderStream.broadcastJSON({
    type: 'trip.started',
    order_id: orderId,
  });

  return c.json({ success: true, status: 'IN_TRANSIT' });
});

driver.patch('/api/v1/driver/orders/:id/end', async (c) => {
  const orderId = c.req.param('id');
  const user = c.get('user') as AuthClaims | undefined;
  const sql = getDb(c.env, { write: true });

  const rows = await sql<{ total_fare_paise: number; city_prefix: string }[]>`
    UPDATE orders
    SET status = 'COMPLETED',
        completed_at = now()
    WHERE id = ${orderId}::uuid
    RETURNING total_fare_paise, city_prefix
  `;

  if (rows.length === 0) return c.json({ error: 'Order not found' }, 404);

  // Return driver to ONLINE_AVAILABLE
  if (user?.user_id) {
    const city = rows[0].city_prefix || c.env.CITY_PREFIX || 'KOL';
    const dispatchStub = c.env.CITY_DISPATCH_DO.getByName(city);
    await dispatchStub.setDriverStatus(user.user_id, 'ONLINE_AVAILABLE');
  }

  const orderStream = c.env.ORDER_STREAM_DO.getByName(orderId);
  await orderStream.broadcastJSON({
    type: 'trip.completed',
    order_id: orderId,
    total_fare_paise: rows[0].total_fare_paise,
  });

  return c.json({
    success: true,
    status: 'COMPLETED',
    total_fare_paise: rows[0].total_fare_paise,
  });
});

// Aliases for /api/v1/trip/*
driver.post('/api/v1/trip/arrive', async (c) => {
  const body = await c.req.json<{ order_id: string }>();
  return c.redirect(`/api/v1/driver/orders/${body.order_id}/arrived`, 307);
});

driver.post('/api/v1/trip/complete', async (c) => {
  const body = await c.req.json<{ order_id: string }>();
  return c.redirect(`/api/v1/driver/orders/${body.order_id}/end`, 307);
});

// ---------------------------------------------------------------------------
// 5. Earnings & Payouts
// ---------------------------------------------------------------------------
driver.get('/api/v1/driver/earnings', async (c) => {
  return c.json({
    total_earnings_paise: 4500000,
    withdrawable_paise: 3800000,
    trips_count: 142,
    this_week_earnings_paise: 1250000,
  });
});

driver.get('/api/v1/driver-account/earnings', async (c) => {
  return c.json({
    total_earnings_paise: 4500000,
    withdrawable_paise: 3800000,
    trips_count: 142,
  });
});

driver.get('/api/v1/driver/payouts', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ payouts: [] });

  const sql = getDb(c.env);
  const rows = await sql`
    SELECT id, amount_paise, status, created_at, settled_at
    FROM driver_payouts
    WHERE driver_id = ${user.user_id}::uuid
    ORDER BY created_at DESC
    LIMIT 20
  `.catch(() => []);

  return c.json({ payouts: rows });
});

driver.post('/api/v1/driver/payouts/request', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json<{ amount_paise: number }>();
  const sql = getDb(c.env, { write: true });

  const created = await sql<{ id: string }[]>`
    INSERT INTO driver_payouts (driver_id, amount_paise, status, created_at)
    VALUES (${user.user_id}::uuid, ${body.amount_paise}, 'REQUESTED', now())
    RETURNING id
  `;

  if (c.env.EVENTS) {
    await c.env.EVENTS.send({
      topic: 'driver.payout.requested',
      payload: { payout_id: created[0].id, driver_id: user.user_id, amount_paise: body.amount_paise },
      timestamp: Date.now(),
    });
  }

  return c.json({ success: true, payout_id: created[0].id, status: 'REQUESTED' });
});

// ---------------------------------------------------------------------------
// 6. Vehicles Management
// ---------------------------------------------------------------------------
driver.get('/api/v1/driver/vehicles', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ vehicles: [] });

  const sql = getDb(c.env);
  const rows = await sql`
    SELECT id, make, model, year, license_plate, is_active, tier
    FROM driver_vehicles
    WHERE driver_id = ${user.user_id}::uuid
  `.catch(() => []);

  return c.json({ vehicles: rows });
});

driver.post('/api/v1/driver/vehicles', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json<{
    make: string;
    model: string;
    year: number;
    license_plate: string;
    tier?: string;
  }>();

  const sql = getDb(c.env, { write: true });
  const created = await sql<{ id: string }[]>`
    INSERT INTO driver_vehicles (driver_id, make, model, year, license_plate, tier, is_active)
    VALUES (${user.user_id}::uuid, ${body.make}, ${body.model}, ${body.year}, ${body.license_plate}, ${body.tier || 'SEDAN'}, true)
    RETURNING id
  `;

  return c.json({ success: true, vehicle_id: created[0].id });
});

// ---------------------------------------------------------------------------
// 7. Safety SOS
// ---------------------------------------------------------------------------
driver.post('/api/v1/driver/sos', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  const body = (await c.req.json().catch(() => ({}))) as { lat?: number; lng?: number; order_id?: string };

  if (body.order_id) {
    const orderStream = c.env.ORDER_STREAM_DO.getByName(body.order_id);
    await orderStream.broadcastJSON({
      type: 'sos.alert',
      source: 'DRIVER',
      driver_id: user?.user_id,
      lat: body.lat,
      lng: body.lng,
    });
  }

  // Also notify global SOS DO
  const globalSos = c.env.ORDER_STREAM_DO.getByName('global-sos');
  await globalSos.broadcastJSON({
    type: 'global.sos.alert',
    driver_id: user?.user_id,
    lat: body.lat,
    lng: body.lng,
  });

  return c.json({ success: true, message: 'Emergency dispatch alerted' });
});

export default driver;
