/**
 * Objektbrowser S-21 (AP-20): Filter ↔ URL-Parameter, Seitenzählung, Aliase und Bildfeld – ohne
 * React, damit die Regeln einzeln testbar sind.
 */
import { designationPrefix, DSO_TYPE_GROUPS, dsoCatalogPrefixes } from '@nina-pm/shared';
import type { DsoSearch, DsoView } from '../../api/client';

export const CATALOG_PATH = '/planung/objekte';
export const PAGE_SIZE = 50;
export const SORTS = ['name', 'mag', 'size', 'usable', 'altitude'] as const;
export type Sort = (typeof SORTS)[number];
/** Sortierungen, die Nachtwerte brauchen (nur mit Rig). */
export const NIGHT_SORTS: readonly Sort[] = ['usable', 'altitude'];
/** Natürliche Richtung je Sortierung (wie der Server, `search.ts`). */
export const NATURAL_DIR: Readonly<Record<Sort | 'score', 'asc' | 'desc'>> = {
  name: 'asc',
  mag: 'asc',
  size: 'desc',
  usable: 'desc',
  altitude: 'desc',
  score: 'desc',
};

/** Zustand der Filterleiste; Zahlen als Text wie im Eingabefeld (leer = kein Filter). */
export interface BrowserFilters {
  /** Reiter *Alle Objekte* bzw. *Beste der Nacht* (FA-FRM-13). */
  tab: 'all' | 'best';
  family: '' | 'galaxies' | 'nebulae' | 'clusters';
  q: string;
  group: string;
  catalog: string;
  constellation: string;
  magMax: string;
  surfBrMax: string;
  sizeMin: string;
  sizeMax: string;
  rig: string;
  night: string;
  minAlt: string;
  minHours: string;
  fits: boolean;
  sort: Sort;
  /** Richtung per Spaltenkopf (AP-26a); leer = natürliche Richtung der Sortierung. */
  dir: '' | 'asc' | 'desc';
  view: 'list' | 'gallery';
  page: number;
}

const KEYS: Record<keyof BrowserFilters, string> = {
  tab: 'reiter',
  family: 'familie',
  q: 'q',
  group: 'typ',
  catalog: 'katalog',
  constellation: 'sternbild',
  magMax: 'mag',
  surfBrMax: 'sb',
  sizeMin: 'groesseAb',
  sizeMax: 'groesseBis',
  rig: 'rig',
  night: 'nacht',
  minAlt: 'hoehe',
  minHours: 'stunden',
  fits: 'bildfeld',
  sort: 'sort',
  dir: 'richtung',
  view: 'ansicht',
  page: 'seite',
};

export const DEFAULT_MIN_ALT = 30;

export function filtersFromParams(p: URLSearchParams): BrowserFilters {
  const get = (k: keyof BrowserFilters) => p.get(KEYS[k]) ?? '';
  const sort = get('sort') as Sort;
  const group = get('group');
  const catalog = get('catalog');
  const family = get('family');
  return {
    // „Beste der Nacht“ ist der erste Reiter und Standard (Wunsch Sven 26.09.2026); `alle` wählt die Liste.
    tab: get('tab') === 'alle' ? 'all' : 'best',
    family: family === 'galaxies' || family === 'nebulae' || family === 'clusters' ? family : '',
    q: get('q'),
    group: (DSO_TYPE_GROUPS as readonly string[]).includes(group) ? group : '',
    catalog: (dsoCatalogPrefixes as readonly string[]).includes(catalog) ? catalog : '',
    constellation: get('constellation'),
    magMax: get('magMax'),
    surfBrMax: get('surfBrMax'),
    sizeMin: get('sizeMin'),
    sizeMax: get('sizeMax'),
    rig: get('rig'),
    night: get('night'),
    minAlt: get('minAlt'),
    minHours: get('minHours'),
    fits: get('fits') === '1',
    sort: SORTS.includes(sort) ? sort : 'name',
    dir: get('dir') === 'asc' || get('dir') === 'desc' ? (get('dir') as 'asc' | 'desc') : '',
    view: get('view') === 'galerie' ? 'gallery' : 'list',
    page: Math.max(1, Number.parseInt(get('page') || '1', 10) || 1),
  };
}

