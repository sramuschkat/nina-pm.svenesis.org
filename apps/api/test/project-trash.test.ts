/**
 * Papierkorb, Rangfolge und Idempotenz (FA-PRJ-06/08/15, FA-FRG-15, FA-PRJ-13; PGlite):
 * - Nach dem weichen Löschen von Panel 0 bleiben Projekt-Änderungen möglich (kein neues Panel 0 bei
 *   jedem PATCH; `UNIQUE (project_id, panel_index)` gilt auch für gelöschte Panels).
 * - Löschen eines Projekts zieht offene Änderungsanträge zurück und gibt Rang bzw. Priorität frei;
 *   Anträge zu gelöschten Projekten blockieren die Rangfolge nie (`422 ranking.incomplete`).
 * - Wiederherstellen reiht Rang und Priorität konsistent wieder ein.
 * - Idempotentes Anlegen/Duplizieren liefert nur das eigene, nicht gelöschte Projekt, sonst `409`.
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

async function setup() {
  const tenantId = await s.seed.tenant('alpha');
  const ownerIdentity = await s.seed.identity({ mfaEnabled: true });
  const owner = await s.seed.member(ownerIdentity.id, tenantId, 'admin');
  await s.seed.owner(tenantId, owner);
  const userIdentity = await s.seed.identity({ mfaEnabled: true });
  const user = await s.seed.member(userIdentity.id, tenantId, 'user');
  const cookies = {
    owner: { [COOKIE_NAMES.session]: await s.seed.session(ownerIdentity.id, tenantId, 'tenant') },
    user: { [COOKIE_NAMES.session]: await s.seed.session(userIdentity.id, tenantId, 'tenant') },
  };
  const web = async (
    path: string,
    o: { method?: string; body?: unknown; as?: 'owner' | 'user' } = {},
  ) => {
    const res = await s.request(`/api/web/v1${path}`, {
      ...(o.method ? { method: o.method } : {}),
      ...(o.body !== undefined ? { body: o.body } : {}),
      cookies: cookies[o.as ?? 'owner'],
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as Body };
  };
  const q = async <T>(text: string, params: unknown[] = []) =>
    (await s.pg.admin.query(text, params)).rows as T[];
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
  /** Vollständiges Projekt (Name, Rig, Koordinaten, Ziel, eine Zeile) des Mitglieds `as`. */
  const project = async (name: string, as: 'owner' | 'user' = 'user') => {
    const created = await web('/projects', {
      method: 'POST',
      body: { id: id(), name, rigId: rig.id, targetName: name, raDeg: 13.2, decDeg: 56.6 },
      as,
    });
    expect(created.status).toBe(201);
    const pid = created.body.id as string;
    const panelId = (created.body.panels as { id: string }[])[0]?.id as string;
    const lineId = id();
    const line = await web(`/projects/${pid}/lines`, {
      method: 'POST',
      body: {
        id: lineId,
        panelId,
        filterId: ha.id,
        exposureS: 300,
        plannedCount: 30,
        moonMode: 'none',
      },
      as,
    });
    expect(line.status).toBe(201);
    return { pid, panelId, lineId };
  };
  const submit = async (pid: string) => {
    const r = await web(`/projects/${pid}/submit`, {
      method: 'POST',
      body: { requestedRigId: rig.id },
      as: 'user',
    });
    expect(r.status).toBe(200);
  };
  const approve = (pid: string, priority: number) =>
    q(
      "UPDATE project SET approval_status = 'approved', status = 'active', rig_id = $2, priority = $3 WHERE id = $1",
      [pid, rig.id, priority],
    );
  return { tenantId, owner, user, web, q, rig, project, submit, approve };
}

type T = Awaited<ReturnType<typeof setup>>;
const ranks = async (t: T, ids: string[]) =>
  Object.fromEntries(
    (
      await t.q<{ id: string; submitter_rank: number | null }>(
        'SELECT id, submitter_rank FROM project WHERE id = ANY($1)',
        [ids],
      )
    ).map((r) => [r.id, r.submitter_rank]),
  );
const priorities = async (t: T, ids: string[]) =>
  (
    await t.q<{ id: string; priority: number }>(
      'SELECT id, priority FROM project WHERE id = ANY($1) AND deleted_at IS NULL ORDER BY priority',
      [ids],
    )
  ).map((r) => [r.id, r.priority]);

