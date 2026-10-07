/**
 * „Heute Nacht“ S-02 (AP-35; FA-FOL-06, FA-FOL-05; TK 7.2 „Auswertung“):
 * - `GET /web/v1/tonight?rigId=&night=` (`project.read`): je Rig die **aktuelle Nacht** des Standorts
 *   (`currentNight`, NT-01 – nach Ende des Nachtfensters schon die folgende) bzw. eine gewählte der folgenden sechs
 *   Nächte (Wunsch Sven 30.09.2026, so weit reicht das Astro-Wetter) mit Nachtfenster, Dunkelheit, Mond, Wetter der
 *   Nacht (Farbband), geplanten Projekten mit erwarteten Frames aus der gespeicherten Prognose (AP-33), den
 *   NINA-Instanzen und dem Mondkalender der sieben Nächte. Die Nacht rechnet der Server, nie der Browser. Läuft die
 *   Session der Nacht nach Ende ihres Nachtfensters noch (Flats, Transit), bleibt sie bis Mittag die laufende Nacht.
 * - `PUT /web/v1/projects/{id}/lines/{lineId}/tonight {disabled}` (`project.status`, Admin): Zeile **nur für die
 *   kommende Nacht** ab- bzw. wieder einschalten (FA-FOL-05). Die Nacht ist die aktuelle Nacht des Rig-Standorts
 *   des Projekts; ab dem nächsten lokalen Mittag plant die Zeile von selbst wieder mit.
 */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import { forecastNights, latestWeather } from '@nina-pm/db';
import { moonAt, moonEvents, q as quantize } from '@nina-pm/engine';
import {
  can,
  currentNightRow,
  LineTonightInput,
  nightOfEndedWindow,
  ProblemError,
  ProjectView,
  TONIGHT_NIGHTS,
  TonightQuery,
  TonightView,
  tonightProjects,
  Uuid,
} from '@nina-pm/shared';
import type { ApiEnv } from '../lib/env';
import { isoUtc, isoUtcOrNull } from '../lib/format';
import { buildNightTable, siteNights } from '../lib/night-table';
import { weatherNightTable } from '../weather/nights';
import { weatherView } from '../weather/view';
import { defineRoute, problemContent } from './define';
import type { ApiServices } from './services';
import { requireTenant } from './tenant';
import { ninaInstanceView } from './web-nina-instances';
import { projectView } from './web-projects';

type View = z.output<typeof TonightView>;

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });
const errors = {
  401: problemContent('Nicht angemeldet'),
  403: problemContent('Keine Berechtigung'),
  404: problemContent('resource.not_found'),
  422: problemContent('validation.failed'),
};
const iso = (unix: number) => isoUtc(new Date(unix * 1000));

/** Astronomisch dunkle Stunden mit Mond unter −0,833° (10-min-Raster, Konvention der Wetter-Nächte). */
function moonlessHours(fromUtc: number, toUtc: number, geo: { latDeg: number; lonDeg: number }) {
  const step = 600;
  let free = 0;
  for (let t = fromUtc; t < toUtc; t += step)
    if (moonAt(Math.min(t + step / 2, toUtc), geo).altDeg < -0.833)
      free += Math.min(step, toUtc - t);
  return Math.round((free / 3600) * 10) / 10;
}

export const tonightRoute = defineRoute(
  { action: 'project.read', requirements: ['FA-FOL-06', 'S-02', 'NT-01'] },
  {
    method: 'get',
    path: '/api/web/v1/tonight',
    summary: 'Heute Nacht: aktuelle Nacht je Rig mit Wetter, Plan und NINA',
    tags: ['reports'],
    request: { query: TonightQuery },
    responses: { 200: { description: 'Heute Nacht', ...json(TonightView) }, ...errors },
  },
);

export const lineTonightRoute = defineRoute(
  { action: 'project.status', requirements: ['FA-FOL-05'] },
  {
    method: 'put',
    path: '/api/web/v1/projects/{id}/lines/{lineId}/tonight',
    summary: 'Zeile nur für die kommende Nacht ab- bzw. wieder einschalten',
    tags: ['projects'],
    request: {
      params: z.object({ id: Uuid, lineId: Uuid }),
      body: { ...json(LineTonightInput), required: true },
    },
    responses: { 200: { description: 'Geändert', ...json(ProjectView) }, ...errors },
  },
);

