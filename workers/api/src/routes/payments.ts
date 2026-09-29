import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb } from '../services/db';

const payments = new Hono<{ Bindings: Env }>();

// Constant-time comparison
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

payments.post('/api/v1/payments/webhook', async (c) => {
  const secret = c.env.PAYMENT_WEBHOOK_SIGNING_SECRET || 'dev-only-webhook-hmac-secret-change-in-prod';
  const signature = c.req.header('X-Webhook-Signature') || c.req.header('X-Signature');
  const bodyText = await c.req.text();

  if (!signature) {
    return c.json({ error: 'Missing signature header' }, 401);
  }

  // Compute HMAC-SHA256
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBytes = await crypto.subtle.sign('HMAC', key, enc.encode(bodyText));
  const expectedSignatureHex = Array.from(new Uint8Array(signatureBytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const sigBytes = enc.encode(signature);
  const expectedBytes = enc.encode(expectedSignatureHex);

  if (!timingSafeEqual(sigBytes, expectedBytes)) {
    return c.json({ error: 'Invalid webhook signature' }, 401);
  }

  const payload = JSON.parse(bodyText) as {
    order_id?: string;
    status?: string;
    amount_paise?: number;
    transaction_id?: string;
  };

  if (payload.order_id && payload.status === 'SUCCESS') {
    const sql = getDb(c.env, { write: true });
    await sql`
      UPDATE orders
      SET payment_status = 'PAID',
          paid_at = now()
      WHERE id = ${payload.order_id}::uuid
    `.catch(() => {});

    await sql`
      INSERT INTO ledger_entries (entry_type, amount_paise, reference_id, description)
      VALUES ('PAYMENT_RECEIVED', ${payload.amount_paise || 0}, ${payload.order_id}, 'Webhook payment success')
    `.catch(() => {});
  }

  return c.json({ success: true, received: true });
});

export default payments;
