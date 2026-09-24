/**
 * Cookies (TK 5.3): nur `__Host-npm_sid`, `__Host-npm_oauth`, `__Host-npm_invite` – host-only, HttpOnly,
 * Secure, SameSite=Lax, Path=/. `oauth` und `invite` sind mit HMAC-SHA-256 signiert; der Schlüssel ist
 * aus `/nina-pm/oauth/cookie-secret` abgeleitet (SV-02), ohne Rotationsverfahren.
 */
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

export interface CookieOptions {
  readonly maxAgeSeconds?: number;
}

/** Set-Cookie mit den festen Attributen für `__Host-` (kein Domain-Attribut, Path=/, Secure). */
export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  if (!name.startsWith('__Host-')) throw new Error('Nur __Host-Cookies');
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax'];
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${options.maxAgeSeconds}`);
  return parts.join('; ');
}

export function clearCookie(name: string): string {
  return serializeCookie(name, '', { maxAgeSeconds: 0 });
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

function macKey(secret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'nina-pm', `cookie/${purpose}/v1`, 32));
}

/** Signierter Wert `base64url(JSON).base64url(HMAC)`, mit Ablauf `exp` (Sekunden). */
export function signValue(
  secret: string,
  purpose: string,
  payload: object,
  expiresAtSec: number,
): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: expiresAtSec })).toString('base64url');
  const mac = createHmac('sha256', macKey(secret, purpose)).update(body).digest('base64url');
  return `${body}.${mac}`;
}

/** Prüft Signatur und Ablauf; `undefined` bei jeder Abweichung (manipuliert, fremd, abgelaufen). */
export function verifyValue<T extends object>(
  secret: string,
  purpose: string,
  value: string | undefined,
  nowSec: number,
): T | undefined {
  if (!value || value.length > 4096) return undefined;
  const [body, mac, ...rest] = value.split('.');
  if (!body || !mac || rest.length > 0) return undefined;
  const expected = createHmac('sha256', macKey(secret, purpose)).update(body).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & {
      exp?: unknown;
    };
    if (typeof payload.exp !== 'number' || payload.exp <= nowSec) return undefined;
    return payload;
  } catch {
    return undefined;
  }
}
