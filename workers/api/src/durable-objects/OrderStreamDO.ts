import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types';
import {
  WebSocketBinaryEnvelope,
  FrameType,
  type AssignmentFrame,
  type TelemetryFrame,
} from '../proto/stream_framing';
import postgres from 'postgres';

export class OrderStreamDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS gps_points (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          driver_id TEXT,
          lat REAL NOT NULL,
          lng REAL NOT NULL,
          bearing REAL NOT NULL,
          speed REAL NOT NULL,
          ts INTEGER NOT NULL
        );
      `);

      const alarm = await this.ctx.storage.getAlarm();
      if (!alarm) {
        await this.ctx.storage.setAlarm(Date.now() + 15000);
      }
    });
  }

  // WebSocket upgrade handler
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const role = url.searchParams.get('role') || 'driver';
    const userId = url.searchParams.get('user_id') || 'unknown';

    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    // Hibernation API: accept server WebSocket and attach tags
    this.ctx.acceptWebSocket(server, [role, userId]);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  // Broadcast assignment frame (binary protobuf)
  async broadcastAssignment(assignment: AssignmentFrame): Promise<void> {
    const envelope = WebSocketBinaryEnvelope.encode({
      type: FrameType.FRAME_TYPE_ASSIGNMENT,
      assignment,
    });
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) {
      try {
        ws.send(envelope);
      } catch (err) {
        console.error('[OrderStreamDO] broadcastAssignment error:', err);
      }
    }
  }

  // Broadcast telemetry frame (binary protobuf) + buffer GPS
  async broadcastTelemetry(telemetry: TelemetryFrame): Promise<void> {
    const envelope = WebSocketBinaryEnvelope.encode({
      type: FrameType.FRAME_TYPE_TELEMETRY,
      telemetry,
    });
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) {
      try {
        ws.send(envelope);
      } catch (err) {
        console.error('[OrderStreamDO] broadcastTelemetry error:', err);
      }
    }

    // Buffer GPS point in SQLite for write-behind batching
    this.ctx.storage.sql.exec(
      'INSERT INTO gps_points (driver_id, lat, lng, bearing, speed, ts) VALUES (?, ?, ?, ?, ?, ?)',
      telemetry.driver_id,
      telemetry.latitude,
      telemetry.longitude,
      telemetry.bearing,
      telemetry.speed_kms,
      telemetry.timestamp_utc
    );
  }

  // Broadcast text/JSON message (chat, rider location, SOS)
  async broadcastJSON(msg: Record<string, unknown>, targetRole?: string): Promise<void> {
    const payload = JSON.stringify(msg);
    const sockets = this.ctx.getWebSockets(targetRole);
    for (const ws of sockets) {
      try {
        ws.send(payload);
      } catch (err) {
        console.error('[OrderStreamDO] broadcastJSON error:', err);
      }
    }
  }

  async getSubscriberCount(): Promise<number> {
    return this.ctx.getWebSockets().length;
  }

  // Hibernation WebSocket message listener
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // Ping/pong or client message handling
    if (typeof message === 'string' && message === 'ping') {
      ws.send('pong');
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    ws.close(code, reason);
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error('[OrderStreamDO] webSocketError:', error);
  }

  // 15s alarm: Flush buffered GPS points to Postgres
  async alarm(): Promise<void> {
    try {
      const rows = this.ctx.storage.sql.exec<{
        id: number;
        driver_id: string;
        lat: number;
        lng: number;
        bearing: number;
        speed: number;
        ts: number;
      }>('SELECT * FROM gps_points ORDER BY id ASC LIMIT 100').toArray();

      if (rows.length > 0) {
        const connStr = this.env.HYPERDRIVE?.connectionString || this.env.DATABASE_URL;
        if (connStr) {
          const sql = postgres(connStr, { max: 1 });
          try {
            for (const r of rows) {
              await sql`
                INSERT INTO driver_locations (driver_id, location, bearing, speed, recorded_at)
                VALUES (
                  ${r.driver_id}::uuid,
                  ST_SetSRID(ST_MakePoint(${r.lng}, ${r.lat}), 4326)::geography,
                  ${r.bearing},
                  ${r.speed},
                  to_timestamp(${r.ts} / 1000.0)
                )
              `.catch(() => {});
            }
          } finally {
            await sql.end({ timeout: 1 });
          }
        }

        const maxId = rows[rows.length - 1].id;
        this.ctx.storage.sql.exec('DELETE FROM gps_points WHERE id <= ?', maxId);
      }
    } catch (err) {
      console.error('[OrderStreamDO] GPS flush alarm error:', err);
    } finally {
      // Re-schedule alarm for 15 seconds
      await this.ctx.storage.setAlarm(Date.now() + 15000);
    }
  }
}
