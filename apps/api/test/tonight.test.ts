/**
 * AP-35 (FA-FOL-06, FA-FOL-05, NT-01; PGlite): `GET /tonight` liefert je Rig die aktuelle Nacht des Standorts
 * (Starfront, America/Chicago) – am 18.09.2026 um 09:00, 16:00 und 20:00 MESZ die Nächte 17./18., 18./19. und
 * 18./19.09. – mit Nachtfenster, Dunkelheit, Mond und geplanten Projekten aus der Prognose. Eine Zeile „nur für
 * die kommende Nacht“ aus fehlt in Plan und NINA-Zielen dieser Nacht und plant ab der nächsten wieder mit.
 */
import { JobQueue } from '@nina-pm/db';
import { COOKIE_NAMES } from '@nina-pm/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { forecastJobHandler } from '../src/worker/forecast';
import { runJob, type JobRunnerDeps } from '../src/worker/jobs';
import { forecastDbDeps } from '../src/worker/multi-sim-db';
import { CAMERA, filterInput, rigInput, SCHEDULER, SITE, TELESCOPE } from './support/equipment';
import { createStack, type Stack } from './support/stack';

let s: Stack;
beforeAll(async () => {
  s = await createStack();
});
beforeEach(async () => {
  await s.reset();
  s.clock.set(new Date('2026-09-18T18:00:00Z'));
});
afterAll(() => s.close());

type Body = Record<string, unknown>;
interface Rig {
  rigId: string;
  night: string;
  currentNight: string;
  calendar: {
    night: string;
    darkHours: number;
    moonlessDarkHours: number;
    moonIllumPct: number;
    waxing: boolean;
  }[];
  darkHours: number;
  nightWindow: { startUtc: string; endUtc: string } | null;
  moon: { illumPct: number };
  forecast: { covered: boolean };
  projects: {
    projectId: string;
    frames: number;
    lines: { lineId: string; frames: number; disabledTonight: boolean }[];
  }[];
  instances: { name: string }[];
}
const id = () => crypto.randomUUID();

