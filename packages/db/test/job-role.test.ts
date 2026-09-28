/**
 * Einstiegspunkte des worker unter der echten Rolle `app_job` (TK 6.2, SEC-4): PGlite mit allen Migrationen,
 * Seed als Superuser, danach `SET ROLE app_job`. Fehlt ein GRANT, scheitert der Aufruf mit
 * „permission denied“ – so wie in prod (27.09.2026 `rig` → Migration 0008, 28.09.2026 `change_request`
 * → Migration 0009). Die Rechte-Suiten D-02/D-03 prüfen die GRANTs einzeln, dieser Test die Pfade.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  activeAdminIds,
  ChangeRequestRepository,
  closeSessionFlats,
  deleteExpiredInvitations,
  EffortRepository,
  effortSites,
  EquipmentRepository,
  expireSubmissions,
  insertNotifications,
  JobQueue,
  JobRepository,
  latestWeather,
  markStaleSessions,
  ProjectRepository,
  projectsWithoutThumbnail,
  reconcileSite,
  recordTenantStorage,
  replaceForecast,
  saveWeather,
  sessionsDueForClose,
  setProjectThumbnail,
  setReportStatus,
  siteNightRunDone,
  tenantIdsForStorage,
  thumbnailKeyInUse,
  upsertDsoCatalog,
  upsertSiteNightStatForSession,
  weatherSites,
} from '../src/index';
import { openPglite, type PgliteDatabase } from '../src/testing/pglite';

const T = '00000000-0000-7000-8000-00000000a001';
const I = '00000000-0000-7000-8000-00000000a002';
const U = '00000000-0000-7000-8000-00000000a003';
const SITE = '00000000-0000-7000-8000-00000000a004';
const TEL = '00000000-0000-7000-8000-00000000a005';
const CAM = '00000000-0000-7000-8000-00000000a006';
const RIG = '00000000-0000-7000-8000-00000000a007';
/** Eingereicht, Frist abgelaufen. */
const P1 = '00000000-0000-7000-8000-00000000a008';
/** Freigegeben, mit offenem Änderungsantrag desselben Einreichers (gemeinsame Rangfolge, FA-FRG-15). */
const P2 = '00000000-0000-7000-8000-00000000a009';
const CR = '00000000-0000-7000-8000-00000000a00a';
const PAN = '00000000-0000-7000-8000-00000000a00b';
const LINE = '00000000-0000-7000-8000-00000000a00c';
const SES = '00000000-0000-7000-8000-00000000a00d';
const CAP = '00000000-0000-7000-8000-00000000a00e';
const OLD = '2026-01-01T00:00:00Z';
const now = new Date('2026-09-28T12:00:00Z');

let pg: PgliteDatabase;
const seed = (sql: string, params: unknown[]) => pg.admin.query(sql, params);

