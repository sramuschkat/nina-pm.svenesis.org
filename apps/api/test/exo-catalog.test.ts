/**
 * Import der Exoplaneten-Kataloge (AP-40, FA-EXO-02…04/31, transit.md §1) mit Auszügen der echten Antworten vom
 * 29.09.2026 (`test/fixtures/exo/`): ExoClock `planets_json`, NASA `pscomppars` (TAP-CSV), ExoFOP TOI (CSV).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ExoCatalog, ExoCatalogRow } from '@nina-pm/db';
import { EXO_PREFILTER_DEFAULT, isProblemError } from '@nina-pm/shared';
import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/exo/csv';
import {
  EXO_SOURCES,
  effectivePrefilter,
  importExoCatalog,
  NASA_URL,
  type ExoImportDeps,
} from '../src/exo/job';
import { mergeExoEntries, planetKey } from '../src/exo/merge';
import { parseExoClock, parseNasa, parseToi, ticOf } from '../src/exo/parse';
import { decDeg, num, raDeg, timeSystemOf } from '../src/exo/row';
import { catalogOfInput, exoCatalogTick } from '../src/worker/catalog';
import type { JobRunnerDeps } from '../src/worker/jobs';

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../src/exo/samples/${name}`, import.meta.url)), 'utf8');
const EXOCLOCK = fixture('exoclock-sample.json');
const NASA = fixture('nasa-sample.csv');
const TOI = fixture('toi-sample.csv');
const F = EXO_PREFILTER_DEFAULT;

const byPlanet = (rows: readonly ExoCatalogRow[], planet: string) => {
  const row = rows.find((r) => r.planet === planet);
  if (!row) throw new Error(`${planet} fehlt`);
  return row;
};

describe('Hilfsfunktionen', () => {
  it('RA in Stunden wird zu Grad, Dezimalgrad bleibt (kein HMS/Grad-Verwechseln)', () => {
    expect(raDeg('21:38:08.7311')).toBeCloseTo(324.536379, 5);
    expect(raDeg('324.5359781')).toBeCloseTo(324.5359781, 7);
    expect(raDeg('24:00:00')).toBeNull();
    expect(decDeg('+30:29:19.445')).toBeCloseTo(30.488735, 5);
    expect(decDeg('-00:30:00')).toBeCloseTo(-0.5, 9);
    expect(decDeg('abc')).toBeNull();
  });

  it('Zahlen: leer → null, 0 bleibt 0', () => {
    expect(num('')).toBeNull();
    expect(num('  ')).toBeNull();
    expect(num('0')).toBe(0);
    expect(num('0.0')).toBe(0);
    expect(num('Infinity')).toBeNull();
  });

  it('Zeitsystem je Angabe der Quelle (Spec-Ergänzung 29.09.2026)', () => {
    expect(timeSystemOf('BJD-TDB')).toBe('bjd_tdb');
    expect(timeSystemOf('BJD_TDB')).toBe('bjd_tdb');
    expect(timeSystemOf('BJD')).toBe('bjd_tdb');
    expect(timeSystemOf('BJD-TT')).toBe('bjd_tdb');
    expect(timeSystemOf('BJD-UTC')).toBe('bjd_utc');
    expect(timeSystemOf('HJD')).toBe('hjd_utc');
    expect(timeSystemOf('HJD-UTC')).toBe('hjd_utc');
    expect(timeSystemOf('JD')).toBe('unknown');
    expect(timeSystemOf('HJD-TDB')).toBe('unknown');
    expect(timeSystemOf('')).toBe('unknown');
    expect(timeSystemOf(null)).toBe('unknown');
  });

  it('TIC-Kennung nur als Ziffern', () => {
    expect(ticOf('TIC 188876052')).toBe('188876052');
    expect(ticOf('231663901')).toBe('231663901');
    expect(ticOf('')).toBeNull();
    expect(ticOf('Gaia DR2 123')).toBeNull();
  });

  it('CSV: Kommas in Anführungszeichen, abgeschnittene Zeile wird gezählt, fehlende Spalte bricht ab', () => {
    const t = parseCsv('a,b,c\r\n1,"x, y",3\n4,5\n', ['a', 'b'], 'test');
    expect(t.rows).toEqual([{ a: '1', b: 'x, y', c: '3' }]);
    expect(t.malformed).toBe(1);
    expect(() => parseCsv('a,b\n1,2\n', ['z'], 'test')).toThrow(/Spalten fehlen: z/);
  });

  it('Vorfilter: gespeicherter Wert oder Vorgabe', () => {
    expect(effectivePrefilter(null)).toEqual(F);
    expect(effectivePrefilter({ maxStarMag: 'x' })).toEqual(F);
    const own = { maxStarMag: 13, minDepthMmag: 5, decMinDeg: -40, decMaxDeg: 90 };
    expect(effectivePrefilter(own)).toEqual(own);
  });

  it('Job-Eingabe: ohne Katalog der Objektkatalog (Jobs vor AP-40)', () => {
    expect(catalogOfInput({})).toBe('dso');
    expect(catalogOfInput('{"catalog":"toi"}')).toBe('toi');
    expect(catalogOfInput({ catalog: 'nasa' })).toBe('nasa');
    expect(() => catalogOfInput({ catalog: 'gaia' })).toThrow();
  });
});

describe('ExoClock', () => {
  const r = parseExoClock(JSON.parse(EXOCLOCK) as unknown, F);

  it('übernimmt alle Planeten, der Vorfilter setzt nur das Kennzeichen', () => {
    expect(r.rows).toHaveLength(7);
    expect(r.skipped).toEqual({});
    expect(byPlanet(r.rows, 'CoRoT-10b').amateurReachable).toBe(false);
    expect(byPlanet(r.rows, 'HAT-P-17b').amateurReachable).toBe(true);
  });

  it('HAT-P-17b: BJD_TDB unverändert, Tiefe mmag direkt, Öffnung Zoll → mm, Helligkeit V', () => {
    const p = byPlanet(r.rows, 'HAT-P-17b');
    expect(p).toMatchObject({
      star: 'HAT-P-17',
      t0BjdTdb: 2457168.694753,
      t0Raw: 2457168.694753,
      timeSystemSource: 'bjd_tdb',
      timeSystemRaw: 'BJD_TDB',
      t0SigmaD: 5.2e-5,
      periodD: 10.33853486,
      periodSigmaD: 4e-7,
      durationH: 4.04,
      durationEstimated: false,
      depthMmag: 20.37,
      depthRaw: 20.37,
      depthUnit: 'mmag',
      depthEstimated: false,
      minApertureMm: 127,
      exoclockPriority: 'medium',
      oMinusCMin: 1,
      magBandUsed: 'V',
      magVJohnson: 10.38,
      magRCousins: 10.24,
      rpOverRs: 0.1238,
      aOverRs: 22.6,
      inclinationDeg: 89.2,
      ticId: null,
    });
    expect(p.raDeg).toBeCloseTo(324.536379, 5);
    expect(p.decDeg).toBeCloseTo(30.488735, 5);
  });
});

describe('NASA pscomppars', () => {
  const r = parseNasa(NASA, F);

  it('nur erreichbare Planeten; fehlende Epoche und Vorfilter werden gezählt', () => {
    expect(r.rows.map((x) => x.planet)).toEqual([
      'HAT-P-17 b',
      'HD 209458 b',
      'WASP-12 b',
      'TrES-3 b',
      'HAT-P-8 b',
      'WASP-37 b',
      'WASP-189 b',
      'WASP-64 b',
    ]);
    expect(r.skipped).toEqual({ prefilter: 8, no_epoch: 1 });
    expect(r.malformed).toBe(0);
    expect(r.rows.every((x) => x.amateurReachable)).toBe(true);
  });

  it('Tiefe in Prozent → mmag nichtlinear; TIC-Kennung; Entfernung in pc', () => {
    const p = byPlanet(r.rows, 'HAT-P-17 b');
    expect(p.depthRaw).toBe(1.5);
    expect(p.depthUnit).toBe('percent');
    expect(p.depthMmag).toBeCloseTo(-2500 * Math.log10(1 - 0.015), 9);
    expect(p.ticId).toBe('266593143');
    expect(p.distancePc).toBeCloseTo(92.3831, 4);
    expect(p.timeSystemSource).toBe('bjd_tdb');
  });

  it('HJD → BJD_TDB: UTC→TDB plus Sonnenversatz', () => {
    const p = byPlanet(r.rows, 'TrES-3 b');
    expect(p.timeSystemRaw).toBe('HJD');
    expect(p.timeSystemSource).toBe('hjd_utc');
    const shiftS = (p.t0BjdTdb - p.t0Raw) * 86400;
    // 32,184 s + 34 s (2009) ± Sonnenversatz ≤ 5 s
    expect(Math.abs(shiftS - 66.184)).toBeLessThan(5);
  });

  it('HJD-TDB (ein Planet im Archiv) → unknown, Epoche unverändert', () => {
    const p = byPlanet(r.rows, 'WASP-64 b');
    expect(p.timeSystemSource).toBe('unknown');
    expect(p.t0BjdTdb).toBe(p.t0Raw);
  });

  it('ohne Tiefe: geometrischer Ersatzwert (Rp/R★)² mit Kennzeichen', () => {
    const p = byPlanet(r.rows, 'WASP-189 b');
    expect(p.depthEstimated).toBe(true);
    expect(p.depthRaw).toBeNull();
    expect(p.depthUnit).toBeNull();
    expect(p.depthMmag).toBeCloseTo(-2500 * Math.log10(1 - (p.rpOverRs ?? 0) ** 2), 9);
  });

  it('TrES-3 b: normalisierte NASA-Epoche liegt näher an ExoClock als die rohe HJD-Zahl', () => {
    const exo = byPlanet(parseExoClock(JSON.parse(EXOCLOCK) as unknown, F).rows, 'TrES-3b');
    const nasa = byPlanet(r.rows, 'TrES-3 b');
    const n = Math.round((nasa.t0BjdTdb - exo.t0BjdTdb) / exo.periodD);
    const predicted = exo.t0BjdTdb + n * exo.periodD;
    const normalizedMin = Math.abs(nasa.t0BjdTdb - predicted) * 1440;
    const rawMin = Math.abs(nasa.t0Raw - predicted) * 1440;
    expect(normalizedMin).toBeLessThan(1);
    expect(rawMin - normalizedMin).toBeGreaterThan(1);
  });
});

describe('TESS TOI', () => {
  const r = parseToi(TOI, F);

  it('FP/FA verworfen und gezählt, Vorfilter auf TESS-Helligkeit und Tiefe', () => {
    expect(r.rows.map((x) => x.planet)).toEqual(['TOI-101.01', 'TOI-121.01', 'TOI-7711.01']);
    expect(r.skipped).toEqual({ prefilter: 2, false_positive: 3 });
  });

  it('RA/Dec sexagesimal, volles BJD, ppm → mmag, Stern über TIC', () => {
    const p = byPlanet(r.rows, 'TOI-101.01');
    expect(p).toMatchObject({
      star: 'TIC 231663901',
      ticId: '231663901',
      disposition: 'KP',
      t0BjdTdb: 2458326.009117,
      timeSystemSource: 'bjd_tdb',
      depthUnit: 'ppm',
      magBandUsed: 'T',
      magTess: 12.4069,
    });
    expect(p.raDeg).toBeCloseTo(15 * (21 + 14 / 60 + 56.88 / 3600), 6);
    expect(p.decDeg).toBeCloseTo(-(55 + 52 / 60 + 18.71 / 3600), 6);
    expect(p.depthMmag).toBeCloseTo(20.784, 2);
  });

  it('leere TFOPWG-Disposition → TESS-Disposition', () => {
    expect(byPlanet(r.rows, 'TOI-7711.01').disposition).toBe('CP');
  });

  it('BTJD-Epoche (< 2 400 000) bekommt den Offset 2 457 000', () => {
    const header = TOI.split('\n')[0] ?? '';
    const line = TOI.split('\n').find((l) => l.startsWith('231663901,101.01,')) ?? '';
    const btjd = line.replace('2458326.009117', '1326.009117');
    const p = parseToi(`${header}\n${btjd}\n`, F);
    expect(p.rows[0]?.timeSystemSource).toBe('btjd');
    expect(p.rows[0]?.t0BjdTdb).toBeCloseTo(2458326.009117, 9);
  });
});

describe('Zusammenführen (FA-EXO-03): ExoClock → NASA → TOI', () => {
  const tag = <C extends ExoCatalog>(catalog: C, rows: readonly ExoCatalogRow[]) =>
    rows.map((row) => ({ ...row, catalog }));
  const merged = mergeExoEntries([
    ...tag('toi', parseToi(TOI, F).rows),
    ...tag('nasa', parseNasa(NASA, F).rows),
    ...tag('exoclock', parseExoClock(JSON.parse(EXOCLOCK) as unknown, F).rows),
  ]);

  it('Name ohne Leerzeichen verbindet ExoClock und NASA', () => {
    expect(planetKey('HAT-P-17 b')).toBe(planetKey('HAT-P-17b'));
    expect(planetKey('HD 209458 b')).toBe(planetKey('HD209458b'));
    const hat = merged.filter((m) => planetKey(m.planet) === 'HAT-P-17B');
    expect(hat).toHaveLength(1);
    expect(hat[0]).toMatchObject({ catalog: 'exoclock', alsoIn: ['nasa'] });
  });

  it('NASA-Planet ohne ExoClock bleibt NASA', () => {
    expect(merged.find((m) => m.planet === 'WASP-37 b')).toMatchObject({
      catalog: 'nasa',
      alsoIn: [],
    });
  });

  it('TOI über TIC und Periode, nicht über die TIC allein', () => {
    const base = {
      raDeg: 0,
      decDeg: 0,
    } as const;
    const m = mergeExoEntries([
      { ...base, catalog: 'nasa' as const, planet: 'X b', periodD: 3.0, ticId: '42' },
      { ...base, catalog: 'nasa' as const, planet: 'X c', periodD: 7.5, ticId: '42' },
      { ...base, catalog: 'toi' as const, planet: 'TOI-1.01', periodD: 3.0001, ticId: '42' },
      { ...base, catalog: 'toi' as const, planet: 'TOI-1.02', periodD: 11.2, ticId: '42' },
    ]);
    expect(m.map((x) => [x.planet, x.alsoIn])).toEqual([
      ['X b', ['toi']],
      ['X c', []],
      ['TOI-1.02', []],
    ]);
  });
});

describe('Job: abrufen, prüfen, ersetzen (FA-EXO-04)', () => {
  const deps = (over: Partial<ExoImportDeps> & { stored?: number } = {}) => {
    const calls: { catalog: ExoCatalog; rows: number }[] = [];
    const d: ExoImportDeps = {
      fetchText: over.fetchText ?? ((url) => Promise.resolve(url === NASA_URL ? NASA : EXOCLOCK)),
      prefilter: over.prefilter ?? (() => Promise.resolve(null)),
      count: over.count ?? (() => Promise.resolve(over.stored ?? 0)),
      replace:
        over.replace ??
        ((catalog, rows) => {
          calls.push({ catalog, rows: rows.length });
          return Promise.resolve({ written: rows.length, deleted: 0, keptReferenced: [] });
        }),
    };
    return { d, calls };
  };
  const now = new Date('2026-09-29T03:00:00Z');

  it('ersetzt den Stand mit allen geparsten Zeilen', async () => {
    const { d, calls } = deps();
    const s = await importExoCatalog(d, 'nasa', now);
    expect(calls).toEqual([{ catalog: 'nasa', rows: 8 }]);
    expect(s).toMatchObject({ written: 8, unknownTimeSystem: 1, skipped: { prefilter: 8 } });
  });

  it('Quelle ruft mit dem Zeitlimit je Quelle (NASA 120 s, ExoClock 60 s)', async () => {
    const seen: [string, number][] = [];
    const { d } = deps({
      fetchText: (url, ms) => {
        seen.push([url, ms]);
        return Promise.resolve(EXOCLOCK);
      },
    });
    await importExoCatalog(d, 'exoclock', now);
    expect(seen).toEqual([[EXO_SOURCES.exoclock.url, 60_000]]);
    expect(EXO_SOURCES.nasa.timeoutMs).toBe(120_000);
  });

  it('Abruffehler → catalog.source_failed, Stand bleibt', async () => {
    const { d, calls } = deps({ fetchText: () => Promise.reject(new Error('HTTP 503')) });
    const error = await importExoCatalog(d, 'toi', now).catch((e: unknown) => e);
    expect(isProblemError(error) && error.code).toBe('catalog.source_failed');
    expect(calls).toEqual([]);
  });

  it('abgeschnittene Antwort (< 80 % des Stands) → Stand bleibt', async () => {
    const { d, calls } = deps({ stored: 100 });
    const error = await importExoCatalog(d, 'nasa', now).catch((e: unknown) => e);
    expect(isProblemError(error) && error.code).toBe('catalog.source_failed');
    expect(String((error as Error).message)).toMatch(/nur 8 statt bisher 100/);
    expect(calls).toEqual([]);
  });

  it('zu viele unvollständige CSV-Zeilen → Stand bleibt', async () => {
    const cut = NASA.split('\n')
      .map((l, i) => (i > 0 && i % 2 === 0 ? l.slice(0, 20) : l))
      .join('\n');
    const { d, calls } = deps({ fetchText: () => Promise.resolve(cut) });
    await expect(importExoCatalog(d, 'nasa', now)).rejects.toThrow(/unvollständig/);
    expect(calls).toEqual([]);
  });

  it('Vorfilter aus system_setting.exoPrefilter', async () => {
    const { d, calls } = deps({
      prefilter: () =>
        Promise.resolve({ maxStarMag: 10, minDepthMmag: 3, decMinDeg: -90, decMaxDeg: 90 }),
    });
    await importExoCatalog(d, 'nasa', now);
    expect(calls[0]?.rows).toBeLessThan(8);
  });
});

describe('Zeitplan: je Katalog ein Job, laufender Job wird nicht verdoppelt', () => {
  it('führt nur neu angelegte Jobs aus', async () => {
    const ran: string[] = [];
    const jobs: JobRunnerDeps = {
      queue: () =>
        Promise.resolve({
          claim: (id: string) =>
            Promise.resolve({ id, kind: 'catalog_refresh', input: {}, attempts: 1 } as never),
          finish: () => Promise.resolve(),
          fail: () => Promise.resolve(),
          stale: () => Promise.resolve([]),
        }),
      handlers: {
        catalog_refresh: (ctx) => {
          ran.push(ctx.job.id);
          return Promise.resolve(undefined);
        },
      },
    };
    const runs = await exoCatalogTick(
      {
        enqueue: (c) => Promise.resolve({ jobId: `job-${c}`, created: c !== 'toi' }),
      },
      jobs,
      ['nasa', 'toi'],
    );
    expect(runs).toBe(1);
    expect(ran).toEqual(['job-nasa']);
  });
});
