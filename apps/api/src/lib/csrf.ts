import { CSRF_HEADER, CSRF_HEADER_VALUE } from '@nina-pm/shared';
import type { MiddlewareHandler } from 'hono';
import { problemResponse } from './problem';

/** Bereiche mit Cookie-Sitzung; `/api/nina/v1` (Bearer-Token, kein Cookie) ist ausgenommen. */
const PROTECTED_PREFIXES = ['/api/auth', '/api/web/v1', '/api/system/v1'] as const;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requiresCsrfHeader(method: string, path: string): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return false;
  return PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * CSRF (SV-04, TK 5.3): jede nicht-GET-Methode unter /api/auth, /api/web/v1, /api/system/v1 – auch
 * anonyme wie `POST /auth/invitation/claim` – verlangt `X-NPM-Request: 1`, sonst `403 auth.csrf_missing`.
 * Keine Origin-/Fetch-Metadata-Prüfung.
 */
export function csrf(): MiddlewareHandler {
  return async (c, next) => {
    if (
      requiresCsrfHeader(c.req.method, c.req.path) &&
      c.req.header(CSRF_HEADER) !== CSRF_HEADER_VALUE
    ) {
      return problemResponse('auth.csrf_missing', { requestId: c.get('requestId') });
    }
    await next();
    return undefined;
  };
}
