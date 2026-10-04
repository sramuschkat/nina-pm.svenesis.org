/**
 * Nacht-Tabelle mit Dämmerungen (AP-52): nur auf Wunsch (Bootstrap), sonst unverändert – die Tabelle fließt in
 * Plan-Eingaben und damit in den `inputHash` (night.md §1).
 */
import { describe, expect, it } from 'vitest';
import { buildNightTable } from '../src/lib/night-table';
import { SITE } from './support/equipment';

describe('buildNightTable: twilight (AP-52)', () => {
  it('ohne Option keine Dämmerungen (Plan-Eingaben und inputHash unverändert)', () => {
    const table = buildNightTable(SITE, '2026-10-31', 2);
    expect(table.nights.map((n) => Object.keys(n))).toEqual([
      ['night', 'noonStartUtc', 'noonEndUtc', 'nightWindowEndUtc'],
      ['night', 'noonStartUtc', 'noonEndUtc', 'nightWindowEndUtc'],
    ]);
  });

  it('mit Option je Nacht Abend- und Morgendurchgang der drei Grenzen innerhalb Mittag–Mittag', () => {
    const table = buildNightTable(SITE, '2026-10-31', 2, { twilight: true });
    for (const n of table.nights) {
      const tw = n.twilight;
      expect(tw).toBeDefined();
      if (!tw) continue;
      for (const c of [tw.civil, tw.nautical, tw.astronomical]) {
        expect(c.duskUtc !== null && c.duskUtc > n.noonStartUtc).toBe(true);
        expect(c.dawnUtc !== null && c.dawnUtc < n.noonEndUtc).toBe(true);
      }
      expect((tw.civil.duskUtc ?? '') < (tw.astronomical.duskUtc ?? '')).toBe(true);
    }
  });
});
