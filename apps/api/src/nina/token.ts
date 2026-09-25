/**
 * Sync-Token der NINA-Instanzen (TK 5.6, SV-08): `npm_<base62(32 Bytes)>` (256 Bit, 43 Zeichen nach
 * dem Präfix), gespeichert nur als SHA-256 (hex) und mit Anzeige-Präfix; nie geloggt.
 */
import { createHash, randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BODY_LENGTH = 43;
export const NINA_TOKEN_PATTERN = /^npm_[0-9A-Za-z]{43}$/;

function base62(bytes: Uint8Array): string {
  let n = BigInt(`0x${Buffer.from(bytes).toString('hex') || '0'}`);
  let out = '';
  while (n > 0n) {
    out = (ALPHABET[Number(n % 62n)] ?? '0') + out;
    n /= 62n;
  }
  return out.padStart(BODY_LENGTH, '0');
}

export function hashNinaToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function newNinaToken(): { token: string; hash: string; prefix: string } {
  const token = `npm_${base62(randomBytes(32))}`;
  return { token, hash: hashNinaToken(token), prefix: token.slice(0, 8) };
}
