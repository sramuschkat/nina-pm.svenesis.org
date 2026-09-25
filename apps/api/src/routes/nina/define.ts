/**
 * Routen der NINA-API (`/api/nina/v1`, TK 7.3): Aktion `nina.sync` (nur mit Rig-Token, nie per
 * Web-Sitzung), Sicherheitsschema Bearer, `ninaAuthorize` statt `authorize(action)`.
 */
import { createRoute, type RouteConfig } from '@hono/zod-openapi';
import { ninaAuthorize } from '../../nina/auth';

export const NINA_BASE = '/api/nina/v1';

export function defineNinaRoute<
  P extends string,
  R extends Omit<RouteConfig, 'path' | 'middleware'> & { path: P },
>(meta: { readonly requirements: readonly string[] }, config: R) {
  return createRoute({
    ...config,
    description: [
      config.description,
      `Aktion: \`nina.sync\` (Bearer-Token der NINA-Instanz) · ${meta.requirements.join(', ')}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    security: [{ ninaToken: [] }],
    'x-npm-action': 'nina.sync',
    'x-npm-requirements': [...meta.requirements],
    middleware: [ninaAuthorize()] as const,
  });
}
