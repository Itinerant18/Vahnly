import { Hono } from 'hono';
import type { Env, AuthClaims } from '../types';
import { getDb } from '../services/db';
import { signJwt, verifyFirebaseIdToken, hashPassword, verifyPassword, verifyGoogleOrFirebaseToken, verifyJwt, verifyPhoneVerificationToken } from '../services/auth';
import { sendStytchOTP, verifyStytchOTP, toE164, isTestNumber } from '../services/stytch';

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
// 1b. Driver Google Login & Two-Step Registration
// ---------------------------------------------------------------------------
auth.post('/api/v1/driver/login/google', async (c) => {
  try {
    const body = await c.req.json<{
      id_token: string;
      phone?: string;
      city_prefix?: string;
      name?: string;
      phone_token?: string;
    }>().catch(() => null);

    if (!body?.id_token) {
      return c.json({ success: false, code: 'BAD_REQUEST', error: 'id_token required' }, 400);
    }

    const projectId = c.env.FIREBASE_PROJECT_ID || 'vahnly-platform';
    const googleProfile = await verifyGoogleOrFirebaseToken(body.id_token, projectId, c.env.CONFIG);

    if (!googleProfile?.email) {
      return c.json({ success: false, code: 'INVALID_TOKEN', error: 'Invalid Google authentication token' }, 401);
    }

    const sql = getDb(c.env, { write: true });
    const sessionStub = c.env.SESSION_DO.getByName('global-sessions');

    // 1. Check if driver already exists by verified Google email
    const existing = await sql<{
      id: string;
      name: string;
      phone: string;
      email: string | null;
      city_prefix: string;
      is_verified: boolean;
      current_state: string;
      phone_verified: boolean;
    }[]>`
      SELECT id, name, phone, email, city_prefix, is_verified, current_state, phone_verified
      FROM drivers
      WHERE LOWER(email) = ${googleProfile.email.toLowerCase()}
        AND ${Date.now()}::bigint > 0
      LIMIT 1
    `;

    if (existing.length > 0) {
      const driver = existing[0];
      const claims: AuthClaims = {
        user_id: driver.id,
        role: 'DRIVER',
        city_scope: driver.city_prefix,
        phone_verified: driver.phone_verified ?? true,
      };

      const token = await signJwt(claims, c.env.JWT_SECRET_SIGNING_KEY);
      const refreshToken = crypto.randomUUID();
      await sessionStub.storeRefreshToken(refreshToken, driver.id, 'DRIVER', Date.now() + 30 * 86400 * 1000);

      return c.json({
        success: true,
        registered: true,
        token,
        refresh_token: refreshToken,
        role: 'DRIVER',
        driver_id: driver.id,
        name: driver.name,
        phone: driver.phone,
        phone_verified: driver.phone_verified ?? true,
        user: {
          id: driver.id,
          name: driver.name,
          phone: driver.phone,
          role: 'DRIVER',
          phone_verified: driver.phone_verified ?? true,
          current_state: driver.current_state,
        },
      });
    }

    // 2. Driver does not exist yet. Check if registration payload + phone_token provided.
    if (!body.phone_token) {
      return c.json({
        success: true,
        registered: false,
        email: googleProfile.email,
        name: body.name || googleProfile.name || '',
      });
    }

    // 3. Verify cryptographic phone_token
    const phoneResult = await verifyPhoneVerificationToken(
      body.phone_token,
      c.env.JWT_SECRET_SIGNING_KEY,
      projectId,
      c.env.CONFIG
    );

    if (!phoneResult.valid) {
      return c.json({ success: false, code: 'INVALID_PHONE_TOKEN', error: phoneResult.error || 'Invalid or expired phone verification token' }, 400);
    }

    const verifiedPhone = phoneResult.phone || (body.phone ? toE164(body.phone) : '');
    if (!verifiedPhone) {
      return c.json({ success: false, code: 'PHONE_REQUIRED', error: 'Valid phone number is required' }, 400);
    }

    const e164 = toE164(verifiedPhone);
    const cleanDigits = verifiedPhone.replace(/\D/g, '');
    const raw10Digits = cleanDigits.length >= 10 ? cleanDigits.slice(-10) : cleanDigits;
    const driverName = (body.name || googleProfile.name || 'New Driver').trim();
    const cityPrefix = body.city_prefix || c.env.CITY_PREFIX || 'KOL';

    // 4. Check if driver already exists with this phone
    const existingByPhone = await sql<{
      id: string;
      name: string;
      phone: string;
      city_prefix: string;
      is_verified: boolean;
      current_state: string;
    }[]>`
      SELECT id, name, phone, city_prefix, is_verified, current_state
      FROM drivers
      WHERE phone = ${e164} OR phone = ${raw10Digits}
      LIMIT 1
    `;

    let driverId = '';
    let currentState = 'OFFLINE';

    if (existingByPhone.length > 0) {
      driverId = existingByPhone[0].id;
      currentState = existingByPhone[0].current_state;
      await sql`
        UPDATE drivers
        SET email = ${googleProfile.email.toLowerCase()},
            name = COALESCE(NULLIF(name, 'New Driver'), ${driverName}),
            phone_verified = true,
            updated_at = NOW()
        WHERE id = ${driverId}::uuid
      `;
    } else {
      const created = await sql<{ id: string }[]>`
        INSERT INTO drivers (
          name,
          phone,
          email,
          city_prefix,
          current_state,
          is_verified,
          phone_verified,
          dl_number
        ) VALUES (
          ${driverName},
          ${e164},
          ${googleProfile.email.toLowerCase()},
          ${cityPrefix},
          'OFFLINE',
          false,
          true,
          'PENDING'
        )
        RETURNING id
      `;
      driverId = created[0].id;
    }

    const claims: AuthClaims = {
      user_id: driverId,
      role: 'DRIVER',
      city_scope: cityPrefix,
      phone_verified: true,
    };

    const token = await signJwt(claims, c.env.JWT_SECRET_SIGNING_KEY);
    const refreshToken = crypto.randomUUID();
    await sessionStub.storeRefreshToken(refreshToken, driverId, 'DRIVER', Date.now() + 30 * 86400 * 1000);

    return c.json({
      success: true,
      registered: true,
      token,
      refresh_token: refreshToken,
      role: 'DRIVER',
      driver_id: driverId,
      name: driverName,
      phone: e164,
      phone_verified: true,
      user: {
        id: driverId,
        name: driverName,
        phone: e164,
        role: 'DRIVER',
        phone_verified: true,
        current_state: currentState,
      },
    });
  } catch (err: any) {
    console.error('[DriverGoogleLogin] Failed:', err);
    return c.json({ success: false, code: 'INTERNAL_ERROR', error: err.message || 'Google login failed' }, 500);
  }
});

