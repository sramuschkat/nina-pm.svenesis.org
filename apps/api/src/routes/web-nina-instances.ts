/**
 * NINA-Instanzen im Web (AP-14a; TK 5.6, 7.2; FA-SYN-01, SV-08): auflisten (`nina.instance.read`),
 * anlegen und widerrufen (`nina.instance.manage`). Das Token erscheint nur in der Antwort auf das
 * Anlegen; gespeichert werden SHA-256 und Präfix. Ein Widerruf wirkt ab der nächsten Plugin-Anfrage.
 */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import type { NinaInstanceRow } from '@nina-pm/db';
import { nina, Uuid } from '@nina-pm/shared';
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

export function ninaInstanceView(r: NinaInstanceRow): z.output<typeof nina.NinaInstanceView> {
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

export const NINA_INSTANCE_ROUTES = [
  listNinaInstancesRoute,
  createNinaInstanceRoute,
  revokeNinaInstanceRoute,
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

  return app;
}
