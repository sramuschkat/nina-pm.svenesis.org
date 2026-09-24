/**
 * Vergleichsorakel (AP-13a): Beispiel-Grids und Zufallsgrids bestehen Schema und Querbezüge, der
 * Patch berührt nur die drei vorgesehenen Stellen, die Quell-Pins sind vollständig. Das Orakel selbst
 * (dotnet) läuft in `oracle.yml`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomGrid } from '@nina-pm/engine';
import { GoldenPlanSchema } from '@nina-pm/shared';
import { describe, expect, it } from 'vitest';
import { loadPin, ORACLE_DIR } from '../src/fetch';
import { gridFiles, validateGrid } from '../src/grids';

const examples = gridFiles([join(ORACLE_DIR, 'grids')]);

describe('Grid-Schema', () => {
  it('validiert alle Beispiel-Grids', () => {
    expect(examples.length).toBeGreaterThanOrEqual(7);
    for (const file of examples)
      expect(validateGrid(JSON.parse(readFileSync(file, 'utf8'))).problems, file).toEqual([]);
  });

  it('validiert 20 Zufallsgrids (Kompatibilitäts- und Produktivmodus)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      expect(validateGrid(randomGrid(seed)).problems, `compat ${String(seed)}`).toEqual([]);
      expect(validateGrid(randomGrid(seed, { mode: 'productive' })).problems).toEqual([]);
    }
  });

  it('meldet Schema- und Querbezugsfehler', () => {
    expect(validateGrid({ mode: 'compat' }).problems.length).toBeGreaterThan(0);
    const g = randomGrid(3);
    expect(
      validateGrid({ ...g, settings: { ...g.settings, sortChain: ['due_soonest'] } }).problems,
    ).toEqual([expect.stringMatching(/^grid\.unsupported_sort_key/)]);
  });

  it('Soll-Plan-Hülle: Grid unter `input`, approvedBy null bis zur Abnahme (H-13)', () => {
    const input = JSON.parse(readFileSync(examples[0] ?? '', 'utf8')) as unknown;
    const plan = {
      id: 'G01',
      title: 'Einzelziel',
      requirements: ['FA-SCH-01'],
      explanation: '…',
      approvedBy: null,
      oracleDiff: null,
      input,
      expected: { slotAssignment: [null] },
    };
    expect(GoldenPlanSchema.safeParse(plan).success).toBe(true);
    expect(validateGrid(plan).problems).toEqual([]);
  });
});

describe('Quellen und Patch', () => {
  it('Pin: Commit 5dd621d, sechs Dateien mit SHA-256', () => {
    const pin = loadPin();
    expect(pin.commit).toMatch(/^5dd621d[0-9a-f]{33}$/);
    expect(pin.files.map((f) => f.path)).toEqual([
      'Models/ScheduleEngine.cs',
      'Models/SessionScheduler.cs',
      'Models/ProjectTarget.cs',
      'Models/AstroCalculator.cs',
      'Models/ExoTransit.cs',
      'Instructions/TargetInstructionSet.cs',
    ]);
    for (const f of pin.files) expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('Minimal-Patch: nur Zeilen-ID, Masken-Hook und Lauf-Tie-Break', () => {
    const patch = readFileSync(join(ORACLE_DIR, 'oracle.patch'), 'utf8');
    const files = [...patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1]);
    expect(files).toEqual([
      'Models/ProjectTarget.cs',
      'Models/ScheduleEngine.cs',
      'Models/SessionScheduler.cs',
    ]);
    const removed = patch.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
    expect(removed).toEqual(['-                return b.Length.CompareTo(a.Length);']);
    expect(patch).toContain('public string Id { get; set; }');
    expect(patch).toContain('OracleHooks.Masks.TryGetValue((es.Id, slot.UtcStart)');
    expect(patch).toContain('a.Start.CompareTo(b.Start)');
  });
});
