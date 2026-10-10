/**
 * Sessions im Web (AP-15; S-60, S-61; FA-AUS-01…03, FA-AUS-06; TK 7.2):
 * - `GET /web/v1/sessions` und `GET /web/v1/sessions/{id}` (`session.read`); die Liste seit AP-64 seitenweise
 *   (`cursor`/`nextCursor`) mit Effizienz, Wetterbewertung und Projekt-Chips je Session.
 * - `GET /web/v1/sessions/summary` (`session.read`, AP-64): Kennzahlen der Nächte für Rig und Zeitraum.
 * - `POST /web/v1/sessions/{id}/corrections` (`session.correct`, Objekt = Projekt der Zeile: Admins,
 *   User nur für eigene Projekte bei Mandanteneinstellung `userCorrections`): Verworfen je Zeile und
 *   Nacht = max(Korrektur, einzeln verworfene) – darunter `409 correction.conflict`; Verbleibend steigt,
 *   ein fertiges Projekt geht zurück nach *Aktiv* (FA-PRJ-12).
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
  NightSessionSummary,
  NightSessionUnassigned,
  NightSessionSummaryQuery,
  gradeFlags,
  IMAGE_QUALITY_DEFAULTS,
  imageGrade,
  imageScale,
  ProblemError,
  ReportResendResult,
  Uuid,
} from '@nina-pm/shared';
import type { ApiEnv } from '../lib/env';
import { parseSnapshot } from '../sessions/log';
import {
  lineQualities,
  nightConditions,
  sessionQuality,
  sessionQualityByList,
} from '../sessions/night-quality';
import { refsByProject } from '../sessions/project-images';
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
    requirements: ['FA-AUS-01', 'FA-AUS-05', 'S-60', 'AP-64'],
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
    requirements: ['FA-AUS-05', 'FA-AUS-17', 'S-60', 'AP-64'],
  },
  {
    method: 'get',
    path: `${BASE}/summary`,
    summary: 'Kennzahlen der Nächte für Rig und Zeitraum (Nächte, nutzbar, Integration, Effizienz)',
    tags: ['sessions'],
    request: { query: NightSessionSummaryQuery },
    responses: { 200: { description: 'Kennzahlen', ...json(NightSessionSummary) }, ...denied },
  },
);

export const sessionUnassignedRoute = defineRoute(
  { action: 'session.read', requirements: ['FA-AUS-22', 'S-02', 'AP-77'] },
  {
    method: 'get',
    path: `${BASE}/unassigned`,
    summary: 'Nicht zugeordnete Aufnahmen je Nacht und Rig („Zu tun“ auf der Startseite)',
    tags: ['sessions'],
    responses: {
      200: { description: 'Nicht zugeordnet', ...json(NightSessionUnassigned) },
      ...denied,
    },
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
  sessionUnassignedRoute,
  sessionDetailRoute,
  sessionCorrectionRoute,
  captureRejectRoute,
  reportResendRoute,
] as const;

export function webSessionRoutes(services: () => Promise<ApiServices>) {
  const app = new OpenAPIHono<ApiEnv>();

  app.openapi(listSessionsRoute, async (c) => {
    const svc = await services();
    const q = c.req.valid('query');
    const repos = svc.repositories(requireTenant(c).tenant);
    const page = await repos.sessionReview().page({
      rigId: q.rigId,
      from: q.from,
      to: q.to,
      limit: q.limit,
      cursor: q.cursor,
    });
    // Sessionqualität je Session (AP-77) wie im Detail: Bezug je Projekt und Filter, Grenzwerte des Rigs.
    const [rows, rigs] = await Promise.all([
      repos.imageQuality().sessionGradeRows(page.items.map((x) => x.id)),
      repos.equipment().rigs(),
    ]);
    const refs = refsByProject(
      await repos.imageQuality().gradeBasis([...new Set(rows.map((r) => r.projectId))]),
    );
    const quality = sessionQualityByList(
      rows,
      refs,
      (rigId) => rigs.find((r) => r.id === rigId)?.imageQuality ?? IMAGE_QUALITY_DEFAULTS,
    );
    c.header('cache-control', 'no-store');
    return c.json(
      { ...page, items: page.items.map((x) => ({ ...x, quality: quality.get(x.id) ?? null })) },
      200,
    );
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

  // Vor `/{id}` registriert.
  app.openapi(sessionUnassignedRoute, async (c) => {
    const svc = await services();
    const result = await svc.repositories(requireTenant(c).tenant).sessionReview().unassigned();
    c.header('cache-control', 'no-store');
    return c.json(result, 200);
  });

  app.openapi(sessionDetailRoute, async (c) => {
    const svc = await services();
    const { auth, tenant } = requireTenant(c);
    const repos = svc.repositories(tenant);
    const detail = await repos
      .sessionReview()
      .detail(c.req.valid('param').id, NIGHT_SESSION_CAPTURE_LIMIT);
    // Gleichzeitig (Performance 10.10.2026): Einstellungen, Rig mit Optik, Bezugswerte der letzten 30 Nächte und die
    // Bewertungsbasis je Projekt hängen nur am Detail, nicht aneinander.
    const eq = repos.equipment();
    const projectIds = [
      ...new Set(detail.captures.flatMap((x) => (x.projectId ? [x.projectId] : []))),
    ];
    // Bedingungen (AP-77): Powerbox und Wettergerät über die Laufzeit der Session – Rohwerte, älter als deren Aufbewahrung
    // die Stundenwerte –, dazu der Wetter-Schnappschuss zum Sessionbeginn.
    const rigId = detail.session.rigId;
    const from = new Date(detail.session.startedAt);
    const to = detail.session.endedAt ? new Date(detail.session.endedAt) : svc.now();
    const telemetry = repos.telemetry();
    const samples = async (source: 'power_box' | 'weather') => {
      const raw = await telemetry.raw(rigId, source, from, to);
      if (raw.length > 0) return raw;
      // Stundenwerte beginnen zur vollen Stunde: die angebrochene erste Stunde gehört dazu.
      const hours = await telemetry.hourly(
        rigId,
        source,
        new Date(Math.floor(from.getTime() / 3_600_000) * 3_600_000),
        to,
      );
      return hours.map((h) => ({ metrics: h.stats }));
    };
    const [tenantSettings, rigOptics, qualityRefs, basis, powerBox, weather, snapshot] =
      await Promise.all([
        repos.tenant().settings(),
        eq.rig(detail.session.rigId).then(async (rig) => ({
          rig,
          optics: rig
            ? await Promise.all([eq.telescope(rig.telescopeId), eq.camera(rig.cameraId)])
            : ([undefined, undefined] as const),
        })),
        repos.imageQuality().refs(detail.session.rigId, detail.session.night),
        repos.imageQuality().gradeBasis(projectIds),
        samples('power_box'),
        samples('weather'),
        repos.sessionReview().forecastSnapshot(detail.session.id),
      ]);
    // Je Zeile, ob der Aufrufer korrigieren darf – dieselbe Prüfung wie bei Korrektur und Verwerfen unten.
    const { userCorrections } = tenantSettings.settings;
    const rows = detail.rows.map((r) => ({
      ...r,
      canCorrect: can(auth, 'session.correct', {
        tenantId: tenant.tenantId,
        ...(r.projectCreatedBy ? { createdBy: r.projectCreatedBy } : {}),
        settings: { userCorrections },
      }),
    }));
    // Bildqualität (AP-72): Pixelmaßstab des Rigs und Bezugswerte der letzten 30 Nächte.
    const { rig } = rigOptics;
    const [telescope, camera] = rigOptics.optics;
    // Bildbewertung (AP-72b): je gespeichertem, zugeordnetem Light mit dem Bezug seines Projekts und den Grenzwerten des Rigs.
    const settings = rig?.imageQuality ?? IMAGE_QUALITY_DEFAULTS;
    const refs = refsByProject(basis);
    const captures = detail.captures.map((x) => {
      if (
        x.frameType !== 'light' ||
        x.result !== 'saved' ||
        !x.projectId ||
        x.assignment !== 'assigned'
      )
        return x;
      const input = {
        hfr: x.hfr,
        stars: x.stars,
        rmsArcsec: x.quality?.rmsArcsec ?? null,
        cloudCoverPct: x.quality?.cloudCoverPct ?? null,
      };
      const flags = gradeFlags(
        input,
        refs.get(x.projectId)?.get(x.filterShortName) ?? null,
        settings,
      );
      return {
        ...x,
        flags,
        grade: imageGrade(input, flags, { rejected: x.rejected, kept: x.kept ?? false }),
      };
    });
    // Sessionqualität (AP-77): Anteile je Zeile und Summe der Session aus den bewerteten Lights.
    const lines = lineQualities(captures, refs, settings);
    const quality = {
      scaleArcsecPx:
        telescope && camera ? imageScale({ ...telescope, ...camera }).scaleArcsecPx : null,
      refs: qualityRefs,
      lines,
      session: sessionQuality(lines),
    };
    const forecast = parseSnapshot(snapshot);
    const conditions = nightConditions({ captures, powerBox, weather, forecast });
    c.header('cache-control', 'no-store');
    return c.json({ ...detail, captures, rows, quality, conditions }, 200);
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
