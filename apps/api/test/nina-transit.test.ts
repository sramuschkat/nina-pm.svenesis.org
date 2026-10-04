/**
 * Auslieferung festgelegter Transits an NINA (AP-44; transit.md §3, §8, §9; TK 6.3, 7.6): ein festgelegter Transit der
 * laufenden Nacht steht in `GET /targets` mit Ephemeride und Beobachtung und ergibt in `POST /plan` einen Transitblock;
 * Festlegen und Aufheben ändern das ETag; andere Nächte, Rigs und Mandanten sehen ihn nicht; der Abschluss wartet die
 * Nachfrist ab und zählt Nachmeldungen ohne zweites Discord-Ereignis. HAT-P-17 b mit verkürzter Periode in Starfront.
 */
import { replaceExoCatalog, settleTransits, TRANSIT_SETTLE_GRACE_MS } from '@nina-pm/db';
import { COOKIE_NAMES, nina, type ExoProjectCreated, type ExoProjectDetail } from '@nina-pm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clearExoCatalogCache } from '../src/exo/search';
import { CAMERA, filterInput, rigInput, SCHEDULER, SITE, TELESCOPE } from './support/equipment';
import { HAT } from './support/exo';
import { createStack, type Stack } from './support/stack';

let s: Stack;
type Body = Record<string, unknown>;
const id = () => crypto.randomUUID();

interface World {
  readonly tenantId: string;
  readonly rigId: string;
  readonly rigBId: string;
  readonly web: <T = Body>(
    path: string,
    method?: string,
    body?: unknown,
  ) => Promise<{ status: number; body: T }>;
  readonly token: string;
  readonly tokenB: string;
}

