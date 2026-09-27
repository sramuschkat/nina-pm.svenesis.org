/**
 * Ereignisse der Nacht (`sky.*` aus `src/sky/events`): SGP4 gegen die Verifikationsfälle von Vallado et al.
 * 2006 (Satellit 00005, erdnah); Überflüge, Meteorströme, Zentrum der Milchstraße und Finsternisse gegen die
 * Vorlage (`legacy/astro-tools-2026-09-21/js/sky-events.js` in Node ausgeführt) für Starfront (31,5471° N,
 * 99,3823° W, 400 m), Nacht 27./28.09.2026 (Fenster 18:00–09:00 CDT), TLE aus
 * `packages/catalog-data/data/sky-events.json` (Stand 15.09.2026). Screenshot der Vorlage (Sven 27.09.2026):
 * ISS 21:23–21:25 CDT, Südliche Tauriden „in 39 Tagen“, Sgr A* 20:50–22:30 CDT, erste Finsternis
 * Halbschatten-Mondfinsternis Sa 20.02.2027, 17:13 CST.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sky } from '../src/index';

const STARFRONT = { latDeg: 31.5471, lonDeg: -99.3823, elevationM: 400 };
const at = (iso: string) => Date.parse(iso) / 1000;
const START = at('2026-09-27T23:00:00Z');
const END = at('2026-09-28T14:00:00Z');
/** Ortszeit hh:mm auf die Minute gerundet wie die Vorlage (`hhmm`), Versatz in Stunden. */
const hhmm = (sec: number, offH: number) => {
  const m = Math.floor((sec + offH * 3600) / 60 + 0.5);
  const h = Math.floor(m / 60) % 24;
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};
const near = (actual: number | null | undefined, expected: number, tol: number) => {
  expect(actual).not.toBeNull();
  expect(actual).toBeDefined();
  expect(Math.abs((actual ?? Number.NaN) - expected)).toBeLessThanOrEqual(tol);
};

interface SkyEventsData {
  satellites: sky.SatelliteTle[];
}
const DATA = JSON.parse(
  readFileSync(
    new URL('../../catalog-data/data/sky-events.json', import.meta.url).pathname,
    'utf8',
  ),
) as SkyEventsData;

describe('SGP4 (Vallado et al. 2006, Satellit 00005)', () => {
  const tle = sky.parseTle(
    '1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753',
    '2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667',
  );
  const rec = sky.sgp4init(tle);

  it('liest die TLE: Epoche 2000, Tag 179,78495062; B* 0,28098e-4', () => {
    expect(tle.id).toBe('00005');
    near(tle.epochUtc, at('2000-06-27T00:00:00Z') + 0.78495062 * 86400, 1e-3);
    near(tle.bstar, 0.28098e-4, 1e-12);
    expect(rec).not.toBeNull();
  });

  // Referenz: tcppver.out zu Vallado 2006 (km, km/s). Erreicht: < 1e-6 km, identisch zur Vorlage.
  const CASES: [number, [number, number, number]][] = [
    [0, [7022.46529266, -1400.08296755, 0.03995155]],
    [360, [-7154.03120202, -3783.17682504, -3536.19412294]],
    [720, [-7134.59340119, 6531.68641334, 3260.27186483]],
    [1440, [-938.55923943, -6268.18748831, -4294.02924751]],
  ];
  for (const [min, r] of CASES)
    it(`Ort nach ${String(min)} min auf 1e-6 km`, () => {
      const pv = rec ? sky.sgp4(rec, min) : null;
      expect(pv).not.toBeNull();
      for (let i = 0; i < 3; i++) near(pv?.r[i], r[i] ?? 0, 1e-6);
    });

  it('Geschwindigkeit bei 0 min auf 1e-8 km/s', () => {
    const pv = rec ? sky.sgp4(rec, 0) : null;
    const v = [1.89384101, 6.40589376, 4.53480725];
    for (let i = 0; i < 3; i++) near(pv?.v[i], v[i] ?? 0, 1e-8);
  });

  it('Tiefraum-Bahn (Umlauf ≥ 225 min) wird abgelehnt', () => {
    const deep = sky.parseTle(
      '1 11801U          80230.29629788  .01431103  00000-0  14311-1 0    13',
      '2 11801  46.7916 230.4354 7318036  47.4722  10.4117  2.28537848    13',
    );
    expect(sky.sgp4init(deep)).toBeNull();
  });
});

