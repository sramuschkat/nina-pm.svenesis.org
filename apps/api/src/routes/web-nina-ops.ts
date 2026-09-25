/**
 * Betrieb rund um die NINA-API im Web (AP-14b; TK 5.6, 6.6):
 * - `POST /web/v1/rigs/{id}/lease/release` (Admin): Lease freigeben und Offline-Einfrieren beenden;
 *   die bisherige Session holt sie per Heartbeat nicht zurück (M5).
 * - `PATCH /web/v1/captures/{id}/assign` (Admin): nicht zugeordnete Aufnahme einer Zeile zuordnen (DAT5-12).
 */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import { assignCapture, releaseRigLease } from '@nina-pm/db';
import { Uuid } from '@nina-pm/shared';
import type { ApiEnv } from '../lib/env';
import { defineRoute, problemContent } from './define';
import type { ApiServices } from './services';
import { requireTenant } from './tenant';

export const releaseLeaseRoute = defineRoute(
  { action: 'nina.instance.manage', requirements: ['FA-RIG-06', 'FA-NIN-04', 'TK 5.6', 'M5'] },
  {
    method: 'post',
    path: '/api/web/v1/rigs/{id}/lease/release',
    summary: 'Lease des Rigs freigeben (Übernahme durch einen Ersatzrechner)',
    tags: ['nina-instances'],
    request: { params: z.object({ id: Uuid }) },
    responses: {
      200: {
        description: 'Freigegeben',
        content: {
          'application/json': { schema: z.object({ releasedSessionId: Uuid.nullable() }) },
        },
      },
      401: problemContent('Nicht angemeldet'),
      403: problemContent('Keine Berechtigung'),
      404: problemContent('resource.not_found'),
    },
  },
);

export const assignCaptureRoute = defineRoute(
  { action: 'session.review', requirements: ['FA-AUS-04', 'DAT5-12', 'TK 6.6'] },
  {
    method: 'patch',
    path: '/api/web/v1/captures/{id}/assign',
    summary: 'Nicht zugeordnete Aufnahme einer Belichtungszeile zuordnen',
    tags: ['sessions'],
    request: {
      params: z.object({ id: Uuid }),
      body: {
        content: {
          'application/json': { schema: z.strictObject({ exposureLineId: Uuid }) },
        },
        required: true,
      },
    },
    responses: {
      204: { description: 'Zugeordnet' },
      401: problemContent('Nicht angemeldet'),
      403: problemContent('Keine Berechtigung'),
      404: problemContent('resource.not_found'),
      409: problemContent('capture.assign_mismatch'),
    },
  },
);

export const NINA_OPS_ROUTES = [releaseLeaseRoute, assignCaptureRoute] as const;

export function webNinaOpsRoutes(services: () => Promise<ApiServices>) {
  const app = new OpenAPIHono<ApiEnv>();
  app.openapi(releaseLeaseRoute, async (c) => {
    const svc = await services();
    const { tenant } = requireTenant(c);
    return c.json(
      await releaseRigLease(svc.db, tenant.tenantId, c.req.valid('param').id, svc.now()),
      200,
    );
  });
  app.openapi(assignCaptureRoute, async (c) => {
    const svc = await services();
    const { tenant } = requireTenant(c);
    await assignCapture(
      svc.db,
      tenant.tenantId,
      c.req.valid('param').id,
      c.req.valid('json').exposureLineId,
      svc.now(),
    );
    return c.body(null, 204);
  });
  return app;
}
