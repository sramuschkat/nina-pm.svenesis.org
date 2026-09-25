/**
 * OpenAPI 3.1 aus den zod-Schemas (TK 7.1, 7.5) – eingecheckt unter docs/api/openapi.yaml, CI prüft
 * den Diff (test/openapi.test.ts). Neu erzeugen: `pnpm openapi:generate`.
 */
import { stringify } from 'yaml';
import { createApp } from './app';

export function openApiDocument() {
  const app = createApp({ originVerifyValue: () => Promise.resolve(''), buildId: 'openapi' });
  // NINA-API: Sync-Token der Instanz als Bearer (TK 5.6, SV-08).
  app.openAPIRegistry.registerComponent('securitySchemes', 'ninaToken', {
    type: 'http',
    scheme: 'bearer',
    description: 'Sync-Token `npm_…` der NINA-Instanz (an genau ein Rig gebunden, widerrufbar).',
  });
  return app.getOpenAPI31Document({
    openapi: '3.1.0',
    info: {
      title: 'Svenesis NINA-PM API',
      version: '1',
      description:
        'Generiert aus packages/shared (zod) – nicht von Hand ändern. Fehler als application/problem+json mit Codes aus docs/contracts/errors.json. Nicht-GET unter /api/auth, /api/web/v1, /api/system/v1 verlangt X-NPM-Request: 1 (SV-04).',
    },
    servers: [{ url: 'https://nina-pm.svenesis.org' }],
  });
}

export function openApiYaml(): string {
  return stringify(openApiDocument(), { lineWidth: 0, sortMapEntries: false });
}
