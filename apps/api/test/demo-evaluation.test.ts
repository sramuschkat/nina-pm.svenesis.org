/**
 * `ops-cli demo-evaluation` gegen PGlite mit dem Aufbau des Test-Mandanten aus dem Export vom 26.09.2026
 * (Starfront, America/Chicago; ein Mono-Rig; Filter BLUE/GREEN/HA/LUMINOS/OIII/RED/SII; IC 1848 mit 4 und
 * NGC 7380 mit 12 akzeptierten Frames je Filter): nur Test-Mandant; Probelauf mit `keep`; Löschen nur der
 * Auswertungsdaten; fünf Demo-Projekte „Demo – …“ freigegeben; 90 Nächte in Teilaufrufen; vorhandene Projekte
 * behalten exakt ihren Stand und Status; Zähler aus den Aufnahmen; wiederholbar; andere Mandanten unberührt.
 */
import { EquipmentRepository, ProjectRepository, TenantAdminRepository } from '@nina-pm/db';
import { openPglite, type PgliteDatabase } from '@nina-pm/db/testing/pglite';
import { LineCreate, ProjectCreate } from '@nina-pm/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runOpsCommand, type OpsDeps } from '../src/ops/commands';
import { CAMERA, filterInput, rigInput, SCHEDULER, SITE, TELESCOPE } from './support/equipment';

let pg: PgliteDatabase;
let deps: OpsDeps;
const NOW = new Date('2026-09-26T21:00:00Z');
const FILTERS = ['BLUE', 'GREEN', 'HA', 'LUMINOS', 'OIII', 'RED', 'SII'];

beforeAll(async () => {
  pg = await openPglite();
});
afterAll(() => pg.close());

const one = async <T>(sql: string, params: unknown[] = []) =>
  (await pg.admin.query(sql, params)).rows[0] as T;
const count = async (sql: string, params: unknown[] = []) =>
  Number((await one<{ n: number }>(sql, params)).n);

/** Mandant wie im Export: Standort, Rig, Filter, zwei freigegebene Projekte mit Stand, NINA-Instanz. */
async function tenant(key: string) {
  const admin = new TenantAdminRepository(pg.db, { kind: 'ops_cli' });
  const t = await admin.createTenant({ tenantKey: key, displayName: key }, NOW);
  await admin.ensureBuiltInMoonProfiles(t.id, NOW);
  const identity = crypto.randomUUID();
  await pg.admin.query(
    'INSERT INTO identity (id, discord_user_id, discord_username) VALUES ($1, $2, $3)',
    [identity, String(1e11 + Math.floor(Math.random() * 1e11)), 'u'],
  );
  const member = crypto.randomUUID();
  await pg.admin.query(
    "INSERT INTO app_user (id, tenant_id, identity_id, display_name, role) VALUES ($1, $2, $3, 'Sven', 'admin')",
    [member, t.id, identity],
  );
  const eq = new EquipmentRepository(pg.db, { tenantId: t.id });
  // Koordinaten wie im Export (Starfront), damit der Test genau den prod-Verlauf zeigt.
  const site = await eq.createSite(
    crypto.randomUUID(),
    { ...SITE, latitudeDeg: 31.547111, longitudeDeg: -99.382222, elevationM: 431.9 },
    NOW,
  );
  const tel = await eq.createTelescope(crypto.randomUUID(), TELESCOPE, NOW);
  const cam = await eq.createCamera(crypto.randomUUID(), CAMERA, NOW);
  const filters = new Map<string, string>();
  for (const f of FILTERS)
    filters.set(f, (await eq.createFilter(crypto.randomUUID(), filterInput(f), NOW)).id);
  const rig = await eq.createRig(crypto.randomUUID(), rigInput(site.id, tel.id, cam.id), NOW);
  await eq.updateScheduler(rig.id, SCHEDULER, NOW);
  const projects = new ProjectRepository(pg.db, { tenantId: t.id, memberId: member });
  const project = async (name: string, planned: number, accepted: number) => {
    const id = crypto.randomUUID();
    const d = await projects.create(
      ProjectCreate.parse({ id, name, rigId: rig.id, targetName: name, raDeg: 42.8, decDeg: 60.4 }),
      NOW,
    );
    const panelId = d.panels[0]?.id as string;
    for (const f of ['SII', 'HA', 'OIII'])
      await projects.addLine(
        id,
        LineCreate.parse({
          id: crypto.randomUUID(),
          panelId,
          filterId: filters.get(f),
          exposureS: 600,
          plannedCount: planned,
          gain: 150,
          offsetAdu: 50,
          binning: 1,
          readoutMode: null,
          moonMode: 'project_default',
        }),
        NOW,
      );
    await pg.admin.query(
      "UPDATE project SET approval_status = 'approved', status = 'active', rig_id = requested_rig_id WHERE id = $1",
      [id],
    );
    await pg.admin.query('UPDATE exposure_line SET acquired_count = $2 WHERE project_id = $1', [
      id,
      accepted,
    ]);
    return id;
  };
  const ic1848 = await project('IC 1848 – Seelennebel', 12, 4);
  const ngc7380 = await project('NGC 7380 – Wizard Nebula', 20, 12);
  const instance = crypto.randomUUID();
  await pg.admin.query(
    "INSERT INTO nina_instance (id, tenant_id, rig_id, name, token_hash, token_prefix, created_at) VALUES ($1, $2, $3, 'Texas-PC Mini', $4, 'npm_test', now())",
    [instance, t.id, rig.id, instance.replace(/-/g, '').padEnd(64, '0')],
  );
  return { id: t.id, rig: rig.id, ic1848, ngc7380, instance };
}

