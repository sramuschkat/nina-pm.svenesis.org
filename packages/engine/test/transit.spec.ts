/**
 * Transitrechnung (AP-41, transit.md §2/§4): BJD_TDB → UTC gegen astropy (`tools/reference/gen_transits.py`,
 * `light_travel_time(kind='barycentric')`, de432s), Fenster, Puffer, Ephemeridenalter, Beobachtbarkeit.
 * Toleranz der Transitmitte ±1 s (transit.md, AST-T8); der Brief verlangt ±10 s.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  bjdTdbToJdUtc,
  createTransitSkyCache,
  defaultBaselineMin,
  ephemerisAge,
  jdFromUnix,
  jdUtcToBjdTdb,
  LEAP_TABLE,
  precessFromJ2000,
  predictTransits,
  romerDelayS,
  sunAt,
  targetAt,
  taiMinusUtc,
  unixFromJd,
  type TransitEphemeris,
  type TransitSearchInput,
} from '../src';

interface Case {
  id: string;
  planet: string;
  raDeg: number;
  decDeg: number;
  n: number;
  tcBjdTdb: number;
  tcUnixUtc: number;
  lttS: number;
  tdbMinusUtcS: number;
  sunAltDeg: number;
  targetAltDeg: number;
}

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/transits.json', import.meta.url)), 'utf8'),
) as { lat: number; lon: number; cases: Case[] };
const SITE = { latDeg: fixture.lat, lonDeg: fixture.lon };
const DURATION_H: Record<string, number> = { 'hat-p-17b': 4.04, 'wasp-12b': 3.0, 'tres-3b': 1.36 };

/** HAT-P-17 b aus ExoClock (29.09.2026). */
const HAT: TransitEphemeris = {
  t0BjdTdb: 2457168.694753,
  periodD: 10.33853486,
  t0SigmaD: 5.2e-5,
  periodSigmaD: 4e-7,
  durationH: 4.04,
  ocMin: null,
  ocSigmaMin: null,
  timeSystem: 'bjd_tdb',
  raDeg: 324.5363796,
  decDeg: 30.4887347,
};

/** Suche über ±12 h um eine Zeit (Unix s). */
const around = (
  e: TransitEphemeris,
  tUtc: number,
  over: Partial<TransitSearchInput> = {},
): TransitSearchInput => ({
  ephemeris: e,
  site: SITE,
  nightStartUtc: tUtc - 12 * 3600,
  nightEndUtc: tUtc + 12 * 3600,
  twilightDeg: -12,
  minAltDeg: 30,
  ...over,
});

describe('BJD_TDB → JD_UTC gegen astropy (21 Transits, 3 Planeten, 13 Monate)', () => {
  it('Fixture deckt ≥ 5 Epochen je Planet und beide Vorzeichen des Rømer-Terms ab', () => {
    for (const p of ['hat-p-17b', 'wasp-12b', 'tres-3b']) {
      const cases = fixture.cases.filter((c) => c.planet === p);
      expect(cases.length).toBeGreaterThanOrEqual(5);
      expect(cases.some((c) => c.lttS > 0) && cases.some((c) => c.lttS < 0)).toBe(true);
    }
  });

  for (const c of fixture.cases) {
    it(`${c.id}: Mitte ±1 s, Rømer ±0,1 s`, () => {
      const r = bjdTdbToJdUtc(c.tcBjdTdb, c.raDeg, c.decDeg);
      expect(Math.abs(unixFromJd(r.jdUtc) - c.tcUnixUtc)).toBeLessThan(1);
      expect(Math.abs(unixFromJd(r.jdUtc) - c.tcUnixUtc)).toBeLessThan(0.1); // Ziel 0,2 s (AST-T15)
      expect(Math.abs(romerDelayS(c.tcBjdTdb, c.raDeg, c.decDeg) - c.lttS)).toBeLessThan(0.1);
      // Umkehrung
      expect(Math.abs(jdUtcToBjdTdb(r.jdUtc, c.raDeg, c.decDeg) - c.tcBjdTdb) * 86400).toBeLessThan(
        1e-3,
      );
    });
  }
});

