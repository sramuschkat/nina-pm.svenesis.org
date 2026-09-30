/**
 * Dubletten über die Kataloge zusammenführen (FA-EXO-03, AP-40): Vorrang ExoClock → NASA → TOI. Gespeichert wird
 * je Katalog (`exo_catalog_entry`, UNIQUE(catalog, planet)); zusammengeführt wird beim Lesen für die Transitsuche.
 * - ExoClock ↔ NASA über den Planetennamen ohne Leerzeichen (`HAT-P-17b` = `HAT-P-17 b`, `HD209458b` = `HD 209458 b`).
 * - TOI ↔ NASA/ExoClock über die **TIC-Kennung und die Periode** (±1 %): ein Stern trägt oft mehrere Planeten, die
 *   TIC allein würde TOI-x.01 und .02 auf denselben Planeten legen. Einer ExoClock-Zeile fehlt die TIC; sie erbt sie
 *   von der gleichnamigen NASA-Zeile.
 */
export interface MergeableEntry {
  readonly catalog: 'exoclock' | 'nasa' | 'toi';
  readonly planet: string;
  readonly periodD: number;
  readonly ticId: string | null;
}

export type MergedEntry<T extends MergeableEntry> = T & {
  /** Übrige Kataloge, in denen derselbe Planet steht (für „Katalog“ und Recherche-Links, FA-EXO-06/09). */
  readonly alsoIn: readonly MergeableEntry['catalog'][];
  /** Die nachrangigen Einträge desselben Planeten (Kenndaten auffüllen, die dem führenden fehlen). */
  readonly others: readonly T[];
};

const RANK: Record<MergeableEntry['catalog'], number> = { exoclock: 0, nasa: 1, toi: 2 };

/** Namensschlüssel: Großschreibung, ohne Leerzeichen und Unterstriche. */
export function planetKey(name: string): string {
  return name.toUpperCase().replace(/[\s_]/g, '');
}

const samePeriod = (a: number, b: number) => Math.abs(a - b) <= 0.01 * Math.max(a, b);

export function mergeExoEntries<T extends MergeableEntry>(entries: readonly T[]): MergedEntry<T>[] {
  const sorted = [...entries].sort(
    (a, b) =>
      RANK[a.catalog] - RANK[b.catalog] || (a.planet < b.planet ? -1 : a.planet > b.planet ? 1 : 0),
  );
  const groups: {
    lead: T;
    tic: string | null;
    period: number;
    also: Set<T['catalog']>;
    others: T[];
  }[] = [];
  const byName = new Map<string, (typeof groups)[number]>();
  for (const e of sorted) {
    const key = planetKey(e.planet);
    let group = e.catalog === 'toi' ? undefined : byName.get(key);
    if (!group && e.ticId !== null)
      group = groups.find(
        (g) => g.tic === e.ticId && g.lead.catalog !== e.catalog && samePeriod(g.period, e.periodD),
      );
    if (group) {
      if (group.lead.catalog !== e.catalog) group.also.add(e.catalog);
      group.others.push(e);
      group.tic ??= e.ticId;
      if (e.catalog !== 'toi') byName.set(key, group);
      continue;
    }
    const created = {
      lead: e,
      tic: e.ticId,
      period: e.periodD,
      also: new Set<T['catalog']>(),
      others: [] as T[],
    };
    groups.push(created);
    if (e.catalog !== 'toi') byName.set(key, created);
  }
  return groups.map((g) => ({
    ...g.lead,
    alsoIn: [...g.also].sort((a, b) => RANK[a] - RANK[b]),
    others: g.others,
  }));
}
