/**
 * AP-20 (FA-FRM-01, FA-FRM-15, S-21, S-82; T-KAT-11; PGlite): Job `catalog_refresh` mit dem echten
 * Katalog – zweiter Lauf ändert außer `updated_at` nichts, `id` bleibt, doppelte `primary_id` bricht ab;
 * Suche über Bezeichnung, Alias und Trivialnamen, Filter und Sortierung; Stand und Neuimport in S-82.
 */
import catalog from '@nina-pm/catalog-data/openngc/dso-objects.json' with { type: 'json' };
import type { DsoCatalogRow } from '@nina-pm/db';
import { COOKIE_NAMES, type DsoList } from '@nina-pm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clearCatalogCache } from '../src/catalog/search';
import { catalogRefreshHandler } from '../src/worker/catalog';
import { createStack, type Stack } from './support/stack';

const file = catalog as unknown as {
  version: string;
  counts: { rows: number };
  rows: DsoCatalogRow[];
};
const ctx = {} as Parameters<ReturnType<typeof catalogRefreshHandler>>[0];

let s: Stack;
let tenantCookies: Record<string, string>;
let systemCookies: Record<string, string>;

const snapshot = async () =>
  (await s.pg.admin.query('SELECT * FROM dso_object ORDER BY primary_id')).rows as Record<
    string,
    unknown
  >[];

beforeAll(async () => {
  s = await createStack();
  clearCatalogCache();
  const tenantId = await s.seed.tenant('alpha');
  const identity = await s.seed.identity({ mfaEnabled: true });
  await s.seed.member(identity.id, tenantId, 'user');
  tenantCookies = { [COOKIE_NAMES.session]: await s.seed.session(identity.id, tenantId, 'tenant') };
  const sven = await s.seed.identity({ mfaEnabled: true, username: 'sven' });
  await s.seed.superUser(sven.id);
  systemCookies = { [COOKIE_NAMES.session]: await s.seed.session(sven.id, null, 'system') };
  await catalogRefreshHandler({ db: () => Promise.resolve(s.pg.db) })(ctx);
}, 120_000);
afterAll(() => s.close());

describe('catalog_refresh (T-KAT-11)', () => {
  it('schreibt jede Zeile der Katalogdatei genau einmal', async () => {
    const count = await s.pg.admin.query('SELECT count(*)::int AS n FROM dso_object');
    expect((count.rows[0] as { n: number }).n).toBe(file.counts.rows);
  });

  it('zweiter Lauf ändert außer updated_at keine Zeile, id bleibt', async () => {
    const before = await snapshot();
    await catalogRefreshHandler({
      db: () => Promise.resolve(s.pg.db),
      now: () => new Date(Date.now() + 60_000),
    })(ctx);
    const after = await snapshot();
    const strip = (rows: Record<string, unknown>[]) =>
      rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'updated_at')));
    expect(strip(after)).toEqual(strip(before));
    expect(
      after.every(
        (r, i) =>
          new Date(r.updated_at as string).getTime() >
          new Date(before[i]?.updated_at as string).getTime(),
      ),
    ).toBe(true);
  }, 120_000);

  it('bricht bei doppelter primary_id vor dem ersten Schreiben ab', async () => {
    const [a, b] = file.rows as [DsoCatalogRow, DsoCatalogRow];
    const rows = [a, { ...b, primaryId: a.primaryId }];
    const before = await snapshot();
    await expect(
      catalogRefreshHandler(
        { db: () => Promise.resolve(s.pg.db) },
        { version: 'x', counts: { rows: 2 }, rows },
      )(ctx),
    ).rejects.toThrow(/Doppelte primary_id/);
    expect(await snapshot()).toEqual(before);
  });

  it('bricht bei unvollständiger Datei ab', async () => {
    await expect(
      catalogRefreshHandler(
        { db: () => Promise.resolve(s.pg.db) },
        { version: 'x', counts: { rows: 3 }, rows: file.rows.slice(0, 2) },
      )(ctx),
    ).rejects.toThrow(/unvollständig/);
  });
});

