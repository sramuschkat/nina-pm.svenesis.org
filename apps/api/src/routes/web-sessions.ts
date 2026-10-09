/**
 * Sessions im Web (AP-15; S-60, S-61; FA-AUS-01…03, FA-AUS-06, FA-AUS-07; TK 7.2):
 * - `GET /web/v1/sessions` und `GET /web/v1/sessions/{id}` (`session.read`); die Liste seit AP-64 seitenweise
 *   (`cursor`/`nextCursor`) mit Effizienz, Wetterbewertung und Projekt-Chips je Session.
 * - `GET /web/v1/sessions/summary` (`session.read`, AP-64): Kennzahlen der Nächte für Rig und Zeitraum.
 * - `POST /web/v1/sessions/{id}/corrections` (`session.correct`, Objekt = Projekt der Zeile: Admins,
 *   User nur für eigene Projekte bei Mandanteneinstellung `userCorrections`): Verworfen je Zeile und
 *   Nacht = max(Korrektur, einzeln verworfene) – darunter `409 correction.conflict`; Verbleibend steigt,
 *   ein fertiges Projekt geht zurück nach *Aktiv* (FA-PRJ-12).
 * - `PUT /web/v1/sessions/{id}/review` (`session.review`): *Als geprüft markieren* (FA-AUS-07).
 * - `PATCH /web/v1/captures/{id}` (`session.correct`, Objekt = Projekt der Aufnahme wie bei der Korrektur):
 *   einzelne Aufnahme verwerfen bzw. zurücknehmen (AP-31, FA-AUS-20); Regel max ohne Doppelabzug.
 * Das Detail trägt Kennzahlen und Abweichungsgründe (AP-31, FA-AUS-04/05/09).
 * Nicht zugeordnete Aufnahmen ordnet `PATCH /web/v1/captures/{id}/assign` zu (AP-14b).
 * - `POST /web/v1/sessions/{id}/report/resend` (`session.report.resend`): Nachtbericht erneut nach Discord
 *   (AP-60, FA-AUS-21, TK 7.7) – Zustellzeilen zurückgesetzt, neue Jobs, Eintrag im Änderungsprotokoll.
 */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import { applyCorrection, rejectCapture } from '@nina-pm/db';
import {
  can,
  CaptureReject,
  CaptureRejectResult,
  NIGHT_SESSION_CAPTURE_LIMIT,
  NightSessionCorrection,
  NightSessionDetail,
  NightSessionList,
  NightSessionQuery,
  NightSessionReviewed,
  NightSessionSummary,
  NightSessionSummaryQuery,
  imageScale,
  ProblemError,
  ReportResendResult,
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
  {
    action: 'session.read',
    requirements: ['FA-AUS-01', 'FA-AUS-05', 'FA-AUS-07', 'S-60', 'AP-64'],
  },
  {
    method: 'get',
    path: BASE,
    summary:
      'Sessions je Rig und Nacht (neueste zuerst, seitenweise) mit Effizienz, Wetterbewertung und Projekt-Chips',
    tags: ['sessions'],
    request: { query: NightSessionQuery },
    responses: { 200: { description: 'Sessions', ...json(NightSessionList) }, ...denied },
  },
);

