/**
 * Mandanten, Einladungen, Owner-Invarianten (AP-04b; TK 5.4, 5.5; FA-BEN-01…10, FA-SU-05/06, E2, SEC-50)
 * – echte Sitzungen und echtes SQL (PGlite).
 */
import { deleteExpiredInvitations } from '@nina-pm/db';
import { COOKIE_NAMES } from '@nina-pm/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discordProfile } from './support/fake-discord';
import { createStack, setCookies, type Stack } from './support/stack';

let s: Stack;
let t: {
  tenantId: string;
  owner: Person;
  admin: Person;
  admin2: Person;
  user: Person;
  disabled: Person;
};

interface Person {
  identityId: string;
  memberId: string;
  sid: string;
}

async function person(
  tenantId: string,
  role: 'admin' | 'user',
  status = 'active',
  mfa = true,
): Promise<Person> {
  const identity = await s.seed.identity({ mfaEnabled: mfa });
  const memberId = await s.seed.member(identity.id, tenantId, role, status);
  const sid = await s.seed.session(identity.id, tenantId, 'tenant');
  return { identityId: identity.id, memberId, sid };
}

beforeEach(async () => {
  s = await createStack();
  const tenantId = await s.seed.tenant('sternwarte');
  const owner = await person(tenantId, 'admin');
  await s.seed.owner(tenantId, owner.memberId);
  t = {
    tenantId,
    owner,
    admin: await person(tenantId, 'admin'),
    admin2: await person(tenantId, 'admin'),
    user: await person(tenantId, 'user'),
    disabled: await person(tenantId, 'admin', 'disabled'),
  };
});
afterEach(() => s.close());

const as = (p: Person, path: string, method = 'GET', body?: unknown) =>
  s.request(path, {
    method,
    cookies: { [COOKIE_NAMES.session]: p.sid },
    ...(body !== undefined ? { body } : {}),
  });
const code = async (res: Response) => {
  const text = await res.text();
  return {
    status: res.status,
    code: text ? (JSON.parse(text) as { code?: string }).code : undefined,
  };
};
const row = async (sql: string, params: unknown[] = []) =>
  (await s.pg.admin.query(sql, params)).rows[0];