describe('Skalen-Gegenprobe (AST-T1): Fenster in UTC, nicht in BJD_TDB', () => {
  for (const c of fixture.cases) {
    it(c.id, () => {
      const e = { ...HAT, ...ephemerisOf(c), durationH: DURATION_H[c.planet] ?? 3 };
      const [ev] = predictTransits(around(e, c.tcUnixUtc)).filter((x) => x.n === c.n);
      if (!ev) throw new Error('Transit nicht gefunden');
      const bjdStart =
        c.tcBjdTdb - e.durationH / 48 - ev.bufferS / 86400 - ev.baselineBeforeMin / 1440;
      const diffS = unixFromJd(bjdStart) - ev.windowStartUtc;
      // BJD − UTC = ltt + (TDB − UTC); Fensterbeginn nach unten gerundet (< 1 s).
      expect(Math.abs(diffS - (c.lttS + c.tdbMinusUtcS))).toBeLessThan(1.1);
    });
  }

  it('Beispielnacht 2026-09-18 04:30Z, HAT-P-17 b, Starfront: JD_UTC − BJD_TDB = −431,41 s', () => {
    const jdUtc = jdFromUnix(Date.UTC(2026, 8, 18, 4, 30) / 1000);
    const bjd = jdUtcToBjdTdb(jdUtc, HAT.raDeg, HAT.decDeg);
    expect((jdUtc - bjd) * 86400).toBeCloseTo(-431.41, 0);
    expect(romerDelayS(bjd, HAT.raDeg, HAT.decDeg)).toBeCloseTo(362.23, 0);
  });
});

describe('Bezugsrahmen der Zielrichtung (AST-T6)', () => {
  it('J2000 trifft astropy, die präzessierte Richtung liegt Sekunden daneben', () => {
    const c = fixture.cases.find((x) => x.planet === 'wasp-12b') as Case;
    const j2000 = romerDelayS(c.tcBjdTdb, c.raDeg, c.decDeg);
    const date = precessFromJ2000(c.raDeg, c.decDeg, c.tcBjdTdb);
    const ofDate = romerDelayS(c.tcBjdTdb, date.raDeg, date.decDeg);
    expect(Math.abs(j2000 - c.lttS)).toBeLessThan(0.05);
    // 2026 bei WASP-12 b ≈ 0,7 s, im ungünstigsten Fall bis 3,2 s (transit.md §1) – weit über dem Fehlerbudget.
    expect(Math.abs(ofDate - j2000)).toBeGreaterThan(0.3);
  });
});

describe('Beobachtbarkeit zur Mitte gegen astropy (Sonne geometrisch, Ziel scheinbar)', () => {
  for (const c of fixture.cases) {
    it(c.id, () => {
      expect(Math.abs(sunAt(c.tcUnixUtc, SITE).altDeg - c.sunAltDeg)).toBeLessThan(0.02);
      const t = targetAt({ raJ2000Deg: c.raDeg, decJ2000Deg: c.decDeg }, c.tcUnixUtc, SITE);
      expect(Math.abs(t.altDeg - c.targetAltDeg)).toBeLessThan(0.02);
      const e = { ...HAT, ...ephemerisOf(c), durationH: DURATION_H[c.planet] ?? 3 };
      const [ev] = predictTransits(around(e, c.tcUnixUtc)).filter((x) => x.n === c.n);
      const expected = c.sunAltDeg < -12 && c.targetAltDeg >= 30;
      // Nur eindeutige Fälle (nicht an der Grenze) – σ ist bei allen drei Planeten klein.
      if (Math.abs(c.sunAltDeg + 12) > 1 && Math.abs(c.targetAltDeg - 30) > 1)
        expect(ev?.observable).toBe(expected);
    });
  }
});

