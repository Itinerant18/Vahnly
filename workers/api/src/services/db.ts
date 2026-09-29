import postgres from 'postgres';
import type { Env } from '../types';

let cachedSql: postgres.Sql | null = null;
let cachedSqlRW: postgres.Sql | null = null;

export function getDb(env: Env, options?: { write?: boolean }): postgres.Sql {
  const isWrite = options?.write ?? false;

  if (isWrite && env.HYPERDRIVE_RW) {
    if (!cachedSqlRW) {
      cachedSqlRW = postgres(env.HYPERDRIVE_RW.connectionString, {
        max: 5,
        idle_timeout: 20,
        connect_timeout: 10,
      });
    }
    return cachedSqlRW;
  }

  const connStr = env.HYPERDRIVE?.connectionString || env.DATABASE_URL || 'postgres://postgres:password@localhost:5432/delivery_platform';

  if (!cachedSql) {
    cachedSql = postgres(connStr, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }

  return cachedSql;
}
