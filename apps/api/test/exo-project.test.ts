/**
 * Exoplaneten-Projekt (AP-42 Teil 2; FA-EXO-15/16/17): Anlegen aus der Suche (Typ, Wunsch-Rig, Bedingungen aus
 * dem Suchfilter, Transit-Zeile mit bestätigtem Filter, Ephemeride), eindeutig je Planet/Rig/Ersteller (OP-22),
 * Projekte anderer Mitglieder als Hinweis, kommende Transits aus der gespeicherten Ephemeride und die Übernahme
 * einer neueren Katalog-Ephemeride mit Historie. HAT-P-17 b in Starfront; Uhr 24.09.2026, 60 Nächte.
 */
import { replaceExoCatalog } from '@nina-pm/db';
import { COOKIE_NAMES, type ExoProjectCreated, type ExoProjectDetail } from '@nina-pm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clearExoCatalogCache } from '../src/exo/search';
import type { projectView } from '../src/routes/web-projects';
import { CAMERA, filterInput, rigInput, SCHEDULER, SITE, TELESCOPE } from './support/equipment';
import { HAT } from './support/exo';
import { createStack, type Stack } from './support/stack';

type ProjectView = ReturnType<typeof projectView>;

let s: Stack;
let owner: Record<string, string>;
let other: Record<string, string>;
let rigId: string;
let bareRigId: string;
let redId: string;

beforeAll(async () => {
  s = await createStack();
  clearExoCatalogCache();
  const tenantId = await s.seed.tenant('exo-projekt');
  const a = await s.seed.identity({ mfaEnabled: true });
  const memberA = await s.seed.member(a.id, tenantId, 'admin');
  owner = { [COOKIE_NAMES.session]: await s.seed.session(a.id, tenantId, 'tenant') };
  const b = await s.seed.identity({ mfaEnabled: true });
  await s.seed.member(b.id, tenantId, 'user');
  other = { [COOKIE_NAMES.session]: await s.seed.session(b.id, tenantId, 'tenant') };
  const eq = s.services.repositories({ tenantId, memberId: memberA }).equipment();
  const now = s.clock.now();
  const site = await eq.createSite(crypto.randomUUID(), SITE, now);
  const telescope = await eq.createTelescope(crypto.randomUUID(), TELESCOPE, now);
  const camera = await eq.createCamera(crypto.randomUUID(), CAMERA, now);
  const red = await eq.createFilter(
    crypto.randomUUID(),
    { ...filterInput('RED'), centerWavelengthNm: 655, bandwidthNm: 110 },
    now,
  );
  redId = red.id;
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
  const bare = await eq.createRig(
    crypto.randomUUID(),
    { ...rigInput(site.id, telescope.id, camera.id), name: 'Ohne Filterrad' },
    now,
  );
  bareRigId = bare.id;
  await replaceExoCatalog(s.pg.db, 'exoclock', [HAT], now);
}, 120_000);
afterAll(() => s.close());

const create = async (cookies: Record<string, string>, body: Record<string, unknown>) => {
  const res = await s.request('/api/web/v1/exo/projects', {
    method: 'POST',
    cookies,
    body: { id: crypto.randomUUID(), catalog: 'exoclock', planet: 'HAT-P-17b', ...body },
  });
  return { status: res.status, body: (await res.json()) as ExoProjectCreated };
};
const project = async (id: string) =>
  (await (await s.request(`/api/web/v1/projects/${id}`, { cookies: owner })).json()) as ProjectView;
const exo = async (id: string, cookies = owner) => {
  const res = await s.request(`/api/web/v1/projects/${id}/exo`, { cookies });
  return { status: res.status, body: (await res.json()) as ExoProjectDetail };
};

