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

/** Zustand der Filterleiste; Zahlen als Text wie im Eingabefeld (leer = kein Filter). */
export interface BrowserFilters {
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
  view: 'list' | 'gallery';
  page: number;
}

const KEYS: Record<keyof BrowserFilters, string> = {
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
  view: 'ansicht',
  page: 'seite',
};

export const DEFAULT_MIN_ALT = 30;

export function filtersFromParams(p: URLSearchParams): BrowserFilters {
  const get = (k: keyof BrowserFilters) => p.get(KEYS[k]) ?? '';
  const sort = get('sort') as Sort;
  const group = get('group');
  const catalog = get('catalog');
  return {
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
