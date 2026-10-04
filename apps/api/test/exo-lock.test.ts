/**
 * Transit-Beobachtungen (AP-43; transit.md §8; FA-EXO-18…21, 33; FA-FRG-04/09) als Zustands-Test über die API:
 * Wunsch im Entwurf (höchstens einer), Einreichen, Freigabe legt fest, Ersteller-Festlegung als Transit-Bestätigung
 * in der Warteschlange, Bestätigen/Ablehnen, Obergrenze offener Beobachtungen, geteiltes Ereignis (FA-EXO-33a) und
 * abweichende Zeile, Frist, Aufheben mit neuer primärer Beobachtung, Einstellungen, Abschluss nach Fensterende.
 * HAT-P-17 b mit verkürzter Periode (1,3 d) in Starfront, Uhr ab 24.09.2026.
 */
import { replaceExoCatalog, settleTransits, TRANSIT_SETTLE_GRACE_MS } from '@nina-pm/db';
import {
  COOKIE_NAMES,
  type ExoProjectCreated,
  type ExoProjectDetail,
  type QueueItem,
} from '@nina-pm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clearExoCatalogCache } from '../src/exo/search';
import { CAMERA, filterInput, rigInput, SCHEDULER, SITE, TELESCOPE } from './support/equipment';
import { HAT } from './support/exo';
import { createStack, type Stack } from './support/stack';

let s: Stack;
let tenantId: string;
let admin: Record<string, string>;
let bea: Record<string, string>;
let carl: Record<string, string>;
let rigId: string;
let beaProject: string;
let carlProject: string;

beforeAll(async () => {
  s = await createStack();
  clearExoCatalogCache();
  tenantId = await s.seed.tenant('exo-lock');
  const a = await s.seed.identity({ mfaEnabled: true });
  const adminId = await s.seed.member(a.id, tenantId, 'admin');
  admin = { [COOKIE_NAMES.session]: await s.seed.session(a.id, tenantId, 'tenant') };
  for (const set of [
    (c: Record<string, string>) => (bea = c),
    (c: Record<string, string>) => (carl = c),
  ]) {
    const i = await s.seed.identity({ mfaEnabled: true });
    await s.seed.member(i.id, tenantId, 'user');
    set({ [COOKIE_NAMES.session]: await s.seed.session(i.id, tenantId, 'tenant') });
  }
  const eq = s.services.repositories({ tenantId, memberId: adminId }).equipment();
  const now = s.clock.now();
  const site = await eq.createSite(crypto.randomUUID(), SITE, now);
  const telescope = await eq.createTelescope(crypto.randomUUID(), TELESCOPE, now);
  const camera = await eq.createCamera(crypto.randomUUID(), CAMERA, now);
  const red = await eq.createFilter(
    crypto.randomUUID(),
    { ...filterInput('RED'), centerWavelengthNm: 655, bandwidthNm: 110 },
    now,
  );
  const rig = await eq.createRig(
    crypto.randomUUID(),
    rigInput(site.id, telescope.id, camera.id),
    now,
  );
  rigId = rig.id;
  await eq.updateScheduler(rig.id, SCHEDULER, now);
  await eq.putFilterWheel(
    rig.id,
    { slots: [{ position: 1, filterId: red.id, ninaFilterName: 'Red' }] },
    now,
  );
  // Kurze Periode, damit in 60 Nächten genug beobachtbare Transits für den Ablauf liegen.
  await replaceExoCatalog(s.pg.db, 'exoclock', [{ ...HAT, periodD: 1.3, periodSigmaD: 1e-6 }], now);
}, 120_000);
afterAll(() => s.close());

const req = async <T>(
  cookies: Record<string, string>,
  path: string,
  method = 'GET',
  body?: unknown,
  headers?: Record<string, string>,
) => {
  const res = await s.request(`/api/web/v1${path}`, {
    method,
    cookies,
    ...(body !== undefined ? { body } : {}),
    ...(headers ? { headers } : {}),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text ? JSON.parse(text) : null) as T & { code?: string },
  };
};
const exo = (cookies: Record<string, string>, id: string) =>
  req<ExoProjectDetail>(cookies, `/projects/${id}/exo`);
const lock = (cookies: Record<string, string>, id: string, epoch: number) =>
  req<ExoProjectDetail>(cookies, `/projects/${id}/exo/lock`, 'POST', { epoch });
const version = async (id: string) =>
  (await req<{ version: number }>(admin, `/projects/${id}`)).body.version;
const create = async (cookies: Record<string, string>) =>
  (
    await req<ExoProjectCreated>(cookies, '/exo/projects', 'POST', {
      id: crypto.randomUUID(),
      rigId,
      catalog: 'exoclock',
      planet: 'HAT-P-17b',
      exposureS: 60,
    })
  ).body.projectId;
const open = (d: ExoProjectDetail) =>
  d.observations.filter((o) => o.status === 'requested' || o.status === 'locked');

