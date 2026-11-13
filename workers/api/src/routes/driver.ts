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
  const rows = await sql<{
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
  }[]>`
    SELECT id, name, phone, email, city_prefix, is_verified, current_state, rating, acceptance_rate, onboarding_data
    FROM drivers
    WHERE id = ${user.user_id}::uuid
  `;

  if (rows.length === 0) return c.json({ error: 'Driver not found' }, 404);
  const d = rows[0];
  const emergencyContact = d.onboarding_data?.emergency_contact || null;

  return c.json({
    driver: {
      ...d,
      emergency_contact: emergencyContact,
    },
    ...d,
    emergency_contact: emergencyContact,
  });
});

driver.patch('/api/v1/driver/profile/emergency-contact', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  if (user.role !== 'DRIVER' && user.role !== 'ADMIN') {
    return c.json({ error: 'forbidden: requires driver or admin role' }, 403);
  }

  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    relation?: string;
    phone?: string;
  };

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const relation = typeof body.relation === 'string' ? body.relation.trim() : '';

  if (!name || !phone) {
    return c.json({ error: 'Name and phone number are required' }, 400);
  }

  const digitsOnly = phone.replace(/\D/g, '');
  if (digitsOnly.length < 10) {
    return c.json({ error: 'Please provide a valid phone number with at least 10 digits' }, 400);
  }

  const contactData = { name, relation, phone };
  const sql = getDb(c.env, { write: true });

  await sql`
    UPDATE drivers
    SET onboarding_data = jsonb_set(
      COALESCE(onboarding_data, '{}'::jsonb),
      '{emergency_contact}',
      ${JSON.stringify(contactData)}::jsonb
    ),
    updated_at = now()
    WHERE id = ${user.user_id}::uuid
  `;

  return c.json({
    emergency_contact: contactData,
  });
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
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  if (user.role !== 'DRIVER' && user.role !== 'ADMIN') {
    return c.json({ error: 'forbidden: requires driver or admin role' }, 403);
  }

  const orderId = c.req.param('id');
  const sql = getDb(c.env, { write: true });

  const rows = await sql<{ id: string; driver_id: string | null; status: string }[]>`
    SELECT id, driver_id, status FROM orders WHERE id = ${orderId}::uuid
  `;

  if (rows.length === 0) return c.json({ error: 'Order not found' }, 404);
  const order = rows[0];

  if (order.driver_id !== user.user_id && user.role !== 'ADMIN') {
    return c.json({ error: 'forbidden: not assigned driver for this order' }, 403);
  }

  if (order.status === 'ARRIVED') {
    return c.json({ success: true, status: 'ARRIVED' }); // Idempotent replay
  }

  if (order.status !== 'ASSIGNED' && order.status !== 'EN_ROUTE_TO_PICKUP') {
    return c.json({
      error: `invalid order state: order must be ASSIGNED or EN_ROUTE_TO_PICKUP to arrive (current: ${order.status})`,
      status: order.status,
    }, 400);
  }

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
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  if (user.role !== 'DRIVER' && user.role !== 'ADMIN') {
    return c.json({ error: 'forbidden: requires driver or admin role' }, 403);
  }

  const orderId = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as {
    otp?: string;
    start_odometer?: number;
    fuel_percentage?: number;
    car_plate?: string;
  };

  const otp = typeof body.otp === 'string' ? body.otp.trim() : '';
  if (!otp) {
    return c.json({ success: false, error: 'OTP is required' }, 400);
  }

  const sql = getDb(c.env, { write: true });

  const rows = await sql<{
    id: string;
    start_otp: string;
    status: string;
    driver_id: string | null;
    otp_attempts: number;
  }[]>`
    SELECT id, start_otp, status, driver_id, COALESCE(otp_attempts, 0) as otp_attempts
    FROM orders
    WHERE id = ${orderId}::uuid
  `;

  if (rows.length === 0) return c.json({ error: 'Order not found' }, 404);
  const order = rows[0];

  // 1. Ownership authorization: must be the assigned driver or admin
  if (order.driver_id !== user.user_id && user.role !== 'ADMIN') {
    return c.json({ error: 'forbidden: not assigned driver for this order' }, 403);
  }

  // 2. Permitted state check
  if (order.status === 'IN_TRANSIT') {
    return c.json({ error: 'trip already in transit', status: 'IN_TRANSIT' }, 409);
  }

  if (order.status !== 'ARRIVED') {
    return c.json({
      error: `invalid order state: order must be in ARRIVED status to start trip (current: ${order.status})`,
      status: order.status,
    }, 400);
  }

  // 3. Brute force / attempt lockout protection (max 3 failed attempts)
  if (order.otp_attempts >= 3) {
    return c.json({
      success: false,
      error: 'too_many_otp_attempts: OTP locked after 3 failed attempts',
      locked: true,
    }, 403);
  }

  // 4. Challenge verification (Strict match against order-specific challenge, NO bypass)
  if (order.start_otp !== otp) {
    const nextAttempts = order.otp_attempts + 1;
    await sql`
      UPDATE orders
      SET otp_attempts = ${nextAttempts}
      WHERE id = ${orderId}::uuid
    `;

    return c.json({
      success: false,
      error: 'invalid OTP',
      remaining_attempts: Math.max(0, 3 - nextAttempts),
      locked: nextAttempts >= 3,
    }, 400);
  }

  // 5. Successful verification: transition to IN_TRANSIT, reset attempts
  await sql`
    UPDATE orders
    SET status = 'IN_TRANSIT',
        started_at = now(),
        otp_attempts = 0
    WHERE id = ${orderId}::uuid
      AND status = 'ARRIVED'
      AND (driver_id = ${user.user_id}::uuid OR ${user.role} = 'ADMIN')
  `;

  // Persist START odometer checkpoint if provided
  if (typeof body.start_odometer === 'number' && body.start_odometer >= 0) {
    try {
      await sql`
        INSERT INTO trip_odometer_checkpoints (
          order_id, checkpoint_type, odometer_value, fuel_percentage, photo_url, created_by
        )
        VALUES (
          ${orderId}::uuid,
          ${'START'},
          ${Math.floor(body.start_odometer)},
          ${Math.min(100, Math.max(0, Math.floor(body.fuel_percentage || 0)))},
          '',
          ${user.user_id}::uuid
        )
        ON CONFLICT (order_id, checkpoint_type) DO UPDATE
        SET odometer_value = EXCLUDED.odometer_value,
            fuel_percentage = EXCLUDED.fuel_percentage,
            captured_at = now()
      `;
    } catch (checkpointErr) {
      console.warn('[driver] Failed to persist START odometer checkpoint:', checkpointErr);
    }
  }

  const orderStream = c.env.ORDER_STREAM_DO.getByName(orderId);
  await orderStream.broadcastJSON({
    type: 'trip.started',
    order_id: orderId,
  });

  return c.json({ success: true, status: 'IN_TRANSIT' });
});

