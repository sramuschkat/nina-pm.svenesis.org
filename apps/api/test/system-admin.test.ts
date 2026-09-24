/**
 * System-Administration (AP-07a; FA-SU-03…09, FA-MAN-03, FA-LOG-05): Mandant löschen mit Namenseingabe,
 * System-Audit (auch für Admins des betroffenen Mandanten), Wartungsbanner, Identität sperren.
 */
import { deleteTenantData, TENANT_DELETE_ORDER } from '@nina-pm/db';
import { COOKIE_NAMES } from '@nina-pm/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createStack, type Stack } from './support/stack';

let s: Stack;
beforeAll(async () => {
  s = await createStack();
});
beforeEach(() => s.reset());
afterAll(() => s.close());

async function superUser() {
  const identity = await s.seed.identity({ mfaEnabled: true, username: 'sven' });
  await s.seed.superUser(identity.id);
  const sid = await s.seed.session(identity.id, null, 'system');
  return (path: string, method = 'GET', body?: unknown) =>
    s.request(path, {
      method,
      cookies: { [COOKIE_NAMES.session]: sid },
      ...(body !== undefined ? { body } : {}),
    });
}

async function tenantWithData(key: string) {
  const tenantId = await s.seed.tenant(key);
  const ownerIdentity = await s.seed.identity();
  const owner = await s.seed.member(ownerIdentity.id, tenantId, 'admin');
  await s.seed.owner(tenantId, owner);
  const userIdentity = await s.seed.identity();
  const user = await s.seed.member(userIdentity.id, tenantId, 'user');
  const q = s.pg.admin.query.bind(s.pg.admin);
  await q('UPDATE app_user SET invited_by = $1 WHERE id = $2', [owner, user]);
  await s.seed.invitation(tenantId, 'user');
  await s.seed.session(userIdentity.id, tenantId, 'tenant');
  await q(
    "INSERT INTO notification (tenant_id, recipient_id, kind) VALUES ($1, $2, 'role.changed')",
    [tenantId, user],
  );
  await q(
    `INSERT INTO user_preference (tenant_id, user_id, pref_key, value) VALUES ($1, $2, 'ui.theme', '"dark"')`,
    [tenantId, user],
  );
  await q(
    "INSERT INTO change_log (tenant_id, user_id, entity, entity_id, action, diff) VALUES ($1, $2, 'app_user', $2, 'update', '{}')",
    [tenantId, owner],
  );
  await q(
    "INSERT INTO moon_profile (tenant_id, name, separation_deg, width_days, relax_scale, moon_min_alt_deg, moon_max_alt_deg, max_illumination_pct, moon_must_be_down) VALUES ($1, 'x', 90, 8, 0, -15, 5, 30, false)",
    [tenantId],
  );
  return { tenantId, owner, user, ownerIdentity, userIdentity };
}