async function setup() {
  const tenantId = await s.seed.tenant('alpha');
  const ownerIdentity = await s.seed.identity({ mfaEnabled: true });
  const owner = await s.seed.member(ownerIdentity.id, tenantId, 'admin');
  await s.seed.owner(tenantId, owner);
  const cookies = {
    [COOKIE_NAMES.session]: await s.seed.session(ownerIdentity.id, tenantId, 'tenant'),
  };
  const web = async (path: string, o: { method?: string; body?: unknown } = {}) => {
    const res = await s.request(`/api/web/v1${path}`, {
      ...(o.method ? { method: o.method } : {}),
      ...(o.body !== undefined ? { body: o.body } : {}),
      cookies,
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as Body };
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
  const lineId = id();
  await web(`/projects/${pid}/lines`, {
    method: 'POST',
    body: {
      id: lineId,
      panelId,
      filterId: ha.id,
      exposureS: 300,
      plannedCount: 30,
      moonMode: 'none',
    },
  });
  // Zweite Zeile: das Projekt bleibt auslieferbar, wenn die erste nur heute aus ist.
  await web(`/projects/${pid}/lines`, {
    method: 'POST',
    body: {
      id: id(),
      panelId,
      filterId: ha.id,
      exposureS: 600,
      plannedCount: 10,
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
  const jobs: JobRunnerDeps = {
    queue: () => Promise.resolve(new JobQueue(s.pg.db)),
    handlers: { forecast: forecastJobHandler(forecastDbDeps(() => Promise.resolve(s.pg.db))) },
    now: () => s.clock.now(),
  };
  const forecast = async () => {
    const run = await web('/forecast/run', { method: 'POST', body: { rigId: rig.id } });
    expect(await runJob(jobs, run.body.jobId as string)).toBe('done');
  };
  const tonight = async () => {
    const r = await web(`/tonight?rigId=${rig.id}`);
    expect(r.status).toBe(200);
    return (r.body.rigs as Rig[])[0] as Rig;
  };
  const targetLine = async () => {
    const r = await s.request('/api/nina/v1/targets', {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = (await r.json()) as {
      projects: { panels: { lines: { id: string; enabled: boolean }[] }[] }[];
    };
    return body.projects
      .flatMap((p) => p.panels.flatMap((x) => x.lines))
      .find((l) => l.id === lineId);
  };
  return { web, rig, pid, lineId, forecast, tonight, targetLine };
}

describe('Heute Nacht (S-02, AP-35)', () => {
  it('NT-01: 09:00/16:00/20:00 MESZ am 18.09. → 17./18., 18./19., 18./19.09.; Fenster, Dunkelheit, Mond', async () => {
    const t = await setup();
    const at = async (iso: string) => {
      s.clock.set(new Date(iso));
      return t.tonight();
    };
    expect((await at('2026-09-18T07:00:00Z')).night).toBe('2026-09-17');
    expect((await at('2026-09-18T14:00:00Z')).night).toBe('2026-09-18');
    const r = await at('2026-09-18T18:00:00Z');
    expect(r.night).toBe('2026-09-18');
    // Nachtfenster 19:00–08:00 CDT = 00:00–13:00 UTC (night.md §3).
    expect(r.nightWindow).toEqual({
      startUtc: '2026-09-19T00:00:00Z',
      endUtc: '2026-09-19T13:00:00Z',
    });
    expect(r.darkHours).toBeGreaterThan(8);
    expect(r.moon.illumPct).toBeGreaterThan(0);
    expect(r.instances.map((i) => i.name)).toEqual(['PC']);
    expect(r.forecast.covered).toBe(false);
  });

  it('Morgen nach dem Fensterende: läuft die Session der alten Nacht noch (Flats, Transit), bleibt sie die laufende', async () => {
    // Analyse 07.10.2026: um 08:00 CDT sprang „Heute Nacht“ zur nächsten Nacht und verbarg laufende Flats.
    const t = await setup();
    s.clock.set(new Date('2026-09-18T13:30:00Z'));
    expect((await t.tonight()).night).toBe('2026-09-18');
    const tenant = await s.pg.admin.query('SELECT tenant_id FROM rig WHERE id = $1', [t.rig.id]);
    const tenantId = (tenant.rows[0] as { tenant_id: string }).tenant_id;
    await s.pg.admin.query(
      "INSERT INTO session (tenant_id, rig_id, night, started_at, status) VALUES ($1, $2, '2026-09-17', '2026-09-18T00:30:00Z', 'running')",
      [tenantId, t.rig.id],
    );
    const lingering = await t.tonight();
    expect(lingering).toMatchObject({ night: '2026-09-17', currentNight: '2026-09-17' });
    // Session beendet bzw. Mittag erreicht: wieder die folgende Nacht.
    await s.pg.admin.query("UPDATE session SET status = 'completed' WHERE rig_id = $1", [t.rig.id]);
    expect((await t.tonight()).night).toBe('2026-09-18');
  });

  it('Nachtwahl (30.09.2026): laufende Nacht bis +6 mit Mondkalender; außerhalb 422', async () => {
    const t = await setup();
    s.clock.set(new Date('2026-09-18T18:00:00Z'));
    const now = await t.tonight();
    expect(now.currentNight).toBe('2026-09-18');
    expect(now.calendar.map((c) => c.night)).toEqual([
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
    ]);
    for (const c of now.calendar) {
      expect(c.darkHours).toBeGreaterThan(8);
      expect(c.moonlessDarkHours).toBeGreaterThanOrEqual(0);
      expect(c.moonlessDarkHours).toBeLessThanOrEqual(c.darkHours);
    }
    // Mond am 18.09.2026 zunehmend (Neumond 11.09.), Beleuchtung steigt über die Woche.
    expect(now.calendar[0]?.waxing).toBe(true);
    expect(now.calendar[6]?.moonIllumPct).toBeGreaterThan(now.calendar[0]?.moonIllumPct ?? 100);

    const later = await t.web(`/tonight?rigId=${t.rig.id}&night=2026-09-21`);
    expect(later.status).toBe(200);
    const rig = (later.body.rigs as Rig[])[0] as Rig;
    expect(rig).toMatchObject({ night: '2026-09-21', currentNight: '2026-09-18' });
    // Nachtfenster der gewählten Nacht: Abend des 21.09. in Starfront (um 19:00 CDT).
    expect(rig.nightWindow?.startUtc.slice(0, 13)).toMatch(/^2026-09-2(1T23|2T00)$/);
    expect((await t.web(`/tonight?rigId=${t.rig.id}&night=2026-09-25`)).status).toBe(422);
    expect((await t.web(`/tonight?rigId=${t.rig.id}&night=2026-09-17`)).status).toBe(422);
  });

  it('FA-FOL-05: Zeile nur heute aus – fehlt in Plan und Zielen dieser Nacht, ab der nächsten wieder aktiv', async () => {
    const t = await setup();
    await t.forecast();
    const before = await t.tonight();
    expect(before.forecast.covered).toBe(true);
    expect(before.projects[0]?.projectId).toBe(t.pid);
    expect(before.projects[0]?.frames).toBeGreaterThan(0);
    expect((await t.targetLine())?.enabled).toBe(true);

    const off = await t.web(`/projects/${t.pid}/lines/${t.lineId}/tonight`, {
      method: 'PUT',
      body: { disabled: true },
    });
    expect(off.status).toBe(200);
    const line = (
      off.body.panels as { lines: { id: string; disabledForNight: string }[] }[]
    )[0]?.lines.find((l) => l.id === t.lineId);
    expect(line?.disabledForNight).toBe('2026-09-18');
    expect((await t.targetLine())?.enabled).toBe(false);
    await t.forecast();
    const after = await t.tonight();
    const planned = after.projects[0]?.lines.find((l) => l.lineId === t.lineId);
    expect(planned).toMatchObject({ frames: 0, disabledTonight: true });

    // Nächster Tag nach dem Nachtfenster: neue Nacht, die Zeile plant wieder mit – ohne Zurücksetzen.
    s.clock.set(new Date('2026-09-19T14:00:00Z'));
    expect((await t.tonight()).night).toBe('2026-09-19');
    expect((await t.targetLine())?.enabled).toBe(true);

    // Wieder einschalten setzt die Spalte zurück.
    s.clock.set(new Date('2026-09-18T18:00:00Z'));
    const on = await t.web(`/projects/${t.pid}/lines/${t.lineId}/tonight`, {
      method: 'PUT',
      body: { disabled: false },
    });
    expect(
      (
        on.body.panels as { lines: { id: string; disabledForNight: string | null }[] }[]
      )[0]?.lines.find((l) => l.id === t.lineId)?.disabledForNight,
    ).toBeNull();
    expect((await t.targetLine())?.enabled).toBe(true);
  });

  it('nur freigegebene Projekte mit Rig; unbekannte Zeile → 404', async () => {
    const t = await setup();
    const draft = await t.web('/projects', { method: 'POST', body: { id: id(), name: 'Entwurf' } });
    const r = await t.web(`/projects/${draft.body.id as string}/lines/${t.lineId}/tonight`, {
      method: 'PUT',
      body: { disabled: true },
    });
    expect([r.status, r.body.code]).toEqual([422, 'validation.failed']);
    const missing = await t.web(`/projects/${t.pid}/lines/${id()}/tonight`, {
      method: 'PUT',
      body: { disabled: true },
    });
    expect(missing.status).toBe(404);
  });
});
