/**
 * Mitglieder, Einladungen und Owner-Invarianten im Mandanten (TK 5.5, FA-BEN-01…10, E2). Jede
 * Änderung läuft in einer Transaktion mit Wächter auf der `tenant`-Zeile (`SELECT … FOR UPDATE`,
 * OCC-Retry), damit parallele Rollen-/Owner-Änderungen die Invarianten nicht gemeinsam brechen:
 * `tenant.owner_member_id` zeigt immer auf ein aktives Mitglied mit `role='admin'`.
 */
import { ProblemError, type ResourceMeta } from '@nina-pm/shared';
import type { Kysely, Selectable, Transaction } from 'kysely';
import { withTx, type WithTxOptions } from '../tx';
import type { AppUserTable, Database } from '../types';
import { TenantRepo, type TenantContext } from './base';
import { insertInvitation, type CreatedInvitation } from './invitations';

export type Member = Selectable<AppUserTable>;

export interface MemberWithIdentity extends Member {
  readonly discordUsername: string;
  readonly avatarHash: string | null;
  readonly mfaEnabled: boolean;
  readonly isOwner: boolean;
}

/** Wird innerhalb der Transaktion nach den Invarianten aufgerufen; wirft `permission.denied`. */
export type TargetCheck = (target: ResourceMeta & { targetRole: 'admin' | 'user' }) => void;

type Trx = Transaction<Database>;

export class MemberRepository extends TenantRepo {
  constructor(
    db: Kysely<Database>,
    ctx: TenantContext,
    private readonly txOptions: WithTxOptions = {},
  ) {
    super(db, ctx);
  }

  private tx<T>(fn: (trx: Trx) => Promise<T>): Promise<T> {
    return withTx(this.db, fn, {
      ...this.txOptions,
      guard: [{ table: 'tenant', id: this.ctx.tenantId }],
    });
  }

  private async ownerId(trx: Trx): Promise<string | null> {
    const t = await trx
      .selectFrom('tenant')
      .select('ownerMemberId')
      .where('id', '=', this.ctx.tenantId)
      .executeTakeFirstOrThrow();
    return t.ownerMemberId;
  }

  private async target(trx: Trx, memberId: string): Promise<Member> {
    const m = await trx
      .selectFrom('appUser')
      .selectAll()
      .where('id', '=', memberId)
      .where('tenantId', '=', this.ctx.tenantId)
      .where('status', '!=', 'removed')
      .executeTakeFirst();
    if (!m) throw new ProblemError('resource.not_found');
    return m;
  }

  private actor(): string {
    if (!this.ctx.memberId) throw new Error('MemberRepository ohne handelndes Mitglied');
    return this.ctx.memberId;
  }

  private async log(
    trx: Trx,
    entityId: string,
    action: string,
    diff: object,
    now: Date,
    entity = 'app_user',
  ) {
    await trx
      .insertInto('changeLog')
      .values({
        tenantId: this.ctx.tenantId,
        entity,
        entityId,
        userId: this.ctx.memberId ?? null,
        action,
        diff: JSON.stringify(diff),
        createdAt: now,
      })
      .execute();
  }

  private async notify(
    trx: Trx,
    recipients: readonly string[],
    kind: string,
    payload: object,
    now: Date,
  ) {
    const unique = [...new Set(recipients)];
    if (unique.length === 0) return;
    await trx
      .insertInto('notification')
      .values(
        unique.map((recipientId) => ({
          tenantId: this.ctx.tenantId,
          recipientId,
          kind,
          payload: JSON.stringify(payload),
          createdAt: now,
        })),
      )
      .execute();
  }

  private async activeAdmins(trx: Trx): Promise<string[]> {
    const rows = await trx
      .selectFrom('appUser')
      .select('id')
      .where('tenantId', '=', this.ctx.tenantId)
      .where('role', '=', 'admin')
      .where('status', '=', 'active')
      .execute();
    return rows.map((r) => r.id);
  }

  /** Mitgliederliste (FA-BEN-04) ohne entfernte Mitglieder. */
  async list(): Promise<MemberWithIdentity[]> {
    const rows = await this.db
      .selectFrom('appUser as m')
      .innerJoin('identity as i', 'i.id', 'm.identityId')
      .innerJoin('tenant as t', 't.id', 'm.tenantId')
      .selectAll('m')
      .select(['i.discordUsername', 'i.avatarHash', 'i.mfaEnabled', 't.ownerMemberId'])
      .where('m.tenantId', '=', this.ctx.tenantId)
      .where('m.status', '!=', 'removed')
      .orderBy('m.displayName')
      .execute();
    return rows.map(({ ownerMemberId, ...r }) => ({ ...r, isOwner: ownerMemberId === r.id }));
  }

