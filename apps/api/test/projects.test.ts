/**
 * Projekte (AP-11a): Rechte (User nur eigene Entwürfe/zurückgegebene), Zähler (FK 8.4), Papierkorb,
 * weiches/endgültiges Löschen von Panels und Zeilen, Zeilensperre mit Aufnahmen und Duplizieren,
 * Status mit Vollständigkeit und automatischer Rückkehr, Priorität, Vorlage, Favoriten, Notizen,
 * Verlauf, Rig-Wechsel-Prüfung, If-Match.
 */
import { COOKIE_NAMES } from '@nina-pm/shared';
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
type Body = Record<string, unknown> & {
  code?: string;
  errors?: { path: string; message: string }[];
  panels?: {
    id: string;
    lines: { id: string; enabled: boolean; counters: Record<string, number> }[];
  }[];
};

async function setup() {
  const tenantId = await s.seed.tenant('alpha');
  const ownerIdentity = await s.seed.identity({ mfaEnabled: true });
  const owner = await s.seed.member(ownerIdentity.id, tenantId, 'admin');
  await s.seed.owner(tenantId, owner);
  const userIdentity = await s.seed.identity();
  const user = await s.seed.member(userIdentity.id, tenantId, 'user');
  const user2Identity = await s.seed.identity();
  await s.seed.member(user2Identity.id, tenantId, 'user');
  const cookies = {
    admin: { [COOKIE_NAMES.session]: await s.seed.session(ownerIdentity.id, tenantId, 'tenant') },
    user: { [COOKIE_NAMES.session]: await s.seed.session(userIdentity.id, tenantId, 'tenant') },
    user2: { [COOKIE_NAMES.session]: await s.seed.session(user2Identity.id, tenantId, 'tenant') },
  };
  const call = async (
    path: string,
    o: {
      method?: string;
      body?: unknown;
      as?: keyof typeof cookies;
      headers?: Record<string, string>;
    } = {},
  ) => {
    const res = await s.request(`${API}${path}`, {
      ...(o.method ? { method: o.method } : {}),
      ...(o.body !== undefined ? { body: o.body } : {}),
      ...(o.headers ? { headers: o.headers } : {}),
      cookies: cookies[o.as ?? 'admin'],
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
  await s.pg.admin.query('UPDATE rig SET overshoot_pct = 10 WHERE id = $1', [rig.id]);
  return { tenantId, owner, user, call, eq, rig, ha, camera, site, telescope };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

async function project(
  t: Ctx,
  as: 'admin' | 'user' = 'admin',
  extra: Record<string, unknown> = {},
) {
  const res = await t.call('/projects', {
    method: 'POST',
    as,
    body: {
      id: id(),
      name: 'NGC 281',
      rigId: t.rig.id,
      targetName: 'NGC 281',
      raDeg: 13.2458,
      decDeg: 56.6194,
      ...extra,
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Body & { id: string; panels: NonNullable<Body['panels']> };
}

async function addLine(
  t: Ctx,
  projectId: string,
  panelId: string,
  extra: Record<string, unknown> = {},
) {
  const lineId = id();
  const res = await t.call(`/projects/${projectId}/lines`, {
    method: 'POST',
    body: {
      id: lineId,
      panelId,
      filterId: t.ha.id,
      exposureS: 300,
      plannedCount: 60,
      moonMode: 'none',
      ...extra,
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return lineId;
}

const approve = (projectId: string, status = 'active') =>
  s.pg.admin.query(
    "UPDATE project SET approval_status = 'approved', status = $2, rig_id = requested_rig_id WHERE id = $1",
    [projectId, status],
  );

describe('Rechte (FA-PRJ-18, FK 6.14)', () => {
  it('User bearbeitet eigene Entwürfe und zurückgegebene, nicht freigegebene oder fremde', async () => {
    const t = await setup();
    const draft = await t.call('/projects', {
      method: 'POST',
      as: 'user',
      body: { id: id(), name: 'Skizze' },
    });
    expect([draft.status, draft.body.approvalStatus, draft.body.panels]).toEqual([
      201,
      'draft',
      [],
    ]);
    const pid = draft.body.id as string;
    // Koordinaten nachtragen legt das Panel „Main“ an.
    const coords = await t.call(`/projects/${pid}`, {
      method: 'PATCH',
      as: 'user',
      body: { raDeg: 10.68, decDeg: 41.27 },
    });
    expect([coords.status, coords.body.panels?.length]).toEqual([200, 1]);
    expect((await t.call(`/projects/${pid}`, { as: 'user2' })).status).toBe(403);
    expect(
      (await t.call(`/projects/${pid}`, { method: 'PATCH', as: 'user2', body: { name: 'x' } }))
        .status,
    ).toBe(403);
    await s.pg.admin.query("UPDATE project SET approval_status = 'returned' WHERE id = $1", [pid]);
    expect(
      (
        await t.call(`/projects/${pid}`, {
          method: 'PATCH',
          as: 'user',
          body: { name: 'Überarbeitet' },
        })
      ).status,
    ).toBe(200);
    await approve(pid);
    const locked = await t.call(`/projects/${pid}`, {
      method: 'PATCH',
      as: 'user',
      body: { name: 'y' },
    });
    expect([locked.status, locked.body.code]).toEqual([403, 'permission.denied']);
    // Freigegeben: für andere User sichtbar, Admin darf ändern.
    expect((await t.call(`/projects/${pid}`, { as: 'user2' })).status).toBe(200);
    expect(
      (await t.call(`/projects/${pid}`, { method: 'PATCH', body: { name: 'Admin' } })).status,
    ).toBe(200);
    const list = await t.call('/projects', { as: 'user2' });
    expect((list.body.items as { id: string }[]).map((p) => p.id)).toContain(pid);
  });

  it('If-Match mit veralteter Version → 412', async () => {
    const t = await setup();
    const p = await project(t);
    const ok = await t.call(`/projects/${p.id}`, {
      method: 'PATCH',
      body: { name: 'A' },
      headers: { 'if-match': `"${String(p.version)}"` },
    });
    expect(ok.status).toBe(200);
    const stale = await t.call(`/projects/${p.id}`, {
      method: 'PATCH',
      body: { name: 'B' },
      headers: { 'if-match': `"${String(p.version)}"` },
    });
    expect([stale.status, stale.body.code]).toEqual([412, 'resource.version_conflict']);
  });
});

describe('Teiländerungen', () => {
  it('ein Patch ändert nur die genannten Felder (Bedingungen, Panel, Zeile)', async () => {
    const t = await setup();
    const p = await project(t, 'admin', {
      conditions: { twilight: 'nautical', minAltitudeDeg: 25 },
    });
    const panel = p.panels[0]?.id as string;
    const lineId = await addLine(t, p.id, panel, { gain: 100, readoutMode: 'Default' });
    const cond = await t.call(`/projects/${p.id}`, {
      method: 'PATCH',
      body: { conditions: { minAltitudeDeg: 40 } },
    });
    expect(cond.body.conditions).toMatchObject({ minAltitudeDeg: 40, twilight: 'nautical' });
    await t.call(`/projects/${p.id}/panels/${panel}`, {
      method: 'PATCH',
      body: { rotationDeg: 90 },
    });
    const label = await t.call(`/projects/${p.id}/panels/${panel}`, {
      method: 'PATCH',
      body: { label: 'Mitte' },
    });
    expect(label.body.panels?.[0]).toMatchObject({ label: 'Mitte', rotationDeg: 90 });
    const line = await t.call(`/projects/${p.id}/lines/${lineId}`, {
      method: 'PATCH',
      body: { plannedCount: 5 },
    });
    expect(line.body.panels?.[0]?.lines[0]).toMatchObject({
      gain: 100,
      readoutMode: 'Default',
      plannedCount: 5,
    });
  });
});

describe('Zähler (FK 8.4)', () => {
  it('Akzeptiert, Verbleibend, Planungsbedarf mit Überschuss 10 %, Integration aus capture_night', async () => {
    const t = await setup();
    const p = await project(t);
    const lineId = await addLine(t, p.id, p.panels[0]?.id as string);
    await s.pg.admin.query(
      'UPDATE exposure_line SET acquired_count = 22, rejected_count = 2, bonus_count = 3 WHERE id = $1',
      [lineId],
    );
    await s.pg.admin.query(
      "INSERT INTO capture_night (tenant_id, exposure_line_id, night, project_id, acquired_count, integration_s) VALUES ($1, $2, '2026-09-17', $3, 22, 6900)",
      [t.tenantId, lineId, p.id],
    );
    const res = await t.call(`/projects/${p.id}`);
    expect(res.body.panels?.[0]?.lines[0]?.counters).toMatchObject({
      planned: 60,
      accepted: 20,
      remaining: 40,
      planningNeed: 46,
      bonus: 3,
      integrationS: 6900,
    });
    expect(res.body.progress).toMatchObject({
      targetReached: false,
      finished: false,
      planningNeed: 46,
      plannedS: 18000,
      integrationS: 6900,
    });
  });
});

describe('Liste S-30 (FA-PRJ-14)', () => {
  it('liefert Ersteller, Panelzahl und Plan je Filter (nur aktive Zeilen)', async () => {
    const t = await setup();
    const p = await project(t, 'admin');
    const panel = p.panels[0]?.id as string;
    await addLine(t, p.id, panel, { plannedCount: 10 });
    await addLine(t, p.id, panel, { plannedCount: 5 });
    await addLine(t, p.id, panel, { plannedCount: 7, enabled: false });
    const list = await t.call('/projects');
    const item = (list.body.items as Record<string, unknown>[])[0];
    expect(item).toMatchObject({ id: p.id, panelCount: 1 });
    expect(typeof item?.createdByName).toBe('string');
    expect(item?.filters).toEqual([
      {
        filterId: t.ha.id,
        filterShortName: 'Ha',
        exposureS: expect.any(Number) as number,
        planned: 15,
        accepted: 0,
        lines: 2,
      },
    ]);
  });
});

describe('Papierkorb (FA-PRJ-15, E4)', () => {
  it('Löschen ist weich: aus Listen und Detail verschwunden; nur Admin sieht und stellt unverändert wieder her', async () => {
    const t = await setup();
    const p = await project(t);
    await approve(p.id, 'on_hold');
    expect((await t.call(`/projects/${p.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(((await t.call('/projects')).body.items as unknown[]).length).toBe(0);
    expect((await t.call(`/projects/${p.id}`)).status).toBe(404);
    const trash = await t.call('/projects?deleted=true');
    expect((trash.body.items as { id: string; deletedAt: string }[])[0]).toMatchObject({
      id: p.id,
    });
    expect((await t.call('/projects?deleted=true', { as: 'user' })).status).toBe(403);
    const denied = await t.call(`/projects/${p.id}/restore`, { method: 'POST', as: 'user' });
    expect([denied.status, denied.body.code]).toEqual([403, 'permission.denied']);
    const restored = await t.call(`/projects/${p.id}/restore`, { method: 'POST' });
    expect([
      restored.status,
      restored.body.approvalStatus,
      restored.body.status,
      restored.body.deletedAt,
    ]).toEqual([200, 'approved', 'on_hold', null]);
  });
});

describe('Panels und Zeilen löschen (FA-PRJ-06/07)', () => {
  it('mit Aufnahmen weich (ausgeblendet, Zeile bleibt in der DB), ohne Aufnahmen endgültig', async () => {
    const t = await setup();
    const p = await project(t);
    const panel = p.panels[0]?.id as string;
    const withCaptures = await addLine(t, p.id, panel);
    const without = await addLine(t, p.id, panel);
    await s.pg.admin.query('UPDATE exposure_line SET acquired_count = 1 WHERE id = $1', [
      withCaptures,
    ]);
    expect(
      (await t.call(`/projects/${p.id}/lines/${withCaptures}`, { method: 'DELETE' })).body,
    ).toEqual({ soft: true });
    expect((await t.call(`/projects/${p.id}/lines/${without}`, { method: 'DELETE' })).body).toEqual(
      { soft: false },
    );
    const rows = await s.pg.admin.query(
      'SELECT id, deleted_at FROM exposure_line WHERE project_id = $1',
      [p.id],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.deleted_at).not.toBeNull();
    expect((await t.call(`/projects/${p.id}`)).body.panels?.[0]?.lines).toEqual([]);

    const second = id();
    await t.call(`/projects/${p.id}/panels`, {
      method: 'POST',
      body: { id: second, raDeg: 13.9, decDeg: 56.6, label: 'P2' },
    });
    expect((await t.call(`/projects/${p.id}/panels/${second}`, { method: 'DELETE' })).body).toEqual(
      { soft: false },
    );
    expect((await t.call(`/projects/${p.id}/panels/${panel}`, { method: 'DELETE' })).body).toEqual({
      soft: true,
    });
    expect((await t.call(`/projects/${p.id}`)).body.panels).toEqual([]);
  });
});

describe('Zeilen mit Aufnahmen (NT-E3)', () => {
  it('Belichtungszeit → 409 line.locked_by_captures, geplant → 200; Duplizieren mit Zählern 0 und deaktivierter Quelle', async () => {
    const t = await setup();
    const p = await project(t);
    const panel = p.panels[0]?.id as string;
    const lineId = await addLine(t, p.id, panel);
    await s.pg.admin.query('UPDATE exposure_line SET acquired_count = 5 WHERE id = $1', [lineId]);
    const locked = await t.call(`/projects/${p.id}/lines/${lineId}`, {
      method: 'PATCH',
      body: { exposureS: 600 },
    });
    expect([locked.status, locked.body.code, locked.body.errors?.[0]?.path]).toEqual([
      409,
      'line.locked_by_captures',
      'exposureS',
    ]);
    // Unveränderter Wert ist keine Änderung.
    expect(
      (
        await t.call(`/projects/${p.id}/lines/${lineId}`, {
          method: 'PATCH',
          body: { exposureS: 300, plannedCount: 80 },
        })
      ).status,
    ).toBe(200);
    const copy = id();
    const dup = await t.call(`/projects/${p.id}/lines/${lineId}/duplicate`, {
      method: 'POST',
      body: { id: copy, deactivateSource: true },
    });
    expect(dup.status).toBe(201);
    const lines = dup.body.panels?.[0]?.lines ?? [];
    expect(lines.find((l) => l.id === lineId)).toMatchObject({ enabled: false });
    expect(lines.find((l) => l.id === copy)).toMatchObject({
      enabled: true,
      counters: { acquired: 0, planned: 80 },
    });
    expect(
      (
        await t.call(`/projects/${p.id}/lines/${copy}`, {
          method: 'PATCH',
          body: { exposureS: 600 },
        })
      ).status,
    ).toBe(200);
  });
});

describe('Status, Priorität, automatische Rückkehr (FA-PRJ-11/12/13)', () => {
  it('Aktivieren prüft die Vollständigkeit; ungültiger Übergang → 409; Entwurf hat keinen Status', async () => {
    const t = await setup();
    const p = await project(t);
    const draft = await t.call(`/projects/${p.id}/status`, {
      method: 'PUT',
      body: { status: 'active' },
    });
    expect([draft.status, draft.body.code]).toEqual([409, 'project.status_transition_invalid']);
    await approve(p.id, 'planning');
    const incomplete = await t.call(`/projects/${p.id}/status`, {
      method: 'PUT',
      body: { status: 'active' },
    });
    expect([incomplete.status, incomplete.body.code, incomplete.body.errors]).toEqual([
      422,
      'approval.incomplete',
      [{ path: 'lines', message: 'fehlt' }],
    ]);
    await addLine(t, p.id, p.panels[0]?.id as string);
    expect(
      (await t.call(`/projects/${p.id}/status`, { method: 'PUT', body: { status: 'active' } })).body
        .status,
    ).toBe('active');
    const bad = await t.call(`/projects/${p.id}/status`, {
      method: 'PUT',
      body: { status: 'completed' },
    });
    expect([bad.status, bad.body.code]).toEqual([409, 'project.status_transition_invalid']);
    expect(
      (
        await t.call(`/projects/${p.id}/status`, {
          method: 'PUT',
          body: { status: 'on_hold' },
          as: 'user',
        })
      ).status,
    ).toBe(403);
  });

  it('Bereit zur Bearbeitung → Aktiv, sobald der Planungsbedarf wieder über 0 steigt', async () => {
    const t = await setup();
    const p = await project(t);
    const lineId = await addLine(t, p.id, p.panels[0]?.id as string, { plannedCount: 10 });
    await s.pg.admin.query('UPDATE exposure_line SET acquired_count = 11 WHERE id = $1', [lineId]);
    await approve(p.id, 'ready_to_process');
    const res = await t.call(`/projects/${p.id}/lines/${lineId}`, {
      method: 'PATCH',
      body: { plannedCount: 20 },
    });
    expect([res.status, res.body.status]).toEqual([200, 'active']);
    const history = await t.call(`/projects/${p.id}/history`);
    expect(history.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'change',
          action: 'status',
          detail: { from: 'ready_to_process', to: 'active', automatic: true },
        }),
      ]),
    );
  });

  it('Priorität je Rig: das Projekt rückt an Position 1, die anderen rücken nach', async () => {
    const t = await setup();
    const a = await project(t);
    const b = await project(t);
    await approve(a.id);
    await approve(b.id);
    await s.pg.admin.query('UPDATE project SET priority = 1 WHERE id = $1', [a.id]);
    await s.pg.admin.query('UPDATE project SET priority = 2 WHERE id = $1', [b.id]);
    const res = await t.call(`/projects/${b.id}/priority`, {
      method: 'PUT',
      body: { position: 1 },
    });
    expect(res.body).toEqual({ order: [b.id, a.id] });
    expect((await t.call(`/projects/${a.id}`)).body.priority).toBe(2);
  });
});

describe('Vorlage, Duplizieren, Favoriten, Notizen', () => {
  it('Vorlage anwenden kopiert die Zeilen; mit Aufnahmen → 409', async () => {
    const t = await setup();
    const p = await project(t);
    const template = await t.eq.createTemplate(
      id(),
      {
        name: 'SHO',
        telescopeId: null,
        cameraId: null,
        notes: '',
        lines: [
          {
            filterId: t.ha.id,
            exposureS: 300,
            plannedCount: 30,
            gain: 100,
            offsetAdu: 50,
            binning: 1,
            readoutMode: null,
            moonMode: 'none',
            moonProfileId: null,
            enabled: true,
          },
        ],
      },
      s.clock.now(),
    );
    const applied = await t.call(`/projects/${p.id}/apply-template`, {
      method: 'POST',
      body: { templateId: template.id },
    });
    expect(applied.body.panels?.[0]?.lines).toHaveLength(1);
    await s.pg.admin.query('UPDATE exposure_line SET acquired_count = 1 WHERE project_id = $1', [
      p.id,
    ]);
    const blocked = await t.call(`/projects/${p.id}/apply-template`, {
      method: 'POST',
      body: { templateId: template.id },
    });
    expect([blocked.status, blocked.body.code]).toEqual([409, 'line.locked_by_captures']);
  });

  it('Duplizieren: neuer Entwurf des Aufrufers mit denselben Panels/Zeilen und Zählern 0', async () => {
    const t = await setup();
    const p = await project(t);
    const lineId = await addLine(t, p.id, p.panels[0]?.id as string);
    await s.pg.admin.query('UPDATE exposure_line SET acquired_count = 9 WHERE id = $1', [lineId]);
    await approve(p.id);
    const copyId = id();
    const copy = await t.call(`/projects/${p.id}/duplicate`, {
      method: 'POST',
      as: 'user',
      body: { id: copyId },
    });
    expect(copy.status).toBe(201);
    expect(copy.body).toMatchObject({
      id: copyId,
      name: 'NGC 281 (Kopie)',
      approvalStatus: 'draft',
      status: null,
      createdBy: t.user,
    });
    expect(copy.body.panels?.[0]?.lines[0]?.counters).toMatchObject({ acquired: 0, planned: 60 });
  });

  it('Favoriten, Notizen mit Autor, Verlauf', async () => {
    const t = await setup();
    const p = await project(t);
    expect((await t.call(`/me/favorites/${p.id}`, { method: 'PUT' })).status).toBe(204);
    expect((await t.call(`/projects/${p.id}`)).body.favorite).toBe(true);
    expect(((await t.call('/projects?favorites=true')).body.items as unknown[]).length).toBe(1);
    await t.call(`/me/favorites/${p.id}`, { method: 'DELETE' });
    expect((await t.call(`/projects/${p.id}`)).body.favorite).toBe(false);
    const note = await t.call(`/projects/${p.id}/notes`, {
      method: 'POST',
      body: { bodyMd: 'Framing **passt**.' },
    });
    expect(note.status).toBe(201);
    expect((await t.call(`/projects/${p.id}/notes`)).body.items).toEqual([
      expect.objectContaining({ bodyMd: 'Framing **passt**.', userId: t.owner }),
    ]);
    const history = await t.call(`/projects/${p.id}/history`);
    expect((history.body.items as { action: string }[]).map((h) => h.action)).toContain('create');
  });
});

describe('Rig-Wechsel (FA-RIG-12)', () => {
  it('Filter nicht im Filterrad des neuen Rigs → 409 approval.rig_conflict; bewusst übernommen → 200', async () => {
    const t = await setup();
    const p = await project(t);
    await addLine(t, p.id, p.panels[0]?.id as string);
    await approve(p.id);
    const other = await t.eq.createRig(
      id(),
      { ...rigInput(t.site.id, t.telescope.id, t.camera.id), name: 'Rig 2' },
      s.clock.now(),
    );
    const l = await t.eq.createFilter(id(), filterInput('L'), s.clock.now());
    await t.eq.putFilterWheel(
      other.id,
      { slots: [{ position: 1, filterId: l.id, ninaFilterName: 'L' }] },
      s.clock.now(),
    );
    const check = await t.call(`/rigs/${other.id}/compatibility`, {
      method: 'POST',
      body: { projectId: p.id },
    });
    expect(check.body).toMatchObject({
      conflicts: [expect.objectContaining({ code: 'filter_not_in_wheel', detail: 'Ha' })],
      hasCaptures: false,
    });
    const blocked = await t.call(`/projects/${p.id}`, {
      method: 'PATCH',
      body: { rigId: other.id },
    });
    expect([blocked.status, blocked.body.code]).toEqual([409, 'approval.rig_conflict']);
    const accepted = await t.call(`/projects/${p.id}`, {
      method: 'PATCH',
      body: { rigId: other.id, acceptRigConflicts: true },
    });
    expect([accepted.status, accepted.body.rigId]).toEqual([200, other.id]);
  });
});
