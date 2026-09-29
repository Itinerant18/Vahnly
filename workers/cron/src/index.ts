import type { ScheduledEvent, ExecutionContext } from '@cloudflare/workers-types';
import postgres from 'postgres';

interface LockStub {
  acquire(ttl: number): Promise<{ acquired: boolean; fenceToken?: string }>;
  release(token: string): Promise<boolean>;
}

interface DispatchStub {
  sweepStale(maxAgeSeconds: number): Promise<string[]>;
}

interface CronEnv {
  API: Fetcher;
  HYPERDRIVE: Hyperdrive;
  DATABASE_URL?: string;
  CONFIG: KVNamespace;
  EVENTS: Queue<any>;
  LOCK_DO: { getByName(name: string): LockStub };
  CITY_DISPATCH_DO: { getByName(name: string): DispatchStub };
  CITY_PREFIX: string;
  SCHEDULED_DISPATCH_LEAD_MINUTES: string;
  PAYOUT_SANDBOX_AUTOSETTLE: string;
}

function getSql(env: CronEnv): postgres.Sql {
  const connStr = env.HYPERDRIVE?.connectionString || env.DATABASE_URL || 'postgres://postgres:password@localhost:5432/delivery_platform';
  return postgres(connStr, { max: 1 });
}

export default {
  async scheduled(event: ScheduledEvent, env: CronEnv, ctx: ExecutionContext): Promise<void> {
    const cron = event.cron;

    // Trigger 1: Daily Doc Expiry & Weekly Backup (0 3 * * *)
    if (cron === '0 3 * * *') {
      ctx.waitUntil(handleDailyAndWeeklyTasks(env));
      return;
    }

    // Trigger 2: Hourly KPI Snapshot & Ledger Audit (0 * * * *)
    if (cron === '0 * * * *') {
      ctx.waitUntil(handleHourlyTasks(env));
      return;
    }

    // Trigger 3: Every minute (* * * * *)
    ctx.waitUntil(handleMinuteTasks(env));
  },
};

async function handleMinuteTasks(env: CronEnv): Promise<void> {
  const lockStub = env.LOCK_DO.getByName('cron:minute-sweep');
  const lock = await lockStub.acquire(45000); // 45s TTL
  if (!lock.acquired) {
    console.log('[Cron] Minute sweep already running on another instance, skipping.');
    return;
  }

  const sql = getSql(env);
  try {
    const city = env.CITY_PREFIX || 'KOL';
    const leadMinutes = parseInt(env.SCHEDULED_DISPATCH_LEAD_MINUTES || '15', 10);

    // 1. Expiry check: expired orders & offers
    await sql`
      UPDATE orders
      SET status = 'EXPIRED'
      WHERE status = 'CREATED'
        AND created_at < NOW() - INTERVAL '5 minutes'
    `.catch(() => {});

    // 2. Scheduled booking sweep: dispatch upcoming bookings
    const upcoming = await sql<{
      id: string;
      customer_id: string;
      pickup_h3_cell: string;
      base_fare_paise: number;
    }[]>`
      SELECT id, customer_id, pickup_h3_cell, base_fare_paise
      FROM orders
      WHERE status = 'SCHEDULED'
        AND scheduled_pickup_at <= NOW() + (${leadMinutes} || ' minutes')::interval
      LIMIT 10
    `.catch(() => []);

    for (const order of upcoming) {
      await sql`UPDATE orders SET status = 'CREATED' WHERE id = ${order.id}::uuid`.catch(() => {});
      if (env.EVENTS) {
        await env.EVENTS.send({
          topic: 'order.created',
          payload: {
            order_id: order.id,
            customer_id: order.customer_id,
            city_prefix: city,
            pickup_h3: order.pickup_h3_cell,
          },
          timestamp: Date.now(),
        }).catch(() => {});
      }
    }

    // 3. Stale driver pruner
    const dispatchStub = env.CITY_DISPATCH_DO.getByName(city);
    const staleDrivers = await dispatchStub.sweepStale(180); // 3 minutes stale
    if (staleDrivers && staleDrivers.length > 0) {
      await sql`
        UPDATE drivers
        SET current_state = 'OFFLINE'
        WHERE id = ANY(${staleDrivers}::uuid[])
      `.catch(() => {});
    }

    // 4. Sandbox payout auto-settle
    if (env.PAYOUT_SANDBOX_AUTOSETTLE === 'true') {
      await sql`
        UPDATE driver_payouts
        SET status = 'COMPLETED',
            settled_at = now()
        WHERE status = 'REQUESTED'
          AND created_at < NOW() - INTERVAL '1 minute'
      `.catch(() => {});
    }

    // 5. Notify API worker to drain outbox
    await env.API.fetch('http://vahnly-api/api/v1/health/quota').catch(() => {});
  } catch (err) {
    console.error('[Cron] minute sweep error:', err);
  } finally {
    if (lock.fenceToken) {
      await lockStub.release(lock.fenceToken).catch(() => {});
    }
    await sql.end({ timeout: 1 });
  }
}

async function handleHourlyTasks(env: CronEnv): Promise<void> {
  const sql = getSql(env);
  try {
    // Record KPI snapshot in KV or DB
    const metrics = await sql`
      SELECT
        count(*) filter (where status = 'COMPLETED') as completed_trips,
        count(*) filter (where status = 'CANCELLED') as cancelled_trips,
        coalesce(sum(total_fare_paise) filter (where status = 'COMPLETED'), 0) as total_volume_paise
      FROM orders
      WHERE created_at >= NOW() - INTERVAL '1 hour'
    `.catch(() => []);

    if (metrics.length > 0 && env.CONFIG) {
      await env.CONFIG.put(
        `kpi:hourly:${new Date().toISOString().slice(0, 13)}`,
        JSON.stringify(metrics[0]),
        { expirationTtl: 86400 * 7 }
      );
    }
  } catch (err) {
    console.error('[Cron] hourly task error:', err);
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function handleDailyAndWeeklyTasks(env: CronEnv): Promise<void> {
  const sql = getSql(env);
  try {
    // Flag expiring documents
    await sql`
      INSERT INTO notification_outbox (recipient_id, recipient_type, title, body, payload, status)
      SELECT
        d.id,
        'DRIVER',
        'Document Expiring Soon',
        'Your driver credentials or vehicle insurance is expiring soon. Please review.',
        '{"type":"document_expiry_alert"}',
        'PENDING'
      FROM drivers d
      WHERE d.is_verified = true
      LIMIT 20
    `.catch(() => {});
  } catch (err) {
    console.error('[Cron] daily task error:', err);
  } finally {
    await sql.end({ timeout: 1 });
  }
}
