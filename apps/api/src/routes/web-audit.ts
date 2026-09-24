/**
 * Protokolle im Mandanten (TK 7.2): Super-User-Aktionen, die den eigenen Mandanten betreffen
 * (`GET /web/v1/audit/system`, FA-SU-09) – Aktion `tenant.settings` (Admin/Owner).
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { PageQuery, SystemAuditList } from '@nina-pm/shared';
import type { ApiEnv } from '../lib/env';
import { defineRoute, problemContent } from './define';
import type { ApiServices } from './services';
import { auditView } from './system';
import { requireTenant } from './tenant';

export const tenantSystemAuditRoute = defineRoute(
  { action: 'tenant.settings', requirements: ['FA-SU-09', 'TK 7.2'] },
  {
    method: 'get',
    path: '/api/web/v1/audit/system',
    summary: 'Super-User-Aktionen, die den eigenen Mandanten betreffen (neueste zuerst)',
    tags: ['audit'],
    request: { query: PageQuery },
    responses: {
      200: {
        description: 'Einträge',
        content: { 'application/json': { schema: SystemAuditList } },
      },
      401: problemContent('Nicht angemeldet'),
      403: problemContent('Nur Admins'),
    },
  },
);

export const AUDIT_ROUTES = [tenantSystemAuditRoute] as const;

export function webAuditRoutes(services: () => Promise<ApiServices>) {
  const app = new OpenAPIHono<ApiEnv>();

  app.openapi(tenantSystemAuditRoute, async (c) => {
    const svc = await services();
    const { tenant } = requireTenant(c);
    const page = await svc.repositories(tenant).audit().systemAudit(c.req.valid('query'));
    c.header('cache-control', 'no-store');
    return c.json({ items: page.items.map(auditView), nextCursor: page.nextCursor }, 200);
  });

  return app;
}
