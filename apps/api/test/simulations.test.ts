/** `POST /web/v1/simulations` (AP-13f, TK 7.2): speichern als night_plan, Nacht passt, Rig im Mandanten. */
import { COOKIE_NAMES } from '@nina-pm/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CAMERA, rigInput, SITE, TELESCOPE } from './support/equipment';
import { createStack, type Stack } from './support/stack';

let s: Stack;
beforeAll(async () => {
  s = await createStack();
});
beforeEach(() => s.reset());
afterAll(() => s.close());

const plan = (night: string) => ({
  nightPlanId: '0190c3f4-0000-7000-8000-00000000abcd',
  engineVersion: '0.6.0',
  inputHash: `sha256:${'a'.repeat(64)}`,
  outputHash: `sha256:${'b'.repeat(64)}`,
  night,
  startAtUtc: null,
  nightWindow: { startUtc: '2026-09-17T23:00:00Z', endUtc: '2026-09-18T12:00:00Z' },
  darkness: {
    civilStartUtc: null,
    civilEndUtc: null,
    nauticalStartUtc: null,
    nauticalEndUtc: null,
    astronomicalStartUtc: null,
    astronomicalEndUtc: null,
  },
  darknessEndUtc: null,
  flatsNotBeforeUtc: '2026-09-18T11:00:00Z',
  flatsNotAfterUtc: null,
  sessionEndUtc: '2026-09-18T12:00:00Z',
  blocks: [],
  summary: { targets: 0, plannedFrames: {} },
  diagnostics: [],
  warnings: [],
});

async function setup() {
  const tenantId = await s.seed.tenant('alpha');
  const identity = await s.seed.identity();
  const user = await s.seed.member(identity.id, tenantId, 'user');
  const cookies = { [COOKIE_NAMES.session]: await s.seed.session(identity.id, tenantId, 'tenant') };
  const eq = s.services.repositories({ tenantId }).equipment();
  const now = s.clock.now();
  const site = await eq.createSite(crypto.randomUUID(), SITE, now);
  const telescope = await eq.createTelescope(crypto.randomUUID(), TELESCOPE, now);
  const camera = await eq.createCamera(crypto.randomUUID(), CAMERA, now);
  const rig = await eq.createRig(
    crypto.randomUUID(),
    rigInput(site.id, telescope.id, camera.id),
    now,
  );
  const post = async (body: unknown) => {
    const res = await s.request('/api/web/v1/simulations', { method: 'POST', body, cookies });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  return { user, rig, post };
}

describe('POST /web/v1/simulations', () => {
  it('speichert als night_plan(origin web_simulation, reason simulation) mit Ersteller', async () => {
    const t = await setup();
    const r = await t.post({ rigId: t.rig.id, night: '2026-09-17', plan: plan('2026-09-17') });
    expect(r.status).toBe(201);
    const row = await s.pg.admin.query(
      'SELECT origin, reason, night::text AS night, engine_version, created_by FROM night_plan WHERE id = $1',
      [r.body.id],
    );
    expect(row.rows[0]).toEqual({
      origin: 'web_simulation',
      reason: 'simulation',
      night: '2026-09-17',
      engine_version: '0.6.0',
      created_by: t.user,
    });
  });

  it('Plan einer anderen Nacht → 422; unbekanntes Rig → 404', async () => {
    const t = await setup();
    const wrong = await t.post({ rigId: t.rig.id, night: '2026-09-18', plan: plan('2026-09-17') });
    expect([wrong.status, wrong.body.code]).toEqual([422, 'validation.failed']);
    const missing = await t.post({
      rigId: crypto.randomUUID(),
      night: '2026-09-17',
      plan: plan('2026-09-17'),
    });
    expect([missing.status, missing.body.code]).toEqual([404, 'resource.not_found']);
  });
});
