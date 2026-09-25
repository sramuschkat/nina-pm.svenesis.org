import { OpenAPIHono } from '@hono/zod-openapi';
import { COOKIE_NAMES, isProblemError, toFieldErrors } from '@nina-pm/shared';
import { resolveSessionState } from './auth/session';
import { session, type ResolveSession } from './lib/auth';
import { ninaSession } from './nina/auth';
import { readCookie } from './lib/cookies';
import { csrf } from './lib/csrf';
import type { ApiEnv } from './lib/env';
import { logger } from './lib/logger';
import { originVerify } from './lib/origin-verify';
import { problemResponse } from './lib/problem';
import { redact } from './lib/redact';
import { requestIdMiddleware, requestLog } from './lib/request-log';
import { AUTH_ROUTES, authRoutes } from './routes/auth';
import { bannerRoute, bannerRoutes } from './routes/banner';
import { healthRoute, healthRoutes } from './routes/health';
import { SYSTEM_ROUTES, systemRoutes } from './routes/system';
import { AUDIT_ROUTES, webAuditRoutes } from './routes/web-audit';
import { TENANT_ROUTES, webTenantRoutes } from './routes/web-tenant';
import { EQUIPMENT_ROUTES, webEquipmentRoutes } from './routes/web-equipment';
import { PROJECT_ROUTES, webProjectRoutes } from './routes/web-projects';
import { APPROVAL_ROUTES, webApprovalRoutes } from './routes/web-approval';
import { ME_ROUTES, webMeRoutes } from './routes/web-me';
import { NOTIFICATION_ROUTES, webNotificationRoutes } from './routes/web-notifications';
import { MEMBER_ROUTES, webMemberRoutes } from './routes/web-members';
import type { ApiServices } from './routes/services';
import { downloadUrlRoute, webFileRoutes } from './routes/web-files';
import { getJobRoute, webJobRoutes } from './routes/web-jobs';
import { SIMULATION_ROUTES, webSimulationRoutes } from './routes/web-simulations';
import { NINA_INSTANCE_ROUTES, webNinaInstanceRoutes } from './routes/web-nina-instances';
import { NINA_OPS_ROUTES, webNinaOpsRoutes } from './routes/web-nina-ops';
import { NINA_SYNC_ROUTES, ninaSyncRoutes } from './routes/nina/sync';
import { NINA_SESSION_ROUTES, ninaSessionRoutes } from './routes/nina/sessions';

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
export const ROUTES = [
  healthRoute,
  bannerRoute,
  ...AUTH_ROUTES,
  getJobRoute,
  downloadUrlRoute,
  ...MEMBER_ROUTES,
  ...ME_ROUTES,
  ...NOTIFICATION_ROUTES,
  ...AUDIT_ROUTES,
  ...TENANT_ROUTES,
  ...EQUIPMENT_ROUTES,
  ...PROJECT_ROUTES,
  ...APPROVAL_ROUTES,
  ...SIMULATION_ROUTES,
  ...NINA_INSTANCE_ROUTES,
  ...NINA_OPS_ROUTES,
  ...SYSTEM_ROUTES,
] as const;

/** NINA-API (`/api/nina/v1`, Bearer-Token statt Sitzung): eigener Rechte-Test (nina-rights.test.ts). */
export const NINA_ROUTES = [...NINA_SYNC_ROUTES, ...NINA_SESSION_ROUTES] as const;

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

  app.use('/api/nina/v1/*', ninaSession(services));

  app.route('/', healthRoutes(deps.buildId));
  app.route('/', bannerRoutes(services));
  app.route('/', authRoutes(services));
  app.route('/', webJobRoutes(services));
  app.route('/', webFileRoutes(services));
  app.route('/', webMemberRoutes(services));
  app.route('/', webMeRoutes(services));
  app.route('/', webNotificationRoutes(services));
  app.route('/', webAuditRoutes(services));
  app.route('/', webTenantRoutes(services));
  app.route('/', webEquipmentRoutes(services));
  app.route('/', webProjectRoutes(services));
  app.route('/', webApprovalRoutes(services));
  app.route('/', webSimulationRoutes(services));
  app.route('/', webNinaInstanceRoutes(services));
  app.route('/', webNinaOpsRoutes(services));
  app.route('/', ninaSyncRoutes(services));
  app.route('/', ninaSessionRoutes(services));
  app.route('/', systemRoutes(services));

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
