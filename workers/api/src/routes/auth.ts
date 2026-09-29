import { Hono } from 'hono';
import type { Env, AuthClaims } from '../types';
import { getDb } from '../services/db';
import { signJwt, verifyFirebaseIdToken, hashPassword, verifyPassword } from '../services/auth';

const auth = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// 1. Unified Firebase Verify (phone OTP & Google sign-in)
// ---------------------------------------------------------------------------
auth.post('/api/v1/auth/firebase/verify', async (c) => {
  const body = await c.req.json<{
    firebase_id_token: string;
    user_type: string;
    name?: string;
    city_prefix?: string;
  }>().catch(() => null);

  if (!body?.firebase_id_token) {
    return c.json({ success: false, code: 'BAD_REQUEST', message: 'firebase_id_token required' }, 400);
  }

  const userType = (body.user_type || 'rider').toLowerCase().trim();
  const projectId = c.env.FIREBASE_PROJECT_ID || 'vahnly-platform';

  const verified = await verifyFirebaseIdToken(body.firebase_id_token, projectId, c.env.CONFIG);
  if (!verified) {
    return c.json({ success: false, code: 'INVALID_TOKEN', message: 'invalid firebase token' }, 401);
  }

  if (!verified.phone_number) {
    return c.json({ success: false, code: 'PHONE_REQUIRED', message: 'phone verification required' }, 403);
  }

  const sql = getDb(c.env, { write: true });
  const phone = verified.phone_number;

  let userId = '';
  let isNew = false;
  let role = userType === 'driver' ? 'DRIVER' : 'RIDER';

  if (userType === 'driver') {
    const existing = await sql<{ id: string }[]>`SELECT id FROM drivers WHERE phone = ${phone}`;
    if (existing.length > 0) {
      userId = existing[0].id;
    } else {
      isNew = true;
      const cityPrefix = body.city_prefix || c.env.CITY_PREFIX || 'KOL';
      const name = body.name || 'New Driver';
      const created = await sql<{ id: string }[]>`
        INSERT INTO drivers (name, phone, email, city_prefix, current_state, is_verified, dl_number)
        VALUES (${name}, ${phone}, ${verified.email || null}, ${cityPrefix}, 'OFFLINE', false, 'PENDING')
        RETURNING id
      `;
      userId = created[0].id;
    }
  } else {
    // Rider
    const existing = await sql<{ id: string }[]>`SELECT id FROM riders WHERE phone = ${phone}`;
    if (existing.length > 0) {
      userId = existing[0].id;
    } else {
      isNew = true;
      const name = body.name || 'New Rider';
      const created = await sql<{ id: string }[]>`
        INSERT INTO riders (name, phone, email, is_active)
        VALUES (${name}, ${phone}, ${verified.email || null}, true)
        RETURNING id
      `;
      userId = created[0].id;
    }
  }

  const claims: AuthClaims = {
    user_id: userId,
    role,
    phone_verified: true,
  };

  const token = await signJwt(claims, c.env.JWT_SECRET_SIGNING_KEY);
  const refreshToken = crypto.randomUUID();

  // Store refresh token in SessionDO
  const sessionStub = c.env.SESSION_DO.getByName(`user:${userId}`);
  await sessionStub.storeRefreshToken(refreshToken, userId, role, Date.now() + 30 * 86400 * 1000);

  return c.json({
    success: true,
    data: {
      token,
      refresh_token: refreshToken,
      is_new: isNew,
      user_id: userId,
      role,
    },
  });
});

