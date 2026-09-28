/**
 * Vorlage `result.json` für einen Protokoll-Lauf (ops/plugin-test-protocol.md): Schritte aus
 * `expectations.json` mit `ok: false` und leerer Notiz, `logCheck` noch `not_run`. Sven trägt Versionen,
 * `ok`/`note` je Schritt, `result` und die Artefakte ein; `logCheck` schreibt danach `pnpm test-run:check`.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXPECTATIONS } from './check';
import type { RunResult } from './result';

export function initRun(protocol: string, dir: string, today = new Date()): readonly string[] {
  const exp = EXPECTATIONS.protocols[protocol];
  if (!exp) throw new Error(`keine Erwartungen für ${protocol} in expectations.json`);
  const path = join(dir, 'result.json');
  if (existsSync(path)) throw new Error(`${path} existiert schon`);
  const pad = (n: number) => String(n).padStart(2, '0');
  const result: RunResult = {
    protocol,
    date: `${String(today.getFullYear())}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`,
    pluginVersion: '',
    ninaVersion: '',
    server: 'nina_test_server',
    scenario: null,
    result: 'no_go',
    steps: exp.steps.map((_, i) => ({ n: i + 1, ok: false, note: '' })),
    logCheck: { status: 'not_run', missing: [], unexpected: [] },
    deviations: [],
    artifacts: ['nina.log'],
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);
  return exp.steps;
}
