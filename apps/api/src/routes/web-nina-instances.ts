/**
 * NINA-Instanzen im Web (AP-14a; TK 5.6, 7.2; FA-SYN-01, SV-08): auflisten (`nina.instance.read`),
 * anlegen, widerrufen und – nur ohne Sessions und Kommandos – löschen (`nina.instance.manage`). Das
 * Token erscheint nur in der Antwort auf das Anlegen; gespeichert werden SHA-256 und Präfix. Ein
 * Widerruf wirkt ab der nächsten Plugin-Anfrage.
 */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import { parseCallLog, type NinaInstanceOverview } from '@nina-pm/db';
import { nina, ProblemError, Uuid } from '@nina-pm/shared';
import type { ApiEnv } from '../lib/env';
import { isoUtc, isoUtcOrNull } from '../lib/format';
import { newNinaToken } from '../nina/token';
import { defineRoute, problemContent } from './define';
import type { ApiServices } from './services';
import { requireTenant } from './tenant';

const BASE = '/api/web/v1/nina-instances';
const json = <S extends z.ZodType>(schema: S) => ({
  content: { 'application/json': { schema } },
});

type HeartbeatState = z.output<typeof nina.NinaInstanceState>;

/** Kurzform des letzten Heartbeats (S-42 „letzter Zustand“); unbekannte Inhalte → `null`. */
function stateSummary(raw: unknown): HeartbeatState | null {
  const parsed = nina.NinaInstanceState.safeParse(
    raw && typeof raw === 'object'
      ? {
          blockedReason: null,
          sessionId: null,
          receivedAtUtc: null,
          mismatchCodes: [],
          ...Object.fromEntries(
            Object.entries(raw).filter(([k]) =>
              ['state', 'blockedReason', 'sessionId', 'receivedAtUtc', 'mismatchCodes'].includes(k),
            ),
          ),
        }
      : null,
  );
  return parsed.success ? parsed.data : null;
}

export function ninaInstanceView(r: NinaInstanceOverview): z.output<typeof nina.NinaInstanceView> {
  const profile =
    r.profileLat === null || r.profileLon === null
      ? null
      : { latDeg: r.profileLat, lonDeg: r.profileLon };
  const tol = nina.PROFILE_SITE_TOLERANCE_DEG;
  return {
    id: r.id,
    rigId: r.rigId,
    name: r.name,
    tokenPrefix: r.tokenPrefix,
    status: r.status as 'active' | 'revoked',
    pluginVersion: r.pluginVersion,
    engineVersion: r.engineVersion,
    lastSeenAt: isoUtcOrNull(r.lastSeenAt),
    settingsVersionFetched: r.settingsVersionFetched,
    settingsFetchedAt: isoUtcOrNull(r.settingsFetchedAt),
    createdAt: isoUtc(r.createdAt),
    rigName: r.rigName,
    rigSettingsVersion: r.rigSettingsVersion,
    siteTimeZone: r.siteTimeZone,
    profileLocation: profile,
    profileSiteMismatch:
      profile !== null &&
      (Math.abs(profile.latDeg - r.siteLatDeg) > tol ||
        Math.abs(profile.lonDeg - r.siteLonDeg) > tol),
    lastState: stateSummary(r.lastState),
    lease: r.leasePresent
      ? {
          activeSessionId: r.leaseActiveSessionId,
          untilUtc: isoUtcOrNull(r.leaseUntil),
          offlineUntilUtc: isoUtcOrNull(r.leaseOfflineUntil),
        }
      : null,
  };
}

export const listNinaInstancesRoute = defineRoute(
  { action: 'nina.instance.read', requirements: ['FA-SYN-01', 'TK 5.6'] },
  {
    method: 'get',
    path: BASE,
    summary: 'NINA-Instanzen des Mandanten (optional je Rig)',
    tags: ['nina-instances'],
    request: { query: nina.NinaInstanceQuery },
    responses: {
      200: {
        description: 'Instanzen',
        ...json(z.object({ items: z.array(nina.NinaInstanceView) })),
      },
      401: problemContent('Nicht angemeldet'),
      403: problemContent('Keine Berechtigung'),
    },
  },
);

export const createNinaInstanceRoute = defineRoute(
  { action: 'nina.instance.manage', requirements: ['FA-SYN-01', 'TK 5.6', 'SV-08'] },
  {
    method: 'post',
    path: BASE,
    summary: 'NINA-Instanz koppeln: Token einmalig erzeugen',
    tags: ['nina-instances'],
    request: { body: { ...json(nina.NinaInstanceCreate), required: true } },
    responses: {
      201: {
        description: 'Angelegt, Token nur in dieser Antwort',
        ...json(nina.NinaInstanceCreated),
      },
      401: problemContent('Nicht angemeldet'),
      403: problemContent('Keine Berechtigung'),
      404: problemContent('resource.not_found'),
      422: problemContent('validation.failed'),
    },
  },
);