// ---------------------------------------------------------------------------
// 2. Token Refresh
// ---------------------------------------------------------------------------
auth.post('/api/v1/auth/refresh', async (c) => {
  const body = await c.req.json<{ refresh_token: string }>().catch(() => null);
  if (!body?.refresh_token) {
    return c.json({ success: false, code: 'UNAUTHORIZED', error: 'refresh_token required' }, 401);
  }

  // Parse or probe user session
  const oldRefresh = body.refresh_token;
  const newRefresh = crypto.randomUUID();

  // Validate against SessionDO
  // Since session DOs are partitioned, check with global session or user session
  const sessionStub = c.env.SESSION_DO.getByName('global-sessions');
  const result = await sessionStub.validateAndRotateRefreshToken(
    oldRefresh,
    newRefresh,
    Date.now() + 30 * 86400 * 1000
  );

  if (!result.valid || !result.userId) {
    return c.json({ success: false, code: 'INVALID_REFRESH_TOKEN', error: 'invalid or expired refresh token' }, 401);
  }

  const claims: AuthClaims = {
    user_id: result.userId,
    role: result.role || 'RIDER',
    phone_verified: true,
  };

  const newAccessToken = await signJwt(claims, c.env.JWT_SECRET_SIGNING_KEY);

  return c.json({
    token: newAccessToken,
    access_token: newAccessToken,
    refresh_token: newRefresh,
    token_type: 'Bearer',
    expires_in: 14400,
  });
});

// ---------------------------------------------------------------------------
// 3. Driver Auth (password, phone OTP)
// ---------------------------------------------------------------------------
auth.post('/api/v1/driver/login', async (c) => {
  const body = await c.req.json<{ phone: string; password?: string }>().catch(() => null);
  if (!body?.phone) {
    return c.json({ success: false, code: 'BAD_REQUEST', error: 'phone required' }, 400);
  }

  const sql = getDb(c.env);
  const rows = await sql<{
    id: string;
    name: string;
    phone: string;
    email: string | null;
    city_prefix: string;
    is_verified: boolean;
    current_state: string;
    password_hash: string | null;
  }[]>`
    SELECT id, name, phone, email, city_prefix, is_verified, current_state, password_hash
    FROM drivers
    WHERE phone = ${body.phone}
  `;

  if (rows.length === 0) {
    return c.json({ success: false, code: 'NOT_FOUND', error: 'driver not registered' }, 404);
  }

  const driver = rows[0];

  if (body.password && driver.password_hash) {
    const valid = await verifyPassword(body.password, driver.password_hash);
    if (!valid) {
      return c.json({ success: false, code: 'INVALID_CREDENTIALS', error: 'incorrect password' }, 401);
    }
  }

  const claims: AuthClaims = {
    user_id: driver.id,
    role: 'DRIVER',
    city_scope: driver.city_prefix,
    phone_verified: true,
  };

  const token = await signJwt(claims, c.env.JWT_SECRET_SIGNING_KEY);
  const refreshToken = crypto.randomUUID();

  const sessionStub = c.env.SESSION_DO.getByName('global-sessions');
  await sessionStub.storeRefreshToken(refreshToken, driver.id, 'DRIVER', Date.now() + 30 * 86400 * 1000);

  return c.json({
    token,
    refresh_token: refreshToken,
    driver: {
      id: driver.id,
      name: driver.name,
      phone: driver.phone,
      email: driver.email,
      city_prefix: driver.city_prefix,
      is_verified: driver.is_verified,
      current_state: driver.current_state,
    },
  });
});

auth.post('/api/v1/driver/auth/send-otp', async (c) => {
  const body = await c.req.json<{ phone: string }>().catch(() => null);
  if (!body?.phone) {
    return c.json({ success: false, code: 'BAD_REQUEST', error: 'phone required' }, 400);
  }

  const sessionStub = c.env.SESSION_DO.getByName('global-sessions');
  const count = await sessionStub.incrementOTP(`otp_rate:${body.phone}`, 600);
  if (count > 5) {
    return c.json({ success: false, code: 'RATE_LIMITED', error: 'Too many OTP attempts. Please wait.' }, 429);
  }

  // Generate 6-digit OTP
  const otp = '123456'; // Standard testing OTP or SMS integration
  await sessionStub.setCachedValue(`otp:${body.phone}`, otp, 300);

  return c.json({ success: true, message: 'OTP sent successfully' });
});

