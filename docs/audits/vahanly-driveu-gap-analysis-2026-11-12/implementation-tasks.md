# Implementation Tasks: Technical Specifications for High-Priority Work

- **Date:** 2026-11-12
- **Audit Target:** Engineering Specifications for P0 Launch Blockers
- **Auditor:** Principal Software Engineer & Mobile Systems Architect

---

## TASK-001: Fix Order Creation Contract & Unblock BookingSheet Submit

- **Finding Reference:** FIND-001, FIND-010
- **Priority:** **P0** (Launch Blocker)
- **Estimated Effort:** 2 Hours

### 1. Problem Statement
When a rider confirms a booking in `rider-app`, `BookingSheet.tsx#L538` calls `bookDriver()`. The store expects `{ order: Order, otp: string }` and accesses `order.id`. However, `workers/api/src/routes/orders.ts#L163` returns `{ success: true, order_id: string, ... }`. Accessing `order.id` throws an uncaught JavaScript `TypeError`, crashing the flow before navigating to `/dispatch`. Additionally, `orders.ts#L89` falls back to a hardcoded UUID if unauthenticated, allowing anonymous spam bookings.

### 2. Scope & Non-Goals
- **In Scope:** 
  1. Require valid JWT authentication on `POST /api/v1/orders` and `POST /api/v1/rider/orders` (reject anonymous callers with 401).
  2. Return the canonical `CreateOrderResult` envelope containing `{ order: { id, status, ... }, otp, fare_estimate }`.
  3. Update `rider-app/src/lib/store/bookingStore.ts` to safely handle the response.
- **Non-Goals:** Redesigning the booking UI or modifying pricing logic.

### 3. Relevant Modules
- `workers/api/src/routes/orders.ts` (lines 87–176)
- `rider-app/src/lib/store/bookingStore.ts` (lines 280–315)
- `rider-app/src/components/booking/BookingSheet.tsx` (lines 535–550)

### 4. Proposed Technical Design
In `workers/api/src/routes/orders.ts`:
```ts
async function handleCreateOrder(c: any) {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user?.user_id) {
    return c.json({ success: false, code: 'UNAUTHORIZED', error: 'Authentication required to create a booking' }, 401);
  }
  const customerId = user.user_id;
  // ... existing calculation ...
  
  const orderRecord = {
    id: orderId,
    status: 'SEARCHING',
    city_prefix: city,
    customer_id: customerId,
    base_fare_paise: fare.base_fare_paise,
    total_fare_paise: fare.total_fare_paise,
    start_otp: otp,
    share_token: shareToken,
    pickup_address: body.pickup_address || '',
    dropoff_address: body.dropoff_address || '',
    created_at: new Date().toISOString(),
  };

  return c.json({
    success: true,
    order: orderRecord,
    order_id: orderId,
    otp: otp,
    start_otp: otp,
    share_token: shareToken,
    fare_estimate: {
      total_fare_paise: fare.total_fare_paise,
      distance_km: route.distance_km,
      duration_minutes: route.duration_minutes,
      fare_breakdown: fare,
    },
  }, 201);
}
```

### 5. Acceptance Criteria & Test Cases
- **TC-001.1:** Anonymous `POST /api/v1/orders` returns `401 Unauthorized`.
- **TC-001.2:** Authenticated `POST /api/v1/orders` returns HTTP 201 with `{ order: { id: "<uuid>" }, otp: "<string>" }`.
- **TC-001.3:** Tapping "Book Driver" in `BookingSheet.tsx` smoothly navigates to `/dispatch?orderId=<uuid>` without console errors.

---

## TASK-002: Implement Driver Job Offer & Acceptance Flow in Edge Backend

- **Finding Reference:** FIND-002, FIND-007
- **Priority:** **P0** (Launch Blocker)
- **Estimated Effort:** 3 Days

### 1. Problem Statement
`CityDispatchDO` auto-assigns orders directly to drivers without offering the job or obtaining consent. `client-app` polls `GET /api/v1/driver/offer` and responds via `PATCH /api/v1/driver/orders/:id/offer-response`, but both routes are absent in `workers/api` (returning 404). As a result, drivers never receive incoming booking alerts, and riders are assigned to unacknowledged drivers.

