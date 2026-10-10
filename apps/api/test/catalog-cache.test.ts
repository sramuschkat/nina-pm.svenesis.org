/**
 * Katalog im Speicher der `api` (Performance 10.10.2026): nach Ablauf prüft der Stand statt neu zu laden, ein
 * geänderter Stand lädt neu, gleichzeitige Fehltreffer laden einmal.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CATALOG_CACHE_MS,
  cachedCatalogInfo,
  clearCatalogCache,
  type CatalogRow,
} from '../src/catalog/search';

const row = (primaryId: string): CatalogRow => ({
  id: primaryId,
  primaryId,
  names: [],
  catalogs: ['NGC'],
  objectType: 'G',
  constellation: 'And',
  raDeg: 10,
  decDeg: 41,
  magV: 9,
  magB: null,
  magBandUsed: 'V',
  surfBrMagArcsec2: null,
  sizeMajorArcmin: 10,
  sizeMinorArcmin: 5,
  positionAngleDeg: 30,
  source: 'test',
});

beforeEach(() => clearCatalogCache());

describe('cachedCatalogInfo', () => {
  it('Treffer, nach Ablauf Stand prüfen statt laden, bei neuem Stand neu laden', async () => {
    let loads = 0;
    let stamps = 0;
    let stamp = 's1';
    const load = () => {
      loads += 1;
      return Promise.resolve([row(`NGC ${String(loads)}`)]);
    };
    const check = () => {
      stamps += 1;
      return Promise.resolve(stamp);
    };
    const first = await cachedCatalogInfo(load, 0, check);
    expect([first.cache, loads]).toEqual(['loaded', 1]);
    expect((await cachedCatalogInfo(load, CATALOG_CACHE_MS - 1, check)).cache).toBe('hit');
    const later = await cachedCatalogInfo(load, CATALOG_CACHE_MS + 1, check);
    expect([later.cache, loads, later.index]).toEqual(['revalidated', 1, first.index]);
    // Geprüft verlängert: bis zum nächsten Ablauf wieder Treffer ohne Abfrage.
    const checked = stamps;
    expect((await cachedCatalogInfo(load, 2 * CATALOG_CACHE_MS, check)).cache).toBe('hit');
    expect(stamps).toBe(checked);
    stamp = 's2';
    const changed = await cachedCatalogInfo(load, 3 * CATALOG_CACHE_MS + 2, check);
    expect([changed.cache, loads, changed.index[0]?.row.primaryId]).toEqual(['loaded', 2, 'NGC 2']);
  });

  it('gleichzeitige Fehltreffer laden einmal; ein Fehler lässt den nächsten Versuch laden', async () => {
    let loads = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const load = async () => {
      loads += 1;
      await gate;
      return [row('M 31')];
    };
    const both = Promise.all([cachedCatalogInfo(load, 0), cachedCatalogInfo(load, 0)]);
    release();
    const [a, b] = await both;
    expect(loads).toBe(1);
    expect(a.index).toBe(b.index);

    clearCatalogCache();
    await expect(cachedCatalogInfo(() => Promise.reject(new Error('DSQL')), 0)).rejects.toThrow(
      'DSQL',
    );
    expect((await cachedCatalogInfo(load, 0)).cache).toBe('loaded');
  });
});
