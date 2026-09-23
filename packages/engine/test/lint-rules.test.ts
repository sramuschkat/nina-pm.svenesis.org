import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// Prüft die echte Repo-Konfiguration (eslint.config.js) gegen virtuelle Dateien (AP-01, rules/engine.md).
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const eslint = new ESLint({ cwd: repoRoot });

async function ruleIds(code: string, filePath: string): Promise<(string | null)[]> {
  const [result] = await eslint.lintText(code, { filePath: `${repoRoot}${filePath}` });
  if (!result) throw new Error('ESLint lieferte kein Ergebnis');
  return result.messages.map((m) => m.ruleId);
}

const ENGINE_FILE = 'packages/engine/src/lint-probe.ts';

describe('ESLint-Engine-Regel', () => {
  it('schlägt bei Math.sin in packages/engine an', async () => {
    expect(await ruleIds('export const x = Math.sin(1);\n', ENGINE_FILE)).toContain(
      'no-restricted-syntax',
    );
  });

  it.each([
    ['Math.round', 'export const x = Math.round(1.5);\n'],
    ['Math.random', 'export const x = Math.random();\n'],
    ['Math.log10', 'export const x = Math.log10(2);\n'],
    ['berechneter Zugriff', "export const x = Math['sin'](1);\n"],
    ['Zerlegung', 'const { sin } = Math;\nexport const x = sin(1);\n'],
    ['Operator **', 'export const x = 2 ** 3;\n'],
    ['toFixed', 'export const x = (1.5).toFixed(1);\n'],
    ['toString(radix)', 'export const x = (15).toString(16);\n'],
    ['BigInt-Literal', 'export const x = 1n;\n'],
  ])('verbietet %s', async (_name, code) => {
    expect(await ruleIds(code, ENGINE_FILE)).toContain('no-restricted-syntax');
  });

  it.each([
    ['Date', 'export const x = Date.now();\n'],
    ['Intl', "export const x = new Intl.NumberFormat('de');\n"],
    ['setTimeout', 'setTimeout(() => undefined, 1);\n'],
  ])('verbietet das Global %s', async (_name, code) => {
    expect(await ruleIds(code, ENGINE_FILE)).toContain('no-restricted-globals');
  });

  it('verbietet nicht-relative Importe', async () => {
    expect(
      await ruleIds("import { readFileSync } from 'node:fs';\nreadFileSync('x');\n", ENGINE_FILE),
    ).toContain('no-restricted-imports');
  });

  it('erlaubt die Allowlist Math.abs/floor/ceil/trunc/min/max/sign/sqrt/PI', async () => {
    const code =
      'export const x = Math.abs(-1) + Math.floor(1.5) + Math.ceil(1.5) + Math.trunc(1.5) + ' +
      'Math.min(1, 2) + Math.max(1, 2) + Math.sign(-1) + Math.sqrt(4) + Math.PI;\n';
    expect(await ruleIds(code, ENGINE_FILE)).toEqual([]);
  });

  it('gilt nur für packages/engine', async () => {
    expect(
      await ruleIds('export const x = Math.sin(1);\n', 'packages/shared/src/lint-probe.ts'),
    ).toEqual([]);
  });
});