describe('Überflüge (Vorlage satellitePasses)', () => {
  const night = sky.satellitePassesForNight(DATA.satellites, START, END, STARFRONT);

  it('zwei Überflüge: ISS 21:23–21:25 CDT und Tiangong 06:32–06:36 CDT', () => {
    expect(night.stale).toEqual([]);
    expect(night.allStale).toBe(false);
    expect(night.newestEpochUtc).toBe(sky.parseTle(DATA.satellites[1]?.tle1 ?? '', '').epochUtc);
    expect(night.passes.map((p) => p.name)).toEqual(['ISS', 'Tiangong']);
    const [iss, tg] = night.passes;
    expect(`${hhmm(iss?.startUtc ?? 0, -5)}–${hhmm(iss?.endUtc ?? 0, -5)}`).toBe('21:23–21:25');
    expect(`${hhmm(tg?.startUtc ?? 0, -5)}–${hhmm(tg?.endUtc ?? 0, -5)}`).toBe('06:32–06:36');
  });

  it('ISS: Zeiten, höchster Punkt, Helligkeit und Erdschatten wie die Vorlage', () => {
    const p = night.passes[0];
    expect(p?.id).toBe(25544);
    near(p?.startUtc, at('2026-09-28T02:23:06Z'), 5);
    near(p?.endUtc, at('2026-09-28T02:24:53Z'), 5);
    expect(p?.max.t).toBe(at('2026-09-28T02:24:40Z'));
    near(p?.max.altDeg, 25.232, 0.1);
    near(p?.max.azDeg, 304.932, 0.1);
    near(p?.max.mag, -0.637, 0.05);
    near(p?.brightestMag, -0.637, 0.05);
    expect(p?.faded).toBe(true);
    expect(p?.track).toHaveLength(5);
    near(p?.track[0]?.azDeg, 309.77, 0.1);
  });

  it('Tiangong: Zeiten, höchster Punkt, Helligkeit wie die Vorlage', () => {
    const p = night.passes[1];
    near(p?.startUtc, at('2026-09-28T11:31:43Z'), 5);
    near(p?.endUtc, at('2026-09-28T11:36:24Z'), 5);
    expect(p?.max.t).toBe(at('2026-09-28T11:34:00Z'));
    near(p?.max.altDeg, 19.138, 0.1);
    near(p?.max.azDeg, 142.56, 0.1);
    near(p?.max.mag, 0.863, 0.05);
    near(p?.brightestMag, 0.187, 0.05);
    expect(p?.faded).toBe(false);
    near(p?.track[0]?.azDeg, 185.59, 0.1);
    near(p?.track[(p.track.length || 1) - 1]?.azDeg, 93.85, 0.1);
  });

  it('Bahndaten älter als 14 Tage zur Fenstermitte: keine Überflüge, alle veraltet', () => {
    const later = sky.satellitePassesForNight(
      DATA.satellites,
      START + 5 * 86400,
      END + 5 * 86400,
      STARFRONT,
    );
    expect(later.passes).toEqual([]);
    expect(later.allStale).toBe(true);
    expect(later.stale.map((s) => s.id)).toEqual([25544, 48274, 20580]);
  });

  it('Blickwinkel: Höhe, Azimut und Abstand der ISS zum höchsten Punkt', () => {
    const sat = DATA.satellites[0];
    const rec = sat ? sky.sgp4init(sky.parseTle(sat.tle1, sat.tle2)) : null;
    const lk = rec
      ? sky.satelliteLook(
          rec,
          at('2026-09-28T02:24:40Z'),
          { latDeg: 31.5471, lonDeg: -99.3823 },
          -1.8,
        )
      : null;
    near(lk?.altDeg, 25.232005, 1e-3);
    near(lk?.azDeg, 304.931893, 1e-3);
    near(lk?.rangeKm, 875.4028, 0.01);
    expect(lk?.lit).toBe(true);
    near(lk?.mag, -0.637, 0.005);
  });
});

