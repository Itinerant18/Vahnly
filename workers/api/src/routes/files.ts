import { Hono } from 'hono';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import type { Env, AuthClaims } from '../types';

const files = new Hono<{ Bindings: Env; Variables: { user?: AuthClaims } }>();

function getS3(env: Env): S3Client | null {
  const endpoint = env.S3_ENDPOINT || env.AWS_ENDPOINT_URL_S3;
  const accessKeyId = env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) return null;

  return new S3Client({
    endpoint,
    region: env.S3_REGION || env.AWS_REGION || 'us-east-2',
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle: true,
  });
}

// ---------------------------------------------------------------------------
// 1. Direct File Upload (Through Worker, 25 MiB limit)
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

  const s3 = getS3(c.env);
  if (s3) {
    const bucket = c.env.S3_BUCKET || 'uploads';
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: new Uint8Array(body),
        ContentType: contentType,
        Metadata: {
          uploaded_by: user?.user_id || 'anonymous',
          uploaded_at: String(Date.now()),
        },
      })
    );
  } else if (c.env.DOCS) {
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
// 2. Authenticated Streaming Download
// ---------------------------------------------------------------------------
files.get('/api/v1/files/*', async (c) => {
  const key = c.req.path.replace('/api/v1/files/', '');
  if (!key) return c.text('Key required', 400);

  const s3 = getS3(c.env);
  if (s3) {
    const bucket = c.env.S3_BUCKET || 'uploads';
    try {
      const res = await s3.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        })
      );
      if (!res.Body) {
        return c.text('File not found', 404);
      }
      const bytes = await res.Body.transformToByteArray();
      const headers = new Headers();
      if (res.ContentType) headers.set('Content-Type', res.ContentType);
      if (res.ETag) headers.set('etag', res.ETag);
      headers.set('Cache-Control', 'public, max-age=86400');

      return new Response(bytes, { headers });
    } catch (err: any) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        return c.text('File not found', 404);
      }
      return c.text('Error retrieving file', 500);
    }
  }

  if (c.env.DOCS) {
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
  }

  return c.text('Object storage not configured', 503);
});

export default files;
