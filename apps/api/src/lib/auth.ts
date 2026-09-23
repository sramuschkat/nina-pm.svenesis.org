import { can, type Action, type AuthContext } from '@nina-pm/shared';
import type { Context, MiddlewareHandler } from 'hono';
import type { ApiEnv } from './env';
import { problemResponse } from './problem';

/**
 * Sitzungsprüfung je Anfrage (TK 5.3). Bis AP-04a ein Stub: `resolveAuth` liefert immer `null`
 * (anonym); AP-04a ersetzt ihn durch die eine indizierte Abfrage über `__Host-npm_sid`.
 */
export type ResolveAuth = (c: Context<ApiEnv>) => Promise<AuthContext | null>;

export const anonymousOnly: ResolveAuth = () => Promise.resolve(null);

export function session(resolveAuth: ResolveAuth): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    c.set('auth', await resolveAuth(c));
    await next();
  };
}

/**
 * Erzwingt `can()` auf Aktionsebene vor dem Handler (TK 5.5). Ohne Sitzung `401 auth.unauthenticated`,
 * sonst `403 permission.denied`. Objektregeln prüft der Use-Case mit dem geladenen Objekt erneut.
 */
export function authorize(action: Action): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    if (action !== 'public') {
      const auth = c.get('auth');
      const requestId = c.get('requestId');
      if (!auth) return problemResponse('auth.unauthenticated', { requestId });
      if (!can(auth, action)) return problemResponse('permission.denied', { requestId });
    }
    await next();
    return undefined;
  };
}
