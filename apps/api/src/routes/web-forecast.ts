/**
 * Folgeplanung S-62 (AP-33; FA-FOL-01…05, FA-FOL-07; TK 7.2 „Auswertung“):
 * - `GET /web/v1/forecast?rigId=` (`project.read`): Ansicht aus der gespeicherten Mehrnacht-Prognose des Rigs,
 *   der aktuellen Vorhersage (7 Nächte: `nightMean`, `coverage`, `bestWindow`, Kennzeichen, Regen) und der
 *   Klarnacht-Quote des Standorts (365 Nächte). Die Route rechnet nicht selbst – `forecastView` gewichtet.
 * - `POST /web/v1/forecast/run` (`simulation.run`): Job `forecast` für den Standort des Rigs neu anstoßen
 *   (`202 {jobId}`, dedupliziert je Standort).
 */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import { clearNightCounts, forecastNights, latestWeather } from '@nina-pm/db';
import { overheadPerExposureS, type PlanScheduler } from '@nina-pm/engine';
import {
  buildPlanInput,
  CANDIDATE_NIGHTS,
  dedupeKeys,
  ForecastQuery,
  ForecastView,
  forecastView,
  JobAccepted,
  ProblemError,
  Uuid,
} from '@nina-pm/shared';
import { daysFromKey, keyFromDays } from '@nina-pm/engine';
import { enqueueJob } from '../jobs/enqueue';
import type { ApiEnv } from '../lib/env';
import { isoUtc } from '../lib/format';
import { weatherView } from '../weather/view';
import { multiSimDbDeps } from '../worker/multi-sim-db';
import { defineRoute, problemContent } from './define';
import type { ApiServices } from './services';
import { requireTenant } from './tenant';

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });
const errors = {
  401: problemContent('Nicht angemeldet'),
  403: problemContent('Keine Berechtigung'),
  404: problemContent('resource.not_found'),
  422: problemContent('validation.failed'),
};

export const forecastRoute = defineRoute(
  {
    action: 'project.read',
    requirements: ['FA-FOL-01', 'FA-FOL-02', 'FA-FOL-03', 'FA-FOL-04', 'S-62'],
  },
  {
    method: 'get',
    path: '/api/web/v1/forecast',
    summary: 'Folgeplanung je Rig: Restbedarf, Prognose, Kandidatennächte, Saisonwarnungen',
    tags: ['forecast'],
    request: { query: ForecastQuery },
    responses: { 200: { description: 'Prognose', ...json(ForecastView) }, ...errors },
  },
);

export const forecastRunRoute = defineRoute(
  { action: 'simulation.run', requirements: ['FA-FOL-02', 'FA-FOL-05', 'TK 13'] },
  {
    method: 'post',
    path: '/api/web/v1/forecast/run',
    summary: 'Mehrnacht-Prognose für den Standort des Rigs neu berechnen (Job forecast)',
    tags: ['forecast'],
    request: { body: { ...json(z.object({ rigId: Uuid }).strict()), required: true } },
    responses: {
      202: { description: 'Job angelegt bzw. schon offen', ...json(JobAccepted) },
      ...errors,
    },
  },
);

export const FORECAST_ROUTES = [forecastRoute, forecastRunRoute] as const;

export function webForecastRoutes(services: () => Promise<ApiServices>) {
  const app = new OpenAPIHono<ApiEnv>();

  app.openapi(forecastRoute, async (c) => {
    const svc = await services();
    const { tenant } = requireTenant(c);
    const { rigId } = c.req.valid('query');
    const deps = multiSimDbDeps(
      () => Promise.resolve(svc.db),
      () => Promise.reject(new Error('kein Ergebnis')),
    );
    const ctx = await deps.loadRig(tenant.tenantId, rigId);
    if (!ctx) throw new ProblemError('resource.not_found');
    const now = svc.now();
    const table = deps.nights(ctx.site, now, undefined, 2);
    const [stored, entry, clear] = await Promise.all([
      forecastNights(svc.db, tenant.tenantId, rigId),
      latestWeather(svc.db, ctx.site.latitudeDeg, ctx.site.longitudeDeg),
      clearNightCounts(
        svc.db,
        tenant.tenantId,
        ctx.site.id,
        keyFromDays(daysFromKey(table.currentNight) - 365),
      ),
    ]);
    // Nachtwetter der Vorhersage (7 Nächte), Regen nur als Anzeige über die dunklen Stunden.
    const weather = new Map<
      string,
      z.output<typeof ForecastView>['nights'][number]['weather'] & object
    >();
    if (entry) {
      const wv = weatherView(ctx.site, entry, now);
      for (const n of wv.nights.slice(0, CANDIDATE_NIGHTS + 1)) {
        const from = n.darkFromUtc ? Date.parse(n.darkFromUtc) : null;
        const to = n.darkToUtc ? Date.parse(n.darkToUtc) : null;
        const hours =
          from !== null && to !== null
            ? wv.hours.filter((h) => {
                const t = Date.parse(h.tUtc);
                return t + 3_600_000 > from && t < to;
              })
            : [];
        const probs = hours.map((h) => h.precipProbPct).filter((x): x is number => x !== null);
        const mm = hours.map((h) => h.precipMm).filter((x): x is number => x !== null);
        weather.set(n.night, {
          nightMean: n.nightMean,
          ratingIndex: n.ratingIndex,
          coverage: n.coverage,
          bestWindow: n.bestWindow,
          aerosolMissing: n.aerosolMissing,
          seeingIncomplete: n.seeingIncomplete,
          incomplete: n.coverage !== null && n.coverage < 0.999,
          precipProbPct: probs.length > 0 ? Math.max(...probs) : null,
          precipMm: mm.length > 0 ? Math.round(mm.reduce((s, x) => s + x, 0) * 10) / 10 : null,
        });
      }
    }
    // Overhead je Belichtung aus den Rig-Einstellungen (allocation.md §2).
    const scheduler = buildPlanInput(ctx.rig, [], ctx.moonProfiles, table, {
      night: table.currentNight,
      site: ctx.site,
    }).scheduler as PlanScheduler;
    const view = forecastView({
      rig: { id: ctx.rig.id, name: ctx.rig.name },
      siteTimeZone: ctx.site.timeZone,
      computedAt: stored.computedAt ? isoUtc(stored.computedAt) : null,
      currentNight: table.currentNight,
      projects: ctx.projects.filter((p) => p.rigId === rigId),
      stored: stored.nights.filter((n) => n.night >= table.currentNight),
      weather,
      clearNights: clear,
      overheadS: (exposureS) => overheadPerExposureS(scheduler, exposureS),
    });
    c.header('cache-control', 'no-store');
    return c.json(view, 200);
  });

  app.openapi(forecastRunRoute, async (c) => {
    const svc = await services();
    const { tenant } = requireTenant(c);
    const repos = svc.repositories(tenant);
    const rig = await repos.equipment().rig(c.req.valid('json').rigId);
    if (!rig) throw new ProblemError('resource.not_found');
    const r = await enqueueJob(repos.job, svc.jobInvoker, {
      kind: 'forecast',
      input: { siteId: rig.siteId },
      dedupeKey: dedupeKeys.forecastSiteManual(rig.siteId),
    });
    return c.json({ jobId: r.jobId }, 202);
  });

  return app;
}