describe('GET /api/web/v1/dso (FA-FRM-15, S-21)', () => {
  const search = async (query: string) => {
    const res = await s.request(`/api/web/v1/dso?${query}`, { cookies: tenantCookies });
    expect(res.status, query).toBe(200);
    return (await res.json()) as DsoList;
  };

  it('findet über Bezeichnung, Alias und Trivialnamen; Schlüssel bleibt die OpenNGC-Bezeichnung', async () => {
    // §3 Nr. 4: primary_id `NGC 224`, Anzeigename `M 31`.
    for (const q of ['M%2031', 'm31', 'NGC%20224', 'ngc224'])
      expect((await search(`q=${q}`)).items[0], q).toMatchObject({
        primaryId: 'NGC 224',
        displayName: expect.stringMatching(/^M 31/) as unknown,
        group: 'galaxy',
        constellation: 'And',
        magBandUsed: 'V',
      });
    expect((await search('q=Andromeda')).items.map((i) => i.primaryId)).toContain('NGC 224');
    expect((await search('q=M%20102')).items[0]?.primaryId).toBe('NGC 5866');
  });

  it('filtert nach Gruppe, Katalog, Sternbild und Helligkeit und sortiert', async () => {
    const r = await search('group=galaxy&catalog=M&constellation=Vir&magMax=10&sort=mag');
    expect(r.total).toBeGreaterThan(0);
    for (const i of r.items) {
      expect(i.group).toBe('galaxy');
      expect(i.catalogs).toContain('M');
      expect(i.constellation).toBe('Vir');
      expect(i.magV ?? i.magB ?? 99).toBeLessThanOrEqual(10);
    }
    const mags = r.items.map((i) => i.magV ?? i.magB ?? 99);
    expect(mags).toEqual([...mags].sort((a, b) => a - b));
  });

  it('„passt ins Bildfeld“ lässt nur Objekte mit Großachse ≤ Bildfeld zu', async () => {
    const r = await search('fitsFovArcmin=30&catalog=M&limit=100');
    expect(r.items.length).toBeGreaterThan(0);
    for (const i of r.items) expect(i.sizeMajorArcmin ?? 0).toBeLessThanOrEqual(30);
    expect(r.items.map((i) => i.primaryId)).not.toContain('NGC 224');
  });

  it('blättert mit limit/offset und meldet die Gesamtzahl', async () => {
    const a = await search('catalog=NGC&limit=20&offset=0&sort=name');
    const b = await search('catalog=NGC&limit=20&offset=20&sort=name');
    expect(a.total).toBe(b.total);
    expect(a.items).toHaveLength(20);
    expect(a.items.map((i) => i.id)).not.toContain(b.items[0]?.id);
  });

  it('lehnt ungültige Filter mit 422 ab', async () => {
    const res = await s.request('/api/web/v1/dso?limit=1000', { cookies: tenantCookies });
    expect(res.status).toBe(422);
  });
});

describe('S-82 Kataloge', () => {
  it('meldet Version, Quellzeilen und Zeilen', async () => {
    const res = await s.request('/api/system/v1/catalogs', { cookies: systemCookies });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      dso: { version: string; rows: number; expectedRows: number; ngcCsvRows: number };
    };
    expect(body.dso.version).toBe(file.version);
    expect(body.dso.rows).toBe(body.dso.expectedRows);
    expect(body.dso.ngcCsvRows).toBe(13969);
  });

  it('Neuimport legt genau einen offenen Job an (Deduplizierung)', async () => {
    const first = await s.request('/api/system/v1/catalogs/dso/refresh', {
      method: 'POST',
      cookies: systemCookies,
    });
    const second = await s.request('/api/system/v1/catalogs/dso/refresh', {
      method: 'POST',
      cookies: systemCookies,
    });
    expect(first.status).toBe(202);
    const a = (await first.json()) as { jobId: string };
    const b = (await second.json()) as { jobId: string };
    expect(b.jobId).toBe(a.jobId);
    const status = (await (
      await s.request('/api/system/v1/catalogs', { cookies: systemCookies })
    ).json()) as { dso: { lastJob: { id: string; status: string } | null } };
    expect(status.dso.lastJob).toMatchObject({ id: a.jobId, status: 'pending' });
  });
});
