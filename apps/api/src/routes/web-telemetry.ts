/**
 * Rig-Telemetrie im Web (AP-67, FA-RIG-17, S-43): `GET /web/v1/rigs/{id}/telemetry?from=&to=` (`session.read`).
 * Bis `TELEMETRY_RAW_RANGE_DAYS` und innerhalb der Aufbewahrung der Rohwerte: Rohwerte (über
 * `TELEMETRY_MAX_POINTS` Punkte in Minutenfenster verdichtet). Sonst Stundenwerte, dazu die noch nicht verdichteten
 * jüngsten Stunden aus den Rohwerten; über `TELEMETRY_MAX_POINTS` Stunden in Mehrstundenfenster verdichtet.
 */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import {
  nina,
  ProblemError,
  TELEMETRY_MAX_POINTS,
  TELEMETRY_MAX_RANGE_DAYS,
  TELEMETRY_RAW_RANGE_DAYS,
  TELEMETRY_RAW_RETENTION_DAYS,
  telemetrySources,
  TelemetryQuery,
  TelemetryView,
  Uuid,
} from '@nina-pm/shared';
import { hourStats, type RigTelemetryRepository } from '@nina-pm/db';
import type { ApiEnv } from '../lib/env';
import { bucket, rawPoint, seriesOf, stepFor, type StatPoint } from '../telemetry/view';
import { defineRoute, problemContent } from './define';
import type { ApiServices } from './services';
import { requireTenant } from './tenant';

const json = <S extends z.ZodType>(schema: S) => ({
  content: { 'application/json': { schema } },
});

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export const telemetryRoute = defineRoute(
  { action: 'session.read', requirements: ['FA-RIG-17', 'S-43'] },
  {
    method: 'get',
    path: '/api/web/v1/rigs/{id}/telemetry',
    summary: 'Rig-Telemetrie: Zeitreihen je Quelle (Mini-PC, Powerbox) für einen Zeitraum',
    tags: ['nina'],
    request: { params: z.object({ id: Uuid }), query: TelemetryQuery },
    responses: {
      200: { description: 'Zeitreihen', ...json(TelemetryView) },
      401: problemContent('Nicht angemeldet'),
      403: problemContent('Keine Berechtigung'),
      404: problemContent('resource.not_found'),
      422: problemContent('validation.failed'),
    },
  },
);

export const TELEMETRY_ROUTES = [telemetryRoute] as const;

/** Zeitreihe einer Quelle aus Roh- bzw. Stundenwerten (s. o.). */
async function sourceSeries(
  repo: RigTelemetryRepository,
  rigId: string,
  source: nina.TelemetrySource,
  from: Date,
  to: Date,
  now: Date,
) {
  const rangeMs = to.getTime() - from.getTime();
  const rawSince = now.getTime() - TELEMETRY_RAW_RETENTION_DAYS * DAY_MS;
  const latest = await repo.latest(rigId, source);
  if (rangeMs <= TELEMETRY_RAW_RANGE_DAYS * DAY_MS && from.getTime() >= rawSince) {
    const points = (await repo.raw(rigId, source, from, to)).map((r) =>
      rawPoint(r.atUtc, r.metrics),
    );
    if (points.length <= TELEMETRY_MAX_POINTS) return seriesOf(source, 'raw', 0, points, latest);
    const step = stepFor(rangeMs, MINUTE_MS);
    return seriesOf(source, 'raw', step / 1000, bucket(points, step), latest);
  }
  const hours: StatPoint[] = (await repo.hourly(rigId, source, from, to)).map((h) => ({
    t: h.hourUtc.getTime(),
    stats: h.stats,
  }));
  // Noch nicht verdichtete jüngste Stunden aus den Rohwerten (der worker verdichtet stündlich).
  const tailFrom = Math.max(
    from.getTime(),
    hours.length > 0 ? (hours.at(-1)?.t ?? 0) + HOUR_MS : from.getTime(),
    rawSince,
  );
  if (tailFrom < to.getTime()) {
    const raw = await repo.raw(rigId, source, new Date(tailFrom), to);
    const byHour = new Map<number, { metrics: Record<string, number> }[]>();
    for (const r of raw) {
      const h = Math.floor(r.atUtc.getTime() / HOUR_MS) * HOUR_MS;
      byHour.set(h, [...(byHour.get(h) ?? []), { metrics: r.metrics }]);
    }
    for (const [t, rows] of [...byHour.entries()].sort((a, b) => a[0] - b[0]))
      hours.push({ t, stats: hourStats(rows) });
  }
  if (hours.length <= TELEMETRY_MAX_POINTS) return seriesOf(source, 'hourly', 3600, hours, latest);
  const step = stepFor(rangeMs, HOUR_MS);
  return seriesOf(source, 'hourly', step / 1000, bucket(hours, step), latest);
}

export function webTelemetryRoutes(services: () => Promise<ApiServices>) {
  const app = new OpenAPIHono<ApiEnv>();
  app.openapi(telemetryRoute, async (c) => {
    const svc = await services();
    const repos = svc.repositories(requireTenant(c).tenant);
    const { id } = c.req.valid('param');
    const q = c.req.valid('query');
    const from = new Date(q.from);
    const to = new Date(q.to);
    const days = (to.getTime() - from.getTime()) / DAY_MS;
    if (!(days > 0) || days > TELEMETRY_MAX_RANGE_DAYS) throw new ProblemError('validation.failed');
    if (!(await repos.equipment().rig(id))) throw new ProblemError('resource.not_found');
    const repo = repos.telemetry();
    const now = svc.now();
    const sources = await Promise.all(
      telemetrySources.map((s) => sourceSeries(repo, id, s, from, to, now)),
    );
    c.header('cache-control', 'no-store');
    return c.json({ rigId: id, from: q.from, to: q.to, sources }, 200);
  });
  return app;
}
