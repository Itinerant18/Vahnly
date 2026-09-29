import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types';
import postgres from 'postgres';

export class RiderStreamDO extends DurableObject<Env> {
  private riderId = '';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS rider_meta (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          rider_id TEXT NOT NULL,
          last_ping INTEGER NOT NULL
        );
      `);

      const row = this.ctx.storage.sql.exec<{ rider_id: string }>(
        'SELECT rider_id FROM rider_meta WHERE id = 1'
      ).toArray();
      if (row.length > 0) {
        this.riderId = row[0].rider_id;
      }

      const alarm = await this.ctx.storage.getAlarm();
      if (!alarm) {
        await this.ctx.storage.setAlarm(Date.now() + 25000);
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const riderId = url.searchParams.get('rider_id') || 'unknown';
    this.riderId = riderId;
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO rider_meta (id, rider_id, last_ping) VALUES (1, ?, ?)',
      riderId,
      Date.now()
    );

    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    this.ctx.acceptWebSocket(server, ['rider', riderId]);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  // Push message to rider WebSocket. If rider is offline, persist to notification_outbox for FCM push.
  async pushTripEvent(event: { type: string; data: Record<string, unknown> }): Promise<void> {
    const sockets = this.ctx.getWebSockets('rider');
    if (sockets.length > 0) {
      const payload = JSON.stringify(event);
      for (const ws of sockets) {
        try {
          ws.send(payload);
        } catch (err) {
          console.error('[RiderStreamDO] send error:', err);
        }
      }
      return;
    }

    // Fallback: rider socket is disconnected -> write to notification_outbox table
    const connStr = this.env.HYPERDRIVE?.connectionString || this.env.DATABASE_URL;
    if (connStr && this.riderId) {
      const sql = postgres(connStr, { max: 1 });
      try {
        await sql`
          INSERT INTO notification_outbox (recipient_id, recipient_type, title, body, payload, status)
          VALUES (
            ${this.riderId},
            'RIDER',
            ${event.type},
            ${JSON.stringify(event.data)},
            ${JSON.stringify(event)},
            'PENDING'
          )
        `.catch((err) => console.error('[RiderStreamDO] outbox write error:', err));
      } finally {
        await sql.end({ timeout: 1 });
      }
    }
  }

  async isConnected(): Promise<boolean> {
    return this.ctx.getWebSockets('rider').length > 0;
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message === 'string' && message === 'ping') {
      ws.send('pong');
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    ws.close(code, reason);
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error('[RiderStreamDO] webSocketError:', error);
  }

  // 25s ping alarm
  async alarm(): Promise<void> {
    try {
      const sockets = this.ctx.getWebSockets('rider');
      for (const ws of sockets) {
        try {
          ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
        } catch {
          // Socket might have closed
        }
      }
    } finally {
      await this.ctx.storage.setAlarm(Date.now() + 25000);
    }
  }
}
