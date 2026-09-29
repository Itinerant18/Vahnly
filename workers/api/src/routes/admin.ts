import { Hono } from 'hono';
import type { Env, AuthClaims } from '../types';
import { getDb } from '../services/db';

const admin = new Hono<{ Bindings: Env; Variables: { user?: AuthClaims } }>();

// ---------------------------------------------------------------------------
// 1. Control Room & Orders
// ---------------------------------------------------------------------------
admin.get('/api/v1/admin/orders', async (c) => {
  const sql = getDb(c.env);
  const status = c.req.query('status');

  let rows;
  if (status) {
    rows = await sql`
      SELECT o.id, o.city_prefix, o.customer_id, o.driver_id, o.status, o.total_fare_paise, o.created_at
      FROM orders o
      WHERE o.status = ${status}
      ORDER BY o.created_at DESC
      LIMIT 50
    `;
  } else {
    rows = await sql`
      SELECT o.id, o.city_prefix, o.customer_id, o.driver_id, o.status, o.total_fare_paise, o.created_at
      FROM orders o
      ORDER BY o.created_at DESC
      LIMIT 50
    `;
  }

  return c.json({ orders: rows });
});

admin.get('/api/v1/admin/orders/:id', async (c) => {
  const orderId = c.req.param('id');
  const sql = getDb(c.env);

  const rows = await sql`
    SELECT
      o.id,
      o.city_prefix,
      o.customer_id,
      o.driver_id,
      o.status,
      o.base_fare_paise,
      o.total_fare_paise,
      o.surge_multiplier,
      o.start_otp,
      o.created_at,
      o.started_at,
      o.completed_at,
      d.name as driver_name,
      d.phone as driver_phone,
      r.name as rider_name,
      r.phone as rider_phone
    FROM orders o
    LEFT JOIN drivers d ON o.driver_id = d.id
    LEFT JOIN riders r ON o.customer_id = r.id
    WHERE o.id = ${orderId}::uuid
  `;

  if (rows.length === 0) {
    return c.json({ error: 'Order not found' }, 404);
  }

  return c.json({ order: rows[0] });
});

admin.post('/api/v1/admin/orders/cancel', async (c) => {
  const body = await c.req.json<{ order_id: string; reason?: string }>();
  const sql = getDb(c.env, { write: true });

  const rows = await sql<{ id: string; driver_id: string | null; city_prefix: string }[]>`
    UPDATE orders
    SET status = 'CANCELLED',
        cancelled_at = now(),
        cancelled_by = 'ADMIN'
    WHERE id = ${body.order_id}::uuid
    RETURNING id, driver_id, city_prefix
  `;

  if (rows.length === 0) return c.json({ error: 'Order not found' }, 404);

  if (c.env.EVENTS) {
    await c.env.EVENTS.send({
      topic: 'order.cancelled',
      payload: {
        order_id: body.order_id,
        driver_id: rows[0].driver_id,
        city_prefix: rows[0].city_prefix,
        cancelled_by: 'ADMIN',
        reason: body.reason || 'Admin cancelled',
      },
      timestamp: Date.now(),
    });
  }

  return c.json({ success: true, message: 'Trip cancelled by admin' });
});

// ---------------------------------------------------------------------------
// 2. Financial Ledger & Pricing
// ---------------------------------------------------------------------------
admin.get('/api/v1/admin/ledger', async (c) => {
  const sql = getDb(c.env);
  const rows = await sql`
    SELECT id, entry_type, amount_paise, reference_id, description, created_at
    FROM ledger_entries
    ORDER BY created_at DESC
    LIMIT 100
  `.catch(() => []);

  return c.json({ entries: rows });
});

admin.get('/api/v1/admin/pricing/fares', async (c) => {
  return c.json({
    fares: [
      { tier: 'HATCHBACK', base_fare_paise: 4000, per_km_paise: 1200, per_minute_paise: 150 },
      { tier: 'SEDAN', base_fare_paise: 5000, per_km_paise: 1500, per_minute_paise: 200 },
      { tier: 'SUV', base_fare_paise: 8000, per_km_paise: 2200, per_minute_paise: 250 },
      { tier: 'PREMIUM', base_fare_paise: 10000, per_km_paise: 2800, per_minute_paise: 300 },
    ],
  });
});

admin.post('/api/v1/admin/pricing/freeze', async (c) => {
  const body = await c.req.json<{ city_prefix: string; cap_multiplier: number }>();
  if (c.env.CONFIG) {
    await c.env.CONFIG.put(`freeze:${body.city_prefix}`, String(body.cap_multiplier));
  }
  return c.json({ success: true, city: body.city_prefix, cap: body.cap_multiplier });
});

// ---------------------------------------------------------------------------
// 3. Driver Override
// ---------------------------------------------------------------------------
admin.post('/api/v1/admin/drivers/override', async (c) => {
  const body = await c.req.json<{ driver_id: string; status: string }>();
  const sql = getDb(c.env, { write: true });

  await sql`
    UPDATE drivers
    SET current_state = ${body.status},
        updated_at = now()
    WHERE id = ${body.driver_id}::uuid
  `;

  const city = c.env.CITY_PREFIX || 'KOL';
  const dispatchStub = c.env.CITY_DISPATCH_DO.getByName(city);
  await dispatchStub.setDriverStatus(body.driver_id, body.status);

  return c.json({ success: true, driver_id: body.driver_id, status: body.status });
});

export default admin;
