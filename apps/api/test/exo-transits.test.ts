/**
 * Transitsuche S-22 (AP-42): `GET /api/web/v1/exo/transits` mit echten Katalogzeilen von HAT-P-17 b (ExoClock und
 * NASA) am Standort Starfront, Nacht 10./11.10.2026 (Transitmitte 06:45Z, beobachtbar). GT81 mit 81 mm Öffnung
 * und bestätigtem Rotfilter ohne photometrisches Band.
 */
import { replaceExoCatalog, type ExoCatalogRow } from '@nina-pm/db';
import { COOKIE_NAMES, type ExoTransitList } from '@nina-pm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clearExoCatalogCache } from '../src/exo/search';
import { CAMERA, filterInput, rigInput, SCHEDULER, SITE, TELESCOPE } from './support/equipment';
import { createStack, type Stack } from './support/stack';

let s: Stack;
let cookies: Record<string, string>;
let rigId: string;
let redId: string;

const HAT: ExoCatalogRow = {
  planet: 'HAT-P-17b',
  star: 'HAT-P-17',
  disposition: null,
  raDeg: 324.5363796,
  decDeg: 30.4887347,
  magVJohnson: 10.38,
  magRCousins: 10.24,
  magSdssG: null,
  magGaiaG: 10.274,
  magTess: null,
  magBandUsed: 'V',
  teffK: 5246,
  distancePc: null,
  t0BjdTdb: 2457168.694753,
  t0SigmaD: 5.2e-5,
  periodD: 10.33853486,
  periodSigmaD: 4e-7,
  durationH: 4.04,
  durationEstimated: false,
  depthMmag: 20.37,
  depthRaw: 20.37,
  depthUnit: 'mmag',
  depthEstimated: false,
  rpOverRs: 0.1238,
  aOverRs: 22.6,
  inclinationDeg: 89.2,
  planetRadiusRe: null,
  eqTempK: null,
  exoclockPriority: 'medium',
  oMinusCMin: 1,
  minApertureMm: 127,
  minApertureEstimated: false,
  amateurReachable: true,
  timeSystemSource: 'bjd_tdb',
  timeSystemRaw: 'BJD_TDB',
  t0Raw: 2457168.694753,
  ticId: null,
};

beforeAll(async () => {
  s = await createStack();
  clearExoCatalogCache();
  const tenantId = await s.seed.tenant('exo');
  const identity = await s.seed.identity({ mfaEnabled: true });
  const member = await s.seed.member(identity.id, tenantId, 'admin');
  cookies = { [COOKIE_NAMES.session]: await s.seed.session(identity.id, tenantId, 'tenant') };
  const eq = s.services.repositories({ tenantId, memberId: member }).equipment();
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
  await replaceExoCatalog(s.pg.db, 'exoclock', [HAT], now);
  await replaceExoCatalog(
    s.pg.db,
    'nasa',
    [
      {
        ...HAT,
        planet: 'HAT-P-17 b',
        t0BjdTdb: 2456703.460703,
        t0Raw: 2456703.460703,
        periodD: 10.33852,
        exoclockPriority: null,
        minApertureMm: null,
        ticId: '266593143',
        planetRadiusRe: 11.77,
        distancePc: 92.4,
      },
    ],
    now,
  );
}, 120_000);
afterAll(() => s.close());

const get = async (query: string) => {
  const res = await s.request(`/api/web/v1/exo/transits?${query}`, { cookies });
  return { status: res.status, body: (await res.json()) as ExoTransitList };
};

describe('GET /api/web/v1/exo/transits (S-22)', () => {
  it('HAT-P-17 b in der Nacht 2026-10-10: ein Transit, zusammengeführt, beobachtbar', async () => {
    const r = await get(`rigId=${rigId}&night=2026-10-10&catalogs=exoclock,nasa`);
    expect(r.status).toBe(200);
    expect(r.body.night).toBe('2026-10-10');
    expect(r.body.site.timeZone).toBe('America/Chicago');
    expect(r.body.items).toHaveLength(1);
    const t = r.body.items[0];
    if (!t) throw new Error('kein Transit');
    expect(t).toMatchObject({
      planet: 'HAT-P-17b',
      catalog: 'exoclock',
      alsoIn: ['nasa'],
      priority: 'medium',
      spectralClass: 'G',
      // Radius und Entfernung aus dem NASA-Eintrag aufgefüllt (ExoClock kennt sie nicht)
      sizeClass: 'gas_giant',
      distancePc: 92.4,
      ticId: '266593143',
      mag: 10.38,
      magBand: 'V',
      myProjects: 0,
    });
    expect(Date.parse(t.transit.tcUtc) / 1000).toBeCloseTo(
      Date.UTC(2026, 9, 11, 6, 45, 26) / 1000,
      -1,
    );
    expect(t.transit.observable).toBe(true);
    expect(t.transit.ephemerisAge).toBe('ok');
    expect(t.transit.baselineBeforeMin).toBe(60);
    expect(t.transit.moonSepDeg).toBeGreaterThan(0);
    // ExoClock 5″ = 127 mm gegen 81 mm (64 %) → rot
    expect(t.aperture).toEqual({ requiredMm: 127, estimated: false, fit: 'insufficient' });
    // Rc empfohlen; bestätigter Rotfilter ohne Band → Ersatzfilter
    expect(t.filter).toEqual({
      band: 'Rc',
      choice: { filterId: redId, shortName: 'RED', match: 'substitute' },
    });
    // Belichtung (FA-EXO-14a): Ersatzfilter RED, NINA-Standard-Gain, Spitze höchstens 50 %
    expect(t.exposure).toMatchObject({ status: 'ok', filterShortName: 'RED', gain: null });
    if (t.exposure.status !== 'ok') throw new Error('Belichtung fehlt');
    expect(t.exposure.exposureS).toBeGreaterThan(0);
    expect(t.exposure.peakPct).toBeLessThanOrEqual(50);
    expect(t.exposure.framesInWindow).toBeGreaterThan(0);
  });

  it('nur NASA: eigener Eintrag mit geschätzter Öffnung („est“), Größenklasse aus dem Radius', async () => {
    const r = await get(`rigId=${rigId}&night=2026-10-10&catalogs=nasa`);
    const t = r.body.items[0];
    expect(t?.planet).toBe('HAT-P-17 b');
    expect(t?.sizeClass).toBe('gas_giant');
    expect(t?.aperture?.estimated).toBe(true);
    expect(t?.aperture?.requiredMm).toBe(127);
  });

  it('Stand je Katalog; ohne Nacht die laufende Nacht', async () => {
    const r = await get(`rigId=${rigId}`);
    expect(r.status).toBe(200);
    expect(r.body.night).toBe(r.body.currentNight);
    expect(r.body.catalogs.map((c) => [c.catalog, c.rows])).toEqual([
      ['exoclock', 1],
      ['nasa', 1],
      ['toi', 0],
    ]);
  });

  it('unbekanntes Rig → 404, ungültige Kataloge → 422', async () => {
    expect((await get(`rigId=${crypto.randomUUID()}`)).status).toBe(404);
    expect((await get(`rigId=${rigId}&catalogs=gaia`)).status).toBe(422);
  });
});