beforeEach(async () => {
  await pg.reset();
  deps = {
    sqs: { send: () => Promise.resolve({}) },
    failureQueueUrl: 'q',
    admin: () => Promise.resolve(new TenantAdminRepository(pg.db, { kind: 'ops_cli' })),
    equipment: (tenantId) => Promise.resolve(new EquipmentRepository(pg.db, { tenantId })),
    database: () => Promise.resolve(pg.db),
    appOrigin: 'https://nina-pm.svenesis.org',
    now: () => NOW,
  };
});

const run = (args: object) => runOpsCommand({ command: 'demo-evaluation', ...args }, deps);

interface Plan {
  to: string;
  keep: Record<string, number>;
  creates: { sessions: number; captures: number; usableNights: number };
  demoProjects: { name: string }[];
  existingProjects: { name: string }[];
}

/** Ablauf wie `pnpm demo:evaluation`: plan → clear … → projects → nights … → finish, mit `to` und `keep`. */
async function fullRun() {
  const plan = await run({ tenant: 'test', step: 'plan' });
  expect(plan.ok).toBe(true);
  const p = plan.output as Plan;
  const fixed = { tenant: 'test', to: p.to, keep: p.keep };
  for (;;) {
    const c = await run({ ...fixed, step: 'clear' });
    expect(c.ok).toBe(true);
    if ((c.output as { done: boolean }).done) break;
  }
  expect((await run({ ...fixed, step: 'projects' })).ok).toBe(true);
  let from: number | null = 0;
  while (from !== null) {
    const r = await run({ ...fixed, step: 'nights', from, count: 30 });
    expect(r.ok).toBe(true);
    from = (r.output as { next: number | null }).next;
  }
  const fin = await run({ ...fixed, step: 'finish' });
  expect(fin.ok).toBe(true);
  return p;
}

