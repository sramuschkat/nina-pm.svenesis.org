/**
 * Mond & Planeten einer Nacht (`sky.nightBodySamples`, `sky.bestBodySample`): Referenz ist der
 * Beobachtungsplaner der Website für Starfront, Nacht 27./28.09.2026 (Screenshot Sven 27.09.2026, Zeiten CDT =
 * UTC−5, 10-min-Schritte): Mond max. 72° um 02:40 (97 %), Mars 57° um 07:00, Jupiter 39° um 07:00, Saturn 61°
 * um 02:00, Uranus 80° um 05:20, Neptun 58° um 01:20; Merkur und Venus nachts nicht über 10°.
 */
import { describe, expect, it } from 'vitest';
import { sky } from '../src/index';

const STARFRONT = { latDeg: 31.5471, lonDeg: -99.3823 };
const at = (iso: string) => Date.parse(iso) / 1000;
// 18:00 CDT bis 09:00 CDT
const rows = sky.nightBodySamples(
  STARFRONT,
  at('2026-09-27T23:00:00Z'),
  at('2026-09-28T14:00:00Z'),
);

const EXPECTED: [sky.NightBodyId, number, string][] = [
  ['moon', 72, '2026-09-28T07:40:00Z'],
  ['mars', 57, '2026-09-28T12:00:00Z'],
  ['jupiter', 39, '2026-09-28T12:00:00Z'],
  ['saturn', 61, '2026-09-28T07:00:00Z'],
  ['uranus', 80, '2026-09-28T10:20:00Z'],
  ['neptune', 58, '2026-09-28T06:20:00Z'],
];

describe('Mond & Planeten (Vorlage Beobachtungsplaner)', () => {
  it('Proben alle 10 min mit Sonnenhöhe und allen acht Körpern', () => {
    expect(rows).toHaveLength(91);
    expect(Object.keys(rows[0]?.bodies ?? {})).toEqual([...sky.NIGHT_BODIES]);
    expect(rows[1]?.t).toBe(at('2026-09-27T23:10:00Z'));
  });

  for (const [id, alt, time] of EXPECTED)
    it(`${id}: max. ${String(alt)}° um ${time} (±1°, ±20 min)`, () => {
      const best = sky.bestBodySample(rows, id);
      expect(best).not.toBeNull();
      expect(Math.abs((best?.sample.altDeg ?? 0) - alt)).toBeLessThan(1);
      expect(Math.abs((best?.t ?? 0) - at(time))).toBeLessThanOrEqual(1200);
    });

  it('Mond 97 % beleuchtet, Planeten mit Helligkeit', () => {
    const moon = sky.bestBodySample(rows, 'moon');
    expect(Math.abs((moon?.sample.illumPct ?? 0) - 97)).toBeLessThan(1.5);
    expect(moon?.sample.mag).toBeNull();
    const jupiter = sky.bestBodySample(rows, 'jupiter');
    expect(Math.abs((jupiter?.sample.mag ?? 0) - -1.9)).toBeLessThan(0.15);
    expect(jupiter?.sample.illumPct).toBeNull();
  });

  it('Merkur und Venus stehen nachts nicht über 10°', () => {
    for (const id of ['mercury', 'venus'] as const)
      expect(sky.bestBodySample(rows, id)?.sample.altDeg ?? 0).toBeLessThan(10);
  });
});
