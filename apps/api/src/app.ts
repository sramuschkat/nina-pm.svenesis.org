import { ENGINE_VERSION } from '@nina-pm/engine';
import { Hono } from 'hono';
import { logger } from './lib/logger';
import { originVerify } from './lib/origin-verify';
import { problemResponse } from './lib/problem';

export interface AppDeps {
  /** Erwarteter Wert des Headers X-Origin-Verify (SSM-Cache). */
  readonly originVerifyValue: () => Promise<string>;
  /** Build-Kennung (Commit), gesetzt beim Deploy. */
  readonly buildId: string;
}

/**
 * Hono-App der Lambda `api` (TK 7). Stand AP-02b: nur `GET /api/health` – öffentlich, ohne DB-Ping
 * (SV-07). Fachliche Routen folgen ab AP-04a/AP-05.
 */
export function createApp(deps: AppDeps) {
  const app = new Hono();

  app.use('*', originVerify(deps.originVerifyValue));

  app.get('/api/health', (c) => {
    c.header('cache-control', 'no-store');
    return c.json({ status: 'ok', engineVersion: ENGINE_VERSION, build: deps.buildId });
  });

  app.notFound(() => problemResponse('resource.not_found'));

  app.onError((error, c) => {
    const lambdaEvent = (
      c.env as { event?: { requestContext?: { requestId?: string } } } | undefined
    )?.event;
    const requestId =
      lambdaEvent?.requestContext?.requestId ??
      c.req.header('x-amzn-requestid') ??
      c.req.header('x-amz-cf-id');
    // Details nur ins Log, nie in die Antwort (rules/api.md). `route` speist den Alarm für /api/nina/v1.
    logger.error('unhandled_error', { route: c.req.path, method: c.req.method, requestId, error });
    return problemResponse('internal.error', requestId);
  });

  return app;
}
