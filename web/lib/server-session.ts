import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE_NAME = 'filtrox_session';
export const SESSION_IDLE_TTL_SECONDS = 30 * 24 * 60 * 60;

type SessionPayload = {
  sub?: unknown;
  iat?: unknown;
  last_activity?: unknown;
  exp?: unknown;
  [key: string]: unknown;
};

function decodeValidPayload(token: string | undefined, now: number): SessionPayload | null {
  if (!token || token.length > 8192) return null;
  const secret = process.env.FILTROX_SESSION_SECRET ?? '';
  if (Buffer.byteLength(secret, 'utf8') < 32) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encodedPayload, encodedSignature] = parts;
  if (!/^[A-Za-z0-9_-]+$/.test(encodedPayload) || !/^[A-Za-z0-9_-]+$/.test(encodedSignature)) return null;

  try {
    const supplied = Buffer.from(encodedSignature, 'base64url');
    const expected = createHmac('sha256', secret).update(encodedPayload, 'ascii').digest();
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;

    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as SessionPayload;
    if (payload.sub !== 'owner') return null;
    if (!Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.last_activity) || !Number.isSafeInteger(payload.exp)) return null;

    const issuedAt = payload.iat as number;
    const lastActivity = payload.last_activity as number;
    const expiresAt = payload.exp as number;
    if (issuedAt > now + 30 || lastActivity < issuedAt || lastActivity > now + 30) return null;
    if (expiresAt !== lastActivity + SESSION_IDLE_TTL_SECONDS || expiresAt <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

export function isValidSessionToken(token: string | undefined, now = Math.floor(Date.now() / 1000)): boolean {
  return decodeValidPayload(token, now) !== null;
}

export function refreshSessionToken(token: string | undefined, now = Math.floor(Date.now() / 1000)): string | null {
  const payload = decodeValidPayload(token, now);
  if (!payload) return null;

  payload.last_activity = now;
  payload.exp = now + SESSION_IDLE_TTL_SECONDS;
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const secret = process.env.FILTROX_SESSION_SECRET ?? '';
  const signature = createHmac('sha256', secret).update(encodedPayload, 'ascii').digest('base64url');
  return `${encodedPayload}.${signature}`;
}
