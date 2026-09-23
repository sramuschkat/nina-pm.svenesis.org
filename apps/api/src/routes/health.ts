import { OpenAPIHono, z } from '@hono/zod-openapi';
import { ENGINE_VERSION } from '@nina-pm/engine';
import type { ApiEnv } from '../lib/env';
import { defineRoute } from './define';

export const healthRoute = defineRoute(
  { action: 'public', requirements: ['SV-07', 'TK 4.2'] },
  {
    method: 'get',
    path: '/api/health',
    summary: 'Health (öffentlich, ohne DB-Ping)',
    tags: ['system'],
    responses: {
      200: {
        description: 'OK',
        content: {
          'application/json': {
            schema: z.object({
              status: z.literal('ok'),
              engineVersion: z.string(),
              build: z.string(),
            }),
          },
        },
      },
    },
  },
);

export function healthRoutes(buildId: string) {
  return new OpenAPIHono<ApiEnv>().openapi(healthRoute, (c) => {
    c.header('cache-control', 'no-store');
    return c.json({ status: 'ok' as const, engineVersion: ENGINE_VERSION, build: buildId }, 200);
  });
}
