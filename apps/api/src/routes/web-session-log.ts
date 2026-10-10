/**
 * Sitzungsprotokoll und Klarnacht-Statistik im Web (AP-30; FA-AUS-14…17; S-61 *Protokoll*, S-64):
 * - `GET /web/v1/sessions/{id}/log` (`session.read`): Protokoll bzw. Vorbelegung mit Quellen, `ETag`.
 * - `PUT /web/v1/sessions/{id}/log` (`sessionlog.write`, Admin): speichern mit `If-Match`; Quelle je Feld
 *   bleibt die des Vorschlags, wenn der Wert ihm entspricht, sonst *manuell*.
 * - `GET /web/v1/sites/{id}/clear-nights` (`session.read`): Klarnacht-Statistik je Monat, Nächte,
 *   Treffsicherheit der Vorhersage.
 * - `PUT`/`DELETE /web/v1/sites/{id}/clear-nights/{night}` (`sessionlog.write`): Nacht ohne Session als
 *   „bewölkt/nicht genutzt“ erfassen bzw. zurücknehmen.
 */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import {
  ClearNightMark,
  ClearNightQuery,
  ClearNightView,
  logSuggestions,
  NightKey,
  ProblemError,
  SessionLogValues,
  SessionLogView,
  sourcesOnSave,
  Uuid,
} from '@nina-pm/shared';
import type { ApiEnv } from '../lib/env';
import { imagesClarityByNight } from '../sessions/images-clarity';
import { noonNightKey } from '../lib/night-table';
import { clearNightView, sessionLogView } from '../sessions/log';
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
const ifMatch = z.object({
  'if-match': z
    .string()
    .optional()
    .meta({ description: '`ETag` des Protokolls (`"0"` = noch keins); abweichend → 412' }),
});
/** Längster Zeitraum der Klarnacht-Statistik: gut zwei Jahre. */
const MAX_RANGE_DAYS = 800;

export const sessionLogRoute = defineRoute(
  { action: 'session.read', requirements: ['FA-AUS-14', 'FA-AUS-15', 'S-61'] },
  {
    method: 'get',
    path: '/api/web/v1/sessions/{id}/log',
    summary: 'Sitzungsprotokoll bzw. Vorbelegung (Vorhersage, NINA) mit Quelle je Feld',
    tags: ['sessions'],
    request: { params: z.object({ id: Uuid }) },
    responses: {
      200: { description: 'Protokoll', ...json(SessionLogView) },
      ...denied,
      404: problemContent('resource.not_found'),
    },
  },
);

export const sessionLogPutRoute = defineRoute(
  { action: 'sessionlog.write', requirements: ['FA-AUS-14', 'FA-AUS-15', 'S-61'] },
  {
    method: 'put',
    path: '/api/web/v1/sessions/{id}/log',
    summary: 'Sitzungsprotokoll speichern',
    tags: ['sessions'],
    request: {
      params: z.object({ id: Uuid }),
      headers: ifMatch,
      body: { ...json(SessionLogValues), required: true },
    },
    responses: {
      200: { description: 'Gespeichert', ...json(SessionLogView) },
      ...denied,
      404: problemContent('resource.not_found'),
      412: problemContent('resource.version_conflict'),
      422: problemContent('validation.failed'),
    },
  },
);

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

const nightParams = z.object({ id: Uuid, night: NightKey });

export const clearNightMarkRoute = defineRoute(
  { action: 'sessionlog.write', requirements: ['FA-AUS-17', 'S-64'] },
  {
    method: 'put',
    path: '/api/web/v1/sites/{id}/clear-nights/{night}',
    summary: 'Nacht ohne Session als „bewölkt/nicht genutzt“ erfassen',
    tags: ['sessions'],
    request: { params: nightParams, body: { ...json(ClearNightMark), required: true } },
    responses: {
      204: { description: 'Erfasst' },
      ...denied,
      404: problemContent('resource.not_found'),
      409: problemContent('site_night.has_session'),
      422: problemContent('validation.failed'),
    },
  },
);