describe('Owner-Invarianten (TK 5.5, FA-BEN-08)', () => {
  it('Admin versucht den Owner herabzustufen, zu deaktivieren, zu entfernen → 409 member.owner_protected', async () => {
    const o = t.owner.memberId;
    expect(
      await code(await as(t.admin, `/api/web/v1/members/${o}/role`, 'PUT', { role: 'user' })),
    ).toEqual({ status: 409, code: 'member.owner_protected' });
    expect(
      await code(await as(t.admin, `/api/web/v1/members/${o}`, 'PATCH', { status: 'disabled' })),
    ).toEqual({ status: 409, code: 'member.owner_protected' });
    expect(await code(await as(t.admin, `/api/web/v1/members/${o}`, 'DELETE'))).toEqual({
      status: 409,
      code: 'member.owner_protected',
    });
    expect(await code(await as(t.admin, `/api/web/v1/members/${o}/sessions`, 'DELETE'))).toEqual({
      status: 409,
      code: 'member.owner_protected',
    });
    expect(await row('SELECT role, status FROM app_user WHERE id = $1', [o])).toEqual({
      role: 'admin',
      status: 'active',
    });
  });

  it('Admin ernennt Admin → 403; Admin verwaltet Admins nicht, nur Mitglieder mit Rolle User', async () => {
    expect(
      await code(
        await as(t.admin, `/api/web/v1/members/${t.user.memberId}/role`, 'PUT', { role: 'admin' }),
      ),
    ).toEqual({ status: 403, code: 'permission.denied' });
    expect(
      (
        await as(t.admin, `/api/web/v1/members/${t.admin2.memberId}`, 'PATCH', {
          status: 'disabled',
        })
      ).status,
    ).toBe(403);
    expect(
      (await as(t.admin, `/api/web/v1/members/${t.user.memberId}`, 'PATCH', { status: 'disabled' }))
        .status,
    ).toBe(204);
  });

  it('Owner ernennt und entzieht Admins sofort wirksam; change_log mit Grund, Benachrichtigung role.changed', async () => {
    expect(
      (
        await as(t.owner, `/api/web/v1/members/${t.user.memberId}/role`, 'PUT', {
          role: 'admin',
          reason: 'Nachtwache',
        })
      ).status,
    ).toBe(204);
    const me = (await (await as(t.user, '/api/auth/me')).json()) as {
      member: { effectiveRole: string };
    };
    expect(me.member.effectiveRole).toBe('admin');
    const log = await row(
      "SELECT user_id, action, diff FROM change_log WHERE entity = 'app_user' AND entity_id = $1",
      [t.user.memberId],
    );
    expect(log).toMatchObject({
      user_id: t.owner.memberId,
      action: 'role_change',
      diff: { role: { from: 'user', to: 'admin' }, reason: 'Nachtwache' },
    });
    expect(
      await row('SELECT kind FROM notification WHERE recipient_id = $1', [t.user.memberId]),
    ).toEqual({ kind: 'role.changed' });
  });

  it('Owner ändert die eigene Rolle → 409 member.cannot_change_self; Owner verlässt den Mandanten → 409 member.owner_cannot_leave', async () => {
    expect(
      await code(
        await as(t.owner, `/api/web/v1/members/${t.owner.memberId}/role`, 'PUT', { role: 'user' }),
      ),
    ).toEqual({ status: 409, code: 'member.cannot_change_self' });
    expect(
      await code(
        await as(t.owner, `/api/web/v1/members/${t.owner.memberId}`, 'PATCH', {
          status: 'disabled',
        }),
      ),
    ).toEqual({ status: 409, code: 'member.cannot_change_self' });
    expect(await code(await as(t.owner, '/api/web/v1/me/leave', 'POST'))).toEqual({
      status: 409,
      code: 'member.owner_cannot_leave',
    });
    // Andere dürfen austreten; die Sitzung im Mandanten endet.
    expect((await as(t.user, '/api/web/v1/me/leave', 'POST')).status).toBe(204);
    expect(await row('SELECT status FROM app_user WHERE id = $1', [t.user.memberId])).toEqual({
      status: 'removed',
    });
    expect((await as(t.user, '/api/auth/me')).status).toBe(401);
  });

  it('Mandant ohne Owner: Owner-Aktionen stehen niemandem zu (TK 5.5)', async () => {
    await s.pg.admin.query('UPDATE tenant SET owner_member_id = NULL WHERE id = $1', [t.tenantId]);
    expect(
      (await as(t.owner, `/api/web/v1/members/${t.user.memberId}/role`, 'PUT', { role: 'admin' }))
        .status,
    ).toBe(403);
    expect(
      (await as(t.owner, '/api/web/v1/invitations/admin', 'POST', { id: crypto.randomUUID() }))
        .status,
    ).toBe(403);
  });
});