describe('Panel 0 weich gelöscht (FA-PRJ-06)', () => {
  it('PATCH bleibt möglich; neues Panel nur bei geänderten Koordinaten, mit freiem Index', async () => {
    const t = await setup();
    const p = await t.project('NGC 281', 'owner');
    // Aufnahmen auf der Zeile → Panel wird nur weich gelöscht.
    await t.q('UPDATE exposure_line SET acquired_count = 5 WHERE id = $1', [p.lineId]);
    const del = await t.web(`/projects/${p.pid}/panels/${p.panelId}`, { method: 'DELETE' });
    expect([del.status, del.body.soft]).toEqual([200, true]);

    const rename = await t.web(`/projects/${p.pid}`, {
      method: 'PATCH',
      body: { name: 'NGC 281b' },
    });
    expect(rename.status).toBe(200);
    expect(rename.body.panels).toEqual([]);
    // Zweites PATCH: früher 500 (Unique-Verletzung auf panel_index 0).
    const again = await t.web(`/projects/${p.pid}`, {
      method: 'PATCH',
      body: { descriptionMd: 'x' },
    });
    expect(again.status).toBe(200);

    const moved = await t.web(`/projects/${p.pid}`, { method: 'PATCH', body: { raDeg: 14 } });
    expect(moved.status).toBe(200);
    expect(moved.body.panels).toHaveLength(1);
    const panels = await t.q<{ panel_index: number; deleted: boolean; ra_deg: number }>(
      'SELECT panel_index, deleted_at IS NOT NULL AS deleted, ra_deg FROM project_panel WHERE project_id = $1 ORDER BY panel_index',
      [p.pid],
    );
    expect(panels).toEqual([
      { panel_index: 0, deleted: true, ra_deg: 13.2 },
      { panel_index: 1, deleted: false, ra_deg: 14 },
    ]);
  });
});

describe('Papierkorb und Rangfolge (FA-PRJ-15, FA-FRG-15)', () => {
  it('Löschen zieht offene Anträge zurück; Rangfolge bleibt vollständig setzbar', async () => {
    const t = await setup();
    const approved = await t.project('NGC 281');
    await t.approve(approved.pid, 1);
    const submitted = await t.project('IC 1805');
    const cr = await t.web(`/projects/${approved.pid}/change-requests`, {
      method: 'POST',
      body: { proposal: { lines: [{ lineId: approved.lineId, plannedCount: 40 }] }, comment: null },
      as: 'user',
    });
    expect(cr.status).toBe(201);
    const crId = cr.body.id as string;
    await t.submit(submitted.pid);
    expect(await ranks(t, [submitted.pid])).toEqual({ [submitted.pid]: 2 });

    expect((await t.web(`/projects/${approved.pid}`, { method: 'DELETE' })).status).toBe(204);
    const [row] = await t.q<{ status: string; submitter_rank: number | null; version: number }>(
      'SELECT status, submitter_rank, version FROM change_request WHERE id = $1',
      [crId],
    );
    expect(row).toEqual({ status: 'withdrawn', submitter_rank: null, version: 2 });
    // Der verbleibende Gegenstand rückt auf Rang 1 von 1.
    const queue = (await t.web('/queue', { as: 'user' })).body.items as Body[];
    expect(queue.map((i) => [i.id, i.submitterRank])).toEqual([
      [submitted.pid, { rank: 1, of: 1 }],
    ]);
    const set = await t.web('/me/submission-ranking', {
      method: 'PUT',
      body: { items: [{ kind: 'project', id: submitted.pid }] },
      as: 'user',
    });
    expect(set.status).toBe(204);
    const [log] = await t.q<{ diff: Body }>(
      "SELECT diff FROM change_log WHERE entity_id = $1 AND action = 'delete'",
      [approved.pid],
    );
    expect(log?.diff).toMatchObject({ changeRequestsWithdrawn: [crId] });
  });

  it('Altbestand: offener Antrag zu gelöschtem Projekt zählt in keiner Rangabfrage', async () => {
    const t = await setup();
    const approved = await t.project('NGC 281');
    await t.approve(approved.pid, 1);
    const cr = await t.web(`/projects/${approved.pid}/change-requests`, {
      method: 'POST',
      body: { proposal: { lines: [{ lineId: approved.lineId, plannedCount: 40 }] }, comment: null },
      as: 'user',
    });
    expect(cr.status).toBe(201);
    // Gelöscht ohne Aufräumen (Stand vor dem Fix): der Antrag bleibt `open`.
    await t.q('UPDATE project SET deleted_at = now() WHERE id = $1', [approved.pid]);
    const submitted = await t.project('IC 1805');
    await t.submit(submitted.pid);
    expect(await ranks(t, [submitted.pid])).toEqual({ [submitted.pid]: 1 });
    const queue = (await t.web('/queue', { as: 'user' })).body.items as Body[];
    expect(queue.map((i) => i.submitterRank)).toEqual([{ rank: 1, of: 1 }]);
    const set = await t.web('/me/submission-ranking', {
      method: 'PUT',
      body: { items: [{ kind: 'project', id: submitted.pid }] },
      as: 'user',
    });
    expect(set.status).toBe(204);
  });

  it('eingereicht: Rang frei beim Löschen, am Ende beim Wiederherstellen', async () => {
    const t = await setup();
    const a = await t.project('A');
    const b = await t.project('B');
    await t.submit(a.pid);
    await t.submit(b.pid);
    expect(await ranks(t, [a.pid, b.pid])).toEqual({ [a.pid]: 1, [b.pid]: 2 });
    expect((await t.web(`/projects/${a.pid}`, { method: 'DELETE' })).status).toBe(204);
    expect(await ranks(t, [a.pid, b.pid])).toEqual({ [a.pid]: null, [b.pid]: 1 });
    const restored = await t.web(`/projects/${a.pid}/restore`, { method: 'POST' });
    expect(restored.status).toBe(200);
    expect(restored.body.approvalStatus).toBe('submitted');
    expect(await ranks(t, [a.pid, b.pid])).toEqual({ [a.pid]: 2, [b.pid]: 1 });
    const queue = (await t.web('/queue', { as: 'user' })).body.items as Body[];
    expect(queue.map((i) => (i.submitterRank as { of: number }).of)).toEqual([2, 2]);
  });

  it('freigegeben: Priorität des Rigs ohne Lücke, Wiederherstellen an der alten Stelle', async () => {
    const t = await setup();
    const ids: string[] = [];
    for (const [i, name] of ['A', 'B', 'C'].entries()) {
      const p = await t.project(name, 'owner');
      await t.approve(p.pid, i + 1);
      ids.push(p.pid);
    }
    const [a, b, c] = ids as [string, string, string];
    expect((await t.web(`/projects/${b}`, { method: 'DELETE' })).status).toBe(204);
    expect(await priorities(t, ids)).toEqual([
      [a, 1],
      [c, 2],
    ]);
    expect((await t.web(`/projects/${b}/restore`, { method: 'POST' })).status).toBe(200);
    expect(await priorities(t, ids)).toEqual([
      [a, 1],
      [b, 2],
      [c, 3],
    ]);
  });
});