### 2. Scope & Non-Goals
- **In Scope:**
  1. Add in-memory offer storage and 15-second reservation timer in `CityDispatchDO`.
  2. Implement `GET /api/v1/driver/offer` in `workers/api/src/routes/driver.ts`.
  3. Implement `PATCH /api/v1/driver/orders/:id/offer-response` (`ACCEPTED` / `DECLINED`).
  4. Emit `rider.order.assigned` to `RiderStreamDO` ONLY after the driver explicitly accepts.
  5. If the driver declines or the 15-second timer expires, return the driver to `ONLINE_AVAILABLE` and offer the order to the next closest candidate.
- **Non-Goals:** Complex Hungarian batch optimization (greedy proximity matching with progressive k-ring expansion is sufficient for pilot).

### 3. Relevant Modules
- `workers/api/src/durable-objects/CityDispatchDO.ts`
- `workers/api/src/routes/driver.ts`
- `workers/api/src/queue.ts`
- `client-app/src/store/useOfferStore.ts`
- `rider-app/app/(app)/dispatch/page.tsx`

### 4. Proposed Technical Design

#### Database Schema Adjustment
In SQLite inside `CityDispatchDO`:
```sql
CREATE TABLE IF NOT EXISTS active_offers (
  order_id TEXT PRIMARY KEY,
  driver_id TEXT NOT NULL,
  pickup_lat REAL NOT NULL,
  pickup_lng REAL NOT NULL,
  dropoff_lat REAL,
  dropoff_lng REAL,
  fare_paise INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
```

#### CityDispatchDO Logic
```ts
async createOffer(order: OrderMatchRequest): Promise<{ offered: boolean; driverId?: string }> {
  const candidate = this.findBestDriver(order.pickup_lat, order.pickup_lng);
  if (!candidate) return { offered: false };

  const expiresAt = Date.now() + 15000; // 15s window
  this.ctx.storage.sql.exec(
    `INSERT INTO active_offers (order_id, driver_id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, fare_paise, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    order.id, candidate.driver_id, order.pickup_lat, order.pickup_lng, order.dropoff_lat, order.dropoff_lng, order.fare_paise, expiresAt
  );

  this.ctx.storage.sql.exec(
    `UPDATE driver_index SET status = 'OFFER_PENDING' WHERE driver_id = ?`,
    candidate.driver_id
  );

  // Set DO alarm to auto-expire offer after 15s
  await this.ctx.storage.setAlarm(Date.now() + 15000);
  return { offered: true, driverId: candidate.driver_id };
}
```

#### Route Handlers in `workers/api/src/routes/driver.ts`
```ts
driver.get('/api/v1/driver/offer', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const city = user.city_scope || c.env.CITY_PREFIX || 'KOL';
  const dispatchStub = c.env.CITY_DISPATCH_DO.getByName(city);
  const offer = await dispatchStub.getPendingOfferForDriver(user.user_id);

  if (!offer) return c.json({ order: null });
  return c.json({
    order: offer,
    offer_expires_in_seconds: Math.max(0, Math.floor((offer.expires_at - Date.now()) / 1000)),
  });
});

driver.patch('/api/v1/driver/orders/:id/offer-response', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  const orderId = c.req.param('id');
  const body = await c.req.json<{ response: 'ACCEPTED' | 'DECLINED'; reason?: string }>();

  const city = user?.city_scope || c.env.CITY_PREFIX || 'KOL';
  const dispatchStub = c.env.CITY_DISPATCH_DO.getByName(city);

  const result = await dispatchStub.handleOfferResponse(orderId, user?.user_id, body.response, body.reason);
  if (!result.success) {
    return c.json({ success: false, error: result.error || 'Offer expired or already reassigned' }, 409);
  }

  return c.json({ success: true, status: body.response === 'ACCEPTED' ? 'ASSIGNED' : 'DECLINED' });
});
```

### 5. Acceptance Criteria & Test Cases
- **TC-002.1:** Candidate driver polling `GET /driver/offer` receives active offer details within 1 second of matching.
- **TC-002.2:** When driver accepts within 15s, order status becomes `ASSIGNED` in PostgreSQL, and `rider.order.assigned` pushes to rider WebSocket.
- **TC-002.3:** When driver declines, candidate is reset to `ONLINE_AVAILABLE`, and order is automatically offered to candidate #2.
- **TC-002.4:** If driver does not respond within 15s, the DO alarm clears the offer and advances to candidate #2.

---

## TASK-003: Eliminate Universal Backdoor OTP `1234` & Enforce Trip Lockout

- **Finding Reference:** FIND-005
- **Priority:** **P0** (Launch Blocker)
- **Estimated Effort:** 1 Hour

### 1. Problem Statement
`workers/api/src/routes/driver.ts#L151` allows any driver to start a trip by submitting OTP `1234`, bypassing customer confirmation.

