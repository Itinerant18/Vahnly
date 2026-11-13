import postgres from 'postgres';
import type { Env } from '../types';

export function getDb(env: Env, options?: { write?: boolean }): postgres.Sql {
  if ((env as any)?.__mockDb) {
    return (env as any).__mockDb;
  }

  const isWrite = options?.write ?? false;
  const connStr =
    isWrite && env.HYPERDRIVE_RW
      ? env.HYPERDRIVE_RW.connectionString
      : env.HYPERDRIVE?.connectionString ||
        env.DATABASE_URL ||
        'postgres://postgres:password@localhost:5432/delivery_platform';

  // In Cloudflare Workers, caching database clients globally across requests causes
  // "Cannot perform I/O on behalf of a different request" errors because TCP sockets
  // cannot outlive the request context that spawned them.
  // Hyperdrive already handles connection pooling at the edge, so creating the client
  // per-request incurs zero connection overhead while remaining strictly isolated.
  return postgres(connStr, {
    max: 5,
    fetch_types: false,
    connect_timeout: 10,
  });
}
