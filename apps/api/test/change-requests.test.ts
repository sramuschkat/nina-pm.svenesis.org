/**
 * AP-32b (FA-FRG-08, FA-FRG-04/14/15; PGlite): Änderungsanträge – stellen (nur freigegebene Projekte),
 * Warteschlange mit Gegenüberstellung, Stimmen und Rang, **Konflikt bei geänderter Version** (Antrag
 * `If-Match` → 412, Entscheidung gegen veraltete Projektversion → 409 `change_request.conflict`), Annahme
 * übernimmt nur die beantragten Felder, Zurückziehen nur durch den Antragsteller, Auswirkungsvorschau.
 */
import { JobQueue } from '@nina-pm/db';
import { COOKIE_NAMES } from '@nina-pm/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runJob } from '../src/worker/jobs';
import { impactJobHandler } from '../src/worker/multi-sim';
import { multiSimDbDeps } from '../src/worker/multi-sim-db';
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
    o: {
      method?: string;
      body?: unknown;
      as?: 'owner' | 'user';
      headers?: Record<string, string>;
    } = {},
  ) => {
    const res = await s.request(`/api/web/v1${path}`, {
      ...(o.method ? { method: o.method } : {}),
      ...(o.body !== undefined ? { body: o.body } : {}),
      ...(o.headers ? { headers: o.headers } : {}),
      cookies: cookies[o.as ?? 'owner'],
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
  const oiii = await eq.createFilter(id(), filterInput('OIII'), now);
  const rig = await eq.createRig(id(), rigInput(site.id, telescope.id, camera.id), now);
  await eq.updateScheduler(rig.id, SCHEDULER, now);
  await eq.putFilterWheel(
    rig.id,
    {
      slots: [
        { position: 1, filterId: ha.id, ninaFilterName: 'Ha 3nm' },
        { position: 1, filterId: oiii.id, ninaFilterName: 'OIII 3nm' },
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
    as: 'user',
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
    as: 'user',
  });
  await s.pg.admin.query(
    "UPDATE project SET approval_status = 'approved', status = 'active', rig_id = requested_rig_id WHERE id = $1",
    [pid],
  );
  const project = async () => (await web(`/projects/${pid}`)).body;
  return { tenantId, owner, user, web, rig, pid, panelId, lineId, oiii, project };
}

const proposal = (lineId: string, panelId: string, filterId: string, newLineId: string) => ({
  lines: [{ lineId, plannedCount: 50 }],
  newLines: [
    { id: newLineId, panelId, filterId, exposureS: 300, plannedCount: 20, moonMode: 'none' },
  ],
  conditions: { minAltitudeDeg: 40 },
});

describe('Änderungsanträge (FA-FRG-08)', () => {
  it('stellen, Warteschlange, Konflikt bei geänderter Version, Annahme nur der beantragten Felder', async () => {
    const t = await setup();
    const newLineId = id();
    const create = await t.web(`/projects/${t.pid}/change-requests`, {
      method: 'POST',
      body: {
        proposal: proposal(t.lineId, t.panelId, t.oiii.id, newLineId),
        comment: 'mehr Ha, dazu OIII',
      },
      as: 'user',
    });
    expect(create.status).toBe(201);
    const cr = create.body;
    const crId = cr.id as string;
    expect(cr).toMatchObject({
      status: 'open',
      version: 1,
      projectChangedSince: false,
      comment: 'mehr Ha, dazu OIII',
    });
    expect((cr.diff as Body[]).map((d) => [d.field, d.current, d.proposed])).toEqual([
      ['conditions.minAltitudeDeg', 30, 40],
      ['line.plannedCount', 30, 50],
      ['newLine', null, { plannedCount: 20, exposureS: 300, enabled: true }],
    ]);
    // Die freigegebene Fassung bleibt aktiv.
    expect(((await t.project()).conditions as Body).minAltitudeDeg).toBe(30);

    // Warteschlange: Eintrag „change-request“ mit Plan „mit Antrag“ und Gegenüberstellung.
    const queue = (await t.web('/queue', { as: 'user' })).body.items as Body[];
    const item = queue.find((q) => q.id === crId) as Body;
    expect(item).toMatchObject({
      kind: 'change-request',
      projectId: t.pid,
      version: 1,
      submitterRank: { rank: 1, of: 1 },
    });
    expect((item.planSummary as Body[]).map((c) => [c.filterShortName, c.count])).toEqual([
      ['Ha', 50],
      ['OIII', 20],
    ]);
    expect((item.changeRequest as Body).diff).toHaveLength(3);
    // Admin benachrichtigt.
    const [note] = (
      await s.pg.admin.query(
        "SELECT count(*)::int AS n FROM notification WHERE kind = 'change_request.new'",
      )
    ).rows as { n: number }[];
    expect(note?.n).toBeGreaterThan(0);

    // Stimmen: Admin ja, eigener Antrag nein.
    expect((await t.web(`/queue/change-request/${crId}/vote`, { method: 'PUT' })).body.count).toBe(
      1,
    );
    const own = await t.web(`/queue/change-request/${crId}/vote`, { method: 'PUT', as: 'user' });
    expect([own.status, own.body.code]).toEqual([409, 'vote.own_object']);

    // Rangfolge des Einreichers muss den Antrag enthalten.
    const partial = await t.web('/me/submission-ranking', {
      method: 'PUT',
      body: { items: [] },
      as: 'user',
    });
    expect([partial.status, partial.body.code]).toEqual([422, 'ranking.incomplete']);
    expect(
      (
        await t.web('/me/submission-ranking', {
          method: 'PUT',
          body: { items: [{ kind: 'change-request', id: crId }] },
          as: 'user',
        })
      ).status,
    ).toBe(204);

    // Antrag bearbeiten: veraltete Version → 412, aktuelle → 200.
    const newProposal = {
      ...proposal(t.lineId, t.panelId, t.oiii.id, newLineId),
      lines: [{ lineId: t.lineId, plannedCount: 60 }],
    };
    const stale = await t.web(`/change-requests/${crId}`, {
      method: 'PATCH',
      body: { proposal: newProposal, comment: 'mehr Ha' },
      headers: { 'if-match': '"0"' },
      as: 'user',
    });
    expect([stale.status, stale.body.code]).toEqual([412, 'resource.version_conflict']);
    s.clock.set(new Date('2026-09-18T15:00:00Z'));
    const edited = await t.web(`/change-requests/${crId}`, {
      method: 'PATCH',
      body: { proposal: newProposal, comment: 'mehr Ha' },
      headers: { 'if-match': '"1"' },
      as: 'user',
    });
    expect(edited.body).toMatchObject({ version: 2 });
    // Stimme: „geändert seit deiner Stimme“.
    const q2 = (await t.web('/queue')).body.items as Body[];
    expect(((q2.find((q) => q.id === crId) as Body).votes as Body).mineChangedSince).toBe(true);

    // Admin ändert das Projekt inzwischen (Beschreibung) → Entscheidung gegen alte Fassung: 409.
    const before = await t.project();
    const seen = before.version as number;
    const patch = await t.web(`/projects/${t.pid}`, {
      method: 'PATCH',
      body: { descriptionMd: 'vom Admin' },
      headers: { 'if-match': `"${String(seen)}"` },
    });
    expect(patch.status).toBe(200);
    const conflict = await t.web(`/change-requests/${crId}/decide`, {
      method: 'POST',
      body: { decision: 'approved', comment: null, projectVersion: seen },
      headers: { 'if-match': '"2"' },
    });
    expect([conflict.status, conflict.body.code]).toEqual([409, 'change_request.conflict']);
    const fresh = await t.web(`/change-requests/${crId}`);
    expect(fresh.body).toMatchObject({ projectChangedSince: true, status: 'open' });
    const decide = await t.web(`/change-requests/${crId}/decide`, {
      method: 'POST',
      body: { decision: 'approved', comment: null, projectVersion: fresh.body.projectVersion },
      headers: { 'if-match': '"2"' },
    });
    expect(decide.status).toBe(200);
    expect(decide.body).toMatchObject({ status: 'approved', decidedByName: expect.any(String) });

    // Übernommen: nur die beantragten Felder – die Admin-Beschreibung bleibt.
    const after = await t.project();
    expect(after.descriptionMd).toBe('vom Admin');
    expect((after.conditions as Body).minAltitudeDeg).toBe(40);
    const lines = (after.panels as { lines: Body[] }[])[0]?.lines ?? [];
    expect(lines.map((l) => [l.filterShortName, l.plannedCount])).toEqual([
      ['Ha', 60],
      ['OIII', 20],
    ]);
    // Nicht mehr offen: kein zweites Entscheiden, raus aus der Warteschlange.
    const again = await t.web(`/change-requests/${crId}/decide`, {
      method: 'POST',
      body: { decision: 'rejected', comment: 'x', projectVersion: after.version },
    });
    expect([again.status, again.body.code]).toEqual([409, 'change_request.not_open']);
    expect(((await t.web('/queue')).body.items as Body[]).some((q) => q.id === crId)).toBe(false);
    const decided = (
      await s.pg.admin.query(
        "SELECT count(*)::int AS n FROM notification WHERE kind = 'change_request.decided'",
      )
    ).rows as { n: number }[];
    expect(decided[0]?.n).toBe(1);
  });

  it('nur freigegebene Projekte; zurückziehen nur der Antragsteller; Ablehnen mit Kommentar', async () => {
    const t = await setup();
    const lines = { lines: [{ lineId: t.lineId, plannedCount: 40 }] };
    // Fremder User: 403; unbekannte Zeile: 422.
    const bad = await t.web(`/projects/${t.pid}/change-requests`, {
      method: 'POST',
      body: { proposal: { lines: [{ lineId: id(), plannedCount: 1 }] }, comment: null },
      as: 'user',
    });
    expect(bad.status).toBe(422);
    const cr = (
      await t.web(`/projects/${t.pid}/change-requests`, {
        method: 'POST',
        body: { proposal: lines, comment: null },
        as: 'user',
      })
    ).body;
    const crId = cr.id as string;
    expect((await t.web(`/change-requests/${crId}/withdraw`, { method: 'POST' })).status).toBe(403);
    const noComment = await t.web(`/change-requests/${crId}/decide`, {
      method: 'POST',
      body: { decision: 'rejected', comment: null, projectVersion: 1 },
    });
    expect(noComment.status).toBe(422);
    const withdrawn = await t.web(`/change-requests/${crId}/withdraw`, {
      method: 'POST',
      as: 'user',
    });
    expect(withdrawn.body).toMatchObject({ status: 'withdrawn' });
    const list = (await t.web(`/projects/${t.pid}/change-requests`, { as: 'user' })).body
      .items as Body[];
    expect(list.map((x) => x.status)).toEqual(['withdrawn']);

    // Nicht freigegeben: Admin 409, User (eigener Entwurf) 403.
    await s.pg.admin.query(
      "UPDATE project SET approval_status = 'draft', status = NULL, rig_id = NULL WHERE id = $1",
      [t.pid],
    );
    const draft = await t.web(`/projects/${t.pid}/change-requests`, {
      method: 'POST',
      body: { proposal: lines, comment: null },
    });
    expect([draft.status, draft.body.code]).toEqual([409, 'approval.not_allowed']);
    expect(
      (
        await t.web(`/projects/${t.pid}/change-requests`, {
          method: 'POST',
          body: { proposal: lines, comment: null },
          as: 'user',
        })
      ).status,
    ).toBe(403);
  });

  it('Auswirkungsvorschau eines Antrags: Projekt mit Antrag gegen aktuelle Fassung', async () => {
    const t = await setup();
    const cr = (
      await t.web(`/projects/${t.pid}/change-requests`, {
        method: 'POST',
        body: { proposal: { lines: [{ lineId: t.lineId, plannedCount: 90 }] }, comment: null },
        as: 'user',
      })
    ).body;
    const res = await t.web(`/queue/change-request/${cr.id as string}/impact`, { method: 'POST' });
    expect(res.status).toBe(202);
    const deps = multiSimDbDeps(() => Promise.resolve(s.pg.db), s.jobResults.put);
    const outcome = await runJob(
      {
        queue: () => Promise.resolve(new JobQueue(s.pg.db)),
        handlers: { impact: impactJobHandler(deps) },
        now: () => s.clock.now(),
      },
      res.body.jobId as string,
    );
    expect(outcome).toBe('done');
    const r = await t.web(`/jobs/${res.body.jobId as string}/result`);
    expect(r.body).toMatchObject({ kind: 'impact', queueItemId: cr.id, projectId: t.pid });
    expect((r.body.target as Body).needFrames).toBe(90);
  });
});