### 2. Scope & Non-Goals
- **In Scope:**
  1. Remove `&& body.otp !== '1234'` from `workers/api/src/routes/driver.ts`.
  2. Implement an in-memory attempt counter in `SessionDO` or PostgreSQL to lock OTP verification after 3 consecutive invalid attempts.
  3. Store starting odometer, fuel percentage, and verified car plate into `orders`.

### 3. Code Modification
In `workers/api/src/routes/driver.ts`:
```ts
driver.patch('/api/v1/driver/orders/:id/verify-otp', async (c) => {
  const orderId = c.req.param('id');
  const body = await c.req.json<{
    otp: string;
    odometer_start?: number;
    fuel_start_pct?: number;
    car_plate?: string;
  }>();
  const sql = getDb(c.env, { write: true });

  const rows = await sql<{ start_otp: string; status: string; otp_attempts: number }[]>`
    SELECT start_otp, status, COALESCE(otp_attempts, 0) as otp_attempts
    FROM orders WHERE id = ${orderId}::uuid
  `;

  if (rows.length === 0) return c.json({ error: 'Order not found' }, 404);
  const order = rows[0];

  if (order.otp_attempts >= 3) {
    return c.json({ success: false, code: 'OTP_LOCKED', error: 'Too many failed OTP attempts. Contact support.' }, 403);
  }

  // STRICT VALIDATION (Backdoor Removed)
  if (order.start_otp !== body.otp.trim()) {
    await sql`UPDATE orders SET otp_attempts = otp_attempts + 1 WHERE id = ${orderId}::uuid`;
    return c.json({ success: false, error: 'Invalid OTP', attempts_remaining: 2 - order.otp_attempts }, 400);
  }

  await sql`
    UPDATE orders
    SET status = 'IN_TRANSIT',
        started_at = now(),
        start_odometer = ${body.odometer_start || null},
        start_fuel_pct = ${body.fuel_start_pct || null},
        verified_car_plate = ${body.car_plate || null}
    WHERE id = ${orderId}::uuid
  `;

  // Push WebSocket notification
  const orderStream = c.env.ORDER_STREAM_DO.getByName(orderId);
  await orderStream.broadcastJSON({ type: 'trip.started', order_id: orderId });

  return c.json({ success: true, status: 'IN_TRANSIT' });
});
```

### 4. Acceptance Criteria & Test Cases
- **TC-003.1:** Submitting `otp: '1234'` returns `400 Invalid OTP` when the order's real OTP is `8592`.
- **TC-003.2:** Submitting 3 consecutive wrong OTPs locks the trip and returns `403 OTP_LOCKED`.
- **TC-003.3:** Correct OTP transitions order to `IN_TRANSIT` and records start odometer.

---

## TASK-004: Implement In-Transit Order Events Endpoint for Tolls, Parking & No-Shows

- **Finding Reference:** FIND-004
- **Priority:** **P0** (Launch Blocker)
- **Estimated Effort:** 1 Day

### 1. Problem Statement
Driver clicks "Add Toll", "Add Parking", or "Report No-Show" during active duty. The driver app calls `POST /api/v1/driver/orders/:id/events`, which 404s on `workers/api`. Extra charges cannot be billed, and no-shows cannot be completed.

