/**
 * Wetterbewertung – Pflicht-Tests aus specs/engine/weather.md §4 (WS-18), soweit sie die Engine betreffen:
 * (c) Aerosol fehlt, (d) Klassengrenzen, (e) Wolkenterm und `windShear`, (f) Rundungskante, (g) Nachtmittel
 * und bestes Fenster, (h) Seeing mit fehlender Scherung, (l) Niederschlag bewertet nichts; dazu die
 * Nacht-Kennzeichen. (a), (b), (i)–(k) betreffen die Stundenaufbereitung (apps/api/test/weather-*.test.ts).
 * Toleranz 1e-6 gegen die sechsstelligen Kontrollwerte, 1e-12 wo die Spezifikation es verlangt.
 */
import { describe, expect, it } from 'vitest';
import {
  bestWindow,
  cloudScore,
  jetKmh,
  nightMean,
  overallScore,
  q,
  RATING_CUTS,
  ratingIndex,
  scoreHour,
  seeingIncomplete,
  seeingScore,
  shearKmh,
  transparencyScore,
  weatherScores,
  windShear,
  type WeatherHourly,
} from '../src';

const near = (a: number | null, b: number, tol = 1e-6) => {
  expect(a).not.toBeNull();
  expect(Math.abs((a as number) - b)).toBeLessThanOrEqual(tol);
};

/** Eine Stunde, alle Felder `null` außer den übergebenen. */
const hour = (over: Partial<WeatherHourly> = {}): WeatherHourly => ({
  tUnix: 1_790_000_000,
  cloudTotalPct: null,
  cloudLowPct: null,
  cloudMidPct: null,
  cloudHighPct: null,
  tempC: null,
  dewPointC: null,
  humidityPct: null,
  wind10Kmh: null,
  gust10Kmh: null,
  windDir10Deg: null,
  wind250Kmh: null,
  windDir250Deg: null,
  wind500Kmh: null,
  windDir500Deg: null,
  wind700Kmh: null,
  windDir700Deg: null,
  wind850Kmh: null,
  windDir850Deg: null,
  surfacePressureHPa: null,
  visibilityM: null,
  precipMm: null,
  precipProbPct: null,
  weatherCode: null,
  aod: null,
  dustUgM3: null,
  pwvMm: null,
  moonAltDeg: null,
  modelId: 'gfs',
  cloudSrc: null,
  nest: false,
  ...over,
});

/** Kontrollwert 3 (§4 c). */
const KW3 = {
  cloudTotalPct: 20,
  wind250Kmh: 90,
  windDir250Deg: 270,
  wind500Kmh: 60,
  wind850Kmh: 30,
  windDir850Deg: 240,
  surfacePressureHPa: 990,
  wind10Kmh: 14,
  humidityPct: 85,
  pwvMm: 18,
} satisfies Partial<WeatherHourly>;

describe('(c) Aerosol fehlt – Kontrollwert 3 (WS-E2)', () => {
  it('mit aod = 0,14', () => {
    const h = scoreHour(hour({ ...KW3, aod: 0.14 }));
    near(h.cloudScore, 0.8);
    near(h.jetKmh, 90);
    near(h.shearKmh, 65.753044);
    near(h.seeingScore, 0.505501);
    near(h.transparencyScore, 0.7);
    expect(h.aerosolMissing).toBe(false);
    near(h.overallScore, 0.563728);
    expect(q(h.overallScore as number, 1e3)).toBe(0.564);
    expect(h.ratingIndex).toBe(2);
  });

  it('ohne Aerosol: keine Transparenz, Gewicht umverteilt, +0,020423', () => {
    const withAod = scoreHour(hour({ ...KW3, aod: 0.14 }));
    const h = scoreHour(hour({ ...KW3, aod: null }));
    expect(h.transparencyScore).toBeNull();
    expect(h.aerosolMissing).toBe(true);
    near(h.overallScore, 0.584151);
    expect(q(h.overallScore as number, 1e3)).toBe(0.584);
    expect(h.ratingIndex).toBe(2);
    near((h.overallScore as number) - (withAod.overallScore as number), 0.020423);
    // Gegenprobe: ein eingesetzter Ersatzwert 0,5 wäre 0,039623 niedriger – die Umverteilung ist keine Kosmetik.
    const substituted = overallScore(0.8, h.seeingScore, 0.5);
    near(substituted, 0.544528);
  });
});

