/**
 * Routen der NINA-API (`/api/nina/v1`, TK 7.3): Aktion `nina.sync` (nur mit Rig-Token, nie per
 * Web-Sitzung), Sicherheitsschema Bearer, `ninaAuthorize` statt `authorize(action)`.
 */
import { createRoute, type RouteConfig } from '@hono/zod-openapi';
import type { MiddlewareHandler } from 'hono';
import type { ApiEnv } from '../../lib/env';
import { problemResponse } from '../../lib/problem';
import { ninaAuthorize } from '../../nina/auth';

export const NINA_BASE = '/api/nina/v1';

export function defineNinaRoute<
  P extends string,
  R extends Omit<RouteConfig, 'path' | 'middleware'> & { path: P },
>(
  meta: { readonly requirements: readonly string[]; readonly before?: MiddlewareHandler<ApiEnv> },
  config: R,
) {
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
    middleware: (meta.before ? [ninaAuthorize(), meta.before] : [ninaAuthorize()]) as [
      MiddlewareHandler<ApiEnv>,
    ],
  });
}

/**
 * Mengengrenze **vor** der Schemaprüfung: mehr als `max` Einträge im Feld → `413` (das Plugin halbiert
 * das Paket), statt `422` für ein ansonsten gültiges Paket (TK 7.3, SEC-52).
 */
export function batchLimit(
  field: string,
  max: number,
  code: 'capture.batch_too_large' | 'event.batch_too_large',
): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const list = body?.[field];
    if (Array.isArray(list) && list.length > max)
      return problemResponse(code, { requestId: c.get('requestId') });
    await next();
    return undefined;
  };
}
