/**
 * Sortierkette (`specs/engine/sort-chain.md`; SE `ApplySortChain` 1543–1570). Stabil nach den Schlüsseln
 * der Reihe nach, letzter Tie-Break die Matrix-Reihenfolge; Metriken live zum Zeitpunkt des Durchlaufs.
 */
import type { SortChainKey } from './grid';
import { rowLaWork, rowTotalWork, type Row } from './model';

type Key = (r: Row) => number | string;

const INF = Number.POSITIVE_INFINITY;

function keyOf(k: SortChainKey, fullTieBreaks: boolean): Key {
  switch (k) {
    case 'lowest_peak_altitude':
      return (r) => r.peakAltitude;
    case 'setting_soonest':
      return (r) => r.lastUsableSlot;
    case 'most_remaining':
      return (r) => -rowTotalWork(r);
    case 'constrained':
      return (r) => (r.isConstrained ? 0 : 1);
    case 'most_moon_limited':
      return (r) => -rowLaWork(r);
    case 'mosaic_grouping':
      // Original: `Target.Id` (Reihenfolge des Projekts); produktiv Projekt-ID (ordinal).
      return fullTieBreaks ? (r) => r.profile.projectId : (r) => r.profile.projectOrdinal;
    case 'card_order':
      return (r) => r.userPriorityIndex;
    case 'due_soonest':
      // Ohne Termin zuletzt; `YYYY-MM-DD` sortiert ordinal wie chronologisch.
      return (r) => r.profile.dueDate ?? '\uffff';
  }
}

function compare(a: number | string, b: number | string): number {
  if (typeof a === 'number' && typeof b === 'number') {
    if (a === b) return 0;
    if (a === INF) return 1;
    if (b === INF) return -1;
    return a < b ? -1 : 1;
  }
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Stabile Sortierung (Array.prototype.sort ist stabil, ES2019) nach den Schlüsseln der Kette. */
export function applySortChain(
  rows: readonly Row[],
  chain: readonly SortChainKey[],
  fullTieBreaks: boolean,
): Row[] {
  if (rows.length <= 1 || chain.length === 0) return [...rows];
  const keys = chain.map((k) => keyOf(k, fullTieBreaks));
  const decorated = rows.map((r, i) => ({ r, i, v: keys.map((f) => f(r)) }));
  decorated.sort((a, b) => {
    for (let k = 0; k < keys.length; k++) {
      const c = compare(a.v[k] as number | string, b.v[k] as number | string);
      if (c !== 0) return c;
    }
    return a.i - b.i;
  });
  return decorated.map((d) => d.r);
}

/** `moonDownChain = [most_moon_limited] + sortChain ohne most_moon_limited`. */
export function moonDownChain(chain: readonly SortChainKey[]): SortChainKey[] {
  return ['most_moon_limited', ...chain.filter((k) => k !== 'most_moon_limited')];
}

/** Gruppenschlüssel einer Mosaik-Gruppe (§5.2 A-15); eine Gruppe aus einer Zeile = deren Schlüssel. */
function groupKeyOf(
  k: SortChainKey,
  fullTieBreaks: boolean,
): (g: readonly Row[]) => number | string {
  const min = (xs: number[]) => Math.min(...xs);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  switch (k) {
    case 'lowest_peak_altitude':
      return (g) => min(g.map((r) => r.peakAltitude));
    case 'setting_soonest':
      return (g) => min(g.map((r) => r.lastUsableSlot));
    case 'most_remaining':
      return (g) => -sum(g.map(rowTotalWork));
    case 'constrained':
      return (g) => (g.some((r) => r.isConstrained) ? 0 : 1);
    case 'most_moon_limited':
      return (g) => -sum(g.map(rowLaWork));
    case 'mosaic_grouping':
      return (g) =>
        fullTieBreaks ? (g[0]?.profile.projectId ?? '') : (g[0]?.profile.projectOrdinal ?? 0);
    case 'card_order':
      return (g) => min(g.map((r) => r.userPriorityIndex));
    case 'due_soonest':
      return (g) => g[0]?.profile.dueDate ?? '\uffff';
  }
}

/**
 * Gruppen (A-15) nach den Gruppenschlüsseln der Kette ordnen; letzter Tie-Break Projekt-ID, dann
 * Matrix-Reihenfolge des ersten Mitglieds.
 */
export function sortGroups(
  groups: readonly (readonly Row[])[],
  chain: readonly SortChainKey[],
  fullTieBreaks: boolean,
): (readonly Row[])[] {
  const keys = chain.map((k) => groupKeyOf(k, fullTieBreaks));
  const decorated = groups.map((g) => ({ g, v: keys.map((f) => f(g)) }));
  decorated.sort((a, b) => {
    for (let k = 0; k < keys.length; k++) {
      const c = compare(a.v[k] as number | string, b.v[k] as number | string);
      if (c !== 0) return c;
    }
    const pa = a.g[0]?.profile.projectId ?? '';
    const pb = b.g[0]?.profile.projectId ?? '';
    if (pa !== pb) return pa < pb ? -1 : 1;
    return (a.g[0]?.index ?? 0) - (b.g[0]?.index ?? 0);
  });
  return decorated.map((d) => d.g);
}
