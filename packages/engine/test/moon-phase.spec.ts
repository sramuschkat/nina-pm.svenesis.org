/**
 * Mondphasen (Anzeige „Mond und Dunkelheit“, Mondkalender): Viertel im September 2026 gegen die veröffentlichten
 * Zeiten (USNO „Phases of the Moon“ 2026: Letztes Viertel 04.09. 07:51, Neumond 11.09. 03:27, Erstes Viertel
 * 18.09. 20:44, Vollmond 26.09. 16:49 UTC) auf ± 3 min; Phasenwinkel und Mondalter dazu passend.
 */
import { describe, expect, it } from 'vitest';
import { moonAgeDays, moonPhaseAngleDeg, moonPhaseEvents } from '../src';

const utc = (s: string) => Date.parse(s) / 1000;

describe('moonPhaseEvents', () => {
  it('September 2026: vier Viertel in der richtigen Reihenfolge, je ± 3 min', () => {
    const events = moonPhaseEvents(utc('2026-09-01T00:00:00Z'), utc('2026-10-01T00:00:00Z'));
    expect(events.map((e) => e.kind)).toEqual(['last', 'new', 'first', 'full']);
    const expected = [
      '2026-09-04T07:51:00Z',
      '2026-09-11T03:27:00Z',
      '2026-09-18T20:44:00Z',
      '2026-09-26T16:49:00Z',
    ].map(utc);
    events.forEach((e, i) => expect(Math.abs(e.atUtc - (expected[i] as number))).toBeLessThan(180));
  });

  it('Phasenwinkel an den Vierteln 0/90/180/270; nach dem Ereignis keine Doppelmeldung', () => {
    const [last, nu, first, full] = moonPhaseEvents(
      utc('2026-09-01T00:00:00Z'),
      utc('2026-10-01T00:00:00Z'),
    );
    const near = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180) < 0.01;
    expect(near(moonPhaseAngleDeg(last?.atUtc ?? 0), 270)).toBe(true);
    expect(near(moonPhaseAngleDeg(nu?.atUtc ?? 0), 0)).toBe(true);
    expect(near(moonPhaseAngleDeg(first?.atUtc ?? 0), 90)).toBe(true);
    expect(near(moonPhaseAngleDeg(full?.atUtc ?? 0), 180)).toBe(true);
    expect(moonPhaseEvents((full?.atUtc ?? 0) + 60, (full?.atUtc ?? 0) + 86400)).toEqual([]);
  });

  it('Mondalter: 0 am Neumond, ≈ 15,6 Tage am Vollmond, 17 Tage am Abend des 27.09.', () => {
    const [, nu, , full] = moonPhaseEvents(
      utc('2026-09-01T00:00:00Z'),
      utc('2026-10-01T00:00:00Z'),
    );
    expect(moonAgeDays((nu?.atUtc ?? 0) + 60)).toBeLessThan(0.01);
    expect(moonAgeDays(full?.atUtc ?? 0)).toBeCloseTo(15.56, 1);
    // Mitternacht der Nacht 27./28.09. in Chicago (05:00 UTC): 17,0 Tage wie im Beobachtungsplaner.
    expect(moonAgeDays(utc('2026-09-28T05:00:00Z'))).toBeCloseTo(17.07, 1);
  });
});
