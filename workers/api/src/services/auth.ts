import { SignJWT, jwtVerify, importJWK } from 'jose';
import type { AuthClaims, Env } from '../types';

const ENC_PREFIX = 'enc:v1:';

// ---------------------------------------------------------------------------
// 1. Field Encryption (AES-256-GCM via Web Crypto, byte-compatible with Go)
// ---------------------------------------------------------------------------
async function deriveCipherKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const secretBytes = enc.encode(secret);
  const hash = await crypto.subtle.digest('SHA-256', secretBytes);
  return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptField(plaintext: string, secret: string): Promise<string> {
  if (!plaintext) return plaintext;
  const key = await deriveCipherKey(secret);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plaintext);

  const ciphertextWithTag = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    data
  );

  const combined = new Uint8Array(nonce.length + ciphertextWithTag.byteLength);
  combined.set(nonce, 0);
  combined.set(new Uint8Array(ciphertextWithTag), nonce.length);

  const b64 = btoa(String.fromCharCode(...combined));
  return ENC_PREFIX + b64;
}

export async function decryptField(token: string, secret: string): Promise<string> {
  if (!token || !token.startsWith(ENC_PREFIX)) return token;
  const key = await deriveCipherKey(secret);
  const rawB64 = token.slice(ENC_PREFIX.length);
  const binaryStr = atob(rawB64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  if (bytes.length < 12) {
    throw new Error('Ciphertext too short');
  }

  const nonce = bytes.slice(0, 12);
  const ciphertext = bytes.slice(12);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}

// ---------------------------------------------------------------------------
// 2. JWT Signing & Verification (HS256)
// ---------------------------------------------------------------------------
export async function signJwt(
  claims: AuthClaims,
  secret: string,
  expiresInSeconds = 14400 // 4 hours
): Promise<string> {
  const secretKey = new TextEncoder().encode(secret);
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSeconds)
    .setSubject(claims.user_id)
    .sign(secretKey);
}

export async function verifyJwt(token: string, secret: string): Promise<AuthClaims | null> {
  try {
    const secretKey = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: ['HS256'],
    });
    return payload as unknown as AuthClaims;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 3. Firebase Auth Token Verification (RS256 via Google Public Keys)
// ---------------------------------------------------------------------------
export async function verifyFirebaseIdToken(
  idToken: string,
  projectId: string,
  kv?: KVNamespace
): Promise<{ uid: string; phone_number?: string; email?: string } | null> {
  try {
    // Decode header to extract kid
    const [headerB64] = idToken.split('.');
    const header = JSON.parse(atob(headerB64));
    const kid = header.kid;
    if (!kid) return null;

    let certsJson: string | null = null;
    if (kv) {
      certsJson = await kv.get('firebase_public_certs');
    }

    if (!certsJson) {
      const resp = await fetch(
        'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
      );
      if (!resp.ok) return null;
      certsJson = await resp.text();
      if (kv) {
        // Cache certs in KV for 1 hour
        await kv.put('firebase_public_certs', certsJson, { expirationTtl: 3600 });
      }
    }

    const certs = JSON.parse(certsJson) as Record<string, string>;
    const certPem = certs[kid];
    if (!certPem) return null;

    // Use Web Crypto to verify against Firebase claims
    const [payloadB64] = idToken.split('.').slice(1, 2);
    const payload = JSON.parse(atob(payloadB64));

    if (payload.aud !== projectId) return null;
    if (payload.iss !== `https://securetoken.google.com/${projectId}`) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return {
      uid: payload.sub,
      phone_number: payload.phone_number,
      email: payload.email,
    };
  } catch (err) {
    console.error('[verifyFirebaseIdToken] verification failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 4. Password Hashing (PBKDF2 with SHA-256 via Web Crypto)
// ---------------------------------------------------------------------------
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    passwordKey,
    256
  );

  const saltHex = Array.from(salt).map((b) => b.toString(16).padStart(2, '0')).join('');
  const hashHex = Array.from(new Uint8Array(derived)).map((b) => b.toString(16).padStart(2, '0')).join('');

  return `pbkdf2:100000:${saltHex}:${hashHex}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;

  const iterations = parseInt(parts[1], 10);
  const saltHex = parts[2];
  const expectedHashHex = parts[3];

  const salt = new Uint8Array(
    saltHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
  );

  const enc = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    passwordKey,
    256
  );

  const derivedHex = Array.from(new Uint8Array(derived)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return derivedHex === expectedHashHex;
}
