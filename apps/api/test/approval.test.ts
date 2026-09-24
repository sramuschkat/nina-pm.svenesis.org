/**
 * Freigabe-Workflow (AP-12a): Einreichen mit Pflichtprüfung und Rang, Zurückziehen, Freigeben mit Rig
 * und Position, Zurückgeben/Ablehnen mit Pflichtkommentar, eigene Objekte (FA-FRG-10), Stimmen (eigene
 * → 409 vote.own_object, nach Entscheidung → 409 vote.closed, paralleles Abstimmen/Entscheiden
 * konsistent), „geändert seit deiner Stimme“, Rangfolge, Warteschlange, Entwürfe, If-Match, Verfall.
 */
import { COOKIE_NAMES, isDeliverable } from '@nina-pm/shared';
import { expireSubmissions } from '@nina-pm/db';
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
  version?: number;
  approvalStatus?: string;
  status?: string | null;
  items?: Record<string, unknown>[];
  errors?: { path: string; message: string }[];
};
type Who = 'owner' | 'admin2' | 'user' | 'user2';

async function setup() {
  const tenantId = await s.seed.tenant('alpha');
  const members: Record<Who, string> = {} as Record<Who, string>;
  const cookies: Record<Who, Record<string, string>> = {} as Record<Who, Record<string, string>>;
  for (const [who, role, mfa] of [
    ['owner', 'admin', true],
    ['admin2', 'admin', true],
    ['user', 'user', false],
    ['user2', 'user', false],
  ] as const) {
    const identity = await s.seed.identity({ mfaEnabled: mfa });
    members[who] = await s.seed.member(identity.id, tenantId, role);
    cookies[who] = {
      [COOKIE_NAMES.session]: await s.seed.session(identity.id, tenantId, 'tenant'),
    };
  }
  await s.seed.owner(tenantId, members.owner);
  const call = async (
    path: string,
    o: { method?: string; body?: unknown; as?: Who; headers?: Record<string, string> } = {},
  ) => {
    const res = await s.request(`${API}${path}`, {
      ...(o.method ? { method: o.method } : {}),
      ...(o.body !== undefined ? { body: o.body } : {}),
      ...(o.headers ? { headers: o.headers } : {}),
      cookies: cookies[o.as ?? 'owner'],
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as Body };
  };
  const eq = s.services.repositories({ tenantId, memberId: members.owner }).equipment();
  const now = s.clock.now();
  const site = await eq.createSite(id(), SITE, now);
  const telescope = await eq.createTelescope(id(), TELESCOPE, now);
  const camera = await eq.createCamera(id(), CAMERA, now);
  const ha = await eq.createFilter(id(), filterInput('Ha'), now);
  const rig = await eq.createRig(id(), rigInput(site.id, telescope.id, camera.id), now);
  return { tenantId, members, call, rig, ha };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

/** Projekt mit Koordinaten und einer Zeile – vollständig für die Einreichung. */
async function project(t: Ctx, as: Who = 'user', withLine = true) {
  const res = await t.call('/projects', {
    method: 'POST',
    as,
    body: { id: id(), name: 'NGC 281', rigId: t.rig.id, raDeg: 13.2, decDeg: 56.6 },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const p = res.body as Body & { id: string; panels: { id: string }[] };
  if (withLine) {
    const line = await t.call(`/projects/${p.id}/lines`, {
      method: 'POST',
      as,
      body: {
        id: id(),
        panelId: p.panels[0]?.id,
        filterId: t.ha.id,
        exposureS: 300,
        plannedCount: 40,
        moonMode: 'none',
      },
    });
    expect(line.status, JSON.stringify(line.body)).toBe(201);
  }
  return p.id;
}

const submit = (t: Ctx, pid: string, as: Who = 'user', body: unknown = {}) =>
  t.call(`/projects/${pid}/submit`, { method: 'POST', as, body });
const approveBody = (t: Ctx, extra: Record<string, unknown> = {}) => ({
  rigId: t.rig.id,
  status: 'active',
  ...extra,
});
const queue = async (t: Ctx, as: Who = 'owner') =>
  (await t.call('/queue', { as })).body.items as (Record<string, unknown> & {
    id: string;
    votes: { count: number; mine: boolean; mineChangedSince: boolean; voters: unknown[] };
    submitterRank: { rank: number; of: number } | null;
  })[];

describe('Einreichen und Zurückziehen (FA-FRG-02/03/15)', () => {
  it('Pflichtprüfung, Rang am Ende, Admins werden benachrichtigt; Zurückziehen rückt nach', async () => {
    const t = await setup();
    const empty = await project(t, 'user', false);
    const incomplete = await submit(t, empty);
    expect([incomplete.status, incomplete.body.code]).toEqual([422, 'approval.incomplete']);
    expect(incomplete.body.errors?.map((e) => e.path)).toContain('lines');

    const a = await project(t);
    const b = await project(t);
    expect((await submit(t, a, 'user', { requestComment: 'Gern bald' })).body.approvalStatus).toBe(
      'submitted',
    );
    expect((await submit(t, b)).status).toBe(200);
    expect((await queue(t)).map((q) => [q.id, q.submitterRank])).toEqual([
      [a, { rank: 1, of: 2 }],
      [b, { rank: 2, of: 2 }],
    ]);
    const bell = await t.call('/notifications', { as: 'admin2' });
    expect((bell.body.items ?? []).map((n) => n.kind)).toContain('submission.new');

    // Eingereicht ist für den User nicht mehr bearbeitbar (FA-FRG-02).
    expect(
      (await t.call(`/projects/${a}`, { method: 'PATCH', as: 'user', body: { name: 'X' } })).status,
    ).toBe(403);
    const w = await t.call(`/projects/${a}/withdraw`, { method: 'POST', as: 'user' });
    expect(w.body.approvalStatus).toBe('draft');
    expect((await queue(t)).map((q) => q.submitterRank)).toEqual([{ rank: 1, of: 1 }]);
    // Fremde User dürfen nicht einreichen/zurückziehen.
    expect((await t.call(`/projects/${b}/withdraw`, { method: 'POST', as: 'user2' })).status).toBe(
      403,
    );
  });

  it('If-Match: veraltete Version → 412', async () => {
    const t = await setup();
    const pid = await project(t);
    const r = await t.call(`/projects/${pid}/submit`, {
      method: 'POST',
      as: 'user',
      body: {},
      headers: { 'if-match': '"1"' },
    });
    expect([r.status, r.body.code]).toEqual([412, 'resource.version_conflict']);
  });
});

describe('Stimmen (FA-FRG-14)', () => {
  it('eigene Stimme → 409 vote.own_object; Stimme nach Entscheidung → 409 vote.closed; Endstand im Verlauf', async () => {
    const t = await setup();
    const pid = await project(t);
    await submit(t, pid);
    const own = await t.call(`/queue/project/${pid}/vote`, { method: 'PUT', as: 'user' });
    expect([own.status, own.body.code]).toEqual([409, 'vote.own_object']);
    const v = await t.call(`/queue/project/${pid}/vote`, { method: 'PUT', as: 'user2' });
    expect(v.body).toMatchObject({ count: 1, mine: true });
    expect(
      (await t.call(`/queue/project/${pid}/vote`, { method: 'PUT', as: 'admin2' })).body,
    ).toMatchObject({ count: 2 });
    expect((await queue(t, 'user')).find((q) => q.id === pid)?.votes).toMatchObject({
      count: 2,
      mine: false,
    });

    const ok = await t.call(`/projects/${pid}/approve`, { method: 'POST', body: approveBody(t) });
    expect([ok.status, ok.body.approvalStatus, ok.body.status]).toEqual([
      200,
      'approved',
      'active',
    ]);
    const closed = await t.call(`/queue/project/${pid}/vote`, { method: 'DELETE', as: 'user2' });
    expect([closed.status, closed.body.code]).toEqual([409, 'vote.closed']);
    const history = await t.call(`/projects/${pid}/history`);
    const approved = (history.body.items ?? []).find(
      (h) => h.kind === 'approval' && h.action === 'approved',
    );
    expect((approved?.detail as { votes: { count: number } }).votes.count).toBe(2);
    expect((await queue(t)).length).toBe(0);
  });

  it('paralleles Abstimmen und Entscheiden bleibt konsistent (guard)', async () => {
    const t = await setup();
    const pid = await project(t);
    await submit(t, pid);
    const [vote, decision] = await Promise.all([
      t.call(`/queue/project/${pid}/vote`, { method: 'PUT', as: 'user2' }),
      t.call(`/projects/${pid}/approve`, { method: 'POST', body: approveBody(t) }),
    ]);
    expect(decision.status).toBe(200);
    const history = await t.call(`/projects/${pid}/history`);
    const count = (
      (history.body.items ?? []).find((h) => h.action === 'approved')?.detail as {
        votes: { count: number };
      }
    ).votes.count;
    // Entweder kam die Stimme vor der Freigabe (zählt im Endstand) oder sie wurde abgewiesen.
    if (vote.status === 200) expect(count).toBe(1);
    else expect([vote.status, vote.body.code, count]).toEqual([409, 'vote.closed', 0]);
  });

  it('Admin-Änderung und erneute Einreichung: „geändert seit deiner Stimme“, Quittieren, Benachrichtigungen', async () => {
    const t = await setup();
    const pid = await project(t);
    await submit(t, pid);
    await t.call(`/queue/project/${pid}/vote`, { method: 'PUT', as: 'user2' });
    expect((await queue(t, 'user2'))[0]?.votes.mineChangedSince).toBe(false);
    s.clock.advance(60_000);
    const edit = await t.call(`/projects/${pid}`, {
      method: 'PATCH',
      as: 'admin2',
      body: { conditions: { minAltitudeDeg: 35 } },
    });
    expect(edit.status).toBe(200);
    expect((await queue(t, 'user2'))[0]?.votes.mineChangedSince).toBe(true);
    const kinds = async (who: Who) =>
      ((await t.call('/notifications', { as: who })).body.items ?? []).map((n) => n.kind);
    expect(await kinds('user')).toContain('submission.edited_by_admin');
    expect(await kinds('user2')).toContain('vote.subject_changed');
    expect(
      (await t.call(`/queue/project/${pid}/vote/acknowledge`, { method: 'POST', as: 'user2' }))
        .status,
    ).toBe(204);
    expect((await queue(t, 'user2'))[0]?.votes.mineChangedSince).toBe(false);

    // Zurückgeben: Stimmen ruhen; erneute Einreichung → „überarbeitet“ für Stimmende.
    const ret = await t.call(`/projects/${pid}/return`, {
      method: 'POST',
      body: { comment: 'Bitte mehr OIII' },
    });
    expect(ret.body.approvalStatus).toBe('returned');
    s.clock.advance(60_000);
    await submit(t, pid);
    expect(await kinds('user2')).toContain('vote.subject_resubmitted');
    expect((await queue(t, 'user2'))[0]?.votes).toMatchObject({ count: 1, mineChangedSince: true });
  });
});

describe('Entscheiden (FA-FRG-06/07/10)', () => {
  it('Zurückgeben/Ablehnen verlangen einen Kommentar; Ablehnen ist endgültig', async () => {
    const t = await setup();
    const pid = await project(t);
    await submit(t, pid);
    expect(
      (await t.call(`/projects/${pid}/reject`, { method: 'POST', body: { comment: '' } })).status,
    ).toBe(422);
    const r = await t.call(`/projects/${pid}/reject`, {
      method: 'POST',
      body: { comment: 'Außerhalb der Saison' },
    });
    expect(r.body.approvalStatus).toBe('rejected');
    // Abgelehnt ist endgültig: der User darf nicht mehr einreichen, ein Admin bekommt 409.
    expect((await submit(t, pid)).status).toBe(403);
    const byAdmin = await submit(t, pid, 'owner');
    expect([byAdmin.status, byAdmin.body.code]).toEqual([409, 'approval.not_allowed']);
    expect(
      (await t.call('/notifications', { as: 'user' })).body.items?.map((n) => n.kind),
    ).toContain('approval.rejected');
    // User entscheidet nicht.
    const pid2 = await project(t);
    await submit(t, pid2);
    expect(
      (
        await t.call(`/projects/${pid2}/approve`, {
          method: 'POST',
          as: 'user2',
          body: approveBody(t),
        })
      ).status,
    ).toBe(403);
  });

  it('Freigabe: Position je Rig, Startdatum, isDeliverable erst danach', async () => {
    const t = await setup();
    const first = await project(t);
    const second = await project(t);
    await submit(t, first);
    await submit(t, second);
    await t.call(`/projects/${first}/approve`, { method: 'POST', body: approveBody(t) });
    const b = await t.call(`/projects/${second}/approve`, {
      method: 'POST',
      body: approveBody(t, { priorityPosition: 1, startDate: '2026-10-01', status: 'planning' }),
    });
    expect(b.body).toMatchObject({ priority: 1, startDate: '2026-10-01', status: 'planning' });
    const a = await t.call(`/projects/${first}`);
    expect(a.body.priority).toBe(2);
  });

  it('eigene Objekte: mit „Admin-Objekte ohne Warteschlange“ direkt freigeben, sonst 409 approval.own_object', async () => {
    const t = await setup();
    const own = await project(t, 'owner');
    const direct = await t.call(`/projects/${own}/approve`, {
      method: 'POST',
      body: approveBody(t),
    });
    expect([direct.status, direct.body.approvalStatus]).toEqual([200, 'approved']);

    await t.call('/tenant/settings', {
      method: 'PATCH',
      body: { settings: { adminSelfApproval: false } },
    });
    const own2 = await project(t, 'owner');
    await submit(t, own2, 'owner');
    const denied = await t.call(`/projects/${own2}/approve`, {
      method: 'POST',
      body: approveBody(t),
    });
    expect([denied.status, denied.body.code]).toEqual([409, 'approval.own_object']);
    const byOther = await t.call(`/projects/${own2}/approve`, {
      method: 'POST',
      as: 'admin2',
      body: approveBody(t),
    });
    expect(byOther.status).toBe(200);
  });
});

describe('Rangfolge, Warteschlange, Entwürfe', () => {
  it('Rangfolge nur vollständig (422 ranking.incomplete), danach neue Reihenfolge', async () => {
    const t = await setup();
    const a = await project(t);
    const b = await project(t);
    await submit(t, a);
    await submit(t, b);
    const partial = await t.call('/me/submission-ranking', {
      method: 'PUT',
      as: 'user',
      body: { items: [{ kind: 'project', id: b }] },
    });
    expect([partial.status, partial.body.code]).toEqual([422, 'ranking.incomplete']);
    const full = await t.call('/me/submission-ranking', {
      method: 'PUT',
      as: 'user',
      body: {
        items: [
          { kind: 'project', id: b },
          { kind: 'project', id: a },
        ],
      },
    });
    expect(full.status).toBe(204);
    const q = await queue(t);
    expect(q.find((x) => x.id === b)?.submitterRank).toEqual({ rank: 1, of: 2 });
  });

  it('Warteschlange für alle mit Plan-Chips und Stunden; Entwürfe nur für Admins', async () => {
    const t = await setup();
    const pid = await project(t);
    await submit(t, pid);
    const [item] = await queue(t, 'user2');
    expect(item).toMatchObject({
      id: pid,
      kind: 'project',
      panelCount: 1,
      estimatedHours: (40 * 300) / 3600,
      effort: null,
      suggestedPriorityPosition: null,
      planSummary: [{ filterShortName: 'Ha', count: 40, exposureS: 300 }],
    });
    expect(typeof item?.submittedAt).toBe('string');
    const draft = await project(t, 'user2');
    expect((await t.call('/drafts', { as: 'user' })).status).toBe(403);
    const drafts = await t.call('/drafts');
    expect(drafts.body.items?.map((d) => d.id)).toEqual([draft]);
  });
});

describe('Verfall nach approvalDeadlineDays (Entscheidung 24.09.2026)', () => {
  it('überfällige Einreichung → Zurückgegeben, Ereignis expired, Benachrichtigung; Stimmen ruhen', async () => {
    const t = await setup();
    await t.call('/tenant/settings', {
      method: 'PATCH',
      body: { settings: { approvalDeadlineDays: 2 } },
    });
    const pid = await project(t);
    await submit(t, pid);
    await t.call(`/queue/project/${pid}/vote`, { method: 'PUT', as: 'user2' });
    const [queued] = await queue(t);
    expect(queued?.expiresAt).toBe(
      new Date(s.clock.now().getTime() + 2 * 86_400_000).toISOString(),
    );
    expect(await expireSubmissions(s.pg.db, new Date(s.clock.now().getTime() + 86_400_000))).toBe(
      0,
    );
    expect(
      await expireSubmissions(s.pg.db, new Date(s.clock.now().getTime() + 3 * 86_400_000)),
    ).toBe(1);
    const p = await t.call(`/projects/${pid}`);
    expect(p.body.approvalStatus).toBe('returned');
    const history = await t.call(`/projects/${pid}/history`);
    expect((history.body.items ?? []).map((h) => h.action)).toContain('expired');
    expect(
      (await t.call('/notifications', { as: 'user' })).body.items?.map((n) => n.kind),
    ).toContain('approval.expired');
    // Nach erneuter Einreichung zählt die ruhende Stimme wieder.
    await submit(t, pid);
    expect((await queue(t))[0]?.votes.count).toBe(1);
  });

  it('isDeliverable erst nach Freigabe (TK 6.3)', () => {
    const base = {
      status: 'active',
      deletedAt: null,
      ninaDeliveryEnabled: true,
      bonusEnabled: false,
      startDate: null,
      projectType: 'deep_sky' as const,
      lines: [
        {
          enabled: true,
          plannedCount: 10,
          acquiredCount: 0,
          rejectedCount: 0,
          bonusCount: 0,
          bonusRejectedCount: 0,
        },
      ],
      overshootPct: 0,
    };
    for (const approvalStatus of ['draft', 'submitted', 'returned', 'rejected'])
      expect(isDeliverable({ ...base, approvalStatus }, '2026-09-24')).toBe(false);
    expect(isDeliverable({ ...base, approvalStatus: 'approved' }, '2026-09-24')).toBe(true);
  });
});
