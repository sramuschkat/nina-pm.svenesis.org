/** Rig-Telemetrie der NINA-API (AP-67, FA-RIG-15): Messpunkte der Skripte am Rig mit dem Token einer NINA-Instanz. */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import { nina } from '@nina-pm/shared';
import type { ApiEnv } from '../../lib/env';
import { ingestTelemetry } from '../../nina/telemetry';
import { problemContent } from '../define';
import type { ApiServices } from '../services';
import { batchLimit, defineNinaRoute, NINA_BASE } from './define';

const json = <S extends z.ZodType>(schema: S) => ({
  content: { 'application/json': { schema } },
});

export const telemetryRoute = defineNinaRoute(
  {
    requirements: ['FA-RIG-15', 'FA-RIG-16'],
    before: batchLimit('samples', nina.TELEMETRY_BATCH_MAX, 'telemetry.batch_too_large'),
  },
  {
    method: 'post',
    path: `${NINA_BASE}/telemetry`,
    summary: 'Rig-Telemetrie (≤ 1.000 Messpunkte, idempotent je Rig, Quelle und Zeitpunkt)',
    description:
      'Messpunkte der Skripte am Rig (Mini-PC über Core Temp, Powerbox über Pegasus Unity). Mandant und Rig aus dem ' +
      'Token; Messpunkte älter als 7 Tage oder mehr als 5 min in der Zukunft zählen als `skipped`.',
    tags: ['nina'],
    request: { body: { ...json(nina.NinaTelemetryBatch), required: true } },
    responses: {
      200: { description: 'Angenommen', ...json(nina.NinaTelemetryResults) },
      401: problemContent('nina.token_invalid'),
      403: problemContent('tenant.locked'),
      404: problemContent('resource.not_found'),
      409: problemContent('engine.incompatible'),
      413: problemContent('telemetry.batch_too_large'),
      422: problemContent('validation.failed'),
    },
  },
);

export const NINA_TELEMETRY_ROUTES = [telemetryRoute] as const;

export function ninaTelemetryRoutes(services: () => Promise<ApiServices>) {
  const app = new OpenAPIHono<ApiEnv>();
  app.openapi(telemetryRoute, async (c) => {
    const p = c.get('nina');
    if (!p) throw new Error('ninaAuthorize fehlt');
    c.header('cache-control', 'no-store');
    return c.json(await ingestTelemetry(await services(), p, c.req.valid('json')), 200);
  });
  return app;
}
