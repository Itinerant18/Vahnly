import { DurableObject } from 'cloudflare:workers';
import * as h3 from 'h3-js';
import type { Env } from '../types';

import type { SqlStorageValue } from '@cloudflare/workers-types';

interface DriverRecord extends Record<string, SqlStorageValue> {
  driver_id: string;
  h3: string;
  lat: number;
  lng: number;
  ts: number;
  status: string;
  vehicle_tier: string | null;
}

export class CityDispatchDO extends DurableObject<Env> {
  private lastSurgeSnapshot = '';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS driver_index (
          driver_id TEXT PRIMARY KEY,
          h3 TEXT NOT NULL,
          lat REAL NOT NULL,
          lng REAL NOT NULL,
          ts INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'ONLINE_AVAILABLE',
          vehicle_tier TEXT DEFAULT 'SEDAN'
        );
        CREATE INDEX IF NOT EXISTS idx_driver_h3_ts ON driver_index(h3, ts);

        CREATE TABLE IF NOT EXISTS dm_cache (
          key TEXT PRIMARY KEY,
          json TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS surge_state (
          city TEXT PRIMARY KEY,
          snapshot TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);

      // Ensure 5s alarm is scheduled for surge and spatial maintenance
      const alarm = await this.ctx.storage.getAlarm();
      if (!alarm) {
        await this.ctx.storage.setAlarm(Date.now() + 5000);
      }
    });
  }

  async locationUpdate(
    driverId: string,
    lat: number,
    lng: number,
    ts: number,
    status = 'ONLINE_AVAILABLE',
    vehicleTier = 'SEDAN'
  ): Promise<string> {
    const h3Cell = h3.latLngToCell(lat, lng, 9);
    this.ctx.storage.sql.exec(
      `INSERT INTO driver_index (driver_id, h3, lat, lng, ts, status, vehicle_tier)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(driver_id) DO UPDATE SET
         h3 = excluded.h3,
         lat = excluded.lat,
         lng = excluded.lng,
         ts = excluded.ts,
         status = excluded.status,
         vehicle_tier = excluded.vehicle_tier`,
      driverId,
      h3Cell,
      lat,
      lng,
      ts,
      status,
      vehicleTier
    );
    return h3Cell;
  }

  async setDriverStatus(driverId: string, status: string): Promise<void> {
    if (status === 'OFFLINE') {
      this.ctx.storage.sql.exec('DELETE FROM driver_index WHERE driver_id = ?', driverId);
    } else {
      this.ctx.storage.sql.exec(
        'UPDATE driver_index SET status = ?, ts = ? WHERE driver_id = ?',
        status,
        Date.now(),
        driverId
      );
    }
  }

  async matchOrder(order: {
    id: string;
    pickup_lat: number;
    pickup_lng: number;
    pickup_h3?: string;
    vehicle_tier?: string;
  }): Promise<{ matched: boolean; driverId?: string; distanceKm?: number }> {
    const pickupH3 = order.pickup_h3 || h3.latLngToCell(order.pickup_lat, order.pickup_lng, 9);
    const staleThreshold = Date.now() - 90 * 1000; // 90 seconds freshness

    // Progressive k-ring expansion: k = 1..3
    for (let k = 1; k <= 3; k++) {
      const ring = h3.gridDisk(pickupH3, k);
      if (ring.length === 0) continue;

      const placeholders = ring.map(() => '?').join(',');
      const rows = this.ctx.storage.sql.exec<DriverRecord>(
        `SELECT driver_id, h3, lat, lng, ts, status, vehicle_tier
         FROM driver_index
         WHERE h3 IN (${placeholders})
           AND status = 'ONLINE_AVAILABLE'
           AND ts >= ?`,
        ...ring,
        staleThreshold
      ).toArray();

      if (rows.length > 0) {
        // Find closest driver using haversine distance
        let bestDriver: DriverRecord | null = null;
        let minDistance = Infinity;

        for (const candidate of rows) {
          const dist = this.haversine(
            order.pickup_lat,
            order.pickup_lng,
            candidate.lat,
            candidate.lng
          );
          if (dist < minDistance) {
            minDistance = dist;
            bestDriver = candidate;
          }
        }

        if (bestDriver) {
          // Reserve driver
          this.ctx.storage.sql.exec(
            `UPDATE driver_index SET status = 'ASSIGNED' WHERE driver_id = ?`,
            bestDriver.driver_id
          );
          return {
            matched: true,
            driverId: bestDriver.driver_id,
            distanceKm: Math.round(minDistance * 100) / 100,
          };
        }
      }
    }

    return { matched: false };
  }

  async getNearbyDrivers(lat: number, lng: number, radiusKm = 5): Promise<Array<{ id: string; lat: number; lng: number; bearing: number }>> {
    const centerH3 = h3.latLngToCell(lat, lng, 9);
    const ring = h3.gridDisk(centerH3, 3);
    const placeholders = ring.map(() => '?').join(',');
    const staleThreshold = Date.now() - 90 * 1000;

    const rows = this.ctx.storage.sql.exec<DriverRecord>(
      `SELECT driver_id, lat, lng
       FROM driver_index
       WHERE h3 IN (${placeholders})
         AND status = 'ONLINE_AVAILABLE'
         AND ts >= ?`,
      ...ring,
      staleThreshold
    ).toArray();

    return rows.map((r) => ({
      id: r.driver_id,
      lat: r.lat,
      lng: r.lng,
      bearing: 0,
    }));
  }

  // Distance Matrix cache
  async getCachedDM(key: string): Promise<string | null> {
    const now = Date.now();
    const rows = this.ctx.storage.sql.exec<{ json: string; expires_at: number }>(
      'SELECT json, expires_at FROM dm_cache WHERE key = ?',
      key
    ).toArray();

    if (rows.length === 0) return null;
    if (rows[0].expires_at < now) {
      this.ctx.storage.sql.exec('DELETE FROM dm_cache WHERE key = ?', key);
      return null;
    }
    return rows[0].json;
  }

  async setCachedDM(key: string, json: string, ttlSeconds = 300): Promise<void> {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO dm_cache (key, json, expires_at) VALUES (?, ?, ?)',
      key,
      json,
      expiresAt
    );
  }

  // Stale driver sweep
  async sweepStale(maxAgeSeconds = 120): Promise<string[]> {
    const staleThreshold = Date.now() - maxAgeSeconds * 1000;
    const staleRows = this.ctx.storage.sql.exec<{ driver_id: string }>(
      'SELECT driver_id FROM driver_index WHERE ts < ?',
      staleThreshold
    ).toArray();

    const staleIds = staleRows.map((r) => r.driver_id);
    if (staleIds.length > 0) {
      this.ctx.storage.sql.exec('DELETE FROM driver_index WHERE ts < ?', staleThreshold);
    }
    return staleIds;
  }

  // Region handoff CAS
  async handoff(driverId: string): Promise<DriverRecord | null> {
    const rows = this.ctx.storage.sql.exec<DriverRecord>(
      'SELECT * FROM driver_index WHERE driver_id = ?',
      driverId
    ).toArray();
    if (rows.length === 0) return null;
    this.ctx.storage.sql.exec('DELETE FROM driver_index WHERE driver_id = ?', driverId);
    return rows[0];
  }

  async accept(driver: DriverRecord, version: number): Promise<boolean> {
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO driver_index (driver_id, h3, lat, lng, ts, status, vehicle_tier)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      driver.driver_id,
      driver.h3,
      driver.lat,
      driver.lng,
      driver.ts,
      driver.status,
      driver.vehicle_tier || 'SEDAN'
    );
    return true;
  }

  // Periodic alarm for surge calculation & cleanup (every 5 seconds)
  async alarm(): Promise<void> {
    try {
      await this.calculateSurge();
      // Opportunistic cleanup of expired DM cache
      this.ctx.storage.sql.exec('DELETE FROM dm_cache WHERE expires_at < ?', Date.now());
    } catch (err) {
      console.error('[CityDispatchDO] alarm error:', err);
    } finally {
      // Re-arm alarm for 5 seconds
      await this.ctx.storage.setAlarm(Date.now() + 5000);
    }
  }

  private async calculateSurge(): Promise<void> {
    const trackedCells = (this.env.SURGE_TRACKED_CELLS || '').split(',').map((c) => c.trim()).filter(Boolean);
    if (trackedCells.length === 0) return;

    const city = this.env.CITY_PREFIX || 'KOL';
    const surgeMap: Record<string, number> = {};

    for (const cell of trackedCells) {
      const row = this.ctx.storage.sql.exec<{ count: number }>(
        `SELECT count(*) as count FROM driver_index
         WHERE h3 = ? AND status = 'ONLINE_AVAILABLE' AND ts >= ?`,
        cell,
        Date.now() - 90 * 1000
      ).one();

      const supply = row ? row.count : 0;
      // Surge multiplier heuristic: if supply == 0 => 1.8, if supply < 3 => 1.4, else 1.0
      let multiplier = 1.0;
      if (supply === 0) multiplier = 1.8;
      else if (supply < 3) multiplier = 1.3;
      surgeMap[cell] = multiplier;
    }

    const newSnapshot = JSON.stringify(surgeMap);
    if (newSnapshot !== this.lastSurgeSnapshot) {
      this.lastSurgeSnapshot = newSnapshot;
      this.ctx.storage.sql.exec(
        'INSERT OR REPLACE INTO surge_state (city, snapshot, updated_at) VALUES (?, ?, ?)',
        city,
        newSnapshot,
        Date.now()
      );

      // Write to KV only when changed to respect the 1k writes/day free limit!
      if (this.env.CONFIG) {
        await this.env.CONFIG.put(`surge:${city}`, newSnapshot);
      }
    }
  }

  private haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
}
