/**
 * Positivliste aus `legacy/astro-tools-2026-09-21/tools/verify-planner.js` (TK 9.2, WS-22) – jede
 * Prüfung mit Fundstelle im Stand 21.09.2026. Die Dunkelheit am Pol (`:472`) steht in night.spec.ts.
 *
 * **Negativliste (WS-23) – bewusst nicht übernommen:**
 * - `:110` „unter dem Horizont keine Refraktion“ – widerspricht moon.md/WS-20; konform ist
 *   refract(−5°) = −4,3534° (moon.spec.ts prüft genau das).
 * - `:105` schreibt Bennett zu, was die Saemundsson-Umkehrung ist (34,43′ statt 34,48′).
 * - `:476` Rundlaufbereich der Refraktion unterhalb −1° – prüft den abgeschnittenen Zweig.
 * - `:391` `usableHours` (linke Riemannsumme, festes 30°-Tor) – NINA-PM rechnet `estimateEffort` (effort.md).
 * - `:393` festes Rig-Bildfeld 1,69° – das Bildfeld kommt je Rig aus geometry.md.
 * - Seitenstruktur, Skriptreihenfolge, `?v=`, Bildbestände, HEALPix, Kartenprojektion, Sternbinärdatei,
 *   Doppelsterne, TLE-Alter – Website-Eigenschaften ohne Gegenstück.
 * - `:194-203`, `:320-385` (Katalog) gehören als Importtests zu AP-20, `:637-648` (Wetter) zu AP-23.
 */
import { describe, expect, it } from 'vitest';
import {
  moonApparent,
  norm360,
  nutation,
  precessFromJ2000,
  precessToJ2000,
  separationDeg,
  sunApparent,
  jdeFromUnix,
  unixFromJd,
} from '../src/index';

const RAD = Math.PI / 180;

describe('verify-planner.js:419 – Meeus 47.a (Mond, scheinbar)', () => {
  it('1992-04-12 0h TD: α = 134,688470°, δ = 13,768368° (±0,0006°), Δ = 368.409,7 km (±1 km)', () => {
    const m = moonApparent(2448724.5);
    expect(Math.abs(m.raDeg - 134.68847)).toBeLessThan(0.0006);
    expect(Math.abs(m.decDeg - 13.768368)).toBeLessThan(0.0006);
    expect(Math.abs(m.distanceKm - 368409.7)).toBeLessThan(1);
    // Mit allen 60 Termen von 47.B bleibt δ weit unter der Toleranz (mit 30 Termen 1,94″ von 2,16″).
    expect(Math.abs(m.decDeg - 13.768368) * 3600).toBeLessThan(0.1);
  });
});

describe('verify-planner.js:423 – Meeus 22.a (Nutation und Schiefe)', () => {
  it('1987-04-10 0h TD: Δψ = −3,788″ (±0,5″), Δε = +9,443″ (±0,1″), ε₀ = 23°26′27,407″ (±0,05″)', () => {
    const n = nutation(2446895.5);
    expect(Math.abs(n.dpsiDeg * 3600 + 3.788)).toBeLessThan(0.5);
    expect(Math.abs(n.depsDeg * 3600 - 9.443)).toBeLessThan(0.1);
    expect(Math.abs(n.eps0Deg * 3600 - (23 * 3600 + 26 * 60 + 27.407))).toBeLessThan(0.05);
  });
});