driver.patch('/api/v1/driver/orders/:id/end', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  if (user.role !== 'DRIVER' && user.role !== 'ADMIN') {
    return c.json({ error: 'forbidden: requires driver or admin role' }, 403);
  }

  const orderId = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as {
    odometer_reading?: number;
    fuel_level?: number;
    photo_url?: string;
  };

  const sql = getDb(c.env, { write: true });

  const rows = await sql<{
    id: string;
    driver_id: string | null;
    status: string;
    total_fare_paise: number;
    city_prefix: string;
  }[]>`
    SELECT id, driver_id, status, total_fare_paise, city_prefix
    FROM orders
    WHERE id = ${orderId}::uuid
  `;

  if (rows.length === 0) return c.json({ error: 'Order not found' }, 404);
  const order = rows[0];

  if (order.driver_id !== user.user_id && user.role !== 'ADMIN') {
    return c.json({ error: 'forbidden: not assigned driver for this order' }, 403);
  }

  if (order.status === 'COMPLETED') {
    return c.json({
      success: true,
      status: 'COMPLETED',
      total_fare_paise: order.total_fare_paise,
      order_id: orderId,
    });
  }

  if (order.status !== 'IN_TRANSIT') {
    return c.json({
      error: `invalid order state: order must be IN_TRANSIT to end trip (current: ${order.status})`,
      status: order.status,
    }, 400);
  }

  // Validate end odometer against start checkpoint if present
  if (typeof body.odometer_reading === 'number') {
    if (body.odometer_reading < 0) {
      return c.json({ error: 'odometer_reading cannot be negative' }, 400);
    }

    const startCheckpoint = await sql<{ odometer_value: number }[]>`
      SELECT odometer_value FROM trip_odometer_checkpoints
      WHERE order_id = ${orderId}::uuid AND checkpoint_type = ${'START'}
      LIMIT 1
    `.catch(() => []);

    if (startCheckpoint.length > 0 && body.odometer_reading < startCheckpoint[0].odometer_value) {
      return c.json({
        error: `invalid_odometer: end odometer (${body.odometer_reading}) cannot be less than start odometer (${startCheckpoint[0].odometer_value})`,
        start_odometer: startCheckpoint[0].odometer_value,
      }, 400);
    }
  }

  const updated = await sql<{ total_fare_paise: number; city_prefix: string }[]>`
    UPDATE orders
    SET status = 'COMPLETED',
        completed_at = now()
    WHERE id = ${orderId}::uuid
      AND status = 'IN_TRANSIT'
    RETURNING total_fare_paise, city_prefix
  `;

  if (updated.length === 0) {
    return c.json({ error: 'Failed to complete order or order already completed' }, 409);
  }

  // Persist END odometer checkpoint if provided
  if (typeof body.odometer_reading === 'number') {
    try {
      await sql`
        INSERT INTO trip_odometer_checkpoints (
          order_id, checkpoint_type, odometer_value, fuel_percentage, photo_url, created_by
        )
        VALUES (
          ${orderId}::uuid,
          ${'END'},
          ${Math.floor(body.odometer_reading)},
          ${Math.min(100, Math.max(0, Math.floor(body.fuel_level || 0)))},
          ${body.photo_url || ''},
          ${user.user_id}::uuid
        )
        ON CONFLICT (order_id, checkpoint_type) DO UPDATE
        SET odometer_value = EXCLUDED.odometer_value,
            fuel_percentage = EXCLUDED.fuel_percentage,
            photo_url = EXCLUDED.photo_url,
            captured_at = now()
      `;
    } catch (checkpointErr) {
      console.warn('[driver] Failed to persist END odometer checkpoint:', checkpointErr);
    }
  }

  // Return driver to ONLINE_AVAILABLE
  const city = updated[0].city_prefix || c.env.CITY_PREFIX || 'KOL';
  const dispatchStub = c.env.CITY_DISPATCH_DO.getByName(city);
  await dispatchStub.setDriverStatus(user.user_id, 'ONLINE_AVAILABLE');

  const orderStream = c.env.ORDER_STREAM_DO.getByName(orderId);
  await orderStream.broadcastJSON({
    type: 'trip.completed',
    order_id: orderId,
    total_fare_paise: updated[0].total_fare_paise,
  });

  return c.json({
    success: true,
    status: 'COMPLETED',
    total_fare_paise: updated[0].total_fare_paise,
    order_id: orderId,
  });
});