function ephemerisOf(c: Case): Partial<TransitEphemeris> {
  const e: Record<string, Partial<TransitEphemeris>> = {
    'hat-p-17b': {},
    'wasp-12b': {
      t0BjdTdb: 2457368.4973,
      periodD: 1.091418859,
      t0SigmaD: 5e-5,
      periodSigmaD: 1e-8,
    },
    'tres-3b': {
      t0BjdTdb: 2457657.754796,
      periodD: 1.306186314,
      t0SigmaD: 5e-5,
      periodSigmaD: 1e-8,
    },
  };
  return { ...e[c.planet], raDeg: c.raDeg, decDeg: c.decDeg };
}

describe('Schaltsekunden (AST-T14)', () => {
  it('streng nach Datum sortiert, Schritte ±1 s', () => {
    for (let i = 1; i < LEAP_TABLE.length; i += 1) {
      const [prevJd, prev] = LEAP_TABLE[i - 1] as readonly [number, number];
      const [jd, value] = LEAP_TABLE[i] as readonly [number, number];
      expect(jd).toBeGreaterThan(prevJd);
      expect([1, -1]).toContain(value - prev);
    }
  });

  it('unmittelbar vor und nach jedem Sprung ab 1999', () => {
    for (const [jd, value] of LEAP_TABLE.filter(([j]) => j >= 2451179.5)) {
      expect(taiMinusUtc(jd - 1e-6).seconds).toBe(value - 1);
      expect(taiMinusUtc(jd).seconds).toBe(value);
    }
  });
});

/** Transitmitte HAT-P-17 b nahe 2026-09-18 aus der Fixture. */
const HAT_TC = (fixture.cases.find((c) => c.id === 'hat-p-17b@2026-09-18') as Case).tcUnixUtc;

describe('Fenster, Puffer, O−C, Baseline (transit.md §2)', () => {
  const t = HAT_TC;

  it('Baseline dauerabhängig: 1,36 h → 41 min, 4,04 h → 120 min, 6 h → 120 min, kurz → 30 min', () => {
    expect(defaultBaselineMin(1.36)).toBe(41);
    expect(defaultBaselineMin(4.04)).toBe(120);
    expect(defaultBaselineMin(6)).toBe(120);
    expect(defaultBaselineMin(0.5)).toBe(30);
  });

  it('Fenster = Kontakte ± Puffer ± Baseline; Puffer-Untergrenze 5 min', () => {
    const [ev] = predictTransits(around(HAT, t));
    if (!ev) throw new Error('kein Transit');
    expect(ev.bufferS).toBe(300);
    expect(ev.baselineBeforeMin).toBe(120);
    expect(ev.egressUtc - ev.ingressUtc).toBeCloseTo(4.04 * 3600, -1);
    expect(ev.ingressUtc - ev.windowStartUtc).toBeGreaterThanOrEqual(300 + 7200);
    expect(ev.ingressUtc - ev.windowStartUtc).toBeLessThanOrEqual(300 + 7200 + 1);
    expect(ev.windowEndUtc - ev.egressUtc).toBeGreaterThanOrEqual(300 + 7200);
  });

  it('σ wächst linear mit |n| und enthält ocSigmaMin', () => {
    const e = { ...HAT, periodSigmaD: 1e-4, t0SigmaD: 1e-3, ocSigmaMin: 2 };
    const [a] = predictTransits(around(e, t));
    const [b] = predictTransits(around(e, t + 10 * HAT.periodD * 86400));
    if (!a || !b) throw new Error('kein Transit');
    expect(b.n - a.n).toBe(10);
    const expectedA = (Math.abs(a.n) * 1e-4 + 1e-3) * 86400 + 120;
    expect(a.sigmaS).toBeCloseTo(expectedA, -1);
    expect(b.sigmaS - a.sigmaS).toBeCloseTo(10 * 1e-4 * 86400 * Math.sign(a.n), -1);
  });

  it('O−C nur bei |ocMin| > 3·ocSigmaMin', () => {
    const base = predictTransits(around(HAT, t))[0];
    const small = predictTransits(around({ ...HAT, ocMin: 2, ocSigmaMin: 1 }, t))[0];
    const big = predictTransits(around({ ...HAT, ocMin: 4, ocSigmaMin: 1 }, t))[0];
    if (!base || !small || !big) throw new Error('kein Transit');
    expect(small.ocAppliedMin).toBeNull();
    expect(small.tcUtc).toBe(base.tcUtc);
    expect(big.ocAppliedMin).toBe(4);
    expect(big.tcUtc - base.tcUtc).toBeCloseTo(240, -1);
  });

  it('Zeitsystem unknown: Fenster je Seite 10 min breiter', () => {
    const known = predictTransits(around(HAT, t))[0];
    const unknown = predictTransits(around({ ...HAT, timeSystem: 'unknown' }, t))[0];
    if (!known || !unknown) throw new Error('kein Transit');
    expect(unknown.timeSystemUncertain).toBe(true);
    expect(known.windowStartUtc - unknown.windowStartUtc).toBeGreaterThanOrEqual(599);
    expect(known.windowStartUtc - unknown.windowStartUtc).toBeLessThanOrEqual(601);
    expect(unknown.windowEndUtc - known.windowEndUtc).toBeGreaterThanOrEqual(599);
    expect(unknown.windowEndUtc - known.windowEndUtc).toBeLessThanOrEqual(601);
  });
});

