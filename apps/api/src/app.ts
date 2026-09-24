import { OpenAPIHono } from '@hono/zod-openapi';
import { COOKIE_NAMES, isProblemError, toFieldErrors } from '@nina-pm/shared';
import { resolveSessionState } from './auth/session';
import { session, type ResolveSession } from './lib/auth';
import { readCookie } from './lib/cookies';
import { csrf } from './lib/csrf';
import type { ApiEnv } from './lib/env';
import { logger } from './lib/logger';
import { originVerify } from './lib/origin-verify';
import { problemResponse } from './lib/problem';
import { redact } from './lib/redact';
import { requestIdMiddleware, requestLog } from './lib/request-log';
import { AUTH_ROUTES, authRoutes } from './routes/auth';
import { healthRoute, healthRoutes } from './routes/health';
import type { ApiServices } from './routes/services';
import { downloadUrlRoute, webFileRoutes } from './routes/web-files';
import { getJobRoute, webJobRoutes } from './routes/web-jobs';

export interface AppDeps {
  /** Erwarteter Wert des Headers X-Origin-Verify (SSM-Cache). */
  readonly originVerifyValue: () => Promise<string>;
  /** Build-Kennung (Commit), gesetzt beim Deploy. */
  readonly buildId: string;
  /** Sitzungsprüfung je Anfrage; Standard: Cookie `__Host-npm_sid` gegen `auth_session` (TK 5.3). */
  readonly resolveSession?: ResolveSession;
  /** Dienste (DB, S3, Lambda) – erst beim ersten Bedarf erzeugt, damit /api/health ohne DB läuft. */
  readonly services?: () => Promise<ApiServices>;
}

/** Alle Routen mit ihrer Aktion (TK 5.5) – Quelle für Rechte-Testgenerator und OpenAPI. */
export const ROUTES = [healthRoute, ...AUTH_ROUTES, getJobRoute, downloadUrlRoute] as const;

const noServices = () => Promise.reject(new Error('Dienste nicht konfiguriert'));

/**
 * Hono-App der Lambda `api` (TK 7). Reihenfolge: Request-ID → Origin-Verify (SV-16) → Logging →
 * CSRF (SV-04) → Sitzung (TK 5.3, erst bei Bedarf) → je Route `authorize(action)` (TK 5.5) → zod → Handler.
 */
export function createApp(deps: AppDeps) {
  const services = deps.services ?? noServices;
  const app = new OpenAPIHono<ApiEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return problemResponse('validation.failed', {
          requestId: c.get('requestId'),
          errors: toFieldErrors(result.error),
        });
      }
      return undefined;
    },
  });

  app.use('*', requestIdMiddleware());
  app.use('*', originVerify(deps.originVerifyValue));
  app.use('*', requestLog());
  app.use('*', csrf());
  app.use(
    '*',
    session(
      deps.resolveSession ??
        (async (c) => {
          const svc = await services();
          return resolveSessionState(
            svc.auth,
            readCookie(c.req.header('cookie'), COOKIE_NAMES.session),
            svc.now(),
          );
        }),
    ),
  );

  app.route('/', healthRoutes(deps.buildId));
  app.route('/', authRoutes(services));
  app.route('/', webJobRoutes(services));
  app.route('/', webFileRoutes(services));

  app.notFound((c) => problemResponse('resource.not_found', { requestId: c.get('requestId') }));

  app.onError((error, c) => {
    const requestId = c.get('requestId');
    if (isProblemError(error)) {
      if (error.status >= 500)
        logger.error('problem_error', { code: error.code, requestId, error: redact(error) });
      return problemResponse(error.code, { requestId, errors: error.errors });
    }
    // Details nur ins Log, nie in die Antwort (rules/api.md). `route` speist den Alarm für /api/nina/v1.
    logger.error('unhandled_error', {
      route: c.req.path,
      method: c.req.method,
      requestId,
      error: redact(error),
    });
    return problemResponse('internal.error', { requestId });
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
