/**
 * Token-Prüfung für `/api/nina/v1` (TK 5.6, SV-08, rules/api.md): `Authorization: Bearer npm_…`;
 * **jede** Anfrage sucht den Hash über den eindeutigen Index (kein Cache, kein Ablauf) – unbekannt,
 * widerrufen oder fehlend → `401 nina.token_invalid`, gesperrter Mandant → `403 tenant.locked`.
 * `X-NPM-Engine-Version` mit anderer Major-Version → `409 engine.incompatible`.
 */
import { ninaRecordCall, type NinaPrincipal } from '@nina-pm/db';
import { ENGINE_VERSION } from '@nina-pm/engine';
import type { Context, MiddlewareHandler } from 'hono';
import type { ApiEnv } from '../lib/env';
import { isoUtc } from '../lib/format';
import { logger } from '../lib/logger';
import { problemResponse } from '../lib/problem';
import type { ApiServices } from '../routes/services';
import { hashNinaToken, NINA_TOKEN_PATTERN } from './token';

export const NINA_PREFIX = '/api/nina/v1';
export const ENGINE_VERSION_HEADER = 'x-npm-engine-version';

export type NinaAuthState =
  | { readonly ok: true; readonly principal: NinaPrincipal }
  | {
      readonly ok: false;
      readonly code: 'nina.token_invalid' | 'tenant.locked';
      /** Bekannte, aber widerrufene Instanz bzw. gesperrter Mandant: Fehler in der Diagnose vermerken. */
      readonly principal?: NinaPrincipal;
    };

const major = (v: string) => v.split('.')[0] ?? '';

/** App-Middleware: stellt die Token-Prüfung für NINA-Pfade als einmal ausgeführte Funktion bereit. */
export function ninaSession(services: () => Promise<ApiServices>): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    let pending: Promise<NinaAuthState> | undefined;
    c.set('nina', null);
    c.set('ninaServices', services);
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
          if (!principal) return { ok: false, code: 'nina.token_invalid' };
          if (principal.status !== 'active')
            return { ok: false, code: 'nina.token_invalid', principal };
          if (principal.tenantStatus !== 'active')
            return { ok: false, code: 'tenant.locked', principal };
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
    const started = Date.now();
    const requestId = c.get('requestId');
    const state = await c.get('ninaAuth')();
    const principal = state.ok ? state.principal : state.principal;
    let res: Response | undefined;
    if (!state.ok) res = problemResponse(state.code, { requestId });
    else {
      const engine = c.req.header(ENGINE_VERSION_HEADER);
      if (engine !== undefined && major(engine) !== major(ENGINE_VERSION))
        res = problemResponse('engine.incompatible', { requestId });
    }
    if (!res) {
      c.set('nina', state.ok ? state.principal : null);
      await next();
    }
    if (principal) await recordCall(c.get('ninaServices'), c, principal, res ?? c.res, started);
    return res;
  };
}

/** Aufruf im Ringpuffer der Instanz vermerken (FA-ADM-06); ein Fehler dabei ändert die Antwort nie. */
async function recordCall(
  services: () => Promise<ApiServices>,
  c: Context<ApiEnv>,
  p: NinaPrincipal,
  res: Response,
  started: number,
): Promise<void> {
  try {
    const svc = await services();
    let code: string | null = null;
    if (res.status >= 400 && res.headers.get('content-type')?.includes('json')) {
      const body = (await res.clone().json()) as { code?: unknown };
      code = typeof body.code === 'string' ? body.code.slice(0, 256) : null;
    }
    const route = c.req.routePath.startsWith(NINA_PREFIX)
      ? c.req.routePath.slice(NINA_PREFIX.length) || '/'
      : c.req.path.slice(NINA_PREFIX.length);
    await ninaRecordCall(
      svc.db,
      p,
      {
        atUtc: isoUtc(svc.now()),
        method: c.req.method.toUpperCase(),
        route: route.slice(0, 256),
        status: res.status,
        code,
        durationMs: Math.max(0, Date.now() - started),
      },
      { heartbeat: route === '/heartbeat' },
    );
  } catch (error) {
    logger.warn('nina_call_log_failed', { error: error instanceof Error ? error.message : '' });
  }
}