describe('Idempotente Anlage (rules/api.md)', () => {
  it('liefert nur das eigene, nicht gelöschte Projekt; sonst 409 resource.in_use', async () => {
    const t = await setup();
    const pid = id();
    const body = { id: pid, name: 'Geheim', descriptionMd: 'vertraulich' };
    expect((await t.web('/projects', { method: 'POST', body })).status).toBe(201);
    // Wiederholung durch den Ersteller: dasselbe Projekt.
    const again = await t.web('/projects', { method: 'POST', body });
    expect([again.status, again.body.id, again.body.name]).toEqual([201, pid, 'Geheim']);
    // Ein anderes Mitglied mit derselben ID: 409 ohne Inhalte.
    const foreign = await t.web('/projects', {
      method: 'POST',
      body: { id: pid, name: 'mein' },
      as: 'user',
    });
    expect([foreign.status, foreign.body.code]).toEqual([409, 'resource.in_use']);
    expect(JSON.stringify(foreign.body)).not.toContain('vertraulich');
    // Duplizieren auf eine fremde ID ebenso.
    const own = await t.web('/projects', {
      method: 'POST',
      body: { id: id(), name: 'Eigenes' },
      as: 'user',
    });
    const dup = await t.web(`/projects/${own.body.id as string}/duplicate`, {
      method: 'POST',
      body: { id: pid },
      as: 'user',
    });
    expect([dup.status, dup.body.code]).toEqual([409, 'resource.in_use']);
    // Gelöscht: auch der Ersteller erhält 409 statt eines Projekts im Papierkorb.
    expect((await t.web(`/projects/${pid}`, { method: 'DELETE' })).status).toBe(204);
    const deleted = await t.web('/projects', { method: 'POST', body });
    expect([deleted.status, deleted.body.code]).toEqual([409, 'resource.in_use']);
  });
});
