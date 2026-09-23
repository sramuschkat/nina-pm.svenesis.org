/**
 * Routen-Registry (TK 5.5, 7.5): jede Route deklariert ihre Aktion (`meta.action`, auch `public`);
 * `authorize(action)` läuft vor dem Handler. Die Aktion steht zusätzlich als `x-npm-action` in der
 * OpenAPI; der Rechte-Testgenerator iteriert über `ROUTES`.
 */
import { createRoute, type RouteConfig } from '@hono/zod-openapi';
import { ProblemDetails, type Action } from '@nina-pm/shared';
import { authorize } from '../lib/auth';

export interface RouteMeta {
  readonly action: Action;
  /** Anforderungs-IDs für die OpenAPI-Beschreibung (rules/api.md). */
  readonly requirements: readonly string[];
}

export function defineRoute<
  P extends string,
  R extends Omit<RouteConfig, 'path' | 'middleware'> & { path: P },
>(meta: RouteMeta, config: R) {
  return createRoute({
    ...config,
    description: [
      config.description,
      `Aktion: \`${meta.action}\` · ${meta.requirements.join(', ')}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    'x-npm-action': meta.action,
    'x-npm-requirements': [...meta.requirements],
    middleware: [authorize(meta.action)] as const,
  });
}

export const problemContent = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: ProblemDetails } },
});
