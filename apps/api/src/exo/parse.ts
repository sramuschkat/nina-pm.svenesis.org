/**
 * Parser der drei Exoplaneten-Kataloge (AP-40, FA-EXO-02, transit.md §1). Feldnamen gegen die echten Antworten
 * vom 29.09.2026 geprüft (Beispieldateien `apps/api/test/fixtures/exo/`):
 * - **ExoClock** `planets_json`: Objekt je Planet, Epoche `ephem_mid_time` im System `ephem_mid_time_format`
 *   (bisher immer `BJD_TDB`), Tiefe `depth_r_mmag` (mmag, R), Öffnung `min_telescope_inches` (Zoll → mm),
 *   RA/Dec als `HH:MM:SS`/`±DD:MM:SS`. Alle Planeten werden übernommen, der Vorfilter setzt nur das Kennzeichen.
 * - **NASA** `pscomppars` (TAP, CSV): Epoche `pl_tranmid` im System `pl_tranmid_systemref`, Tiefe `pl_trandep`
 *   (Prozent), `tic_id` als `TIC 123`. Nur Planeten, die den Vorfilter erfüllen (FA-EXO-31).
 * - **TESS TOI** (ExoFOP, CSV): `Epoch (BJD)` als volles BJD_TDB (unter 2 400 000 ⇒ BTJD), Tiefe `Depth (ppm)`,
 *   RA/Dec sexagesimal. FP/FA werden verworfen und gezählt (AST-D5); Vorfilter wie NASA.
 */
import type { ExoPrefilter } from '@nina-pm/shared';
import { parseCsv } from './csv';
import {
  buildRow,
  decDeg,
  num,
  positive,
  raDeg,
  RowCollector,
  sigma,
  timeSystemOf,
  type ParseResult,
} from './row';

const INCH_MM = 25.4;
const PRIORITIES = new Set(['alert', 'high', 'medium', 'low']);
const DISPOSITIONS = new Set(['APC', 'CP', 'FA', 'FP', 'KP', 'PC']);