// ---------------------------------------------------------------------------
// 1c. Rider Google Login & Registration
// ---------------------------------------------------------------------------
auth.post('/api/v1/rider/auth/login/google', async (c) => {
  try {
    const body = await c.req.json<{
      id_token: string;
      phone?: string;
      phone_token?: string;
      name?: string;
      referred_by_code?: string;
    }>().catch(() => null);

    if (!body?.id_token) {
      return c.json({ success: false, code: 'BAD_REQUEST', error: 'id_token required' }, 400);
    }

    const projectId = c.env.FIREBASE_PROJECT_ID || 'vahnly-platform';
    const googleProfile = await verifyGoogleOrFirebaseToken(body.id_token, projectId, c.env.CONFIG);

    if (!googleProfile?.email) {
      return c.json({ success: false, code: 'INVALID_TOKEN', error: 'Invalid Google authentication token' }, 401);
    }

    const sql = getDb(c.env, { write: true });
    const sessionStub = c.env.SESSION_DO.getByName('global-sessions');

    const existing = await sql<{
      id: string;
      name: string;
      phone: string;
      email: string | null;
      phone_verified: boolean;
    }[]>`
      SELECT id, name, phone, email, phone_verified
      FROM riders
      WHERE LOWER(email) = ${googleProfile.email.toLowerCase()}
        AND ${Date.now()}::bigint > 0
      LIMIT 1
    `;

    if (existing.length > 0) {
      const rider = existing[0];
      const claims: AuthClaims = {
        user_id: rider.id,
        role: 'RIDER',
        phone_verified: rider.phone_verified ?? true,
      };

      const token = await signJwt(claims, c.env.JWT_SECRET_SIGNING_KEY);
      const refreshToken = crypto.randomUUID();
      await sessionStub.storeRefreshToken(refreshToken, rider.id, 'RIDER', Date.now() + 30 * 86400 * 1000);

      return c.json({
        success: true,
        registered: true,
        token,
        refresh_token: refreshToken,
        is_new_rider: false,
        rider: {
          id: rider.id,
          name: rider.name,
          email: rider.email,
          phone: rider.phone,
        },
      });
    }

    // 2. Rider not found by email. Check if phone_token provided.
    if (!body.phone_token) {
      return c.json({
        success: true,
        registered: false,
        email: googleProfile.email,
        name: body.name || googleProfile.name || '',
      });
    }

    // 3. Verify cryptographic phone_token
    const phoneResult = await verifyPhoneVerificationToken(
      body.phone_token,
      c.env.JWT_SECRET_SIGNING_KEY,
      projectId,
      c.env.CONFIG
    );

    if (!phoneResult.valid) {
      return c.json({ success: false, code: 'INVALID_PHONE_TOKEN', error: phoneResult.error || 'Invalid or expired phone verification token' }, 400);
    }

    const verifiedPhone = phoneResult.phone || (body.phone ? toE164(body.phone) : '');
    if (!verifiedPhone) {
      return c.json({ success: false, code: 'PHONE_REQUIRED', error: 'Valid phone number is required' }, 400);
    }

    const e164 = toE164(verifiedPhone);
    const cleanDigits = verifiedPhone.replace(/\D/g, '');
    const raw10Digits = cleanDigits.length >= 10 ? cleanDigits.slice(-10) : cleanDigits;
    const riderName = (body.name || googleProfile.name || 'New Rider').trim();

    // 4. Check if rider already exists with this phone
    const existingByPhone = await sql<{
      id: string;
      name: string;
      phone: string;
    }[]>`
      SELECT id, name, phone
      FROM riders
      WHERE phone = ${e164} OR phone = ${raw10Digits}
      LIMIT 1
    `;

    let riderId = '';
    let isNewRider = false;

    if (existingByPhone.length > 0) {
      riderId = existingByPhone[0].id;
      await sql`
        UPDATE riders
        SET email = ${googleProfile.email.toLowerCase()},
            name = COALESCE(NULLIF(name, 'Rider'), ${riderName}),
            phone_verified = true,
            updated_at = NOW()
        WHERE id = ${riderId}::uuid
      `;
    } else {
      isNewRider = true;
      const created = await sql<{ id: string }[]>`
        INSERT INTO riders (
          name,
          email,
          phone,
          phone_verified,
          is_active,
          referral_code
        ) VALUES (
          ${riderName},
          ${googleProfile.email.toLowerCase()},
          ${e164},
          true,
          true,
          ${body.referred_by_code || null}
        )
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
      registered: true,
      token,
      refresh_token: refreshToken,
      is_new_rider: isNewRider,
      rider: {
        id: riderId,
        name: riderName,
        email: googleProfile.email,
        phone: e164,
      },
    });
  } catch (err: any) {
    console.error('[RiderGoogleLogin] Failed:', err);
    return c.json({ success: false, code: 'INTERNAL_ERROR', error: err.message || 'Google login failed' }, 500);
  }
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
  const body = await c.req.json<{ phone: string; channel?: 'sms' | 'whatsapp' }>().catch(() => null);
  if (!body?.phone) {
    return c.json({ success: false, code: 'BAD_REQUEST', error: 'phone required' }, 400);
  }

  const e164 = toE164(body.phone);
  const channel = body.channel === 'whatsapp' ? 'whatsapp' : 'sms';
  const sessionStub = c.env.SESSION_DO.getByName('global-sessions');

  if (!isTestNumber(e164)) {
    const count = await sessionStub.incrementOTP(`otp_rate:${e164}`, 600);
    if (count > 5) {
      return c.json({ success: false, code: 'RATE_LIMITED', error: 'Too many OTP attempts. Please wait 10 minutes.' }, 429);
    }
  }

  try {
    const stytchRes = await sendStytchOTP(c.env, e164, channel);
    if (stytchRes.method_id) {
      await sessionStub.setCachedValue(`stytch_method_id:${e164}`, stytchRes.method_id, 600);
    }

    const isTestMode = isTestNumber(e164) || stytchRes.method_id?.startsWith('dev-') || stytchRes.method_id?.startsWith('mock-');
    return c.json({
      success: true,
      message: isTestMode
        ? `[TEST MODE] Use code 123456 to verify (Carrier billing pending in Stytch)`
        : `OTP sent successfully via ${channel.toUpperCase()}`,
      channel,
      method_id: stytchRes.method_id,
      phone: e164,
      is_test_mode: isTestMode,
      test_code: isTestMode ? '123456' : undefined,
    });
  } catch (err: any) {
    return c.json({ success: false, code: 'OTP_SEND_FAILED', error: err.message || 'Failed to send OTP' }, 502);
  }
});

auth.post('/api/v1/driver/auth/verify-otp', async (c) => {
  try {
    const body = await c.req.json<{ phone: string; otp: string; method_id?: string }>().catch(() => null);
    if (!body?.phone || !body?.otp) {
      return c.json({ success: false, code: 'BAD_REQUEST', error: 'phone and otp required' }, 400);
    }

    const e164 = toE164(body.phone);
    const cleanDigits = body.phone.replace(/\D/g, '');
    const raw10Digits = cleanDigits.length >= 10 ? cleanDigits.slice(-10) : cleanDigits;
    const sessionStub = c.env.SESSION_DO.getByName('global-sessions');

    let methodId = body.method_id;
    if (!methodId) {
      methodId = (await sessionStub.getCachedValue(`stytch_method_id:${e164}`)) || undefined;
    }

    try {
      await verifyStytchOTP(c.env, {
        code: body.otp,
        method_id: methodId,
        phone: e164,
      });
    } catch (err: any) {
      return c.json({ success: false, code: 'INVALID_OTP', error: err.message || 'invalid or expired OTP' }, 400);
    }

    // Clear rate limit counter upon successful OTP verification
    await sessionStub.resetOTP(`otp_rate:${e164}`);

    const sql = getDb(c.env, { write: true });
    const likePattern = `%${cleanDigits}`;
    const rows = await sql<{
      id: string;
      name: string;
      phone: string;
      email: string | null;
      city_prefix: string;
      is_verified: boolean;
      current_state: string;
    }[]>`
      SELECT id, name, phone, email, city_prefix, is_verified, current_state
      FROM drivers
      WHERE phone = ${e164}
         OR phone = ${raw10Digits}
         OR phone = ${cleanDigits}
         OR phone = ${body.phone}
         OR phone LIKE ${likePattern}
      ORDER BY created_at ASC
      LIMIT 1
    `;

  let driverId = '';
  let isNewDriver = false;
  let driverName = 'New Driver';
  let cityPrefix = 'KOL';
  let isVerified = false;
  let currentState = 'OFFLINE';

  if (rows.length > 0) {
    const d = rows[0];
    driverId = d.id;
    driverName = d.name;
    cityPrefix = d.city_prefix;
    isVerified = d.is_verified;
    currentState = d.current_state;
  } else {
    isNewDriver = true;
    const created = await sql<{ id: string }[]>`
      INSERT INTO drivers (name, phone, city_prefix, current_state, is_verified, dl_number)
      VALUES (${driverName}, ${e164}, ${cityPrefix}, 'OFFLINE', false, 'PENDING')
      RETURNING id
    `;
    driverId = created[0].id;
  }

  const claims: AuthClaims = {
    user_id: driverId,
    role: 'DRIVER',
    city_scope: cityPrefix,
    phone_verified: true,
  };

  const token = await signJwt(claims, c.env.JWT_SECRET_SIGNING_KEY);
  const refreshToken = crypto.randomUUID();
  await sessionStub.storeRefreshToken(refreshToken, driverId, 'DRIVER', Date.now() + 30 * 86400 * 1000);

  // Issue cryptographic phone_token so client-app two-step registration can verify phone ownership
  const phoneTokenClaims: AuthClaims = {
    user_id: driverId,
    role: 'DRIVER',
    sub: e164,
    phone_verified: true,
  };
  const phoneToken = await signJwt(phoneTokenClaims, c.env.JWT_SECRET_SIGNING_KEY);

  return c.json({
    success: true,
    token,
    refresh_token: refreshToken,
    is_new_driver: isNewDriver,
    driver_id: driverId,
    role: 'DRIVER',
    name: driverName,
    phone: e164,
    phone_verified: true,
    phone_token: phoneToken,
    user: {
      id: driverId,
      name: driverName,
      phone: e164,
      role: 'DRIVER',
      phone_verified: true,
      current_state: currentState,
    },
    driver: {
      id: driverId,
      name: driverName,
      phone: e164,
      city_prefix: cityPrefix,
      is_verified: isVerified,
      current_state: currentState,
      phone_verified: true,
    },
  });
  } catch (err: any) {
    console.error('[DriverVerifyOTP] Internal Error:', err);
    return c.json({ success: false, code: 'INTERNAL_ERROR', error: err.message || 'Driver verification failed' }, 500);
  }
});

auth.post('/api/v1/driver/register', async (c) => {
  const body = await c.req.json<{
    name: string;
    phone: string;
    email?: string;
    password?: string;
    city_prefix?: string;
    dl_number?: string;
    referral_code?: string;
    referred_by_code?: string;
    phone_token?: string;
  }>().catch(() => null);

  if (!body?.phone || !body?.name) {
    return c.json({ success: false, code: 'BAD_REQUEST', error: 'phone and name required' }, 400);
  }

  const e164 = toE164(body.phone);
  const cleanDigits = body.phone.replace(/\D/g, '');
  const raw10Digits = cleanDigits.length >= 10 ? cleanDigits.slice(-10) : cleanDigits;
  const cityPrefix = body.city_prefix || c.env.CITY_PREFIX || 'KOL';
  const referral = body.referral_code || body.referred_by_code || null;
  const passwordHash = body.password ? await hashPassword(body.password) : null;
  const sql = getDb(c.env, { write: true });

  const existing = await sql<{ id: string }[]>`
    SELECT id FROM drivers WHERE phone = ${e164} OR phone = ${raw10Digits} LIMIT 1
  `;

  let driverId = '';
  if (existing.length > 0) {
    driverId = existing[0].id;
    await sql`
      UPDATE drivers
      SET name = ${body.name},
          email = COALESCE(${body.email || null}, email),
          password_hash = COALESCE(${passwordHash}, password_hash),
          city_prefix = ${cityPrefix},
          referral_code = COALESCE(${referral}, referral_code),
          updated_at = NOW()
      WHERE id = ${driverId}::uuid
    `;
  } else {
    const created = await sql<{ id: string }[]>`
      INSERT INTO drivers (name, phone, email, password_hash, city_prefix, current_state, is_verified, dl_number, referral_code)
      VALUES (${body.name}, ${e164}, ${body.email || null}, ${passwordHash}, ${cityPrefix}, 'OFFLINE', false, ${body.dl_number || 'PENDING'}, ${referral})
      RETURNING id
    `;
    driverId = created[0].id;
  }

  const claims: AuthClaims = {
    user_id: driverId,
    role: 'DRIVER',
    city_scope: cityPrefix,
    phone_verified: true,
  };

  const token = await signJwt(claims, c.env.JWT_SECRET_SIGNING_KEY);
  const refreshToken = crypto.randomUUID();
  const sessionStub = c.env.SESSION_DO.getByName('global-sessions');
  await sessionStub.storeRefreshToken(refreshToken, driverId, 'DRIVER', Date.now() + 30 * 86400 * 1000);

  return c.json({
    success: true,
    token,
    refresh_token: refreshToken,
    driver_id: driverId,
    role: 'DRIVER',
    name: body.name,
    phone: e164,
    phone_verified: true,
    user: {
      id: driverId,
      name: body.name,
      phone: e164,
      role: 'DRIVER',
      phone_verified: true,
    },
    driver: {
      id: driverId,
      name: body.name,
      phone: e164,
      city_prefix: cityPrefix,
      is_verified: false,
      current_state: 'OFFLINE',
    },
  });
});

auth.post('/api/v1/driver/auth/forgot-password', async (c) => {
  const body = await c.req.json<{ phone: string }>().catch(() => null);
  if (!body?.phone) {
    return c.json({ success: false, code: 'BAD_REQUEST', error: 'phone required' }, 400);
  }

  const e164 = toE164(body.phone);
  const sessionStub = c.env.SESSION_DO.getByName('global-sessions');

  const count = await sessionStub.incrementOTP(`otp_rate:${e164}`, 600);
  if (count > 5) {
    return c.json({ success: false, code: 'RATE_LIMITED', error: 'Too many OTP attempts. Please wait 10 minutes.' }, 429);
  }

  try {
    const stytchRes = await sendStytchOTP(c.env, e164, 'sms');
    if (stytchRes.method_id) {
      await sessionStub.setCachedValue(`stytch_method_id:${e164}`, stytchRes.method_id, 600);
    }
  } catch (err: any) {
    console.warn(`[ForgotPassword] Stytch send failed for ${e164}:`, err.message);
  }

  // Anti-enumeration: always return success message
  return c.json({
    success: true,
    message: 'If that number is registered, a reset code was sent.',
  });
});

auth.post('/api/v1/driver/auth/reset-password', async (c) => {
  const body = await c.req.json<{ phone: string; otp: string; new_password: string }>().catch(() => null);
  if (!body?.phone || !body?.otp || !body?.new_password) {
    return c.json({ success: false, code: 'BAD_REQUEST', error: 'phone, otp, and new_password required' }, 400);
  }

  if (body.new_password.length < 8) {
    return c.json({ success: false, code: 'WEAK_PASSWORD', error: 'Password must be at least 8 characters' }, 400);
  }

  const e164 = toE164(body.phone);
  const cleanDigits = body.phone.replace(/\D/g, '');
  const raw10Digits = cleanDigits.length >= 10 ? cleanDigits.slice(-10) : cleanDigits;
  const sessionStub = c.env.SESSION_DO.getByName('global-sessions');

  const methodId = (await sessionStub.getCachedValue(`stytch_method_id:${e164}`)) || undefined;

  try {
    await verifyStytchOTP(c.env, {
      code: body.otp,
      method_id: methodId,
      phone: e164,
    });
  } catch (err: any) {
    return c.json({ success: false, code: 'INVALID_OTP', error: err.message || 'invalid or expired OTP' }, 400);
  }

  const sql = getDb(c.env, { write: true });
  const rows = await sql<{
    id: string;
    name: string;
    phone: string;
    city_prefix: string;
    is_verified: boolean;
    current_state: string;
  }[]>`
    SELECT id, name, phone, city_prefix, is_verified, current_state
    FROM drivers
    WHERE phone = ${e164} OR phone = ${raw10Digits}
    LIMIT 1
  `;

  if (rows.length === 0) {
    return c.json({ success: false, code: 'NOT_FOUND', error: 'driver not registered' }, 404);
  }

  const driver = rows[0];
  const newHash = await hashPassword(body.new_password);

  await sql`
    UPDATE drivers
    SET password_hash = ${newHash},
        updated_at = NOW()
    WHERE id = ${driver.id}::uuid
  `;

  await sessionStub.resetOTP(`otp_rate:${e164}`);

  const claims: AuthClaims = {
    user_id: driver.id,
    role: 'DRIVER',
    city_scope: driver.city_prefix,
    phone_verified: true,
  };

  const token = await signJwt(claims, c.env.JWT_SECRET_SIGNING_KEY);
  const refreshToken = crypto.randomUUID();
  await sessionStub.storeRefreshToken(refreshToken, driver.id, 'DRIVER', Date.now() + 30 * 86400 * 1000);

  return c.json({
    success: true,
    token,
    refresh_token: refreshToken,
    driver_id: driver.id,
    role: 'DRIVER',
    name: driver.name,
    phone: driver.phone,
    phone_verified: true,
    user: {
      id: driver.id,
      name: driver.name,
      phone: driver.phone,
      role: 'DRIVER',
      phone_verified: true,
      current_state: driver.current_state,
    },
    driver: {
      id: driver.id,
      name: driver.name,
      phone: driver.phone,
      city_prefix: driver.city_prefix,
      is_verified: driver.is_verified,
      current_state: driver.current_state,
      phone_verified: true,
    },
  });
});

// ---------------------------------------------------------------------------
// 4. Rider Auth
// ---------------------------------------------------------------------------
auth.post('/api/v1/rider/auth/send-otp', async (c) => {
  const body = await c.req.json<{ phone: string; channel?: 'sms' | 'whatsapp' }>().catch(() => null);
  if (!body?.phone) {
    return c.json({ success: false, code: 'BAD_REQUEST', error: 'phone required' }, 400);
  }

  const e164 = toE164(body.phone);
  const channel = body.channel === 'whatsapp' ? 'whatsapp' : 'sms';
  const sessionStub = c.env.SESSION_DO.getByName('global-sessions');

  if (!isTestNumber(e164)) {
    const count = await sessionStub.incrementOTP(`rider_otp_rate:${e164}`, 600);
    if (count > 5) {
      return c.json({ success: false, code: 'RATE_LIMITED', error: 'Too many OTP attempts. Please wait.' }, 429);
    }
  }

  try {
    const stytchRes = await sendStytchOTP(c.env, e164, channel);
    if (stytchRes.method_id) {
      await sessionStub.setCachedValue(`stytch_rider_method_id:${e164}`, stytchRes.method_id, 600);
    }
    const isTestMode = isTestNumber(e164) || stytchRes.method_id?.startsWith('dev-') || stytchRes.method_id?.startsWith('mock-');
    return c.json({
      success: true,
      message: isTestMode
        ? `[TEST MODE] Use code 123456 to verify`
        : `OTP sent via ${channel.toUpperCase()}`,
      method_id: stytchRes.method_id,
      channel,
      phone: e164,
      is_test_mode: isTestMode,
      test_code: isTestMode ? '123456' : undefined,
    });
  } catch (err: any) {
    return c.json({ success: false, code: 'OTP_SEND_FAILED', error: err.message || 'Failed to send OTP' }, 502);
  }
});

auth.post('/api/v1/rider/auth/verify-otp', async (c) => {
  try {
    const body = await c.req.json<{ phone: string; otp: string; method_id?: string }>().catch(() => null);
    if (!body?.phone || !body?.otp) {
      return c.json({ success: false, code: 'BAD_REQUEST', error: 'phone and otp required' }, 400);
    }

    const e164 = toE164(body.phone);
    const cleanDigits = body.phone.replace(/\D/g, '');
    const raw10Digits = cleanDigits.length >= 10 ? cleanDigits.slice(-10) : cleanDigits;
    const sessionStub = c.env.SESSION_DO.getByName('global-sessions');

    let methodId = body.method_id;
    if (!methodId) {
      methodId = (await sessionStub.getCachedValue(`stytch_rider_method_id:${e164}`)) || undefined;
    }

    try {
      await verifyStytchOTP(c.env, {
        code: body.otp,
        method_id: methodId,
        phone: e164,
      });
    } catch (err: any) {
      return c.json({ success: false, code: 'INVALID_OTP', error: err.message || 'invalid OTP' }, 400);
    }

    await sessionStub.resetOTP(`rider_otp_rate:${e164}`);

    const sql = getDb(c.env, { write: true });
    const likePattern = `%${cleanDigits}`;
    const rows = await sql<{ id: string; name: string }[]>`
      SELECT id, name FROM riders
      WHERE phone = ${e164}
         OR phone = ${raw10Digits}
         OR phone = ${cleanDigits}
         OR phone = ${body.phone}
         OR phone LIKE ${likePattern}
      LIMIT 1
    `;

    let riderId = rows.length > 0 ? rows[0].id : '';
    let isNew = false;
    if (!riderId) {
      isNew = true;
      const created = await sql<{ id: string }[]>`
        INSERT INTO riders (name, phone, is_active)
        VALUES ('Rider', ${e164}, true)
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

    const phoneTokenClaims: AuthClaims = {
      user_id: riderId,
      role: 'RIDER',
      sub: e164,
      phone: e164,
      phone_verified: true,
    };
    const phoneToken = await signJwt(phoneTokenClaims, c.env.JWT_SECRET_SIGNING_KEY);

    return c.json({
      success: true,
      token,
      refresh_token: refreshToken,
      phone_token: phoneToken,
      is_new: isNew,
      rider: {
        id: riderId,
        phone: e164,
      },
    });
  } catch (err: any) {
    console.error('[RiderVerifyOTP] Internal Error:', err);
    return c.json({ success: false, code: 'INTERNAL_ERROR', error: err.message || 'Rider verification failed' }, 500);
  }
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
