/**
 * Gemeinsamer Aufbau einer Katalogzeile (AP-40, transit.md §1): Epoche nach BJD_TDB, Tiefe in mmag, Dauer und
 * Tiefe als Ersatzwert aus der Geometrie, Helligkeit nach Fallback-Kette, Amateur-Vorfilter (FA-EXO-31).
 * Die Rechnung selbst liegt in der Engine (`normalizeEpoch`, `depthMmag`, `transitDurationH`).
 */
import type { ExoCatalogRow } from '@nina-pm/db';
import {
  depthMmag,
  geometricDepthMmag,
  normalizeEpoch,
  transitDurationH,
  type ExoDepthUnit,
  type ExoTimeSystem,
} from '@nina-pm/engine';
import type { ExoPrefilter } from '@nina-pm/shared';

export type SkipReason =
  | 'no_coordinates'
  | 'no_epoch'
  | 'no_period'
  | 'epoch_out_of_range'
  | 'false_positive'
  | 'prefilter'
  | 'duplicate';

export interface ParseResult {
  readonly rows: ExoCatalogRow[];
  /** Verworfene Zeilen je Grund (Log des Jobs; FP/FA werden gezählt, AST-D5). */
  readonly skipped: Readonly<Partial<Record<SkipReason, number>>>;
  /** Zeilen mit falscher Spaltenzahl (abgeschnittener Download). */
  readonly malformed: number;
  /** Zeilen, bei denen `TAI − UTC` hinter dem Ende der Schaltsekunden-Tabelle lag (Diagnose). */
  readonly leapTableExpired: number;
}

/** Zahl aus einem Feld: leer, `NaN`, `Infinity` → `null`. `0` bleibt `0` (kein „falsy“-Vergleich). */
export function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Nur positive Werte (Helligkeit 0 oder Tiefe 0 heißen in den Quellen „unbekannt“). */
export function positive(v: unknown): number | null {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
}

/** Größere der beiden Fehlergrenzen (`e1`, `e2` mit Vorzeichen) als 1σ; `null`, wenn beide fehlen. */
export function sigma(e1: unknown, e2: unknown): number | null {
  const a = num(e1);
  const b = num(e2);
  if (a === null && b === null) return null;
  return Math.max(Math.abs(a ?? 0), Math.abs(b ?? 0));
}

/** Rektaszension in Grad aus `HH:MM:SS.s` **oder** Dezimalgrad – nie Stunden als Grad (AlpacaFlux-Fehler). */
export function raDeg(v: string): number | null {
  const s = v.trim();
  if (s.includes(':')) {
    const [h, m = '0', sec = '0'] = s.split(':');
    const hh = num(h);
    const mm = num(m);
    const ss = num(sec);
    if (hh === null || mm === null || ss === null) return null;
    const deg = 15 * (hh + mm / 60 + ss / 3600);
    return deg >= 0 && deg < 360 ? deg : null;
  }
  const d = num(s);
  return d !== null && d >= 0 && d < 360 ? d : null;
}

/** Deklination in Grad aus `±DD:MM:SS.s` oder Dezimalgrad; das Vorzeichen gilt auch für `-00:…`. */
export function decDeg(v: string): number | null {
  const s = v.trim();
  if (s.includes(':')) {
    const neg = s.startsWith('-');
    const [d, m = '0', sec = '0'] = s.replace(/^[+-]/, '').split(':');
    const dd = num(d);
    const mm = num(m);
    const ss = num(sec);
    if (dd === null || mm === null || ss === null) return null;
    const deg = dd + mm / 60 + ss / 3600;
    return deg <= 90 ? (neg ? -deg : deg) : null;
  }
  const d = num(s);
  return d !== null && d >= -90 && d <= 90 ? d : null;
}

/** Zeitsystem aus der Angabe der Quelle (NASA `pl_tranmid_systemref`, ExoClock `ephem_mid_time_format`). */
export function timeSystemOf(raw: string | null): ExoTimeSystem {
  switch ((raw ?? '').trim().toUpperCase().replace(/_/g, '-')) {
    case 'BJD-TDB':
    case 'BJD-TT': // TT − TDB < 2 ms
    case 'BJD': // gegen ExoClock im Median 0,00 min (388 Planeten, 29.09.2026)
      return 'bjd_tdb';
    case 'BJD-UTC':
      return 'bjd_utc';
    case 'HJD':
    case 'HJD-UTC':
      return 'hjd_utc';
    case 'BTJD':
      return 'btjd';
    case 'BKJD':
      return 'bkjd';
    default:
      // 'JD' (in Wahrheit meist BJD), 'HJD-TDB' (ein Planet), leer: unsicher (Spec-Ergänzung 29.09.2026).
      return 'unknown';
  }
}

export interface RowInput {
  readonly planet: string;
  readonly star: string;
  readonly disposition: string | null;
  readonly raDeg: number;
  readonly decDeg: number;
  readonly mags: {
    readonly v: number | null;
    readonly r: number | null;
    readonly sdssG: number | null;
    readonly gaiaG: number | null;
    readonly tess: number | null;
  };
  /** Fallback-Kette der Helligkeit, z. B. NASA `['V','G','T']`, ExoClock `['V','R']`. */
  readonly magOrder: readonly ('V' | 'R' | 'G' | 'T')[];
  readonly teffK: number | null;
  readonly distancePc: number | null;
  readonly t0Raw: number;
  readonly timeSystemRaw: string | null;
  readonly timeSystem: ExoTimeSystem;
  readonly t0SigmaD: number | null;
  readonly periodD: number;
  readonly periodSigmaD: number | null;
  readonly durationH: number | null;
  readonly depthRaw: number | null;
  readonly depthUnit: ExoDepthUnit;
  readonly rpOverRs: number | null;
  readonly aOverRs: number | null;
  readonly inclinationDeg: number | null;
  readonly planetRadiusRe: number | null;
  readonly eqTempK: number | null;
  readonly exoclockPriority: string | null;
  readonly oMinusCMin: number | null;
  readonly minApertureMm: number | null;
  readonly ticId: string | null;
}

