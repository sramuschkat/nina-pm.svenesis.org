/**
 * Bildbewertung (AP-72b; PGlite): Ansicht „Bilder“ des Projekts mit Bezug und Bewertung, „Behalten“, mehrere verwerfen
 * und zurücknehmen (Zähler „Akzeptiert“ sinkt und steigt wieder), Bewertung im Session-Detail, relativer Bildpfad und
 * automatisches Verwerfen beim Eingang, wenn das Rig auf „verwerfen“ steht.
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
  return { tenantId, siteId: site.id, rigId: rig.id, pid, panelId, lineId, web, call };
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

interface Image {
  id: string;
  grade: string;
  flags: { metric: string }[];
  rejected: boolean;
  rejectReason: string | null;
  kept: boolean;
  relativePath: string | null;
  hfrArcsec: number | null;
}
const images = async (w: World) => {
  const r = await w.web(`/projects/${w.pid}/images`);
  expect(r.status).toBe(200);
  return r.body as { items: Image[]; refs: Body[]; settings: Body; canCorrect: boolean };
};
const accepted = async (w: World) => {
  const p = await w.web(`/projects/${w.pid}`);
  const line = (
    p.body.panels as { lines: { id: string; counters: { accepted: number } }[] }[]
  )[0]?.lines.find((l) => l.id === w.lineId);
  return line?.counters.accepted;
};

describe('Bildbewertung (AP-72b)', () => {
  it('Bilder des Projekts: Bezug, markiert (HFR, RMS), relativer Pfad, HFR in ″', async () => {
    const w = await setup();
    const { lights } = await night(w);
    const v = await images(w);
    expect(v.settings).toMatchObject({
      mode: 'mark',
      hfrPct: 30,
      starsPct: 50,
      rmsArcsec: 1.5,
      cloudPct: 50,
    });
    expect(v.refs).toEqual([
      expect.objectContaining({ filter: 'Ha', hfr: 1.6, stars: 800, n: 14 }),
    ]);
    expect(v.canCorrect).toBe(true);
    const flagged = v.items.filter((x) => x.grade === 'flagged');
    expect(flagged.map((x) => x.flags.map((f) => f.metric).join()).sort()).toEqual(['hfr', 'rms']);
    const first = v.items.find((x) => x.id === lights[0]?.id);
    expect(first?.relativePath).toBe('2026-09-18/NGC 281/LIGHT/ngc281_0.fits');
    expect(first?.hfrArcsec).toBeGreaterThan(0);
  });

  it('Behalten: nicht wieder markiert; zurücknehmen markiert wieder', async () => {
    const w = await setup();
    const { lights } = await night(w);
    const bad = lights[12]?.id as string;
    expect(
      (await w.web(`/captures/${bad}/quality`, { method: 'PATCH', body: { kept: true } })).status,
    ).toBe(200);
    expect((await images(w)).items.find((x) => x.id === bad)).toMatchObject({
      grade: 'kept',
      kept: true,
    });
    await w.web(`/captures/${bad}/quality`, { method: 'PATCH', body: { kept: false } });
    expect((await images(w)).items.find((x) => x.id === bad)?.grade).toBe('flagged');
  });

  it('Markierte verwerfen: Grund auto_quality, Akzeptiert sinkt; zurücknehmen stellt den Zähler wieder her', async () => {
    const w = await setup();
    const { lights } = await night(w);
    const before = await accepted(w);
    const ids = [lights[12]?.id, lights[13]?.id] as string[];
    const r = await w.web(`/projects/${w.pid}/images/reject`, {
      method: 'POST',
      body: { captureIds: [...ids, id()], rejected: true },
    });
    expect(r.body).toMatchObject({ changed: 2, skipped: 1 });
    expect(await accepted(w)).toBe((before as number) - 2);
    const v = await images(w);
    expect(v.items.filter((x) => x.grade === 'rejected').map((x) => x.rejectReason)).toEqual([
      'auto_quality',
      'auto_quality',
    ]);
    await w.web(`/projects/${w.pid}/images/reject`, {
      method: 'POST',
      body: { captureIds: ids, rejected: false },
    });
    expect(await accepted(w)).toBe(before);
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

  it('Rig auf „verwerfen“: neue Lights über einem Grenzwert werden beim Eingang verworfen', async () => {
    const w = await setup();
    const { sessionId, nightPlanId } = await night(w);
    const put = await w.web(`/rigs/${w.rigId}/scheduler-settings`, {
      method: 'PUT',
      body: {
        ...SCHEDULER,
        imageQuality: { mode: 'reject', hfrPct: 30, starsPct: 50, rmsArcsec: 1.5, cloudPct: 50 },
      },
    });
    expect(put.status).toBe(200);
    expect((put.body.scheduler as Body).imageQuality).toMatchObject({ mode: 'reject' });
    const bad = light(w, nightPlanId, 20, { ...good, cloudCoverPct: 80 });
    const fine = light(w, nightPlanId, 21, good);
    await w.call(`/sessions/${sessionId}/captures`, {
      method: 'POST',
      body: { captures: [bad, fine] },
    });
    const v = await images(w);
    expect(v.items.find((x) => x.id === bad.id)).toMatchObject({
      rejected: true,
      rejectReason: 'auto_quality',
    });
    expect(v.items.find((x) => x.id === fine.id)?.rejected).toBe(false);
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
    expect((await s.request(`/api/web/v1/projects/${w.pid}/images`, { cookies })).status).toBe(404);
  });
});