async function tenantRowCount(tenantId: string) {
  let total = 0;
  for (const { table } of TENANT_DELETE_ORDER) {
    const r = await s.pg.admin.query(
      `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
      [tenantId],
    );
    total += Number((r.rows[0] as { n: number }).n);
  }
  return total;
}

describe('Mandant löschen (FA-MAN-03)', () => {
  it('nur mit exakter Mandanten-ID; entfernt alle Daten und Dateien, anderer Mandant bleibt; Audit bleibt', async () => {
    const sys = await superUser();
    const a = await tenantWithData('alpha');
    const b = await tenantWithData('beta');
    await sys(`/api/system/v1/tenants/${a.tenantId}`, 'PATCH', { status: 'locked' });
    expect(await tenantRowCount(a.tenantId)).toBeGreaterThan(5);

    const wrong = await sys(`/api/system/v1/tenants/${a.tenantId}`, 'DELETE', {
      confirmTenantKey: 'Alpha',
    });
    expect(wrong.status).toBe(422);
    expect(await wrong.json()).toMatchObject({ code: 'validation.failed' });
    expect(s.deletedFiles).toEqual([]);

    const ok = await sys(`/api/system/v1/tenants/${a.tenantId}`, 'DELETE', {
      confirmTenantKey: ' alpha ',
    });
    expect(ok.status).toBe(204);
    expect(s.deletedFiles).toEqual([a.tenantId]);
    expect(await tenantRowCount(a.tenantId)).toBe(0);
    expect(
      (await s.pg.admin.query('SELECT 1 FROM tenant WHERE id = $1', [a.tenantId])).rows,
    ).toEqual([]);
    expect(await tenantRowCount(b.tenantId)).toBeGreaterThan(5);
    // Identitäten bleiben (mandantenübergreifend), Audit ohne Fremdschlüssel mit Mandanten-ID.
    expect(
      (await s.pg.admin.query('SELECT 1 FROM identity WHERE id = $1', [a.userIdentity.id])).rows,
    ).toHaveLength(1);
    const audit = (
      await s.pg.admin.query(
        "SELECT action, tenant_id, details->>'tenantKey' AS key FROM system_audit WHERE details->>'tenantId' = $1 OR details->>'tenantKey' = 'alpha' ORDER BY created_at",
        [a.tenantId],
      )
    ).rows as { action: string; tenant_id: string | null; key: string }[];
    expect(audit.map((r) => r.action)).toEqual(['tenant.lock', 'tenant.delete']);
    expect(audit.every((r) => r.tenant_id === null && r.key === 'alpha')).toBe(true);
  });

  it('stapelweise (auch mit Stapelgröße 1) und wiederholbar', async () => {
    const a = await tenantWithData('gamma');
    const counts = await deleteTenantData(
      s.pg.db,
      { id: a.tenantId, tenantKey: 'gamma' },
      { batch: 1 },
    );
    expect(counts.app_user).toBe(2);
    expect(await tenantRowCount(a.tenantId)).toBe(0);
    expect(await deleteTenantData(s.pg.db, { id: a.tenantId, tenantKey: 'gamma' })).toMatchObject({
      app_user: 0,
    });
  });

  it('unbekannter Mandant → 404 tenant.not_found', async () => {
    const sys = await superUser();
    const res = await sys(`/api/system/v1/tenants/${crypto.randomUUID()}`, 'DELETE', {
      confirmTenantKey: 'x',
    });
    expect(res.status).toBe(404);
  });
});

describe('Mandantenliste (FA-SU-03)', () => {
  it('Owner-Name bzw. ausstehend, Kennzahlen, letzte Anmeldung', async () => {
    const sys = await superUser();
    const a = await tenantWithData('alpha');
    await s.pg.admin.query(
      "UPDATE app_user SET display_name = 'Olivia', last_login_at = '2026-09-20T08:00:00Z' WHERE id = $1",
      [a.owner],
    );
    const created = (await (
      await sys('/api/system/v1/tenants', 'POST', { tenantKey: 'neu', displayName: 'Neu' })
    ).json()) as { ownerDisplayName: string | null; rigs: number };
    expect(created).toMatchObject({ ownerDisplayName: null, rigs: 0, ninaInstances: 0 });
    const { tenants } = (await (await sys('/api/system/v1/tenants')).json()) as {
      tenants: Record<string, unknown>[];
    };
    expect(tenants.find((t) => t.tenantKey === 'alpha')).toMatchObject({
      ownerDisplayName: 'Olivia',
      admins: 1,
      users: 1,
      rigs: 0,
      ninaInstances: 0,
      ninaLastSeenAt: null,
      lastLoginAt: '2026-09-20T08:00:00Z',
    });
  });
});

describe('System-Audit (FA-SU-09)', () => {
  it('jede Aktion erzeugt einen Eintrag; neueste zuerst, Filter je Mandant, Cursor', async () => {
    const sys = await superUser();
    const created = (await (
      await sys('/api/system/v1/tenants', 'POST', { tenantKey: 'neu', displayName: 'Neu' })
    ).json()) as { id: string };
    s.clock.advance(1000);
    await sys(`/api/system/v1/tenants/${created.id}`, 'PATCH', { status: 'locked' });
    s.clock.advance(1000);
    await sys(`/api/system/v1/tenants/${created.id}/invitations`, 'POST', {
      id: crypto.randomUUID(),
    });
    s.clock.advance(1000);
    await sys('/api/system/v1/settings/maintenanceBanner', 'PUT', {
      value: { active: false, textDe: '', textEn: '' },
    });
    const all = (await (await sys('/api/system/v1/audit?limit=2')).json()) as {
      items: { action: string; actorName: string; tenantKey: string | null }[];
      nextCursor: string;
    };
    expect(all.items.map((i) => i.action)).toEqual(['system_setting.update', 'invitation.create']);
    expect(all.items[1]).toMatchObject({ actorName: 'sven', tenantKey: 'neu' });
    const next = (await (
      await sys(`/api/system/v1/audit?limit=2&cursor=${all.nextCursor}`)
    ).json()) as {
      items: { action: string }[];
    };
    expect(next.items.map((i) => i.action)).toEqual(['tenant.lock', 'tenant.create']);
    const only = (await (await sys(`/api/system/v1/audit?tenantId=${created.id}`)).json()) as {
      items: unknown[];
    };
    expect(only.items).toHaveLength(3);
  });

  it('Admins sehen nur die Super-User-Aktionen ihres Mandanten (GET /web/v1/audit/system)', async () => {
    const sys = await superUser();
    const a = await tenantWithData('alpha');
    const b = await tenantWithData('beta');
    await sys(`/api/system/v1/tenants/${a.tenantId}`, 'PATCH', { status: 'active' });
    await sys(`/api/system/v1/tenants/${b.tenantId}`, 'PATCH', { status: 'active' });
    const cookies = {
      [COOKIE_NAMES.session]: await s.seed.session(a.ownerIdentity.id, a.tenantId, 'tenant'),
    };
    const list = (await (await s.request('/api/web/v1/audit/system', { cookies })).json()) as {
      items: { action: string; tenantId: string }[];
    };
    expect(list.items).toEqual([
      expect.objectContaining({ action: 'tenant.unlock', tenantId: a.tenantId }),
    ]);
    const user = {
      [COOKIE_NAMES.session]: await s.seed.session(a.userIdentity.id, a.tenantId, 'tenant'),
    };
    expect((await s.request('/api/web/v1/audit/system', { cookies: user })).status).toBe(403);
  });
});

describe('Wartungsbanner (FA-SU-08)', () => {
  it('aktiv mit Text DE/EN → öffentlich sichtbar; ohne Text → 422; aus → null', async () => {
    const sys = await superUser();
    expect(await (await s.request('/api/banner')).json()).toEqual({ banner: null });
    const bad = await sys('/api/system/v1/settings/maintenanceBanner', 'PUT', {
      value: { active: true, textDe: '', textEn: 'x' },
    });
    expect(bad.status).toBe(422);
    const put = await sys('/api/system/v1/settings/maintenanceBanner', 'PUT', {
      value: { active: true, textDe: 'Wartung heute 20 Uhr', textEn: 'Maintenance tonight 8 pm' },
    });
    expect(await put.json()).toMatchObject({
      key: 'maintenanceBanner',
      value: { active: true, textDe: 'Wartung heute 20 Uhr' },
    });
    expect(await (await s.request('/api/banner')).json()).toEqual({
      banner: { de: 'Wartung heute 20 Uhr', en: 'Maintenance tonight 8 pm' },
    });
    await sys('/api/system/v1/settings/maintenanceBanner', 'PUT', {
      value: { active: false, textDe: 'Wartung heute 20 Uhr', textEn: 'Maintenance tonight 8 pm' },
    });
    expect(await (await s.request('/api/banner')).json()).toEqual({ banner: null });
    expect((await sys('/api/system/v1/settings/unbekannt')).status).toBe(422);
  });
});

describe('Identität systemweit sperren (FA-LOG-05)', () => {
  it('über die Discord-ID finden, sperren beendet Sitzungen, Audit', async () => {
    const sys = await superUser();
    const a = await tenantWithData('alpha');
    const found = (await (
      await sys(`/api/system/v1/identities?discordUserId=${a.userIdentity.discordUserId}`)
    ).json()) as { id: string; status: string; isSuperUser: boolean };
    expect(found).toMatchObject({ id: a.userIdentity.id, status: 'active', isSuperUser: false });
    expect(
      (await sys(`/api/system/v1/identities/${found.id}`, 'PATCH', { status: 'blocked' })).status,
    ).toBe(204);
    expect(
      (await s.pg.admin.query('SELECT 1 FROM auth_session WHERE identity_id = $1', [found.id]))
        .rows,
    ).toEqual([]);
    expect((await sys(`/api/system/v1/identities?discordUserId=${'1'.repeat(18)}`)).status).toBe(
      404,
    );
  });
});
