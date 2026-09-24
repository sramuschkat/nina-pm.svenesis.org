/** Lint-Regeln der Oberfläche (AP-06a): Datumswerte (NT-04), kein dangerouslySetInnerHTML (SV-05), Bausteine ohne Daten/Rechte. */
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const eslint = new ESLint({ cwd: root });
const messages = async (code: string, file: string) =>
  (await eslint.lintText(code, { filePath: `${root}${file}` }))[0]?.messages.map(
    (m) => m.message,
  ) ?? [];

describe('ESLint-Regeln apps/web', () => {
  it("new Date('2026-09-17') in apps/web schlägt an, ebenso mit Template; Date.UTC/Date.parse nicht", async () => {
    expect(
      (await messages("export const d = new Date('2026-09-17');\n", 'apps/web/src/x.ts')).join(),
    ).toMatch(/Temporal/);
    expect(
      (
        await messages(
          'const n = 17;\nexport const d = new Date(`2026-09-${n}`);\n',
          'apps/web/src/x.ts',
        )
      ).join(),
    ).toMatch(/Temporal/);
    expect(
      (
        await messages("export const d = new Date('2026-09-17');\n", 'packages/shared/src/x.ts')
      ).join(),
    ).toMatch(/Temporal/);
    expect(
      await messages('export const d = new Date(Date.UTC(2026, 8, 17));\n', 'apps/web/src/x.ts'),
    ).toEqual([]);
  });

  it('dangerouslySetInnerHTML ist verboten', async () => {
    const code =
      "export const X = () => <div dangerouslySetInnerHTML={{ __html: '<b>x</b>' }} />;\n";
    expect((await messages(code, 'apps/web/src/x.tsx')).join()).toMatch(/dangerouslySetInnerHTML/);
  });

  it('Bausteine importieren weder useCan/Auth noch TanStack Query noch fetch', async () => {
    const code =
      "import { useCan } from '../../auth';\nimport { useQuery } from '@tanstack/react-query';\nexport const x = [useCan, useQuery, fetch];\n";
    const found = (await messages(code, 'apps/web/src/components/Foo/index.tsx')).join('\n');
    expect(found).toMatch(/useCan\/Auth/);
    expect(found).toMatch(/fragen keine Daten ab/);
    expect(found).toMatch(/rufen keine API auf/);
  });
});
