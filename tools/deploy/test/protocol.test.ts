import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findGreenProtocol,
  renderProtocol,
  writeProtocol,
  type DsqlTestProtocol,
} from '../src/dsql/protocol';

const base: DsqlTestProtocol = {
  tool: 'test',
  startedAt: 't0',
  migrationsHash: 'abc',
  commit: 'deadbee',
  caller: 'arn:aws:iam::1:user/x',
  suites: [{ id: 'D-01', title: 'Migrationen', ok: true, summary: 'ok', durationMs: 5 }],
  notes: [],
  passed: true,
};

describe('Protokoll von pnpm test:dsql', () => {
  it('findet ein grünes Protokoll nur für denselben Migrationsstand', () => {
    const root = mkdtempSync(join(tmpdir(), 'runs-'));
    writeProtocol(join(root, '2026-09-23', 'ap-03'), base);
    writeProtocol(join(root, '2026-09-23', 'ap-03'), {
      ...base,
      migrationsHash: 'rot',
      passed: false,
    });
    expect(findGreenProtocol(root, 'abc')).toMatch(/protocol\.json$/);
    expect(findGreenProtocol(root, 'rot')).toBeUndefined();
    expect(findGreenProtocol(root, 'anders')).toBeUndefined();
    expect(findGreenProtocol(join(root, 'fehlt'), 'abc')).toBeUndefined();
  });

  it('überspringt kaputte Dateien und überschreibt keine früheren Läufe', () => {
    const root = mkdtempSync(join(tmpdir(), 'runs-'));
    const dir = join(root, '2026-09-24', 'ap-03');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'kaputt.json'), '{');
    expect(writeProtocol(dir, base)).toMatch(/protocol$/);
    expect(writeProtocol(dir, base)).toMatch(/protocol-2$/);
    expect(findGreenProtocol(root, 'abc')).toBeDefined();
  });

  it('Markdown enthält je Prüfung Ergebnis und Zusammenfassung', () => {
    expect(renderProtocol(base)).toContain('| D-01 | Migrationen | ✔ | ok | 5 |');
    expect(renderProtocol({ ...base, passed: false })).toContain('**rot**');
  });
});
