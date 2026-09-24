/** Benachrichtigungen (AP-06b, FA-FRG-11): nur beim Empfänger, Mandantenisolation, gelesen markieren, Service. */
import { COOKIE_NAMES } from '@nina-pm/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotificationService } from '../src/notifications/service';
import { createStack, type Stack } from './support/stack';

let s: Stack;
beforeAll(async () => {
  s = await createStack();
});
beforeEach(() => s.reset());
afterAll(() => s.close());

async function member(tenantId: string, role: 'admin' | 'user' = 'user') {
  const identity = await s.seed.identity();
  const memberId = await s.seed.member(identity.id, tenantId, role);
  const cookies = { [COOKIE_NAMES.session]: await s.seed.session(identity.id, tenantId, 'tenant') };
  return { memberId, cookies };
}
const list = async (cookies: Record<string, string>, query = '') =>
  (await (await s.request(`/api/web/v1/notifications${query}`, { cookies })).json()) as {
    items: { id: string; kind: string; payload: Record<string, unknown>; readAt: string | null }[];
    unreadCount: number;
    nextCursor: string | null;
  };

describe('Benachrichtigungen', () => {
  it('erscheinen nur beim Empfänger; Mandantenisolation', async () => {
    const a = await s.seed.tenant('alpha');
    const b = await s.seed.tenant('beta');
    const alice = await member(a);
    const bob = await member(a);
    const carol = await member(b);
    const service = createNotificationService(s.pg.db);
    await service.notify(a, 'role.changed', [alice.memberId], { from: 'user', to: 'admin' });
    await service.notify(b, 'deadline.near', [carol.memberId]);
    expect(await list(alice.cookies)).toMatchObject({
      unreadCount: 1,
      items: [{ kind: 'role.changed', payload: { from: 'user', to: 'admin' }, readAt: null }],
    });
    expect(await list(bob.cookies)).toMatchObject({ unreadCount: 0, items: [] });
    expect((await list(carol.cookies)).items.map((n) => n.kind)).toEqual(['deadline.near']);
    // Mitglied in Mandant B sieht nichts aus A, auch nicht mit derselben Identität in einem anderen Kontext.
    expect(JSON.stringify(await list(carol.cookies))).not.toContain('role.changed');
  });

  it('gelesen markieren: nur eigene, einzeln oder alle; fremde IDs werden ignoriert', async () => {
    const a = await s.seed.tenant('alpha');
    const alice = await member(a);
    const bob = await member(a);
    const service = createNotificationService(s.pg.db);
    await service.notify(a, 'submission.new', [alice.memberId, bob.memberId]);
    await service.notify(a, 'approval.approved', [alice.memberId]);
    const aliceItems = (await list(alice.cookies)).items;
    const bobItem = (await list(bob.cookies)).items[0];
    const markRead = (cookies: Record<string, string>, body: unknown) =>
      s.request('/api/web/v1/notifications/read', { method: 'POST', body, cookies });
    // Alice versucht Bobs Benachrichtigung zu lesen → keine Wirkung.
    expect(await (await markRead(alice.cookies, { ids: [bobItem?.id] })).json()).toEqual({
      unreadCount: 2,
    });
    expect((await list(bob.cookies)).unreadCount).toBe(1);
    expect(await (await markRead(alice.cookies, { ids: [aliceItems[0]?.id] })).json()).toEqual({
      unreadCount: 1,
    });
    expect(await (await markRead(alice.cookies, { all: true })).json()).toEqual({ unreadCount: 0 });
    expect((await list(alice.cookies, '?unread=true')).items).toEqual([]);
    expect((await list(bob.cookies)).unreadCount).toBe(1);
  });

  it('Cursor-Paginierung, neueste zuerst', async () => {
    const a = await s.seed.tenant('alpha');
    const alice = await member(a);
    const service = createNotificationService(s.pg.db);
    for (let i = 0; i < 5; i += 1) {
      await service.notify(
        a,
        'vote.subject_changed',
        [alice.memberId],
        { n: i },
        { now: new Date(Date.UTC(2026, 8, 24, 10, i)) },
      );
    }
    const first = await list(alice.cookies, '?limit=2');
    expect(first.items.map((n) => n.payload.n)).toEqual([4, 3]);
    const second = await list(alice.cookies, `?limit=2&cursor=${first.nextCursor}`);
    expect(second.items.map((n) => n.payload.n)).toEqual([2, 1]);
    const third = await list(alice.cookies, `?limit=2&cursor=${second.nextCursor}`);
    expect(third).toMatchObject({ items: [{ payload: { n: 0 } }], nextCursor: null });
  });

  it('Rollenwechsel durch den Owner erzeugt role.changed beim Betroffenen (über dieselbe Hilfsfunktion)', async () => {
    const a = await s.seed.tenant('alpha');
    const owner = await member(a, 'admin');
    await s.seed.owner(a, owner.memberId);
    const user = await member(a);
    await s.request(`/api/web/v1/members/${user.memberId}/role`, {
      method: 'PUT',
      body: { role: 'admin' },
      cookies: owner.cookies,
    });
    expect(await list(user.cookies)).toMatchObject({
      unreadCount: 1,
      items: [{ kind: 'role.changed', payload: { from: 'user', to: 'admin' } }],
    });
    expect((await list(owner.cookies)).unreadCount).toBe(0);
  });

  it('Service: Discord-Hook-Punkt wird je Ereignis aufgerufen; unbekannte Art wird abgelehnt', async () => {
    const a = await s.seed.tenant('alpha');
    const alice = await member(a);
    const hook = vi.fn(() => Promise.resolve());
    const service = createNotificationService(s.pg.db, [hook]);
    expect(
      await service.notify(a, 'project.completed', [alice.memberId, alice.memberId], {
        projectId: 'x',
      }),
    ).toBe(1);
    expect(hook).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: a,
        kind: 'project.completed',
        recipients: [alice.memberId],
      }),
    );
    await expect(service.notify(a, 'rotlicht.an' as never, [alice.memberId])).rejects.toThrow(
      /Unbekannte Benachrichtigungsart/,
    );
    expect(await service.notify(a, 'project.completed', [])).toBe(0);
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it('/auth/me liefert die Mandantenzeit (Standard Europe/Berlin, sonst tenantTimezone)', async () => {
    const a = await s.seed.tenant('alpha');
    const alice = await member(a);
    expect(
      await (await s.request('/api/auth/me', { cookies: alice.cookies })).json(),
    ).toMatchObject({ tenant: { timeZone: 'Europe/Berlin' } });
    await s.pg.admin.query(
      `UPDATE tenant SET settings = '{"tenantTimezone":"America/Chicago"}' WHERE id = $1`,
      [a],
    );
    expect(
      await (await s.request('/api/auth/me', { cookies: alice.cookies })).json(),
    ).toMatchObject({ tenant: { timeZone: 'America/Chicago' } });
  });
});
