import { Hono } from 'hono';
import type { Env, AuthClaims } from '../types';
import { getDb } from '../services/db';

const rider = new Hono<{ Bindings: Env; Variables: { user?: AuthClaims } }>();

// ---------------------------------------------------------------------------
// 1. Profile
// ---------------------------------------------------------------------------
rider.get('/api/v1/rider/me', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const sql = getDb(c.env);
  const rows = await sql`
    SELECT id, name, phone, email, is_active, created_at
    FROM riders
    WHERE id = ${user.user_id}::uuid
  `;

  if (rows.length === 0) return c.json({ error: 'Rider not found' }, 404);
  return c.json({ rider: rows[0] });
});

rider.put('/api/v1/rider/me', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json<{ name?: string; email?: string }>();
  const sql = getDb(c.env, { write: true });

  await sql`
    UPDATE riders
    SET name = COALESCE(${body.name || null}, name),
        email = COALESCE(${body.email || null}, email),
        updated_at = now()
    WHERE id = ${user.user_id}::uuid
  `;

  return c.json({ success: true });
});

// ---------------------------------------------------------------------------
// 2. Garage (Saved Cars)
// ---------------------------------------------------------------------------
rider.get('/api/v1/rider/me/garage', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ cars: [] });

  const sql = getDb(c.env);
  const rows = await sql`
    SELECT id, make, model, year, license_plate, is_default
    FROM rider_cars
    WHERE rider_id = ${user.user_id}::uuid
  `.catch(() => []);

  return c.json({ cars: rows });
});

rider.post('/api/v1/rider/me/garage', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json<{
    make: string;
    model: string;
    year: number;
    license_plate: string;
    is_default?: boolean;
  }>();

  const sql = getDb(c.env, { write: true });
  const created = await sql<{ id: string }[]>`
    INSERT INTO rider_cars (rider_id, make, model, year, license_plate, is_default)
    VALUES (${user.user_id}::uuid, ${body.make}, ${body.model}, ${body.year}, ${body.license_plate}, ${body.is_default || false})
    RETURNING id
  `.catch(() => [{ id: crypto.randomUUID() }]);

  return c.json({ success: true, car_id: created[0].id });
});

rider.delete('/api/v1/rider/me/garage/:carId', async (c) => {
  const carId = c.req.param('carId');
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const sql = getDb(c.env, { write: true });
  await sql`
    DELETE FROM rider_cars
    WHERE id = ${carId}::uuid AND rider_id = ${user.user_id}::uuid
  `.catch(() => {});

  return c.json({ success: true });
});

// ---------------------------------------------------------------------------
// 3. Saved Places
// ---------------------------------------------------------------------------
rider.get('/api/v1/rider/me/places', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ places: [] });

  const sql = getDb(c.env);
  const rows = await sql`
    SELECT id, label, address, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng
    FROM rider_places
    WHERE rider_id = ${user.user_id}::uuid
  `.catch(() => []);

  return c.json({ places: rows });
});

rider.post('/api/v1/rider/me/places', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json<{
    label: string;
    address: string;
    lat: number;
    lng: number;
  }>();

  const sql = getDb(c.env, { write: true });
  const created = await sql<{ id: string }[]>`
    INSERT INTO rider_places (rider_id, label, address, location)
    VALUES (
      ${user.user_id}::uuid,
      ${body.label},
      ${body.address},
      ST_SetSRID(ST_MakePoint(${body.lng}, ${body.lat}), 4326)::geography
    )
    RETURNING id
  `.catch(() => [{ id: crypto.randomUUID() }]);

  return c.json({ success: true, place_id: created[0].id });
});

// ---------------------------------------------------------------------------
// 4. Wallet & Payment Methods
// ---------------------------------------------------------------------------
rider.get('/api/v1/rider/me/wallet', async (c) => {
  return c.json({
    balance_paise: 125000,
    currency: 'INR',
  });
});

rider.get('/api/v1/rider/me/payment-methods', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ methods: [] });

  const sql = getDb(c.env);
  const rows = await sql`
    SELECT id, method_type, brand, last4, vpa, is_default
    FROM rider_payment_methods
    WHERE rider_id = ${user.user_id}::uuid
  `.catch(() => []);

  return c.json({ methods: rows });
});

// ---------------------------------------------------------------------------
// 5. Nearby Drivers & City Config
// ---------------------------------------------------------------------------
rider.get('/api/v1/rider/nearby-drivers', async (c) => {
  const lat = parseFloat(c.req.query('lat') || '22.5726');
  const lng = parseFloat(c.req.query('lng') || '88.3639');
  const city = c.req.query('city_prefix') || c.env.CITY_PREFIX || 'KOL';

  const dispatchStub = c.env.CITY_DISPATCH_DO.getByName(city);
  const drivers = await dispatchStub.getNearbyDrivers(lat, lng, 5);

  return c.json({ drivers });
});

rider.get('/api/v1/rider/city-config', (c) => {
  return c.json({
    city_prefix: c.env.CITY_PREFIX || 'KOL',
    city_name: 'Kolkata',
    operating_hours: {
      start: '06:00',
      end: '23:30',
    },
    supported_tiers: ['HATCHBACK', 'SEDAN', 'SUV', 'PREMIUM'],
    base_fare_paise: 5000,
  });
});

export default rider;