describe('POST /api/web/v1/exo/projects (FA-EXO-15)', () => {
  let projectId: string;

  it('legt ein Exoplaneten-Projekt mit Ephemeride und Transit-Zeile an', async () => {
    const r = await create(owner, { rigId, twilight: 'nautical', minAltDeg: 35, exposureS: 90 });
    expect(r.status).toBe(201);
    expect(r.body.created).toBe(true);
    projectId = r.body.projectId;
    const p = await project(projectId);
    expect(p).toMatchObject({
      projectType: 'exoplanet',
      name: 'HAT-P-17b',
      targetName: 'HAT-P-17',
      targetType: 'exoplanet',
      rigId,
      approvalStatus: 'draft',
    });
    expect(p.raDeg).toBeCloseTo(HAT.raDeg, 6);
    // Bedingungen aus dem Suchfilter (FA-EXO-05), Mond nur Hinweis (FA-EXO-20)
    expect(p.conditions).toMatchObject({
      twilight: 'nautical',
      minAltitudeDeg: 35,
      moonAvoidanceEnabled: false,
    });
    // genau eine Transit-Zeile mit dem bestätigten Ersatzfilter (FA-EXO-08/20)
    const lines = p.panels.flatMap((x) => x.lines);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      filterId: redId,
      exposureS: 90,
      plannedCount: 0,
      moonMode: 'none',
    });
  });

  it('eindeutig je Planet, Rig und Ersteller: das eigene Projekt kommt zurück (OP-22)', async () => {
    const r = await create(owner, { rigId });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ projectId, created: false });
  });

  it('anderes Rig ohne bestätigten Filter: neues Projekt ohne Zeile', async () => {
    const r = await create(owner, { rigId: bareRigId });
    expect(r.status).toBe(201);
    expect(r.body.projectId).not.toBe(projectId);
    expect((await project(r.body.projectId)).panels.flatMap((x) => x.lines)).toHaveLength(0);
  });

  it('unbekannter Planet oder fremdes Rig: 404', async () => {
    expect((await create(owner, { rigId, planet: 'WASP-999b' })).status).toBe(404);
    expect((await create(owner, { rigId: crypto.randomUUID() })).status).toBe(404);
  });

  it('GET …/exo: Ephemeride aus dem Katalog, kein Angebot, kommende Transits aus der Ephemeride', async () => {
    const r = await exo(projectId);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      planet: 'HAT-P-17b',
      star: 'HAT-P-17',
      catalog: 'exoclock',
      minAltDeg: 35,
      twilight: 'nautical',
      catalogUpdate: null,
      history: [],
      others: [],
      nights: 60,
    });
    expect(r.body.ephemeris).toMatchObject({
      t0BjdTdb: HAT.t0BjdTdb,
      periodD: HAT.periodD,
      source: 'exoclock',
      active: true,
    });
    expect(r.body.rig?.id).toBe(rigId);
    expect(r.body.fromNight).toBe('2026-09-23');
    // HAT-P-17 b: Mitte 11.10.2026 06:45Z ist beobachtbar (Suche, exo-transits.test.ts)
    const mids = r.body.upcoming.map((x) => x.item.transit.tcUtc.slice(0, 10));
    expect(mids).toContain('2026-10-11');
    expect(r.body.upcoming.every((x) => x.item.transit.observable)).toBe(true);
    expect(r.body.upcoming.find((x) => x.item.transit.tcUtc.startsWith('2026-10-11'))?.night).toBe(
      '2026-10-10',
    );
    expect(new Set(r.body.upcoming.map((x) => x.item.transit.n)).size).toBe(r.body.upcoming.length);
  });

  it('Projekte anderer Mitglieder zum selben Planeten als Hinweis; fremder Entwurf nicht lesbar', async () => {
    const r = await create(other, { rigId });
    expect(r.status).toBe(201);
    expect((await exo(projectId)).body.others).toEqual([
      {
        projectId: r.body.projectId,
        name: 'HAT-P-17b',
        createdByName: 'Mitglied',
        rigName: expect.any(String),
      },
    ]);
    expect((await exo(projectId, other)).status).toBe(403);
  });

  it('neuerer Katalogstand: Angebot mit Verschiebung, Übernahme mit Historie (FA-EXO-16)', async () => {
    const t0 = HAT.t0BjdTdb + 2 / 1440; // 2 min später
    await replaceExoCatalog(
      s.pg.db,
      'exoclock',
      [{ ...HAT, t0BjdTdb: t0, t0Raw: t0 }],
      s.clock.now(),
    );
    clearExoCatalogCache();
    const before = await exo(projectId);
    expect(before.body.catalogUpdate).toMatchObject({ catalog: 'exoclock', t0BjdTdb: t0 });
    expect(before.body.catalogUpdate?.nextMidShiftMin).toBeCloseTo(2, 3);
    expect(before.body.catalogUpdate?.periodDeltaS).toBe(0);

    const res = await s.request(`/api/web/v1/projects/${projectId}/ephemeris/refresh`, {
      method: 'POST',
      cookies: owner,
    });
    expect(res.status).toBe(200);
    const after = (await res.json()) as ExoProjectDetail;
    expect(after.ephemeris.t0BjdTdb).toBe(t0);
    expect(after.catalogUpdate).toBeNull();
    expect(after.history).toHaveLength(1);
    expect(after.history[0]).toMatchObject({ t0BjdTdb: HAT.t0BjdTdb, active: false });

    // Wiederholung ohne Änderung legt keine weitere Historie an
    const again = await s.request(`/api/web/v1/projects/${projectId}/ephemeris/refresh`, {
      method: 'POST',
      cookies: owner,
    });
    expect(((await again.json()) as ExoProjectDetail).history).toHaveLength(1);
  });

  it('Deep-Sky-Projekt hat keinen Exoplaneten-Teil (404)', async () => {
    const id = crypto.randomUUID();
    await s.request('/api/web/v1/projects', {
      method: 'POST',
      cookies: owner,
      body: { id, name: 'M 31' },
    });
    expect((await exo(id)).status).toBe(404);
  });
});
