import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types';

export class LockDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS mutex_lock (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          fence_token TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        );
      `);
    });
  }

  async acquire(ttlMs: number): Promise<{ acquired: boolean; fenceToken?: string }> {
    const now = Date.now();
    const expiresAt = now + ttlMs;
    const token = crypto.randomUUID();

    const existing = this.ctx.storage.sql.exec<{ fence_token: string; expires_at: number }>(
      'SELECT fence_token, expires_at FROM mutex_lock WHERE id = 1'
    ).toArray();

    if (existing.length > 0 && existing[0].expires_at > now) {
      return { acquired: false };
    }

    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO mutex_lock (id, fence_token, expires_at) VALUES (1, ?, ?)',
      token,
      expiresAt
    );

    return { acquired: true, fenceToken: token };
  }

  async release(fenceToken: string): Promise<boolean> {
    const row = this.ctx.storage.sql.exec<{ fence_token: string }>(
      'SELECT fence_token FROM mutex_lock WHERE id = 1'
    ).toArray();

    if (row.length > 0 && row[0].fence_token === fenceToken) {
      this.ctx.storage.sql.exec('DELETE FROM mutex_lock WHERE id = 1');
      return true;
    }
    return false;
  }

  async renew(fenceToken: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const row = this.ctx.storage.sql.exec<{ fence_token: string; expires_at: number }>(
      'SELECT fence_token, expires_at FROM mutex_lock WHERE id = 1'
    ).toArray();

    if (row.length > 0 && row[0].fence_token === fenceToken && row[0].expires_at > now) {
      this.ctx.storage.sql.exec(
        'UPDATE mutex_lock SET expires_at = ? WHERE id = 1',
        now + ttlMs
      );
      return true;
    }
    return false;
  }
}