export type BuiltRow =
  | { readonly ok: true; readonly row: ExoCatalogRow; readonly leapTableExpired: boolean }
  | { readonly ok: false; readonly reason: SkipReason };

function magnitude(i: RowInput): { mag: number | null; band: string | null } {
  for (const band of i.magOrder) {
    const m =
      band === 'V' ? i.mags.v : band === 'R' ? i.mags.r : band === 'G' ? i.mags.gaiaG : i.mags.tess;
    if (m !== null) return { mag: m, band };
  }
  return { mag: null, band: null };
}

/** Erfüllt die Zeile den Amateur-Vorfilter? Fehlt Helligkeit oder Tiefe, gilt sie als nicht erreichbar. */
export function passesPrefilter(
  row: Pick<ExoCatalogRow, 'depthMmag' | 'decDeg'> & { readonly mag: number | null },
  f: ExoPrefilter,
): boolean {
  return (
    row.mag !== null &&
    row.mag <= f.maxStarMag &&
    row.depthMmag !== null &&
    row.depthMmag >= f.minDepthMmag &&
    row.decDeg >= f.decMinDeg &&
    row.decDeg <= f.decMaxDeg
  );
}

export function buildRow(i: RowInput, prefilter: ExoPrefilter): BuiltRow {
  if (!(i.periodD > 0)) return { ok: false, reason: 'no_period' };
  const epoch = normalizeEpoch(i.t0Raw, i.timeSystem, i.raDeg, i.decDeg);
  if (!epoch.ok) return { ok: false, reason: 'epoch_out_of_range' };

  const measuredDepth = depthMmag(i.depthRaw, i.depthUnit);
  const depth = measuredDepth ?? geometricDepthMmag(i.rpOverRs);
  const measuredDuration = i.durationH !== null && i.durationH > 0 ? i.durationH : null;
  const duration =
    measuredDuration ?? transitDurationH(i.periodD, i.aOverRs, i.rpOverRs, i.inclinationDeg);
  const { mag, band } = magnitude(i);

  const row: ExoCatalogRow = {
    planet: i.planet,
    star: i.star,
    disposition: i.disposition,
    raDeg: i.raDeg,
    decDeg: i.decDeg,
    magVJohnson: i.mags.v,
    magRCousins: i.mags.r,
    magSdssG: i.mags.sdssG,
    magGaiaG: i.mags.gaiaG,
    magTess: i.mags.tess,
    magBandUsed: band,
    teffK: i.teffK,
    distancePc: i.distancePc,
    t0BjdTdb: epoch.t0BjdTdb,
    t0SigmaD: i.t0SigmaD,
    periodD: i.periodD,
    periodSigmaD: i.periodSigmaD,
    durationH: duration,
    durationEstimated: measuredDuration === null && duration !== null,
    depthMmag: depth,
    depthRaw: measuredDepth === null ? null : i.depthRaw,
    depthUnit: measuredDepth === null ? null : i.depthUnit,
    depthEstimated: measuredDepth === null && depth !== null,
    rpOverRs: i.rpOverRs,
    aOverRs: i.aOverRs,
    inclinationDeg:
      i.inclinationDeg !== null && i.inclinationDeg >= 0 && i.inclinationDeg <= 180
        ? i.inclinationDeg
        : null,
    planetRadiusRe: i.planetRadiusRe,
    eqTempK: i.eqTempK,
    exoclockPriority: i.exoclockPriority,
    oMinusCMin: i.oMinusCMin,
    minApertureMm: i.minApertureMm,
    minApertureEstimated: false,
    amateurReachable: passesPrefilter({ mag, depthMmag: depth, decDeg: i.decDeg }, prefilter),
    timeSystemSource: epoch.system,
    timeSystemRaw: i.timeSystemRaw,
    t0Raw: i.t0Raw,
    ticId: i.ticId,
  };
  return { ok: true, row, leapTableExpired: epoch.leapTableExpired };
}

/** Sammelt Zeilen und Gründe; doppelte Planeten (gleicher Name) behalten die erste Zeile. */
export class RowCollector {
  readonly rows: ExoCatalogRow[] = [];
  readonly skipped: Partial<Record<SkipReason, number>> = {};
  leapTableExpired = 0;
  private readonly seen = new Set<string>();

  skip(reason: SkipReason): void {
    this.skipped[reason] = (this.skipped[reason] ?? 0) + 1;
  }

  /** `dropUnreachable`: NASA und TOI übernehmen nur erreichbare Planeten (FA-EXO-31), ExoClock alle. */
  add(built: BuiltRow, dropUnreachable: boolean): void {
    if (!built.ok) return this.skip(built.reason);
    if (dropUnreachable && !built.row.amateurReachable) return this.skip('prefilter');
    if (this.seen.has(built.row.planet)) return this.skip('duplicate');
    this.seen.add(built.row.planet);
    if (built.leapTableExpired) this.leapTableExpired += 1;
    this.rows.push(built.row);
  }

  result(malformed = 0): ParseResult {
    return {
      rows: this.rows,
      skipped: this.skipped,
      malformed,
      leapTableExpired: this.leapTableExpired,
    };
  }
}