// ---------------------------------------------------------------------------
// 4b. In-Transit Order Events (Tolls, Parking, Wait Timers)
// ---------------------------------------------------------------------------
driver.post('/api/v1/driver/orders/:id/events', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  if (user.role !== 'DRIVER' && user.role !== 'ADMIN') {
    return c.json({ error: 'forbidden: requires driver or admin role' }, 403);
  }

  const orderId = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as {
    type?: string;
    toll_amount_paise?: number;
    parking_amount_paise?: number;
    notes?: string;
  };

  const allowedTypes = ['TOLL', 'PARKING', 'WAIT_START', 'WAIT_RESUME', 'CAR_ISSUE'];
  if (!body.type || !allowedTypes.includes(body.type)) {
    return c.json({ error: `invalid event type: must be one of ${allowedTypes.join(', ')}` }, 400);
  }

  const tollPaise = Math.max(0, Math.floor(body.toll_amount_paise || 0));
  const parkingPaise = Math.max(0, Math.floor(body.parking_amount_paise || 0));
  const addedPaise = tollPaise + parkingPaise;

  // Upper bound safety check: single expense cannot exceed ₹5,000 (500,000 paise)
  if (addedPaise > 500000) {
    return c.json({ error: 'expense amount exceeds single-transaction limit of 500,000 paise (₹5,000)' }, 400);
  }

  const sql = getDb(c.env, { write: true });
  const rows = await sql<{ id: string; driver_id: string | null; status: string; total_fare_paise: number }[]>`
    SELECT id, driver_id, status, total_fare_paise FROM orders WHERE id = ${orderId}::uuid
  `;

  if (rows.length === 0) return c.json({ error: 'Order not found' }, 404);
  const order = rows[0];

  if (order.driver_id !== user.user_id && user.role !== 'ADMIN') {
    return c.json({ error: 'forbidden: not assigned driver for this order' }, 403);
  }

  if (order.status !== 'IN_TRANSIT' && order.status !== 'ARRIVED') {
    return c.json({
      error: `cannot record in-transit event for order in ${order.status} state`,
      status: order.status,
    }, 400);
  }

  if (addedPaise > 0) {
    await sql`
      UPDATE orders
      SET total_fare_paise = total_fare_paise + ${addedPaise}
      WHERE id = ${orderId}::uuid
    `;
  }

  const orderStream = c.env.ORDER_STREAM_DO.getByName(orderId);
  await orderStream.broadcastJSON({
    type: 'order.expense_added',
    order_id: orderId,
    event_type: body.type,
    amount_paise: addedPaise,
    notes: body.notes || '',
  });

  return c.json({
    success: true,
    message: 'Event recorded successfully',
    event_type: body.type,
    added_paise: addedPaise,
    new_total_fare_paise: order.total_fare_paise + addedPaise,
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
// 4c. Odometer & Vehicle Checkpoints
// ---------------------------------------------------------------------------
driver.post('/api/v1/driver/orders/:id/odometer', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  if (user.role !== 'DRIVER' && user.role !== 'ADMIN') {
    return c.json({ error: 'forbidden: requires driver or admin role' }, 403);
  }

  const orderId = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as {
    checkpoint_type?: 'START' | 'END';
    odometer_reading?: number;
    fuel_level?: number;
    photo_url?: string;
    timestamp?: string;
  };

  if (body.checkpoint_type !== 'START' && body.checkpoint_type !== 'END') {
    return c.json({ error: "checkpoint_type must be 'START' or 'END'" }, 400);
  }

  if (typeof body.odometer_reading !== 'number' || body.odometer_reading < 0) {
    return c.json({ error: 'valid positive odometer_reading is required' }, 400);
  }

  const fuelLevel = Math.min(100, Math.max(0, Math.floor(body.fuel_level || 0)));
  const sql = getDb(c.env, { write: true });

  const orderRows = await sql<{ driver_id: string | null; status: string }[]>`
    SELECT driver_id, status FROM orders WHERE id = ${orderId}::uuid
  `;
  if (orderRows.length === 0) return c.json({ error: 'Order not found' }, 404);
  if (orderRows[0].driver_id !== user.user_id && user.role !== 'ADMIN') {
    return c.json({ error: 'forbidden: not assigned driver for this order' }, 403);
  }

  if (body.checkpoint_type === 'END') {
    const startRows = await sql<{ odometer_value: number }[]>`
      SELECT odometer_value FROM trip_odometer_checkpoints
      WHERE order_id = ${orderId}::uuid AND checkpoint_type = 'START'
      LIMIT 1
    `.catch(() => []);

    if (startRows.length > 0 && body.odometer_reading < startRows[0].odometer_value) {
      return c.json({
        error: `invalid_odometer: end odometer reading (${body.odometer_reading}) cannot be less than start odometer (${startRows[0].odometer_value})`,
      }, 400);
    }
  }

  const upserted = await sql<{ id: string; captured_at: string }[]>`
    INSERT INTO trip_odometer_checkpoints (
      order_id, checkpoint_type, odometer_value, fuel_percentage, photo_url, created_by
    )
    VALUES (
      ${orderId}::uuid,
      ${body.checkpoint_type},
      ${Math.floor(body.odometer_reading)},
      ${fuelLevel},
      ${body.photo_url || ''},
      ${user.user_id}::uuid
    )
    ON CONFLICT (order_id, checkpoint_type) DO UPDATE
    SET odometer_value = EXCLUDED.odometer_value,
        fuel_percentage = EXCLUDED.fuel_percentage,
        photo_url = EXCLUDED.photo_url,
        captured_at = now()
    RETURNING id, captured_at
  `;

  return c.json({
    id: upserted[0]?.id || orderId,
    order_id: orderId,
    checkpoint_type: body.checkpoint_type,
    odometer_reading: body.odometer_reading,
    fuel_level: fuelLevel,
    photo_url: body.photo_url || '',
    captured_at: upserted[0]?.captured_at || new Date().toISOString(),
    status: 'RECORDED',
  });
});

driver.get('/api/v1/driver/orders/:id/odometer', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const orderId = c.req.param('id');
  const sql = getDb(c.env);
  const rows = await sql`
    SELECT id, order_id, checkpoint_type, odometer_value as odometer_reading,
           fuel_percentage as fuel_level, photo_url, captured_at
    FROM trip_odometer_checkpoints
    WHERE order_id = ${orderId}::uuid
    ORDER BY created_at ASC
  `.catch(() => []);

  return c.json({ checkpoints: rows });
});

// ---------------------------------------------------------------------------
// 4d. Dispatch Offer & Acceptance Loop
// ---------------------------------------------------------------------------
driver.get('/api/v1/driver/offer', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  if (user.role !== 'DRIVER' && user.role !== 'ADMIN') {
    return c.json({ error: 'forbidden: requires driver or admin role' }, 403);
  }

  const sql = getDb(c.env);
  const rows = await sql<{
    id: string;
    status: string;
    rider_name: string | null;
    rider_phone: string | null;
    rider_rating: number | null;
    pickup_address: string | null;
    pickup_lat: number;
    pickup_lng: number;
    dropoff_address: string | null;
    dropoff_lat: number;
    dropoff_lng: number;
    base_fare_paise: number;
    surge_multiplier: number | null;
    trip_type: string | null;
    car_type: string | null;
    car_transmission: string | null;
    assigned_at: string | null;
  }[]>`
    SELECT
      o.id,
      o.status,
      r.name as rider_name,
      r.phone as rider_phone,
      4.8 as rider_rating,
      o.pickup_address,
      ST_Y(o.pickup_location::geometry) as pickup_lat,
      ST_X(o.pickup_location::geometry) as pickup_lng,
      o.dropoff_address,
      ST_Y(o.dropoff_location::geometry) as dropoff_lat,
      ST_X(o.dropoff_location::geometry) as dropoff_lng,
      o.base_fare_paise,
      o.surge_multiplier,
      o.trip_type,
      o.one_time_car_type as car_type,
      o.one_time_car_transmission as car_transmission,
      o.assigned_at
    FROM orders o
    LEFT JOIN riders r ON (r.id = o.rider_id OR r.id = o.customer_id)
    WHERE (o.driver_id = ${user.user_id}::uuid OR o.assigned_driver_id = ${user.user_id}::uuid)
      AND o.status IN ('ASSIGNED', 'OFFER_PENDING')
    ORDER BY o.assigned_at DESC NULLS LAST, o.created_at DESC
    LIMIT 1
  `.catch(() => []);

  if (rows.length === 0) {
    return c.json({ order: null });
  }

  const o = rows[0];
  const assignedTime = o.assigned_at ? new Date(o.assigned_at).getTime() : Date.now();
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - assignedTime) / 1000));
  const remainingSeconds = Math.max(1, 15 - elapsedSeconds);

  return c.json({
    order: {
      orderId: o.id,
      riderName: o.rider_name || 'Rider',
      riderPhone: o.rider_phone || '',
      riderRating: Number(o.rider_rating) || 4.8,
      pickup: {
        address: o.pickup_address || 'Pickup Location',
        lat: Number(o.pickup_lat) || 0,
        lng: Number(o.pickup_lng) || 0,
      },
      drop: {
        address: o.dropoff_address || 'Dropoff Location',
        lat: Number(o.dropoff_lat) || 0,
        lng: Number(o.dropoff_lng) || 0,
      },
      fareEstimate: Math.round((o.base_fare_paise || 35000) / 100),
      etaMinutes: 5,
      tripType: (o.trip_type as any) || 'CITY',
      carTypeRequested: o.car_type || 'Sedan',
      transmissionRequired: o.car_transmission || 'Manual',
      ownerNotInCar: false,
    },
    offer_expires_in_seconds: remainingSeconds,
  });
});

