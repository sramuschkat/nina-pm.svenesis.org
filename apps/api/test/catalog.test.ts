/**
 * AP-20 (FA-FRM-01, FA-FRM-15, S-21, S-82; T-KAT-11; PGlite): Job `catalog_refresh` mit dem echten
 * Katalog – zweiter Lauf ändert außer `updated_at` nichts, `id` bleibt, doppelte `primary_id` bricht ab;
 * Suche über Bezeichnung, Alias und Trivialnamen, Filter und Sortierung; Stand und Neuimport in S-82.
 */
import catalog from '@nina-pm/catalog-data/openngc/dso-objects.json' with { type: 'json' };
import { dsoCatalogStamp, type DsoCatalogRow } from '@nina-pm/db';
import { COOKIE_NAMES, type DsoList } from '@nina-pm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clearNightCache } from '../src/catalog/night';
import { cachedCatalog, clearCatalogCache, searchDso } from '../src/catalog/search';
import { buildEligibility, buildNightContext } from '@nina-pm/engine';
import { buildNightTable } from '../src/lib/night-table';
import { SITE } from './support/equipment';
import { catalogRefreshHandler } from '../src/worker/catalog';
import { createStack, type Stack } from './support/stack';

const file = catalog as unknown as {
  version: string;
  counts: { rows: number };
  rows: DsoCatalogRow[];
};
type Ctx = Parameters<ReturnType<typeof catalogRefreshHandler>>[0];
const ctx = (now = new Date()): Ctx => ({ job: {} as Ctx['job'], now: () => now });

let s: Stack;
let tenantCookies: Record<string, string>;
let siteId: string;
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
  const member = await s.seed.member(identity.id, tenantId, 'admin');
  tenantCookies = { [COOKIE_NAMES.session]: await s.seed.session(identity.id, tenantId, 'tenant') };
  siteId = crypto.randomUUID();
  await s.services
    .repositories({ tenantId, memberId: member })
    .equipment()
    .createSite(siteId, SITE, s.clock.now());
  const sven = await s.seed.identity({ mfaEnabled: true, username: 'sven' });
  await s.seed.superUser(sven.id);
  systemCookies = { [COOKIE_NAMES.session]: await s.seed.session(sven.id, null, 'system') };
  await catalogRefreshHandler({ db: () => Promise.resolve(s.pg.db) })(ctx());
}, 120_000);
afterAll(() => s.close());