export const revokeNinaInstanceRoute = defineRoute(
  { action: 'nina.instance.manage', requirements: ['FA-SYN-01', 'TK 5.6', 'SV-08'] },
  {
    method: 'post',
    path: `${BASE}/{id}/revoke`,
    summary: 'Token widerrufen (wirkt sofort)',
    tags: ['nina-instances'],
    request: { params: z.object({ id: Uuid }) },
    responses: {
      200: { description: 'Widerrufen', ...json(nina.NinaInstanceView) },
      401: problemContent('Nicht angemeldet'),
      403: problemContent('Keine Berechtigung'),
      404: problemContent('resource.not_found'),
    },
  },
);

export const ninaDiagnosticsRoute = defineRoute(
  { action: 'nina.instance.read', requirements: ['FA-ADM-06', 'TK 7.2'] },
  {
    method: 'get',
    path: `${BASE}/{id}/diagnostics`,
    summary: 'Diagnose einer Instanz: letzte Aufrufe, Fehler, Versionen, letzter Heartbeat',
    tags: ['nina-instances'],
    request: { params: z.object({ id: Uuid }) },
    responses: {
      200: { description: 'Diagnose', ...json(nina.NinaInstanceDiagnostics) },
      401: problemContent('Nicht angemeldet'),
      403: problemContent('Keine Berechtigung'),
      404: problemContent('resource.not_found'),
    },
  },
);

export const deleteNinaInstanceRoute = defineRoute(
  { action: 'nina.instance.manage', requirements: ['FA-ADM-02', 'TK 7.2'] },
  {
    method: 'delete',
    path: `${BASE}/{id}`,
    summary: 'Instanz ohne Verlauf endgültig löschen (sonst nur widerrufen)',
    tags: ['nina-instances'],
    request: { params: z.object({ id: Uuid }) },
    responses: {
      204: { description: 'Gelöscht' },
      401: problemContent('Nicht angemeldet'),
      403: problemContent('Keine Berechtigung'),
      404: problemContent('resource.not_found'),
      409: problemContent('resource.in_use (Sessions oder Kommandos vorhanden)'),
    },
  },
);

export const NINA_INSTANCE_ROUTES = [
  listNinaInstancesRoute,
  createNinaInstanceRoute,
  revokeNinaInstanceRoute,
  deleteNinaInstanceRoute,
  ninaDiagnosticsRoute,
] as const;

export function webNinaInstanceRoutes(services: () => Promise<ApiServices>) {
  const app = new OpenAPIHono<ApiEnv>();
  const repo = async (c: Parameters<typeof requireTenant>[0]) => {
    const svc = await services();
    return { svc, repo: svc.repositories(requireTenant(c).tenant).ninaInstances() };
  };

  app.openapi(listNinaInstancesRoute, async (c) => {
    const { repo: r } = await repo(c);
    c.header('cache-control', 'no-store');
    return c.json({ items: (await r.list(c.req.valid('query').rigId)).map(ninaInstanceView) }, 200);
  });

  app.openapi(createNinaInstanceRoute, async (c) => {
    const { repo: r, svc } = await repo(c);
    const body = c.req.valid('json');
    const t = newNinaToken();
    const row = await r.create(
      { id: body.id, rigId: body.rigId, name: body.name, tokenHash: t.hash, tokenPrefix: t.prefix },
      svc.now(),
    );
    c.header('cache-control', 'no-store');
    return c.json({ ...ninaInstanceView(row), token: t.token }, 201);
  });

  app.openapi(revokeNinaInstanceRoute, async (c) => {
    const { repo: r } = await repo(c);
    return c.json(ninaInstanceView(await r.revoke(c.req.valid('param').id)), 200);
  });

  app.openapi(deleteNinaInstanceRoute, async (c) => {
    const { repo: r } = await repo(c);
    await r.remove(c.req.valid('param').id);
    return c.body(null, 204);
  });

  app.openapi(ninaDiagnosticsRoute, async (c) => {
    const { repo: r } = await repo(c);
    const row = await r.byId(c.req.valid('param').id);
    if (!row) throw new ProblemError('resource.not_found');
    const log = parseCallLog(row.lastCalls);
    const hb = row.lastState;
    c.header('cache-control', 'no-store');
    return c.json(
      {
        instance: ninaInstanceView(row),
        calls: log.calls as z.output<typeof nina.NinaCallEntry>[],
        errors: log.errors as z.output<typeof nina.NinaCallEntry>[],
        heartbeat:
          hb && typeof hb === 'object' && !Array.isArray(hb)
            ? (hb as Record<string, unknown>)
            : null,
      },
      200,
    );
  });

  return app;
}