describe('Ephemeridenalter (AST-T9)', () => {
  it('Klassen aus k·σ und T14', () => {
    expect(ephemerisAge(10, 2)).toBe('ok');
    expect(ephemerisAge(40, 2)).toBe('uncertain'); // ≤ 0,5·T14 (60 min), aber > 30 min
    expect(ephemerisAge(80, 2)).toBe('uncertain');
    expect(ephemerisAge(121, 2)).toBe('stale');
  });

  it('TESS-Kandidat (σP = 1e-4 d, σT0 = 1e-3 d, P = 3 d, T14 = 2 h): 1 Jahr 19 min, 3 Jahre 54 min, 10 Jahre 177 min', () => {
    const toi: TransitEphemeris = {
      ...HAT,
      t0BjdTdb: 2461000.5,
      periodD: 3,
      t0SigmaD: 1e-3,
      periodSigmaD: 1e-4,
      durationH: 2,
    };
    // Suche um die Transitmitte der Epoche `n` (BJD ≈ UTC auf Minuten, das Suchfenster ist ±12 h).
    const at = (n: number) => {
      const ev = predictTransits(
        around(toi, (toi.t0BjdTdb + n * toi.periodD - 2440587.5) * 86400),
      ).find((x) => x.n === n);
      if (!ev) throw new Error(`kein Transit n = ${String(n)}`);
      return ev;
    };
    const year = at(122);
    const three = at(367);
    const decade = at(1217);
    expect(year.sigmaS / 60).toBeCloseTo(19, 0);
    expect(year.ephemerisAge).toBe('ok');
    expect(three.sigmaS / 60).toBeCloseTo(54, 0);
    expect(three.ephemerisAge).toBe('uncertain');
    // Warnung: Baseline mindestens k·σ (hier bleibt die Vorgabe 60 min, weil sie größer ist als 54 min).
    expect(three.baselineBeforeMin).toBeGreaterThanOrEqual(Math.floor(three.sigmaS / 60));
    expect(decade.sigmaS / 60).toBeCloseTo(177, 0);
    expect(decade.ephemerisAge).toBe('stale');
  });
});

describe('Sehr unsichere Ephemeride (Fehler prod 30.09.2026)', () => {
  it('Puffer von Tagen: wenige Kandidaten, schnell, „stale“, Anteil nur über die Nacht geprüft', () => {
    const vague: TransitEphemeris = {
      ...HAT,
      periodD: 1.2,
      t0BjdTdb: 2457000.5,
      t0SigmaD: 0.01,
      // σ nach ~3000 Umläufen ≈ 30 Tage
      periodSigmaD: 0.01,
      durationH: 2,
    };
    const started = performance.now();
    const ev = predictTransits(around(vague, HAT_TC));
    expect(performance.now() - started).toBeLessThan(2000);
    // Suchbereich ±(T14/2 + höchstens T14 + Baseline) um die Nacht: nicht jeder Umlauf der Umgebung
    expect(ev.length).toBeGreaterThan(0);
    expect(ev.length).toBeLessThanOrEqual(25);
    for (const x of ev) {
      expect(x.ephemerisAge).toBe('stale');
      expect(x.usableFraction).toBeGreaterThanOrEqual(0);
      expect(x.usableFraction).toBeLessThan(0.1);
      expect(x.windowEndUtc - x.windowStartUtc).toBeGreaterThan(30 * 86400);
    }
  });
});

