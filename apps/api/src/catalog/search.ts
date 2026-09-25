/**
 * Suche im Objektkatalog (AP-20; FA-FRM-01, FA-FRM-15): im Speicher über alle Zeilen – Bezeichnungen und
 * Aliase ohne Leerzeichen und Groß-/Kleinschreibung (exakt vor Präfix vor Teilstring), Filter nach
 * Anzeigegruppe, Katalog, Sternbild, Helligkeit (V, sonst B), Flächenhelligkeit, Größe und Bildfeld;
 * mit Nachtauswertung (`night.ts`) zusätzlich nach nutzbaren Stunden und bester Höhe, mit Rig-Bildfeld
 * die Bewertung „Beste der Nacht“ (`score.ts`, FA-FRM-13). `searchRegion` liefert das Katalog-Overlay der
 * Sternkarte (FA-FRM-09).
 */
import type { DsoCatalogRow } from '@nina-pm/db';
import {
  designationRank,
  DSO_FAMILIES,
  dsoDisplayName,
  dsoTypeGroup,
  squeezeDesignation,
  type DsoList,
  type DsoQuery,
  type DsoRegion,
  type DsoRegionQuery,
  type DsoTypeGroup,
  type DsoView,
} from '@nina-pm/shared';
import type { NightEvaluator } from './night';
import { filterHint, imagingCandidate, photoScore, WEBSITE_KIND } from './score';

export type CatalogRow = DsoCatalogRow & { readonly id: string };

interface Indexed {
  readonly row: CatalogRow;
  readonly displayName: string;
  readonly keys: readonly string[];
  readonly mag: number | null;
  readonly group: DsoTypeGroup;
  readonly candidate: boolean;
  /** Einheitsvektor (J2000) für die Ausschnittsuche. */
  readonly vec: readonly [number, number, number];
}

export function indexCatalog(rows: readonly CatalogRow[]): Indexed[] {
  return rows.map((row) => {
    const group = dsoTypeGroup(row.objectType);
    const mag = row.magV ?? row.magB;
    const ra = (row.raDeg * Math.PI) / 180;
    const dec = (row.decDeg * Math.PI) / 180;
    return {
      row,
      displayName: dsoDisplayName(row.primaryId, row.names),
      keys: [row.primaryId, ...row.names].map(squeezeDesignation),
      mag,
      group,
      candidate: imagingCandidate({
        primaryId: row.primaryId,
        group,
        sizeMajorArcmin: row.sizeMajorArcmin,
        mag,
      }),
      vec: [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)] as const,
    };
  });
}

/** Bewertung „Beste der Nacht“ (FA-FRM-13); `null` ohne Rig-Bildfeld, ohne Dunkelheit oder für Nicht-Kandidaten. */
function scoreOf(
  x: Indexed,
  night: NightEvaluator | undefined,
  fov: number | undefined,
): number | null {
  const kind = WEBSITE_KIND[x.group];
  if (!night || fov === undefined || kind === null || !x.candidate) return null;
  const w = night.weighted(x.row, kind);
  if (!w) return null;
  return (
    Math.round(photoScore(w.weightedHours, w.darkHours, x.row.sizeMajorArcmin, fov, x.mag) * 1000) /
    1000
  );
}

export function toView(x: Indexed, night?: NightEvaluator, fov?: number): DsoView {
  const r = x.row;
  return {
    id: r.id,
    primaryId: r.primaryId,
    displayName: x.displayName,
    names: [...r.names],
    catalogs: r.catalogs as DsoView['catalogs'],
    objectType: r.objectType as DsoView['objectType'],
    group: x.group,
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
    filterHint: filterHint(x.group),
    night: night ? { ...night.metrics(r), score: scoreOf(x, night, fov) } : null,
  };
}

const byName = (a: Indexed, b: Indexed) =>
  designationRank(a.displayName) - designationRank(b.displayName) ||
  a.displayName.localeCompare(b.displayName, 'en', { numeric: true });