export const sessionSummaryRoute = defineRoute(
  {
    action: 'session.read',
    requirements: ['FA-AUS-05', 'FA-AUS-07', 'FA-AUS-17', 'S-60', 'AP-64'],
  },
  {
    method: 'get',
    path: `${BASE}/summary`,
    summary:
      'Kennzahlen der Nächte für Rig und Zeitraum (Nächte, nutzbar, Integration, Effizienz, ungeprüft)',
    tags: ['sessions'],
    request: { query: NightSessionSummaryQuery },
    responses: { 200: { description: 'Kennzahlen', ...json(NightSessionSummary) }, ...denied },
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

export const captureRejectRoute = defineRoute(
  { action: 'session.correct', requirements: ['FA-AUS-20', 'FA-AUS-06', 'FK 8.4'] },
  {
    method: 'patch',
    path: '/api/web/v1/captures/{id}',
    summary: 'Einzelne Aufnahme verwerfen bzw. zurücknehmen',
    tags: ['sessions'],
    request: {
      params: z.object({ id: Uuid }),
      body: { ...json(CaptureReject), required: true },
    },
    responses: {
      200: { description: 'Zähler der Zeile in der Nacht', ...json(CaptureRejectResult) },
      ...denied,
      404: problemContent('resource.not_found'),
      409: problemContent('capture.not_rejectable'),
      422: problemContent('validation.failed'),
    },
  },
);

export const reportResendRoute = defineRoute(
  { action: 'session.report.resend', requirements: ['FA-AUS-21', 'TK 7.7', 'DAT5-4'] },
  {
    method: 'post',
    path: `${BASE}/{id}/report/resend`,
    summary: 'Nachtbericht erneut nach Discord senden',
    tags: ['sessions'],
    request: { params: z.object({ id: Uuid }) },
    responses: {
      200: { description: 'Eingereiht', ...json(ReportResendResult) },
      ...denied,
      404: problemContent('resource.not_found'),
    },
  },
);

export const SESSION_ROUTES = [
  listSessionsRoute,
  sessionSummaryRoute,
  sessionDetailRoute,
  sessionCorrectionRoute,
  sessionReviewRoute,
  captureRejectRoute,
  reportResendRoute,
] as const;

export function webSessionRoutes(services: () => Promise<ApiServices>) {
  const app = new OpenAPIHono<ApiEnv>();

  app.openapi(listSessionsRoute, async (c) => {
    const svc = await services();
    const q = c.req.valid('query');
    const page = await svc
      .repositories(requireTenant(c).tenant)
      .sessionReview()
      .page({
        rigId: q.rigId,
        unreviewed: q.unreviewed === 'true',
        from: q.from,
        to: q.to,
        limit: q.limit,
        cursor: q.cursor,
      });
    c.header('cache-control', 'no-store');
    return c.json(page, 200);
  });

  // Vor `/{id}` registriert: sonst fängt die Detailroute „summary“ als ID ab.
  app.openapi(sessionSummaryRoute, async (c) => {
    const svc = await services();
    const q = c.req.valid('query');
    const summary = await svc
      .repositories(requireTenant(c).tenant)
      .sessionReview()
      .summary({ rigId: q.rigId, from: q.from, to: q.to });
    c.header('cache-control', 'no-store');
    return c.json(summary, 200);
  });

  app.openapi(sessionDetailRoute, async (c) => {
    const svc = await services();
    const { auth, tenant } = requireTenant(c);
    const repos = svc.repositories(tenant);
    const detail = await repos
      .sessionReview()
      .detail(c.req.valid('param').id, NIGHT_SESSION_CAPTURE_LIMIT);
    // Je Zeile, ob der Aufrufer korrigieren darf – dieselbe Prüfung wie bei Korrektur und Verwerfen unten.
    const { userCorrections } = (await repos.tenant().settings()).settings;
    const rows = detail.rows.map((r) => ({
      ...r,
      canCorrect: can(auth, 'session.correct', {
        tenantId: tenant.tenantId,
        ...(r.projectCreatedBy ? { createdBy: r.projectCreatedBy } : {}),
        settings: { userCorrections },
      }),
    }));
    // Bildqualität (AP-72): Pixelmaßstab des Rigs und Bezugswerte der letzten 30 Nächte.
    const eq = repos.equipment();
    const rig = await eq.rig(detail.session.rigId);
    const [telescope, camera] = rig
      ? await Promise.all([eq.telescope(rig.telescopeId), eq.camera(rig.cameraId)])
      : [undefined, undefined];
    const quality = {
      scaleArcsecPx:
        telescope && camera ? imageScale({ ...telescope, ...camera }).scaleArcsecPx : null,
      refs: await repos.imageQuality().refs(detail.session.rigId, detail.session.night),
    };
    c.header('cache-control', 'no-store');
    return c.json({ ...detail, rows, quality }, 200);
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

  app.openapi(captureRejectRoute, async (c) => {
    const svc = await services();
    const { auth, tenant } = requireTenant(c);
    const body = c.req.valid('json');
    const id = c.req.valid('param').id;
    const repos = svc.repositories(tenant);
    const target = await repos.sessionReview().rejectTarget(id);
    const settings = (await repos.tenant().settings()).settings;
    if (
      !can(auth, 'session.correct', {
        tenantId: tenant.tenantId,
        ...(target.projectCreatedBy ? { createdBy: target.projectCreatedBy } : {}),
        settings: { userCorrections: settings.userCorrections },
      })
    )
      throw new ProblemError('permission.denied');
    const r = await rejectCapture(
      svc.db,
      {
        tenantId: tenant.tenantId,
        userId: tenant.memberId as string,
        captureId: id,
        rejected: body.rejected,
        reason: body.reason,
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

  app.openapi(reportResendRoute, async (c) => {
    const svc = await services();
    const channels = await svc
      .repositories(requireTenant(c).tenant)
      .discord()
      .resendSessionReport(c.req.valid('param').id, svc.now());
    return c.json({ channels }, 200);
  });

  return app;
}
