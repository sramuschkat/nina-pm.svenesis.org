import { createHash, randomBytes } from 'node:crypto';

/** 256 Bit zufällig, base64url (Sitzungs-ID, state, PKCE-Verifier, Einladungs-Token). */
export const randomToken = (): string => randomBytes(32).toString('base64url');

export const sha256Hex = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

/** PKCE S256: `BASE64URL(SHA-256(code_verifier))` (RFC 7636). */
export const pkceChallenge = (verifier: string): string =>
  createHash('sha256').update(verifier).digest('base64url');

/** IP für die Sitzungsliste gekürzt: IPv4 auf /24, IPv6 auf /48 (TK 5.3). */
export function truncateIp(ip: string | undefined): string | null {
  if (!ip) return null;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (ip.includes(':')) {
    const groups = ip.split(':').filter((g, i, all) => g !== '' || i === 0 || i === all.length - 1);
    return `${groups.slice(0, 3).join(':')}::/48`;
  }
  return null;
}

/** Gerät/Browser grob aus dem User-Agent – nur zur Anzeige in „Meine Anmeldesitzungen“. */
export function deviceLabel(userAgent: string | undefined): string | null {
  if (!userAgent) return null;
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : undefined;
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /iPhone|iPad/.test(userAgent)
      ? 'iOS'
      : /Mac OS X/.test(userAgent)
        ? 'macOS'
        : /Android/.test(userAgent)
          ? 'Android'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : undefined;
  if (browser || os) return [browser, os].filter(Boolean).join(' · ');
  return userAgent.slice(0, 60);
}
