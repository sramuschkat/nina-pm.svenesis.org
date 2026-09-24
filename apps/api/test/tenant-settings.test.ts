/** S-71…S-73 (AP-07c): Mandanteneinstellungen, Änderungsprotokoll, letzte Anmeldung in der Sitzungsliste. */
import { COOKIE_NAMES } from '@nina-pm/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createStack, type Stack } from './support/stack';

let s: Stack;
beforeAll(async () => {
  s = await createStack();
});
beforeEach(() => s.reset());
afterAll(() => s.close());

async function setup() {
  const tenantId = await s.seed.tenant('alpha');
  const ownerIdentity = await s.seed.identity({ mfaEnabled: true });
  const owner = await s.seed.member(ownerIdentity.id, tenantId, 'admin');
  await s.seed.owner(tenantId, owner);
  await s.pg.admin.query("UPDATE app_user SET display_name = 'Olivia' WHERE id = $1", [owner]);
  const userIdentity = await s.seed.identity();
  const user = await s.seed.member(userIdentity.id, tenantId, 'user');
  await s.pg.admin.query("UPDATE app_user SET display_name = 'Uta' WHERE id = $1", [user]);
  const cookies = async (identityId: string) => ({
    [COOKIE_NAMES.session]: await s.seed.session(identityId, tenantId, 'tenant'),
  });
  return { tenantId, owner, user, ownerIdentity, userIdentity, cookies };
}

describe('Mandanteneinstellungen (S-71, FA-MAN-05)', () => {
  it('liefert Standardwerte; Änderung wird gespeichert, protokolliert und wirkt auf /auth/me', async () => {
    const t = await setup();
    const cookies = await t.cookies(t.ownerIdentity.id);
    const initial = (await (
      await s.request('/api/web/v1/tenant/settings', { cookies })
    ).json()) as {
      settings: Record<string, unknown>;
    };
    expect(initial.settings).toMatchObject({
      tenantTimezone: 'Europe/Berlin',
      adminSelfApproval: true,
      autoReadyToProcess: false,
      autoReactivateOnRemaining: true,
      exoUserMaxOpenLocks: 3,
      approvalDeadlineDays: null,
    });
    const res = await s.request('/api/web/v1/tenant/settings', {
      method: 'PATCH',
      cookies,
      body: {
        displayName: 'Alpha-Sternwarte',
        settings: { tenantTimezone: 'America/Chicago', exoUserMaxOpenLocks: 5 },
      },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      displayName: 'Alpha-Sternwarte',
      settings: {
        tenantTimezone: 'America/Chicago',
        exoUserMaxOpenLocks: 5,
        adminSelfApproval: true,
      },
    });
    expect(await (await s.request('/api/auth/me', { cookies })).json()).toMatchObject({
      tenant: { name: 'Alpha-Sternwarte', timeZone: 'America/Chicago' },
    });
    const log = (await (
      await s.request('/api/web/v1/audit/changes?entity=tenant', { cookies })
    ).json()) as {
      items: { actorName: string; diff: Record<string, unknown> }[];
    };
    expect(log.items[0]).toMatchObject({
      actorName: 'Olivia',
      diff: {
        tenantTimezone: { from: 'Europe/Berlin', to: 'America/Chicago' },
        exoUserMaxOpenLocks: { from: 3, to: 5 },
        displayName: { to: 'Alpha-Sternwarte' },
      },
    });
  });

  it('unbekannter Schlüssel (auch Sicherheitsschlüssel) oder ungültiger Wert → 422 validation.failed', async () => {
    const t = await setup();
    const cookies = await t.cookies(t.ownerIdentity.id);
    for (const body of [
      { settings: { sessionMaxDays: 30 } },
      { settings: { requireMfa: false } },
      { unknown: true },
      { settings: { tenantTimezone: 'Mars/Olympus' } },
      { settings: { exoUserMaxOpenLocks: 0 } },
    ]) {
      const res = await s.request('/api/web/v1/tenant/settings', {
        method: 'PATCH',
        cookies,
        body,
      });
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(await res.json()).toMatchObject({ code: 'validation.failed' });
    }
  });

  it('User dürfen die Einstellungen weder lesen noch ändern', async () => {
    const t = await setup();
    const cookies = await t.cookies(t.userIdentity.id);
    expect((await s.request('/api/web/v1/tenant/settings', { cookies })).status).toBe(403);
    expect((await s.request('/api/web/v1/audit/changes', { cookies })).status).toBe(403);
  });
});

describe('Änderungsprotokoll (S-72)', () => {
  it('Rollenwechsel mit Grund, Akteur und Betroffenem; Cursor; Mandantenisolation', async () => {
    const t = await setup();
    const cookies = await t.cookies(t.ownerIdentity.id);
    await s.request(`/api/web/v1/members/${t.user}/role`, {
      method: 'PUT',
      cookies,
      body: { role: 'admin', reason: 'Hilft beim Freigeben' },
    });
    s.clock.advance(1000);
    await s.request(`/api/web/v1/members/${t.user}/role`, {
      method: 'PUT',
      cookies,
      body: { role: 'user' },
    });
    const page1 = (await (
      await s.request('/api/web/v1/audit/changes?limit=1', { cookies })
    ).json()) as {
      items: { actorName: string; subjectName: string; diff: Record<string, unknown> }[];
      nextCursor: string;
    };
    expect(page1.items[0]).toMatchObject({
      actorName: 'Olivia',
      subjectName: 'Uta',
      diff: { role: { to: 'user' } },
    });
    const page2 = (await (
      await s.request(`/api/web/v1/audit/changes?limit=1&cursor=${page1.nextCursor}`, { cookies })
    ).json()) as { items: { diff: Record<string, unknown> }[] };
    expect(page2.items[0]?.diff).toMatchObject({
      role: { to: 'admin' },
      reason: 'Hilft beim Freigeben',
    });

    const other = await s.seed.tenant('beta');
    const foreign = await s.seed.identity({ mfaEnabled: true });
    const foreignAdmin = await s.seed.member(foreign.id, other, 'admin');
    await s.seed.owner(other, foreignAdmin);
    const foreignCookies = {
      [COOKIE_NAMES.session]: await s.seed.session(foreign.id, other, 'tenant'),
    };
    const theirs = (await (
      await s.request('/api/web/v1/audit/changes', { cookies: foreignCookies })
    ).json()) as {
      items: unknown[];
    };
    expect(theirs.items).toEqual([]);
  });
});

describe('Anmeldesitzungen (S-73)', () => {
  it('Liste enthält die letzte Anmeldung der Identität', async () => {
    const t = await setup();
    await s.pg.admin.query(
      "UPDATE identity SET last_login_at = '2026-09-20T07:30:00Z' WHERE id = $1",
      [t.userIdentity.id],
    );
    const res = await s.request('/api/auth/sessions', {
      cookies: await t.cookies(t.userIdentity.id),
    });
    expect(await res.json()).toMatchObject({
      lastLoginAt: '2026-09-20T07:30:00Z',
      sessions: [expect.objectContaining({ current: true })],
    });
  });
});