describe('(d) Klassengrenzen (WS-07)', () => {
  it('RATING_CUTS', () => {
    expect(RATING_CUTS).toEqual([0.25, 0.45, 0.65, 0.85]);
  });
  it.each([
    [0.2499, 0],
    [0.25, 1],
    [0.4499, 1],
    [0.45, 2],
    [0.6499, 2],
    [0.65, 3],
    [0.8499, 3],
    [0.85, 4],
    [1.0, 4],
    [null, null],
  ])('ratingIndex(%s) = %s (nach unten inklusiv)', (s, cls) => {
    expect(ratingIndex(s)).toBe(cls);
  });
});

describe('(e) Wolkenterm und windShear – Kontrollwerte 1 und 2', () => {
  it('cloudScore', () => {
    expect(cloudScore(0)).toBe(1);
    expect(cloudScore(50)).toBe(0.5);
    expect(cloudScore(100)).toBe(0);
    expect(cloudScore(null)).toBeNull();
  });
  it('overallScore (Wolken quadratisch, Grundgewicht 0,7)', () => {
    near(overallScore(1, null, null), 1, 1e-12);
    near(overallScore(0.5, null, null), 0.25, 1e-12);
    near(overallScore(1, 1, 1), 1, 1e-12);
    near(overallScore(1, 0, 0), 0.7, 1e-12);
    expect(overallScore(null, 1, 1)).toBeNull();
  });
  it('windShear', () => {
    near(windShear(90, 270, 30, 240), 65.753044);
    near(windShear(100, 270, 40, 270), 60);
    near(windShear(50, 0, 50, 180), 100);
    expect(windShear(90, 270, null, 240)).toBeNull();
  });
  it('Scherungs-Untergrenze nach Bodendruck (850 / 700 / 500 hPa)', () => {
    const w = {
      wind250Kmh: 90,
      windDir250Deg: 270,
      wind500Kmh: 50,
      windDir500Deg: 270,
      wind700Kmh: 40,
      windDir700Deg: 270,
      wind850Kmh: 30,
      windDir850Deg: 270,
    };
    near(shearKmh({ ...w, surfacePressureHPa: null }), 60);
    near(shearKmh({ ...w, surfacePressureHPa: 899 }), 50);
    near(shearKmh({ ...w, surfacePressureHPa: 749 }), 40);
  });
  it('transparencyScore: Wirkbereiche', () => {
    expect(transparencyScore(0.05, null, null)).toBe(1);
    expect(transparencyScore(0.5, null, null)).toBe(0);
    near(transparencyScore(0.05, 100, null), 0.5, 1e-12);
    near(transparencyScore(0.05, null, 47.5), 0.85, 1e-12);
    expect(transparencyScore(0.05, 80, 10)).toBe(1);
  });
});

describe('(f) Determinismus – q(x, 1e3) an der Rundungskante (WS-08)', () => {
  it('0,6494999 → 0,649 → Klasse 2; 0,6495 → 0,65 → Klasse 3; −0,0005 → −0,001', () => {
    expect(q(0.6494999, 1e3)).toBe(0.649);
    expect(ratingIndex(q(0.6494999, 1e3))).toBe(2);
    expect(q(0.6495, 1e3)).toBe(0.65);
    expect(ratingIndex(q(0.6495, 1e3))).toBe(3);
    expect(q(-0.0005, 1e3)).toBe(-0.001);
  });
  it('scoreHour bildet die Klasse aus dem gerundeten Score', () => {
    // c² · 1 = 0,6495 → gerundet 0,65 → Gut.
    const h = scoreHour(hour({ cloudTotalPct: 100 * (1 - Math.sqrt(0.6495)) }));
    expect(h.ratingIndex).toBe(3);
  });
  it('gleiche Eingabe → gleiche Ausgabe', () => {
    const input = { hourly: [hour({ ...KW3, aod: 0.14 })], darkWindows: [] };
    expect(JSON.stringify(weatherScores(input))).toBe(JSON.stringify(weatherScores(input)));
  });
});

