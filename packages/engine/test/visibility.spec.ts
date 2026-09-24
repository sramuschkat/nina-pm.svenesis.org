/**
 * AP-10: `moonSafe` (moon.md Grenzfall-Tabelle, Restriktivität), `buildNightContext`,
 * `buildEligibility` (Dämmerung, Mindesthöhe, Startdatum, Mond je Zeile, Vorfilter AST-N11) und
 * Zielhöhen gegen die astropy-Fixture.
 */
import { describe, expect, it } from 'vitest';
import {
  buildEligibility,
  buildNightContext,
  culminationVisibility,
  moonSafe,
  requiredSeparationDeg,
  restrictiveness,
  type MoonProfile,
  type TimeZoneTransition,
} from '../src/index';
import targets from './fixtures/targets.json';

const profile = (p: Partial<MoonProfile>): MoonProfile => ({
  separationDeg: 0,
  widthDays: 0,
  relaxScale: 0,
  moonMinAltDeg: -15,
  moonMaxAltDeg: 5,
  maxIlluminationPct: 0,
  moonMustBeDown: false,
  ...p,
});

/** Mitgelieferte Profile (moon.md §Built-in-Profile). */
const NONE = profile({
  separationDeg: 180,
  widthDays: 14,
  moonMinAltDeg: -90,
  moonMaxAltDeg: -2,
  moonMustBeDown: true,
});
const STRICT = profile({ separationDeg: 90, widthDays: 8, maxIlluminationPct: 30 });
const MODERATE = profile({
  separationDeg: 60,
  widthDays: 5,
  relaxScale: 2,
  maxIlluminationPct: 60,
});
const RELAXED = profile({ separationDeg: 25, widthDays: 3, relaxScale: 3, maxIlluminationPct: 80 });

describe('moonSafe – Grenzfall-Tabelle (moon.md, Pflicht)', () => {
  const rows: [string, MoonProfile, number, number, number, number, number | null, boolean][] = [
    ['Streng, Stufe 4', STRICT, 30, 40, 5, 50, 64.72, false],
    ['Streng, Relaxierung f = 0,85', STRICT, 2, 40, 5, 70, 58.42, true],
    ['Moderat, Relaxierung f = 0,775', MODERATE, 0.5, 70, 2, 38, 40.27, false],
    ['Moderat, Stufe 4', MODERATE, 20, 65, 2, 52, 51.72, true],
    ['Entspannt, Vollmond', RELAXED, 10, 95, 0, 25, 25.0, true],
    ['Entspannt, knapp', RELAXED, 2, 90, 1, 13, 13.87, false],
    ['Streng, Stufe 3 unter A_floor', STRICT, 10, 30, 3, 10, null, false],
    ['Streng, Stufe 3 sicher', STRICT, 30, 20, 5, 50, null, true],
    ['Moderat, Stufe 1 (0,0°)', MODERATE, 0, 99, 0, 5, null, true],
    ['Streng, Stufe 1 (−0,1°)', STRICT, -0.1, 99, 0, 5, null, true],
    ['Kein Mond, 0,5°', NONE, 0.5, 1, 14, 170, null, false],
    ['Kein Mond, 0,0°', NONE, 0, 100, 0, 10, null, true],
  ];
  it.each(rows)('%s', (_name, p, alt, illum, d, sep, required, expected) => {
    expect(moonSafe(p, { moonAltDeg: alt, illumPct: illum, phaseDays: d, sepDeg: sep })).toBe(
      expected,
    );
    if (required !== null) expect(requiredSeparationDeg(p, alt, d)).toBeCloseTo(required, 2);
  });

  it('Kein Mond: sicher genau bis 0° (Entscheidung 24.09.2026, wie MoonDown), maxAlt −2° wirkt nicht', () => {
    const at = (alt: number) =>
      moonSafe(NONE, { moonAltDeg: alt, illumPct: 0, phaseDays: 14, sepDeg: 180 });
    expect([at(-2.5), at(-1), at(0), at(0.000001)]).toEqual([true, true, true, false]);
  });

  it('Rundung auf 1e-6 vor dem Vergleich: 64,7249…° gefordert gilt für sep = 64,72492…', () => {
    const req = requiredSeparationDeg(STRICT, 30, 5);
    const state = (sep: number) => ({ moonAltDeg: 30, illumPct: 40, phaseDays: 5, sepDeg: sep });
    expect(moonSafe(STRICT, state(req))).toBe(true);
    expect(moonSafe(STRICT, state(req - 2e-6))).toBe(false);
  });

  it('Breite_eff = 0 → gefordert 0 (sicher)', () => {
    const p = profile({ separationDeg: 90, widthDays: 0, maxIlluminationPct: 0 });
    expect(requiredSeparationDeg(p, 30, 0)).toBe(0);
    expect(moonSafe(p, { moonAltDeg: 30, illumPct: 100, phaseDays: 0, sepDeg: 1 })).toBe(true);
  });
});

