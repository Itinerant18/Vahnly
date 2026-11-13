# Next Implementation Tasks: Engineering Specifications for Phase 0 & Phase 1

- **Date:** 2026-11-12
- **Document Version:** 1.0
- **Target Applications:** `workers/api/`, `client-app/`, `database/migrations/`
- **Audience:** Core Full-Stack & Mobile Engineers

---

## Task Summary Table

| Task ID | Title | Target Subsystems | Priority | Effort | Risk if Delayed |
|:---|:---|:---|:---:|:---:|:---|
| **TASK-DRV-001** | Eliminate Universal Backdoor OTP `1234` from Trip Verification | `workers/api/src/routes/driver.ts` | **P0** | XS | Security compromise; unauthorized phantom trip billing |
| **TASK-DRV-002** | Implement Driver Dispatch Offer & Acceptance Endpoints & Fix `queue.ts` | `workers/api/src/routes/driver.ts`, `queue.ts` | **P0** | M | Drivers cannot receive or accept bookings; dispatch hangs |
| **TASK-DRV-003** | Implement In-Transit Order Events API for Tolls and Parking | `workers/api/src/routes/driver.ts`, Neon PostGIS | **P0** | S | Drivers lose personal money paying customer highway tolls |
| **TASK-DRV-004** | Persist Vehicle Inspection Metrics (Odometer, Fuel, Photos) | `workers/api/src/routes/driver.ts`, `client-app/` | **P1** | S | Vehicle damage and unauthorized mileage disputes unresolvable |
| **TASK-DRV-005** | Driver Wallet Ledger & Dynamic Earnings SQL Replacement | `workers/api/src/routes/driver.ts`, Neon PostGIS | **P1** | M | Massive fraudulent payout requests; financial insolvency |
| **TASK-DRV-006** | Scheduled Booking Endpoints & Navigation Tab Bar Synchronization | `workers/api/src/routes/driver.ts`, `client-app/` | **P1** | M | Advance booking commitments inaccessible to drivers |

---

## Detailed Task Specifications

---

### TASK-DRV-001: Eliminate Universal Backdoor OTP `1234` from Trip Verification

#### 1. Problem Statement & Motivation
In `workers/api/src/routes/driver.ts#L151`, line 151 permits any driver to start any assigned trip by submitting the literal string `'1234'`, bypassing verification of the real 4-digit PIN given to the vehicle owner. This is a severe security backdoor that enables drivers to fraudulently bill customers without meeting them.

#### 2. Scope of Work
- Remove `&& body.otp !== '1234'` from `workers/api/src/routes/driver.ts`.
- Enforce strict string comparison against `orders.start_otp`.
- Enforce a brute-force limit: maximum 3 incorrect OTP submissions before the order enters an OTP lockout state requiring support intervention.

#### 3. Exact Code Changes
**File:** `workers/api/src/routes/driver.ts`
```diff
--- a/workers/api/src/routes/driver.ts
+++ b/workers/api/src/routes/driver.ts
@@ -148,8 +148,8 @@ driver.patch('/api/v1/driver/orders/:id/verify-otp', async (c) => {
   `;
 
   if (rows.length === 0) return c.json({ error: 'Order not found' }, 404);
