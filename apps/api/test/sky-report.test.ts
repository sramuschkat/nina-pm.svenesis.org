/**
 * AP-69 (S-65; FA-AUS-26 … FA-AUS-29; PGlite): Auswertung „Himmel“ – Stunden je Projekt und Filter im Zeitraum mit
 * Filtertyp, Bildfeld aus dem Rig, Nächte je Rig mit Stunden je Projekt, Mond je Nacht; Filter Rig und Status,
 * Mandantentrennung und Grenzen des Zeitraums.
 */
import { COOKIE_NAMES } from '@nina-pm/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CAMERA, filterInput, rigInput, SITE, TELESCOPE } from './support/equipment';
import { createStack, type Stack } from './support/stack';

let s: Stack;
beforeAll(async () => {
  s = await createStack();
});
beforeEach(async () => {
  await s.reset();
  s.clock.set(new Date('2026-10-10T14:00:00Z'));
});
afterAll(() => s.close());

type Body = Record<string, unknown>;
const id = () => crypto.randomUUID();

async function tenant(key: string) {
  const tenantId = await s.seed.tenant(key);
  const identity = await s.seed.identity({ mfaEnabled: true });
  const owner = await s.seed.member(identity.id, tenantId, 'admin');
  await s.seed.owner(tenantId, owner);
  const cookies = {
    [COOKIE_NAMES.session]: await s.seed.session(identity.id, tenantId, 'tenant'),
  };
  const web = async (path: string, o: { method?: string; body?: unknown } = {}) => {
    const res = await s.request(`/api/web/v1${path}`, {
      ...(o.method ? { method: o.method } : {}),
      ...(o.body !== undefined ? { body: o.body } : {}),
      cookies,
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as Body };
  };
  const eq = s.services.repositories({ tenantId, memberId: owner }).equipment();
  const now = s.clock.now();
  const site = await eq.createSite(id(), SITE, now);
  const telescope = await eq.createTelescope(id(), TELESCOPE, now);
  const camera = await eq.createCamera(id(), CAMERA, now);
  const rig = await eq.createRig(id(), rigInput(site.id, telescope.id, camera.id), now);
  const rig2 = await eq.createRig(
    id(),
    { ...rigInput(site.id, telescope.id, camera.id), name: 'Zweites Rig' },
    now,
  );
  const ha = await eq.createFilter(id(), { ...filterInput('Ha'), filterType: 'narrowband' }, now);
  const lum = await eq.createFilter(id(), { ...filterInput('L'), filterType: 'luminance' }, now);
  /** Freigegebenes, aktives Projekt mit je einer Zeile je Filter; liefert Projekt- und Zeilen-IDs. */
  const project = async (
    name: string,
    rigId: string,
    raDeg: number,
    decDeg: number,
    filterIds: string[],
  ) => {
    const created = await web('/projects', {
      method: 'POST',
      body: { id: id(), name, rigId, targetName: name, raDeg, decDeg },
    });
    const pid = created.body.id as string;
    const panelId = (created.body.panels as { id: string }[])[0]?.id as string;
    const lines: string[] = [];
    for (const filterId of filterIds) {
      const lineId = id();
      await web(`/projects/${pid}/lines`, {
        method: 'POST',
        body: { id: lineId, panelId, filterId, exposureS: 300, plannedCount: 24, moonMode: 'none' },
      });
      lines.push(lineId);
    }
    await s.pg.admin.query(
      "UPDATE project SET approval_status = 'approved', status = 'active', rig_id = requested_rig_id WHERE id = $1",
      [pid],
    );
    return { pid, lines };
  };
  const night = (pid: string, lineId: string, key: string, integrationS: number) =>
    s.pg.admin.query(
      `INSERT INTO capture_night (tenant_id, exposure_line_id, night, project_id, acquired_count, integration_s)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tenantId, lineId, key, pid, Math.round(integrationS / 300), integrationS],
    );
  return { web, rig, rig2, ha, lum, project, night };
}

describe('Auswertung – Himmel (S-65)', () => {
  it('Stunden je Projekt und Filter im Zeitraum, Bildfeld, Nächte je Rig, Mond je Nacht', async () => {
    const t = await tenant('alpha');
    const a = await t.project('NGC 7000', t.rig.id, 314.7, 44.3, [t.ha.id, t.lum.id]);
    const b = await t.project('M 31', t.rig2.id, 10.7, 41.3, [t.lum.id]);
    const planned = await t.project('IC 1805', t.rig.id, 38.2, 61.5, [t.ha.id]);
    await t.night(a.pid, a.lines[0] as string, '2026-10-01', 3600);
    await t.night(a.pid, a.lines[1] as string, '2026-10-01', 1800);
    await t.night(a.pid, a.lines[0] as string, '2026-10-05', 7200);
    // Vor dem Zeitraum: zählt nur in die Gesamtstunden.
    await t.night(a.pid, a.lines[0] as string, '2026-09-01', 900);
    await t.night(b.pid, b.lines[0] as string, '2026-10-05', 5400);

    const r = await t.web('/reports/sky?from=2026-10-01&to=2026-10-10');
    expect(r.status).toBe(200);
    const projects = r.body.projects as Body[];
    const byName = new Map(projects.map((p) => [p.name, p]));
    expect([...byName.keys()].sort()).toEqual(['IC 1805', 'M 31', 'NGC 7000']);
    const ngc = byName.get('NGC 7000') as Body;
    expect(ngc).toMatchObject({
      rigId: t.rig.id,
      raDeg: 314.7,
      decDeg: 44.3,
      periodIntegrationS: 12600,
      totalIntegrationS: 13500,
      plannedS: 2 * 24 * 300,
      status: 'active',
      projectType: 'deep_sky',
    });
    expect(ngc.byFilter).toEqual(
      expect.arrayContaining([
        { filter: 'Ha', filterType: 'narrowband', integrationS: 10800 },
        { filter: 'L', filterType: 'luminance', integrationS: 1800 },
      ]),
    );
    // Bildfeld GT81 × 0,8 (382 mm) mit IMX533 (3008 px à 3,76 µm): 2,03″/px ⇒ 1,69° im Quadrat.
    const fov = ngc.fov as { widthDeg: number; heightDeg: number };
    expect(fov.widthDeg).toBeCloseTo(1.6946, 4);
    expect(fov.heightDeg).toBe(fov.widthDeg);
    expect((ngc.panels as Body[]).length).toBe(1);
    expect(byName.get('IC 1805')).toMatchObject({ periodIntegrationS: 0, byFilter: [] });

    const nights = r.body.nights as { rigId: string; night: string; projects: Body[] }[];
    expect(nights.map((n) => `${n.rigId === t.rig.id ? 'A' : 'B'} ${n.night}`)).toEqual(
      t.rig.id < t.rig2.id
        ? ['A 2026-10-01', 'A 2026-10-05', 'B 2026-10-05']
        : ['B 2026-10-05', 'A 2026-10-01', 'A 2026-10-05'],
    );
    const first = nights.find((n) => n.rigId === t.rig.id && n.night === '2026-10-01');
    expect(first?.projects).toEqual([{ projectId: a.pid, integrationS: 5400 }]);
    expect((r.body.rigs as Body[]).map((x) => x.name).sort()).toEqual(
      ['Starfront – GT81 – Ares-M Pro', 'Zweites Rig'].sort(),
    );

    const moon = r.body.moon as { night: string; illumPct: number; phaseDeg: number }[];
    expect(moon.map((m) => m.night)).toEqual(
      Array.from({ length: 10 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`),
    );
    // Vollmond 26.09.2026, Neumond 10.10.2026: abnehmend, am Ende fast neu.
    expect(moon[0]?.illumPct).toBeGreaterThan(50);
    expect(moon[9]?.illumPct).toBeLessThan(5);
    expect(moon.every((m) => m.phaseDeg >= 0 && m.phaseDeg < 360)).toBe(true);
    void planned;
  });

  it('Filter Rig und Status, Mandantentrennung, Grenzen des Zeitraums', async () => {
    const t = await tenant('alpha');
    const a = await t.project('NGC 7000', t.rig.id, 314.7, 44.3, [t.ha.id]);
    await t.project('M 31', t.rig2.id, 10.7, 41.3, [t.lum.id]);
    await t.night(a.pid, a.lines[0] as string, '2026-10-01', 3600);
    const only = await t.web(`/reports/sky?from=2026-10-01&to=2026-10-02&rigId=${t.rig.id}`);
    expect((only.body.projects as Body[]).map((p) => p.name)).toEqual(['NGC 7000']);
    expect((only.body.rigs as Body[]).map((x) => x.id)).toEqual([t.rig.id]);
    const done = await t.web('/reports/sky?from=2026-10-01&to=2026-10-02&status=completed');
    expect(done.body.projects).toEqual([]);

    const other = await tenant('beta');
    const foreign = await other.web('/reports/sky?from=2026-10-01&to=2026-10-02');
    expect(foreign.status).toBe(200);
    expect(foreign.body.projects).toEqual([]);
    expect(foreign.body.nights).toEqual([]);

    expect((await t.web('/reports/sky?from=2026-10-05&to=2026-10-01')).status).toBe(422);
    expect((await t.web('/reports/sky?from=2025-01-01&to=2026-10-01')).status).toBe(422);
    expect((await t.web('/reports/sky?to=2026-10-01')).status).toBe(422);
    const max = await t.web('/reports/sky?from=2025-09-07&to=2026-10-10');
    expect(max.status).toBe(200);
    expect((max.body.moon as Body[]).length).toBe(399);
  });
});
