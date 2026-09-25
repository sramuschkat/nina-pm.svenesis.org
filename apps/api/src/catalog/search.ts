/**
 * Suche im Objektkatalog (AP-20; FA-FRM-01, FA-FRM-15): im Speicher über alle Zeilen – Bezeichnungen und
 * Aliase ohne Leerzeichen und Groß-/Kleinschreibung (exakt vor Präfix vor Teilstring), Filter nach
 * Anzeigegruppe, Katalog, Sternbild, Helligkeit (V, sonst B), Flächenhelligkeit, Größe und Bildfeld.
 */
import type { DsoCatalogRow } from '@nina-pm/db';
import {
  designationRank,
  dsoDisplayName,
  dsoTypeGroup,
  squeezeDesignation,
  type DsoQuery,
  type DsoView,
} from '@nina-pm/shared';

export type CatalogRow = DsoCatalogRow & { readonly id: string };

interface Indexed {
  readonly row: CatalogRow;
  readonly displayName: string;
  readonly keys: readonly string[];
  readonly mag: number | null;
}

export function indexCatalog(rows: readonly CatalogRow[]): Indexed[] {
  return rows.map((row) => ({
    row,
    displayName: dsoDisplayName(row.primaryId, row.names),
    keys: [row.primaryId, ...row.names].map(squeezeDesignation),
    mag: row.magV ?? row.magB,
  }));
}

export function toView(x: Indexed): DsoView {
  const r = x.row;
  return {
    id: r.id,
    primaryId: r.primaryId,
    displayName: x.displayName,
    names: [...r.names],
    catalogs: r.catalogs as DsoView['catalogs'],
    objectType: r.objectType as DsoView['objectType'],
    group: dsoTypeGroup(r.objectType),
    constellation: r.constellation,
    raDeg: r.raDeg,
    decDeg: r.decDeg,
    magV: r.magV,
    magB: r.magB,
    magBandUsed: r.magBandUsed,
    surfBrMagArcsec2: r.surfBrMagArcsec2,
    sizeMajorArcmin: r.sizeMajorArcmin,
    sizeMinorArcmin: r.sizeMinorArcmin,
    positionAngleDeg: r.positionAngleDeg,
    source: r.source,
  };
}

const byName = (a: Indexed, b: Indexed) =>
  designationRank(a.displayName) - designationRank(b.displayName) ||
  a.displayName.localeCompare(b.displayName, 'en', { numeric: true });

export function searchDso(
  index: readonly Indexed[],
  q: DsoQuery,
): { items: DsoView[]; total: number } {
  const needle = q.q ? squeezeDesignation(q.q) : '';
  const scored: { x: Indexed; score: number }[] = [];
  for (const x of index) {
    const r = x.row;
    if (q.group && dsoTypeGroup(r.objectType) !== q.group) continue;
    if (q.catalog && !r.catalogs.includes(q.catalog)) continue;
    if (q.constellation && r.constellation?.toLowerCase() !== q.constellation.toLowerCase())
      continue;
    if (q.magMax !== undefined && (x.mag === null || x.mag > q.magMax)) continue;
    if (
      q.surfBrMax !== undefined &&
      (r.surfBrMagArcsec2 === null || r.surfBrMagArcsec2 > q.surfBrMax)
    )
      continue;
    if (
      q.sizeMinArcmin !== undefined &&
      (r.sizeMajorArcmin === null || r.sizeMajorArcmin < q.sizeMinArcmin)
    )
      continue;
    if (
      q.sizeMaxArcmin !== undefined &&
      (r.sizeMajorArcmin === null || r.sizeMajorArcmin > q.sizeMaxArcmin)
    )
      continue;
    if (
      q.fitsFovArcmin !== undefined &&
      (r.sizeMajorArcmin === null || r.sizeMajorArcmin > q.fitsFovArcmin)
    )
      continue;
    let score = 0;
    if (needle) {
      if (x.keys.includes(needle)) score = 3;
      else if (x.keys.some((k) => k.startsWith(needle))) score = 2;
      else if (x.keys.some((k) => k.includes(needle))) score = 1;
      else continue;
    }
    scored.push({ x, score });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (q.sort === 'mag') return (a.x.mag ?? 99) - (b.x.mag ?? 99) || byName(a.x, b.x);
    if (q.sort === 'size')
      return (b.x.row.sizeMajorArcmin ?? -1) - (a.x.row.sizeMajorArcmin ?? -1) || byName(a.x, b.x);
    return byName(a.x, b.x);
  });
  return {
    items: scored.slice(q.offset, q.offset + q.limit).map((s) => toView(s.x)),
    total: scored.length,
  };
}

/** Katalog im Speicher der `api` – höchstens 10 min alt (ändert sich nur per `catalog_refresh`). */
export const CATALOG_CACHE_MS = 10 * 60_000;
let cache: { at: number; index: Indexed[] } | null = null;

export async function cachedCatalog(
  load: () => Promise<CatalogRow[]>,
  now = Date.now(),
): Promise<Indexed[]> {
  if (cache && now - cache.at < CATALOG_CACHE_MS) return cache.index;
  cache = { at: now, index: indexCatalog(await load()) };
  return cache.index;
}

export function clearCatalogCache() {
  cache = null;
}