describe('ops-cli demo-evaluation', () => {
  it('nur der Test-Mandant', async () => {
    const r = await runOpsCommand(
      { command: 'demo-evaluation', tenant: 'demo', step: 'plan' },
      deps,
    );
    expect(r).toMatchObject({ ok: false, output: { error: 'demo.tenant_not_allowed' } });
    expect((await run({ tenant: 'test', step: 'plan' })).output).toMatchObject({
      error: 'tenant.not_found',
    });
  });

  it('Aufbau wie im Export: Demo-Projekte, 90 Nächte, vorhandene Projekte behalten ihren Stand', async () => {
    const t = await tenant('test');
    const other = await tenant('other');
    for (const x of [t, other])
      await pg.admin.query(
        "INSERT INTO session (id, tenant_id, rig_id, night, started_at, status) VALUES ($1, $2, $3, '2026-09-24', '2026-09-24T20:00:00Z', 'completed')",
        [crypto.randomUUID(), x.id, x.rig],
      );

    const plan = await fullRun();
    expect(plan.to).toBe('2026-09-25');
    expect(plan.existingProjects.map((p) => p.name).sort()).toEqual([
      'IC 1848 – Seelennebel',
      'NGC 7380 – Wizard Nebula',
    ]);
    expect(plan.demoProjects.map((p) => p.name)).toEqual([
      'Demo – M 31 Andromedagalaxie (LRGB)',
      'Demo – NGC 7000 Nordamerikanebel (HOO)',
      'Demo – IC 1396 Elefantenrüssel (SHO)',
      'Demo – M 33 Dreiecksgalaxie (LRGB)',
      'Demo – NGC 6888 Mondsichelnebel (HOO)',
    ]);
    // Etwa 55–70 % nutzbare Nächte in 90 Nächten.
    expect(plan.creates.usableNights).toBeGreaterThan(45);
    expect(plan.creates.usableNights).toBeLessThan(66);

    const sessions = await count('SELECT count(*)::int AS n FROM session WHERE tenant_id = $1', [
      t.id,
    ]);
    expect(sessions).toBe(plan.creates.sessions);
    expect(
      await count(
        'SELECT count(*)::int AS n FROM session WHERE tenant_id = $1 AND nina_instance_id = $2',
        [t.id, t.instance],
      ),
    ).toBe(sessions);
    expect(
      await count('SELECT count(*)::int AS n FROM session WHERE tenant_id = $1', [other.id]),
    ).toBe(1);

    // Vorhandene Projekte: exakt der heutige Stand (akzeptiert), Status unverändert aktiv.
    for (const [id, accepted] of [
      [t.ic1848, 4],
      [t.ngc7380, 12],
    ] as const) {
      const rows = (
        await pg.admin.query(
          'SELECT acquired_count - rejected_count AS accepted FROM exposure_line WHERE project_id = $1',
          [id],
        )
      ).rows as { accepted: number }[];
      expect(rows.map((r) => Number(r.accepted))).toEqual([accepted, accepted, accepted]);
      expect(
        (await one<{ status: string }>('SELECT status FROM project WHERE id = $1', [id])).status,
      ).toBe('active');
    }

    // Demo-Projekte mit Endstatus nach Geschichte, Filter des Mandanten (LUMINOS/RED/GREEN/BLUE).
    const demo = (
      await pg.admin.query(
        "SELECT name, status FROM project WHERE tenant_id = $1 AND name LIKE 'Demo – %' ORDER BY name",
        [t.id],
      )
    ).rows as { name: string; status: string }[];
    expect(Object.fromEntries(demo.map((d) => [d.name, d.status]))).toEqual({
      'Demo – IC 1396 Elefantenrüssel (SHO)': 'active',
      'Demo – M 31 Andromedagalaxie (LRGB)': 'completed',
      'Demo – M 33 Dreiecksgalaxie (LRGB)': 'on_hold',
      'Demo – NGC 6888 Mondsichelnebel (HOO)': 'unfinished',
      'Demo – NGC 7000 Nordamerikanebel (HOO)': 'active',
    });
    expect(
      (
        await pg.admin.query(
          "SELECT DISTINCT filter_short_name AS f FROM exposure_line l JOIN project p ON p.id = l.project_id WHERE p.tenant_id = $1 AND p.name LIKE 'Demo – M 31%' ORDER BY 1",
          [t.id],
        )
      ).rows.map((r) => (r as { f: string }).f),
    ).toEqual(['BLUE', 'GREEN', 'LUMINOS', 'RED']);
    // Kanalbalance bei NGC 7000: Ha fertig, OIII deutlich dahinter (> 30 Prozentpunkte).
    const gap = (
      await pg.admin.query(
        "SELECT l.filter_short_name AS f, (l.acquired_count - l.rejected_count)::float / l.planned_count AS r FROM exposure_line l JOIN project p ON p.id = l.project_id WHERE p.tenant_id = $1 AND p.name LIKE 'Demo – NGC 7000%'",
        [t.id],
      )
    ).rows as { f: string; r: number }[];
    const ratio = Object.fromEntries(gap.map((g) => [g.f, Number(g.r)]));
    expect((ratio.HA ?? 0) - (ratio.OIII ?? 0)).toBeGreaterThan(0.3);

    // Zähler = Aufnahmen; Protokolle, Klarnacht-Statistik, ungeprüfte Sessions.
    expect(
      await count(
        `SELECT count(*)::int AS n FROM exposure_line l WHERE l.tenant_id = $1
         AND l.acquired_count <> (SELECT count(*) FROM capture c WHERE c.exposure_line_id = l.id)`,
        [t.id],
      ),
    ).toBe(0);
    expect(
      await count('SELECT count(*)::int AS n FROM session_log WHERE tenant_id = $1', [t.id]),
    ).toBeGreaterThan(20);
    expect(
      await count(
        'SELECT count(*)::int AS n FROM site_night_stat WHERE tenant_id = $1 AND usable',
        [t.id],
      ),
    ).toBe(plan.creates.usableNights);
    expect(
      await count('SELECT count(*)::int AS n FROM session WHERE tenant_id = $1 AND NOT reviewed', [
        t.id,
      ]),
    ).toBeGreaterThan(0);

    // Zweiter Lauf mit demselben Stand: gleiche Mengen, keine doppelten Projekte.
    const projects = await count('SELECT count(*)::int AS n FROM project WHERE tenant_id = $1', [
      t.id,
    ]);
    const again = await fullRun();
    expect(again.keep).toEqual(plan.keep);
    expect(await count('SELECT count(*)::int AS n FROM session WHERE tenant_id = $1', [t.id])).toBe(
      sessions,
    );
    expect(await count('SELECT count(*)::int AS n FROM project WHERE tenant_id = $1', [t.id])).toBe(
      projects,
    );
  }, 240_000);
});
