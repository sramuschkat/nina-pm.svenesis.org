/**
 * AP-34 (FA-AUS-18/10/11; PGlite): Projektbericht nach einer Fake-Plugin-Nacht – Filter-Summen, Verlauf je
 * Nacht, Sessions mit Frames je Filter; Filter nach Zeitraum, Rig, Status und Typ; nur freigegebene Projekte.
 */
import { runFakeNight } from '@nina-pm/fake-plugin';
import { COOKIE_NAMES } from '@nina-pm/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CAMERA, filterInput, rigInput, SCHEDULER, SITE, TELESCOPE } from './support/equipment';
import { createStack, ORIGIN_SECRET, type Stack } from './support/stack';

let s: Stack;
beforeAll(async () => {
  s = await createStack();
});
beforeEach(async () => {
  await s.reset();
  s.clock.set(new Date('2026-09-18T14:00:00Z'));
});
afterAll(() => s.close());

type Body = Record<string, unknown>;
const id = () => crypto.randomUUID();
const NIGHT = '2026-09-18';

async function setup() {
  const tenantId = await s.seed.tenant('alpha');
  const ownerIdentity = await s.seed.identity({ mfaEnabled: true });
  const owner = await s.seed.member(ownerIdentity.id, tenantId, 'admin');
  await s.seed.owner(tenantId, owner);
  const cookies = {
    [COOKIE_NAMES.session]: await s.seed.session(ownerIdentity.id, tenantId, 'tenant'),
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
  const ha = await eq.createFilter(id(), filterInput('Ha'), now);
  const rig = await eq.createRig(id(), rigInput(site.id, telescope.id, camera.id), now);
  await eq.updateScheduler(rig.id, SCHEDULER, now);
  await eq.putFilterWheel(
    rig.id,
    { slots: [{ position: 1, filterId: ha.id, ninaFilterName: 'Ha 3nm' }] },
    now,
  );
  const created = await web('/projects', {
    method: 'POST',
    body: {
      id: id(),
      name: 'NGC 281',
      rigId: rig.id,
      targetName: 'NGC 281',
      raDeg: 13.2,
      decDeg: 56.6,
    },
  });
  const pid = created.body.id as string;
  const panelId = (created.body.panels as { id: string }[])[0]?.id as string;
  await web(`/projects/${pid}/lines`, {
    method: 'POST',
    body: {
      id: id(),
      panelId,
      filterId: ha.id,
      exposureS: 300,
      plannedCount: 40,
      moonMode: 'none',
    },
  });
  await s.pg.admin.query(
    "UPDATE project SET approval_status = 'approved', status = 'active', rig_id = requested_rig_id WHERE id = $1",
    [pid],
  );
  // Entwurf ohne Freigabe: nicht im Bericht.
  await web('/projects', { method: 'POST', body: { id: id(), name: 'Entwurf', rigId: rig.id } });
  const token = (
    await web('/nina-instances', { method: 'POST', body: { id: id(), rigId: rig.id, name: 'PC' } })
  ).body.token as string;
  await runFakeNight({
    baseUrl: 'http://localhost',
    token,
    fetch: (url, init = {}) => {
      const headers = new Headers(init.headers);
      headers.set('x-origin-verify', ORIGIN_SECRET);
      return Promise.resolve(s.app.request(url, { ...init, headers }));
    },
    hooks: {
      releaseLease: async (rigId) => {
        await web(`/rigs/${rigId}/lease/release`, { method: 'POST' });
      },
    },
  });
  return { web, rig, pid };
}

describe('Projektbericht (S-63)', () => {
  it('Filter-Summen, Verlauf je Nacht und Sessions; nur freigegebene Projekte', async () => {
    const t = await setup();
    await t.web(`/projects/${t.pid}/notes`, { method: 'POST', body: { bodyMd: 'Fertig?' } });
    const r = await t.web(`/reports/projects?from=${NIGHT}&to=${NIGHT}`);
    expect(r.status).toBe(200);
    const projects = r.body.projects as Body[];
    expect(projects.map((p) => p.name)).toEqual(['NGC 281']);
    const p = projects[0] as Body;
    expect(p).toMatchObject({
      commentCount: 1,
      rigName: expect.any(String),
      status: 'active',
      projectType: 'deep_sky',
    });
    expect((p.filters as Body[])[0]).toMatchObject({ filter: 'Ha', planned: 40 });
    const nights = p.nights as { night: string; filters: Body[] }[];
    expect(nights.map((n) => n.night)).toEqual([NIGHT]);
    expect(nights[0]?.filters[0]).toMatchObject({ filter: 'Ha', accepted: expect.any(Number) });
    const sessions = p.sessions as Body[];
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0]).toMatchObject({
      night: NIGHT,
      filters: [{ filter: 'Ha', frames: expect.any(Number) }],
    });
    expect((r.body.totals as Body).projects).toBe(1);
  });

  it('Filter: Zeitraum ohne Nächte, anderer Typ, anderer Status; from > to → 422', async () => {
    const t = await setup();
    const empty = await t.web('/reports/projects?from=2026-10-01&to=2026-10-31');
    expect(((empty.body.projects as Body[])[0] as Body).nights).toEqual([]);
    expect(((empty.body.projects as Body[])[0] as Body).sessions).toEqual([]);
    expect(((await t.web('/reports/projects?type=exoplanet')).body.projects as Body[]).length).toBe(
      0,
    );
    expect(
      ((await t.web('/reports/projects?status=completed')).body.projects as Body[]).length,
    ).toBe(0);
    expect(
      ((await t.web(`/reports/projects?rigId=${t.rig.id}`)).body.projects as Body[]).length,
    ).toBe(1);
    expect((await t.web('/reports/projects?from=2026-10-02&to=2026-10-01')).status).toBe(422);
  });
});