  async byId(memberId: string): Promise<(Member & { isOwner: boolean }) | undefined> {
    const row = await this.db
      .selectFrom('appUser as m')
      .innerJoin('tenant as t', 't.id', 'm.tenantId')
      .selectAll('m')
      .select('t.ownerMemberId')
      .where('m.id', '=', memberId)
      .where('m.tenantId', '=', this.ctx.tenantId)
      .executeTakeFirst();
    if (!row) return undefined;
    const { ownerMemberId, ...m } = row;
    return { ...m, isOwner: ownerMemberId === m.id };
  }

  /** Einladung anlegen; `user` über `member.manage`, `admin` nur der Owner (SEC-50) – die Route legt die Rolle fest. */
  createInvitation(
    inv: {
      id: string;
      role: 'admin' | 'user';
      discordUserId?: string | undefined;
      maxUses?: number | undefined;
      validDays: number;
      note?: string | undefined;
    },
    now: Date,
  ): Promise<CreatedInvitation> {
    return this.tx(async (trx) => {
      if (inv.role === 'admin' && (await this.ownerId(trx)) !== this.actor())
        throw new ProblemError('permission.denied');
      const created = await insertInvitation(trx, {
        ...inv,
        tenantId: this.ctx.tenantId,
        createdByMember: this.actor(),
        now,
      });
      await this.log(
        trx,
        created.id,
        'create',
        { role: inv.role, discordUserId: inv.discordUserId ?? null },
        now,
        'invitation',
      );
      return created;
    });
  }

  async listInvitations() {
    const rows = await this.db
      .selectFrom('invitation as v')
      .innerJoin('tenant as t', 't.id', 'v.tenantId')
      .select([
        'v.id',
        'v.role',
        'v.discordUserId',
        'v.note',
        'v.maxUses',
        'v.usedCount',
        'v.expiresAt',
        'v.revokedAt',
        'v.createdAt',
        'v.createdByMember',
        'v.createdBySuper',
        't.ownerMemberId',
      ])
      .where('v.tenantId', '=', this.ctx.tenantId)
      .orderBy('v.createdAt', 'desc')
      .execute();
    return rows.map(({ createdByMember, createdBySuper, ownerMemberId, ...r }) => ({
      ...r,
      // Admin-/Owner-Einladungen und Einladungen des Owners bzw. Super Users widerruft nur der Owner (FA-BEN-08).
      ownerOnly:
        r.role !== 'user' ||
        createdBySuper !== null ||
        (createdByMember !== null && createdByMember === ownerMemberId),
    }));
  }

  /** Widerruf (FA-BEN-01); `ownerOnly`-Einladungen nur durch den Owner. */
  revokeInvitation(id: string, now: Date): Promise<void> {
    return this.tx(async (trx) => {
      const all = await this.listInvitations();
      const inv = all.find((i) => i.id === id);
      if (!inv) throw new ProblemError('resource.not_found');
      if (inv.ownerOnly && (await this.ownerId(trx)) !== this.actor())
        throw new ProblemError('permission.denied');
      if (inv.revokedAt === null) {
        await trx
          .updateTable('invitation')
          .set({ revokedAt: now })
          .where('id', '=', id)
          .where('tenantId', '=', this.ctx.tenantId)
          .execute();
        await this.log(trx, id, 'delete', { revoked: true }, now, 'invitation');
      }
    });
  }

  /** Anzeigename bzw. Status (aktiv/deaktiviert) ändern (FA-BEN-02, FA-BEN-08). */
  updateMember(
    memberId: string,
    patch: { displayName?: string | undefined; status?: 'active' | 'disabled' | undefined },
    check: TargetCheck,
    now: Date,
  ): Promise<Member> {
    return this.tx(async (trx) => {
      const target = await this.target(trx, memberId);
      const owner = await this.ownerId(trx);
      const self = memberId === this.actor();
      if (self && patch.status !== undefined && patch.status !== target.status)
        throw new ProblemError('member.cannot_change_self');
      if (!self) {
        if (memberId === owner) throw new ProblemError('member.owner_protected');
        check({
          tenantId: this.ctx.tenantId,
          targetMemberId: memberId,
          targetRole: target.role,
          targetIsOwner: false,
        });
      }
      const set: Partial<{ displayName: string; status: 'active' | 'disabled'; updatedAt: Date }> =
        { updatedAt: now };
      const diff: Record<string, { from: unknown; to: unknown }> = {};
      if (patch.displayName !== undefined && patch.displayName !== target.displayName) {
        set.displayName = patch.displayName;
        diff.displayName = { from: target.displayName, to: patch.displayName };
      }
      if (patch.status !== undefined && patch.status !== target.status) {
        set.status = patch.status;
        diff.status = { from: target.status, to: patch.status };
      }
      if (Object.keys(diff).length === 0) return target;
      const updated = await trx
        .updateTable('appUser')
        .set(set)
        .where('id', '=', memberId)
        .where('tenantId', '=', this.ctx.tenantId)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.log(trx, memberId, diff.status ? 'status_change' : 'update', diff, now);
      return updated;
    });
  }

