/**
 * Exoplaneten-Projekt aus der Transitsuche (AP-42 Teil 2; FA-EXO-15/16/17):
 * - Katalogeintrag finden (zusammengeführt wie in der Suche, FA-EXO-03) und als Momentaufnahme speichern;
 * - Ephemeride aus dem führenden Eintrag;
 * - neuere Katalog-Ephemeride als Angebot mit Wirkung auf die nächste Transitmitte;
 * - kommende beobachtbare Transits aus der **gespeicherten** Ephemeride (ohne neuen Katalogabruf, FA-EXO-16),
 *   gerechnet mit derselben Suche wie S-22, damit Zeitleiste, Filter und Belichtung gleich aussehen.
 */
import type { EphemerisInsert, EphemerisRow } from '@nina-pm/db';
import { bjdTdbToJdUtc, jdFromUnix, unixFromJd } from '@nina-pm/engine';
import type { ExoEphemerisUpdate, ExoEphemerisView } from '@nina-pm/shared';
import { mergeExoEntries, planetKey, type MergedEntry } from './merge';
import type { StoredExoEntry } from './search';

export type MergedStored = MergedEntry<StoredExoEntry>;

/** Zusammengeführte Einträge wie in der Suche (ohne APC, FA-EXO-02). */
export function mergedCatalog(entries: readonly StoredExoEntry[]): MergedStored[] {
  return mergeExoEntries(entries.filter((e) => e.disposition !== 'APC'));
}

/**
 * Eintrag zu Katalog und Planet: führender Eintrag mit diesem Namen oder die Gruppe, in der er nachrangig steht
 * (der führende Katalog kann seit dem Anlegen gewechselt haben, z. B. TOI → ExoClock).
 */
export function findMerged(
  merged: readonly MergedStored[],
  catalog: string,
  planet: string,
): MergedStored | undefined {
  return (
    merged.find((m) => m.catalog === catalog && m.planet === planet) ??
    merged.find((m) => m.others.some((o) => o.catalog === catalog && o.planet === planet)) ??
    merged.find((m) => planetKey(m.planet) === planetKey(planet))
  );
}

/** Momentaufnahme der Katalogzeile (`exo_project.catalog_snapshot`) mit aufgefüllten Kenndaten (transit.md §5). */
export interface ExoSnapshot extends Omit<StoredExoEntry, 'fetchedAt'> {
  readonly fetchedAt: string;
  readonly alsoIn: readonly string[];
}

export function snapshotOf(m: MergedStored): ExoSnapshot {
  const fill = <K extends 'planetRadiusRe' | 'distancePc' | 'teffK' | 'ticId'>(k: K) =>
    m[k] ?? m.others.map((o) => o[k]).find((v) => v !== null) ?? null;
  const { others: _others, alsoIn, fetchedAt, ...row } = m;
  void _others;
  return {
    ...row,
    planetRadiusRe: fill('planetRadiusRe'),
    distancePc: fill('distancePc'),
    teffK: fill('teffK'),
    ticId: fill('ticId'),
    alsoIn: [...alsoIn],
    fetchedAt: fetchedAt.toISOString(),
  };
}

export function ephemerisOf(m: StoredExoEntry): EphemerisInsert {
  return {
    t0BjdTdb: m.t0BjdTdb,
    t0SigmaD: m.t0SigmaD,
    periodD: m.periodD,
    periodSigmaD: m.periodSigmaD,
    durationH: m.durationH,
    durationEstimated: m.durationEstimated,
    timeSystemSource: m.timeSystemSource,
    oMinusCMin: m.oMinusCMin,
    depthMmag: m.depthMmag,
    rpOverRs: m.rpOverRs,
    source: m.catalog,
    sourceDate: m.fetchedAt.toISOString().slice(0, 10),
  };
}

const iso = (d: Date | string) => new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');

export function ephemerisView(e: EphemerisRow): ExoEphemerisView {
  return {
    id: e.id,
    t0BjdTdb: e.t0BjdTdb,
    t0SigmaD: e.t0SigmaD,
    periodD: e.periodD,
    periodSigmaD: e.periodSigmaD,
    durationH: e.durationH,
    durationEstimated: e.durationEstimated,
    timeSystemSource: e.timeSystemSource,
    ocMin: e.oMinusCMin,
    depthMmag: e.depthMmag,
    rpOverRs: e.rpOverRs,
    source: e.source,
    sourceDate: e.sourceDate === null ? null : String(e.sourceDate).slice(0, 10),
    active: e.isActive,
    createdAt: iso(e.createdAt),
  };
}

/** Gleiche Ephemeride: T₀ und P auf 1e-7 d (≈ 9 ms) gleich. */
const same = (a: number, b: number) => Math.abs(a - b) < 1e-7;

/**
 * Angebot einer neueren Katalog-Ephemeride (FA-EXO-16) oder `null`. Wirkung: nächste Transitmitte nach `nowUnix`
 * gemäß neuer Ephemeride gegen die Mitte derselben Epoche gemäß alter.
 */
export function catalogUpdate(
  active: EphemerisRow,
  m: MergedStored,
  raDeg: number,
  decDeg: number,
  nowUnix: number,
): ExoEphemerisUpdate | null {
  if (same(active.t0BjdTdb, m.t0BjdTdb) && same(active.periodD, m.periodD)) return null;
  // BJD ≈ JD(UTC) bis auf Minuten – genügt für die Wahl der nächsten Epoche.
  const now = jdFromUnix(nowUnix);
  const nextNew = m.t0BjdTdb + Math.ceil((now - m.t0BjdTdb) / m.periodD) * m.periodD;
  const oldEpoch = Math.round((nextNew - active.t0BjdTdb) / active.periodD);
  const midOld = active.t0BjdTdb + oldEpoch * active.periodD;
  const utc = bjdTdbToJdUtc(nextNew, raDeg, decDeg);
  return {
    catalog: m.catalog,
    t0BjdTdb: m.t0BjdTdb,
    t0SigmaD: m.t0SigmaD,
    periodD: m.periodD,
    periodSigmaD: m.periodSigmaD,
    fetchedAt: iso(m.fetchedAt),
    periodDeltaS: (m.periodD - active.periodD) * 86400,
    nextMidUtc: iso(new Date(Math.round(unixFromJd(utc.jdUtc)) * 1000)),
    nextMidShiftMin: (nextNew - midOld) * 1440,
  };
}

/** Katalogeintrag für die Rechnung aus Momentaufnahme und aktiver Ephemeride (FA-EXO-16: ohne Katalogabruf). */
export function entryFromProject(snapshot: unknown, e: EphemerisRow): StoredExoEntry | null {
  const s = snapshot as Partial<ExoSnapshot> | null;
  if (!s || typeof s.raDeg !== 'number' || typeof s.decDeg !== 'number' || !s.catalog) return null;
  return {
    ...(s as ExoSnapshot),
    fetchedAt: new Date(s.fetchedAt ?? e.createdAt),
    t0BjdTdb: e.t0BjdTdb,
    t0SigmaD: e.t0SigmaD,
    periodD: e.periodD,
    periodSigmaD: e.periodSigmaD,
    durationH: e.durationH,
    durationEstimated: e.durationEstimated,
    timeSystemSource: e.timeSystemSource,
    oMinusCMin: e.oMinusCMin,
    depthMmag: e.depthMmag,
    rpOverRs: e.rpOverRs,
    // Die Epoche ist bereits normalisiert (BJD_TDB); Rohwert nur für die Anzeige des Quellsystems.
    t0Raw: e.t0BjdTdb,
  };
}