driver.patch('/api/v1/driver/orders/:id/offer-response', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  if (user.role !== 'DRIVER' && user.role !== 'ADMIN') {
    return c.json({ error: 'forbidden: requires driver or admin role' }, 403);
  }

  const orderId = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as {
    response?: 'ACCEPTED' | 'DECLINED';
    reason?: string;
    correlation_id?: string;
  };

  if (body.response !== 'ACCEPTED' && body.response !== 'DECLINED') {
    return c.json({ error: "invalid response: must be 'ACCEPTED' or 'DECLINED'" }, 400);
  }

  const sql = getDb(c.env, { write: true });
  const rows = await sql<{
    id: string;
    driver_id: string | null;
    status: string;
    city_prefix: string;
    customer_id: string;
  }[]>`
    SELECT id, driver_id, status, city_prefix, customer_id
    FROM orders
    WHERE id = ${orderId}::uuid
  `;

  if (rows.length === 0) return c.json({ error: 'Order not found' }, 404);
  const order = rows[0];

  if (order.driver_id !== user.user_id && user.role !== 'ADMIN') {
    return c.json({ error: 'forbidden: not assigned driver for this order' }, 403);
  }

  const city = order.city_prefix || c.env.CITY_PREFIX || 'KOL';
  const dispatchStub = c.env.CITY_DISPATCH_DO.getByName(city);
  const orderStream = c.env.ORDER_STREAM_DO.getByName(orderId);

  if (body.response === 'ACCEPTED') {
    await sql`
      UPDATE orders
      SET status = 'ASSIGNED',
          assigned_at = COALESCE(assigned_at, now())
      WHERE id = ${orderId}::uuid
    `;

    await dispatchStub.setDriverStatus(user.user_id, 'BUSY');

    await orderStream.broadcastJSON({
      type: 'order.accepted',
      order_id: orderId,
      driver_id: user.user_id,
      correlation_id: body.correlation_id,
    });

    if (order.customer_id) {
      try {
        const riderStream = c.env.RIDER_STREAM_DO.getByName(order.customer_id);
        await riderStream.pushTripEvent({
          type: 'rider.order.accepted',
          data: {
            order_id: orderId,
            driver_id: user.user_id,
            status: 'ASSIGNED',
          },
        });
      } catch (err) {
        console.warn('Failed to push to rider stream:', err);
      }
    }

    return c.json({ success: true, status: 'ACCEPTED' });
  } else {
    // DECLINED
    await sql`
      UPDATE orders
      SET driver_id = NULL,
          status = 'CREATED'
      WHERE id = ${orderId}::uuid
        AND driver_id = ${user.user_id}::uuid
    `;

    // Unlock driver
    await dispatchStub.setDriverStatus(user.user_id, 'ONLINE_AVAILABLE');

    // Record decline so this driver isn't immediately matched again if scheduled
    try {
      await sql`
        INSERT INTO scheduled_offer_declines (order_id, driver_id, created_at)
        VALUES (${orderId}::uuid, ${user.user_id}::uuid, now())
        ON CONFLICT DO NOTHING
      `;
    } catch (_) {}

    await orderStream.broadcastJSON({
      type: 'order.declined',
      order_id: orderId,
      driver_id: user.user_id,
      reason: body.reason || 'DRIVER_DECLINED',
    });

    return c.json({ success: true, status: 'DECLINED' });
  }
});

