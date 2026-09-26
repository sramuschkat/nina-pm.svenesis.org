/**
 * Reine Hilfen des Bausteins `DataTable` (components.md §2.11, AP-26a): Sortierung (stabil, `null`
 * zuletzt, Zeichenketten natürlich), Umschalten auf/ab/aus, Reihenfolge des Ausblendens nach Priorität.
 */

export type SortDir = 'asc' | 'desc';
export interface SortState {
  readonly id: string;
  readonly dir: SortDir;
}

export type SortValue = string | number | boolean | null | undefined;

/** Klick auf einen Spaltenkopf: aus → auf → ab → aus; eine andere Spalte beginnt mit auf. */
export function nextSort(current: SortState | null, id: string): SortState | null {
  if (!current || current.id !== id) return { id, dir: 'asc' };
  return current.dir === 'asc' ? { id, dir: 'desc' } : null;
}

const isEmpty = (v: SortValue) => v === null || v === undefined || v === '';

/** Vergleich zweier Werte; leere Werte liegen unabhängig von der Richtung immer hinten. */
export function compareValues(a: SortValue, b: SortValue, dir: SortDir, collator: Intl.Collator) {
  const ea = isEmpty(a);
  const eb = isEmpty(b);
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
  let c: number;
  if (typeof a === 'string' && typeof b === 'string') c = collator.compare(a, b);
  else c = Number(a) - Number(b);
  return dir === 'asc' ? c : -c;
}

/** Stabile Sortierung einer Liste nach dem Wert einer Spalte. */
export function sortRows<T>(
  rows: readonly T[],
  value: (row: T) => SortValue,
  dir: SortDir,
  lang: string,
): T[] {
  const collator = new Intl.Collator(lang, { numeric: true, sensitivity: 'base' });
  return rows
    .map((row, index) => ({ row, index, v: value(row) }))
    .sort((x, y) => compareValues(x.v, y.v, dir, collator) || x.index - y.index)
    .map((x) => x.row);
}

/**
 * Reihenfolge des Ausblendens: zuerst die höchste Priorität (unwichtigste Spalte), bei gleicher
 * Priorität die weiter rechts stehende. Priorität 1 (Standard) wird nie ausgeblendet.
 */
export function hideOrder(columns: readonly { id: string; priority?: number }[]): string[] {
  return columns
    .map((c, index) => ({ id: c.id, p: c.priority ?? 1, index }))
    .filter((c) => c.p > 1)
    .sort((a, b) => b.p - a.p || b.index - a.index)
    .map((c) => c.id);
}
