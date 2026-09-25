/**
 * Token-Prüfung für `/api/nina/v1` (TK 5.6, SV-08, rules/api.md): `Authorization: Bearer npm_…`;
 * **jede** Anfrage sucht den Hash über den eindeutigen Index (kein Cache, kein Ablauf) – unbekannt,
 * widerrufen oder fehlend → `401 nina.token_invalid`, gesperrter Mandant → `403 tenant.locked`.
 * `X-NPM-Engine-Version` mit anderer Major-Version → `409 engine.incompatible`.
 */
import type { NinaPrincipal } from '@nina-pm/db';
import { ENGINE_VERSION } from '@nina-pm/engine';
import type { MiddlewareHandler } from 'hono';
import type { ApiEnv } from '../lib/env';
import { logger } from '../lib/logger';
import { problemResponse } from '../lib/problem';
import type { ApiServices } from '../routes/services';
import { hashNinaToken, NINA_TOKEN_PATTERN } from './token';

export const NINA_PREFIX = '/api/nina/v1';
export const ENGINE_VERSION_HEADER = 'x-npm-engine-version';

export type NinaAuthState =
  | { readonly ok: true; readonly principal: NinaPrincipal }
  | { readonly ok: false; readonly code: 'nina.token_invalid' | 'tenant.locked' };

const major = (v: string) => v.split('.')[0] ?? '';

/** App-Middleware: stellt die Token-Prüfung für NINA-Pfade als einmal ausgeführte Funktion bereit. */
export function ninaSession(services: () => Promise<ApiServices>): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    let pending: Promise<NinaAuthState> | undefined;
    c.set('nina', null);
    c.set(
      'ninaAuth',
      () =>
        (pending ??= (async (): Promise<NinaAuthState> => {
          const m = /^Bearer (\S+)$/.exec(c.req.header('authorization') ?? '');
          const token = m?.[1];
          if (!token || !NINA_TOKEN_PATTERN.test(token))
            return { ok: false, code: 'nina.token_invalid' };
          const svc = await services();
          const principal = await svc.nina.lookup(hashNinaToken(token));
          if (!principal || principal.status !== 'active')
            return { ok: false, code: 'nina.token_invalid' };
          if (principal.tenantStatus !== 'active') return { ok: false, code: 'tenant.locked' };
          try {
            await svc.nina.touch(principal, svc.now());
          } catch (error) {
            logger.warn('nina_touch_failed', {
              error: error instanceof Error ? error.message : '',
            });
          }
          return { ok: true, principal };
        })()),
    );
    await next();
  };
}

/** Routen-Middleware für jede NINA-Route (statt `authorize(action)`): Token, Mandant, Engine-Version. */
export function ninaAuthorize(): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const requestId = c.get('requestId');
    const state = await c.get('ninaAuth')();
    if (!state.ok) return problemResponse(state.code, { requestId });
    const engine = c.req.header(ENGINE_VERSION_HEADER);
    if (engine !== undefined && major(engine) !== major(ENGINE_VERSION))
      return problemResponse('engine.incompatible', { requestId });
    c.set('nina', state.principal);
    await next();
    return undefined;
  };
}
