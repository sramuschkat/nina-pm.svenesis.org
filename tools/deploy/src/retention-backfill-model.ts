/**
 * Einmalige Nachkennzeichnung im Daten-Bucket (Sicherheitsanalyse To-do 2, Nachtrag zu #101): Objekte, die
 * vor der Einführung des Tags `npm-retention` geschrieben wurden, tragen es nicht und verfallen deshalb nie.
 * Die Kategorie steht im dritten Schlüsselteil (`tenant/<id>/<kategorie>/…`); die Frist kommt aus denselben
 * Konstanten wie beim Schreiben (`packages/shared`, `files.ts`). Rein – für Tests ohne AWS.
 */
import { DATA_RETENTION_DAYS, RETENTION_TAG, retentionValue } from '@nina-pm/shared';

/** Kategorie im Schlüssel → Frist in Tagen; `results` (Transit-Ergebnisse) bleibt unbefristet. */
const CATEGORY_DAYS: Readonly<Record<string, number>> = {
  jobs: DATA_RETENTION_DAYS.jobs,
  exports: DATA_RETENTION_DAYS.exports,
  imports: DATA_RETENTION_DAYS.imports,
  plans: DATA_RETENTION_DAYS.plans,
};

/** Frist für einen Schlüssel; `null` für unbefristete oder unbekannte Objekte. */
export function retentionDaysFor(key: string): number | null {
  const m = /^tenant\/[^/]+\/([^/]+)\//.exec(key);
  if (!m?.[1]) return null;
  return CATEGORY_DAYS[m[1]] ?? null;
}

export interface TagSet {
  readonly Key: string;
  readonly Value: string;
}

/**
 * Neue Tags für ein Objekt: vorhandene bleiben, `npm-retention` kommt dazu; `null`, wenn nichts zu tun ist
 * (unbefristet oder schon gekennzeichnet – ein vorhandener Wert wird nie überschrieben).
 */
export function backfillTags(key: string, existing: readonly TagSet[]): TagSet[] | null {
  const days = retentionDaysFor(key);
  if (days === null) return null;
  if (existing.some((t) => t.Key === RETENTION_TAG)) return null;
  return [...existing, { Key: RETENTION_TAG, Value: retentionValue(days) }];
}

/** Ob das Objekt nach der Kennzeichnung schon abgelaufen ist (die Lebenszyklusregel löscht es beim nächsten Lauf). */
export function expiredAfterTagging(key: string, lastModifiedMs: number, nowMs: number): boolean {
  const days = retentionDaysFor(key);
  return days !== null && nowMs - lastModifiedMs >= days * 86_400_000;
}
