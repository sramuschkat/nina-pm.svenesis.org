/** OpenAPI ist eingecheckt und aktuell (rules/api.md: CI prüft den Diff). Neu erzeugen: pnpm openapi:generate. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openApiDocument, openApiYaml } from '../src/openapi';
import { openApiNinaDocument, openApiNinaJson } from '../src/openapi-nina';

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

  it('NINA-Ausschnitt (docs/api/openapi.nina.json) entspricht dem generierten Stand', () => {
    const checkedIn = readFileSync(
      new URL('../../../docs/api/openapi.nina.json', import.meta.url),
      'utf8',
    );
    expect(checkedIn).toBe(openApiNinaJson());
  });

  it('NINA-Ausschnitt: nur /api/nina/, OpenAPI 3.0 ohne Typlisten und numerische exclusive*', () => {
    const doc = openApiNinaDocument();
    expect(doc.openapi).toBe('3.0.3');
    expect(Object.keys(doc.paths as object).every((p) => p.startsWith('/api/nina/'))).toBe(true);
    expect(Object.keys(doc.paths as object)).toHaveLength(8);
    const text = JSON.stringify(doc);
    expect(text).not.toMatch(/"type":\[/);
    expect(text).not.toMatch(/"exclusiveM(in|ax)imum":-?\d/);
    expect(text).toContain('"nullable":true');
    expect(text).not.toContain('"oneOf"');
    // Vereinigung der Planeinträge: alle Befehle in einer Aufzählung.
    type Node = Record<string, Record<string, unknown>> & { required?: string[] };
    const schemas = (doc.components as { schemas: Record<string, Node> }).schemas;
    const blocks = (schemas.NinaPlanResponse?.properties as Record<string, Node>).blocks;
    const entry = ((blocks?.items as Node).properties as Record<string, Node>).entries
      ?.items as Node;
    const cmd = (entry.properties as Record<string, Node>).cmd as unknown as { enum: string[] };
    expect(cmd.enum).toEqual(
      expect.arrayContaining(['slew_center', 'expose', 'expose_series', 'end']),
    );
    expect(entry.required).toEqual(['seq', 'cmd', 'atUtc']);
  });
});