-  if (rows[0].start_otp !== body.otp && body.otp !== '1234') {
-    return c.json({ success: false, error: 'invalid OTP' }, 400);
+  if (rows[0].start_otp !== body.otp) {
+    return c.json({ success: false, error: 'Invalid verification OTP' }, 400);
   }
 
   await sql`
```

#### 4. Test & Verification
- Unit test submitting `1234` against an order with `start_otp = '7429'` -> Verify HTTP 400 response.
- Unit test submitting `7429` -> Verify HTTP 200 response and `IN_TRANSIT` status.

---

### TASK-DRV-002: Implement Driver Dispatch Offer & Acceptance Endpoints & Fix `queue.ts`

#### 1. Problem Statement & Motivation
Currently, when an order is created, `workers/api/src/queue.ts` directly assigns the order to a driver in Postgres without presenting an offer. Furthermore, the driver endpoints `GET /api/v1/driver/offer` and `PATCH /api/v1/driver/orders/:id/offer-response` do not exist on `workers/api`, resulting in 404 errors when the frontend attempts to accept or decline.

#### 2. Scope of Work
- Create database table `dispatch_offers` for tracking 15-second offer windows.
- Refactor `workers/api/src/queue.ts` on `order.created`: transition order to `OFFERED`, insert into `dispatch_offers` with a 15-second TTL, and broadcast `driver.offer` to the matched driver's stream.
- Implement `GET /api/v1/driver/offer` returning active offer details and remaining countdown seconds.
- Implement `PATCH /api/v1/driver/orders/:id/offer-response` accepting `ACCEPTED` or `DECLINED`.

#### 3. Data Model Migration
```sql
CREATE TABLE IF NOT EXISTS dispatch_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED'
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_dispatch_offers_driver ON dispatch_offers(driver_id, status, expires_at);
```

#### 4. Exact Implementation in `workers/api/src/routes/driver.ts`
```ts
// ---------------------------------------------------------------------------
// Active Offer Query & Acceptance
// ---------------------------------------------------------------------------
driver.get('/api/v1/driver/offer', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const sql = getDb(c.env);
  const rows = await sql`
    SELECT 
      d_o.id as offer_id,
      d_o.order_id,
      EXTRACT(EPOCH FROM (d_o.expires_at - now()))::int as offer_expires_in_seconds,
      o.city_prefix,
      o.base_fare_paise,
      o.total_fare_paise,
      ST_Y(o.pickup_location::geometry) as pickup_lat,
      ST_X(o.pickup_location::geometry) as pickup_lng,
      ST_Y(o.dropoff_location::geometry) as dropoff_lat,
      ST_X(o.dropoff_location::geometry) as dropoff_lng,
      o.pickup_address,
      o.dropoff_address
    FROM dispatch_offers d_o
    JOIN orders o ON o.id = d_o.order_id
    WHERE d_o.driver_id = ${user.user_id}::uuid
      AND d_o.status = 'PENDING'
      AND d_o.expires_at > now()
    ORDER BY d_o.created_at DESC
    LIMIT 1
  `;

  if (rows.length === 0) return c.json({ offer: null });

  const r = rows[0];
  return c.json({
    offer: {
      orderId: r.order_id,
      pickupLat: r.pickup_lat,
      pickupLng: r.pickup_lng,
      pickupAddress: r.pickup_address || 'Pickup Location',
      dropoffLat: r.dropoff_lat,
      dropoffLng: r.dropoff_lng,
      dropoffAddress: r.dropoff_address || 'Destination Location',
      baseFarePaise: r.base_fare_paise,
      totalFarePaise: r.total_fare_paise,
    },
    offer_expires_in_seconds: Math.max(0, r.offer_expires_in_seconds),
  });
});

driver.patch('/api/v1/driver/orders/:id/offer-response', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const orderId = c.req.param('id');
  const body = await c.req.json<{ response: 'ACCEPTED' | 'DECLINED'; reason?: string }>();

  const sql = getDb(c.env, { write: true });

  if (body.response === 'ACCEPTED') {
    // Atomically claim offer if not expired
    const updated = await sql`
      UPDATE dispatch_offers
      SET status = 'ACCEPTED', responded_at = now()
      WHERE order_id = ${orderId}::uuid
        AND driver_id = ${user.user_id}::uuid
        AND status = 'PENDING'
        AND expires_at > now()
      RETURNING id
    `;

    if (updated.length === 0) {
      return c.json({ success: false, error: 'Offer expired or already reassigned' }, 410);
    }

    // Assign driver to order
    await sql`
      UPDATE orders
      SET status = 'ASSIGNED',
          driver_id = ${user.user_id}::uuid,
          assigned_at = now()
      WHERE id = ${orderId}::uuid
    `;

    const city = user.city_scope || c.env.CITY_PREFIX || 'KOL';
    const dispatchStub = c.env.CITY_DISPATCH_DO.getByName(city);
    await dispatchStub.setDriverStatus(user.user_id, 'BUSY');

    const orderStream = c.env.ORDER_STREAM_DO.getByName(orderId);
    await orderStream.broadcastAssignment({
      order_id: orderId,
      driver_id: user.user_id,
      city_prefix: city,
      status: 'ASSIGNED',
    });

    return c.json({ success: true, status: 'ASSIGNED' });
  } else {
    // Driver declined
    await sql`
      UPDATE dispatch_offers
      SET status = 'DECLINED', responded_at = now()
      WHERE order_id = ${orderId}::uuid AND driver_id = ${user.user_id}::uuid
    `;

    const city = user.city_scope || c.env.CITY_PREFIX || 'KOL';
    const dispatchStub = c.env.CITY_DISPATCH_DO.getByName(city);
    await dispatchStub.setDriverStatus(user.user_id, 'ONLINE_AVAILABLE');

    // Trigger re-match in queue
    if (c.env.EVENTS) {
      await c.env.EVENTS.send({
        topic: 'order.re_match_requested',
        payload: { order_id: orderId, declined_driver_id: user.user_id, city_prefix: city },
        timestamp: Date.now(),
      });
    }

    return c.json({ success: true, status: 'DECLINED' });
  }
});
```

#### 5. Acceptance Criteria
- Rider books driver; targeted driver sees offer modal within 1.5s.
- Accepting offer transitions driver to `EN_ROUTE` and rider to "Driver Assigned".
- Declining offer unlocks driver and sends offer to next closest driver.

---

### TASK-DRV-003: Implement In-Transit Order Events API for Tolls and Parking

#### 1. Problem Statement & Motivation
Drivers in India frequently encounter toll plazas and commercial parking fees. `client-app` calls `/api/v1/driver/orders/:id/events`, but this endpoint returns 404 in `workers/api`. As a result, out-of-pocket driver expenses are lost and never billed to the customer.

#### 2. Scope of Work
- Create `order_events` table in Neon Postgres.
- Implement `POST /api/v1/driver/orders/:id/events` in `workers/api/src/routes/driver.ts`.
- Atomically increment `orders.extra_charges_paise` and broadcast update to `OrderStreamDO`.

#### 3. Data Model Migration
```sql
CREATE TABLE IF NOT EXISTS order_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event_type VARCHAR(32) NOT NULL, -- 'TOLL', 'PARKING', 'WAIT_START', 'WAIT_END'
  amount_paise BIGINT DEFAULT 0,
  payload JSONB DEFAULT '{}'::jsonb,
  recorded_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id);
```

#### 4. Route Implementation
```ts
driver.post('/api/v1/driver/orders/:id/events', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const orderId = c.req.param('id');
  const body = await c.req.json<{
    type: 'TOLL' | 'PARKING' | 'WAIT_START' | 'WAIT_END';
    toll_amount_paise?: number;
    parking_amount_paise?: number;
    notes?: string;
  }>();

  const amountPaise = (body.toll_amount_paise || 0) + (body.parking_amount_paise || 0);
  const sql = getDb(c.env, { write: true });

  await sql`
    INSERT INTO order_events (order_id, event_type, amount_paise, payload, recorded_by)
    VALUES (
      ${orderId}::uuid,
      ${body.type},
      ${amountPaise},
      ${JSON.stringify(body)}::jsonb,
      ${user.user_id}::uuid
    )
  `;

  if (amountPaise > 0) {
    await sql`
      UPDATE orders
      SET extra_charges_paise = extra_charges_paise + ${amountPaise},
          total_fare_paise = total_fare_paise + ${amountPaise}
      WHERE id = ${orderId}::uuid
    `;
  }

  const orderStream = c.env.ORDER_STREAM_DO.getByName(orderId);
  await orderStream.broadcastJSON({
    type: 'order.expense_added',
    order_id: orderId,
    amount_paise: amountPaise,
    category: body.type,
  });

  return c.json({ success: true, message: 'Event recorded successfully', added_paise: amountPaise });
});
```

#### 5. Acceptance Criteria
- Adding a ₹150 toll mid-trip returns HTTP 200 with `{ success: true, added_paise: 15000 }`.
- Rider bill view immediately shows ₹150 added to the total trip fare.

---

### TASK-DRV-004: Persist Vehicle Inspection Metrics (Odometer, Fuel, Photos)

#### 1. Problem Statement & Motivation
`DriverTerminalPage.tsx` captures start/end odometer, fuel level, and odometer photos, but the backend handlers (`verify-otp` and `end`) discard these parameters, leaving vehicle condition untracked.

#### 2. Scope of Work
- Add `start_odometer_km`, `end_odometer_km`, `start_fuel_pct`, `end_fuel_pct`, and `odometer_photo_url` to `orders`.
- Update `verify-otp` handler to save starting inspection data.
- Update `end` handler to save ending odometer reading and validate that `end_odometer >= start_odometer`.

#### 3. Database Migration & Handler Updates
```sql
ALTER TABLE orders 
  ADD COLUMN IF NOT EXISTS start_odometer_km NUMERIC(8, 2),
  ADD COLUMN IF NOT EXISTS end_odometer_km NUMERIC(8, 2),
  ADD COLUMN IF NOT EXISTS start_fuel_pct INTEGER,
  ADD COLUMN IF NOT EXISTS end_fuel_pct INTEGER,
  ADD COLUMN IF NOT EXISTS odometer_photo_url TEXT;
```

**In `verify-otp` handler (`workers/api/src/routes/driver.ts`):**
```ts
const body = await c.req.json<{
  otp: string;
  start_odometer?: number;
  start_fuel?: number;
  odo_photo_url?: string;
}>();

await sql`
  UPDATE orders
  SET status = 'IN_TRANSIT',
      started_at = now(),
      start_odometer_km = ${body.start_odometer || null},
      start_fuel_pct = ${body.start_fuel || null},
      odometer_photo_url = ${body.odo_photo_url || null}
  WHERE id = ${orderId}::uuid
`;
```

#### 4. Acceptance Criteria
- Both starting and ending odometer values are successfully stored in PostgreSQL.
- Attempting to end a trip with `end_odometer < start_odometer` returns an error warning the driver of an impossible odometer rollback.

---

### TASK-DRV-005: Driver Wallet Ledger & Dynamic Earnings SQL Replacement

#### 1. Problem Statement & Motivation
`workers/api/src/routes/driver.ts#L221-L228` hardcodes static mock numbers (`withdrawable_paise: 3800000`, `total_earnings_paise: 4500000`). This exposes the company to fraudulent payout claims.

#### 2. Scope of Work
- Create `driver_wallet_ledger` table with double-entry accounting.
- When an order reaches `COMPLETED`, calculate:
  - Gross trip fare
  - Platform commission (e.g., 20%)
  - Driver net earnings (80% + 100% of tolls/tips)
- Insert a ledger entry for the driver.
- Update `GET /api/v1/driver/earnings` to calculate the real balance dynamically from `driver_wallet_ledger`.

#### 3. Database Schema
```sql
CREATE TABLE IF NOT EXISTS driver_wallet_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  entry_type VARCHAR(32) NOT NULL, -- 'TRIP_EARNING', 'PLATFORM_FEE', 'CASH_COLLECTED', 'WITHDRAWAL'
  amount_paise BIGINT NOT NULL,     -- Positive for credit, negative for debit
  balance_after_paise BIGINT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_driver_ledger ON driver_wallet_ledger(driver_id, created_at DESC);
```

#### 4. Route Replacement
```ts
driver.get('/api/v1/driver/earnings', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const sql = getDb(c.env);

  // 1. Current Withdrawable Balance
  const balanceRow = await sql`
    SELECT balance_after_paise 
    FROM driver_wallet_ledger 
    WHERE driver_id = ${user.user_id}::uuid 
    ORDER BY created_at DESC 
    LIMIT 1
  `;
  const withdrawablePaise = balanceRow.length > 0 ? balanceRow[0].balance_after_paise : 0;

  // 2. Today's Summary
  const todayRow = await sql`
    SELECT 
      COALESCE(SUM(amount_paise), 0) as today_earnings_paise,
      COUNT(DISTINCT order_id) as today_trips_count
    FROM driver_wallet_ledger
    WHERE driver_id = ${user.user_id}::uuid
      AND amount_paise > 0
      AND created_at >= date_trunc('day', now())
  `;

  // 3. This Week's Total
  const weekRow = await sql`
    SELECT COALESCE(SUM(amount_paise), 0) as week_earnings_paise
    FROM driver_wallet_ledger
    WHERE driver_id = ${user.user_id}::uuid
      AND amount_paise > 0
      AND created_at >= date_trunc('week', now())
  `;

  return c.json({
    total_earnings_paise: withdrawablePaise,
    withdrawable_paise: Math.max(0, withdrawablePaise),
    trips_count: todayRow[0].today_trips_count,
    today_earnings_paise: todayRow[0].today_earnings_paise,
    this_week_earnings_paise: weekRow[0].week_earnings_paise,
  });
});
```

#### 5. Acceptance Criteria
- New driver sees ₹0 withdrawable balance.
- Completing a ₹500 trip immediately updates withdrawable balance to ₹400 (after 20% platform commission).

---

### TASK-DRV-006: Scheduled Booking Endpoints & Navigation Tab Bar Synchronization

#### 1. Problem Statement & Motivation
`TabBarRedesign.tsx` links Tab 2 to `/driver/jobs` (history only), while `/driver/trips` (which has the upcoming scheduled booking UI) is orphaned. Additionally, the backend routes for upcoming trips return 404.

#### 2. Scope of Work
- In `client-app/src/components/TabBarRedesign.tsx`: update Tab 2 to link to `/driver/trips`.
- In `client-app/src/app/driver/trips/page.tsx`: ensure Aura tokens and TabBarRedesign are rendered.
- In `workers/api/src/routes/driver.ts`: implement `GET /api/v1/driver/trips/upcoming` and `POST /api/v1/driver/scheduled-offers/:id/accept`.

#### 3. Backend Route Implementation
```ts
driver.get('/api/v1/driver/trips/upcoming', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ trips: [] });

  const sql = getDb(c.env);
  const rows = await sql`
    SELECT 
      id,
      scheduled_at,
      status,
      base_fare_paise,
      total_fare_paise,
      pickup_address,
      dropoff_address,
      ST_Y(pickup_location::geometry) as pickup_lat,
      ST_X(pickup_location::geometry) as pickup_lng
    FROM orders
    WHERE driver_id = ${user.user_id}::uuid
      AND scheduled_at > now()
      AND status IN ('ASSIGNED', 'RESERVED')
    ORDER BY scheduled_at ASC
  `;

  return c.json({ trips: rows });
});

driver.get('/api/v1/driver/scheduled-offers', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ offers: [] });

  const city = user.city_scope || c.env.CITY_PREFIX || 'KOL';
  const sql = getDb(c.env);
  const rows = await sql`
    SELECT 
      id,
      scheduled_at,
      trip_type,
      vehicle_tier,
      base_fare_paise,
      pickup_address,
      ST_Y(pickup_location::geometry) as pickup_lat,
      ST_X(pickup_location::geometry) as pickup_lng
    FROM orders
    WHERE city_prefix = ${city}
      AND status = 'PENDING'
      AND scheduled_at > now() + INTERVAL '2 hours'
      AND driver_id IS NULL
    ORDER BY scheduled_at ASC
    LIMIT 20
  `;

  return c.json({ offers: rows });
});
```

#### 4. Acceptance Criteria
- Tapping Tab 2 opens `/driver/trips`.
- Drivers can toggle between "Upcoming" advance bookings and past completed history.
- Available scheduled bookings can be committed in advance.
