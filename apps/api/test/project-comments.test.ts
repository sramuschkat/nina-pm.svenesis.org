/**
 * Kommentare am Projekt (FA-PRJ-17, Ausbau der Notizen 04.10.2026): jeder, der das Projekt sieht,
 * kommentiert und reagiert; Antworten eine Ebene tief; Bearbeiten nur der Verfasser in der ersten Stunde;
 * weiches Löschen nur Admin/Owner; Benachrichtigung an Ersteller und bisherige Verfasser; Anzahl in Liste,
 * Warteschlange und Entwürfen.
 */
import { COOKIE_NAMES } from '@nina-pm/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { filterInput, rigInput, SITE, CAMERA, TELESCOPE } from './support/equipment';
import { createStack, type Stack } from './support/stack';

let s: Stack;
beforeAll(async () => {
  s = await createStack();
});
beforeEach(() => s.reset());
afterAll(() => s.close());

const API = '/api/web/v1';
const id = () => crypto.randomUUID();
type Who = 'owner' | 'admin2' | 'user' | 'user2';
interface Note {
  id: string;
  userId: string;
  bodyMd: string;
  parentId: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  reactions: { emoji: string; count: number; mine: boolean }[];
}
type Body = Record<string, unknown> & { code?: string; items?: Record<string, unknown>[] };