describe('Ultrakurzperiode und Beobachtbarkeit im Fenster', () => {
  it('P = 0,3 d: mehrere Transits in einer Nacht, alle gefunden', () => {
    const usp = { ...HAT, periodD: 0.3, durationH: 1 };
    // 16 h: zwei Transits im Abstand von 7,2 h sind in jeder Phasenlage enthalten.
    const night = {
      start: Date.UTC(2026, 8, 17, 20) / 1000,
      end: Date.UTC(2026, 8, 18, 12) / 1000,
    };
    const ev = predictTransits({
      ephemeris: usp,
      site: SITE,
      nightStartUtc: night.start,
      nightEndUtc: night.end,
      twilightDeg: -12,
      minAltDeg: 30,
    });
    expect(ev.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < ev.length; i += 1)
      expect((ev[i]?.tcUtc ?? 0) - (ev[i - 1]?.tcUtc ?? 0)).toBeCloseTo(0.3 * 86400, -1);
  });

  it('Anteil nutzbarer Slots, Start/Ende, Meridian, gemeinsamer Zwischenspeicher', () => {
    const cache = createTransitSkyCache(SITE);
    const t = HAT_TC;
    const a = predictTransits(around(HAT, t), cache);
    const b = predictTransits(around(HAT, t), cache);
    expect(b).toEqual(a);
    const ev = a[0];
    if (!ev) throw new Error('kein Transit');
    expect(ev.usableFraction).toBeGreaterThanOrEqual(0);
    expect(ev.usableFraction).toBeLessThanOrEqual(1);
    expect(ev.fullyObservable).toBe(ev.usableFraction === 1);
    // „Start/Ende“ der Filter = Ingress − 1 h / Egress + 1 h (Entscheidung Sven 30.09.2026, FA-EXO-19)
    const at0 = (u: number) =>
      targetAt({ raJ2000Deg: HAT.raDeg, decJ2000Deg: HAT.decDeg }, u, SITE).altDeg;
    expect(ev.startDark).toBe(sunAt(ev.ingressUtc - 3600, SITE).altDeg < -12);
    expect(ev.endDark).toBe(sunAt(ev.egressUtc + 3600, SITE).altDeg < -12);
    expect(ev.startAboveMinAlt).toBe(at0(ev.ingressUtc - 3600) >= 30);
    expect(ev.endAboveMinAlt).toBe(at0(ev.egressUtc + 3600) >= 30);
    if (ev.meridianUtc !== null)
      expect(ev.meridianNearTransit).toBe(
        ev.meridianUtc >= ev.ingressUtc - 3600 && ev.meridianUtc <= ev.egressUtc + 3600,
      );
    // Kontakt-Höhen gegen die Höhenfunktion der Engine
    const at = (t: number) =>
      targetAt({ raJ2000Deg: HAT.raDeg, decJ2000Deg: HAT.decDeg }, t, SITE).altDeg;
    expect(Math.abs(ev.altAtIngressDeg - at(ev.ingressUtc))).toBeLessThan(0.01);
    expect(Math.abs(ev.altAtEgressDeg - at(ev.egressUtc))).toBeLessThan(0.01);
    if (ev.meridianUtc !== null)
      expect(ev.meridianInWindow).toBe(
        ev.meridianUtc >= ev.windowStartUtc && ev.meridianUtc <= ev.windowEndUtc,
      );
  });

  it('rein und deterministisch: gleiche Eingabe, gleiche Ausgabe; keine Suche ohne Periode', () => {
    const t = HAT_TC;
    expect(predictTransits(around(HAT, t))).toEqual(predictTransits(around(HAT, t)));
    expect(predictTransits(around({ ...HAT, periodD: 0 }, t))).toEqual([]);
  });
});
