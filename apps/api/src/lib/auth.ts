import { can, type Action } from '@nina-pm/shared';
import type { Context, MiddlewareHandler } from 'hono';
import { ANONYMOUS, type SessionState } from '../auth/session';
import type { ApiEnv } from './env';
import { problemResponse } from './problem';

/** Sitzungsprüfung je Anfrage (TK 5.3); im Test durch eine feste Sitzung ersetzbar. */
export type ResolveSession = (c: Context<ApiEnv>) => Promise<SessionState>;

export const anonymousOnly: ResolveSession = () => Promise.resolve(ANONYMOUS);

/** Stellt die Sitzungsprüfung als einmal ausgeführte Funktion bereit (kein DB-Zugriff ohne Bedarf). */
export function session(resolve: ResolveSession): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    let pending: Promise<SessionState> | undefined;
    c.set('auth', null);
    c.set('session', () => (pending ??= resolve(c)));
    await next();
  };
}

export interface AuthorizeOptions {
  /** Route ohne fachliche Aktion, aber nur mit gültiger Sitzung (z. B. `/auth/me`, jeder Kontext). */
  readonly session?: 'required';
}

/**
 * Erzwingt `can()` auf Aktionsebene vor dem Handler (TK 5.5). Ohne Sitzung `401 auth.unauthenticated`;
 * gesperrte Identität `403 auth.identity_blocked`; gesperrter Mandant `403 tenant.locked`; sonst
 * `403 permission.denied`. Objektregeln prüft der Use-Case mit dem geladenen Objekt erneut.
 */
export function authorize(
  action: Action,
  options: AuthorizeOptions = {},
): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    if (action === 'public' && options.session !== 'required') {
      await next();
      return undefined;
    }
    const state = await c.get('session')();
    c.set('auth', state.auth);
    const requestId = c.get('requestId');
    if (state.denial === 'auth.identity_blocked')
      return problemResponse('auth.identity_blocked', { requestId });
    if (!state.auth) return problemResponse('auth.unauthenticated', { requestId });
    if (action !== 'public') {
      if (state.denial === 'tenant.locked') return problemResponse('tenant.locked', { requestId });
      if (!can(state.auth, action)) return problemResponse('permission.denied', { requestId });
    }
    await next();
    return undefined;
  };
}
