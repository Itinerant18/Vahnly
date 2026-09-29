import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types';

export class RateLimitDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS rate_limits (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rate_limits_ts ON rate_limits(ts);
      `);
    });
  }

  async checkLimit(limit: number, windowSeconds: number): Promise<{ allowed: boolean; remaining: number; reset: number }> {
    const now = Date.now();
    const windowStart = now - windowSeconds * 1000;

    // Prune entries older than the sliding window
    this.ctx.storage.sql.exec('DELETE FROM rate_limits WHERE ts < ?', windowStart);

    const countRow = this.ctx.storage.sql.exec<{ count: number }>(
      'SELECT count(*) as count FROM rate_limits'
    ).one();

    const currentCount = countRow ? countRow.count : 0;
    const allowed = currentCount < limit;

    if (allowed) {
      this.ctx.storage.sql.exec('INSERT INTO rate_limits (ts) VALUES (?)', now);
    }

    return {
      allowed,
      remaining: Math.max(0, limit - currentCount - (allowed ? 1 : 0)),
      reset: Math.ceil((now + windowSeconds * 1000) / 1000),
    };
  }
}
