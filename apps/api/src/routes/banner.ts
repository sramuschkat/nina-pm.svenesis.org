/** Öffentlicher Wartungshinweis (FA-SU-08): auch ohne Anmeldung, damit ihn die Einstiegsseite zeigt. */
import { OpenAPIHono } from '@hono/zod-openapi';
import { PublicBanner } from '@nina-pm/shared';
import type { ApiEnv } from '../lib/env';
import { defineRoute } from './define';
import type { ApiServices } from './services';

export const bannerRoute = defineRoute(
  { action: 'public', requirements: ['FA-SU-08'] },
  {
    method: 'get',
    path: '/api/banner',
    summary: 'Aktiver Wartungshinweis (öffentlich)',
    tags: ['system'],
    responses: {
      200: { description: 'Hinweis', content: { 'application/json': { schema: PublicBanner } } },
    },
  },
);

export function bannerRoutes(services: () => Promise<ApiServices>) {
  return new OpenAPIHono<ApiEnv>().openapi(bannerRoute, async (c) => {
    const svc = await services();
    c.header('cache-control', 'no-store');
    return c.json({ banner: await svc.maintenanceBanner() }, 200);
  });
}