describe('Restriktivität (moon.md, AST-M3)', () => {
  it('Built-ins: Kein Mond ∞, Streng 773,6, Moderat 373,3, Entspannt 102,8', () => {
    expect(restrictiveness(NONE)).toBe(Number.POSITIVE_INFINITY);
    expect(restrictiveness(STRICT)).toBeCloseTo(773.6, 1);
    expect(restrictiveness(MODERATE)).toBeCloseTo(373.3, 1);
    expect(restrictiveness(RELAXED)).toBeCloseTo(102.8, 1);
  });

  it('Gegenbeispiel der Altformel: X (40°, 14 d) = 454,7 ist strenger als Y (60°, 1 d) = 90,2', () => {
    const x = profile({ separationDeg: 40, widthDays: 14, maxIlluminationPct: 50 });
    const y = profile({ separationDeg: 60, widthDays: 1, maxIlluminationPct: 50 });
    // moon.md nennt 454,7; mit 14,77 d exakt 454,81 (die Angabe ist gerundet) – die Ordnung zählt.
    expect(Math.abs(restrictiveness(x) - 454.7)).toBeLessThan(0.2);
    expect(restrictiveness(x)).toBeGreaterThan(restrictiveness(y));
    expect(restrictiveness(y)).toBeCloseTo(90.2, 1);
    expect(restrictiveness(profile({ separationDeg: 60, widthDays: 0 }))).toBe(0);
  });
});

/** America/Chicago 2026: Sommerzeit ab 08.03., Winterzeit ab 01.11. */
const CHICAGO: TimeZoneTransition[] = [
  { atUtc: Date.UTC(2025, 10, 2, 7) / 1000, utcOffsetMinutes: -360 },
  { atUtc: Date.UTC(2026, 2, 8, 8) / 1000, utcOffsetMinutes: -300 },
  { atUtc: Date.UTC(2026, 10, 1, 7) / 1000, utcOffsetMinutes: -360 },
];
const STARFRONT = { latDeg: 31.5471, lonDeg: -99.3823 };
const NGC281 = { raJ2000Deg: 13.2458, decJ2000Deg: 56.6194 };

describe('buildNightContext (allocation.md §2, night.md §3)', () => {
  const ctx = buildNightContext({
    site: STARFRONT,
    night: '2026-09-17',
    timeZoneTransitions: CHICAGO,
  });

  it('Starfront 2026-09-17: 156 Slots, Grenzen 00:00Z … 13:00Z, Sonne und Mond je Grenze', () => {
    expect(ctx.slotCount).toBe(156);
    expect(ctx.boundaryUtc).toHaveLength(157);
    expect(ctx.boundaryUtc[0]).toBe(Date.UTC(2026, 8, 18, 0) / 1000);
    expect(ctx.boundaryUtc[156]).toBe(Date.UTC(2026, 8, 18, 13) / 1000);
    expect(ctx.sunAltDeg).toHaveLength(157);
    expect(ctx.moon).toHaveLength(157);
    expect(ctx.moonDown).toHaveLength(156);
  });

  it('MoonDown gilt nur, wenn der Mond zu Beginn und Ende des Slots ≤ 0° steht', () => {
    ctx.moonDown.forEach((down, s) => {
      const both = (ctx.moon[s]?.altDeg ?? 1) <= 0 && (ctx.moon[s + 1]?.altDeg ?? 1) <= 0;
      expect(down, `Slot ${String(s)}`).toBe(both);
    });
  });

  it('ohne Mond (Saisonsuche): keine Mondwerte, kein MoonDown', () => {
    const light = buildNightContext({
      site: STARFRONT,
      night: '2026-09-17',
      timeZoneTransitions: CHICAGO,
      includeMoon: false,
    });
    expect(light.moon).toHaveLength(0);
    expect(light.moonDown.every((d) => !d)).toBe(true);
  });
});

