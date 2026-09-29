import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, AuthClaims } from './types';
import { verifyJwt } from './services/auth';
import { handleQueueBatch } from './queue';

// Import Durable Objects
import { CityDispatchDO } from './durable-objects/CityDispatchDO';
import { OrderStreamDO } from './durable-objects/OrderStreamDO';
import { RiderStreamDO } from './durable-objects/RiderStreamDO';
import { HeatmapDO } from './durable-objects/HeatmapDO';
import { RateLimitDO } from './durable-objects/RateLimitDO';
import { SessionDO } from './durable-objects/SessionDO';
import { LockDO } from './durable-objects/LockDO';

// Import Workflows
import { PayoutBatchWorkflow } from './workflows/PayoutBatchWorkflow';
import { DocExpiryWorkflow } from './workflows/DocExpiryWorkflow';
import { WeeklyBackupWorkflow } from './workflows/WeeklyBackupWorkflow';

// Import Routes
import health from './routes/health';
import config from './routes/config';
import auth from './routes/auth';
import orders from './routes/orders';
import driver from './routes/driver';
import rider from './routes/rider';
import admin from './routes/admin';
import files from './routes/files';
import stream from './routes/stream';
import payments from './routes/payments';

const app = new Hono<{ Bindings: Env; Variables: { user?: AuthClaims } }>();

// ---------------------------------------------------------------------------
// 1. Global Middleware: Security Headers & CORS
// ---------------------------------------------------------------------------
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
});

app.use('*', async (c, next) => {
  const allowed = (c.env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
  const corsMiddleware = cors({
    origin: (origin) => {
      if (!origin || allowed.length === 0) return origin;
      if (allowed.includes(origin)) return origin;
      return null;
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Webhook-Signature', 'X-Signature'],
    exposeHeaders: ['Content-Length', 'X-Request-Id'],
    maxAge: 86400,
  });
  return corsMiddleware(c, next);
});

// ---------------------------------------------------------------------------
// 2. Authentication & Identity Extraction Middleware
// ---------------------------------------------------------------------------
app.use('*', async (c, next) => {
  let token = '';

  const authHeader = c.req.header('Authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    token = authHeader.slice(7).trim();
  }

  if (!token) {
    // Check HttpOnly admin cookie
    const cookieHeader = c.req.header('Cookie') || '';
    const match = cookieHeader.match(/dfu_admin_session=([^;]+)/);
    if (match) {
      token = match[1];
    }
  }

  if (token && c.env.JWT_SECRET_SIGNING_KEY) {
    const claims = await verifyJwt(token, c.env.JWT_SECRET_SIGNING_KEY);
    if (claims) {
      c.set('user', claims);
    }
  }

  await next();
});

// ---------------------------------------------------------------------------
// 3. Rate Limiting Middleware (via RateLimitDO)
// ---------------------------------------------------------------------------
app.use('/api/v1/auth/*', async (c, next) => {
  const clientIP = c.req.header('CF-Connecting-IP') || '127.0.0.1';
  const limiterStub = c.env.RATE_LIMIT_DO.getByName(`ip:${clientIP}`);
  const result = await limiterStub.checkLimit(100, 10); // 100 req / 10 s

  c.header('X-RateLimit-Limit', '100');
  c.header('X-RateLimit-Remaining', String(result.remaining));
  c.header('X-RateLimit-Reset', String(result.reset));

  if (!result.allowed) {
    return c.json({ error: 'Too many requests. Please try again later.' }, 429);
  }

  await next();
});

// ---------------------------------------------------------------------------
// 4. Idempotency Middleware (for mutating orders/payments via SessionDO)
// ---------------------------------------------------------------------------
app.use('*', async (c, next) => {
  const idemKey = c.req.header('Idempotency-Key');
  if (!idemKey || c.req.method === 'GET' || c.req.method === 'OPTIONS') {
    return next();
  }

  const sessionStub = c.env.SESSION_DO.getByName('global-sessions');
  const cached = await sessionStub.getIdempotency(idemKey);
  if (cached) {
    for (const [k, v] of Object.entries(cached.headers)) {
      c.header(k, v);
    }
    c.status(cached.statusCode as any);
    return c.body(cached.body);
  }

  await next();

  if (c.res.status >= 200 && c.res.status < 300) {
    const cloned = c.res.clone();
    const bodyText = await cloned.text();
    const headersMap: Record<string, string> = {};
    cloned.headers.forEach((v, k) => {
      headersMap[k] = v;
    });
    c.executionCtx.waitUntil(
      sessionStub.setIdempotency(idemKey, cloned.status, headersMap, bodyText, 86400)
    );
  }
});

// ---------------------------------------------------------------------------
// 5. Mount Route Handlers
// ---------------------------------------------------------------------------
app.route('/', health);
app.route('/', config);
app.route('/', auth);
app.route('/', orders);
app.route('/', driver);
app.route('/', rider);
app.route('/', admin);
app.route('/', files);
app.route('/', stream);
app.route('/', payments);

// Export Durable Object Classes for runtime binding
export {
  CityDispatchDO,
  OrderStreamDO,
  RiderStreamDO,
  HeatmapDO,
  RateLimitDO,
  SessionDO,
  LockDO,
};

// Export Workflow Classes
export {
  PayoutBatchWorkflow,
  DocExpiryWorkflow,
  WeeklyBackupWorkflow,
};

// Default entry point
export default {
  fetch: app.fetch,
  queue: handleQueueBatch,
};
