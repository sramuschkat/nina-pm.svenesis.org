/**
 * Exoplaneten-Kataloge (AP-40) unter der echten Rolle `app_job` (PGlite mit allen Migrationen inkl. 0010):
 * Upsert behält die `id`, nicht mehr gelieferte Zeilen werden gelöscht – außer ein Exoplaneten-Projekt verweist
 * darauf –, andere Kataloge bleiben unberührt, Stand je Katalog.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  exoCatalogCount,
  exoCatalogStatus,
  exoPrefilterSetting,
  readExoCatalog,
  replaceExoCatalog,
  type ExoCatalogRow,
} from '../src/index';
import { openPglite, type PgliteDatabase } from '../src/testing/pglite';

const T = '00000000-0000-7000-8000-00000000b001';
const I = '00000000-0000-7000-8000-00000000b002';
const U = '00000000-0000-7000-8000-00000000b003';
const SITE = '00000000-0000-7000-8000-00000000b004';
const TEL = '00000000-0000-7000-8000-00000000b005';
const CAM = '00000000-0000-7000-8000-00000000b006';
const RIG = '00000000-0000-7000-8000-00000000b007';
const PRJ = '00000000-0000-7000-8000-00000000b008';

const row = (planet: string, over: Partial<ExoCatalogRow> = {}): ExoCatalogRow => ({
  planet,
  star: planet.replace(/ \w$/, ''),
  disposition: null,
  raDeg: 324.536,
  decDeg: 30.488,
  magVJohnson: 10.4,
  magRCousins: null,
  magSdssG: null,
  magGaiaG: 10.3,
  magTess: 9.8,
  magBandUsed: 'V',
  teffK: 5246,
  distancePc: 92.4,
  t0BjdTdb: 2456703.460703,
  t0SigmaD: 5e-5,
  periodD: 10.33852,
  periodSigmaD: 9e-6,
  durationH: 3.994,
  durationEstimated: false,
  depthMmag: 16.409,
  depthRaw: 1.5,
  depthUnit: 'percent',
  depthEstimated: false,
  rpOverRs: 0.1237,
  aOverRs: 22.72,
  inclinationDeg: 89.2,
  planetRadiusRe: 11.77,
  eqTempK: 800,
  exoclockPriority: null,
  oMinusCMin: null,
  minApertureMm: null,
  minApertureEstimated: false,
  amateurReachable: true,
  timeSystemSource: 'bjd_tdb',
  timeSystemRaw: 'BJD-TDB',
  t0Raw: 2456703.460703,
  ticId: '266593143',
  ...over,
});

let pg: PgliteDatabase;
const t1 = new Date('2026-09-27T04:30:00Z');
const t2 = new Date('2026-10-04T04:30:00Z');

beforeAll(async () => {
  pg = await openPglite();
  const seed = (sql: string, params: unknown[]) => pg.admin.query(sql, params);
  await seed(`INSERT INTO tenant (id, tenant_key, display_name) VALUES ($1, 'exo', 'E')`, [T]);
  await seed(`INSERT INTO identity (id, discord_user_id, discord_username) VALUES ($1, '9', 'u')`, [
    I,
  ]);
  await seed(
    `INSERT INTO app_user (id, tenant_id, identity_id, display_name, role) VALUES ($1, $2, $3, 'U', 'user')`,
    [U, T, I],
  );
  await seed(
    `INSERT INTO site (id, tenant_id, name, latitude_deg, longitude_deg, time_zone) VALUES ($1, $2, 'S', 31, -98, 'America/Chicago')`,
    [SITE, T],
  );
  await seed(
    `INSERT INTO telescope (id, tenant_id, name, optical_design, aperture_mm, focal_length_mm) VALUES ($1, $2, 'T', 'refractor', 81, 478)`,
    [TEL, T],
  );
  await seed(
    `INSERT INTO camera (id, tenant_id, name, width_px, height_px, pixel_size_um) VALUES ($1, $2, 'C', 3008, 3008, 3.76)`,
    [CAM, T],
  );
  await seed(
    `INSERT INTO rig (id, tenant_id, name, site_id, telescope_id, camera_id) VALUES ($1, $2, 'R', $3, $4, $5)`,
    [RIG, T, SITE, TEL, CAM],
  );
  await seed(
    `INSERT INTO project (id, tenant_id, rig_id, created_by, name, ra_deg, dec_deg) VALUES ($1, $2, $3, $4, 'P', 324.5, 30.5)`,
    [PRJ, T, RIG, U],
  );
  await pg.pg.exec('SET ROLE app_job');
});
afterAll(() => pg.close());

describe('replaceExoCatalog (Rolle app_job)', () => {
  it('schreibt den ersten Stand und liest ihn zurück', async () => {
    const r = await replaceExoCatalog(
      pg.db,
      'nasa',
      [
        row('HAT-P-17 b'),
        row('WASP-64 b', { timeSystemSource: 'unknown', timeSystemRaw: 'HJD-TDB' }),
        row('TrES-3 b', { timeSystemSource: 'hjd_utc', timeSystemRaw: 'HJD' }),
      ],
      t1,
    );
    expect(r).toEqual({ written: 3, deleted: 0, keptReferenced: [] });
    await replaceExoCatalog(pg.db, 'exoclock', [row('HAT-P-17b', { ticId: null })], t1);
    expect(await exoCatalogCount(pg.db, 'nasa')).toBe(3);
    const nasa = await readExoCatalog(pg.db, ['nasa']);
    expect(nasa.map((x) => x.planet)).toEqual(['HAT-P-17 b', 'TrES-3 b', 'WASP-64 b']);
    expect(nasa[0]).toMatchObject({
      catalog: 'nasa',
      t0BjdTdb: 2456703.460703,
      depthUnit: 'percent',
      depthEstimated: false,
      ticId: '266593143',
    });
  });

  it('neuer Stand: id bleibt, fehlende Zeilen weg, Verweis aus einem Projekt schützt die Zeile', async () => {
    const before = await readExoCatalog(pg.db, ['nasa']);
    const hat = before.find((x) => x.planet === 'HAT-P-17 b');
    const tres = before.find((x) => x.planet === 'TrES-3 b');
    // Ein Mandant hat aus TrES-3 b ein Exoplaneten-Projekt angelegt (AP-43).
    await pg.pg.exec('RESET ROLE');
    await pg.admin.query(
      `INSERT INTO exo_project (project_id, tenant_id, planet, star, catalog, catalog_entry_id) VALUES ($1, $2, 'TrES-3 b', 'TrES-3', 'nasa', $3)`,
      [PRJ, T, tres?.id],
    );
    await pg.pg.exec('SET ROLE app_job');

    const r = await replaceExoCatalog(
      pg.db,
      'nasa',
      [row('HAT-P-17 b', { t0BjdTdb: 2457168.694753, t0Raw: 2457168.694753 })],
      t2,
    );
    expect(r).toEqual({ written: 1, deleted: 1, keptReferenced: ['TrES-3 b'] });
    const after = await readExoCatalog(pg.db, ['nasa']);
    expect(after.map((x) => x.planet)).toEqual(['HAT-P-17 b', 'TrES-3 b']);
    const hat2 = after.find((x) => x.planet === 'HAT-P-17 b');
    expect(hat2?.id).toBe(hat?.id);
    expect(hat2?.t0BjdTdb).toBe(2457168.694753);
    expect(hat2?.fetchedAt.toISOString()).toBe(t2.toISOString());
    // Andere Kataloge unberührt.
    expect(await exoCatalogCount(pg.db, 'exoclock')).toBe(1);
  });

  it('Stand je Katalog für S-82', async () => {
    const s = await exoCatalogStatus(pg.db);
    expect(s.map((x) => [x.catalog, x.rows])).toEqual([
      ['exoclock', 1],
      ['nasa', 2],
      ['toi', 0],
    ]);
    expect(s.find((x) => x.catalog === 'nasa')?.lastImportAt?.toISOString()).toBe(t2.toISOString());
    expect(s.find((x) => x.catalog === 'toi')).toMatchObject({ lastImportAt: null, lastJob: null });
  });

  it('Vorfilter aus system_setting lesbar (ohne Eintrag null)', async () => {
    expect(await exoPrefilterSetting(pg.db)).toBeNull();
  });
});
