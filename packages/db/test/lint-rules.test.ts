import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// TK 3.2: kein Import von packages/db/src/connection außerhalb von packages/db/src/repositories.
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const eslint = new ESLint({ cwd: repoRoot });

async function ruleIds(code: string, filePath: string): Promise<(string | null)[]> {
  const [result] = await eslint.lintText(code, { filePath: `${repoRoot}${filePath}` });
  if (!result) throw new Error('ESLint lieferte kein Ergebnis');
  return result.messages.map((m) => m.ruleId);
}

const IMPORT = "import { db } from '../connection';\nexport { db };\n";

describe('ESLint-Regel zur DB-Verbindung', () => {
  it('erlaubt den Import in packages/db/src/repositories', async () => {
    expect(await ruleIds(IMPORT, 'packages/db/src/repositories/probe.ts')).toEqual([]);
  });

  it('verbietet den Import an anderer Stelle in packages/db', async () => {
    expect(await ruleIds(IMPORT, 'packages/db/src/migrations/probe.ts')).toContain(
      'no-restricted-imports',
    );
  });

  it('verbietet den Import aus anderen Paketen', async () => {
    const code = "import { db } from '../../../packages/db/src/connection';\nexport { db };\n";
    expect(await ruleIds(code, 'apps/api/src/handlers/probe.ts')).toContain(
      'no-restricted-imports',
    );
  });
});
