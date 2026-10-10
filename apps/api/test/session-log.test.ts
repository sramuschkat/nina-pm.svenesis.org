/**
 * AP-30 (FA-AUS-16/17; S-64; PGlite) nach einer Fake-Plugin-Nacht – Klarnacht-Statistik: `session_close` schreibt `site_night_stat` (nutzbar ab 1 h akzeptierter Lights,
 * Maximum über die Sessions der Nacht), ältere manuelle Einträge (Erfassen entfällt seit AP-77), Monatszeile und
 * Treffsicherheit.
 */
import { runFakeNight } from '@nina-pm/fake-plugin';
import { COOKIE_NAMES } from '@nina-pm/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sessionCloseHandler } from '../src/worker/session-jobs';
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
  const userIdentity = await s.seed.identity({ mfaEnabled: true });
  await s.seed.member(userIdentity.id, tenantId, 'user');
  const cookie = async (identityId: string) => ({
    [COOKIE_NAMES.session]: await s.seed.session(identityId, tenantId, 'tenant'),
  });
  const ownerCookies = await cookie(ownerIdentity.id);
  const userCookies = await cookie(userIdentity.id);
  const web = async (
    path: string,
    o: {
      method?: string;
      body?: unknown;
      as?: 'owner' | 'user';
      headers?: Record<string, string>;
    } = {},
  ) => {
    const res = await s.request(`/api/web/v1${path}`, {
      ...(o.method ? { method: o.method } : {}),
      ...(o.body !== undefined ? { body: o.body } : {}),
      ...(o.headers ? { headers: o.headers } : {}),
      cookies: o.as === 'user' ? userCookies : ownerCookies,
    });
    const text = await res.text();
    return {
      status: res.status,
      etag: res.headers.get('etag'),
      body: (text ? JSON.parse(text) : null) as Body,
    };
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
  const token = (
    await web('/nina-instances', { method: 'POST', body: { id: id(), rigId: rig.id, name: 'PC' } })
  ).body.token as string;
  const fakeNight = () =>
    runFakeNight({
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
  const q = async <T>(text: string, params: unknown[] = []) =>
    (await s.pg.admin.query(text, params)).rows as T[];
  const close = async (sessionId: string) => {
    const handler = sessionCloseHandler({
      db: () => Promise.resolve(s.pg.db),
      enqueue: () => Promise.resolve(undefined),
    });
    await handler({
      job: { id: id(), tenantId, input: { sessionId } } as never,
      now: () => s.clock.now(),
    });
  };
  return { tenantId, web, site, fakeNight, q, close };
}

const SNAPSHOT = {
  night: NIGHT,
  fetchedAtUtc: '2026-09-18T12:00:00Z',
  hours: 6,
  cloudPct: 12.4,
  transparencyPct: 71.5,
  seeingScore: 0.6,
  temperatureC: 9.3,
  humidityPct: 78,
  windKmh: 11.2,
  ratingIndex: 3,
  nightMean: 0.72,
  moonIllumPct: 41.8,
};

describe('Klarnacht-Statistik (S-64)', () => {
  it('session_close schreibt die Nacht; ab 1 h akzeptierter Lights nutzbar; alte manuelle Nächte zählen', async () => {
    const t = await setup();
    await t.fakeNight();
    const sessions = await t.q<{ id: string }>('SELECT id FROM session ORDER BY started_at');
    for (const x of sessions) await t.close(x.id);
    const perSession = await t.q<{ s: number }>(
      `SELECT sum(exposure_s)::float AS s FROM capture
        WHERE frame_type = 'light' AND rejected = false AND project_id IS NOT NULL GROUP BY session_id`,
    );
    const best = Math.max(...perSession.map((r) => Number(r.s)));
    expect(best).toBeLessThan(3600);
    const [stat] = await t.q<{ usable: boolean; usable_hours: number; source: string }>(
      'SELECT usable, usable_hours::float AS usable_hours, source FROM site_night_stat',
    );
    expect(stat).toMatchObject({ usable: false, source: 'session' });
    expect(stat?.usable_hours).toBeCloseTo(Math.round((best / 3600) * 100) / 100, 5);

    // Mehr Belichtungszeit → nutzbar (Maximum der Sessions, nicht die Summe).
    const [busiest] = await t.q<{ id: string }>(
      `SELECT session_id AS id FROM capture WHERE frame_type = 'light' AND project_id IS NOT NULL
        GROUP BY session_id ORDER BY count(*) DESC LIMIT 1`,
    );
    const sid = busiest?.id as string;
    await t.q(
      "UPDATE capture SET exposure_s = 1800 WHERE session_id = $1 AND frame_type = 'light' AND project_id IS NOT NULL",
      [sid],
    );
    await t.q('UPDATE session SET forecast_snapshot = $2::jsonb WHERE id = $1', [
      sid,
      JSON.stringify(SNAPSHOT),
    ]);
    await t.close(sid);
    const view = await t.web(`/sites/${t.site.id}/clear-nights?from=2026-09-01&to=2026-09-18`);
    expect(view.status).toBe(200);
    const nights = view.body.nights as Body[];
    expect(nights).toHaveLength(18);
    expect(nights[0]).toMatchObject({
      night: NIGHT,
      source: 'session',
      usable: true,
      forecastRatingIndex: 3,
      rejectedPct: 0,
    });
    expect((nights[0]?.usableHours as number) >= 1).toBe(true);
    expect(view.body.accuracy).toEqual({ compared: 1, hits: 1, hitPct: 100 });

    // „Bewölkt erfassen“ entfällt (AP-77); ältere manuelle Einträge bleiben in der Statistik.
    expect(
      (
        await t.web(`/sites/${t.site.id}/clear-nights/2026-09-17`, {
          method: 'PUT',
          body: { usable: false },
        })
      ).status,
    ).toBe(404);
    await t.q(
      `INSERT INTO site_night_stat (tenant_id, site_id, night, usable, usable_hours, source)
        SELECT tenant_id, id, '2026-09-17', false, 0, 'manual' FROM site WHERE id = $1`,
      [t.site.id],
    );
    const after = await t.web(`/sites/${t.site.id}/clear-nights?from=2026-09-01&to=2026-09-18`);
    expect(after.body.months).toEqual([
      {
        month: '2026-09',
        recorded: 2,
        usable: 1,
        usablePct: 50,
        meanUsableHours: expect.any(Number),
      },
    ]);
    expect((after.body.nights as Body[])[1]).toMatchObject({
      night: '2026-09-17',
      source: 'manual',
      usable: false,
      sessionIds: [],
    });

    // Zeitraum zu lang oder verkehrt herum → 422.
    expect(
      (await t.web(`/sites/${t.site.id}/clear-nights?from=2026-09-18&to=2026-09-01`)).status,
    ).toBe(422);
    expect(
      (await t.web(`/sites/${t.site.id}/clear-nights?from=2020-01-01&to=2026-09-01`)).status,
    ).toBe(422);
  });
});
