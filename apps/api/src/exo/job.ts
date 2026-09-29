/**
 * Import der Exoplaneten-Kataloge als Job `catalog_refresh` (AP-40, FA-EXO-02/04/31, TK 13):
 * `daily` ExoClock, `weekly` NASA und TESS TOI, jederzeit manuell (S-82). Ablauf je Katalog: abrufen, parsen,
 * normalisieren, vorfiltern, prüfen, ersetzen. Schlägt ein Schritt fehl, bleibt der gespeicherte Stand
 * unverändert (FA-EXO-04 „bei Ausfall wird der Cache verwendet“) und der Job endet mit Fehler.
 *
 * Schutz vor abgeschnittenen Antworten: Liefert die Quelle weniger als `MIN_SHARE` der gespeicherten Zeilen oder
 * sind mehr als 1 % der CSV-Zeilen kaputt, wird nicht ersetzt.
 */
import {
  enqueueSystemJob,
  exoCatalogDedupeKey,
  type ExoCatalog,
  type ExoCatalogRow,
  type ExoReplaceResult,
  type OpenDatabase,
} from '@nina-pm/db';
import { EXO_PREFILTER_DEFAULT, ExoPrefilter, ProblemError } from '@nina-pm/shared';
import { logger } from '../lib/logger';
import { parseExoClock, parseNasa, parseToi, NASA_COLUMNS } from './parse';
import type { ParseResult } from './row';

export const EXOCLOCK_URL = 'https://www.exoclock.space/database/planets_json';
export const NASA_TAP_QUERY = `select ${NASA_COLUMNS.join(',')} from pscomppars where tran_flag=1`;
export const NASA_URL = `https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=${encodeURIComponent(
  NASA_TAP_QUERY,
)}&format=csv`;
export const TOI_URL = 'https://exofop.ipac.caltech.edu/tess/download_toi.php?sort=toi&output=csv';

/** Zeitlimits je Quelle (TK 14): NASA TAP 120 s, ExoClock 60 s, ExoFOP wie ExoClock. */
export const EXO_SOURCES: Readonly<Record<ExoCatalog, { url: string; timeoutMs: number }>> = {
  exoclock: { url: EXOCLOCK_URL, timeoutMs: 60_000 },
  nasa: { url: NASA_URL, timeoutMs: 120_000 },
  toi: { url: TOI_URL, timeoutMs: 60_000 },
};

/** Mindestanteil gegenüber dem gespeicherten Stand, sonst gilt die Antwort als abgeschnitten. */
export const MIN_SHARE = 0.8;
const MAX_MALFORMED_SHARE = 0.01;

export interface ExoImportDeps {
  /** Text einer HTTPS-Antwort (Zeitlimit und Wiederholung im gemeinsamen `httpClient`). */
  readonly fetchText: (url: string, timeoutMs: number) => Promise<string>;
  /** Gespeicherter Vorfilter `system_setting.exoPrefilter` oder `null`. */
  readonly prefilter: () => Promise<unknown>;
  readonly count: (catalog: ExoCatalog) => Promise<number>;
  readonly replace: (
    catalog: ExoCatalog,
    rows: readonly ExoCatalogRow[],
    now: Date,
  ) => Promise<ExoReplaceResult>;
}

export function parseCatalog(
  catalog: ExoCatalog,
  text: string,
  prefilter: ExoPrefilter,
): ParseResult {
  switch (catalog) {
    case 'exoclock':
      return parseExoClock(JSON.parse(text) as unknown, prefilter);
    case 'nasa':
      return parseNasa(text, prefilter);
    case 'toi':
      return parseToi(text, prefilter);
  }
}

/** Gespeicherter Vorfilter, bei fehlendem oder ungültigem Wert die Vorgabe (FA-EXO-31). */
export function effectivePrefilter(stored: unknown): ExoPrefilter {
  const parsed = ExoPrefilter.safeParse(stored);
  return parsed.success ? parsed.data : EXO_PREFILTER_DEFAULT;
}

export interface ExoImportSummary {
  readonly catalog: ExoCatalog;
  readonly written: number;
  readonly deleted: number;
  readonly keptReferenced: number;
  readonly unknownTimeSystem: number;
  readonly skipped: ParseResult['skipped'];
  readonly malformed: number;
  readonly leapTableExpired: number;
}

export async function importExoCatalog(
  deps: ExoImportDeps,
  catalog: ExoCatalog,
  now: Date,
): Promise<ExoImportSummary> {
  const source = EXO_SOURCES[catalog];
  const prefilter = effectivePrefilter(await deps.prefilter());
  // Fehler der Quelle als `catalog.source_failed` mit Grund (sichtbar in S-82); der Stand bleibt unverändert.
  const fail = (message: string) =>
    new ProblemError('catalog.source_failed', [{ path: catalog, message }], message);
  let parsed: ParseResult;
  try {
    parsed = parseCatalog(catalog, await deps.fetchText(source.url, source.timeoutMs), prefilter);
  } catch (error) {
    throw fail(error instanceof Error ? error.message : 'Abruf fehlgeschlagen');
  }
  const total = parsed.rows.length + parsed.malformed;
  if (parsed.rows.length === 0) throw fail('keine Zeilen');
  if (parsed.malformed > MAX_MALFORMED_SHARE * total)
    throw fail(`${String(parsed.malformed)} von ${String(total)} Zeilen unvollständig`);
  const existing = await deps.count(catalog);
  if (parsed.rows.length < MIN_SHARE * existing)
    throw fail(`nur ${String(parsed.rows.length)} statt bisher ${String(existing)} Zeilen`);
  const r = await deps.replace(catalog, parsed.rows, now);
  const summary: ExoImportSummary = {
    catalog,
    written: r.written,
    deleted: r.deleted,
    keptReferenced: r.keptReferenced.length,
    unknownTimeSystem: parsed.rows.filter((x) => x.timeSystemSource === 'unknown').length,
    skipped: parsed.skipped,
    malformed: parsed.malformed,
    leapTableExpired: parsed.leapTableExpired,
  };
  logger.info('exo_catalog_import', { ...summary, prefilter });
  if (parsed.leapTableExpired > 0)
    logger.warn('leap_table_expired', { catalog, rows: parsed.leapTableExpired });
  return summary;
}

/** Job `catalog_refresh` ohne Mandanten für einen Exoplaneten-Katalog (Zeitplan und S-82). */
export function enqueueExoCatalog(db: OpenDatabase['db'], catalog: ExoCatalog) {
  return enqueueSystemJob(db, {
    kind: 'catalog_refresh',
    dedupeKey: exoCatalogDedupeKey(catalog),
    input: { catalog },
  });
}