describe('Owner-Übertragung sofort (E2, FA-BEN-09)', () => {
  it('an einen aktiven Admin → sofort wirksam, alter Owner bleibt Admin, owner.reassigned an alle Admins', async () => {
    expect(
      (
        await as(t.owner, '/api/web/v1/tenant/owner-transfer', 'POST', {
          memberId: t.admin.memberId,
        })
      ).status,
    ).toBe(204);
    expect(await row('SELECT owner_member_id FROM tenant WHERE id = $1', [t.tenantId])).toEqual({
      owner_member_id: t.admin.memberId,
    });
    expect(
      await row('SELECT role, status FROM app_user WHERE id = $1', [t.owner.memberId]),
    ).toEqual({ role: 'admin', status: 'active' });
    const recipients = (
      await s.pg.admin.query(
        "SELECT recipient_id FROM notification WHERE kind = 'owner.reassigned' ORDER BY recipient_id",
      )
    ).rows.map((r) => r.recipient_id);
    expect(recipients.sort()).toEqual(
      [t.owner.memberId, t.admin.memberId, t.admin2.memberId].sort(),
    );
    // Der neue Owner hat sofort Owner-Rechte, der alte nicht mehr.
    expect(await (await as(t.admin, '/api/auth/me')).json()).toMatchObject({
      member: { role: 'owner' },
    });
    expect(
      (
        await as(t.owner, '/api/web/v1/tenant/owner-transfer', 'POST', {
          memberId: t.admin2.memberId,
        })
      ).status,
    ).toBe(403);
  });

  it('an einen User bzw. ein deaktiviertes Mitglied → 422 owner_transfer.target_invalid; durch einen Admin → 403', async () => {
    expect(
      await code(
        await as(t.owner, '/api/web/v1/tenant/owner-transfer', 'POST', {
          memberId: t.user.memberId,
        }),
      ),
    ).toEqual({ status: 422, code: 'owner_transfer.target_invalid' });
    expect(
      await code(
        await as(t.owner, '/api/web/v1/tenant/owner-transfer', 'POST', {
          memberId: t.disabled.memberId,
        }),
      ),
    ).toEqual({ status: 422, code: 'owner_transfer.target_invalid' });
    expect(
      await code(
        await as(t.owner, '/api/web/v1/tenant/owner-transfer', 'POST', {
          memberId: crypto.randomUUID(),
        }),
      ),
    ).toEqual({ status: 422, code: 'owner_transfer.target_invalid' });
    expect(
      await code(
        await as(t.admin, '/api/web/v1/tenant/owner-transfer', 'POST', {
          memberId: t.admin2.memberId,
        }),
      ),
    ).toEqual({ status: 403, code: 'permission.denied' });
  });

  it('Owner ohne 2FA kann nicht übertragen (Rechte ruhen, SV-03)', async () => {
    await s.pg.admin.query('UPDATE identity SET mfa_enabled = false WHERE id = $1', [
      t.owner.identityId,
    ]);
    expect(
      (
        await as(t.owner, '/api/web/v1/tenant/owner-transfer', 'POST', {
          memberId: t.admin.memberId,
        })
      ).status,
    ).toBe(403);
  });
});

