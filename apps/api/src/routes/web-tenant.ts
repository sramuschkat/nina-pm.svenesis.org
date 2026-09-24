/** Mandanteneinstellungen (S-71, FA-MAN-05; TK 7.2): lesen und ändern – Aktion `tenant.settings`. */
import { OpenAPIHono } from '@hono/zod-openapi';
import { TenantSettingsPatch, TenantSettingsView, type TenantSettings } from '@nina-pm/shared';
import type { ApiEnv } from '../lib/env';
import { isoUtc } from '../lib/format';
import { defineRoute, problemContent } from './define';
import type { ApiServices } from './services';
import { requireTenant } from './tenant';

const common = {
  401: problemContent('Nicht angemeldet'),
  403: problemContent('Nur Admins'),
};

export const getTenantSettingsRoute = defineRoute(
  { action: 'tenant.settings', requirements: ['FA-MAN-05', 'TK 7.2'] },
  {
    method: 'get',
    path: '/api/web/v1/tenant/settings',
    summary: 'Mandanteneinstellungen (mit Standardwerten)',
    tags: ['tenant'],
    responses: {
      200: {
        description: 'Einstellungen',
        content: { 'application/json': { schema: TenantSettingsView } },
      },
      ...common,
    },
  },
);

export const patchTenantSettingsRoute = defineRoute(
  { action: 'tenant.settings', requirements: ['FA-MAN-05', 'TK 7.2', 'DAT5-22', 'SV-03'] },
  {
    method: 'patch',
    path: '/api/web/v1/tenant/settings',
    summary: 'Mandanteneinstellungen ändern (nur Schlüssel aus tenantSettingsKeys)',
    tags: ['tenant'],
    request: {
      body: { content: { 'application/json': { schema: TenantSettingsPatch } }, required: true },
    },
    responses: {
      200: {
        description: 'Geändert',
        content: { 'application/json': { schema: TenantSettingsView } },
      },
      ...common,
      422: problemContent('validation.failed (unbekannter Schlüssel oder ungültiger Wert)'),
    },
  },
);

export const TENANT_ROUTES = [getTenantSettingsRoute, patchTenantSettingsRoute] as const;

export function webTenantRoutes(services: () => Promise<ApiServices>) {
  const app = new OpenAPIHono<ApiEnv>();
  const view = (v: { displayName: string; settings: TenantSettings; updatedAt: Date }) => ({
    displayName: v.displayName,
    settings: v.settings,
    updatedAt: isoUtc(v.updatedAt),
  });

  app.openapi(getTenantSettingsRoute, async (c) => {
    const svc = await services();
    const { tenant } = requireTenant(c);
    c.header('cache-control', 'no-store');
    return c.json(view(await svc.repositories(tenant).tenant().settings()), 200);
  });

  app.openapi(patchTenantSettingsRoute, async (c) => {
    const svc = await services();
    const { tenant } = requireTenant(c);
    const updated = await svc
      .repositories(tenant)
      .tenant()
      .updateSettings(c.req.valid('json'), svc.now());
    return c.json(view(updated), 200);
  });

  return app;
}