// Compatibility endpoints for legacy dispatch accept/decline callers
driver.post('/api/v1/dispatch/accept', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json<{ order_id: string; driver_id?: string }>();
  if (!body.order_id) return c.json({ error: 'order_id is required' }, 400);

  const sql = getDb(c.env, { write: true });
  await sql`
    UPDATE orders
    SET status = 'ASSIGNED',
        assigned_at = COALESCE(assigned_at, now())
    WHERE id = ${body.order_id}::uuid
  `;

  const city = user.city_scope || c.env.CITY_PREFIX || 'KOL';
  const dispatchStub = c.env.CITY_DISPATCH_DO.getByName(city);
  await dispatchStub.setDriverStatus(user.user_id, 'BUSY');

  return c.json({ order_id: body.order_id, status: 'ASSIGNED', message: 'Offer accepted' });
});

driver.post('/api/v1/dispatch/decline', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json<{ order_id: string; driver_id?: string; city_prefix?: string }>();
  if (!body.order_id) return c.json({ error: 'order_id is required' }, 400);

  const sql = getDb(c.env, { write: true });
  await sql`
    UPDATE orders
    SET driver_id = NULL,
        status = 'CREATED'
    WHERE id = ${body.order_id}::uuid
      AND driver_id = ${user.user_id}::uuid
  `;

  const city = body.city_prefix || user.city_scope || c.env.CITY_PREFIX || 'KOL';
  const dispatchStub = c.env.CITY_DISPATCH_DO.getByName(city);
  await dispatchStub.setDriverStatus(user.user_id, 'ONLINE_AVAILABLE');

  return c.json({ order_id: body.order_id, status: 'DECLINED', message: 'Offer declined' });
});