beforeAll(async () => {
  pg = await openPglite();
  await seed(
    `INSERT INTO tenant (id, tenant_key, display_name, settings) VALUES ($1, 't1', 'T', '{"approvalDeadlineDays":1}')`,
    [T],
  );
  await seed(`INSERT INTO identity (id, discord_user_id, discord_username) VALUES ($1, '1', 'u')`, [
    I,
  ]);
  await seed(
    `INSERT INTO app_user (id, tenant_id, identity_id, display_name, role) VALUES ($1, $2, $3, 'U', 'user')`,
    [U, T, I],
  );
  await seed(
    `INSERT INTO site (id, tenant_id, name, latitude_deg, longitude_deg, time_zone) VALUES ($1, $2, 'S', 50, 10, 'Europe/Berlin')`,
    [SITE, T],
  );
  await seed(
    `INSERT INTO telescope (id, tenant_id, name, optical_design, aperture_mm, focal_length_mm) VALUES ($1, $2, 'T', 'rc', 100, 500)`,
    [TEL, T],
  );
  await seed(
    `INSERT INTO camera (id, tenant_id, name, width_px, height_px, pixel_size_um) VALUES ($1, $2, 'C', 100, 100, 3)`,
    [CAM, T],
  );
  await seed(
    `INSERT INTO rig (id, tenant_id, name, site_id, telescope_id, camera_id) VALUES ($1, $2, 'R', $3, $4, $5)`,
    [RIG, T, SITE, TEL, CAM],
  );
  await seed(
    `INSERT INTO project (id, tenant_id, rig_id, created_by, name, approval_status, submitter_rank, ra_deg, dec_deg, created_at)
     VALUES ($1, $2, $3, $4, 'P1', 'submitted', 1, 10, 40, $5)`,
    [P1, T, RIG, U, OLD],
  );
  await seed(
    `INSERT INTO approval_event (tenant_id, project_id, user_id, action, created_at) VALUES ($1, $2, $3, 'submitted', $4)`,
    [T, P1, U, OLD],
  );
  await seed(
    `INSERT INTO project (id, tenant_id, rig_id, created_by, name, approval_status, status, ra_deg, dec_deg)
     VALUES ($1, $2, $3, $4, 'P2', 'approved', 'active', 10, 40)`,
    [P2, T, RIG, U],
  );
  await seed(
    `INSERT INTO change_request (id, tenant_id, project_id, requested_by, proposal, base_version, submitter_rank)
     VALUES ($1, $2, $3, $4, '{}', 1, 2)`,
    [CR, T, P2, U],
  );
  await seed(
    `INSERT INTO project_panel (id, tenant_id, project_id, panel_index, ra_deg, dec_deg) VALUES ($1, $2, $3, 0, 10, 40)`,
    [PAN, T, P2],
  );
  await seed(
    `INSERT INTO exposure_line (id, tenant_id, project_id, panel_id, filter_short_name, exposure_s, planned_count, readout_mode, moon_mode)
     VALUES ($1, $2, $3, $4, 'L', 60, 10, 'Default', 'none')`,
    [LINE, T, P2, PAN],
  );
  await seed(
    `INSERT INTO session (id, tenant_id, rig_id, night, started_at, status, last_heartbeat_at)
     VALUES ($1, $2, $3, '2026-09-20', '2026-09-20T20:00:00Z', 'running', '2026-09-20T20:00:00Z')`,
    [SES, T, RIG],
  );
  await seed(
    `INSERT INTO capture (id, tenant_id, session_id, project_id, panel_id, exposure_line_id, night, captured_at, filter_short_name, exposure_s, result, file_name)
     VALUES ($1, $2, $3, $4, $5, $6, '2026-09-20', '2026-09-20T21:00:00Z', 'L', 60, 'saved', 'f')`,
    [CAP, T, SES, P2, PAN, LINE],
  );
  await seed(
    `INSERT INTO flat_combination (tenant_id, session_id, filter_short_name, gain, offset_adu, binning) VALUES ($1, $2, 'L', 0, 0, 1)`,
    [T, SES],
  );
  await seed(
    `INSERT INTO invitation (tenant_id, token_hash, role, expires_at) VALUES ($1, 'h', 'user', '2020-01-01')`,
    [T],
  );
  // Ab hier wie die Lambda worker: nur die Rechte von app_job (Seed-Prüfungen danach über RESET ROLE).
  await pg.pg.exec('SET ROLE app_job');
});
afterAll(() => pg.close());

const asAdmin = async <T>(sql: string, params: unknown[]): Promise<T[]> => {
  await pg.pg.exec('RESET ROLE');
  try {
    return (await pg.admin.query(sql, params)).rows as T[];
  } finally {
    await pg.pg.exec('SET ROLE app_job');
  }
};

