/** OpenAPI ist eingecheckt und aktuell (rules/api.md: CI prüft den Diff). Neu erzeugen: pnpm openapi:generate. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openApiDocument, openApiYaml } from '../src/openapi';

describe('OpenAPI (docs/api/openapi.yaml)', () => {
  it('entspricht dem generierten Stand', () => {
    const checkedIn = readFileSync(
      new URL('../../../docs/api/openapi.yaml', import.meta.url),
      'utf8',
    );
    expect(checkedIn).toBe(openApiYaml());
  });

  it('jede Operation trägt x-npm-action und Anforderungs-IDs', () => {
    const doc = openApiDocument();
    for (const [path, item] of Object.entries(doc.paths ?? {})) {
      for (const op of Object.values(item as Record<string, Record<string, unknown>>)) {
        expect(op['x-npm-action'], path).toBeTruthy();
        expect((op['x-npm-requirements'] as string[]).length, path).toBeGreaterThan(0);
      }
    }
  });
});
