/**
 * Bildbewertung (AP-72b, seit AP-77 nur als Anteil; PGlite): Qualität des Projekts je Nacht, Filter und Session, Dateiliste
 * zum Stacken (alle bzw. gute Lights mit relativem Pfad), Bewertung im Session-Detail; ein gespeicherter Modus
 * „verwerfen“ wird ignoriert – beim Eingang wird nichts verworfen, die Grenzwerte bleiben.
 */
import { COOKIE_NAMES } from '@nina-pm/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CAMERA, filterInput, rigInput, SCHEDULER, SITE, TELESCOPE } from './support/equipment';
import { createStack, type Stack } from './support/stack';

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
  const identity = await s.seed.identity({ mfaEnabled: true });
  const owner = await s.seed.member(identity.id, tenantId, 'admin');
  await s.seed.owner(tenantId, owner);
  const cookies = { [COOKIE_NAMES.session]: await s.seed.session(identity.id, tenantId, 'tenant') };
  const web = async (path: string, o: { method?: string; body?: unknown } = {}) => {
    const res = await s.request(`/api/web/v1${path}`, { ...o, cookies });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as Body };
  };
  const eq = s.services.repositories({ tenantId, memberId: owner }).equipment();
  const now = s.clock.now();
  const site = await eq.createSite(id(), SITE, now);
  const telescope = await eq.createTelescope(id(), TELESCOPE, now);
  const camera = await eq.createCamera(id(), CAMERA, now);
  const ha = await eq.createFilter(id(), filterInput('Ha'), now);
  const lum = await eq.createFilter(id(), filterInput('L'), now);
  const rig = await eq.createRig(id(), rigInput(site.id, telescope.id, camera.id), now);
  await eq.updateScheduler(rig.id, SCHEDULER, now);
  await eq.putFilterWheel(
    rig.id,
    {
      slots: [
        { position: 1, filterId: lum.id, ninaFilterName: 'LUMINOS' },
        { position: 2, filterId: ha.id, ninaFilterName: 'Ha 3nm' },
      ],
    },
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
  const lineId = id();
  await web(`/projects/${pid}/lines`, {
    method: 'POST',
    body: {
      id: lineId,
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
    await web('/nina-instances', { method: 'POST', body: { id: id(), rigId: rig.id, name: 'A' } })
  ).body.token as string;
  const call = async (path: string, o: { method?: string; body?: unknown } = {}) => {
    const res = await s.request(`/api/nina/v1${path}`, {
      method: o.method ?? 'GET',
      headers: { authorization: `Bearer ${token}` },
      ...(o.body !== undefined ? { body: o.body } : {}),
    });
    const text = await res.text();
    return {
      status: res.status,
      body: (text ? JSON.parse(text) : null) as Body,
      etag: res.headers.get('etag'),
    };
  };
  return { tenantId, siteId: site.id, rigId: rig.id, pid, panelId, lineId, web, call, cookies };
}

type World = Awaited<ReturnType<typeof setup>>;

async function session(w: World) {
  const sessionId = id();
  expect(
    (
      await w.call('/sessions', {
        method: 'POST',
        body: {
          id: sessionId,
          night: NIGHT,
          nightPlanId: null,
          startedAtUtc: '2026-09-19T00:30:00Z',
          offline: false,
        },
      })
    ).status,
  ).toBe(201);
  const plan = await w.call('/plan', {
    method: 'POST',
    body: { night: NIGHT, reason: 'initial', sessionId },
  });
  return { sessionId, nightPlanId: plan.body.nightPlanId as string };
}

const light = (w: World, nightPlanId: string, i: number, metrics: Body, extra: Body = {}) => {
  const at = new Date(Date.parse('2026-09-19T01:00:00Z') + i * 400_000)
    .toISOString()
    .replace('.000Z', 'Z');
  return {
    id: id(),
    frameType: 'light',
    capturedAtUtc: at,
    exposureMidUtc: at,
    night: NIGHT,
    blockId: null,
    projectId: w.pid,
    panelId: w.panelId,
    exposureLineId: w.lineId,
    filterShortName: 'Ha',
    filterActual: 'Ha 3nm',
    exposureS: 300,
    gain: null,
    offset: null,
    binning: 1,
    readoutMode: 'Default',
    readoutModeIndex: 0,
    raDeg: 13.2,
    decDeg: 56.6,
    rotationDeg: 0,
    pierSide: 'west',
    rotatorMechDeg: 0,
    bonus: false,
    temperatureDeviation: false,
    result: 'saved',
    fileName: `ngc281_${String(i)}.fits`,
    nightPlanId,
    metrics,
    ...extra,
  };
};

const good = { hfr: 1.6, stars: 800, guidingRmsArcsec: 0.6, cloudCoverPct: 0 };

/** 12 gute Lights, eines mit HFR 2,4 (> 1,6 + 30 %), eines mit RMS 2″. */
async function night(w: World) {
  const { sessionId, nightPlanId } = await session(w);
  const lights = [
    ...Array.from({ length: 12 }, (_, i) =>
      light(
        w,
        nightPlanId,
        i,
        good,
        i === 0 ? { relativePath: '2026-09-18/NGC 281/LIGHT/ngc281_0.fits' } : {},
      ),
    ),
    light(w, nightPlanId, 12, { ...good, hfr: 2.4 }),
    light(w, nightPlanId, 13, { ...good, guidingRmsArcsec: 2 }),
  ];
  expect(
    (
      await w.call(`/sessions/${sessionId}/captures`, {
        method: 'POST',
        body: { captures: lights },
      })
    ).status,
  ).toBe(200);
  return { sessionId, nightPlanId, lights };
}

const quality = async (w: World) => {
  const r = await w.web(`/projects/${w.pid}/quality`);
  expect(r.status).toBe(200);
  return r.body as {
    settings: Body;
    minRef: number;
    filters: Body[];
    nights: { night: string; filters: Body[]; total: Body }[];
    sessions: Body[];
    total: Body;
    truncated: boolean;
  };
};
const files = async (w: World, good: boolean) => {
  const res = await s.request(`/api/web/v1/projects/${w.pid}/quality/files?good=${String(good)}`, {
    cookies: w.cookies,
  });
  return { status: res.status, type: res.headers.get('content-type'), text: await res.text() };
};

describe('Bildbewertung als Anteil (AP-72b, AP-77)', () => {
  it('Qualität des Projekts: Anteile, Gründe, Spannen je Nacht, Filter und Session (AP-77)', async () => {
    const w = await setup();
    const { sessionId } = await night(w);
    const v = await quality(w);
    expect(v.settings).toEqual({ hfrPct: 30, starsPct: 50, rmsArcsec: 1.5, cloudPct: 50 });
    expect(v.minRef).toBe(10);
    const counts = {
      good: 12,
      flagged: 2,
      rejected: 0,
      none: 0,
      sharePct: 85.7,
      reasons: { hfr: 1, stars: 0, rms: 1, cloud: 0 },
    };
    expect(v.total).toMatchObject({
      ...counts,
      hfr: { median: 1.6, min: 1.6, max: 2.4 },
      rmsArcsec: { median: 0.6, min: 0.6, max: 2 },
    });
    expect(v.filters).toEqual([expect.objectContaining({ filter: 'Ha', ...counts })]);
    expect(v.nights).toEqual([
      {
        night: NIGHT,
        sessionIds: [sessionId],
        filters: [expect.objectContaining({ filter: 'Ha' })],
        total: expect.objectContaining(counts),
      },
    ]);
    expect(v.sessions).toEqual([expect.objectContaining({ sessionId, ...counts })]);
    expect(v.truncated).toBe(false);
  });

  it('Dateiliste: alle bzw. nur gute Lights mit relativem Pfad als CSV', async () => {
    const w = await setup();
    await night(w);
    const all = await files(w, false);
    expect(all.status).toBe(200);
    expect(all.type).toContain('text/csv');
    const rows = all.text
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n');
    expect(rows[0]).toBe(
      'night;capturedAtUtc;filter;exposureS;quality;reasons;hfr;stars;guidingRmsArcsec;relativePath;fileName',
    );
    expect(rows).toHaveLength(15);
    expect(rows[1]).toContain(
      ';good;;1.6;800;0.6;2026-09-18/NGC 281/LIGHT/ngc281_0.fits;ngc281_0.fits',
    );
    expect(rows.filter((r) => r.includes(';flagged;'))).toHaveLength(2);
    const good = await files(w, true);
    expect(good.text.trim().split('\r\n')).toHaveLength(13);
    expect(good.text).not.toContain(';flagged;');
  });

  it('Session-Detail: Bewertung je Light', async () => {
    const w = await setup();
    const { sessionId, lights } = await night(w);
    const d = (await w.web(`/sessions/${sessionId}`)).body as {
      captures: { id: string; grade: string }[];
    };
    expect(d.captures.find((x) => x.id === lights[12]?.id)?.grade).toBe('flagged');
    expect(d.captures.find((x) => x.id === lights[1]?.id)?.grade).toBe('ok');
  });

  it('Gespeicherter Modus „verwerfen“ (vor AP-77) wird ignoriert: nichts verworfen, Grenzwerte bleiben', async () => {
    const w = await setup();
    const { sessionId, nightPlanId } = await night(w);
    await s.pg.admin.query(
      `UPDATE rig SET overhead = jsonb_set(coalesce(overhead, '{}'::jsonb), '{imageQuality}',
        '{"mode":"reject","hfrPct":40,"starsPct":50,"rmsArcsec":1.5,"cloudPct":50}'::jsonb) WHERE id = $1`,
      [w.rigId],
    );
    const bad = light(w, nightPlanId, 20, { ...good, cloudCoverPct: 80 });
    await w.call(`/sessions/${sessionId}/captures`, {
      method: 'POST',
      body: { captures: [bad] },
    });
    const [row] = (
      await s.pg.admin.query('SELECT rejected, reject_reason FROM capture WHERE id = $1', [bad.id])
    ).rows as { rejected: boolean; reject_reason: string | null }[];
    expect(row).toEqual({ rejected: false, reject_reason: null });
    const v = await quality(w);
    expect(v.settings).toEqual({ hfrPct: 40, starsPct: 50, rmsArcsec: 1.5, cloudPct: 50 });
    expect(v.total).toMatchObject({ flagged: 3, reasons: { cloud: 1 } });
  });

  it('Startseite „Heute“ (AP-73): letzte Aufnahme des Rigs mit Bewertung, Abweichungen je Instanz; älter als 36 h → null', async () => {
    const w = await setup();
    const { sessionId, lights } = await night(w);
    s.clock.set(new Date('2026-09-19T12:00:00Z'));
    const rig = async () => {
      const r = await w.web(`/tonight?rigId=${w.rigId}`);
      expect(r.status).toBe(200);
      return (r.body.rigs as Body[])[0] as {
        lastCapture: Body | null;
        live: Body | null;
        instances: { mismatchCodes: string[]; profileSiteMismatch: boolean }[];
      };
    };
    const now = await rig();
    // Letztes Light: Nr. 13 mit Guiding-RMS 2″ (> 1,5″) → markiert.
    expect(now.lastCapture).toMatchObject({
      captureId: lights[13]?.id,
      sessionId,
      projectId: w.pid,
      projectName: 'NGC 281',
      filter: 'Ha',
      exposureS: 300,
      hfr: 1.6,
      stars: 800,
      grade: 'flagged',
      flags: [{ metric: 'rms', value: 2, limit: 1.5 }],
    });
    expect(now.instances).toEqual([
      expect.objectContaining({ mismatchCodes: [], profileSiteMismatch: false }),
    ]);
    expect(now.live).toBeNull();
    s.clock.set(new Date('2026-09-21T02:00:00Z'));
    expect((await rig()).lastCapture).toBeNull();
  });

  it('fremder Mandant: 404', async () => {
    const w = await setup();
    await night(w);
    const other = await s.seed.tenant('beta');
    const identity = await s.seed.identity({ mfaEnabled: true });
    const admin = await s.seed.member(identity.id, other, 'admin');
    await s.seed.owner(other, admin);
    const cookies = { [COOKIE_NAMES.session]: await s.seed.session(identity.id, other, 'tenant') };
    expect((await s.request(`/api/web/v1/projects/${w.pid}/quality`, { cookies })).status).toBe(
      404,
    );
    expect(
      (await s.request(`/api/web/v1/projects/${w.pid}/quality/files`, { cookies })).status,
    ).toBe(404);
  });
});