async function setup() {
  const tenantId = await s.seed.tenant('alpha');
  const members = {} as Record<Who, string>;
  const cookies = {} as Record<Who, Record<string, string>>;
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
  const call = async (path: string, o: { method?: string; body?: unknown; as?: Who } = {}) => {
    const res = await s.request(`${API}${path}`, {
      ...(o.method ? { method: o.method } : {}),
      ...(o.body !== undefined ? { body: o.body } : {}),
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
  // Projekt des Users mit Zeile, eingereicht – für alle Mitglieder sichtbar (FA-BER-02).
  const created = await call('/projects', {
    method: 'POST',
    as: 'user',
    body: { id: id(), name: 'NGC 281', rigId: rig.id, raDeg: 13.2, decDeg: 56.6 },
  });
  const pid = created.body.id as string;
  await call(`/projects/${pid}/lines`, {
    method: 'POST',
    as: 'user',
    body: {
      id: id(),
      panelId: (created.body.panels as { id: string }[])[0]?.id,
      filterId: ha.id,
      exposureS: 300,
      plannedCount: 40,
      moonMode: 'none',
    },
  });
  expect(
    (await call(`/projects/${pid}/submit`, { method: 'POST', as: 'user', body: {} })).status,
  ).toBe(200);
  const comment = async (as: Who, bodyMd: string, parentId?: string) => {
    s.clock.advance(1000);
    const r = await call(`/projects/${pid}/notes`, {
      method: 'POST',
      as,
      body: { bodyMd, ...(parentId ? { parentId } : {}) },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body as unknown as Note;
  };
  const notes = async (as: Who = 'owner') =>
    (await call(`/projects/${pid}/notes`, { as })).body.items as unknown as Note[];
  /** Ungelesene `project.comment`-Benachrichtigungen je Mitglied. */
  const bell = async () => {
    const rows = (
      await s.pg.admin.query("SELECT recipient_id FROM notification WHERE kind = 'project.comment'")
    ).rows as { recipient_id: string }[];
    const count = (who: Who) => rows.filter((r) => r.recipient_id === members[who]).length;
    return {
      owner: count('owner'),
      admin2: count('admin2'),
      user: count('user'),
      user2: count('user2'),
    };
  };
  return { members, call, pid, comment, notes, bell };
}

describe('Kommentare (FA-PRJ-17)', () => {
  it('Antworten eine Ebene tief, Benachrichtigung an Ersteller und bisherige Verfasser', async () => {
    const t = await setup();
    const c1 = await t.comment('user2', 'Schönes **Framing** 🔭');
    expect(c1).toMatchObject({ parentId: null, editedAt: null, deletedAt: null, reactions: [] });
    // Nur der Ersteller (user); der Verfasser selbst nicht.
    expect(await t.bell()).toEqual({ owner: 0, admin2: 0, user: 1, user2: 0 });

    const r1 = await t.comment('owner', 'Danke!', c1.id);
    expect(r1.parentId).toBe(c1.id);
    expect(await t.bell()).toEqual({ owner: 0, admin2: 0, user: 2, user2: 1 });

    // Antwort auf eine Antwort hängt sich an denselben Strang.
    const r2 = await t.comment('user', 'Gern', r1.id);
    expect(r2.parentId).toBe(c1.id);
    expect(await t.bell()).toEqual({ owner: 1, admin2: 0, user: 2, user2: 2 });

    const list = await t.notes('admin2');
    expect(list.map((n) => [n.id, n.parentId])).toEqual([
      [r2.id, c1.id],
      [r1.id, c1.id],
      [c1.id, null],
    ]);
    const [first] = (
      await s.pg.admin.query(
        "SELECT payload FROM notification WHERE kind = 'project.comment' ORDER BY created_at LIMIT 1",
      )
    ).rows as { payload: Record<string, unknown> }[];
    expect(first?.payload).toMatchObject({ subject: 'NGC 281', noteId: c1.id });

    // Antwort auf einen Kommentar eines anderen Projekts bzw. unbekannte ID → 404.
    const missing = await t.call(`/projects/${t.pid}/notes`, {
      method: 'POST',
      body: { bodyMd: 'x', parentId: id() },
    });
    expect([missing.status, missing.body.code]).toEqual([404, 'resource.not_found']);
  });

  it('Reaktionen: setzen, idempotent, entfernen; nur aus der festen Auswahl', async () => {
    const t = await setup();
    const c = await t.comment('user', 'Erste Nacht im Kasten');
    const react = (as: Who, emoji: string, active: boolean) =>
      t.call(`/projects/${t.pid}/notes/${c.id}/reactions`, {
        method: 'PUT',
        as,
        body: { emoji, active },
      });
    expect((await react('user2', '👍', true)).body.reactions).toEqual([
      { emoji: '👍', count: 1, mine: true },
    ]);
    expect((await react('user2', '👍', true)).body.reactions).toEqual([
      { emoji: '👍', count: 1, mine: true },
    ]);
    await react('owner', '👍', true);
    await react('owner', '🔭', true);
    expect((await t.notes('user')).find((n) => n.id === c.id)?.reactions).toEqual([
      { emoji: '👍', count: 2, mine: false },
      { emoji: '🔭', count: 1, mine: false },
    ]);
    expect((await react('owner', '👍', false)).body.reactions).toEqual([
      { emoji: '👍', count: 1, mine: false },
      { emoji: '🔭', count: 1, mine: true },
    ]);
    const bad = await react('user', '💩', true);
    expect([bad.status, bad.body.code]).toEqual([422, 'validation.failed']);
  });

  it('Bearbeiten nur der Verfasser und nur in der ersten Stunde', async () => {
    const t = await setup();
    const c = await t.comment('user2', 'Tippfeler');
    const edit = (as: Who, bodyMd: string) =>
      t.call(`/projects/${t.pid}/notes/${c.id}`, { method: 'PATCH', as, body: { bodyMd } });
    const other = await edit('owner', 'Fremd');
    expect([other.status, other.body.code]).toEqual([403, 'permission.denied']);
    s.clock.advance(59 * 60 * 1000);
    const ok = await edit('user2', 'Tippfehler');
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      bodyMd: 'Tippfehler',
      editedAt: s.clock.now().toISOString().replace('.000Z', 'Z'),
    });
    s.clock.advance(2 * 60 * 1000);
    const late = await edit('user2', 'Zu spät');
    expect([late.status, late.body.code]).toEqual([409, 'comment.edit_window_closed']);
    expect((await t.notes())[0]?.bodyMd).toBe('Tippfehler');
  });

  it('Löschen nur Admin/Owner, weich: Antworten bleiben, Text und Reaktionen weg', async () => {
    const t = await setup();
    const c = await t.comment('user', 'Löschen bitte');
    const reply = await t.comment('user2', 'Antwort bleibt', c.id);
    await t.call(`/projects/${t.pid}/notes/${c.id}/reactions`, {
      method: 'PUT',
      as: 'user2',
      body: { emoji: '🎉', active: true },
    });
    const denied = await t.call(`/projects/${t.pid}/notes/${c.id}`, {
      method: 'DELETE',
      as: 'user',
    });
    expect([denied.status, denied.body.code]).toEqual([403, 'permission.denied']);
    expect(
      (await t.call(`/projects/${t.pid}/notes/${c.id}`, { method: 'DELETE', as: 'admin2' })).status,
    ).toBe(204);
    // Wiederholbar.
    expect((await t.call(`/projects/${t.pid}/notes/${c.id}`, { method: 'DELETE' })).status).toBe(
      204,
    );
    const list = await t.notes('user');
    expect(list.find((n) => n.id === c.id)).toMatchObject({
      bodyMd: '',
      reactions: [],
      deletedAt: expect.any(String),
    });
    expect(list.find((n) => n.id === reply.id)).toMatchObject({ bodyMd: 'Antwort bleibt' });
    // Gelöschte Kommentare lassen sich weder bearbeiten noch mit Reaktionen versehen.
    const edit = await t.call(`/projects/${t.pid}/notes/${c.id}`, {
      method: 'PATCH',
      as: 'user',
      body: { bodyMd: 'wieder da' },
    });
    expect(edit.status).toBe(404);
    const react = await t.call(`/projects/${t.pid}/notes/${c.id}/reactions`, {
      method: 'PUT',
      body: { emoji: '👍', active: true },
    });
    expect(react.status).toBe(404);
    // Anzahl zählt nur nicht gelöschte Kommentare.
    const projects = (await t.call('/projects', { as: 'user2' })).body.items ?? [];
    expect(projects.find((p) => p.id === t.pid)?.commentCount).toBe(1);
  });

  it('Anzahl in Projektliste, Warteschlange und Entwürfen; fremde Projekte unsichtbar', async () => {
    const t = await setup();
    const listed = async () =>
      (((await t.call('/projects')).body.items ?? []) as Body[]).find((p) => p.id === t.pid)
        ?.commentCount;
    expect(await listed()).toBe(0);
    await t.comment('user', 'eins');
    await t.comment('owner', 'zwei');
    expect(await listed()).toBe(2);
    const queue = (await t.call('/queue')).body.items ?? [];
    expect(queue.find((q) => q.projectId === t.pid)?.commentCount).toBe(2);

    // Entwurf eines anderen Users: weder lesen noch kommentieren (FA-BER-02).
    const draft = await t.call('/projects', {
      method: 'POST',
      as: 'user2',
      body: { id: id(), name: 'Skizze' },
    });
    const did = draft.body.id as string;
    expect((await t.call(`/projects/${did}/notes`, { as: 'user' })).status).toBe(403);
    const post = await t.call(`/projects/${did}/notes`, {
      method: 'POST',
      as: 'user',
      body: { bodyMd: 'Hallo' },
    });
    expect([post.status, post.body.code]).toEqual([403, 'permission.denied']);
    // Admins sehen und kommentieren auch Entwürfe; Liste der Entwürfe mit Anzahl.
    expect(
      (
        await t.call(`/projects/${did}/notes`, {
          method: 'POST',
          as: 'admin2',
          body: { bodyMd: 'Ziel prüfen' },
        })
      ).status,
    ).toBe(201);
    const drafts = (await t.call('/drafts')).body.items ?? [];
    expect(drafts.find((d) => d.id === did)?.commentCount).toBe(1);
  });
});
