/**
 * AP-22 (FA-PRJ-06, FA-FRM-06/12; geometry.md §2, NT-30/32; PGlite): Mosaik aus der Sternkarte übernehmen –
 * Panelzentren und -winkel genau wie `mosaicPanels` der Engine aus dem Bildfeld des Projekt-Rigs, ohne
 * Rotator mit dem Kamerawinkel; bestehende Panels behalten Zeilen und Fortschritt, neue bekommen den Plan
 * von Panel 1, überzählige werden entfernt (mit Aufnahmen weich). Umsortieren, Panel aktiv/inaktiv
 * (Fortschritt und Planung ohne inaktive Panels).
 */
import { mosaicPanels } from '@nina-pm/engine';
import { COOKIE_NAMES, imageScale } from '@nina-pm/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CAMERA, filterInput, rigInput, SITE, TELESCOPE } from './support/equipment';
import { createStack, type Stack } from './support/stack';

let s: Stack;
beforeAll(async () => {
  s = await createStack();
});
beforeEach(() => s.reset());
afterAll(() => s.close());

const API = '/api/web/v1';
const id = () => crypto.randomUUID();

interface Panel {
  id: string;
  panelIndex: number;
  label: string;
  raDeg: number;
  decDeg: number;
  rotationDeg: number;
  enabled: boolean;
  lines: { id: string; plannedCount: number; counters: { acquired: number } }[];
}
interface View {
  version: number;
  raDeg: number;
  decDeg: number;
  rotationDeg: number;
  mosaic: { cols: number; rows: number; overlapPct: number };
  progress: { plannedS: number };
  panels: Panel[];
  code?: string;
}

