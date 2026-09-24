/** FA-BEN-11 und FA-BEN-04: Folgen beim Entfernen/Verlassen, Objektzählung in der Mitgliederliste (AP-07b). */
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
  const userIdentity = await s.seed.identity();
  const user = await s.seed.member(userIdentity.id, tenantId, 'user');
  const q = s.pg.admin.query.bind(s.pg.admin);
  const project = async (status: string, rank: number | null = null) =>
    (
      await q(
        `INSERT INTO project (tenant_id, created_by, name, approval_status, status, submitter_rank)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [tenantId, user, `P ${status}`, status, status === 'approved' ? 'planning' : null, rank],
      )
    ).rows[0] as { id: string };
  const draft = await project('draft');
  const returned = await project('returned');
  const submitted = await project('submitted', 1);
  const approved = await project('approved');
  await q(
    "INSERT INTO change_request (tenant_id, project_id, requested_by, proposal, base_version) VALUES ($1, $2, $3, '{}', 1)",
    [tenantId, approved.id, user],
  );
  const cookies = (identityId: string) =>
    s.seed.session(identityId, tenantId, 'tenant').then((sid) => ({ [COOKIE_NAMES.session]: sid }));
  return {
    tenantId,
    owner,
    user,
    ownerIdentity,
    userIdentity,
    draft,
    returned,
    submitted,
    approved,
    cookies,
    q,
  };
}

describe('FA-BEN-04: Objekte je Mitglied', () => {
  it('Mitgliederliste zählt Entwürfe, eingereichte und freigegebene Objekte', async () => {
    const t = await setup();
    const res = await s.request('/api/web/v1/members', {
      cookies: await t.cookies(t.ownerIdentity.id),
    });
    const { members } = (await res.json()) as {
      members: { id: string; objects: Record<string, number> }[];
    };
    expect(members.find((m) => m.id === t.user)?.objects).toEqual({
      draft: 1,
      submitted: 1,
      approved: 1,
    });
  });
});

describe('FA-BEN-11: Folgen beim Entfernen und Verlassen', () => {
  for (const how of ['entfernen', 'verlassen'] as const) {
    it(`${how}: Entwurf/Zurückgegeben weich gelöscht, Rang entfällt, Änderungsantrag zurückgezogen`, async () => {
      const t = await setup();
      const res =
        how === 'entfernen'
          ? await s.request(`/api/web/v1/members/${t.user}`, {
              method: 'DELETE',
              cookies: await t.cookies(t.ownerIdentity.id),
            })
          : await s.request('/api/web/v1/me/leave', {
              method: 'POST',
              cookies: await t.cookies(t.userIdentity.id),
            });
      expect(res.status).toBe(204);
      const rows = (
        await t.q('SELECT id, deleted_at, submitter_rank FROM project WHERE tenant_id = $1', [
          t.tenantId,
        ])
      ).rows as { id: string; deleted_at: Date | null; submitter_rank: number | null }[];
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get(t.draft.id)?.deleted_at).not.toBeNull();
      expect(byId.get(t.returned.id)?.deleted_at).not.toBeNull();
      expect(byId.get(t.submitted.id)).toMatchObject({ deleted_at: null, submitter_rank: null });
      expect(byId.get(t.approved.id)?.deleted_at).toBeNull();
      expect(
        (await t.q('SELECT status FROM change_request WHERE requested_by = $1', [t.user])).rows,
      ).toEqual([{ status: 'withdrawn' }]);
    });
  }

  it('Deaktivieren lässt Objekte unverändert', async () => {
    const t = await setup();
    const res = await s.request(`/api/web/v1/members/${t.user}`, {
      method: 'PATCH',
      body: { status: 'disabled' },
      cookies: await t.cookies(t.ownerIdentity.id),
    });
    expect(res.status).toBe(204);
    expect(
      (await t.q('SELECT count(*)::int AS n FROM project WHERE deleted_at IS NOT NULL', [])).rows,
    ).toEqual([{ n: 0 }]);
  });
});