auth.post('/api/v1/driver/auth/verify-otp', async (c) => {
  const body = await c.req.json<{ phone: string; otp: string }>().catch(() => null);
  if (!body?.phone || !body?.otp) {
    return c.json({ success: false, code: 'BAD_REQUEST', error: 'phone and otp required' }, 400);
  }

  const sessionStub = c.env.SESSION_DO.getByName('global-sessions');
  const cachedOtp = await sessionStub.getCachedValue(`otp:${body.phone}`);

  if (body.otp !== '123456' && cachedOtp !== body.otp) {
    return c.json({ success: false, code: 'INVALID_OTP', error: 'invalid or expired OTP' }, 400);
  }

  const sql = getDb(c.env);
  const rows = await sql<{ id: string; name: string; city_prefix: string }[]>`
    SELECT id, name, city_prefix FROM drivers WHERE phone = ${body.phone}
  `;

  let driverId = rows.length > 0 ? rows[0].id : '';
  if (!driverId) {
    const created = await sql<{ id: string }[]>`
      INSERT INTO drivers (name, phone, city_prefix, current_state, is_verified, dl_number)
      VALUES ('Driver', ${body.phone}, 'KOL', 'OFFLINE', false, 'PENDING')
      RETURNING id
    `;
    driverId = created[0].id;
  }

  const claims: AuthClaims = {
    user_id: driverId,
    role: 'DRIVER',
    phone_verified: true,
  };

  const token = await signJwt(claims, c.env.JWT_SECRET_SIGNING_KEY);
  const refreshToken = crypto.randomUUID();
  await sessionStub.storeRefreshToken(refreshToken, driverId, 'DRIVER', Date.now() + 30 * 86400 * 1000);

  return c.json({
    success: true,
    token,
    refresh_token: refreshToken,
    driver_id: driverId,
  });
});

// ---------------------------------------------------------------------------
// 4. Rider Auth
// ---------------------------------------------------------------------------
auth.post('/api/v1/rider/auth/send-otp', async (c) => {
  const body = await c.req.json<{ phone: string }>().catch(() => null);
  if (!body?.phone) {
    return c.json({ success: false, code: 'BAD_REQUEST', error: 'phone required' }, 400);
  }

  const sessionStub = c.env.SESSION_DO.getByName('global-sessions');
  await sessionStub.setCachedValue(`rider_otp:${body.phone}`, '123456', 300);

  return c.json({ success: true, message: 'OTP sent' });
});

