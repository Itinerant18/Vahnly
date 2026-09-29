import { Hono } from 'hono';
import type { Env, AuthClaims } from '../types';

const stream = new Hono<{ Bindings: Env; Variables: { user?: AuthClaims } }>();

// ---------------------------------------------------------------------------
// 1. Single-use WebSocket Ticket Minting
// ---------------------------------------------------------------------------
async function handleIssueTicket(c: any) {
  const user = c.get('user') as AuthClaims | undefined;
  if (!user) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const buf = crypto.getRandomValues(new Uint8Array(32));
  const ticket = Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');

  const sessionStub = c.env.SESSION_DO.getByName('global-sessions');
  await sessionStub.storeTicket(
    ticket,
    {
      user_id: user.user_id,
      role: user.role,
      city_scope: user.city_scope || c.env.CITY_PREFIX || 'KOL',
    },
    30
  );

  return c.json({
    ticket,
    expires_in_seconds: 30,
  });
}

stream.post('/api/v1/ws/ticket', handleIssueTicket);
stream.post('/api/v1/ws-ticket', handleIssueTicket);

// ---------------------------------------------------------------------------
// 2. Dispatch WebSocket Stream (Driver & Admin)
// ---------------------------------------------------------------------------
stream.get('/api/v1/dispatch/stream', async (c) => {
  const ticket = c.req.query('ticket');
  const orderId = c.req.query('order_id') || 'global-sos';

  if (!ticket) {
    return c.text('ws_ticket_required', 401);
  }

  const sessionStub = c.env.SESSION_DO.getByName('global-sessions');
  const payload = await sessionStub.consumeTicket(ticket);
  if (!payload) {
    return c.text('invalid_or_expired_ws_ticket', 401);
  }

  const data = payload as { role?: string; user_id?: string };
  const role = data.role?.toLowerCase() || 'driver';
  const userId = data.user_id || 'unknown';

  const orderStreamStub = c.env.ORDER_STREAM_DO.getByName(orderId);
  const targetUrl = new URL(c.req.url);
  targetUrl.searchParams.set('role', role);
  targetUrl.searchParams.set('user_id', userId);

  const forwardReq = new Request(targetUrl.toString(), c.req.raw);
  return orderStreamStub.fetch(forwardReq);
});

// ---------------------------------------------------------------------------
// 3. Rider WebSocket Stream
// ---------------------------------------------------------------------------
stream.get('/ws/rider', async (c) => {
  const ticket = c.req.query('ticket');
  if (!ticket) {
    return c.text('ws_ticket_required', 401);
  }

  const sessionStub = c.env.SESSION_DO.getByName('global-sessions');
  const payload = await sessionStub.consumeTicket(ticket);
  if (!payload) {
    return c.text('invalid_or_expired_ws_ticket', 401);
  }

  const data = payload as { role?: string; user_id?: string };
  const riderId = data.user_id || 'unknown';
  const riderStreamStub = c.env.RIDER_STREAM_DO.getByName(riderId);

  const targetUrl = new URL(c.req.url);
  targetUrl.searchParams.set('rider_id', riderId);

  const forwardReq = new Request(targetUrl.toString(), c.req.raw);
  return riderStreamStub.fetch(forwardReq);
});

// ---------------------------------------------------------------------------
// 4. Heatmap SSE Stream (Admin Control Room)
// ---------------------------------------------------------------------------
stream.get('/api/v1/analytics/heatmap', async (c) => {
  const city = c.req.query('city_prefix') || c.env.CITY_PREFIX || 'KOL';
  const heatmapStub = c.env.HEATMAP_DO.getByName(city);
  return heatmapStub.handleSSE(c.req.raw);
});

export default stream;