describe('Meteorströme (Vorlage showersTonight, meteorRate)', () => {
  const rows = sky.eventSamples(STARFRONT, START, END);

  it('Proben alle 10 min', () => {
    expect(rows).toHaveLength(91);
    expect(rows[1]?.t).toBe(START + 600);
  });

  it('nur die Südlichen Tauriden aktiv, Maximum in 39 Tagen', () => {
    const list = sky.showersTonight(rows, STARFRONT);
    expect(list.map((x) => x.shower.key)).toEqual(['STA']);
    const x = list[0];
    expect(x?.shower.nameDe).toBe('Südliche Tauriden');
    near(x?.daysToPeak, 38.7736, 0.01);
    expect(Math.floor(Math.abs(x?.daysToPeak ?? 0) + 0.5)).toBe(39);
    expect(x?.best?.t).toBe(at('2026-09-28T09:40:00Z'));
    near(x?.best?.altDeg, 73.543, 0.05);
    near(x?.best?.azDeg, 179.747, 0.05);
    expect(x?.from30Utc).toBe(at('2026-09-28T05:30:00Z'));
  });

  it('erwartete Rate (Grenzgröße 6,0) wie die Vorlage', () => {
    const sta = sky.METEOR_SHOWERS.find((s) => s.key === 'STA');
    const r = sta ? sky.meteorRate(sta, rows, STARFRONT, 6.0) : null;
    near(r?.perHour, 0.1652, 0.002);
    expect(r?.t).toBe(at('2026-09-28T09:40:00Z'));
    near(r?.altDeg, 73.543, 0.05);
    near(r?.zhr, 1.9413, 0.002);
  });

  it('Perseiden-Nacht 12./13.08.2026: Perseiden vorn, Maximum in dieser Nacht', () => {
    const aug = sky.eventSamples(STARFRONT, at('2026-08-12T23:00:00Z'), at('2026-08-13T13:00:00Z'));
    const list = sky.showersTonight(aug, STARFRONT);
    expect(list[0]?.shower.key).toBe('PER');
    expect(Math.abs(list[0]?.daysToPeak ?? 9)).toBeLessThan(1);
    expect(list.map((x) => x.shower.key)).toEqual(expect.arrayContaining(['SDA', 'CAP']));
  });

  it('Mitte März ist keiner der großen Ströme aktiv', () => {
    const mar = sky.eventSamples(STARFRONT, at('2026-03-15T23:00:00Z'), at('2026-03-16T12:00:00Z'));
    expect(sky.showersTonight(mar, STARFRONT)).toEqual([]);
  });
});

describe('Zentrum der Milchstraße (Vorlage galacticCentre)', () => {
  const rows = sky.eventSamples(STARFRONT, START, END);
  const gc = sky.galacticCentre(rows, STARFRONT);

  it('Sgr A* 20:50–22:30 CDT, am höchsten zu Beginn der Dunkelheit', () => {
    const tn = gc?.tonight;
    expect(tn?.fromUtc).toBe(at('2026-09-28T01:50:00Z'));
    expect(tn?.toUtc).toBe(at('2026-09-28T03:30:00Z'));
    expect(`${hhmm(tn?.fromUtc ?? 0, -5)}–${hhmm(tn?.toUtc ?? 0, -5)}`).toBe('20:50–22:30');
    expect(tn?.level).toBe(-18);
    expect(tn?.best.t).toBe(at('2026-09-28T01:50:00Z'));
    near(tn?.best.altDeg, 23.79, 0.05);
    near(tn?.best.azDeg, 206.787, 0.05);
    near(tn?.moonIllumPct, 97.56, 0.3);
    near(tn?.moonSepDeg, 116.063, 0.1);
  });

  it('Saison: Stunden am 15. jedes Monats wie die Vorlage, Feb–Okt', () => {
    const want = [0, 1, 7 / 3, 11 / 3, 5, 19 / 3, 16 / 3, 11 / 3, 7 / 3, 1, 0, 0];
    expect(gc?.monthsHours).toHaveLength(12);
    want.forEach((h, i) => near(gc?.monthsHours[i], h, 1e-9));
    expect(sky.galacticSeason(gc?.monthsHours ?? [])).toEqual({
      none: false,
      allYear: false,
      runs: [{ fromMonth: 1, toMonth: 9 }],
    });
    expect(sky.galacticSeason(new Array<number>(12).fill(2)).allYear).toBe(true);
    expect(sky.galacticSeason(new Array<number>(12).fill(0)).none).toBe(true);
    const wrap = [2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2];
    expect(sky.galacticSeason(wrap).runs).toEqual([{ fromMonth: 10, toMonth: 1 }]);
  });
});

