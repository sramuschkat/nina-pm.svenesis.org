/**
 * `GET /bootstrap`, `GET /targets`, `POST /plan` der NINA-API (AP-14a; TK 7.3, 7.6; FA-SYN-02/03,
 * FA-SIM-05) und `GET /simulation` für den Simulator im Plugin (AP-53, FA-NIN-18): Mandant und Rig
 * ausschließlich aus dem Token (TK 5.6).
 */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import { nina } from '@nina-pm/shared';
import { ifNoneMatchHits } from '../../lib/etag';
import type { ApiEnv } from '../../lib/env';
import { simulation } from '../../nina/simulation';
import { bootstrap, plan, targets } from '../../nina/sync';
import { problemContent } from '../define';
import type { ApiServices } from '../services';
import { defineNinaRoute, NINA_BASE } from './define';

const json = <S extends z.ZodType>(schema: S) => ({
  content: { 'application/json': { schema } },
});
const denied = {
  401: problemContent('nina.token_invalid'),
  403: problemContent('tenant.locked'),
  409: problemContent('engine.incompatible'),
};

export const bootstrapRoute = defineNinaRoute(
  { requirements: ['FA-SYN-02', 'FA-SIM-09', 'NT-02', 'NT-05', 'NT-E1', 'NT-E2', 'NT-40'] },
  {
    method: 'get',
    path: `${NINA_BASE}/bootstrap`,
    summary: 'Rig, Einstellungen, Mondprofile, Nacht-Tabelle ab der Mittagsnacht',
    tags: ['nina'],
    responses: { 200: { description: 'Bootstrap', ...json(nina.NinaBootstrap) }, ...denied },
  },
);

export const targetsRoute = defineNinaRoute(
  { requirements: ['FA-SYN-02', 'FA-SYN-03', 'NT-E1', 'NT-19'] },
  {
    method: 'get',
    path: `${NINA_BASE}/targets`,
    summary: 'Auslieferbare Projekte des Rigs (ETag ohne Zähler aus Meldungen)',
    tags: ['nina'],
    request: { headers: z.object({ 'if-none-match': z.string().max(1024).optional() }) },
    responses: {
      200: { description: 'Ziele', ...json(nina.NinaTargets) },
      304: { description: 'Unverändert' },
      ...denied,
    },
  },
);

export const planRoute = defineNinaRoute(
  { requirements: ['FA-SIM-05', 'FA-SYN-03', 'NT-01', 'NT-20', 'M4', 'M7'] },
  {
    method: 'post',
    path: `${NINA_BASE}/plan`,
    summary: 'Nachtplan vom Server (gleiche Engine und Eingaben wie der Simulator)',
    tags: ['nina'],
    request: { body: { ...json(nina.NinaPlanRequest), required: true } },
    responses: {
      200: { description: 'Nachtplan', ...json(nina.NinaPlanResponse) },
      ...denied,
      404: problemContent('resource.not_found'),
      422: problemContent('nina.night_invalid | engine.input_invalid | validation.failed'),
    },
  },
);

export const simulationRoute = defineNinaRoute(
  { requirements: ['FA-NIN-18', 'FA-SIM-05', 'FA-SIM-06', 'FA-SIM-07', 'FA-SIM-08'] },
  {
    method: 'get',
    path: `${NINA_BASE}/simulation`,
    summary: 'Simulator im Plugin: Nacht rechnen ohne Planrevision (gleiche Eingabe wie /plan)',
    description:
      'Nacht aus der Bootstrap-Tabelle; ganze Nacht ab Nachtfensterbeginn, ohne tonight und offene Meldungen. Speichert nichts (keine Planrevision, keine Session).',
    tags: ['nina'],
    request: { query: nina.NinaSimulationQuery },
    responses: {
      200: { description: 'Simulation', ...json(nina.NinaSimulation) },
      ...denied,
      422: problemContent('nina.night_invalid | engine.input_invalid | validation.failed'),
    },
  },
);

export const NINA_SYNC_ROUTES = [bootstrapRoute, targetsRoute, planRoute, simulationRoute] as const;

export function ninaSyncRoutes(services: () => Promise<ApiServices>) {
  const app = new OpenAPIHono<ApiEnv>();
  const principal = (c: { get(key: 'nina'): ApiEnv['Variables']['nina'] }) => {
    const p = c.get('nina');
    if (!p) throw new Error('ninaAuthorize fehlt');
    return p;
  };

  app.openapi(bootstrapRoute, async (c) => {
    c.header('cache-control', 'no-store');
    return c.json(await bootstrap(await services(), principal(c)), 200);
  });

  app.openapi(targetsRoute, async (c) => {
    const { body, etag } = await targets(await services(), principal(c));
    c.header('etag', etag);
    c.header('cache-control', 'no-cache');
    if (ifNoneMatchHits(c.req.valid('header')['if-none-match'], etag)) return c.body(null, 304);
    return c.json(body, 200);
  });

  app.openapi(simulationRoute, async (c) => {
    c.header('cache-control', 'no-store');
    const { night } = c.req.valid('query');
    return c.json(await simulation(await services(), principal(c), night), 200);
  });

  app.openapi(planRoute, async (c) => {
    c.header('cache-control', 'no-store');
    return c.json(await plan(await services(), principal(c), c.req.valid('json')), 200);
  });

  return app;
}