describe('worker unter der Rolle app_job (TK 6.2)', () => {
  it('läuft wirklich als app_job', async () => {
    const r = await pg.pg.query<{ role: string }>('SELECT current_user AS role');
    expect(r.rows[0]?.role).toBe('app_job');
  });

  it('expireSubmissions: Verfall mit offenem Änderungsantrag nummeriert den Antragsrang neu (Migration 0009)', async () => {
    expect(await expireSubmissions(pg.db, now)).toBe(1);
    const [project] = await asAdmin<{ approval_status: string; submitter_rank: number | null }>(
      'SELECT approval_status, submitter_rank FROM project WHERE id = $1',
      [P1],
    );
    expect(project).toEqual({ approval_status: 'returned', submitter_rank: null });
    const [request] = await asAdmin<{ submitter_rank: number | null }>(
      'SELECT submitter_rank FROM change_request WHERE id = $1',
      [CR],
    );
    expect(request?.submitter_rank).toBe(1);
  });

  it('app_job ändert an change_request nur den Rang', async () => {
    await expect(
      pg.pg.query(`UPDATE change_request SET status = 'withdrawn' WHERE id = $1`, [CR]),
    ).rejects.toThrow(/permission denied/);
  });

  const effort = () => new EffortRepository(pg.db, { tenantId: T });
  const entryPoints: [string, () => Promise<unknown>][] = [
    // tick-5min: verwaiste Sessions, Session-Abschluss und -Bericht (AP-15).
    ['markStaleSessions', () => markStaleSessions(pg.db, now)],
    ['sessionsDueForClose', () => sessionsDueForClose(pg.db, now)],
    ['activeAdminIds', () => activeAdminIds(pg.db, T)],
    [
      'insertNotifications',
      () =>
        insertNotifications(pg.db, {
          tenantId: T,
          recipients: [U],
          kind: 'alert.session_no_heartbeat',
          payload: {},
          now,
        }),
    ],
    ['closeSessionFlats', () => closeSessionFlats(pg.db, T, SES)],
    ['upsertSiteNightStatForSession', () => upsertSiteNightStatForSession(pg.db, T, SES)],
    ['setReportStatus', () => setReportStatus(pg.db, T, SES, 'skipped')],
    ['jobQueue.stale', () => new JobQueue(pg.db).stale(now)],
    // tick-hourly: Aufwand, Prognose, Abgleich (AP-13e, AP-33, AP-15), Wetter (AP-23), Vorschaubilder (AP-25).
    ['effortSites', () => effortSites(pg.db)],
    ['siteNightRunDone', () => siteNightRunDone(pg.db, T, 'k')],
    [
      'job.enqueue',
      () =>
        new JobRepository(pg.db, { tenantId: T }).enqueue({
          kind: 'effort',
          input: { projectId: P2 },
          dedupeKey: `effort:${P2}`,
        }),
    ],
    ['effort.candidates', () => effort().candidates(SITE, now)],
    [
      'effort.save',
      () =>
        effort().save(P2, 1, {
          tag: 'single_night',
          nights: 1,
          detail: {},
          inputHash: 'x',
          computedAt: now,
        }),
    ],
    ['effort.markStale', () => effort().markStale(P2)],
    [
      'replaceForecast',
      () =>
        replaceForecast(
          pg.db,
          T,
          RIG,
          [
            {
              night: '2026-09-28',
              darkHours: 1,
              lineFrames: {},
              projectHours: {},
              engineVersion: 'x',
              inputHash: 'h',
            },
          ],
          now,
        ),
    ],
    ['reconcileSite', () => reconcileSite(pg.db, T, SITE, now)],
    ['weatherSites', () => weatherSites(pg.db)],
    [
      'saveWeather',
      () =>
        saveWeather(pg.db, {
          latitudeDeg: 50,
          longitudeDeg: 10,
          modelSet: 'm',
          payload: { hours: [], nights: [] },
          fetchedAt: now,
          expiresAt: now,
        }),
    ],
    ['latestWeather', () => latestWeather(pg.db, 50, 10)],
    ['projectsWithoutThumbnail', () => projectsWithoutThumbnail(pg.db, 10)],
    ['setProjectThumbnail', () => setProjectThumbnail(pg.db, T, P2, 'catalog/thumbs/x.jpg')],
    ['thumbnailKeyInUse', () => thumbnailKeyInUse(pg.db, 'x')],
    // Job-Handler lesen Projekte, Ausrüstung und Anträge.
    [
      'ProjectRepository.list',
      () => new ProjectRepository(pg.db, { tenantId: T }).list({ admin: true, rigId: RIG }),
    ],
    ['ProjectRepository.detail', () => new ProjectRepository(pg.db, { tenantId: T }).detail(P2)],
    ['EquipmentRepository.rig', () => new EquipmentRepository(pg.db, { tenantId: T }).rig(RIG)],
    ['EquipmentRepository.site', () => new EquipmentRepository(pg.db, { tenantId: T }).site(SITE)],
    [
      'EquipmentRepository.moonProfiles',
      () => new EquipmentRepository(pg.db, { tenantId: T }).moonProfiles(),
    ],
    [
      'ChangeRequestRepository.byId',
      () => new ChangeRequestRepository(pg.db, { tenantId: T }).byId(CR),
    ],
    // daily: Einladungen, Speicherbedarf (AP-07d), Katalog.
    ['deleteExpiredInvitations', () => deleteExpiredInvitations(pg.db, now)],
    ['tenantIdsForStorage', () => tenantIdsForStorage(pg.db)],
    ['recordTenantStorage', () => recordTenantStorage(pg.db, T, { bytes: 1, count: 1 }, now)],
    [
      'recordTenantStorage (Aktualisierung)',
      () => recordTenantStorage(pg.db, T, { bytes: 2, count: 1 }, now),
    ],
    ['upsertDsoCatalog', () => upsertDsoCatalog(pg.db, [], now)],
  ];

  // Ein fehlendes Recht wirft „permission denied for table …“ und lässt den Fall scheitern.
  it.each(entryPoints)('%s', async (_name, run) => {
    await run();
  });
});
