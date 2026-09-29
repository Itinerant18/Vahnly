import type { Env } from '../types';

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

export async function getGoogleAccessToken(env: Env): Promise<string | null> {
  if (!env.FCM_SERVICE_ACCOUNT_JSON) return null;

  // Check cache in SessionDO
  const sessionStub = env.SESSION_DO.getByName('global-session');
  const cached = await sessionStub.getCachedValue('fcm_access_token');
  if (cached) return cached;

  let sa: ServiceAccount;
  try {
    sa = JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON) as ServiceAccount;
  } catch (err) {
    console.error('[FCM] Failed to parse FCM_SERVICE_ACCOUNT_JSON:', err);
    return null;
  }

  // Import RS256 PKCS#8 private key
  const pem = sa.private_key
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');

  const binaryDer = atob(pem);
  const binaryDerBytes = new Uint8Array(binaryDer.length);
  for (let i = 0; i < binaryDer.length; i++) {
    binaryDerBytes[i] = binaryDer.charCodeAt(i);
  }

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryDerBytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: sa.client_email,
    sub: sa.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    iat: now,
    exp: now + 3600,
  };

  const enc = new TextEncoder();
  const b64Header = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const b64Claims = btoa(JSON.stringify(claims)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const signingInput = `${b64Header}.${b64Claims}`;

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    enc.encode(signingInput)
  );

  const b64Signature = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const assertion = `${signingInput}.${b64Signature}`;

  // Exchange JWT assertion for OAuth2 access token
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!tokenResp.ok) {
    const errText = await tokenResp.text();
    console.error('[FCM] Token exchange failed:', errText);
    return null;
  }

  const tokenData = (await tokenResp.json()) as { access_token: string; expires_in: number };
  const accessToken = tokenData.access_token;

  // Cache token for 50 minutes (3000 seconds)
  await sessionStub.setCachedValue('fcm_access_token', accessToken, 3000);

  return accessToken;
}

export async function sendFCMMessage(
  env: Env,
  deviceToken: string,
  notification: { title: string; body: string; data?: Record<string, string> }
): Promise<boolean> {
  const token = await getGoogleAccessToken(env);
  if (!token) return false;

  const projectId = env.FIREBASE_PROJECT_ID || 'vahnly-platform';
  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

  const payload = {
    message: {
      token: deviceToken,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: notification.data || {},
    },
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  return resp.ok;
}
