/**
 * AP-72: „klar laut Bildern“ (synthetische Nacht: klar, dünne Wolken, Wolkenloch) und Filter-Offsets (Regression mit
 * bekannten Werten wie in der Rig-Nacht 08./09.10.2026: L/G ≈ 2020, R/B + 45, −5 Schritte/°C).
 */
import { describe, expect, it } from 'vitest';
import {
  clarityByHour,
  focusOffsets,
  nightClarity,
  type ClarityLight,
  type FocusRun,
} from '../src';

const H = 3600;
const T0 = Date.parse('2026-10-09T03:00:00Z') / 1000;
const refs = [{ projectId: 'P', filter: 'L', stars: 800, hfr: 1.5, medianAdu: 1000, n: 40 }];
const light = (
  hour: number,
  minute: number,
  stars: number,
  over: Partial<ClarityLight> = {},
): ClarityLight => ({
  atS: T0 + hour * H + minute * 60,
  projectId: 'P',
  filter: 'L',
  stars,
  medianAdu: 1000,
  cloudCoverPct: null,
  ...over,
});

describe('klar laut Bildern', () => {
  it('klar, dünne Wolken, Wolkenloch je Stunde; Nachturteil', () => {
    const lights = [
      ...[0, 10, 20, 30, 40, 50].map((m) => light(0, m, 790)), // klar
      ...[0, 10, 20, 30].map((m) => light(1, m, 520)), // dünne Wolken: 65 %
      light(2, 0, 120), // Wolkenloch: 15 %
      light(2, 30, 90),
      ...[0, 20, 40].map((m) => light(3, m, 810)), // wieder klar
    ];
    const hours = clarityByHour(lights, refs);
    expect(hours.map((h) => h.verdict)).toEqual(['clear', 'thin', 'cloudy', 'clear']);
    expect(hours[1]?.starsRatio).toBeCloseTo(0.65, 2);
    expect(nightClarity(hours)).toBe('thin');
  });

  it('Hintergrund hell oder Wolkenbedeckung des Wettergeräts verschlechtern das Urteil', () => {
    const hours = clarityByHour(
      [
        light(0, 0, 800, { medianAdu: 1800 }),
        light(1, 0, 800, { cloudCoverPct: 70 }),
        light(2, 0, 800, { cloudCoverPct: 30 }),
      ],
      refs,
    );
    expect(hours.map((h) => h.verdict)).toEqual(['thin', 'cloudy', 'thin']);
  });

  it('ohne Bezug (zu wenige Lights) und ohne Wolkenwert: keine Stunde', () => {
    expect(clarityByHour([light(0, 0, 800)], [{ ...refs[0], n: 2 } as (typeof refs)[0]])).toEqual(
      [],
    );
  });
});

describe('Filter-Offsets', () => {
  // Wahr: L 2020, G 2020, R 2065, B 2060 bei 10 °C, Drift −5 Schritte/°C.
  const truth: Record<string, number> = { LUMINOS: 2020, GREEN: 2020, RED: 2065, BLUE: 2060 };
  const runs: FocusRun[] = [];
  const temps = [14, 12, 10, 8, 6];
  for (const [f, p] of Object.entries(truth))
    temps.forEach((t, i) => {
      const noise = [2, -1, 0, 1, -2][i] ?? 0;
      runs.push({ filter: f, position: p - 5 * (t - 10) + noise, temperatureC: t });
    });

  it('gemeinsame Steigung, Offsets zum L-Filter', () => {
    const r = focusOffsets(runs, 'LUMINOS');
    expect(r.reference).toBe('LUMINOS');
    expect(r.slopePerC).toBeCloseTo(-5, 0);
    const off = Object.fromEntries(r.filters.map((f) => [f.filter, f.offset]));
    expect(off).toEqual({ BLUE: 40, GREEN: 0, LUMINOS: 0, RED: 45 });
    expect(r.totalRuns).toBe(20);
  });

  it('zu wenig Läufe → kein Offset; ohne Bezugsfilter der mit den meisten Läufen', () => {
    const few = [
      ...runs.filter((x) => x.filter !== 'BLUE'),
      { filter: 'BLUE', position: 2060, temperatureC: 10 },
    ];
    const r = focusOffsets(few, 'SII');
    expect(r.filters.find((f) => f.filter === 'BLUE')?.offset).toBeNull();
    expect(r.reference).not.toBeNull();
  });

  it('ohne Temperaturspanne: Steigung null, Offset = Differenz der Mittelwerte', () => {
    const flat = [2000, 2002, 1998].flatMap((p) => [
      { filter: 'L', position: p, temperatureC: 10 },
      { filter: 'R', position: p + 45, temperatureC: 10 },
    ]);
    const r = focusOffsets(flat, 'L');
    expect(r.slopePerC).toBeNull();
    expect(r.filters.find((f) => f.filter === 'R')?.offset).toBe(45);
  });
});
