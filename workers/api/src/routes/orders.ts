import { Hono } from 'hono';
import * as h3 from 'h3-js';
import type { Env, AuthClaims } from '../types';
import { getDb } from '../services/db';
import { getRoute } from '../services/maps';
import { calculateFare } from '../services/pricing';

const orders = new Hono<{ Bindings: Env; Variables: { user?: AuthClaims } }>();

// ---------------------------------------------------------------------------
// 1. Quotes and Fare Estimates
// ---------------------------------------------------------------------------
orders.get('/api/v1/pricing/quote', async (c) => {
  const pickupLat = parseFloat(c.req.query('pickup_lat') || '0');
  const pickupLng = parseFloat(c.req.query('pickup_lng') || '0');
  const dropLat = parseFloat(c.req.query('drop_lat') || '0');
  const dropLng = parseFloat(c.req.query('drop_lng') || '0');
  const city = c.req.query('city_prefix') || c.env.CITY_PREFIX || 'KOL';
  const tier = c.req.query('vehicle_tier') || 'SEDAN';

  const route = await getRoute(c.env, pickupLat, pickupLng, dropLat, dropLng, city);
  const pickupH3 = h3.latLngToCell(pickupLat, pickupLng, 9);
  const fare = await calculateFare(c.env, city, pickupH3, route.distance_km, route.duration_minutes, tier);

  return c.json({
    quote_id: crypto.randomUUID(),
    city_prefix: city,
    distance_km: route.distance_km,
    duration_minutes: route.duration_minutes,
    fare_paise: fare.total_fare_paise,
    fare_breakdown: fare,
    expires_at: Date.now() + 300 * 1000,
  });
});

orders.post('/api/v1/orders/quote', async (c) => {
  const body = await c.req.json<{
    pickup_lat: number;
    pickup_lng: number;
    dropoff_lat: number;
    dropoff_lng: number;
    city_prefix?: string;
    vehicle_tier?: string;
  }>();

  const city = body.city_prefix || c.env.CITY_PREFIX || 'KOL';
  const route = await getRoute(c.env, body.pickup_lat, body.pickup_lng, body.dropoff_lat, body.dropoff_lng, city);
  const pickupH3 = h3.latLngToCell(body.pickup_lat, body.pickup_lng, 9);
  const fare = await calculateFare(c.env, city, pickupH3, route.distance_km, route.duration_minutes, body.vehicle_tier || 'SEDAN');

  return c.json({
    quote_id: crypto.randomUUID(),
    city_prefix: city,
    distance_km: route.distance_km,
    duration_minutes: route.duration_minutes,
    fare_paise: fare.total_fare_paise,
    fare_breakdown: fare,
    expires_at: Date.now() + 300 * 1000,
  });
});

orders.post('/api/v1/rider/fare-estimate', async (c) => {
  const body = await c.req.json<{
    pickup_lat: number;
    pickup_lng: number;
    dropoff_lat: number;
    dropoff_lng: number;
    vehicle_tier?: string;
  }>();

  const city = c.env.CITY_PREFIX || 'KOL';
  const route = await getRoute(c.env, body.pickup_lat, body.pickup_lng, body.dropoff_lat, body.dropoff_lng, city);
  const pickupH3 = h3.latLngToCell(body.pickup_lat, body.pickup_lng, 9);
  const fare = await calculateFare(c.env, city, pickupH3, route.distance_km, route.duration_minutes, body.vehicle_tier || 'SEDAN');

  return c.json({
    distance_km: route.distance_km,
    duration_minutes: route.duration_minutes,
    total_fare_paise: fare.total_fare_paise,
    fare_breakdown: fare,
  });
});

// ---------------------------------------------------------------------------
// 2. Order Creation
// ---------------------------------------------------------------------------
async function handleCreateOrder(c: any) {
  const user = c.get('user') as AuthClaims | undefined;
  const customerId = user?.user_id || 'c81d4e2e-bcf2-11e6-869b-7df243852131';

  const body = (await c.req.json()) as {
    pickup_lat: number;
    pickup_lng: number;
    dropoff_lat: number;
    dropoff_lng: number;
    pickup_address?: string;
    dropoff_address?: string;
    city_prefix?: string;
    vehicle_tier?: string;
  };

  const city = body.city_prefix || c.env.CITY_PREFIX || 'KOL';
  const pickupH3 = h3.latLngToCell(body.pickup_lat, body.pickup_lng, 9);
  const route = await getRoute(c.env, body.pickup_lat, body.pickup_lng, body.dropoff_lat, body.dropoff_lng, city);
  const fare = await calculateFare(c.env, city, pickupH3, route.distance_km, route.duration_minutes, body.vehicle_tier || 'SEDAN');

  const orderId = crypto.randomUUID();
  const shareToken = crypto.randomUUID().slice(0, 12);
  const otp = Math.floor(1000 + Math.random() * 9000).toString();

  const sql = getDb(c.env, { write: true });
  await sql`
    INSERT INTO orders (
      id,
      city_prefix,
      customer_id,
      status,
      pickup_location,
      dropoff_location,
      pickup_h3_cell,
      surge_multiplier,
      base_fare_paise,
      total_fare_paise,
      start_otp,
      share_token,
      created_at
    )
    VALUES (
      ${orderId}::uuid,
      ${city},
      ${customerId}::uuid,
      'CREATED',
      ST_SetSRID(ST_MakePoint(${body.pickup_lng}, ${body.pickup_lat}), 4326)::geography,
      ST_SetSRID(ST_MakePoint(${body.dropoff_lng}, ${body.dropoff_lat}), 4326)::geography,
      ${pickupH3},
      ${fare.surge_multiplier},
      ${fare.base_fare_paise},
      ${fare.total_fare_paise},
      ${otp},
      ${shareToken},
      now()
    )
  `;

  // Send domain event to Queue
  if (c.env.EVENTS) {
    await c.env.EVENTS.send({
      topic: 'order.created',
      payload: {
        order_id: orderId,
        customer_id: customerId,
        city_prefix: city,
        pickup_lat: body.pickup_lat,
        pickup_lng: body.pickup_lng,
        pickup_h3: pickupH3,
        vehicle_tier: body.vehicle_tier || 'SEDAN',
        fare_paise: fare.total_fare_paise,
      },
      timestamp: Date.now(),
    });
  }

  return c.json({
    success: true,
    order_id: orderId,
    status: 'SEARCHING',
    start_otp: otp,
    share_token: shareToken,
    fare_paise: fare.total_fare_paise,
    distance_km: route.distance_km,
    duration_minutes: route.duration_minutes,
  }, 201);
}

