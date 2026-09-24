/** Persönliche Einstellungen (TK 7.2, 11.3): Theme, Dichte, Navigation – je Mitgliedschaft in `user_preference`. */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import {
  PREFERENCE_KEYS,
  PREFERENCE_SCHEMAS,
  PreferenceKeySchema,
  Preferences,
  PreferenceValue,
  ProblemError,
  toFieldErrors,
} from '@nina-pm/shared';
import type { ApiEnv } from '../lib/env';
import { defineRoute, problemContent } from './define';
import type { ApiServices } from './services';
import { requireTenant } from './tenant';

export const getPreferencesRoute = defineRoute(
  { action: 'me.preferences', requirements: ['TK 7.2', 'TK 11.3'] },
  {
    method: 'get',
    path: '/api/web/v1/me/preferences',
    summary: 'Persönliche Einstellungen (Theme, Dichte, Navigation)',
    tags: ['me'],
    responses: {
      200: {
        description: 'Einstellungen',
        content: { 'application/json': { schema: Preferences } },
      },
      401: problemContent('Nicht angemeldet'),
      403: problemContent('Kein Mandanten-Kontext'),
    },
  },
);

export const putPreferenceRoute = defineRoute(
  { action: 'me.preferences', requirements: ['TK 7.2', 'TK 11.3'] },
  {
    method: 'put',
    path: '/api/web/v1/me/preferences/{key}',
    summary: 'Eine persönliche Einstellung setzen',
    tags: ['me'],
    request: {
      params: z.object({ key: PreferenceKeySchema }),
      body: { content: { 'application/json': { schema: PreferenceValue } }, required: true },
    },
    responses: {
      204: { description: 'Gespeichert' },
      401: problemContent('Nicht angemeldet'),
      403: problemContent('Kein Mandanten-Kontext'),
      422: problemContent('validation.failed'),
    },
  },
);

export const ME_ROUTES = [getPreferencesRoute, putPreferenceRoute] as const;

export function webMeRoutes(services: () => Promise<ApiServices>) {
  const app = new OpenAPIHono<ApiEnv>();

  app.openapi(getPreferencesRoute, async (c) => {
    const svc = await services();
    const { tenant } = requireTenant(c);
    const stored = await svc.repositories(tenant).preference().all(PREFERENCE_KEYS);
    // Nur gültige Werte ausliefern – ein altes Format darf die Oberfläche nicht brechen.
    const valid = Object.fromEntries(
      Object.entries(stored).filter(
        ([k, v]) => PREFERENCE_SCHEMAS[k as keyof typeof PREFERENCE_SCHEMAS]?.safeParse(v).success,
      ),
    );
    c.header('cache-control', 'no-store');
    return c.json(valid as Preferences, 200);
  });

  app.openapi(putPreferenceRoute, async (c) => {
    const svc = await services();
    const { tenant } = requireTenant(c);
    const { key } = c.req.valid('param');
    const parsed = PREFERENCE_SCHEMAS[key].safeParse(c.req.valid('json').value);
    if (!parsed.success)
      throw new ProblemError(
        'validation.failed',
        toFieldErrors(parsed.error).map((e) => ({ ...e, path: `$.value${e.path.slice(1)}` })),
      );
    await svc.repositories(tenant).preference().set(key, parsed.data, svc.now());
    return c.body(null, 204);
  });

  return app;
}