describe('verify-planner.js:428-441 – Mond gegen JPL Horizons (mit ΔT, ±0,01°)', () => {
  /** Horizons, astrometrisch ICRF (J2000), geozentrisch – Zeitpunkte in UT. */
  const HORIZONS: [string, number, number][] = [
    ['2026-09-20T00:00:00Z', 280.166075044, -27.134002192],
    ['2026-09-23T01:00:00Z', 318.649395283, -17.252354223],
    ['2026-09-26T02:00:00Z', 354.453591828, 0.062220232],
    ['2026-09-29T03:00:00Z', 32.865523463, 18.322695208],
    ['2026-10-02T04:00:00Z', 78.922684161, 27.871025964],
    ['2026-10-05T05:00:00Z', 126.028155779, 21.61494211],
    ['2026-10-08T06:00:00Z', 165.632746554, 4.57341077],
    ['2026-10-11T07:00:00Z', 201.714777977, -13.7113262],
    ['2026-10-14T08:00:00Z', 240.072186668, -25.768583056],
    ['2026-10-17T09:00:00Z', 280.656964544, -26.893190315],
  ];
  it.each(HORIZONS)('%s', (iso, ra, dec) => {
    // Produktivpfad: TT = UT + ΔT (jdeFromUnix). Scheinbar zum Datum → mittel (Meeus 23.1) → J2000.
    const jde = jdeFromUnix(Date.parse(iso) / 1000);
    const m = moonApparent(jde);
    const nu = nutation(jde);
    const e = nu.epsDeg * RAD;
    const a = m.raDeg * RAD;
    const d = m.decDeg * RAD;
    const meanRa =
      m.raDeg -
      ((Math.cos(e) + Math.sin(e) * Math.sin(a) * Math.tan(d)) * nu.dpsiDeg -
        Math.cos(a) * Math.tan(d) * nu.depsDeg);
    const meanDec = m.decDeg - (Math.sin(e) * Math.cos(a) * nu.dpsiDeg + Math.sin(a) * nu.depsDeg);
    const j = precessToJ2000(meanRa, meanDec, jde);
    expect(separationDeg(j.raDeg, j.decDeg, ra, dec)).toBeLessThan(0.01);
  });
});

describe('verify-planner.js:96-99 – strenge Präzession', () => {
  it('Rundlauf J2000 → Datum → J2000 über Zufallspunkte < 1e-4″; der Pol bleibt endlich (δ = 89,85°)', () => {
    const jde = jdeFromUnix(Date.parse('2026-09-20T00:00:00Z') / 1000);
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let worst = 0;
    for (let i = 0; i < 5000; i++) {
      const ra = rnd() * 360;
      const dec = (Math.asin(2 * rnd() - 1) * 180) / Math.PI;
      const f = precessFromJ2000(ra, dec, jde);
      const b = precessToJ2000(f.raDeg, f.decDeg, jde);
      worst = Math.max(worst, separationDeg(ra, dec, b.raDeg, b.decDeg));
    }
    expect(worst * 3600).toBeLessThan(1e-4);
    const pole = precessFromJ2000(0, 90, jde);
    expect(Number.isFinite(pole.raDeg)).toBe(true);
    expect(Math.abs(pole.decDeg - 89.85)).toBeLessThan(0.01);
  });
});

describe('verify-planner.js:247-261 – Neu- und Vollmonde gegen USNO (±30 min)', () => {
  const USNO: ['new' | 'full', string][] = [
    ['full', '2026-01-03T10:03:00Z'],
    ['new', '2026-01-18T19:52:00Z'],
    ['full', '2026-02-01T22:09:00Z'],
    ['new', '2026-02-17T12:01:00Z'],
    ['full', '2026-03-03T11:38:00Z'],
    ['new', '2026-03-19T01:23:00Z'],
    ['full', '2026-04-02T02:12:00Z'],
    ['new', '2026-04-17T11:52:00Z'],
    ['new', '2026-09-11T03:27:00Z'],
    ['full', '2026-09-26T16:49:00Z'],
  ];
  /** Ekliptikale Elongation λ_Mond − λ_Sonne (wie `d` in moon.md), Grad in [0, 360). */
  const elong = (unix: number) => {
    const jde = jdeFromUnix(unix);
    return norm360(moonApparent(jde).lambdaDeg - sunApparent(jde).lambdaDeg);
  };
  /** Grobtest-Suche wie in der Vorlage: 6-h-Schritte, dann Bisektion auf 30 s. */
  function nextPhase(from: number, target: number): number {
    const past = (t: number) => norm360(elong(t) - target);
    let a = from;
    let pa = past(a);
    for (let i = 0; i < 130; i++) {
      let b = a + 21600;
      const pb = past(b);
      if (pb < pa) {
        while (b - a > 30) {
          const m = (a + b) / 2;
          if (past(m) > 180) a = m;
          else b = m;
        }
        return b;
      }
      a = b;
      pa = pb;
    }
    throw new Error('keine Phase gefunden');
  }
  it.each(USNO)('%s %s', (kind, iso) => {
    const truth = Date.parse(iso) / 1000;
    const found = nextPhase(truth - 3 * 86400, kind === 'new' ? 0 : 180);
    expect(Math.abs(found - truth) / 60).toBeLessThan(30);
  });
});

it('Hilfsfunktionen: unixFromJd ist die Umkehrung', () => {
  expect(unixFromJd(2440587.5)).toBe(0);
});
