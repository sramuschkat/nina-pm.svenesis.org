/**
 * Sessions im Web (AP-15; S-60, S-61; FA-AUS-01…03, FA-AUS-06, FA-AUS-07; TK 7.2):
 * - `GET /web/v1/sessions` und `GET /web/v1/sessions/{id}` (`session.read`).
 * - `POST /web/v1/sessions/{id}/corrections` (`session.correct`, Objekt = Projekt der Zeile: Admins,
 *   User nur für eigene Projekte bei Mandanteneinstellung `userCorrections`): Verworfen je Zeile und
 *   Nacht = max(Korrektur, einzeln verworfene) – darunter `409 correction.conflict`; Verbleibend steigt,
 *   ein fertiges Projekt geht zurück nach *Aktiv* (FA-PRJ-12).
 * - `PUT /web/v1/sessions/{id}/review` (`session.review`): *Als geprüft markieren* (FA-AUS-07).
 * Nicht zugeordnete Aufnahmen ordnet `PATCH /web/v1/captures/{id}/assign` zu (AP-14b).
 */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import { applyCorrection } from '@nina-pm/db';
import {
  can,
  NIGHT_SESSION_CAPTURE_LIMIT,
  NightSessionCorrection,
  NightSessionDetail,
  NightSessionList,
  NightSessionQuery,
  NightSessionReviewed,
  ProblemError,
  Uuid,
} from '@nina-pm/shared';
import type { ApiEnv } from '../lib/env';
import { defineRoute, problemContent } from './define';
import type { ApiServices } from './services';
import { requireTenant } from './tenant';

const BASE = '/api/web/v1/sessions';
const json = <S extends z.ZodType>(schema: S) => ({
  content: { 'application/json': { schema } },
});
const denied = {
  401: problemContent('Nicht angemeldet'),
  403: problemContent('Keine Berechtigung'),
};

export const listSessionsRoute = defineRoute(
  { action: 'session.read', requirements: ['FA-AUS-01', 'FA-AUS-07', 'S-60'] },
  {
    method: 'get',
    path: BASE,
    summary: 'Sessions je Rig und Nacht (neueste zuerst)',
    tags: ['sessions'],
    request: { query: NightSessionQuery },
    responses: { 200: { description: 'Sessions', ...json(NightSessionList) }, ...denied },
  },
);

export const sessionDetailRoute = defineRoute(
  { action: 'session.read', requirements: ['FA-AUS-01', 'FA-AUS-02', 'FA-AUS-03', 'S-61'] },
  {
    method: 'get',
    path: `${BASE}/{id}`,
    summary: 'Session-Detail: Soll/Ist je Zeile, Aufnahmen, Ereignisse, Flats',
    tags: ['sessions'],
    request: { params: z.object({ id: Uuid }) },
    responses: {
      200: { description: 'Detail', ...json(NightSessionDetail) },
      ...denied,
      404: problemContent('resource.not_found'),
    },
  },
);

export const sessionCorrectionRoute = defineRoute(
  { action: 'session.correct', requirements: ['FA-AUS-06', 'FK 8.4', 'DAT-1'] },
  {
    method: 'post',
    path: `${BASE}/{id}/corrections`,
    summary: 'Korrektur erfassen: Anzahl verworfen je Zeile und Nacht',
    tags: ['sessions'],
    request: {
      params: z.object({ id: Uuid }),
      body: { ...json(NightSessionCorrection), required: true },
    },
    responses: {
      200: {
        description: 'Verworfen in der Nacht nach der Regel max; neuer Projektstatus bei Rückkehr',
        ...json(
          z.object({
            rejectedCount: z.number().int().min(0),
            projectStatus: z.string().nullable(),
          }),
        ),
      },
      ...denied,
      404: problemContent('resource.not_found'),
      409: problemContent('correction.conflict'),
      422: problemContent('validation.failed'),
    },
  },
);

export const sessionReviewRoute = defineRoute(
  { action: 'session.review', requirements: ['FA-AUS-07', 'S-61'] },
  {
    method: 'put',
    path: `${BASE}/{id}/review`,
    summary: 'Session als geprüft markieren bzw. zurücknehmen',
    tags: ['sessions'],
    request: {
      params: z.object({ id: Uuid }),
      body: { ...json(NightSessionReviewed), required: true },
    },
    responses: {
      204: { description: 'Gespeichert' },
      ...denied,
      404: problemContent('resource.not_found'),
    },
  },
);

export const SESSION_ROUTES = [
  listSessionsRoute,
  sessionDetailRoute,
  sessionCorrectionRoute,
  sessionReviewRoute,
] as const;

export function webSessionRoutes(services: () => Promise<ApiServices>) {
  const app = new OpenAPIHono<ApiEnv>();

  app.openapi(listSessionsRoute, async (c) => {
    const svc = await services();
    const q = c.req.valid('query');
    const items = await svc
      .repositories(requireTenant(c).tenant)
      .sessionReview()
      .list({
        rigId: q.rigId,
        unreviewed: q.unreviewed === 'true',
        from: q.from,
        to: q.to,
        limit: q.limit,
      });
    c.header('cache-control', 'no-store');
    return c.json({ items }, 200);
  });

  app.openapi(sessionDetailRoute, async (c) => {
    const svc = await services();
    const detail = await svc
      .repositories(requireTenant(c).tenant)
      .sessionReview()
      .detail(c.req.valid('param').id, NIGHT_SESSION_CAPTURE_LIMIT);
    c.header('cache-control', 'no-store');
    return c.json(detail, 200);
  });

  app.openapi(sessionCorrectionRoute, async (c) => {
    const svc = await services();
    const { auth, tenant } = requireTenant(c);
    const body = c.req.valid('json');
    const repos = svc.repositories(tenant);
    const target = await repos
      .sessionReview()
      .correctionTarget(c.req.valid('param').id, body.exposureLineId);
    const settings = (await repos.tenant().settings()).settings;
    if (
      !can(auth, 'session.correct', {
        tenantId: tenant.tenantId,
        ...(target.projectCreatedBy ? { createdBy: target.projectCreatedBy } : {}),
        settings: { userCorrections: settings.userCorrections },
      })
    )
      throw new ProblemError('permission.denied');
    const r = await applyCorrection(
      svc.db,
      {
        tenantId: tenant.tenantId,
        userId: tenant.memberId as string,
        exposureLineId: body.exposureLineId,
        night: target.night,
        rejected: body.rejected,
        reason: body.reason,
        comment: body.comment,
      },
      svc.now(),
    );
    return c.json(r, 200);
  });

  app.openapi(sessionReviewRoute, async (c) => {
    const svc = await services();
    await svc
      .repositories(requireTenant(c).tenant)
      .sessionReview()
      .setReviewed(c.req.valid('param').id, c.req.valid('json').reviewed);
    return c.body(null, 204);
  });

  return app;
}