describe('Einladungen (SEC-50, FA-BEN-01, TK 5.2)', () => {
  it('POST /web/v1/invitations legt fest role user an; {role:"admin"} im Rumpf wird abgelehnt; Admin-Route nur Owner', async () => {
    const res = await as(t.admin, '/api/web/v1/invitations', 'POST', {
      id: crypto.randomUUID(),
      maxUses: 5,
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { role: string; link: string };
    expect(created.role).toBe('user');
    expect(created.link).toMatch(/^https:\/\/nina-pm\.svenesis\.org\/einladung#[A-Za-z0-9_-]{43}$/);
    expect(
      await code(
        await as(t.admin, '/api/web/v1/invitations', 'POST', {
          id: crypto.randomUUID(),
          role: 'admin',
        }),
      ),
    ).toEqual({ status: 422, code: 'validation.failed' });
    expect(
      (await as(t.admin, '/api/web/v1/invitations/admin', 'POST', { id: crypto.randomUUID() }))
        .status,
    ).toBe(403);
    const adminInv = await as(t.owner, '/api/web/v1/invitations/admin', 'POST', {
      id: crypto.randomUUID(),
      maxUses: 3,
    });
    expect(adminInv.status).toBe(422);
    expect(
      (await as(t.owner, '/api/web/v1/invitations/admin', 'POST', { id: crypto.randomUUID() }))
        .status,
    ).toBe(201);
    const roles = (await s.pg.admin.query('SELECT role, max_uses FROM invitation ORDER BY role'))
      .rows;
    expect(roles).toEqual([
      { role: 'admin', max_uses: 1 },
      { role: 'user', max_uses: 5 },
    ]);
  });

  it('Owner- oder Admin-Einladung mit max_uses > 1 scheitert am Schema-CHECK', async () => {
    for (const role of ['owner', 'admin']) {
      await expect(
        s.pg.admin.query(
          "INSERT INTO invitation (tenant_id, token_hash, role, max_uses, expires_at) VALUES ($1, $2, $3, 2, now() + interval '1 day')",
          [t.tenantId, `h-${role}`, role],
        ),
      ).rejects.toThrow(/check/i);
    }
  });

  it('Einladung mit gleicher Client-UUID → 409 resource.in_use (Token wird nie erneut ausgegeben)', async () => {
    const id = crypto.randomUUID();
    expect((await as(t.admin, '/api/web/v1/invitations', 'POST', { id })).status).toBe(201);
    expect(await code(await as(t.admin, '/api/web/v1/invitations', 'POST', { id }))).toEqual({
      status: 409,
      code: 'resource.in_use',
    });
  });

  it('Widerruf: Admin nur eigene User-Einladungen, nicht die des Owners', async () => {
    const own = (await (
      await as(t.admin, '/api/web/v1/invitations', 'POST', { id: crypto.randomUUID() })
    ).json()) as { id: string };
    const ofOwner = (await (
      await as(t.owner, '/api/web/v1/invitations', 'POST', { id: crypto.randomUUID() })
    ).json()) as { id: string };
    expect((await as(t.admin, `/api/web/v1/invitations/${ofOwner.id}`, 'DELETE')).status).toBe(403);
    expect((await as(t.admin, `/api/web/v1/invitations/${own.id}`, 'DELETE')).status).toBe(204);
    const list = (await (await as(t.admin, '/api/web/v1/invitations')).json()) as {
      invitations: { id: string; revokedAt: string | null; ownerOnly: boolean }[];
    };
    expect(list.invitations.find((i) => i.id === own.id)?.revokedAt).not.toBeNull();
    expect(list.invitations.find((i) => i.id === ofOwner.id)?.ownerOnly).toBe(true);
  });

  it('Vorschau und Einlösen; Owner-Einladung in einem Mandanten mit Owner → 404 invitation.invalid', async () => {
    const superIdentity = await s.seed.identity({ mfaEnabled: true });
    await s.seed.superUser(superIdentity.id);
    const sys = await s.seed.session(superIdentity.id, null, 'system');
    const sysReq = (path: string, method: string, body?: unknown) =>
      s.request(path, {
        method,
        cookies: { [COOKIE_NAMES.session]: sys },
        ...(body !== undefined ? { body } : {}),
      });
    const newTenant = (await (
      await sysReq('/api/system/v1/tenants', 'POST', { tenantKey: 'neu', displayName: 'Neu' })
    ).json()) as { id: string };
    const ownerInv = (await (
      await sysReq(`/api/system/v1/tenants/${newTenant.id}/invitations`, 'POST', {
        id: crypto.randomUUID(),
      })
    ).json()) as { link: string };
    const token = ownerInv.link.split('#')[1] ?? '';
    expect(
      await (
        await s.request('/api/auth/invitations/preview', { method: 'POST', body: { token } })
      ).json(),
    ).toMatchObject({ tenantName: 'Neu', role: 'owner' });
    const invite =
      setCookies(
        await s.request('/api/auth/invitation/claim', { method: 'POST', body: { token } }),
      )[COOKIE_NAMES.invite]?.value ?? '';
    const login = await s.login(discordProfile(), { cookies: { [COOKIE_NAMES.invite]: invite } });
    expect(
      await (
        await s.request('/api/auth/me', { cookies: { [COOKIE_NAMES.session]: login.sid ?? '' } })
      ).json(),
    ).toMatchObject({ member: { role: 'owner' } });

    // Zweite Owner-Einladung für denselben Mandanten: Anlage möglich, Einlösen/Vormerken → 404.
    const second = (await (
      await sysReq(`/api/system/v1/tenants/${newTenant.id}/invitations`, 'POST', {
        id: crypto.randomUUID(),
      })
    ).json()) as { link: string };
    expect(
      await code(
        await s.request('/api/auth/invitation/claim', {
          method: 'POST',
          body: { token: second.link.split('#')[1] },
        }),
      ),
    ).toEqual({ status: 404, code: 'invitation.invalid' });
    const audit = (
      await s.pg.admin.query(
        'SELECT actor, action FROM system_audit WHERE tenant_id = $1 ORDER BY created_at',
        [newTenant.id],
      )
    ).rows;
    expect(audit.map((a) => a.action)).toEqual([
      'tenant.create',
      'invitation.create',
      'invitation.create',
    ]);
  });

  it('daily: abgelaufene Einladungen werden gelöscht', async () => {
    await s.seed.invitation(t.tenantId, 'user', {
      expiresAt: new Date(s.clock.now().getTime() - 1000),
    });
    await s.seed.invitation(t.tenantId, 'user');
    expect(await deleteExpiredInvitations(s.pg.db, s.clock.now())).toBe(1);
    expect((await row('SELECT count(*)::int AS n FROM invitation'))?.n).toBe(1);
  });
});

describe('Super User (FA-SU-05, FA-SU-06)', () => {
  let sys: string;
  let superId: string;
  const sysReq = (path: string, method = 'GET', body?: unknown) =>
    s.request(path, {
      method,
      cookies: { [COOKIE_NAMES.session]: sys },
      ...(body !== undefined ? { body } : {}),
    });

  beforeEach(async () => {
    const identity = await s.seed.identity({ mfaEnabled: true });
    superId = identity.id;
    await s.seed.superUser(superId);
    sys = await s.seed.session(superId, null, 'system');
  });

  it('Notfall-Neuzuweisung deaktiviert standardmäßig den alten Owner und benachrichtigt alle Admins einschließlich des bisherigen Owners', async () => {
    const res = await sysReq(`/api/system/v1/tenants/${t.tenantId}/owner`, 'PUT', {
      memberId: t.user.memberId,
      reason: 'Owner nicht erreichbar',
    });
    expect(res.status).toBe(200);
    expect(await row('SELECT owner_member_id FROM tenant WHERE id = $1', [t.tenantId])).toEqual({
      owner_member_id: t.user.memberId,
    });
    expect(await row('SELECT role FROM app_user WHERE id = $1', [t.user.memberId])).toEqual({
      role: 'admin',
    });
    expect(await row('SELECT status FROM app_user WHERE id = $1', [t.owner.memberId])).toEqual({
      status: 'disabled',
    });
    const recipients = (
      await s.pg.admin.query(
        "SELECT recipient_id FROM notification WHERE kind = 'owner.reassigned'",
      )
    ).rows
      .map((r) => r.recipient_id)
      .sort();
    expect(recipients).toEqual(
      [t.owner.memberId, t.admin.memberId, t.admin2.memberId, t.user.memberId].sort(),
    );
    expect((await as(t.owner, '/api/auth/me')).status).toBe(401);
    expect(
      await row(
        "SELECT actor, super_user_id, action FROM system_audit WHERE action = 'tenant.owner.reassign'",
      ),
    ).toEqual({ actor: 'super_user', super_user_id: superId, action: 'tenant.owner.reassign' });
  });

  it('Neuzuweisung per Einladung leert den Owner bis zur Annahme; mit keepPreviousAsAdmin bleibt der alte Admin', async () => {
    const res = await sysReq(`/api/system/v1/tenants/${t.tenantId}/owner`, 'PUT', {
      invite: { id: crypto.randomUUID() },
      reason: 'neu',
      keepPreviousAsAdmin: true,
    });
    expect(await res.json()).toMatchObject({ invitation: { role: 'owner' } });
    expect(await row('SELECT owner_member_id FROM tenant WHERE id = $1', [t.tenantId])).toEqual({
      owner_member_id: null,
    });
    expect(
      await row('SELECT role, status FROM app_user WHERE id = $1', [t.owner.memberId]),
    ).toEqual({ role: 'admin', status: 'active' });
  });

  it('letzten aktiven Super User deaktivieren oder entfernen → 409 super_user.last_protected', async () => {
    expect(
      await code(
        await sysReq(`/api/system/v1/super-users/${superId}`, 'PATCH', { status: 'disabled' }),
      ),
    ).toEqual({ status: 409, code: 'super_user.last_protected' });
    expect(await code(await sysReq(`/api/system/v1/super-users/${superId}`, 'DELETE'))).toEqual({
      status: 409,
      code: 'super_user.last_protected',
    });
    const second = await s.seed.identity({ discordUserId: '444444444444444444' });
    expect(
      (await sysReq('/api/system/v1/super-users', 'POST', { discordUserId: '444444444444444444' }))
        .status,
    ).toBe(204);
    expect(
      (await sysReq(`/api/system/v1/super-users/${second.id}`, 'PATCH', { status: 'disabled' }))
        .status,
    ).toBe(204);
    expect(await code(await sysReq(`/api/system/v1/super-users/${superId}`, 'DELETE'))).toEqual({
      status: 409,
      code: 'super_user.last_protected',
    });
    expect(
      (await sysReq(`/api/system/v1/super-users/${second.id}`, 'PATCH', { status: 'active' }))
        .status,
    ).toBe(204);
    expect((await sysReq(`/api/system/v1/super-users/${superId}`, 'DELETE')).status).toBe(204);
  });

  it('Mandant anlegen mit Built-in-Mondprofilen; sperren → Mitglieder erhalten tenant.locked', async () => {
    const created = await sysReq('/api/system/v1/tenants', 'POST', {
      tenantKey: 'club',
      displayName: 'Club',
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect(
      (
        await row(
          'SELECT count(*)::int AS n FROM moon_profile WHERE tenant_id = $1 AND is_built_in',
          [id],
        )
      )?.n,
    ).toBe(4);
    expect(
      await code(
        await sysReq('/api/system/v1/tenants', 'POST', { tenantKey: 'club', displayName: 'x' }),
      ),
    ).toEqual({ status: 409, code: 'resource.in_use' });
    expect(
      (await sysReq(`/api/system/v1/tenants/${t.tenantId}`, 'PATCH', { status: 'locked' })).status,
    ).toBe(200);
    expect(await code(await as(t.admin, '/api/web/v1/members'))).toEqual({
      status: 403,
      code: 'tenant.locked',
    });
    const list = (await (await sysReq('/api/system/v1/tenants')).json()) as {
      tenants: { tenantKey: string; admins: number; users: number }[];
    };
    expect(list.tenants.find((x) => x.tenantKey === 'sternwarte')).toMatchObject({
      admins: 3,
      users: 1,
    });
  });

  it('Mitgliederliste für die Neuzuweisung zeigt nur Anzeigename, Rolle, Status (FA-SU-07)', async () => {
    const res = (await (await sysReq(`/api/system/v1/tenants/${t.tenantId}/members`)).json()) as {
      members: Record<string, unknown>[];
    };
    expect(Object.keys(res.members[0] ?? {}).sort()).toEqual([
      'displayName',
      'id',
      'role',
      'status',
    ]);
    expect(res.members.find((m) => m.id === t.owner.memberId)?.role).toBe('owner');
  });

  it('Identität sperren beendet alle Sitzungen', async () => {
    expect(
      (
        await sysReq(`/api/system/v1/identities/${t.user.identityId}`, 'PATCH', {
          status: 'blocked',
        })
      ).status,
    ).toBe(204);
    expect((await as(t.user, '/api/auth/me')).status).toBe(401);
  });
});