export const clearNightUnmarkRoute = defineRoute(
  { action: 'sessionlog.write', requirements: ['FA-AUS-17', 'S-64'] },
  {
    method: 'delete',
    path: '/api/web/v1/sites/{id}/clear-nights/{night}',
    summary: 'Manuelle Erfassung einer Nacht zurücknehmen',
    tags: ['sessions'],
    request: { params: nightParams },
    responses: {
      204: { description: 'Zurückgenommen' },
      ...denied,
      404: problemContent('resource.not_found'),
    },
  },
);

export const SESSION_LOG_ROUTES = [
  sessionLogRoute,
  sessionLogPutRoute,
  clearNightsRoute,
  clearNightMarkRoute,
  clearNightUnmarkRoute,
] as const;

const etag = (version: string) => `"${version}"`;
const unquote = (h: string | undefined) =>
  h === undefined ? undefined : h.replace(/^W\//, '').replace(/"/g, '').trim();

export function webSessionLogRoutes(services: () => Promise<ApiServices>) {
  const app = new OpenAPIHono<ApiEnv>();

  app.openapi(sessionLogRoute, async (c) => {
    const svc = await services();
    const repo = svc.repositories(requireTenant(c).tenant).sessionLog();
    const ctx = await repo.context(c.req.valid('param').id);
    c.header('cache-control', 'no-store');
    c.header('etag', etag(ctx.version));
    return c.json(sessionLogView(ctx), 200);
  });

  app.openapi(sessionLogPutRoute, async (c) => {
    const svc = await services();
    const { tenant } = requireTenant(c);
    const repo = svc.repositories(tenant).sessionLog();
    const id = c.req.valid('param').id;
    const values = c.req.valid('json');
    const before = sessionLogView(await repo.context(id));
    const sources = sourcesOnSave(values, before, logSuggestions(before.forecast, before.nina));
    const version = await repo.save(
      id,
      values,
      sources,
      unquote(c.req.valid('header')['if-match']),
      tenant.memberId,
      svc.now(),
    );
    const after = await repo.context(id);
    c.header('etag', etag(version));
    return c.json(sessionLogView(after), 200);
  });

  app.openapi(clearNightsRoute, async (c) => {
    const svc = await services();
    const repo = svc.repositories(requireTenant(c).tenant).sessionLog();
    const { from, to } = c.req.valid('query');
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    if (!(days >= 0) || days > MAX_RANGE_DAYS) throw new ProblemError('validation.failed');
    const siteId = c.req.valid('param').id;
    const repos = svc.repositories(requireTenant(c).tenant);
    // Gleichzeitig (Performance 10.10.2026): Standort, Nächte und – für „Klar laut Bildern“ (AP-72) – die Lights aller
    // Rigs des Standorts im Zeitraum. Ein fremder bzw. unbekannter Standort scheitert an `repo.site` (404).
    const lights = repos
      .equipment()
      .rigs()
      .then((rigs) =>
        repos.imageQuality().nightLights(
          rigs.filter((r) => r.siteId === siteId).map((r) => r.id),
          from,
          to,
        ),
      );
    const [site, data, nightLights] = await Promise.all([
      repo.site(siteId),
      repo.clearNightData(siteId, from, to),
      lights,
    ]);
    const imagesClarity = imagesClarityByNight(nightLights);
    c.header('cache-control', 'no-store');
    const currentNight = noonNightKey(site.timeZone, svc.now().getTime());
    return c.json(clearNightView({ site, from, to, ...data, currentNight, imagesClarity }), 200);
  });

  app.openapi(clearNightMarkRoute, async (c) => {
    const svc = await services();
    const repo = svc.repositories(requireTenant(c).tenant).sessionLog();
    const { id, night } = c.req.valid('param');
    // Nur vergangene Nächte (Nacht-Schlüssel vor dem heutigen UTC-Tag): eine laufende Nacht ist offen.
    if (night >= svc.now().toISOString().slice(0, 10)) throw new ProblemError('validation.failed');
    const site = await repo.site(id);
    await repo.markUnused(site.id, night);
    return c.body(null, 204);
  });

  app.openapi(clearNightUnmarkRoute, async (c) => {
    const svc = await services();
    const repo = svc.repositories(requireTenant(c).tenant).sessionLog();
    const { id, night } = c.req.valid('param');
    const site = await repo.site(id);
    await repo.unmarkUnused(site.id, night);
    return c.body(null, 204);
  });

  return app;
}