// ---------------------------------------------------------------------------
// 4e. Scheduled Trips & Trip Planner Offers
// ---------------------------------------------------------------------------
driver.get('/api/v1/driver/trips/upcoming', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  if (user.role !== 'DRIVER' && user.role !== 'ADMIN') {
    return c.json({ error: 'forbidden: requires driver or admin role' }, 403);
  }

  const sql = getDb(c.env);
  const rows = await sql<{
    id: string;
    status: string;
    scheduled_at: string;
    trip_type: string | null;
    pickup_lat: number;
    pickup_lng: number;
    base_fare_paise: number;
  }[]>`
    SELECT
      id,
      status,
      scheduled_at,
      trip_type,
      ST_Y(pickup_location::geometry) as pickup_lat,
      ST_X(pickup_location::geometry) as pickup_lng,
      base_fare_paise
    FROM orders
    WHERE driver_id = ${user.user_id}::uuid
      AND scheduled_at IS NOT NULL
      AND scheduled_at > now()
      AND status IN ('ASSIGNED', 'CREATED', 'RESERVED')
    ORDER BY scheduled_at ASC
    LIMIT 20
  `.catch(() => []);

  return c.json({
    trips: rows.map((r) => ({
      id: r.id,
      status: r.status,
      scheduled_at: r.scheduled_at,
      trip_type: r.trip_type || 'CITY',
      pickup_lat: Number(r.pickup_lat) || 0,
      pickup_lng: Number(r.pickup_lng) || 0,
      base_fare_paise: r.base_fare_paise || 35000,
    })),
  });
});

