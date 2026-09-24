/** Web-API-Client (CC-12): `src/api/schema.d.ts` entspricht docs/api/openapi.yaml (`pnpm --filter @nina-pm/web api:generate`). */
import { readFileSync } from 'node:fs';
import openapiTS, { astToString } from 'openapi-typescript';
import { describe, expect, it } from 'vitest';

describe('generierter API-Client', () => {
  it('ist aktuell', async () => {
    const spec = new URL('../../../docs/api/openapi.yaml', import.meta.url);
    const generated = astToString(await openapiTS(spec));
    const current = readFileSync(new URL('../src/api/schema.d.ts', import.meta.url), 'utf8');
    const body = (s: string) => s.replace(/^\/\*\*[\s\S]*?\*\/\s*/, '').trim();
    expect(body(current)).toBe(body(generated));
  });
});
