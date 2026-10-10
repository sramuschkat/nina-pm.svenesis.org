/**
 * Klarnacht-Statistik im Web (AP-30; FA-AUS-16/17; S-64). Das Sitzungsprotokoll (`/sessions/{id}/log`) entfällt seit
 * AP-77 – die Nacht zeigt ihre Bedingungen automatisch (Detail `conditions`).
 * - `GET /web/v1/sites/{id}/clear-nights` (`session.read`): Klarnacht-Statistik je Monat, Nächte,
 *   Treffsicherheit der Vorhersage.
 * „bewölkt erfassen“ (`PUT`/`DELETE …/clear-nights/{night}`) entfällt seit AP-77: Nächte ohne Session stuft die Messung
 * des Wettergeräts bzw. die Vorhersage ein.
 */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import { moonAt, nightBounds } from '@nina-pm/engine';
import {
  ClearNightQuery,
  ClearNightView,
  IMAGE_QUALITY_DEFAULTS,
  ProblemError,
  Uuid,
} from '@nina-pm/shared';
import type { ApiEnv } from '../lib/env';
import { imagesClarityByNight } from '../sessions/images-clarity';
import { buildNightTable, noonNightKey, timeZoneTransitions } from '../lib/night-table';
import { deviceMeasures, nightMeasures } from '../sessions/night-measures';
import { refsByProject } from '../sessions/project-images';
import { clearNightView, nightKeys } from '../sessions/log';
import { defineRoute, problemContent } from './define';
import type { ApiServices } from './services';
import { requireTenant } from './tenant';

const json = <S extends z.ZodType>(schema: S) => ({
  content: { 'application/json': { schema } },
});
const denied = {
  401: problemContent('Nicht angemeldet'),
  403: problemContent('Keine Berechtigung'),
};
/** Längster Zeitraum der Klarnacht-Statistik: gut zwei Jahre. */
const MAX_RANGE_DAYS = 800;

export const clearNightsRoute = defineRoute(
  { action: 'session.read', requirements: ['FA-AUS-16', 'FA-AUS-17', 'S-64'] },
  {
    method: 'get',
    path: '/api/web/v1/sites/{id}/clear-nights',
    summary: 'Klarnacht-Statistik je Standort: Monate, Nächte, Treffsicherheit der Vorhersage',
    tags: ['sessions'],
    request: { params: z.object({ id: Uuid }), query: ClearNightQuery },
    responses: {
      200: { description: 'Statistik', ...json(ClearNightView) },
      ...denied,
      404: problemContent('resource.not_found'),
      422: problemContent('validation.failed'),
    },
  },
);

export const SESSION_LOG_ROUTES = [clearNightsRoute] as const;

export function webSessionLogRoutes(services: () => Promise<ApiServices>) {
  const app = new OpenAPIHono<ApiEnv>();

  app.openapi(clearNightsRoute, async (c) => {
    const svc = await services();
    const repo = svc.repositories(requireTenant(c).tenant).sessionLog();
    const { from, to } = c.req.valid('query');
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    if (!(days >= 0) || days > MAX_RANGE_DAYS) throw new ProblemError('validation.failed');
    const siteId = c.req.valid('param').id;
    const repos = svc.repositories(requireTenant(c).tenant);
    const eq = repos.equipment();
    // Gleichzeitig (Performance 10.10.2026): Standort, Nächte und – für „Klar laut Bildern“ (AP-72) und die Qualität je
    // Nacht (AP-77) – die Lights aller Rigs des Standorts im Zeitraum, dazu das Wettergerät. Ein fremder bzw. unbekannter
    // Standort scheitert an `repo.site` (404).
    const siteRigs = eq.rigs().then((rigs) => rigs.filter((r) => r.siteId === siteId));
    const rigIds = siteRigs.then((rigs) => rigs.map((r) => r.id));
    const fromMs = Date.parse(`${from}T00:00:00Z`) - 86_400_000;
    const toMs = Date.parse(`${to}T00:00:00Z`) + 2 * 86_400_000;
    const [site, geo, data, nightLights, gradeRows, rigs, weather] = await Promise.all([
      repo.site(siteId),
      eq.site(siteId),
      repo.clearNightData(siteId, from, to),
      rigIds.then((ids) => repos.imageQuality().nightLights(ids, from, to)),
      rigIds.then((ids) => repos.imageQuality().nightGradeRows(ids, from, to)),
      siteRigs,
      rigIds.then((ids) =>
        Promise.all(
          ids.map((id) => repos.telemetry().raw(id, 'weather', new Date(fromMs), new Date(toMs))),
        ),
      ),
    ]);
    const imagesClarity = imagesClarityByNight(nightLights);
    // Qualität je Nacht: Bezug je Projekt und Filter wie in der Bildbewertung, Grenzwerte des jeweiligen Rigs.
    const refs = refsByProject(
      await repos.imageQuality().gradeBasis([...new Set(gradeRows.map((r) => r.projectId))]),
    );
    const settingsOf = new Map(rigs.map((r) => [r.id, r.imageQuality] as const));
    const measured = nightMeasures(
      gradeRows,
      refs,
      (rigId) => settingsOf.get(rigId) ?? IMAGE_QUALITY_DEFAULTS,
    );
    const currentNight = noonNightKey(site.timeZone, svc.now().getTime());
    const keys = nightKeys(from, to).filter((n) => n < currentNight);
    // Wettergerät über die astronomische Dunkelheit – nur für Nächte ohne Bewölkung aus den Lights (meist ohne Session).
    const samples = weather.flat().map((r) => ({ atUtc: r.atUtc, metrics: r.metrics }));
    const windows = new Map<string, { fromMs: number; toMs: number }>();
    if (geo && samples.length > 0)
      for (const night of keys) {
        if (measured.get(night)?.cloudPct != null) continue;
        const row = buildNightTable(geo, night, 1, { twilight: true }).nights[0];
        const dusk = row?.twilight?.astronomical.duskUtc;
        const dawn = row?.twilight?.astronomical.dawnUtc;
        if (dusk && dawn) windows.set(night, { fromMs: Date.parse(dusk), toMs: Date.parse(dawn) });
      }
    const device = deviceMeasures(samples, windows);
    // Mond um Mitternacht (Mitte Mittag–Mittag) für Nächte ohne Schnappschuss.
    const moon = new Map<string, number>();
    if (geo) {
      const transitions = timeZoneTransitions(geo.timeZone, fromMs, toMs);
      for (const night of keys) {
        const b = nightBounds(night, transitions);
        const t = (b.noonStartUtc + b.noonEndUtc) / 2;
        moon.set(
          night,
          Math.round(moonAt(t, { latDeg: geo.latitudeDeg, lonDeg: geo.longitudeDeg }).illumPct),
        );
      }
    }
    c.header('cache-control', 'no-store');
    return c.json(
      clearNightView({
        site,
        from,
        to,
        ...data,
        currentNight,
        imagesClarity,
        measured,
        device,
        moon,
      }),
      200,
    );
  });

  return app;
}
