/**
 * Aufwand-Kennzeichen gegen die Datenbank (AP-13e, PGlite): Speichern legt `effort:<projectId>` an,
 * der Job rechnet und speichert (`effort_stale` zurück, Kennzeichen in der Projektansicht), Kandidaten
 * des Standortlaufs, und Änderungen an Rig-Settings bzw. Mondprofil setzen `effort_stale` wieder.
 */
import { EffortRepository } from '@nina-pm/db';
import { COOKIE_NAMES } from '@nina-pm/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runProjectEffort } from '../src/worker/effort';
import { effortDbDeps } from '../src/worker/effort-db';
import {
  CAMERA,
  filterInput,
  MOON,
  rigInput,
  SCHEDULER,
  SITE,
  TELESCOPE,
} from './support/equipment';
import { createStack, type Stack } from './support/stack';

let s: Stack;
beforeAll(async () => {
  s = await createStack();
});
beforeEach(() => s.reset());
afterAll(() => s.close());

const API = '/api/web/v1';
const id = () => crypto.randomUUID();
type Body = Record<string, unknown> & {
  effortStale?: boolean;
  effort?: { tag: string | null; stride: number } | null;
  panels?: { id: string }[];
};

async function setup() {
  const tenantId = await s.seed.tenant('alpha');
  const identity = await s.seed.identity({ mfaEnabled: true });
  const owner = await s.seed.member(identity.id, tenantId, 'admin');
  await s.seed.owner(tenantId, owner);
  const cookies = { [COOKIE_NAMES.session]: await s.seed.session(identity.id, tenantId, 'tenant') };
  const call = async (path: string, o: { method?: string; body?: unknown } = {}) => {
    const res = await s.request(`${API}${path}`, { ...o, cookies });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as Body };
  };
  const eq = s.services.repositories({ tenantId, memberId: owner }).equipment();
  const now = s.clock.now();
  const site = await eq.createSite(id(), SITE, now);
  const telescope = await eq.createTelescope(id(), TELESCOPE, now);
  const camera = await eq.createCamera(id(), CAMERA, now);
  const ha = await eq.createFilter(id(), filterInput('Ha'), now);
  const moon = await eq.createMoonProfile(id(), MOON, now);
  const rig = await eq.createRig(id(), rigInput(site.id, telescope.id, camera.id), now);
  return {
    tenantId,
    call,
    eq,
    site,
    rig,
    ha,
    moon,
    deps: effortDbDeps(() => Promise.resolve(s.pg.db)),
  };
}

async function projectWithLine(t: Awaited<ReturnType<typeof setup>>) {
  const created = await t.call('/projects', {
    method: 'POST',
    body: { id: id(), name: 'NGC 281', rigId: t.rig.id, raDeg: 13.2458, decDeg: 56.6194 },
  });
  expect(created.status).toBe(201);
  const pid = created.body.id as string;
  const panelId = created.body.panels?.[0]?.id as string;
  const line = await t.call(`/projects/${pid}/lines`, {
    method: 'POST',
    body: {
      id: id(),
      panelId,
      filterId: t.ha.id,
      exposureS: 300,
      plannedCount: 12,
      moonMode: 'profile',
      moonProfileId: t.moon.id,
    },
  });
  expect(line.status).toBe(201);
  await s.pg.admin.query(
    "UPDATE project SET approval_status = 'approved', status = 'active', rig_id = requested_rig_id WHERE id = $1",
    [pid],
  );
  return pid;
}

// Zwei bzw. drei volle Aufwandsrechnungen (Engine über die Saison) je Test: lokal etwa 2 s, im CI unter Last
// bis 5,2 s (01.10.2026) – über der Standardgrenze von 5 s.
const SLOW = 30_000;

describe('Aufwand-Kennzeichen (Datenbank)', () => {
  it(
    'Speichern legt den Job an; der Job rechnet, speichert und setzt effort_stale zurück',
    async () => {
      const t = await setup();
      const pid = await projectWithLine(t);
      const jobs = await s.pg.admin.query('SELECT status FROM job WHERE dedupe_key = $1', [
        `effort:${pid}`,
      ]);
      // Anlegen und Zeile hinzufügen: ein offener Job (Deduplizierung über dedupe_active).
      expect(jobs.rows.map((r) => (r as { status: string }).status)).toEqual(['pending']);

      const before = await t.call(`/projects/${pid}`);
      expect([before.body.effortStale, before.body.effort]).toEqual([true, null]);
      const effort = new EffortRepository(s.pg.db, { tenantId: t.tenantId });
      expect(await effort.candidates(t.site.id, s.clock.now())).toEqual([pid]);

      const r = await runProjectEffort(t.deps, t.tenantId, pid, new Date('2026-09-18T18:00:00Z'));
      expect(r.outcome).toBe('saved');
      const after = await t.call(`/projects/${pid}`);
      expect(after.body.effortStale).toBe(false);
      expect(after.body.effort?.tag).toBe(r.view?.tag);
      expect(after.body.effort?.stride).toBe(3);
      expect(await effort.candidates(t.site.id, s.clock.now())).toEqual([]);

      const again = await runProjectEffort(
        t.deps,
        t.tenantId,
        pid,
        new Date('2026-09-18T18:00:00Z'),
      );
      expect(again.outcome).toBe('unchanged');
    },
    SLOW,
  );

  it(
    'Rig-Settings und Mondprofil ändern → effort_stale wieder gesetzt',
    async () => {
      const t = await setup();
      const pid = await projectWithLine(t);
      await runProjectEffort(t.deps, t.tenantId, pid, new Date('2026-09-18T18:00:00Z'));
      expect((await t.call(`/projects/${pid}`)).body.effortStale).toBe(false);

      await t.eq.updateScheduler(t.rig.id, { ...SCHEDULER, overshootPct: 10 }, s.clock.now());
      expect((await t.call(`/projects/${pid}`)).body.effortStale).toBe(true);

      await runProjectEffort(t.deps, t.tenantId, pid, new Date('2026-09-18T18:00:00Z'));
      expect((await t.call(`/projects/${pid}`)).body.effortStale).toBe(false);
      const before = (await t.eq.rig(t.rig.id))?.settingsVersion ?? 0;
      await t.eq.updateMoonProfile(t.moon.id, { ...MOON, separationDeg: 90 }, s.clock.now());
      expect((await t.call(`/projects/${pid}`)).body.effortStale).toBe(true);
      // Mondprofil steckt in den Zielen: settings_version steigt, damit das targets-ETag wechselt.
      expect((await t.eq.rig(t.rig.id))?.settingsVersion).toBe(before + 1);
    },
    SLOW,
  );
});