orders.post('/api/v1/orders', handleCreateOrder);
orders.post('/api/v1/rider/orders', handleCreateOrder);

// ---------------------------------------------------------------------------
// 3. Active Order and Trip History
// ---------------------------------------------------------------------------
orders.get('/api/v1/rider/orders/active', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ order: null });

  const sql = getDb(c.env);
  const rows = await sql`
    SELECT
      o.id,
      o.status,
      o.city_prefix,
      o.base_fare_paise,
      o.total_fare_paise,
      o.start_otp,
      o.share_token,
      o.driver_id,
      d.name as driver_name,
      d.phone as driver_phone,
      d.rating as driver_rating,
      ST_Y(o.pickup_location::geometry) as pickup_lat,
      ST_X(o.pickup_location::geometry) as pickup_lng,
      ST_Y(o.dropoff_location::geometry) as dropoff_lat,
      ST_X(o.dropoff_location::geometry) as dropoff_lng
    FROM orders o
    LEFT JOIN drivers d ON o.driver_id = d.id
    WHERE o.customer_id = ${user.user_id}::uuid
      AND o.status IN ('CREATED', 'ASSIGNED', 'ARRIVED', 'IN_TRANSIT')
    ORDER BY o.created_at DESC
    LIMIT 1
  `;

  if (rows.length === 0) {
    return c.json({ order: null });
  }

  return c.json({ order: rows[0] });
});

orders.get('/api/v1/rider/orders', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ trips: [] });

  const sql = getDb(c.env);
  const rows = await sql`
    SELECT
      o.id,
      o.status,
      o.total_fare_paise,
      o.created_at,
      o.driver_id,
      d.name as driver_name,
      ST_Y(o.pickup_location::geometry) as pickup_lat,
      ST_X(o.pickup_location::geometry) as pickup_lng,
      ST_Y(o.dropoff_location::geometry) as dropoff_lat,
      ST_X(o.dropoff_location::geometry) as dropoff_lng
    FROM orders o
    LEFT JOIN drivers d ON o.driver_id = d.id
    WHERE o.customer_id = ${user.user_id}::uuid
    ORDER BY o.created_at DESC
    LIMIT 20
  `;

  return c.json({ trips: rows });
});

orders.delete('/api/v1/rider/orders/:orderId/cancel', async (c) => {
  const orderId = c.req.param('orderId');
  const user = c.get('user') as AuthClaims | undefined;
  const sql = getDb(c.env, { write: true });

  const rows = await sql<{ id: string; driver_id: string | null; city_prefix: string }[]>`
    UPDATE orders
    SET status = 'CANCELLED',
        cancelled_at = now(),
        cancelled_by = 'RIDER'
    WHERE id = ${orderId}::uuid
    RETURNING id, driver_id, city_prefix
  `;

  if (rows.length === 0) {
    return c.json({ success: false, error: 'Order not found' }, 404);
  }

  const order = rows[0];
  if (c.env.EVENTS) {
    await c.env.EVENTS.send({
      topic: 'order.cancelled',
      payload: {
        order_id: orderId,
        driver_id: order.driver_id,
        rider_id: user?.user_id,
        city_prefix: order.city_prefix,
        cancelled_by: 'RIDER',
      },
      timestamp: Date.now(),
    });
  }

  return c.json({ success: true, message: 'Order cancelled' });
});

orders.get('/api/v1/trip-share/:shareToken', async (c) => {
  const shareToken = c.req.param('shareToken');
  const sql = getDb(c.env);

  const rows = await sql`
    SELECT
      o.id,
      o.status,
      ST_Y(o.pickup_location::geometry) as pickup_lat,
      ST_X(o.pickup_location::geometry) as pickup_lng,
      ST_Y(o.dropoff_location::geometry) as dropoff_lat,
      ST_X(o.dropoff_location::geometry) as dropoff_lng,
      d.name as driver_name,
      d.rating as driver_rating
    FROM orders o
    LEFT JOIN drivers d ON o.driver_id = d.id
    WHERE o.share_token = ${shareToken}
    LIMIT 1
  `;

  if (rows.length === 0) {
    return c.json({ error: 'Trip not found' }, 404);
  }

  return c.json({ trip: rows[0] });
});

export default orders;