/** Mandant mit Admin, zwei Rigs am Standort Starfront (Rot bestätigt) und je einer NINA-Instanz. */
async function world(key: string): Promise<World> {
  const tenantId = await s.seed.tenant(key);
  const identity = await s.seed.identity({ mfaEnabled: true });
  const adminId = await s.seed.member(identity.id, tenantId, 'admin');
  await s.seed.owner(tenantId, adminId);
  const cookies = { [COOKIE_NAMES.session]: await s.seed.session(identity.id, tenantId, 'tenant') };
  const web = async <T = Body>(path: string, method = 'GET', body?: unknown) => {
    const res = await s.request(`/api/web/v1${path}`, {
      method,
      cookies,
      ...(body !== undefined ? { body } : {}),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  };
  const eq = s.services.repositories({ tenantId, memberId: adminId }).equipment();
  const now = s.clock.now();
  const site = await eq.createSite(id(), SITE, now);
  const telescope = await eq.createTelescope(id(), TELESCOPE, now);
  const camera = await eq.createCamera(id(), CAMERA, now);
  const red = await eq.createFilter(
    id(),
    { ...filterInput('RED'), centerWavelengthNm: 655, bandwidthNm: 110 },
    now,
  );
  const rigs: string[] = [];
  for (const name of ['A', 'B']) {
    const rig = await eq.createRig(
      id(),
      { ...rigInput(site.id, telescope.id, camera.id), name },
      now,
    );
    await eq.updateScheduler(rig.id, SCHEDULER, now);
    await eq.putFilterWheel(
      rig.id,
      { slots: [{ position: 1, filterId: red.id, ninaFilterName: 'Red' }] },
      now,
    );
    rigs.push(rig.id);
  }
  const [rigId = '', rigBId = ''] = rigs;
  const token = async (rig: string) =>
    (
      await web<{ token: string }>('/nina-instances', 'POST', {
        id: id(),
        rigId: rig,
        name: `PC ${rig}`,
      })
    ).body.token;
  return { tenantId, rigId, rigBId, web, token: await token(rigId), tokenB: await token(rigBId) };
}

const ninaCall = async (token: string, path: string, method = 'GET', body?: unknown) => {
  const res = await s.request(`/api/nina/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
    ...(body !== undefined ? { body } : {}),
  });
  const text = await res.text();
  return {
    status: res.status,
    etag: res.headers.get('etag'),
    body: (text ? JSON.parse(text) : null) as Body,
  };
};

interface TargetProjectBody {
  id: string;
  type: string;
  panels: { lines: { id: string; ninaFilterName: string | null }[] }[];
  exoplanet: {
    planet: string;
    ephemeris: { periodD: number; durationH: number };
    observation: {
      id: string;
      status: string;
      night: string;
      windowStartUtc: string;
      windowEndUtc: string;
      allowAutofocus: boolean;
      counts: { planned: number };
    };
  } | null;
}
interface PlanBlockBody {
  kind: string;
  projectId: string;
  startUtc: string;
  endUtc: string;
  transitObservationId?: string | null;
  entries: { cmd: string; atUtc: string; untilUtc?: string; exposureLineId?: string }[];
}
const projectsOf = (b: Body) => b.projects as TargetProjectBody[];
const blocksOf = (b: Body) => b.blocks as PlanBlockBody[];

let w: World;
let other: World;
let projectId: string;
let night: string;
let nextNight: string;
let prevNight: string;
let epoch: number;
let observationId: string;
let windowStartUtc: string;
let windowEndUtc: string;
let lineId: string;

const shiftNight = (n: string, days: number) =>
  new Date(Date.parse(`${n}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
/** 13:00 CDT: nach dem Mittag der Nacht (Nacht-Schlüssel wechselt mittags), vor der Dämmerung. */
const afternoonOf = (n: string) => new Date(`${n}T18:00:00Z`);

beforeAll(async () => {
  s = await createStack();
  clearExoCatalogCache();
  s.clock.set(new Date('2026-09-24T14:00:00Z'));
  await replaceExoCatalog(
    s.pg.db,
    'exoclock',
    [{ ...HAT, periodD: 1.3, periodSigmaD: 1e-6 }],
    s.clock.now(),
  );
  w = await world('transit-a');
  other = await world('transit-b');
  projectId = (
    await w.web<ExoProjectCreated>('/exo/projects', 'POST', {
      id: id(),
      rigId: w.rigId,
      catalog: 'exoclock',
      planet: 'HAT-P-17b',
      exposureS: 60,
    })
  ).body.projectId;
  // Freigegeben und aktiv am Rig A: der Admin legt dann sofort fest (transit.md §8).
  await s.pg.admin.query(
    "UPDATE project SET approval_status = 'approved', status = 'active', rig_id = requested_rig_id WHERE id = $1",
    [projectId],
  );
  const d = (await w.web<ExoProjectDetail>(`/projects/${projectId}/exo`)).body;
  const first = d.upcoming[0];
  if (!first) throw new Error('kein beobachtbarer Transit in der Vorhersage');
  epoch = first.item.transit.n;
  night = first.night;
  nextNight = shiftNight(night, 1);
  prevNight = shiftNight(night, -1);
  s.clock.set(afternoonOf(night));
}, 120_000);
afterAll(() => s.close());

describe('Transit an NINA ausliefern (AP-44, transit.md §9)', () => {
  let before: string | null = null;

  it('ohne Festlegung: kein Exoplaneten-Projekt in targets und plan', async () => {
    const t = await ninaCall(w.token, '/targets');
    expect(t.status).toBe(200);
    expect(projectsOf(t.body)).toEqual([]);
    expect(t.body.deliveryNights).toEqual([
      { night, projects: 0 },
      { night: nextNight, projects: 0 },
      { night: shiftNight(night, 2), projects: 0 },
    ]);
    before = t.etag;
  });

  it('festgelegter Transit der Nacht: targets mit Ephemeride und Beobachtung, ETag ändert sich', async () => {
    const locked = await w.web<ExoProjectDetail>(`/projects/${projectId}/exo/lock`, 'POST', {
      epoch,
    });
    expect(locked.status).toBe(200);
    const o = locked.body.observations.find((x) => x.epoch === epoch && x.status === 'locked');
    expect(o).toBeDefined();
    observationId = o?.id ?? '';
    windowStartUtc = o?.windowStartUtc ?? '';
    windowEndUtc = o?.windowEndUtc ?? '';

    const t = await ninaCall(w.token, '/targets');
    expect(nina.NinaTargets.safeParse(t.body).error?.issues ?? []).toEqual([]);
    expect(t.etag).not.toBe(before);
    const [p] = projectsOf(t.body);
    expect(p).toMatchObject({
      id: projectId,
      type: 'exoplanet',
      exoplanet: {
        planet: 'HAT-P-17b',
        ephemeris: { periodD: 1.3 },
        observation: {
          id: observationId,
          status: 'locked',
          night,
          windowStartUtc,
          windowEndUtc,
          allowAutofocus: false,
        },
      },
    });
    expect(p?.exoplanet?.observation.counts.planned).toBeGreaterThan(100);
    expect(p?.exoplanet?.ephemeris.durationH).toBeGreaterThan(0);
    expect(p?.panels).toHaveLength(1);
    expect(p?.panels[0]?.lines).toEqual([expect.objectContaining({ ninaFilterName: 'Red' })]);
    lineId = p?.panels[0]?.lines[0]?.id ?? '';
    expect(t.body.deliveryNights).toEqual([
      { night, projects: 1 },
      { night: nextNight, projects: 0 },
      { night: shiftNight(night, 2), projects: 0 },
    ]);
    // Unverändert → 304
    const cached = await s.request('/api/nina/v1/targets', {
      headers: { authorization: `Bearer ${w.token}`, 'if-none-match': t.etag ?? '' },
    });
    expect(cached.status).toBe(304);
    // Web-Ansicht „An NINA ausgeliefert“: dieselbe Liste und derselbe ETag.
    const delivery = await w.web(`/rigs/${w.rigId}/delivery`);
    expect(delivery.body).toMatchObject({
      targetsEtag: t.etag,
      items: [expect.objectContaining({ id: projectId, projectType: 'exoplanet' })],
    });
  });

  it('POST /plan: Transitblock ab Fensterbeginn, expose_series bis Fensterende', async () => {
    const r = await ninaCall(w.token, '/plan', 'POST', { night, reason: 'initial' });
    expect(r.status).toBe(200);
    expect(nina.NinaPlanResponse.safeParse(r.body).error?.issues ?? []).toEqual([]);
    const transit = blocksOf(r.body).filter((b) => b.kind === 'transit');
    expect(transit).toHaveLength(1);
    const [b] = transit;
    expect(b).toMatchObject({
      projectId,
      transitObservationId: observationId,
      startUtc: windowStartUtc,
    });
    // Fensterende, sofern das Ziel bis dahin über der Mindesthöhe steht; sonst endet die Engine früher.
    expect(Date.parse(b?.endUtc ?? '')).toBeLessThanOrEqual(Date.parse(windowEndUtc));
    const series = b?.entries.find((e) => e.cmd === 'expose_series');
    expect(series).toMatchObject({
      exposureLineId: lineId,
      atUtc: windowStartUtc,
      untilUtc: b?.endUtc,
    });
    // Slew-Vorlauf als erster Eintrag vor dem Fensterbeginn (NIN5-5).
    expect(Date.parse(b?.entries[0]?.atUtc ?? '')).toBeLessThan(Date.parse(windowStartUtc));
    // Kein regulärer Block des Exoplaneten-Projekts.
    expect(blocksOf(r.body).filter((x) => x.projectId === projectId)).toHaveLength(1);
  });

  it('andere Nacht, anderes Rig, anderer Mandant: kein Transit', async () => {
    const next = await ninaCall(w.token, '/plan', 'POST', { night: nextNight, reason: 'initial' });
    expect(next.status).toBe(200);
    expect(blocksOf(next.body).some((b) => b.kind === 'transit')).toBe(false);
    expect(blocksOf(next.body).some((b) => b.projectId === projectId)).toBe(false);

    const rigB = await ninaCall(w.tokenB, '/targets');
    expect(projectsOf(rigB.body)).toEqual([]);
    const planB = await ninaCall(w.tokenB, '/plan', 'POST', { night, reason: 'initial' });
    expect(blocksOf(planB.body)).toEqual([]);

    const foreign = await ninaCall(other.token, '/targets');
    expect(projectsOf(foreign.body)).toEqual([]);
    const foreignPlan = await ninaCall(other.token, '/plan', 'POST', { night, reason: 'initial' });
    expect(blocksOf(foreignPlan.body)).toEqual([]);

    // Vorabend: Transit erst in der nächsten Nacht der Auslieferung.
    s.clock.set(afternoonOf(prevNight));
    const early = await ninaCall(w.token, '/targets');
    expect(projectsOf(early.body)).toEqual([]);
    expect(early.body.deliveryNights).toEqual([
      { night: prevNight, projects: 0 },
      { night, projects: 1 },
      { night: nextNight, projects: 0 },
    ]);
    s.clock.set(afternoonOf(night));
  });

  it('Aufheben ändert das ETag und nimmt das Projekt aus targets; erneut festlegen liefert es wieder', async () => {
    const locked = await ninaCall(w.token, '/targets');
    const cancel = await w.web(`/projects/${projectId}/exo/lock/${observationId}`, 'DELETE');
    expect(cancel.status).toBe(200);
    const after = await ninaCall(w.token, '/targets');
    expect(projectsOf(after.body)).toEqual([]);
    expect(after.etag).not.toBe(locked.etag);
    const plan = await ninaCall(w.token, '/plan', 'POST', { night, reason: 'initial' });
    expect(blocksOf(plan.body).some((b) => b.kind === 'transit')).toBe(false);

    const again = await w.web<ExoProjectDetail>(`/projects/${projectId}/exo/lock`, 'POST', {
      epoch,
    });
    const o = again.body.observations.find((x) => x.epoch === epoch && x.status === 'locked');
    observationId = o?.id ?? '';
    const relocked = await ninaCall(w.token, '/targets');
    expect(projectsOf(relocked.body)[0]?.exoplanet?.observation.id).toBe(observationId);
    expect(relocked.etag).not.toBe(after.etag);
    expect(relocked.etag).not.toBe(locked.etag);
  });

  it('Erlaubnisse des Projekts (Autofokus) ändern das ETag', async () => {
    const t0 = await ninaCall(w.token, '/targets');
    expect(
      (await w.web(`/projects/${projectId}/exo`, 'PATCH', { allowAutofocus: true })).status,
    ).toBe(200);
    const t1 = await ninaCall(w.token, '/targets');
    expect(t1.etag).not.toBe(t0.etag);
    expect(projectsOf(t1.body)[0]?.exoplanet?.observation.allowAutofocus).toBe(true);
  });
});

describe('Abschluss nach Fensterende mit Nachfrist (transit.md §8)', () => {
  const capture = async (sessionId: string) =>
    s.pg.admin.query(
      `INSERT INTO capture (id, tenant_id, session_id, project_id, panel_id, exposure_line_id, transit_observation_id,
         night, captured_at, filter_short_name, exposure_s, result, file_name)
       SELECT $1, $2, $3, l.project_id, l.panel_id, l.id, $4, $5, $6, 'RED', 60, 'saved', 'x.fits'
       FROM exposure_line l WHERE l.id = $7`,
      [id(), w.tenantId, sessionId, observationId, night, windowEndUtc, lineId],
    );
  const status = async () =>
    (
      await s.pg.admin.query(
        'SELECT status, acquired_count FROM transit_observation WHERE id = $1',
        [observationId],
      )
    ).rows[0] as { status: string; acquired_count: number } | undefined;
  const deliveries = async () =>
    (
      await s.pg.admin.query(
        'SELECT event_key FROM discord_delivery WHERE object_id = $1 ORDER BY event_key',
        [observationId],
      )
    ).rows.map((r) => (r as { event_key: string }).event_key);

  it('innerhalb der Nachfrist bleibt die Beobachtung festgelegt; danach beobachtet; Nachmeldung zählt ohne neues Ereignis', async () => {
    await s.pg.admin.query(
      `INSERT INTO discord_channel (id, tenant_id, name, webhook_url, webhook_hint, categories, created_at, updated_at)
       VALUES ($1, $2, '#sessions', 'https://discord.com/api/webhooks/1234567/abc-defg', 'defg', '["sessions"]', now(), now())`,
      [id(), w.tenantId],
    );
    const sessionId = id();
    await s.pg.admin.query(
      `INSERT INTO session (id, tenant_id, rig_id, night, started_at) VALUES ($1, $2, $3, $4, $5)`,
      [sessionId, w.tenantId, w.rigId, night, windowStartUtc],
    );
    const end = Date.parse(windowEndUtc);
    // Fensterende erreicht, Meldungen noch im Postausgang: weder verpasst noch beobachtet.
    const early = await settleTransits(s.pg.db, new Date(end + 60_000));
    expect(early).toMatchObject({ observed: 0, missed: 0 });
    expect(await status()).toMatchObject({ status: 'locked' });
    // Die letzte Aufnahme kommt nach Fensterende an.
    await capture(sessionId);
    const inGrace = await settleTransits(s.pg.db, new Date(end + TRANSIT_SETTLE_GRACE_MS - 60_000));
    expect(inGrace).toMatchObject({ observed: 0, missed: 0 });
    // Nach der Nachfrist: beobachtet mit der Anzahl.
    const settled = await settleTransits(s.pg.db, new Date(end + TRANSIT_SETTLE_GRACE_MS));
    expect(settled).toMatchObject({ observed: 1, missed: 0 });
    expect(await status()).toEqual({ status: 'observed', acquired_count: 1 });
    // Nachmeldung: neu gezählt, kein zweites Ereignis.
    await capture(sessionId);
    const later = await settleTransits(s.pg.db, new Date(end + 2 * TRANSIT_SETTLE_GRACE_MS));
    expect(later).toMatchObject({ observed: 0, missed: 0, recounted: 1 });
    expect(await status()).toEqual({ status: 'observed', acquired_count: 2 });
    expect(await settleTransits(s.pg.db, new Date(end + 3 * TRANSIT_SETTLE_GRACE_MS))).toEqual({
      expired: 0,
      observed: 0,
      missed: 0,
    });
    expect(await deliveries()).toEqual(['transit.observed']);
  });
});