driver.get('/api/v1/driver/scheduled-offers', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  if (user.role !== 'DRIVER' && user.role !== 'ADMIN') {
    return c.json({ error: 'forbidden: requires driver or admin role' }, 403);
  }

  const city = user.city_scope || c.env.CITY_PREFIX || 'KOL';
  const sql = getDb(c.env);

  const rows = await sql<{
    id: string;
    scheduled_at: string;
    trip_type: string | null;
    pickup_lat: number;
    pickup_lng: number;
    base_fare_paise: number;
  }[]>`
    SELECT
      o.id,
      o.scheduled_at,
      o.trip_type,
      ST_Y(o.pickup_location::geometry) as pickup_lat,
      ST_X(o.pickup_location::geometry) as pickup_lng,
      o.base_fare_paise
    FROM orders o
    WHERE o.city_prefix = ${city}
      AND o.driver_id IS NULL
      AND o.scheduled_at IS NOT NULL
      AND o.scheduled_at > now()
      AND o.status = 'CREATED'
      AND o.id NOT IN (
        SELECT order_id FROM scheduled_offer_declines WHERE driver_id = ${user.user_id}::uuid
      )
    ORDER BY o.scheduled_at ASC
    LIMIT 10
  `.catch(() => []);

  return c.json({
    offers: rows.map((r) => ({
      id: r.id,
      scheduled_at: r.scheduled_at,
      trip_type: r.trip_type || 'CITY',
      pickup_lat: Number(r.pickup_lat) || 0,
      pickup_lng: Number(r.pickup_lng) || 0,
      base_fare_paise: r.base_fare_paise || 35000,
    })),
  });
});