describe('Transit-Beobachtungen (AP-43)', () => {
  let epochs: number[] = [];

  it('Entwurf: Wunsch (höchstens einer), Richtwert Geplant auf der Zeile', async () => {
    beaProject = await create(bea);
    const d0 = (await exo(bea, beaProject)).body;
    expect(d0.lockMode).toBe('wish');
    epochs = d0.upcoming.map((u) => u.item.transit.n);
    expect(epochs.length).toBeGreaterThanOrEqual(2);
    const first = (await lock(bea, beaProject, epochs[0] as number)).body;
    expect(open(first)).toHaveLength(1);
    expect(open(first)[0]).toMatchObject({ status: 'requested', epoch: epochs[0] });
    expect(open(first)[0]?.plannedCount).toBeGreaterThan(100);
    // ein neuer Wunsch ersetzt den bisherigen
    const second = (await lock(bea, beaProject, epochs[1] as number)).body;
    expect(open(second).map((o) => o.epoch)).toEqual([epochs[1]]);
    expect(second.observations.find((o) => o.epoch === epochs[0])?.status).toBe('cancelled');
    const p = (
      await req<{ panels: { lines: { plannedCount: number }[] }[] }>(bea, `/projects/${beaProject}`)
    ).body;
    expect(p.panels[0]?.lines[0]?.plannedCount).toBe(open(second)[0]?.plannedCount);
    // Wiederholung derselben Epoche ist idempotent
    expect(open((await lock(bea, beaProject, epochs[1] as number)).body)).toHaveLength(1);
  });

  it('unbekannte Epoche 422; fremder Entwurf 403', async () => {
    expect((await lock(bea, beaProject, 1)).status).toBe(422);
    expect((await lock(carl, beaProject, epochs[0] as number)).status).toBe(403);
  });

  it('Einreichen zeigt den Wunsch in der Warteschlange; Freigabe legt ihn fest', async () => {
    expect(
      (
        await req(
          bea,
          `/projects/${beaProject}/submit`,
          'POST',
          {},
          { 'if-match': `"${String(await version(beaProject))}"` },
        )
      ).status,
    ).toBe(200);
    const queue = (await req<{ items: QueueItem[] }>(admin, '/queue')).body.items;
    const item = queue.find((q) => q.projectId === beaProject);
    expect(item).toMatchObject({
      kind: 'project',
      transit: { epoch: epochs[1], planet: 'HAT-P-17b' },
    });
    expect(item?.expiresAt).toBe(item?.transit?.deadlineUtc);
    expect((await lock(bea, beaProject, epochs[0] as number)).status).toBe(403);

    const approve = await req(
      admin,
      `/projects/${beaProject}/approve`,
      'POST',
      { rigId, status: 'active' },
      { 'if-match': `"${String(await version(beaProject))}"` },
    );
    expect(approve.status).toBe(200);
    const d = (await exo(bea, beaProject)).body;
    expect(open(d)).toEqual([expect.objectContaining({ epoch: epochs[1], status: 'locked' })]);
    expect(d.lockMode).toBe('request');
  });

  it('Ersteller legt fest → Transit-Bestätigung in der Warteschlange; Admin bestätigt', async () => {
    const d = (await lock(bea, beaProject, epochs[0] as number)).body;
    const o = d.observations.find((x) => x.epoch === epochs[0] && x.status !== 'cancelled');
    expect(o?.status).toBe('requested');
    const queue = (await req<{ items: QueueItem[] }>(bea, '/queue')).body.items;
    const t = queue.find((q) => q.kind === 'transit');
    expect(t).toMatchObject({ id: o?.id, projectId: beaProject, votes: { count: 0 } });
    // eigene Bestätigung nicht möglich, Admin schon
    expect((await req(bea, `/transit-observations/${o?.id ?? ''}/confirm`, 'POST')).status).toBe(
      403,
    );
    expect((await req(admin, `/transit-observations/${o?.id ?? ''}/confirm`, 'POST')).status).toBe(
      204,
    );
    expect((await exo(bea, beaProject)).body.observations.find((x) => x.id === o?.id)?.status).toBe(
      'locked',
    );
  });

  it('Obergrenze offener Beobachtungen für den Ersteller: 409 transit.too_many_open', async () => {
    await s.pg.admin.query(
      `UPDATE tenant SET settings = settings || '{"exoUserMaxOpenLocks": 2}'::jsonb WHERE id = $1`,
      [tenantId],
    );
    const next = epochs[2];
    if (next === undefined) return;
    const r = await lock(bea, beaProject, next);
    expect([r.status, r.body.code]).toEqual([409, 'transit.too_many_open']);
    await s.pg.admin.query(
      `UPDATE tenant SET settings = settings - 'exoUserMaxOpenLocks' WHERE id = $1`,
      [tenantId],
    );
  });

  it('dasselbe Ereignis eines anderen Mitglieds: gleiche Zeile verknüpft, andere Zeile 409', async () => {
    carlProject = await create(carl);
    const d = (await exo(carl, carlProject)).body;
    expect(d.upcoming.find((u) => u.item.transit.n === epochs[1])?.conflict?.kind).toBe('share');
    await lock(carl, carlProject, epochs[1] as number);
    await req(
      carl,
      `/projects/${carlProject}/submit`,
      'POST',
      {},
      { 'if-match': `"${String(await version(carlProject))}"` },
    );
    // abweichende Belichtung → Freigabe scheitert mit share_mismatch
    await s.pg.admin.query('UPDATE exposure_line SET exposure_s = 90 WHERE project_id = $1', [
      carlProject,
    ]);
    const bad = await req(
      admin,
      `/projects/${carlProject}/approve`,
      'POST',
      { rigId, status: 'active' },
      { 'if-match': `"${String(await version(carlProject))}"` },
    );
    expect([bad.status, bad.body.code]).toEqual([409, 'transit.share_mismatch']);
    await s.pg.admin.query('UPDATE exposure_line SET exposure_s = 60 WHERE project_id = $1', [
      carlProject,
    ]);
    const ok = await req(
      admin,
      `/projects/${carlProject}/approve`,
      'POST',
      { rigId, status: 'active' },
      { 'if-match': `"${String(await version(carlProject))}"` },
    );
    expect(ok.status).toBe(200);
    const bo = (await exo(bea, beaProject)).body.observations.find((o) => o.epoch === epochs[1]);
    const co = open((await exo(carl, carlProject)).body)[0];
    expect(co).toMatchObject({ status: 'locked', primaryObservationId: bo?.id });
  });

  it('Aufheben: die verknüpfte Beobachtung wird primär', async () => {
    const bo = (await exo(bea, beaProject)).body.observations.find((o) => o.epoch === epochs[1]);
    const r = await req<ExoProjectDetail>(
      bea,
      `/projects/${beaProject}/exo/lock/${bo?.id ?? ''}`,
      'DELETE',
    );
    expect(r.status).toBe(200);
    expect(r.body.observations.find((o) => o.id === bo?.id)?.status).toBe('cancelled');
    expect(open((await exo(carl, carlProject)).body)[0]?.primaryObservationId).toBeNull();
  });

  it('Ablehnen mit Begründung storniert; Frist verstrichen → 409, Admin darf', async () => {
    const d = (await lock(bea, beaProject, epochs[1] as number)).body;
    const o = d.observations.find((x) => x.epoch === epochs[1] && x.status === 'requested');
    expect(o).toBeDefined();
    const decline = await req(admin, `/transit-observations/${o?.id ?? ''}/decline`, 'POST', {
      comment: 'Nacht belegt',
    });
    expect(decline.status).toBe(204);
    // Uhr hinter die Frist des nächsten Transits stellen
    const u = d.upcoming.find((x) => x.item.transit.n === epochs[1]);
    s.clock.set(new Date(Date.parse(u?.deadlineUtc ?? '') + 60_000));
    const late = await lock(bea, beaProject, epochs[1] as number);
    expect([late.status, late.body.code]).toEqual([409, 'transit.deadline_passed']);
    expect((await lock(admin, beaProject, epochs[1] as number)).status).toBe(200);
  });

  it('Einstellungen: Baseline 30 min verkürzt das Fenster der Vorhersage (FA-EXO-19)', async () => {
    const before = (await exo(admin, beaProject)).body.upcoming.at(-1);
    const r = await req<ExoProjectDetail>(admin, `/projects/${beaProject}/exo`, 'PATCH', {
      baselineBeforeMin: 30,
      baselineAfterMin: 30,
      allowAutofocus: true,
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ baselineBeforeMin: 30, allowAutofocus: true });
    const after = r.body.upcoming.find((u) => u.item.transit.n === before?.item.transit.n);
    expect(
      Date.parse(after?.item.transit.windowStartUtc ?? '') -
        Date.parse(before?.item.transit.windowStartUtc ?? ''),
    ).toBe(30 * 60_000);
  });

  it('nach Fensterende und Nachfrist: ohne Aufnahmen verpasst (FA-EXO-21)', async () => {
    const locked = open((await exo(admin, beaProject)).body).filter((o) => o.status === 'locked');
    const last = locked.map((o) => Date.parse(o.windowEndUtc)).sort((a, b) => b - a)[0] ?? 0;
    const at = new Date(last + TRANSIT_SETTLE_GRACE_MS);
    const result = await settleTransits(s.pg.db, at);
    expect(result.missed).toBeGreaterThanOrEqual(locked.length);
    s.clock.set(at);
    const d = (await exo(admin, beaProject)).body;
    for (const o of locked)
      expect(d.observations.find((x) => x.id === o.id)?.status).toBe('missed');
  });
});