type Json = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function parseExoClock(json: unknown, prefilter: ExoPrefilter): ParseResult {
  if (json === null || typeof json !== 'object' || Array.isArray(json))
    throw new Error('ExoClock: Objekt je Planet erwartet');
  const out = new RowCollector();
  const entries = Object.entries(json as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  for (const [key, value] of entries) {
    const p = (value ?? {}) as Json;
    const ra = raDeg(str(p.ra_j2000));
    const dec = decDeg(str(p.dec_j2000));
    if (ra === null || dec === null) {
      out.skip('no_coordinates');
      continue;
    }
    const t0 = num(p.ephem_mid_time);
    if (t0 === null) {
      out.skip('no_epoch');
      continue;
    }
    const format = str(p.ephem_mid_time_format) || null;
    const inches = positive(p.min_telescope_inches);
    const priority = str(p.priority).toLowerCase();
    out.add(
      buildRow(
        {
          planet: str(p.name) || key,
          star: str(p.star) || key,
          disposition: null,
          raDeg: ra,
          decDeg: dec,
          mags: {
            v: positive(p.v_mag),
            r: positive(p.r_mag),
            sdssG: null,
            gaiaG: positive(p.gaia_g_mag),
            tess: null,
          },
          magOrder: ['V', 'R'],
          teffK: positive(p.teff),
          distancePc: null,
          t0Raw: t0,
          timeSystemRaw: format,
          timeSystem: timeSystemOf(format),
          t0SigmaD: sigma(p.ephem_mid_time_e1, p.ephem_mid_time_e2),
          periodD: num(p.ephem_period) ?? 0,
          periodSigmaD: sigma(p.ephem_period_e1, p.ephem_period_e2),
          durationH: positive(p.duration_hours),
          depthRaw: positive(p.depth_r_mmag),
          depthUnit: 'mmag',
          rpOverRs: positive(p.rp_over_rs),
          aOverRs: positive(p.sma_over_rs),
          inclinationDeg: num(p.inclination),
          planetRadiusRe: null,
          eqTempK: null,
          exoclockPriority: PRIORITIES.has(priority) ? priority : null,
          oMinusCMin: num(p.current_oc_min),
          minApertureMm: inches === null ? null : inches * INCH_MM,
          ticId: null,
        },
        prefilter,
      ),
      false,
    );
  }
  return out.result();
}

/** Spalten der TAP-Abfrage (`NASA_TAP_QUERY`). */
export const NASA_COLUMNS = [
  'pl_name',
  'hostname',
  'tic_id',
  'ra',
  'dec',
  'sy_vmag',
  'sy_gmag',
  'sy_gaiamag',
  'sy_tmag',
  'st_teff',
  'sy_dist',
  'pl_tranmid',
  'pl_tranmiderr1',
  'pl_tranmiderr2',
  'pl_tranmid_systemref',
  'pl_orbper',
  'pl_orbpererr1',
  'pl_orbpererr2',
  'pl_trandur',
  'pl_trandep',
  'pl_ratror',
  'pl_ratdor',
  'pl_orbincl',
  'pl_rade',
  'pl_eqt',
] as const;

/** `TIC 188876052` bzw. `188876052` → `188876052`; sonst `null`. */
export function ticOf(v: string): string | null {
  const m = /^(?:TIC\s*)?(\d+)$/i.exec(v.trim());
  return m?.[1] ?? null;
}

export function parseNasa(csv: string, prefilter: ExoPrefilter): ParseResult {
  const table = parseCsv(csv, NASA_COLUMNS, 'NASA pscomppars');
  const out = new RowCollector();
  for (const r of table.rows) {
    const ra = raDeg(r.ra ?? '');
    const dec = decDeg(r.dec ?? '');
    if (ra === null || dec === null) {
      out.skip('no_coordinates');
      continue;
    }
    const t0 = num(r.pl_tranmid);
    if (t0 === null) {
      out.skip('no_epoch');
      continue;
    }
    const ref = r.pl_tranmid_systemref ?? '';
    out.add(
      buildRow(
        {
          planet: r.pl_name ?? '',
          star: r.hostname ?? '',
          disposition: null,
          raDeg: ra,
          decDeg: dec,
          mags: {
            v: positive(r.sy_vmag),
            r: null,
            sdssG: positive(r.sy_gmag),
            gaiaG: positive(r.sy_gaiamag),
            tess: positive(r.sy_tmag),
          },
          magOrder: ['V', 'G', 'T'],
          teffK: positive(r.st_teff),
          distancePc: positive(r.sy_dist),
          t0Raw: t0,
          timeSystemRaw: ref === '' ? null : ref,
          timeSystem: timeSystemOf(ref),
          t0SigmaD: sigma(r.pl_tranmiderr1, r.pl_tranmiderr2),
          periodD: num(r.pl_orbper) ?? 0,
          periodSigmaD: sigma(r.pl_orbpererr1, r.pl_orbpererr2),
          durationH: positive(r.pl_trandur),
          depthRaw: positive(r.pl_trandep),
          depthUnit: 'percent',
          rpOverRs: positive(r.pl_ratror),
          aOverRs: positive(r.pl_ratdor),
          inclinationDeg: num(r.pl_orbincl),
          planetRadiusRe: positive(r.pl_rade),
          eqTempK: positive(r.pl_eqt),
          exoclockPriority: null,
          oMinusCMin: null,
          minApertureMm: null,
          ticId: ticOf(r.tic_id ?? ''),
        },
        prefilter,
      ),
      true,
    );
  }
  return out.result(table.malformed);
}

export const TOI_COLUMNS = [
  'TIC ID',
  'TOI',
  'TESS Disposition',
  'TFOPWG Disposition',
  'TESS Mag',
  'RA',
  'Dec',
  'Epoch (BJD)',
  'Epoch (BJD) err',
  'Period (days)',
  'Period (days) err',
  'Duration (hours)',
  'Depth (ppm)',
  'Planet Radius (R_Earth)',
  'Planet Equil Temp (K)',
  'Stellar Distance (pc)',
  'Stellar Eff Temp (K)',
] as const;

export function parseToi(csv: string, prefilter: ExoPrefilter): ParseResult {
  const table = parseCsv(csv, TOI_COLUMNS, 'TESS TOI');
  const out = new RowCollector();
  for (const r of table.rows) {
    const disp = ((r['TFOPWG Disposition'] ?? '') || (r['TESS Disposition'] ?? '')).toUpperCase();
    if (disp === 'FP' || disp === 'FA') {
      out.skip('false_positive');
      continue;
    }
    const ra = raDeg(r.RA ?? '');
    const dec = decDeg(r.Dec ?? '');
    if (ra === null || dec === null) {
      out.skip('no_coordinates');
      continue;
    }
    const t0 = num(r['Epoch (BJD)']);
    if (t0 === null) {
      out.skip('no_epoch');
      continue;
    }
    const tic = ticOf(r['TIC ID'] ?? '');
    const toi = (r.TOI ?? '').trim();
    out.add(
      buildRow(
        {
          planet: `TOI-${toi}`,
          star: tic ? `TIC ${tic}` : `TOI-${toi.split('.')[0] ?? toi}`,
          disposition: DISPOSITIONS.has(disp) ? disp : null,
          raDeg: ra,
          decDeg: dec,
          mags: { v: null, r: null, sdssG: null, gaiaG: null, tess: positive(r['TESS Mag']) },
          magOrder: ['T'],
          teffK: positive(r['Stellar Eff Temp (K)']),
          distancePc: positive(r['Stellar Distance (pc)']),
          t0Raw: t0,
          timeSystemRaw: 'BJD',
          // ExoFOP liefert volles BJD_TDB; ein Wert unter 2 400 000 wäre BTJD (transit.md §1).
          timeSystem: t0 < 2_400_000 ? 'btjd' : 'bjd_tdb',
          t0SigmaD: sigma(r['Epoch (BJD) err'], null),
          periodD: num(r['Period (days)']) ?? 0,
          periodSigmaD: sigma(r['Period (days) err'], null),
          durationH: positive(r['Duration (hours)']),
          depthRaw: positive(r['Depth (ppm)']),
          depthUnit: 'ppm',
          rpOverRs: null,
          aOverRs: null,
          inclinationDeg: null,
          planetRadiusRe: positive(r['Planet Radius (R_Earth)']),
          eqTempK: positive(r['Planet Equil Temp (K)']),
          exoclockPriority: null,
          oMinusCMin: null,
          minApertureMm: null,
          ticId: tic,
        },
        prefilter,
      ),
      true,
    );
  }
  return out.result(table.malformed);
}