driver.post('/api/v1/driver/scheduled-offers/:id/accept', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  if (user.role !== 'DRIVER' && user.role !== 'ADMIN') {
    return c.json({ error: 'forbidden: requires driver or admin role' }, 403);
  }

  const orderId = c.req.param('id');
  const sql = getDb(c.env, { write: true });

  const updated = await sql<{ id: string }[]>`
    UPDATE orders
    SET driver_id = ${user.user_id}::uuid,
        status = 'ASSIGNED',
        assigned_at = now()
    WHERE id = ${orderId}::uuid
      AND driver_id IS NULL
      AND status = 'CREATED'
    RETURNING id
  `;

  if (updated.length === 0) {
    return c.json({ error: 'Offer no longer available or already assigned' }, 409);
  }

  return c.json({ order_id: orderId, status: 'ASSIGNED' });
});

driver.post('/api/v1/driver/scheduled-offers/:id/decline', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  if (user.role !== 'DRIVER' && user.role !== 'ADMIN') {
    return c.json({ error: 'forbidden: requires driver or admin role' }, 403);
  }

  const orderId = c.req.param('id');
  const sql = getDb(c.env, { write: true });

  try {
    await sql`
      INSERT INTO scheduled_offer_declines (order_id, driver_id, created_at)
      VALUES (${orderId}::uuid, ${user.user_id}::uuid, now())
      ON CONFLICT (order_id, driver_id) DO NOTHING
    `;
  } catch (_) {}

  return c.json({ status: 'DECLINED' });
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
  if (user.role !== 'DRIVER' && user.role !== 'ADMIN') {
    return c.json({ error: 'forbidden: requires driver or admin role' }, 403);
  }

  const body = (await c.req.json().catch(() => ({}))) as { amount_paise?: number };
  const amountPaise = typeof body.amount_paise === 'number' ? Math.floor(body.amount_paise) : 0;

  // Validation: positive integer, minimum ₹100 (10,000 paise), maximum cap ₹50,000 (5,000,000 paise)
  if (!amountPaise || amountPaise <= 0) {
    return c.json({ error: 'invalid amount: must be positive integer paise' }, 400);
  }

  if (amountPaise < 10000) {
    return c.json({ error: 'minimum payout amount is 10,000 paise (₹100)' }, 400);
  }

  if (amountPaise > 5000000) {
    return c.json({ error: 'maximum single payout limit is 5,000,000 paise (₹50,000)' }, 400);
  }

  const sql = getDb(c.env, { write: true });

  // Prevent duplicate concurrent pending requests
  const pending = await sql<{ id: string }[]>`
    SELECT id FROM driver_payouts
    WHERE driver_id = ${user.user_id}::uuid
      AND status = 'REQUESTED'
    LIMIT 1
  `;

  if (pending.length > 0) {
    return c.json({
      error: 'payout_already_pending: you already have a payout request under review',
      pending_payout_id: pending[0].id,
    }, 409);
  }

  const created = await sql<{ id: string }[]>`
    INSERT INTO driver_payouts (driver_id, amount_paise, status, created_at)
    VALUES (${user.user_id}::uuid, ${amountPaise}, 'REQUESTED', now())
    RETURNING id
  `;

  if (c.env.EVENTS) {
    await c.env.EVENTS.send({
      topic: 'driver.payout.requested',
      payload: { payout_id: created[0].id, driver_id: user.user_id, amount_paise: amountPaise },
      timestamp: Date.now(),
    });
  }

  return c.json({ success: true, payout_id: created[0].id, status: 'REQUESTED', amount_paise: amountPaise });
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
