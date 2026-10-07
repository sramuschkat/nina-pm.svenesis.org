import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ProblemError } from '../src/errors';
import { currentNight, nightOfEndedWindow, type NightRow } from '../src/night';

interface Vectors {
  tables: Record<string, NightRow[]>;
  cases: { name: string; table: string; now: string; expect?: string; error?: string }[];
}

const vectors = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../contracts/test-vectors/current-night.json', import.meta.url)),
    'utf8',
  ),
) as Vectors;

describe('currentNight (NT-01, night.md §1.1/§4) – gemeinsame Testvektoren', () => {
  it('enthält die Pflichtfälle aus night.md §4', () => {
    const starfront = vectors.cases
      .filter((c) => c.table === 'starfront0917')
      .map((c) => [c.now, c.expect]);
    expect(starfront).toEqual([
      ['2026-09-18T07:00:00Z', '2026-09-17'],
      ['2026-09-18T12:59:59Z', '2026-09-17'],
      ['2026-09-18T13:00:00Z', '2026-09-18'],
      ['2026-09-18T14:00:00Z', '2026-09-18'],
      ['2026-09-18T18:00:00Z', '2026-09-18'],
    ]);
  });

  for (const c of vectors.cases) {
    it(c.name, () => {
      const nights = vectors.tables[c.table];
      expect(nights, c.table).toBeDefined();
      const run = () => currentNight({ nights: nights ?? [] }, c.now);
      if (c.error) {
        expect(run).toThrow(ProblemError);
        try {
          run();
        } catch (e) {
          expect((e as ProblemError).code).toBe(c.error);
        }
      } else {
        expect(run()).toBe(c.expect);
      }
    });
  }

  it('nightOfEndedWindow: Morgen nach dem Fensterende bis Mittag die alte Nacht, sonst null (07.10.2026)', () => {
    const table = { nights: vectors.tables.starfront0917 ?? [] };
    expect(nightOfEndedWindow(table, '2026-09-18T12:59:59Z')).toBeNull();
    expect(nightOfEndedWindow(table, '2026-09-18T13:30:00Z')).toBe('2026-09-17');
    expect(currentNight(table, '2026-09-18T13:30:00Z')).toBe('2026-09-18');
    expect(nightOfEndedWindow(table, '2026-09-18T18:00:00Z')).toBeNull();
  });

  it('verlangt einen UTC-Zeitpunkt mit Z', () => {
    expect(() =>
      currentNight({ nights: vectors.tables.starfront0917 ?? [] }, '2026-09-18T09:00:00-05:00'),
    ).toThrow(ProblemError);
  });
});
