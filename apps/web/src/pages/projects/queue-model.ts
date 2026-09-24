/**
 * Reine Hilfen der Warteschlange S-33 (AP-12c; FA-FRG-04/14): Filter „ohne meine Stimme“ und „geändert
 * seit meiner Stimme“, Sortierung je Spalte (Standard = Reihenfolge der API: Stimmen ↓, Rang ↑,
 * Einreichung ↑), abgelaufener Wunschzeitraum gegenüber dem heutigen Datum in Mandantenzeit.
 */
import type { QueueItem } from '../../api/client';

export interface QueueFilters {
  readonly withoutMyVote: boolean;
  readonly changedSinceMyVote: boolean;
}

export const NO_QUEUE_FILTERS: QueueFilters = { withoutMyVote: false, changedSinceMyVote: false };

export function filterQueue(items: readonly QueueItem[], f: QueueFilters): QueueItem[] {
  return items.filter(
    (q) =>
      (!f.withoutMyVote || !q.votes.mine) && (!f.changedSinceMyVote || q.votes.mineChangedSince),
  );
}

export type QueueSortKey =
  'deadline' | 'name' | 'creator' | 'rank' | 'votes' | 'submitted' | 'hours';
export interface QueueSort {
  readonly key: QueueSortKey;
  readonly dir: 'asc' | 'desc';
}

const value = (q: QueueItem, key: QueueSortKey): string | number => {
  switch (key) {
    case 'deadline':
      return q.expiresAt ?? '9999';
    case 'name':
      return q.name.toLocaleLowerCase();
    case 'creator':
      return q.createdByName.toLocaleLowerCase();
    case 'rank':
      return q.submitterRank?.rank ?? Number.MAX_SAFE_INTEGER;
    case 'votes':
      return q.votes.count;
    case 'submitted':
      return q.submittedAt ?? '';
    case 'hours':
      return q.estimatedHours;
  }
};

/** Stabil sortieren; ohne Sortierung bleibt die Reihenfolge der API. */
export function sortQueue(items: readonly QueueItem[], sort: QueueSort | null): QueueItem[] {
  if (!sort) return [...items];
  const sign = sort.dir === 'asc' ? 1 : -1;
  return items
    .map((q, i) => ({ q, i }))
    .sort((a, b) => {
      const x = value(a.q, sort.key);
      const y = value(b.q, sort.key);
      return (x < y ? -1 : x > y ? 1 : 0) * sign || a.i - b.i;
    })
    .map((e) => e.q);
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