describe('buildEligibility (allocation.md §3.1/§3.3, FK 8.1)', () => {
  const ctx = buildNightContext({
    site: STARFRONT,
    night: '2026-09-17',
    timeZoneTransitions: CHICAGO,
  });

  it('NGC 281 astronomisch ab 30°: nutzbar genau dort, wo Sonne < −18° und Höhe ≥ 30° an beiden Grenzen', () => {
    const e = buildEligibility(ctx, { target: NGC281, twilight: 'astronomical', minAltDeg: 30 });
    expect(e.visibility).toBe('normal');
    e.canImage.forEach((ok, s) => {
      const at = (k: number) =>
        (ctx.sunAltDeg[k] as number) < -18 && (e.targetAltDeg[k] as number) >= 30;
      expect(ok, `Slot ${String(s)}`).toBe(at(s) && at(s + 1));
    });
    expect(e.usableSlots).toBeGreaterThan(90);
    expect(e.longestRunSlots).toBe(e.usableSlots);
    expect(e.peakAltDeg).toBeGreaterThan(60);
    // Kulminationshöhe 90° − |φ − δ| (δ zum Datum ≈ 56,75°) plus Refraktion (< 0,03° bei 65°).
    expect(e.peakAltDeg).toBeLessThanOrEqual(90 - Math.abs(31.5471 - 56.8) + 0.1);
  });

  it('nautisch ist nie kürzer als astronomisch; Startdatum nach der Nacht sperrt alles', () => {
    const astro = buildEligibility(ctx, {
      target: NGC281,
      twilight: 'astronomical',
      minAltDeg: 30,
    });
    const naut = buildEligibility(ctx, { target: NGC281, twilight: 'nautical', minAltDeg: 30 });
    expect(naut.usableSlots).toBeGreaterThan(astro.usableSlots);
    const later = buildEligibility(ctx, {
      target: NGC281,
      twilight: 'nautical',
      minAltDeg: 30,
      startDate: '2026-09-18',
    });
    expect(later.usableSlots).toBe(0);
    const same = buildEligibility(ctx, {
      target: NGC281,
      twilight: 'nautical',
      minAltDeg: 30,
      startDate: '2026-09-17',
    });
    expect(same.usableSlots).toBe(naut.usableSlots);
  });

  it('Zeilen: ohne Profil immer sicher, „Kein Mond“ genau bei MoonDown, Streng ⊆ Moderat', () => {
    const e = buildEligibility(ctx, {
      target: NGC281,
      twilight: 'astronomical',
      minAltDeg: 30,
      lines: [
        { id: 'l', moonProfile: null },
        { id: 'none', moonProfile: NONE },
        { id: 'strict', moonProfile: STRICT },
        { id: 'moderate', moonProfile: MODERATE },
      ],
    });
    const [free, none, strict, moderate] = e.lines;
    expect(free?.safe.every(Boolean)).toBe(true);
    expect(none?.safe).toEqual(ctx.moonDown);
    strict?.safe.forEach((ok, s) => {
      if (ok) expect(moderate?.safe[s], `Slot ${String(s)}`).toBe(true);
    });
  });

  it('Vorfilter AST-N11: M8 an der VSW Hannover bei 30° nie sichtbar – ohne Rasterlauf', () => {
    expect(culminationVisibility(52.3705, -24.3867, 30)).toBe('never');
    expect(culminationVisibility(52.3705, 89.2641, 30)).toBe('circumpolar');
    expect(culminationVisibility(52.3705, 41.269, 30)).toBe('normal');
    const hannover = buildNightContext({
      site: { latDeg: 52.3705, lonDeg: 9.7332 },
      night: '2026-09-17',
      timeZoneTransitions: [{ atUtc: 1774746000, utcOffsetMinutes: 120 }],
    });
    const m8 = buildEligibility(hannover, {
      target: { raJ2000Deg: 270.9042, decJ2000Deg: -24.3867 },
      twilight: 'nautical',
      minAltDeg: 30,
    });
    expect([m8.visibility, m8.usableSlots, m8.targetAltDeg.length]).toEqual(['never', 0, 0]);
  });
});

describe('Zielhöhen gegen astropy (targets.json, TK 9.2)', () => {
  interface Fixture {
    target: string;
    site: string;
    night: string;
    raJ2000Deg: number;
    decJ2000Deg: number;
    samples: { t: number; altAppDeg: number }[];
  }
  const fixture = (targets as { targets: Fixture[] }).targets.find(
    (f) => f.target === 'ngc281' && f.site === 'starfront' && f.night === '2026-09-17',
  );

  it('NGC 281, Starfront 2026-09-17: scheinbare Höhe an gemeinsamen Grenzen ±0,05° (über 15°)', () => {
    if (!fixture) throw new Error('Fixture fehlt');
    const ctx = buildNightContext({
      site: STARFRONT,
      night: '2026-09-17',
      timeZoneTransitions: CHICAGO,
      includeMoon: false,
    });
    const e = buildEligibility(ctx, { target: fixture, twilight: 'civil', minAltDeg: 0 });
    let compared = 0;
    for (const sample of fixture.samples) {
      const k = ctx.boundaryUtc.indexOf(sample.t);
      if (k < 0 || sample.altAppDeg < 15) continue;
      expect(Math.abs((e.targetAltDeg[k] as number) - sample.altAppDeg)).toBeLessThanOrEqual(0.05);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(20);
  });
});
