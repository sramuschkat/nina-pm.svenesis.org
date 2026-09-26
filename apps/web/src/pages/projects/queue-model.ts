/**
 * Reine Hilfen der Warteschlange S-33 (AP-12c; FA-FRG-04/14): Filter „ohne meine Stimme“ und „geändert
 * seit meiner Stimme“, Sortierung je Spalte (Standard = Reihenfolge der API: Stimmen ↓, Rang ↑,
 * Einreichung ↑), abgelaufener Wunschzeitraum gegenüber dem heutigen Datum in Mandantenzeit.
 */
import type { QueueItem } from '../../api/client';
import { effortKey } from './list-model';

export interface QueueFilters {
  readonly withoutMyVote: boolean;
  readonly changedSinceMyVote: boolean;
  /** Aufwand-Kennzeichen (FA-FRG-04, AP-13e); Werte wie `EFFORT_FILTERS`. */
  readonly effort: string;
}

export const NO_QUEUE_FILTERS: QueueFilters = {
  withoutMyVote: false,
  changedSinceMyVote: false,
  effort: '',
};

export function filterQueue(items: readonly QueueItem[], f: QueueFilters): QueueItem[] {
  return items.filter(
    (q) =>
      (!f.withoutMyVote || !q.votes.mine) &&
      (!f.changedSinceMyVote || q.votes.mineChangedSince) &&
      (!f.effort || effortKey(q.effort) === f.effort),
  );
}

export type QueueSortKey =
  'deadline' | 'name' | 'creator' | 'rank' | 'votes' | 'submitted' | 'hours';
/** Sortierwert je Spalte der Warteschlange (DataTable, AP-26a); leere Werte sortiert der Baustein zuletzt. */
export function queueSortValue(q: QueueItem, key: QueueSortKey): string | number | null {
  switch (key) {
    case 'deadline':
      return q.expiresAt;
    case 'name':
      return q.name;
    case 'creator':
      return q.createdByName;
    case 'rank':
      return q.submitterRank?.rank ?? null;
    case 'votes':
      return q.votes.count;
    case 'submitted':
      return q.submittedAt;
    case 'hours':
      return q.estimatedHours;
  }
}

/** Kalenderdatum `YYYY-MM-DD` eines Zeitpunkts in der Zone (Anzeige-Vergleich, kein Datumsrechnen). */
export function nightKeyIn(atMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(atMs);
}

/** Wunschzeitraum abgelaufen (FA-FRG-04 „abgelaufener Wunschzeitraum wird markiert“). */
export function periodExpired(q: Pick<QueueItem, 'requestPeriodTo'>, today: string): boolean {
  return q.requestPeriodTo !== null && q.requestPeriodTo < today;
}