### 2. Scope & Technical Design
Implement `POST /api/v1/driver/orders/:id/events` in `workers/api/src/routes/driver.ts`:
```ts
driver.post('/api/v1/driver/orders/:id/events', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const orderId = c.req.param('id');
  const body = await c.req.json<{
    event_type: 'toll_added' | 'parking_added' | 'NO_SHOW' | 'WAITING_STARTED';
    amount_paise?: number;
    description?: string;
  }>();

  const sql = getDb(c.env, { write: true });
  const amount = Math.max(0, body.amount_paise || 0);

  // Validate driver is assigned to this order
  const orderCheck = await sql<{ id: string; status: string; total_fare_paise: number }[]>`
    SELECT id, status, total_fare_paise FROM orders
    WHERE id = ${orderId}::uuid AND driver_id = ${user.user_id}::uuid
  `;
  if (orderCheck.length === 0) return c.json({ error: 'Order not found or unauthorized' }, 404);

  if (body.event_type === 'NO_SHOW') {
    await sql`
      UPDATE orders
      SET status = 'CANCELLED', cancelled_by = 'DRIVER', cancellation_reason = 'NO_SHOW', cancelled_at = now()
      WHERE id = ${orderId}::uuid
    `;
    const city = user.city_scope || c.env.CITY_PREFIX || 'KOL';
    await c.env.CITY_DISPATCH_DO.getByName(city).setDriverStatus(user.user_id, 'ONLINE_AVAILABLE');
    return c.json({ success: true, status: 'CANCELLED' });
  }

  // Toll / Parking
  if (amount > 0) {
    await sql`
      UPDATE orders
      SET total_fare_paise = total_fare_paise + ${amount}
      WHERE id = ${orderId}::uuid
    `;
    await sql`
      INSERT INTO ledger_entries (entry_type, amount_paise, reference_id, description)
      VALUES (${body.event_type.toUpperCase()}, ${amount}, ${orderId}, ${body.description || 'Extra in-transit fee'})
    `;
  }

  return c.json({ success: true, updated_total_fare_paise: orderCheck[0].total_fare_paise + amount });
});
```

### 3. Acceptance Criteria & Test Cases
- **TC-004.1:** Adding ₹100 toll increases `orders.total_fare_paise` by 10000 paise.
- **TC-004.2:** Reporting `NO_SHOW` marks order `CANCELLED` and resets driver status to `ONLINE_AVAILABLE`.

---

## TASK-005: Secure Order Cancellation Endpoint with Ownership Authorization

- **Finding Reference:** FIND-008
- **Priority:** **P0** (Launch Blocker)
- **Estimated Effort:** 1 Hour

### 1. Problem Statement
`DELETE /api/v1/rider/orders/:orderId/cancel` updates orders without verifying that the authenticated user owns the booking. Anyone can cancel arbitrary trips.

### 2. Code Modification
In `workers/api/src/routes/orders.ts#L245`:
```ts
orders.delete('/api/v1/rider/orders/:orderId/cancel', async (c) => {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user?.user_id) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const orderId = c.req.param('orderId');
  const sql = getDb(c.env, { write: true });

  const rows = await sql<{ id: string; driver_id: string | null; city_prefix: string; status: string }[]>`
    UPDATE orders
    SET status = 'CANCELLED',
        cancelled_at = now(),
        cancelled_by = 'RIDER'
    WHERE id = ${orderId}::uuid
      AND customer_id = ${user.user_id}::uuid
      AND status IN ('CREATED', 'ASSIGNED')
    RETURNING id, driver_id, city_prefix, status
  `;

  if (rows.length === 0) {
    return c.json({ success: false, error: 'Order not found, already started, or unauthorized' }, 404);
  }

  // Release driver if assigned
  if (rows[0].driver_id) {
    const city = rows[0].city_prefix || c.env.CITY_PREFIX || 'KOL';
    await c.env.CITY_DISPATCH_DO.getByName(city).setDriverStatus(rows[0].driver_id, 'ONLINE_AVAILABLE');
  }

  return c.json({ success: true, message: 'Order cancelled successfully' });
});
```

### 3. Acceptance Criteria & Test Cases
- **TC-005.1:** User A attempting to cancel User B's order receives HTTP 404.
- **TC-005.2:** Canceling an `IN_TRANSIT` trip returns 404 / 400 (cannot cancel once started).
- **TC-005.3:** Canceling an `ASSIGNED` trip frees the assigned driver back to `ONLINE_AVAILABLE`.
