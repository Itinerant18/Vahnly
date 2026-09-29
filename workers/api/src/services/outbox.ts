import type { Env } from '../types';
import { getDb } from './db';
import { sendFCMMessage } from './fcm';

export async function drainOutbox(env: Env, limit = 20): Promise<number> {
  const sql = getDb(env, { write: true });
  try {
    const rows = await sql<{
      id: string;
      recipient_id: string;
      recipient_type: string;
      title: string;
      body: string;
      payload: string;
    }[]>`
      SELECT id, recipient_id, recipient_type, title, body, payload
      FROM notification_outbox
      WHERE status = 'PENDING'
      ORDER BY created_at ASC
      LIMIT ${limit}
    `;

    if (rows.length === 0) return 0;

    for (const item of rows) {
      // Look up recipient device token
      let deviceTokens: { token: string }[] = [];
      if (item.recipient_type === 'DRIVER') {
        deviceTokens = await sql<{ token: string }[]>`
          SELECT device_token as token FROM driver_device_tokens WHERE driver_id = ${item.recipient_id}::uuid
        `.catch(() => []);
      } else {
        deviceTokens = await sql<{ token: string }[]>`
          SELECT device_token as token FROM rider_device_tokens WHERE rider_id = ${item.recipient_id}::uuid
        `.catch(() => []);
      }

      let sent = false;
      for (const dt of deviceTokens) {
        if (dt.token) {
          const ok = await sendFCMMessage(env, dt.token, {
            title: item.title,
            body: item.body,
          }).catch(() => false);
          if (ok) sent = true;
        }
      }

      await sql`
        UPDATE notification_outbox
        SET status = ${sent ? 'SENT' : 'PROCESSED'},
            processed_at = now()
        WHERE id = ${item.id}::uuid
      `.catch(() => {});
    }

    return rows.length;
  } catch (err) {
    console.error('[drainOutbox] error draining notification outbox:', err);
    return 0;
  }
}
