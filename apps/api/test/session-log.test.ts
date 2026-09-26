/**
 * AP-30 (FA-AUS-14…17; S-61 *Protokoll*, S-64; PGlite): Sitzungsprotokoll nach einer Fake-Plugin-Nacht –
 * Vorbelegung aus NINA-Bedingungen und Wetter-Schnappschuss mit Quelle je Feld, Speichern mit `If-Match`
 * (412 bei veralteter Version), Quelle *manuell* bei geändertem Wert, Rechte (User liest, speichert nicht).
 * Klarnacht-Statistik: `session_close` schreibt `site_night_stat` (nutzbar ab 1 h akzeptierter Lights,
 * Maximum über die Sessions der Nacht), manuelle Erfassung ungenutzter Nächte, Monatszeile und
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
    { slots: [{ position: 0, filterId: ha.id, ninaFilterName: 'Ha 3nm' }] },
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

describe('Sitzungsprotokoll (S-61 Protokoll)', () => {
  it('belegt aus NINA und Vorhersage vor, speichert mit If-Match und markiert Änderungen als manuell', async () => {
    const t = await setup();
    await t.fakeNight();
    const [session] = await t.q<{ id: string }>(
      'SELECT id FROM session WHERE created_offline = false ORDER BY started_at LIMIT 1',
    );
    const sid = session?.id as string;
    await t.q(
      'UPDATE session SET forecast_snapshot = $2::jsonb, nina_conditions = $3::jsonb WHERE id = $1',
      [
        sid,
        JSON.stringify(SNAPSHOT),
        JSON.stringify({
          sqm: { avg: 21.34, min: 21.1, max: 21.52 },
          ambientTempC: { avg: 8.1, min: 6.9, max: 9.4 },
          windMs: { avg: 2, min: 0.5, max: 4 },
        }),
      ],
    );

    const first = await t.web(`/sessions/${sid}/log`);
    expect(first.status).toBe(200);
    expect(first.etag).toBe('"0"');
    expect(first.body).toMatchObject({ saved: false, updatedAt: null });
    const values = first.body.values as Body;
    const sources = first.body.sources as Body;
    // NINA vor Vorhersage; Seeing liefert die Vorhersage nicht (nur NINA).
    expect(values).toMatchObject({
      sqm: 21.3,
      temperatureC: 8.1,
      windKmh: 7.2,
      humidityPct: 78,
      transparencyPct: 71.5,
      cloudsNote: '12 %',
      moonIlluminationPct: 41.8,
      seeingArcsec: null,
    });
    expect(sources).toMatchObject({
      sqm: 'nina',
      temperatureC: 'nina',
      windKmh: 'nina',
      humidityPct: 'forecast',
      transparencyPct: 'forecast',
      cloudsNote: 'forecast',
      startTime: 'auto',
      moonIlluminationPct: 'auto',
      seeingArcsec: null,
    });
    expect((first.body.nina as Body).windKmh).toEqual({ avg: 7.2, min: 1.8, max: 14.4 });
    expect((first.body.forecast as Body).ratingIndex).toBe(3);

    // User liest, speichert aber nicht (sessionlog.write nur Admin).
    expect((await t.web(`/sessions/${sid}/log`, { as: 'user' })).status).toBe(200);
    const body = { ...values, seeingArcsec: 2.4, humidityPct: 80, notesMd: 'Wind ab 2 Uhr' };
    expect((await t.web(`/sessions/${sid}/log`, { method: 'PUT', body, as: 'user' })).status).toBe(
      403,
    );

    const saved = await t.web(`/sessions/${sid}/log`, {
      method: 'PUT',
      body,
      headers: { 'if-match': '"0"' },
    });
    expect(saved.status).toBe(200);
    expect(saved.etag).not.toBe('"0"');
    expect(saved.body).toMatchObject({ saved: true, updatedByName: expect.any(String) });
    expect(saved.body.sources).toMatchObject({
      sqm: 'nina',
      seeingArcsec: 'manual',
      humidityPct: 'manual',
      transparencyPct: 'forecast',
    });
    expect((saved.body.values as Body).notesMd).toBe('Wind ab 2 Uhr');

    // Veraltete Version → 412; aktuelle Version → 200.
    const stale = await t.web(`/sessions/${sid}/log`, {
      method: 'PUT',
      body,
      headers: { 'if-match': '"0"' },
    });
    expect(stale.status).toBe(412);
    expect(stale.body.code).toBe('resource.version_conflict');
    const again = await t.web(`/sessions/${sid}/log`, {
      method: 'PUT',
      body: { ...body, sqm: null },
      headers: { 'if-match': saved.etag as string },
    });
    expect(again.status).toBe(200);
    expect((again.body.sources as Body).sqm).toBeNull();

    // Ungültige Werte → 422.
    expect(
      (await t.web(`/sessions/${sid}/log`, { method: 'PUT', body: { ...body, sqm: 30 } })).status,
    ).toBe(422);
  });
});

describe('Klarnacht-Statistik (S-64)', () => {
  it('session_close schreibt die Nacht; ab 1 h akzeptierter Lights nutzbar; manuelle Nächte', async () => {
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

    // Nacht mit Session lässt sich nicht manuell erfassen; eine andere schon – und zurücknehmen.
    s.clock.set(new Date('2026-09-20T12:00:00Z'));
    const conflict = await t.web(`/sites/${t.site.id}/clear-nights/${NIGHT}`, {
      method: 'PUT',
      body: { usable: false },
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('site_night.has_session');
    const future = await t.web(`/sites/${t.site.id}/clear-nights/2026-09-20`, {
      method: 'PUT',
      body: { usable: false },
    });
    expect(future.status).toBe(422);
    const mark = await t.web(`/sites/${t.site.id}/clear-nights/2026-09-17`, {
      method: 'PUT',
      body: { usable: false },
    });
    expect(mark.status).toBe(204);
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
    expect(
      (await t.web(`/sites/${t.site.id}/clear-nights/2026-09-17`, { method: 'DELETE' })).status,
    ).toBe(204);
    const gone = await t.web(`/sites/${t.site.id}/clear-nights?from=2026-09-17&to=2026-09-17`);
    expect((gone.body.nights as Body[])[0]).toMatchObject({ source: null, usable: null });

    // Zeitraum zu lang oder verkehrt herum → 422.
    expect(
      (await t.web(`/sites/${t.site.id}/clear-nights?from=2026-09-18&to=2026-09-01`)).status,
    ).toBe(422);
    expect(
      (await t.web(`/sites/${t.site.id}/clear-nights?from=2020-01-01&to=2026-09-01`)).status,
    ).toBe(422);
  });
});
