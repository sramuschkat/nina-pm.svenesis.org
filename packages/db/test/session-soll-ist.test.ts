/**
 * Session Soll/Ist (Entscheidung Sven 07.10.2026; FA-AUS-03, FA-AUS-06): Soll je Zeile aus dem ersten Plan der
 * Session ohne Bonus, Transit-Serie als Zeitfenster; Korrektur-Überhang einer Nacht auf ihre Sessions verteilt.
 */
import { describe, expect, it } from 'vitest';
import { correctionShare, plannedByLine } from '../src/repositories/session-review';

const expose = (lineId: string, atUtc: string, bonus = false) => ({
  cmd: 'expose',
  atUtc,
  exposureLineId: lineId,
  exposureS: 300,
  bonus,
});

describe('plannedByLine', () => {
  it('zählt `expose` ohne Bonus je Zeile; Bonus-Zeilen fehlen; Serie als Zeitfenster', () => {
    const soll = plannedByLine([
      {
        entries: [
          { cmd: 'slew_center', atUtc: '2026-09-18T02:00:00Z' },
          expose('a', '2026-09-18T02:01:00Z'),
          expose('a', '2026-09-18T02:06:00Z'),
          expose('a', '2026-09-18T02:11:00Z', true),
          expose('b', '2026-09-18T02:16:00Z', true),
        ],
      },
      {
        entries: [
          expose('a', '2026-09-18T03:00:00Z'),
          {
            cmd: 'expose_series',
            atUtc: '2026-09-18T05:00:00.000Z',
            untilUtc: '2026-09-18T06:00:00Z',
            exposureLineId: 't',
            exposureS: 60,
          },
          {
            cmd: 'expose_series',
            atUtc: '2026-09-18T04:30:00Z',
            untilUtc: '2026-09-18T05:00:00Z',
            exposureLineId: 't',
            exposureS: 60,
          },
        ],
      },
    ]);
    expect(Object.fromEntries(soll)).toEqual({
      a: { frames: 3, series: null },
      t: {
        frames: 0,
        series: { fromUtc: '2026-09-18T04:30:00Z', untilUtc: '2026-09-18T06:00:00Z' },
      },
    });
  });

  it('ohne Plan oder ohne Einträge leer; ältere Einträge ohne `bonus` zählen', () => {
    expect(plannedByLine(null).size).toBe(0);
    expect(plannedByLine([{}]).size).toBe(0);
    expect(
      plannedByLine([{ entries: [{ cmd: 'expose', atUtc: 'x', exposureLineId: 'a' }] }]).get('a'),
    ).toEqual({ frames: 1, series: null });
  });
});

describe('correctionShare', () => {
  const sessions = [
    { sessionId: 's2', startedAt: '2026-09-18T05:00:00Z', open: 4 },
    { sessionId: 's1', startedAt: '2026-09-18T01:00:00Z', open: 2 },
  ];
  it('Überhang nach Sessionbeginn, je Session höchstens bis zu ihren nicht verworfenen Aufnahmen', () => {
    expect(correctionShare(3, sessions, 's1')).toBe(2);
    expect(correctionShare(3, sessions, 's2')).toBe(1);
    expect(correctionShare(1, sessions, 's2')).toBe(0);
    expect(correctionShare(9, sessions, 's2')).toBe(4);
  });
  it('ohne Überhang oder fremde Session → 0', () => {
    expect(correctionShare(0, sessions, 's1')).toBe(0);
    expect(correctionShare(-2, sessions, 's1')).toBe(0);
    expect(correctionShare(3, sessions, 'sX')).toBe(0);
  });
});