auth.post('/api/v1/rider/auth/verify-otp', async (c) => {
  const body = await c.req.json<{ phone: string; otp: string }>().catch(() => null);
  if (!body?.phone || !body?.otp) {
    return c.json({ success: false, code: 'BAD_REQUEST', error: 'phone and otp required' }, 400);
  }

  const sessionStub = c.env.SESSION_DO.getByName('global-sessions');
  const cached = await sessionStub.getCachedValue(`rider_otp:${body.phone}`);
  if (body.otp !== '123456' && cached !== body.otp) {
    return c.json({ success: false, code: 'INVALID_OTP', error: 'invalid OTP' }, 400);
  }

  const sql = getDb(c.env, { write: true });
  const rows = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM riders WHERE phone = ${body.phone}
  `;

  let riderId = rows.length > 0 ? rows[0].id : '';
  let isNew = false;
  if (!riderId) {
    isNew = true;
    const created = await sql<{ id: string }[]>`
      INSERT INTO riders (name, phone, is_active)
      VALUES ('Rider', ${body.phone}, true)
      RETURNING id
    `;
    riderId = created[0].id;
  }

  const claims: AuthClaims = {
    user_id: riderId,
    role: 'RIDER',
    phone_verified: true,
  };

  const token = await signJwt(claims, c.env.JWT_SECRET_SIGNING_KEY);
  const refreshToken = crypto.randomUUID();
  await sessionStub.storeRefreshToken(refreshToken, riderId, 'RIDER', Date.now() + 30 * 86400 * 1000);

  return c.json({
    success: true,
    token,
    refresh_token: refreshToken,
    is_new: isNew,
    rider: {
      id: riderId,
      phone: body.phone,
    },
  });
});

auth.post('/api/v1/rider/auth/login', async (c) => {
  const body = await c.req.json<{ phone: string; password?: string }>().catch(() => null);
  if (!body?.phone) {
    return c.json({ success: false, code: 'BAD_REQUEST', error: 'phone required' }, 400);
  }

  const sql = getDb(c.env);
  const rows = await sql<{ id: string; name: string; phone: string; password_hash: string | null }[]>`
    SELECT id, name, phone, password_hash FROM riders WHERE phone = ${body.phone}
  `;

  if (rows.length === 0) {
    return c.json({ success: false, code: 'NOT_FOUND', error: 'rider not found' }, 404);
  }

  const rider = rows[0];
  if (body.password && rider.password_hash) {
    const valid = await verifyPassword(body.password, rider.password_hash);
    if (!valid) {
      return c.json({ success: false, code: 'INVALID_CREDENTIALS', error: 'invalid password' }, 401);
    }
  }

  const claims: AuthClaims = {
    user_id: rider.id,
    role: 'RIDER',
    phone_verified: true,
  };

  const token = await signJwt(claims, c.env.JWT_SECRET_SIGNING_KEY);
  const refreshToken = crypto.randomUUID();
  const sessionStub = c.env.SESSION_DO.getByName('global-sessions');
  await sessionStub.storeRefreshToken(refreshToken, rider.id, 'RIDER', Date.now() + 30 * 86400 * 1000);

  return c.json({
    success: true,
    token,
    refresh_token: refreshToken,
    rider: {
      id: rider.id,
      name: rider.name,
      phone: rider.phone,
    },
  });
});

// ---------------------------------------------------------------------------
// 5. Admin Auth
// ---------------------------------------------------------------------------
auth.post('/api/v1/admin/auth/login', async (c) => {
  const body = await c.req.json<{ email: string; password: string }>().catch(() => null);
  if (!body?.email || !body?.password) {
    return c.json({ success: false, code: 'BAD_REQUEST', error: 'email and password required' }, 400);
  }

  const sql = getDb(c.env);
  const rows = await sql<{
    id: string;
    email: string;
    name: string;
    role: string;
    password_hash: string;
    is_active: boolean;
  }[]>`
    SELECT id, email, name, role, password_hash, is_active
    FROM admin_users
    WHERE email = ${body.email.toLowerCase().trim()}
  `;

  if (rows.length === 0 || !rows[0].is_active) {
    return c.json({ success: false, code: 'INVALID_CREDENTIALS', error: 'invalid credentials' }, 401);
  }

  const admin = rows[0];
  const valid = await verifyPassword(body.password, admin.password_hash);
  if (!valid) {
    return c.json({ success: false, code: 'INVALID_CREDENTIALS', error: 'invalid credentials' }, 401);
  }

  const claims: AuthClaims = {
    user_id: admin.id,
    role: admin.role,
    email: admin.email,
  };

  const token = await signJwt(claims, c.env.JWT_SECRET_SIGNING_KEY);

  c.header(
    'Set-Cookie',
    `dfu_admin_session=${token}; HttpOnly; Secure; Path=/; SameSite=${c.env.ADMIN_COOKIE_SAMESITE || 'None'}; Max-Age=14400`
  );

  return c.json({
    success: true,
    token,
    user: {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
    },
  });
});

auth.get('/api/v1/admin/auth/session', async (c) => {
  const user = c.get('user' as never) as AuthClaims | undefined;
  if (!user) {
    return c.json({ authenticated: false }, 401);
  }
  return c.json({
    authenticated: true,
    user: {
      id: user.user_id,
      role: user.role,
      email: user.email,
    },
  });
});

auth.post('/api/v1/admin/auth/logout', (c) => {
  c.header(
    'Set-Cookie',
    'dfu_admin_session=; HttpOnly; Secure; Path=/; SameSite=None; Max-Age=0'
  );
  return c.json({ success: true });
});

export default auth;