export const TONIGHT_ROUTES = [tonightRoute, lineTonightRoute] as const;

export function webTonightRoutes(services: () => Promise<ApiServices>) {
  const app = new OpenAPIHono<ApiEnv>();

  app.openapi(tonightRoute, async (c) => {
    const svc = await services();
    const { auth, tenant } = requireTenant(c);
    const { rigId, night: wantedNight } = c.req.valid('query');
    const repos = svc.repositories(tenant);
    const eq = repos.equipment();
    const [rigs, sites, instances, list] = await Promise.all([
      eq.rigs(),
      eq.sites(),
      repos.ninaInstances().list(),
      repos.projects().list({
        admin: can(auth, 'project.status'),
        deleted: false,
        approvalStatus: 'approved',
        status: 'active',
        mine: false,
        favorites: false,
        ...(rigId ? { rigId } : {}),
      }),
    ]);
    const projects = list.map((d) => projectView(d));
    const now = svc.now();
    const siteOf = new Map(sites.map((s) => [s.id, s]));
    const out: View['rigs'] = [];
    for (const rig of rigs) {
      if (rigId && rig.id !== rigId) continue;
      const site = siteOf.get(rig.siteId);
      if (!site) continue;
      const around = siteNights(site, now, undefined, 2);
      let current = currentNightRow(around, isoUtc(now)).night;
      // Morgen nach dem Fensterende: läuft die Session der alten Nacht noch (Flats, Rest eines Transits), bleibt sie die
      // laufende Nacht – sonst sprang die Seite zur nächsten und verbarg das Laufende (Analyse 07.10.2026).
      const ended = nightOfEndedWindow(around, isoUtc(now));
      if (
        ended &&
        (
          await repos.sessionReview().list({ rigId: rig.id, from: ended, to: ended, limit: 10 })
        ).some((x) => x.status === 'running')
      )
        current = ended;
      const table = buildNightTable(site, current, TONIGHT_NIGHTS);
      const row = wantedNight
        ? table.nights.find((n) => n.night === wantedNight)
        : table.nights.find((n) => n.night === current);
      if (!row)
        throw new ProblemError('validation.failed', [
          { path: 'night', message: `Nacht ${current} bis +${String(TONIGHT_NIGHTS - 1)}` },
        ]);
      const night = row.night;
      const lastNight = table.nights[table.nights.length - 1];
      const frames = weatherNightTable(
        site,
        now,
        Math.floor(Date.parse(lastNight?.noonEndUtc ?? row.noonEndUtc) / 1000),
      ).nights;
      const frame = frames.find((n) => n.night === night) ?? null;
      const geo = { latDeg: site.latitudeDeg, lonDeg: site.longitudeDeg };
      const dark = frame?.dark ?? null;
      const noonStart = Date.parse(row.noonStartUtc) / 1000;
      const noonEnd = Date.parse(row.noonEndUtc) / 1000;
      const mid = dark ? (dark.fromUtc + dark.toUtc) / 2 : (noonStart + noonEnd) / 2;
      const [entry, stored] = await Promise.all([
        latestWeather(svc.db, site.latitudeDeg, site.longitudeDeg),
        forecastNights(svc.db, tenant.tenantId, rig.id),
      ]);
      const wv = entry ? weatherView(site, entry, now) : null;
      let weather: View['rigs'][number]['weather'] = null;
      if (wv && frame) {
        const n = wv.nights.find((x) => x.night === night);
        if (n) {
          const from = frame.nightWindow.startUtc * 1000;
          const to = frame.nightWindow.endUtc * 1000;
          weather = {
            nightMean: n.nightMean,
            ratingIndex: n.ratingIndex,
            coverage: n.coverage,
            bestWindow: n.bestWindow,
            aerosolMissing: n.aerosolMissing,
            hours: wv.hours
              .filter((h) => {
                const t = Date.parse(h.tUtc);
                return t >= from && t < to;
              })
              .map((h) => ({
                tUtc: h.tUtc,
                overallScore: h.overallScore,
                ratingIndex: h.ratingIndex,
                sunAltDeg: h.sunAltDeg,
              })),
          };
        }
      }
      const storedNight = stored.nights.find((n) => n.night === night);
      const planned = tonightProjects(projects, rig.id, night, storedNight);
      out.push({
        rigId: rig.id,
        rigName: rig.name,
        siteId: site.id,
        siteName: site.name,
        siteTimeZone: site.timeZone,
        weatherSafetyUrl: site.weatherSafetyUrl,
        night,
        currentNight: current,
        calendar: table.nights.map((n) => {
          const f = frames.find((x) => x.night === n.night);
          const w = wv?.nights.find((x) => x.night === n.night);
          const d = f?.dark ?? null;
          const m = d ? (d.fromUtc + d.toUtc) / 2 : Date.parse(n.noonStartUtc) / 1000 + 43200;
          const illum = moonAt(m, geo).illumPct;
          return {
            night: n.night,
            darkHours: d ? Math.round(((d.toUtc - d.fromUtc) / 3600) * 10) / 10 : 0,
            moonlessDarkHours: d ? moonlessHours(d.fromUtc, d.toUtc, geo) : 0,
            moonIllumPct: quantize(illum, 10),
            waxing: moonAt(m + 21600, geo).illumPct > illum,
            ratingIndex: w?.ratingIndex ?? null,
            nightMean: w?.nightMean ?? null,
          };
        }),
        nightWindow: frame
          ? { startUtc: iso(frame.nightWindow.startUtc), endUtc: iso(frame.nightWindow.endUtc) }
          : null,
        dark: dark ? { fromUtc: iso(dark.fromUtc), toUtc: iso(dark.toUtc) } : null,
        darkHours: dark ? Math.round(((dark.toUtc - dark.fromUtc) / 3600) * 10) / 10 : 0,
        moon: {
          illumPct: quantize(moonAt(mid, geo).illumPct, 10),
          events: moonEvents(geo, noonStart, noonEnd).map((e) => ({
            type: e.type,
            atUtc: iso(e.atUtc),
          })),
        },
        weather,
        forecast: {
          computedAt: isoUtcOrNull(stored.computedAt),
          covered: storedNight !== undefined,
        },
        projects: planned.projects,
        idleProjects: planned.idle,
        instances: instances
          .filter((i) => i.rigId === rig.id && i.status === 'active')
          .map((i) => {
            const v = ninaInstanceView(i);
            return {
              id: v.id,
              name: v.name,
              lastSeenAt: v.lastSeenAt,
              state: v.lastState?.state ?? null,
            };
          }),
      });
    }
    c.header('cache-control', 'no-store');
    return c.json({ generatedAt: isoUtc(now), rigs: out } satisfies View, 200);
  });

  app.openapi(lineTonightRoute, async (c) => {
    const svc = await services();
    const { tenant } = requireTenant(c);
    const { id, lineId } = c.req.valid('param');
    const { disabled } = c.req.valid('json');
    const repos = svc.repositories(tenant);
    const repo = repos.projects();
    const detail = await repo.detail(id);
    if (!detail || detail.project.deletedAt !== null) throw new ProblemError('resource.not_found');
    const rigOfProject = detail.project.rigId;
    if (detail.project.approvalStatus !== 'approved' || rigOfProject === null)
      throw new ProblemError('validation.failed', [
        { path: 'id', message: 'nur freigegebene Projekte mit Rig' },
      ]);
    const rig = await repos.equipment().rig(rigOfProject);
    const site = rig ? await repos.equipment().site(rig.siteId) : undefined;
    if (!site) throw new ProblemError('resource.not_found');
    const now = svc.now();
    const night = currentNightRow(siteNights(site, now, undefined, 2), isoUtc(now)).night;
    const result = await repo.setLineDisabledForNight(id, lineId, disabled ? night : null, now);
    return c.json(projectView(result), 200);
  });

  return app;
}
