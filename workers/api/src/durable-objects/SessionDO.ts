import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types';

export class SessionDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS ws_tickets (
          ticket TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS refresh_tokens (
          token_id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          role TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS otp_counters (
          key TEXT PRIMARY KEY,
          count INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS idempotency_keys (
          key TEXT PRIMARY KEY,
          status_code INTEGER NOT NULL,
          headers TEXT NOT NULL,
          body TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS key_value_cache (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        );
      `);
    });
  }

  // WS Ticket handling (single-use GETDEL pattern)
  async storeTicket(ticket: string, payload: Record<string, unknown>, ttlSeconds = 30): Promise<void> {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO ws_tickets (ticket, payload, expires_at) VALUES (?, ?, ?)',
      ticket,
      JSON.stringify(payload),
      expiresAt
    );
  }

  async consumeTicket(ticket: string): Promise<Record<string, unknown> | null> {
    const now = Date.now();
    const rows = this.ctx.storage.sql.exec<{ payload: string; expires_at: number }>(
      'SELECT payload, expires_at FROM ws_tickets WHERE ticket = ?',
      ticket
    ).toArray();

    if (rows.length === 0) return null;
    const row = rows[0];

    // Delete ticket immediately (single use)
    this.ctx.storage.sql.exec('DELETE FROM ws_tickets WHERE ticket = ?', ticket);

    if (row.expires_at < now) return null;
    try {
      return JSON.parse(row.payload) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  // Refresh token rotation
  async storeRefreshToken(tokenId: string, userId: string, role: string, expiresAt: number): Promise<void> {
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO refresh_tokens (token_id, user_id, role, expires_at) VALUES (?, ?, ?, ?)',
      tokenId,
      userId,
      role,
      expiresAt
    );
  }

  async validateAndRotateRefreshToken(
    oldTokenId: string,
    newTokenId: string,
    expiresAt: number
  ): Promise<{ valid: boolean; userId?: string; role?: string }> {
    const now = Date.now();
    const rows = this.ctx.storage.sql.exec<{ user_id: string; role: string; expires_at: number }>(
      'SELECT user_id, role, expires_at FROM refresh_tokens WHERE token_id = ?',
      oldTokenId
    ).toArray();

    if (rows.length === 0) return { valid: false };
    const row = rows[0];

    // Remove old token
    this.ctx.storage.sql.exec('DELETE FROM refresh_tokens WHERE token_id = ?', oldTokenId);

    if (row.expires_at < now) return { valid: false };

    // Insert new rotated token
    this.ctx.storage.sql.exec(
      'INSERT INTO refresh_tokens (token_id, user_id, role, expires_at) VALUES (?, ?, ?, ?)',
      newTokenId,
      row.user_id,
      row.role,
      expiresAt
    );

    return { valid: true, userId: row.user_id, role: row.role };
  }

  async revokeAllSessions(userId: string): Promise<void> {
    this.ctx.storage.sql.exec('DELETE FROM refresh_tokens WHERE user_id = ?', userId);
  }

  // OTP rate limit & attempt counters
  async incrementOTP(key: string, ttlSeconds = 600): Promise<number> {
    const now = Date.now();
    const rows = this.ctx.storage.sql.exec<{ count: number; expires_at: number }>(
      'SELECT count, expires_at FROM otp_counters WHERE key = ?',
      key
    ).toArray();

    if (rows.length === 0 || rows[0].expires_at < now) {
      const expiresAt = now + ttlSeconds * 1000;
      this.ctx.storage.sql.exec(
        'INSERT OR REPLACE INTO otp_counters (key, count, expires_at) VALUES (?, 1, ?)',
        key,
        expiresAt
      );
      return 1;
    }

    const newCount = rows[0].count + 1;
    this.ctx.storage.sql.exec(
      'UPDATE otp_counters SET count = ? WHERE key = ?',
      newCount,
      key
    );
    return newCount;
  }

  async getOTPCounter(key: string): Promise<number> {
    const now = Date.now();
    const rows = this.ctx.storage.sql.exec<{ count: number; expires_at: number }>(
      'SELECT count, expires_at FROM otp_counters WHERE key = ?',
      key
    ).toArray();

    if (rows.length === 0 || rows[0].expires_at < now) return 0;
    return rows[0].count;
  }

  async resetOTP(key: string): Promise<void> {
    this.ctx.storage.sql.exec('DELETE FROM otp_counters WHERE key = ?', key);
  }

  // Idempotency cache
  async getIdempotency(key: string): Promise<{ statusCode: number; headers: Record<string, string>; body: string } | null> {
    const now = Date.now();
    const rows = this.ctx.storage.sql.exec<{ status_code: number; headers: string; body: string; expires_at: number }>(
      'SELECT status_code, headers, body, expires_at FROM idempotency_keys WHERE key = ?',
      key
    ).toArray();

    if (rows.length === 0) return null;
    if (rows[0].expires_at < now) {
      this.ctx.storage.sql.exec('DELETE FROM idempotency_keys WHERE key = ?', key);
      return null;
    }

    try {
      return {
        statusCode: rows[0].status_code,
        headers: JSON.parse(rows[0].headers),
        body: rows[0].body,
      };
    } catch {
      return null;
    }
  }

  async setIdempotency(
    key: string,
    statusCode: number,
    headers: Record<string, string>,
    body: string,
    ttlSeconds = 86400
  ): Promise<void> {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO idempotency_keys (key, status_code, headers, body, expires_at) VALUES (?, ?, ?, ?, ?)',
      key,
      statusCode,
      JSON.stringify(headers),
      body,
      expiresAt
    );
  }

  // Key-value cache (FCM access tokens, etc.)
  async getCachedValue(key: string): Promise<string | null> {
    const now = Date.now();
    const rows = this.ctx.storage.sql.exec<{ value: string; expires_at: number }>(
      'SELECT value, expires_at FROM key_value_cache WHERE key = ?',
      key
    ).toArray();

    if (rows.length === 0) return null;
    if (rows[0].expires_at < now) {
      this.ctx.storage.sql.exec('DELETE FROM key_value_cache WHERE key = ?', key);
      return null;
    }
    return rows[0].value;
  }

  async setCachedValue(key: string, value: string, ttlSeconds: number): Promise<void> {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO key_value_cache (key, value, expires_at) VALUES (?, ?, ?)',
      key,
      value,
      expiresAt
    );
  }
}