// Kontrollwerte 5 und 6: Dunkelheit 21:30 → 04:00 UTC.
const T0 = Date.UTC(2026, 8, 25, 21, 0, 0) / 1000;
const DARK = { night: '2026-09-25', fromUtc: T0 + 1800, toUtc: T0 + 7 * 3600 };
const SCORES = [0.7, 0.8, 0.82, null, 0.66, 0.6, 0.55];
const MOON = [8, 2, -6, -14, -20, -22, -19];
const nightHours = SCORES.map((s, i) => ({
  tUnix: T0 + i * 3600,
  overallScore: s,
  moonAltDeg: MOON[i] ?? null,
}));

describe('(g) Nachtmittel über die Dunkelheit – Kontrollwert 5 (WS-09)', () => {
  it('nightMean 0,687273, coveredSec 19800, coverage 0,846154', () => {
    const m = nightMean(nightHours, DARK);
    expect(m.coveredSec).toBe(19800);
    expect(m.darknessSec).toBe(23400);
    near(m.nightMean, 13608 / 19800);
    near(m.nightMean, 0.687273);
    expect(ratingIndex(q(m.nightMean as number, 1e3))).toBe(3);
    near(m.coverage, 0.846154);
  });
  it('alle Stunden null → nightMean null, coverage 0', () => {
    const m = nightMean(
      nightHours.map((h) => ({ ...h, overallScore: null })),
      DARK,
    );
    expect(m).toEqual({ nightMean: null, coveredSec: 0, darknessSec: 23400, coverage: 0 });
  });
  it('Polartag → alles null', () => {
    expect(nightMean(nightHours, null)).toEqual({
      nightMean: null,
      coveredSec: 0,
      darknessSec: 0,
      coverage: null,
    });
    expect(bestWindow(nightHours, null)).toBeNull();
  });
});

describe('(g) Bestes Fenster – Kontrollwert 6 (WS-10)', () => {
  it('21:30–00:00, 9000 s, meanScore 0,788, moonFreeSec 3600 (nicht 7200)', () => {
    const w = bestWindow(nightHours, DARK);
    expect(w).not.toBeNull();
    expect(w?.fromUtc).toBe('2026-09-25T21:30:00Z');
    expect(w?.toUtc).toBe('2026-09-26T00:00:00Z');
    expect(w?.sec).toBe(9000);
    near(w?.meanScore ?? null, 7092 / 9000);
    expect(q(w?.meanScore as number, 1e3)).toBe(0.788);
    expect(w?.moonFreeSec).toBe(3600);
    expect(w?.moonFreeSec).not.toBe(7200);
    expect(w?.fair).toBe(false);
  });
  it('Rückfall auf 0,45 auch bei zu kurzem 0,65-Fenster (Präzisierung §3.3)', () => {
    const hours = [0.7, 0.5, 0.5, 0.5].map((s, i) => ({ tUnix: T0 + i * 3600, overallScore: s }));
    // 0,65-Lauf: nur 21:30–22:00 (1800 s wäre genug) – deshalb die Dunkelheit ab 21:45.
    const dark = { ...DARK, fromUtc: T0 + 2700 };
    const w = bestWindow(hours, dark);
    expect(w?.fair).toBe(true);
    expect(w?.fromUtc).toBe('2026-09-25T21:45:00Z');
    expect(w?.sec).toBe(900 + 3 * 3600);
  });
  it('kein Lauf ≥ 1800 s → null', () => {
    const hours = [0.3, 0.3].map((s, i) => ({ tUnix: T0 + i * 3600, overallScore: s }));
    expect(bestWindow(hours, DARK)).toBeNull();
  });
});