export function searchDso(
  index: readonly Indexed[],
  q: DsoQuery,
  night?: NightEvaluator,
  catalog: DsoList['catalog'] = { version: '', fetchedAt: '1970-01-01' },
): DsoList {
  const needle = q.q ? squeezeDesignation(q.q) : '';
  const scored: { x: Indexed; score: number }[] = [];
  const family: readonly DsoTypeGroup[] | null = q.family ? DSO_FAMILIES[q.family] : null;
  // Bewertung je Objekt einmal je Anfrage (Sortierung vergleicht mehrfach).
  const scores = new Map<Indexed, number | null>();
  const rank = (x: Indexed) => {
    if (!scores.has(x)) scores.set(x, scoreOf(x, night, q.rigFovArcmin));
    return scores.get(x) ?? null;
  };
  for (const x of index) {
    const r = x.row;
    if (q.group && x.group !== q.group) continue;
    if (family && !family.includes(x.group)) continue;
    if (q.candidates === 'true' && !x.candidate) continue;
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
    // Nachtfilter zuletzt – er rechnet die Engine je verbliebenem Objekt.
    if (night && q.minUsableHours !== undefined && night.metrics(r).usableHours < q.minUsableHours)
      continue;
    // „Beste der Nacht“: nur bewertete Objekte, die im Dunkeln mindestens 20° hoch stehen (Website-Regel).
    if (q.sort === 'score') {
      if (rank(x) === null || (night?.metrics(r).peakAltDeg ?? -90) < 20) continue;
    }
    scored.push({ x, score });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (q.sort === 'mag') return (a.x.mag ?? 99) - (b.x.mag ?? 99) || byName(a.x, b.x);
    if (q.sort === 'size')
      return (b.x.row.sizeMajorArcmin ?? -1) - (a.x.row.sizeMajorArcmin ?? -1) || byName(a.x, b.x);
    if (night && q.sort === 'usable')
      return (
        night.metrics(b.x.row).usableHours - night.metrics(a.x.row).usableHours ||
        (night.metrics(b.x.row).peakAltDeg ?? -90) - (night.metrics(a.x.row).peakAltDeg ?? -90) ||
        byName(a.x, b.x)
      );
    if (q.sort === 'score') return (rank(b.x) ?? -1) - (rank(a.x) ?? -1) || byName(a.x, b.x);
    if (night && q.sort === 'altitude')
      return (
        (night.metrics(b.x.row).peakAltDeg ?? -90) - (night.metrics(a.x.row).peakAltDeg ?? -90) ||
        byName(a.x, b.x)
      );
    return byName(a.x, b.x);
  });
  return {
    items: scored
      .slice(q.offset, q.offset + q.limit)
      .map((s) => toView(s.x, night, q.rigFovArcmin)),
    total: scored.length,
    night: night ? { ...night.meta } : null,
    catalog,
  };
}

/**
 * Katalog-Overlay der Sternkarte (FA-FRM-09): Objekte im Umkreis `radius` um `ra/dec`, heller als `magMax`
 * (ohne Helligkeit wie 12 mag), hellste und größte zuerst, höchstens `limit`.
 */
export function searchRegion(index: readonly Indexed[], q: DsoRegionQuery): DsoRegion {
  const ra = (q.ra * Math.PI) / 180;
  const dec = (q.dec * Math.PI) / 180;
  const c = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)] as const;
  const minDot = Math.cos((q.radius * Math.PI) / 180);
  const hits = index.filter(
    (x) =>
      x.vec[0] * c[0] + x.vec[1] * c[1] + x.vec[2] * c[2] >= minDot && (x.mag ?? 12) <= q.magMax,
  );
  hits.sort(
    (a, b) =>
      (a.mag ?? 12) - (b.mag ?? 12) ||
      (b.row.sizeMajorArcmin ?? 0) - (a.row.sizeMajorArcmin ?? 0) ||
      byName(a, b),
  );
  return {
    total: hits.length,
    items: hits.slice(0, q.limit).map((x) => ({
      id: x.row.id,
      primaryId: x.row.primaryId,
      displayName: x.displayName,
      group: x.group,
      raDeg: x.row.raDeg,
      decDeg: x.row.decDeg,
      mag: x.mag,
      sizeMajorArcmin: x.row.sizeMajorArcmin,
      sizeMinorArcmin: x.row.sizeMinorArcmin,
      positionAngleDeg: x.row.positionAngleDeg,
    })),
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