describe('Finsternisse (Vorlage lunarEclipses, solarEclipses, renderEvents)', () => {
  const site = { latDeg: 31.5471, lonDeg: -99.3823 };
  // Ortsmittag vor der Nacht 27./28.09.2026 (12:00 CDT)
  const list = sky.nextEclipses(site, at('2026-09-27T17:00:00Z'));

  it('sechs Finsternisse wie die Vorlage, die erste am Sa 20.02.2027, 17:13 CST', () => {
    expect(list.map((e) => `${e.body}:${e.kind}`)).toEqual([
      'lunar:penumbral',
      'lunar:penumbral',
      'lunar:partial',
      'solar:partial',
      'solar:partial',
      'solar:partial',
    ]);
    expect(hhmm(list[0]?.maxUtc ?? 0, -6)).toBe('17:13');
  });

  // Vorlage (UT): größte Finsternis, Größe (Kernschatten bzw. Sonnendurchmesser), sichtbar von–bis, ganz, Höhe
  const REF: [string, number, string, string, boolean, number][] = [
    ['2027-02-20T23:13:01Z', 0.9476, '2027-02-21T00:35:45Z', '2027-02-21T01:10:45Z', false, -15.65],
    ['2027-08-17T07:14:13Z', 0.5721, '2027-08-17T05:22:03Z', '2027-08-17T09:02:03Z', true, 44.63],
    ['2028-01-12T04:13:22Z', 0.0732, '2028-01-12T03:43:57Z', '2028-01-12T04:38:57Z', true, 54.38],
    ['2028-01-26T13:54:44Z', 0.2422, '2028-01-26T13:36:40Z', '2028-01-26T14:52:40Z', false, 3.26],
    ['2029-01-14T16:49:10Z', 0.6011, '2029-01-14T15:22:46Z', '2029-01-14T18:22:46Z', true, 30.23],
    ['2031-11-14T22:18:24Z', 0.2075, '2031-11-14T21:29:43Z', '2031-11-14T23:01:43Z', true, 14.52],
  ];
  REF.forEach(([max, mag, from, to, whole, alt], i) =>
    it(`Nr. ${String(i + 1)}: ${max} (±60 s, Größe ±0,01, Höhe ±0,1°)`, () => {
      const e = list[i];
      near(e?.maxUtc, at(max), 60);
      const size =
        e?.body === 'lunar'
          ? e.umbralMag > 0
            ? e.umbralMag
            : e.penumbralMag
          : e?.body === 'solar'
            ? e.magnitude
            : null;
      near(size, mag, 0.01);
      near(e?.visFromUtc, at(from), 60);
      near(e?.visToUtc, at(to), 60);
      expect(e?.whole).toBe(whole);
      near(e?.altDeg, alt, 0.1);
    }),
  );

  it('Kontakte der partiellen Mondfinsternis 12.01.2028 (Vorlage)', () => {
    const e = list[2];
    expect(e?.body).toBe('lunar');
    if (e?.body !== 'lunar') return;
    near(e.p1Utc, at('2028-01-12T02:06:06Z'), 60);
    near(e.u1Utc, at('2028-01-12T03:43:57Z'), 60);
    expect(e.u2Utc).toBeNull();
    expect(e.u3Utc).toBeNull();
    near(e.u4Utc, at('2028-01-12T04:42:53Z'), 60);
    near(e.p4Utc, at('2028-01-12T06:20:39Z'), 60);
  });

  it('bekannte Mondfinsternisse 2026: total 03.03. (≈ 11:34 UT), partiell 28.08. (≈ 04:13 UT)', () => {
    const lunar = sky.lunarEclipses(at('2026-01-01T00:00:00Z'), 2, 3, site);
    expect(lunar.map((x) => x.kind)).toEqual(['total', 'partial', 'penumbral']);
    near(lunar[0]?.maxUtc, at('2026-03-03T11:34:31Z'), 60);
    near(lunar[0]?.umbralMag, 1.156, 0.01);
    expect(lunar[0]?.u2Utc).not.toBeNull();
    expect(lunar[0]?.whole).toBe(false);
    near(lunar[1]?.maxUtc, at('2026-08-28T04:13:01Z'), 60);
    near(lunar[1]?.umbralMag, 0.934, 0.01);
    near(lunar[2]?.maxUtc, at('2027-02-20T23:13:01Z'), 60);
  });

  it('Sonnenfinsternisse 12.08.2026 und 06.02.2027 sind in Texas nicht zu sehen', () => {
    const solar = sky.solarEclipses(at('2026-01-01T00:00:00Z'), 10, 1, site);
    expect(solar[0]?.maxUtc).toBeGreaterThan(at('2028-01-01T00:00:00Z'));
  });

  it('totale Sonnenfinsternis 12.08.2026 in León (Spanien), zentral mit C2/C3', () => {
    const leon = sky.solarEclipses(at('2026-08-01T00:00:00Z'), 1, 1, {
      latDeg: 42.6,
      lonDeg: -5.57,
    });
    expect(leon[0]?.kind).toBe('total');
    near(leon[0]?.maxUtc, at('2026-08-12T18:29:06Z'), 60);
    expect(leon[0]?.c2Utc).not.toBeNull();
    expect(leon[0]?.c3Utc).not.toBeNull();
    near(leon[0]?.obscuration, 1, 1e-9);
  });

  it('nächster Voll- und Neumond (geozentrisch)', () => {
    near(sky.nextSyzygy(at('2026-09-20T00:00:00Z'), 180), at('2026-09-26T16:50:01Z'), 90);
    near(sky.nextSyzygy(at('2026-09-20T00:00:00Z'), 0), at('2026-10-10T15:51:09Z'), 90);
  });

  it('deterministisch', () => {
    expect(sky.nextEclipses(site, at('2026-09-27T17:00:00Z'))).toEqual(list);
  });
});