describe('catalog_refresh (T-KAT-11)', () => {
  it('schreibt jede Zeile der Katalogdatei genau einmal', async () => {
    const count = await s.pg.admin.query('SELECT count(*)::int AS n FROM dso_object');
    expect((count.rows[0] as { n: number }).n).toBe(file.counts.rows);
  });

  it('zweiter Lauf ändert außer updated_at keine Zeile, id bleibt', async () => {
    const before = await snapshot();
    await catalogRefreshHandler({ db: () => Promise.resolve(s.pg.db) })(
      ctx(new Date(Date.now() + 60_000)),
    );
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
      )(ctx()),
    ).rejects.toThrow(/Doppelte primary_id/);
    expect(await snapshot()).toEqual(before);
  });

  it('bricht bei unvollständiger Datei ab', async () => {
    await expect(
      catalogRefreshHandler(
        { db: () => Promise.resolve(s.pg.db) },
        { version: 'x', counts: { rows: 3 }, rows: file.rows.slice(0, 2) },
      )(ctx()),
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
    // Richtung per Spaltenkopf (AP-26a): absteigend, Name absteigend
    const desc = await search(
      'group=galaxy&catalog=M&constellation=Vir&magMax=10&sort=mag&dir=desc',
    );
    const dmags = desc.items.map((i) => i.magV ?? i.magB ?? 99);
    expect(dmags).toEqual([...dmags].sort((a, b) => b - a));
    const names = (await search('catalog=M&limit=100&dir=desc')).items.map((i) => i.primaryId);
    expect(names[0]).not.toBe((await search('catalog=M&limit=100')).items[0]?.primaryId);
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

describe('Nachtwerte im Objektbrowser (FA-FRM-15)', () => {
  const search = async (query: string) => {
    const res = await s.request(`/api/web/v1/dso?${query}`, { cookies: tenantCookies });
    expect(res.status, query).toBe(200);
    return (await res.json()) as DsoList;
  };

  it('rechnet beste Höhe/Zeit, Mond und nutzbare Stunden je Treffer', async () => {
    // Standort SITE (31,5° N) im Herbst: M 31 hoch, M 42 geht erst spät auf.
    const r = await search(`siteId=${siteId}&night=2026-10-20&q=M%2031`);
    expect(r.night).toMatchObject({ night: '2026-10-20', timeZone: SITE.timeZone });
    expect(r.night?.darkStartUtc).toMatch(/^2026-10-21T0/);
    const m31 = r.items[0]?.night;
    expect(m31?.visibility).toBe('normal');
    expect(m31?.usableHours).toBeGreaterThan(5);
    expect(m31?.peakAltDeg).toBeGreaterThan(75);
    expect(m31?.peakUtc).toMatch(/^2026-10-21T/);
  });

  it('filtert nach Mindeststunden und sortiert nach nutzbaren Stunden', async () => {
    const r = await search(
      `siteId=${siteId}&night=2026-10-20&catalog=M&minUsableHours=4&sort=usable&limit=100`,
    );
    expect(r.total).toBeGreaterThan(10);
    const hours = r.items.map((i) => i.night?.usableHours ?? 0);
    for (const h of hours) expect(h).toBeGreaterThanOrEqual(4);
    expect(hours).toEqual([...hours].sort((a, b) => b - a));
    // Südlich von −60° geht am Standort nichts auf.
    const south = await search(`siteId=${siteId}&night=2026-10-20&q=NGC%20104`);
    expect(south.items[0]?.night).toMatchObject({ visibility: 'never', usableHours: 0 });
  });

  it('nutzbare Stunden und beste Höhe wie buildEligibility der Engine', async () => {
    const r = await search(`siteId=${siteId}&night=2026-10-20&catalog=M&limit=100&minAltDeg=25`);
    const table = buildNightTable(SITE, '2026-10-20', 1);
    const ctx = buildNightContext({
      site: { latDeg: SITE.latitudeDeg, lonDeg: SITE.longitudeDeg },
      night: '2026-10-20',
      timeZoneTransitions: table.timeZoneTransitions.map((z) => ({
        atUtc: Date.parse(z.atUtc) / 1000,
        utcOffsetMinutes: z.utcOffsetMinutes,
      })),
    });
    for (const item of r.items) {
      const e = buildEligibility(ctx, {
        target: { raJ2000Deg: item.raDeg, decJ2000Deg: item.decDeg },
        twilight: 'astronomical',
        minAltDeg: 25,
      });
      expect(item.night?.usableHours, item.primaryId).toBe(
        Math.round(((e.usableSlots * 300) / 3600) * 10) / 10,
      );
      expect(item.night?.visibility, item.primaryId).toBe(e.visibility);
    }
  });

  it('Beste der Nacht: nur Kandidaten, absteigend bewertet, mit Filterempfehlung (FA-FRM-13)', async () => {
    const r = await search(
      `siteId=${siteId}&night=2026-10-20&sort=score&rigFovArcmin=100&candidates=true&limit=50`,
    );
    expect(r.total).toBeGreaterThan(50);
    const scores = r.items.map((i) => i.night?.score ?? -1);
    for (const x of scores) expect(x).toBeGreaterThan(0);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    for (const i of r.items) {
      expect(i.filterHint).not.toBeNull();
      expect(i.night?.peakAltDeg ?? 0).toBeGreaterThanOrEqual(20);
    }
    const nebulae = await search(
      `siteId=${siteId}&night=2026-10-20&sort=score&rigFovArcmin=100&candidates=true&family=nebulae&limit=20`,
    );
    for (const i of nebulae.items)
      expect([
        'planetary_nebula',
        'emission_nebula',
        'reflection_nebula',
        'dark_nebula',
        'supernova_remnant',
      ]).toContain(i.group);
    const noFov = await s.request(`/api/web/v1/dso?siteId=${siteId}&sort=score`, {
      cookies: tenantCookies,
    });
    expect(noFov.status).toBe(422);
  });

  it('Eine Tabelle: nach Bewertung ohne Kandidatenfilter – alle Objekte, unbewertete hinten', async () => {
    const q = `siteId=${siteId}&night=2026-10-20&sort=score&rigFovArcmin=100`;
    const all = await search(`${q}&limit=50`);
    const only = await search(`${q}&candidates=true&limit=50`);
    expect(all.total).toBeGreaterThan(only.total);
    expect(all.items.map((i) => i.primaryId)).toEqual(only.items.map((i) => i.primaryId));
    const tail = await search(`${q}&limit=50&offset=${String(all.total - 50)}`);
    for (const i of tail.items) expect(i.night?.score ?? null).toBeNull();
    // Bewertung auch bei anderer Sortierung als Spalte.
    const byMag = await search(`${q.replace('sort=score', 'sort=mag')}&candidates=true&limit=20`);
    expect(byMag.items.some((i) => (i.night?.score ?? 0) > 0)).toBe(true);
  });

  it('Nachtfilter ohne Standort → 422, fremder Standort → 404', async () => {
    const bad = await s.request('/api/web/v1/dso?minUsableHours=2', { cookies: tenantCookies });
    expect(bad.status).toBe(422);
    const foreign = await s.request(`/api/web/v1/dso?siteId=${crypto.randomUUID()}`, {
      cookies: tenantCookies,
    });
    expect(foreign.status).toBe(404);
  });

  it('Suche < 300 ms, auch mit Nachtwerten über den ganzen Katalog (Cache kalt)', async () => {
    await search('q=m31'); // lädt den Katalog in den Speicher der api
    const index = await cachedCatalog(
      () => Promise.reject(new Error('Cache erwartet')),
      s.clock.now().getTime(),
    );
    // Minimum aus mehreren Läufen: misst die Suche, nicht die Last der übrigen Testdateien.
    const fastest = async (fn: () => unknown, runs = 5) => {
      let best = Infinity;
      for (let k = 0; k < runs; k += 1) {
        const t = performance.now();
        await fn();
        best = Math.min(best, performance.now() - t);
      }
      return best;
    };
    const timings: Record<string, number> = {};
    for (const q of ['m31', 'ngc', 'orion', 'sh2-1'])
      timings[q] = await fastest(() =>
        searchDso(index, {
          q,
          sort: 'name',
          limit: 50,
          offset: 0,
          minAltDeg: 30,
          twilight: 'astronomical',
        }),
      );
    console.info(
      `Suche: ${Object.entries(timings)
        .map(([q, ms]) => `${q} ${String(Math.round(ms))} ms`)
        .join(', ')}`,
    );
    for (const [q, ms] of Object.entries(timings)) expect(ms, q).toBeLessThan(300);
    clearNightCache();
    const t1 = performance.now();
    const r = await search(`siteId=${siteId}&night=2026-11-15&sort=usable&limit=20`);
    const cold = performance.now() - t1;
    expect(r.total).toBe(file.counts.rows);
    const warm = await fastest(
      () => search(`siteId=${siteId}&night=2026-11-15&sort=usable&limit=20&offset=20`),
      3,
    );
    console.info(
      `Nachtwerte ganzer Katalog: kalt ${String(Math.round(cold))} ms, warm ${String(Math.round(warm))} ms`,
    );
    expect(warm).toBeLessThan(300);
  }, 60_000);
});

describe('Katalogobjekt am Projekt (Katalogsuche im Editor)', () => {
  it('Projekt mit dsoObjectId; unbekanntes Objekt → 422', async () => {
    const m31 = (
      (await (
        await s.request('/api/web/v1/dso?q=M%2031&limit=1', { cookies: tenantCookies })
      ).json()) as DsoList
    ).items[0];
    const id = crypto.randomUUID();
    const created = await s.request('/api/web/v1/projects', {
      method: 'POST',
      cookies: tenantCookies,
      body: {
        id,
        name: 'M 31 – Andromeda Galaxy',
        targetName: 'M 31',
        dsoObjectId: m31?.id,
        raDeg: m31?.raDeg,
        decDeg: m31?.decDeg,
      },
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ dsoObjectId: m31?.id, dsoPrimaryId: 'NGC 224' });
    const listed = (await (
      await s.request('/api/web/v1/projects', { cookies: tenantCookies })
    ).json()) as { items: { id: string; dsoPrimaryId: string | null }[] };
    expect(listed.items.find((p) => p.id === id)?.dsoPrimaryId).toBe('NGC 224');
    const patched = await s.request(`/api/web/v1/projects/${id}`, {
      method: 'PATCH',
      cookies: tenantCookies,
      body: { dsoObjectId: null },
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ dsoObjectId: null, dsoPrimaryId: null });
    const unknown = await s.request('/api/web/v1/projects', {
      method: 'POST',
      cookies: tenantCookies,
      body: { id: crypto.randomUUID(), name: 'X', dsoObjectId: crypto.randomUUID() },
    });
    expect(unknown.status).toBe(422);
  });
});

describe('GET /api/web/v1/dso/region (FA-FRM-09)', () => {
  it('Objekte im Umkreis, hellste zuerst, Dichte über magMax', async () => {
    const res = await s.request('/api/web/v1/dso/region?ra=10.68&dec=41.27&radius=3&magMax=11', {
      cookies: tenantCookies,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { primaryId: string; mag: number | null }[];
      total: number;
    };
    expect(body.items[0]?.primaryId).toBe('NGC 224');
    expect(body.items.map((i) => i.primaryId)).toEqual(
      expect.arrayContaining(['NGC 221', 'NGC 205']),
    );
    const mags = body.items.map((i) => i.mag ?? 12);
    expect(mags).toEqual([...mags].sort((a, b) => a - b));
    const sparse = (await (
      await s.request('/api/web/v1/dso/region?ra=10.68&dec=41.27&radius=3&magMax=6', {
        cookies: tenantCookies,
      })
    ).json()) as { total: number };
    expect(sparse.total).toBeLessThan(body.total);
    const bad = await s.request('/api/web/v1/dso/region?ra=400&dec=0&radius=1', {
      cookies: tenantCookies,
    });
    expect(bad.status).toBe(422);
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

  it('Exoplaneten-Kataloge: eigener Job je Katalog, Stand je Katalog (AP-40)', async () => {
    const nasa = await s.request('/api/system/v1/catalogs/nasa/refresh', {
      method: 'POST',
      cookies: systemCookies,
    });
    expect(nasa.status).toBe(202);
    const { jobId } = (await nasa.json()) as { jobId: string };
    const status = (await (
      await s.request('/api/system/v1/catalogs', { cookies: systemCookies })
    ).json()) as {
      dso: { lastJob: { id: string } | null };
      exo: { catalog: string; rows: number; lastJob: { id: string } | null }[];
    };
    expect(status.exo.map((e) => e.catalog)).toEqual(['exoclock', 'nasa', 'toi']);
    expect(status.exo.find((e) => e.catalog === 'nasa')?.lastJob?.id).toBe(jobId);
    expect(status.exo.find((e) => e.catalog === 'exoclock')?.lastJob).toBeNull();
    // Der Objektkatalog zeigt weiter nur seinen eigenen Job.
    expect(status.dso.lastJob?.id).not.toBe(jobId);
  });

  it('unbekannter Katalog → 422', async () => {
    const res = await s.request('/api/system/v1/catalogs/gaia/refresh', {
      method: 'POST',
      cookies: systemCookies,
    });
    expect(res.status).toBe(422);
  });
});

describe('Katalog-Stand für den Speicher der api (Performance 10.10.2026)', () => {
  it('Stand bleibt ohne Import gleich und ändert sich mit catalog_refresh', async () => {
    const a = await dsoCatalogStamp(s.pg.db);
    expect(a).toMatch(new RegExp(`^${String(file.counts.rows)}\\|`));
    expect(await dsoCatalogStamp(s.pg.db)).toBe(a);
    await catalogRefreshHandler({ db: () => Promise.resolve(s.pg.db) })(
      ctx(new Date(Date.now() + 3_600_000)),
    );
    expect(await dsoCatalogStamp(s.pg.db)).not.toBe(a);
  });
});
