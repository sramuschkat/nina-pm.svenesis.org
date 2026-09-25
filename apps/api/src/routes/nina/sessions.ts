/**
 * Sessions, Aufnahmen, Ereignisse und Heartbeat der NINA-API (AP-14b; TK 5.6, 6.6, 7.3, 7.6).
 * Jede Route mit `{sessionId}` sieht nur Sessions des Token-Rigs (SEC-53 → 404).
 */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import { nina, Uuid } from '@nina-pm/shared';
import type { ApiEnv } from '../../lib/env';
import {
  createSession,
  heartbeat,
  ingestCaptures,
  ingestEvents,
  patchSession,
} from '../../nina/session';
import { problemContent } from '../define';
import type { ApiServices } from '../services';
import { batchLimit, defineNinaRoute, NINA_BASE } from './define';

const json = <S extends z.ZodType>(schema: S) => ({
  content: { 'application/json': { schema } },
});
const denied = {
  401: problemContent('nina.token_invalid'),
  403: problemContent('tenant.locked'),
};
const sessionParam = z.object({ sessionId: Uuid });

export const createSessionRoute = defineNinaRoute(
  { requirements: ['FA-SYN-06', 'FA-RIG-06', 'NT-01', 'NT-09', 'NT-47', 'SEC-53'] },
  {
    method: 'post',
    path: `${NINA_BASE}/sessions`,
    summary: 'Session anlegen (idempotent je Rig) mit Lease; offline ohne Lease',
    tags: ['nina'],
    request: { body: { ...json(nina.NinaSessionCreate), required: true } },
    responses: {
      200: { description: 'Bereits angelegt (idempotent)', ...json(nina.NinaSessionCreated) },
      201: { description: 'Angelegt', ...json(nina.NinaSessionCreated) },
      ...denied,
      404: problemContent('resource.not_found'),
      409: problemContent('session.rig_busy | engine.incompatible'),
      422: problemContent('nina.night_invalid | validation.failed'),
    },
  },
);

export const patchSessionRoute = defineNinaRoute(
  { requirements: ['FA-NIN-13', 'NT-11', 'NT-15', 'NT-47', 'M6', 'NIN5-7', 'NIN5-14', 'SEC-53'] },
  {
    method: 'patch',
    path: `${NINA_BASE}/sessions/{sessionId}`,
    summary: 'Session beenden, fortsetzen oder Offline-Plan nachmelden',
    tags: ['nina'],
    request: {
      params: sessionParam,
      body: { ...json(nina.NinaSessionPatch), required: true },
    },
    responses: {
      200: { description: 'Session', ...json(nina.NinaSessionPatched) },
      ...denied,
      404: problemContent('resource.not_found'),
      409: problemContent('session.closed | session.rig_busy | engine.incompatible'),
    },
  },
);

export const capturesRoute = defineNinaRoute(
  {
    requirements: [
      'FA-SYN-04',
      'FA-SYN-05',
      'FA-NIN-17',
      'NT-10',
      'NT-14',
      'NT-E2',
      'NT-E3',
      'SEC-53',
    ],
    before: batchLimit('captures', nina.NINA_CAPTURE_BATCH_MAX, 'capture.batch_too_large'),
  },
  {
    method: 'post',
    path: `${NINA_BASE}/sessions/{sessionId}/captures`,
    summary: 'Aufnahmemeldungen (≤ 500, idempotent) mit Status je Meldung',
    tags: ['nina'],
    request: {
      params: sessionParam,
      body: { ...json(nina.NinaCaptureBatch), required: true },
    },
    responses: {
      200: { description: 'Status je Meldung', ...json(nina.NinaCaptureResults) },
      ...denied,
      404: problemContent('resource.not_found'),
      409: problemContent('session.unknown | session.closed | engine.incompatible'),
      413: problemContent('capture.batch_too_large'),
      422: problemContent('validation.failed'),
    },
  },
);

export const eventsRoute = defineNinaRoute(
  {
    requirements: ['FA-SYN-06', 'SEC-52', 'SEC-53'],
    before: batchLimit('events', nina.NINA_EVENT_BATCH_MAX, 'event.batch_too_large'),
  },
  {
    method: 'post',
    path: `${NINA_BASE}/sessions/{sessionId}/events`,
    summary: 'Ereignisse (≤ 200, idempotent)',
    tags: ['nina'],
    request: {
      params: sessionParam,
      body: { ...json(nina.NinaEventBatch), required: true },
    },
    responses: {
      200: { description: 'Angenommen', ...json(nina.NinaEventResults) },
      ...denied,
      404: problemContent('resource.not_found'),
      409: problemContent('session.unknown | session.closed | engine.incompatible'),
      413: problemContent('event.batch_too_large'),
      422: problemContent('validation.failed'),
    },
  },
);

export const heartbeatRoute = defineNinaRoute(
  { requirements: ['FA-SYN-07', 'FA-RIG-06', 'FA-NIN-04', 'NT-05', 'NT-17', 'NT-22', 'M5', 'M6'] },
  {
    method: 'post',
    path: `${NINA_BASE}/heartbeat`,
    summary: 'Heartbeat: Zustand, NINA-Einstellungen, Lease verlängern bzw. zurückholen',
    tags: ['nina'],
    request: { body: { ...json(nina.NinaHeartbeat), required: true } },
    responses: {
      200: { description: 'Antwort', ...json(nina.NinaHeartbeatResponse) },
      ...denied,
      409: problemContent('engine.incompatible'),
    },
  },
);

export const NINA_SESSION_ROUTES = [
  createSessionRoute,
  patchSessionRoute,
  capturesRoute,
  eventsRoute,
  heartbeatRoute,
] as const;

export function ninaSessionRoutes(services: () => Promise<ApiServices>) {
  const app = new OpenAPIHono<ApiEnv>();
  const principal = (c: { get(key: 'nina'): ApiEnv['Variables']['nina'] }) => {
    const p = c.get('nina');
    if (!p) throw new Error('ninaAuthorize fehlt');
    return p;
  };

  app.openapi(createSessionRoute, async (c) => {
    const r = await createSession(await services(), principal(c), c.req.valid('json'));
    c.header('cache-control', 'no-store');
    return c.json(r.body, r.created ? 201 : 200);
  });

  app.openapi(patchSessionRoute, async (c) => {
    const { sessionId } = c.req.valid('param');
    return c.json(
      await patchSession(await services(), principal(c), sessionId, c.req.valid('json')),
      200,
    );
  });

  app.openapi(capturesRoute, async (c) => {
    const { sessionId } = c.req.valid('param');
    return c.json(
      await ingestCaptures(await services(), principal(c), sessionId, c.req.valid('json')),
      200,
    );
  });

  app.openapi(eventsRoute, async (c) => {
    const { sessionId } = c.req.valid('param');
    return c.json(
      await ingestEvents(await services(), principal(c), sessionId, c.req.valid('json')),
      200,
    );
  });

  app.openapi(heartbeatRoute, async (c) => {
    c.header('cache-control', 'no-store');
    return c.json(await heartbeat(await services(), principal(c), c.req.valid('json')), 200);
  });

  return app;
}
