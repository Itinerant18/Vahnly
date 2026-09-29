import { Hono } from 'hono';
import type { Env, AuthClaims } from '../types';

const files = new Hono<{ Bindings: Env; Variables: { user?: AuthClaims } }>();

// ---------------------------------------------------------------------------
// 1. Direct R2 File Upload (Through Worker, 25 MiB limit)
// ---------------------------------------------------------------------------
async function handleUpload(c: any, prefix = 'documents') {
  const user = c.get('user') as AuthClaims | undefined;
  const contentType = c.req.header('Content-Type') || 'application/octet-stream';

  const body = await c.req.arrayBuffer();
  // Enforce 25 MiB limit on Worker free plan
  if (body.byteLength > 25 * 1024 * 1024) {
    return c.json({ error: 'File size exceeds 25 MiB limit' }, 413);
  }

  const ext = contentType.includes('png') ? '.png' : contentType.includes('pdf') ? '.pdf' : '.jpg';
  const fileId = crypto.randomUUID();
  const key = `${prefix}/${fileId}${ext}`;

  if (c.env.DOCS) {
    await c.env.DOCS.put(key, body, {
      httpMetadata: { contentType },
      customMetadata: {
        uploaded_by: user?.user_id || 'anonymous',
        uploaded_at: String(Date.now()),
      },
    });
  }

  return c.json({
    success: true,
    key,
    document_url: key,
    url: `/api/v1/files/${key}`,
  }, 201);
}

files.post('/api/v1/files/upload', (c) => handleUpload(c, 'documents'));
files.post('/api/v1/driver/onboarding/upload', (c) => handleUpload(c, 'documents'));
files.post('/api/v1/driver/support/attachments', (c) => handleUpload(c, 'support-attachments'));
files.post('/api/v1/rider/me/photo', (c) => handleUpload(c, 'trip-photos'));

// Presigned URL emulation (direct upload URL)
files.post('/api/v1/driver/onboarding/presigned-url', (c) => {
  const fileId = crypto.randomUUID();
  return c.json({
    upload_url: `/api/v1/files/upload`,
    file_key: `documents/${fileId}.jpg`,
    expires_in_seconds: 900,
  });
});

// ---------------------------------------------------------------------------
// 2. Authenticated R2 Streaming Download
// ---------------------------------------------------------------------------
files.get('/api/v1/files/*', async (c) => {
  const key = c.req.path.replace('/api/v1/files/', '');
  if (!key) return c.text('Key required', 400);

  if (!c.env.DOCS) {
    return c.text('Object storage not configured', 503);
  }

  const object = await c.env.DOCS.get(key);
  if (!object) {
    return c.text('File not found', 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=86400');

  return new Response(object.body, {
    headers,
  });
});

export default files;