async function setup(rigOver: Record<string, unknown> = {}) {
  const tenantId = await s.seed.tenant('alpha');
  const identity = await s.seed.identity({ mfaEnabled: true });
  const owner = await s.seed.member(identity.id, tenantId, 'admin');
  await s.seed.owner(tenantId, owner);
  const cookies = { [COOKIE_NAMES.session]: await s.seed.session(identity.id, tenantId, 'tenant') };
  const call = async (path: string, o: { method?: string; body?: unknown } = {}) => {
    const res = await s.request(`${API}${path}`, {
      ...(o.method ? { method: o.method } : {}),
      ...(o.body !== undefined ? { body: o.body } : {}),
      cookies,
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as View };
  };
  const eq = s.services.repositories({ tenantId, memberId: owner }).equipment();
  const now = s.clock.now();
  const site = await eq.createSite(id(), SITE, now);
  const telescope = await eq.createTelescope(id(), TELESCOPE, now);
  const camera = await eq.createCamera(id(), CAMERA, now);
  const ha = await eq.createFilter(id(), filterInput('Ha'), now);
  const rig = await eq.createRig(
    id(),
    { ...rigInput(site.id, telescope.id, camera.id), ...rigOver },
    now,
  );
  const fov = imageScale({ ...TELESCOPE, ...CAMERA });
  const projectId = id();
  await call('/projects', {
    method: 'POST',
    body: { id: projectId, name: 'Cygnus-Mosaik', rigId: rig.id, raDeg: 314.75, decDeg: 44.53 },
  });
  const first = (await call(`/projects/${projectId}`)).body.panels[0] as Panel;
  await call(`/projects/${projectId}/lines`, {
    method: 'POST',
    body: {
      id: id(),
      panelId: first.id,
      filterId: ha.id,
      exposureS: 300,
      plannedCount: 40,
      moonMode: 'none',
    },
  });
  return { call, projectId, fov, first, rig, cookies };
}

const mosaic = (over: Record<string, unknown> = {}) => ({
  raDeg: 314.75,
  decDeg: 44.53,
  rotationDeg: 0,
  cols: 2,
  rows: 2,
  overlapPct: 15,
  copyPlan: true,
  ...over,
});

describe('Mosaik übernehmen', () => {
  it('Panels wie mosaicPanels der Engine; Panel 1 behält Zeilen, neue bekommen den Plan', async () => {
    const { call, projectId, fov, first } = await setup({ hasRotator: true });
    const res = await call(`/projects/${projectId}/mosaic`, {
      method: 'POST',
      body: mosaic({ rotationDeg: 30 }),
    });
    expect(res.status).toBe(200);
    const expected = mosaicPanels({
      raDeg: 314.75,
      decDeg: 44.53,
      paDeg: 30,
      cols: 2,
      rows: 2,
      overlapPct: 15,
      fovWidthDeg: fov.fovWidthDeg,
      fovHeightDeg: fov.fovHeightDeg,
    }).sort((a, b) => a.n - b.n);
    const panels = res.body.panels;
    expect(panels.map((p) => p.label)).toEqual(['Panel 1', 'Panel 2', 'Panel 3', 'Panel 4']);
    panels.forEach((p, k) => {
      const e = expected[k];
      expect(p.raDeg).toBeCloseTo(e?.raDeg ?? NaN, 9);
      expect(p.decDeg).toBeCloseTo(e?.decDeg ?? NaN, 9);
      expect(p.rotationDeg).toBeCloseTo(e?.paDeg ?? NaN, 9);
    });
    expect(panels[0]?.id).toBe(first.id);
    for (const p of panels) expect(p.lines.map((l) => l.plannedCount)).toEqual([40]);
    expect(new Set(panels.flatMap((p) => p.lines.map((l) => l.id))).size).toBe(4);
    expect(res.body.mosaic).toEqual({ cols: 2, rows: 2, overlapPct: 15 });
    expect(res.body.rotationDeg).toBe(30);
    expect(res.body.progress.plannedS).toBe(4 * 40 * 300);
  });

  it('ohne Rotator: Raster mit dem Kamerawinkel des Rigs (NT-30)', async () => {
    const { call, projectId } = await setup({ hasRotator: false, defaultRotationDeg: 12 });
    const res = await call(`/projects/${projectId}/mosaic`, {
      method: 'POST',
      body: mosaic({ rotationDeg: 40, cols: 1, rows: 2 }),
    });
    expect(res.status).toBe(200);
    expect(res.body.rotationDeg).toBe(12);
    // Feldrotation γ nur aus dem Versatz – bei 1×2 liegt sie nahe beim Kamerawinkel.
    for (const p of res.body.panels) expect(Math.abs(p.rotationDeg - 12)).toBeLessThan(1);
  });

  it('kleiner werden: überzählige Panels ohne Aufnahmen endgültig, mit Aufnahmen weich', async () => {
    const { call, projectId } = await setup({ hasRotator: true });
    const four = (await call(`/projects/${projectId}/mosaic`, { method: 'POST', body: mosaic() }))
      .body;
    const third = four.panels[2] as Panel;
    await s.pg.admin.query('UPDATE exposure_line SET acquired_count = 3 WHERE id = $1', [
      third.lines[0]?.id,
    ]);
    const one = await call(`/projects/${projectId}/mosaic`, {
      method: 'POST',
      body: mosaic({ cols: 1, rows: 1 }),
    });
    expect(one.status).toBe(200);
    expect(one.body.panels).toHaveLength(1);
    expect(one.body.panels[0]?.label).toBe('Panel 1');
    const rows = await s.pg.admin.query(
      'SELECT id, deleted_at IS NOT NULL AS gone FROM project_panel WHERE project_id = $1 ORDER BY panel_index',
      [projectId],
    );
    // Panel 3 bleibt weich gelöscht (Aufnahmen), Panel 2 und 4 sind endgültig weg.
    expect(rows.rows).toEqual([
      { id: four.panels[0]?.id, gone: false },
      { id: third.id, gone: true },
    ]);
    // Wieder größer: neue Panels bekommen neue Indizes hinter dem weich gelöschten.
    const again = await call(`/projects/${projectId}/mosaic`, { method: 'POST', body: mosaic() });
    expect(again.status).toBe(200);
    expect(again.body.panels).toHaveLength(4);
  });

  it('If-Match: veraltete Version → 412', async () => {
    const { projectId, cookies } = await setup({ hasRotator: true });
    const res = await s.request(`${API}/projects/${projectId}/mosaic`, {
      method: 'POST',
      body: mosaic(),
      headers: { 'if-match': '"999"' },
      cookies,
    });
    expect(res.status).toBe(412);
  });

  it('ohne Rig → 422', async () => {
    const { call, projectId } = await setup({ hasRotator: true });
    await call(`/projects/${projectId}`, { method: 'PATCH', body: { rigId: null } });
    const res = await call(`/projects/${projectId}/mosaic`, { method: 'POST', body: mosaic() });
    expect(res.status).toBe(422);
  });
});

describe('Panels umsortieren und aktiv/inaktiv', () => {
  it('Reihenfolge = NINA-Nummer; unvollständige Liste → 422', async () => {
    const { call, projectId } = await setup({ hasRotator: true });
    const four = (await call(`/projects/${projectId}/mosaic`, { method: 'POST', body: mosaic() }))
      .body;
    const ids = four.panels.map((p) => p.id);
    const reversed = [...ids].reverse();
    const res = await call(`/projects/${projectId}/panels/order`, {
      method: 'PUT',
      body: { panelIds: reversed },
    });
    expect(res.status).toBe(200);
    expect(res.body.panels.map((p) => p.id)).toEqual(reversed);
    const bad = await call(`/projects/${projectId}/panels/order`, {
      method: 'PUT',
      body: { panelIds: ids.slice(1) },
    });
    expect(bad.status).toBe(422);
  });

  it('inaktives Panel: Soll ohne seine Zeilen, Zeilen bleiben erhalten', async () => {
    const { call, projectId } = await setup({ hasRotator: true });
    const four = (await call(`/projects/${projectId}/mosaic`, { method: 'POST', body: mosaic() }))
      .body;
    const second = four.panels[1] as Panel;
    const res = await call(`/projects/${projectId}/panels/${second.id}`, {
      method: 'PATCH',
      body: { enabled: false },
    });
    expect(res.status).toBe(200);
    expect(res.body.panels[1]?.enabled).toBe(false);
    expect(res.body.panels[1]?.lines).toHaveLength(1);
    expect(res.body.progress.plannedS).toBe(3 * 40 * 300);
  });
});
