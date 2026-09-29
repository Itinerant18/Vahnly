import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb } from '../services/db';

const health = new Hono<{ Bindings: Env }>();

health.get('/health', async (c) => {
  try {
    const sql = getDb(c.env);
    await sql`SELECT 1`;
    return c.json({ status: 'ok', timestamp: Date.now() });
  } catch (err) {
    return c.json({ status: 'degraded', error: String(err) }, 503);
  }
});

health.get('/ready', async (c) => {
  try {
    const sql = getDb(c.env);
    await sql`SELECT 1`;
    return c.json({ status: 'ok' });
  } catch (err) {
    return c.json({ status: 'degraded' }, 503);
  }
});

health.get('/api/v1/health/quota', async (c) => {
  let flags = null;
  if (c.env.CONFIG) {
    try {
      flags = await c.env.CONFIG.get('flags');
    } catch {}
  }

  return c.json({
    status: 'ok',
    environment: 'cloudflare-serverless',
    free_limits: {
      workers_requests_daily: 100000,
      durable_objects_requests_daily: 100000,
      queues_ops_daily: 10000,
      hyperdrive_queries_daily: 100000,
      kv_writes_daily: 1000,
      neon_storage_mb: 500,
    },
    flags_cached: !!flags,
    timestamp: Date.now(),
  });
});

export default health;
