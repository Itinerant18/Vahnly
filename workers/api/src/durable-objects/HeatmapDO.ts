import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types';

interface SSEClient {
  id: string;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  connectedAt: number;
}

export class HeatmapDO extends DurableObject<Env> {
  private clients = new Map<string, SSEClient>();
  private keepaliveCounter = 0;
  private encoder = new TextEncoder();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS heatmap_state (
          city TEXT PRIMARY KEY,
          snapshot TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);

      const alarm = await this.ctx.storage.getAlarm();
      if (!alarm) {
        await this.ctx.storage.setAlarm(Date.now() + 2000);
      }
    });
  }

  async handleSSE(request: Request): Promise<Response> {
    // Cap concurrent admin streams at 5 to protect DO memory and CPU
    if (this.clients.size >= 5) {
      // Drop the oldest client if capacity exceeded
      const oldestKey = this.clients.keys().next().value;
      if (oldestKey) {
        const oldest = this.clients.get(oldestKey);
        if (oldest) {
          try {
            await oldest.writer.close();
          } catch {}
          this.clients.delete(oldestKey);
        }
      }
    }

    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const clientId = crypto.randomUUID();

    const client: SSEClient = {
      id: clientId,
      writer,
      connectedAt: Date.now(),
    };
    this.clients.set(clientId, client);

    // Send initial headers and snapshot
    const initialMsg = this.encoder.encode(': connected\n\n');
    await writer.write(initialMsg);

    return new Response(readable, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  // Update current snapshot
  async updateSnapshot(city: string, snapshot: Record<string, unknown>): Promise<void> {
    const raw = JSON.stringify(snapshot);
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO heatmap_state (city, snapshot, updated_at) VALUES (?, ?, ?)',
      city,
      raw,
      Date.now()
    );
  }

  // 2s alarm: Broadcast snapshot to open streams, 15s keepalive
  async alarm(): Promise<void> {
    try {
      this.keepaliveCounter++;
      const isKeepalive = this.keepaliveCounter >= 7; // ~14-15s

      const row = this.ctx.storage.sql.exec<{ snapshot: string }>(
        'SELECT snapshot FROM heatmap_state LIMIT 1'
      ).toArray();

      const snapshotData = row.length > 0 ? row[0].snapshot : JSON.stringify({ city: this.env.CITY_PREFIX || 'KOL', cells: [], ts: Date.now() });

      const eventPayload = `event: heatmap\ndata: ${snapshotData}\n\n`;
      const keepalivePayload = ': keepalive\n\n';

      const payload = isKeepalive ? eventPayload + keepalivePayload : eventPayload;
      if (isKeepalive) {
        this.keepaliveCounter = 0;
      }

      const encoded = this.encoder.encode(payload);

      const toRemove: string[] = [];
      for (const [id, client] of this.clients.entries()) {
        try {
          await client.writer.write(encoded);
        } catch {
          toRemove.push(id);
        }
      }

      for (const id of toRemove) {
        this.clients.delete(id);
      }
    } catch (err) {
      console.error('[HeatmapDO] alarm broadcast error:', err);
    } finally {
      // Re-arm alarm for 2 seconds
      await this.ctx.storage.setAlarm(Date.now() + 2000);
    }
  }
}