/** Nur abweichende Werte in die URL (teilbare Links, Zurück-Taste). */
export function paramsFromFilters(f: BrowserFilters): URLSearchParams {
  const p = new URLSearchParams();
  const set = (k: keyof BrowserFilters, v: string) => {
    if (v !== '') p.set(KEYS[k], v);
  };
  if (f.tab === 'all') p.set(KEYS.tab, 'alle');
  set('family', f.family);
  set('q', f.q.trim());
  set('group', f.group);
  set('catalog', f.catalog);
  set('constellation', f.constellation);
  set('magMax', f.magMax);
  set('surfBrMax', f.surfBrMax);
  set('sizeMin', f.sizeMin);
  set('sizeMax', f.sizeMax);
  set('rig', f.rig);
  set('night', f.night);
  set('minAlt', f.minAlt);
  set('minHours', f.minHours);
  if (f.fits) p.set(KEYS.fits, '1');
  if (f.sort !== 'name') p.set(KEYS.sort, f.sort);
  set('dir', f.dir);
  if (f.view === 'gallery') p.set(KEYS.view, 'galerie');
  if (f.page > 1) p.set(KEYS.page, String(f.page));
  return p;
}

const num = (s: string): number | undefined => {
  if (s.trim() === '') return undefined;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};

/** Anfrage an `GET /web/v1/dso`; Nachtwerte nur mit Standort. */
export function searchFromFilters(
  f: BrowserFilters,
  ctx: { siteId: string | null; night: string | null; fovArcmin: number | null },
): DsoSearch {
  const withNight = ctx.siteId !== null;
  const sort = !withNight && NIGHT_SORTS.includes(f.sort) ? 'name' : f.sort;
  const s: DsoSearch = { sort, limit: PAGE_SIZE, offset: (f.page - 1) * PAGE_SIZE };
  if (f.dir) s.dir = f.dir;
  // Beste der Nacht: Bewertung der Website mit dem Bildfeld des Rigs, nur Bildkandidaten.
  if (f.tab === 'best' && withNight && ctx.fovArcmin !== null) {
    s.sort = 'score';
    s.candidates = 'true';
    s.rigFovArcmin = Math.round(ctx.fovArcmin * 10) / 10;
    if (f.family) s.family = f.family;
  }
  if (f.q.trim()) s.q = f.q.trim();
  if (f.group) s.group = f.group;
  if (f.catalog) s.catalog = f.catalog;
  if (f.constellation) s.constellation = f.constellation;
  const opt = (k: keyof DsoSearch, v: string) => {
    const n = num(v);
    if (n !== undefined) (s as Record<string, unknown>)[k] = n;
  };
  opt('magMax', f.magMax);
  opt('surfBrMax', f.surfBrMax);
  opt('sizeMinArcmin', f.sizeMin);
  opt('sizeMaxArcmin', f.sizeMax);
  if (f.fits && ctx.fovArcmin !== null) s.fitsFovArcmin = Math.round(ctx.fovArcmin * 10) / 10;
  if (withNight) {
    s.siteId = ctx.siteId ?? undefined;
    if (ctx.night) s.night = ctx.night;
    s.minAltDeg = num(f.minAlt) ?? DEFAULT_MIN_ALT;
    opt('minUsableHours', f.minHours);
  }
  return s;
}

/** Kleinere Kante des Bildfelds in Bogenminuten – „passt ins Bildfeld“ vergleicht die Großachse damit. */
export const fovArcmin = (fovDeg: readonly [number, number]) => Math.min(fovDeg[0], fovDeg[1]) * 60;

export const pageCount = (total: number) => Math.max(1, Math.ceil(total / PAGE_SIZE));

/** Weitere Bezeichnungen ohne den Anzeigenamen; Trivialnamen getrennt. */
export function aliasesOf(o: Pick<DsoView, 'primaryId' | 'displayName' | 'names'>) {
  const all = [o.primaryId, ...o.names].filter((n) => n !== o.displayName);
  return {
    designations: [...new Set(all.filter((n) => designationPrefix(n) !== null))],
    common: all.filter((n) => designationPrefix(n) === null),
  };
}