describe('(h) Seeing mit fehlender Scherung – Kontrollwert 4 (WS-04a)', () => {
  const seeing = (
    w250: number | null,
    w500: number | null,
    withShear: boolean,
    w10: number | null,
  ) => {
    const jet = jetKmh(w250, w500);
    const shear = withShear ? windShear(90, 270, 30, 240) : null;
    return {
      score: seeingScore({ jetKmh: jet, shearKmh: shear, wind10Kmh: w10 }),
      incomplete: seeingIncomplete({
        jetKmh: jet,
        wind250Kmh: w250,
        wind500Kmh: w500,
        shearKmh: shear,
        wind10Kmh: w10,
      }),
    };
  };
  it('jet 64, Scherung und Bodenwind fehlen → 0,600000 (Vorlage 0,82)', () => {
    const r = seeing(64, 0, false, null);
    near(r.score, 0.6);
    expect(r.incomplete).toBe(true);
    near(0.82 - (r.score as number), 0.22);
  });
  it('jet 90, Scherung fehlt, w10 14 → 0,485594 (Vorlage 0,665636)', () => {
    const r = seeing(90, 60, false, 14);
    near(r.score, 0.485594);
    expect(r.incomplete).toBe(true);
    near(0.665636 - (r.score as number), 0.180042);
  });
  it('vollständig → identisch mit der Vorlage (1e-12), kein Kennzeichen', () => {
    const r = seeing(90, 60, true, 14);
    const template =
      1 -
      (0.45 * Math.min(1, Math.max(0, (90 - 20) / 110)) +
        0.35 * Math.min(1, Math.max(0, ((windShear(90, 270, 30, 240) as number) - 20) / 100)) +
        0.2 * Math.min(1, Math.max(0, (14 - 8) / 25)));
    near(r.score, template, 1e-12);
    near(r.score, 0.505501);
    expect(r.incomplete).toBe(false);
  });
  it('w500 fehlt → Score unverändert, aber seeingIncomplete', () => {
    const r = seeing(90, null, true, 14);
    near(r.score, 0.505501);
    expect(r.incomplete).toBe(true);
  });
  it('ohne Höhenwind kein Score und kein Kennzeichen', () => {
    const r = seeing(null, null, true, 14);
    expect(r.score).toBeNull();
    expect(r.incomplete).toBe(false);
  });
});

describe('(l) Niederschlag bewertet nichts (WS-E1)', () => {
  it('gleiche Stunde mit 0 mm bzw. 12,4 mm / 95 % → gleicher Score und gleiche Klasse', () => {
    const dry = scoreHour(hour({ ...KW3, aod: 0.14, precipMm: 0, precipProbPct: 0 }));
    const wet = scoreHour(hour({ ...KW3, aod: 0.14, precipMm: 12.4, precipProbPct: 95 }));
    expect(wet.overallScore).toBe(dry.overallScore);
    expect(wet.ratingIndex).toBe(dry.ratingIndex);
    expect(wet.precipMm).toBe(12.4);
    expect(wet.precipProbPct).toBe(95);
  });
});

describe('weatherScores: mehrere Nächte, Nacht-Kennzeichen', () => {
  const clear = (t: number, over: Partial<WeatherHourly> = {}) =>
    hour({ ...KW3, cloudTotalPct: 0, aod: 0.05, tUnix: t, ...over });
  it('je darkWindows-Eintrag eine Zeile; eine Stunde ohne Aerosol kennzeichnet die Nacht', () => {
    const n2 = T0 + 86400;
    const hourly = [
      clear(T0),
      clear(T0 + 3600, { aod: null }),
      clear(n2),
      clear(n2 + 3600),
      clear(n2 + 7200, { wind10Kmh: null }),
    ];
    const res = weatherScores({
      hourly,
      darkWindows: [
        { night: '2026-09-25', fromUtc: T0, toUtc: T0 + 7200 },
        { night: '2026-09-26', fromUtc: n2, toUtc: n2 + 3 * 3600 },
      ],
    });
    expect(res.hours).toHaveLength(5);
    expect(res.nights.map((n) => n.night)).toEqual(['2026-09-25', '2026-09-26']);
    expect(res.nights[0]).toMatchObject({ aerosolMissing: true, seeingIncomplete: false });
    expect(res.nights[1]).toMatchObject({ aerosolMissing: false, seeingIncomplete: true });
    expect(res.nights[1]?.coverage).toBe(1);
    expect(res.nights[1]?.bestWindow?.sec).toBe(3 * 3600);
  });
  it('Stunden außerhalb der Dunkelheit kennzeichnen die Nacht nicht', () => {
    const res = weatherScores({
      hourly: [clear(T0), clear(T0 + 5 * 3600, { aod: null })],
      darkWindows: [{ night: '2026-09-25', fromUtc: T0, toUtc: T0 + 3600 }],
    });
    expect(res.nights[0]?.aerosolMissing).toBe(false);
  });
});