  /** Entfernen (FA-BEN-02): Status `removed`, Sitzungen im Mandanten enden; Owner geschützt. */
  removeMember(memberId: string, check: TargetCheck, now: Date): Promise<void> {
    return this.tx(async (trx) => {
      const target = await this.target(trx, memberId);
      if (memberId === this.actor()) throw new ProblemError('member.cannot_change_self');
      if (memberId === (await this.ownerId(trx))) throw new ProblemError('member.owner_protected');
      check({
        tenantId: this.ctx.tenantId,
        targetMemberId: memberId,
        targetRole: target.role,
        targetIsOwner: false,
      });
      await this.markRemoved(trx, target, now);
    });
  }

  private async markRemoved(trx: Trx, target: Member, now: Date) {
    await trx
      .updateTable('appUser')
      .set({ status: 'removed', updatedAt: now })
      .where('id', '=', target.id)
      .where('tenantId', '=', this.ctx.tenantId)
      .execute();
    await trx
      .deleteFrom('authSession')
      .where('identityId', '=', target.identityId)
      .where('tenantId', '=', this.ctx.tenantId)
      .execute();
    await this.log(
      trx,
      target.id,
      'delete',
      { status: { from: target.status, to: 'removed' } },
      now,
    );
  }

  /** Admin ernennen oder entziehen – nur der Owner (E2); niemand ändert die eigene Rolle. */
  changeRole(
    memberId: string,
    role: 'admin' | 'user',
    reason: string | undefined,
    check: TargetCheck,
    now: Date,
  ): Promise<Member> {
    return this.tx(async (trx) => {
      const target = await this.target(trx, memberId);
      if (memberId === this.actor()) throw new ProblemError('member.cannot_change_self');
      if (memberId === (await this.ownerId(trx))) throw new ProblemError('member.owner_protected');
      check({
        tenantId: this.ctx.tenantId,
        targetMemberId: memberId,
        targetRole: target.role,
        targetIsOwner: false,
      });
      if (target.role === role) return target;
      const updated = await trx
        .updateTable('appUser')
        .set({ role, updatedAt: now })
        .where('id', '=', memberId)
        .where('tenantId', '=', this.ctx.tenantId)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.log(
        trx,
        memberId,
        'role_change',
        { role: { from: target.role, to: role }, ...(reason ? { reason } : {}) },
        now,
      );
      await this.notify(trx, [memberId], 'role.changed', { from: target.role, to: role }, now);
      return updated;
    });
  }

  /** Mandant verlassen (FA-BEN-10); nicht für den Owner. */
  leave(now: Date): Promise<void> {
    return this.tx(async (trx) => {
      const me = await this.target(trx, this.actor());
      if (me.id === (await this.ownerId(trx))) throw new ProblemError('member.owner_cannot_leave');
      await this.markRemoved(trx, me, now);
    });
  }

  /** Eigene Sitzungen eines Mitglieds in diesem Mandanten beenden (nie für den Owner). */
  revokeSessions(memberId: string, check: TargetCheck): Promise<number> {
    return this.tx(async (trx) => {
      const target = await this.target(trx, memberId);
      if (memberId !== this.actor() && memberId === (await this.ownerId(trx)))
        throw new ProblemError('member.owner_protected');
      check({
        tenantId: this.ctx.tenantId,
        targetMemberId: memberId,
        targetRole: target.role,
        targetIsOwner: false,
      });
      const res = await trx
        .deleteFrom('authSession')
        .where('identityId', '=', target.identityId)
        .where('tenantId', '=', this.ctx.tenantId)
        .executeTakeFirst();
      return Number(res.numDeletedRows);
    });
  }

  /**
   * Owner-Übertragung **sofort** (E2, FA-BEN-09): nur der amtierende Owner, Ziel aktives Mitglied mit
   * Rolle Admin (sonst `422 owner_transfer.target_invalid`). Der alte Owner bleibt Admin.
   */
  transferOwner(memberId: string, now: Date): Promise<void> {
    return this.tx(async (trx) => {
      const owner = await this.ownerId(trx);
      if (owner !== this.actor()) throw new ProblemError('permission.denied');
      const target = await trx
        .selectFrom('appUser')
        .select(['id', 'role', 'status'])
        .where('id', '=', memberId)
        .where('tenantId', '=', this.ctx.tenantId)
        .executeTakeFirst();
      if (!target || target.id === owner || target.role !== 'admin' || target.status !== 'active') {
        throw new ProblemError('owner_transfer.target_invalid');
      }
      await trx
        .updateTable('tenant')
        .set({ ownerMemberId: memberId, updatedAt: now })
        .where('id', '=', this.ctx.tenantId)
        .execute();
      await this.log(
        trx,
        this.ctx.tenantId,
        'update',
        { ownerMemberId: { from: owner, to: memberId } },
        now,
        'tenant',
      );
      await this.notify(
        trx,
        await this.activeAdmins(trx),
        'owner.reassigned',
        { from: owner, to: memberId, by: 'owner' },
        now,
      );
    });
  }
}
