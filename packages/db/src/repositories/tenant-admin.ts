/**
 * Systemverwaltung (Super User im System-Kontext bzw. `ops-cli`; TK 5.4, 5.5; FA-SU-01…09). Diese
 * Abfragen sind bewusst mandantenübergreifend – der Aufrufer ist ein Super User ohne fachlichen Zugriff
 * (FA-SU-07): sichtbar sind nur Stammdaten, Anzeigenamen, Rollen und Status. Jede Aktion schreibt
 * `system_audit` (SV-11).
 */
import {
  BUILT_IN_MOON_PROFILES,
  ProblemError,
  SYSTEM_SETTING_SCHEMAS,
  type SystemSettingKey,
} from '@nina-pm/shared';
import { sql, type Kysely, type Transaction } from 'kysely';
import { withTx, type WithTxOptions, retryOcc } from '../tx';
import type { Database } from '../types';
import { insertInvitation, type CreatedInvitation } from './invitations';
import { listSystemAudit, type AuditPage } from './audit';
import { insertNotifications } from './notification';
import { deleteTenantData } from './tenant-delete';

export type SystemActor =
  { readonly kind: 'super_user'; readonly identityId: string } | { readonly kind: 'ops_cli' };

type Trx = Transaction<Database>;

export class TenantAdminRepository {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly actor: SystemActor,
    private readonly txOptions: WithTxOptions = {},
  ) {}

  private async audit(
    trx: Trx | Kysely<Database>,
    action: string,
    tenantId: string | null,
    details: object,
    now: Date,
  ) {
    await trx
      .insertInto('systemAudit')
      .values({
        actor: this.actor.kind,
        superUserId: this.actor.kind === 'super_user' ? this.actor.identityId : null,
        tenantId,
        action,
        details: JSON.stringify(details),
        createdAt: now,
      })
      .execute();
  }

  /** Protokoll ohne Änderung (z. B. `ops-cli help`, SV-11). */
  record(action: string, details: object, now: Date): Promise<void> {
    return this.audit(this.db, action, null, details, now);
  }

  /** Mandant anlegen (FA-MAN-01) inkl. Built-in-Mondprofile; Mandanten-ID schon vergeben → `409 resource.in_use`. */
  createTenant(
    input: { tenantKey: string; displayName: string; contact?: string | undefined },
    now: Date,
  ) {
    return withTx(
      this.db,
      async (trx) => {
        const tenant = await trx
          .insertInto('tenant')
          .values({
            tenantKey: input.tenantKey,
            displayName: input.displayName,
            contact: input.contact ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .onConflict((oc) => oc.column('tenantKey').doNothing())
          .returningAll()
          .executeTakeFirst();
        if (!tenant) throw new ProblemError('resource.in_use');
        await trx
          .insertInto('moonProfile')
          .values(
            BUILT_IN_MOON_PROFILES.map((p) => ({
              ...p,
              tenantId: tenant.id,
              isBuiltIn: true,
              createdAt: now,
            })),
          )
          .execute();
        await this.audit(trx, 'tenant.create', tenant.id, { tenantKey: input.tenantKey }, now);
        return tenant;
      },
      this.txOptions,
    );
  }

  /** Fehlende Built-in-Mondprofile ergänzen (idempotent; `ops-cli seed`). */
  async ensureBuiltInMoonProfiles(tenantId: string, now: Date): Promise<number> {
    const res = await retryOcc(() =>
      this.db
        .insertInto('moonProfile')
        .values(
          BUILT_IN_MOON_PROFILES.map((p) => ({ ...p, tenantId, isBuiltIn: true, createdAt: now })),
        )
        .onConflict((oc) => oc.columns(['tenantId', 'name']).doNothing())
        .executeTakeFirst(),
    );
    return Number(res.numInsertedOrUpdatedRows ?? 0);
  }

  /** Mandantenliste mit Kennzahlen (FA-SU-03); ohne `tenantId` alle, sonst nur dieser. */
  async listTenants(tenantId?: string) {
    let q = this.db
      .selectFrom('tenant as t')
      .select([
        't.id',
        't.tenantKey',
        't.displayName',
        't.contact',
        't.status',
        't.ownerMemberId',
        't.createdAt',
        sql<
          string | null
        >`(SELECT o.display_name FROM app_user o WHERE o.id = t.owner_member_id AND o.tenant_id = t.id)`.as(
          'ownerDisplayName',
        ),
        sql<number>`(SELECT count(*)::int FROM app_user m WHERE m.tenant_id = t.id AND m.status = 'active' AND m.role = 'admin')`.as(
          'admins',
        ),
        sql<number>`(SELECT count(*)::int FROM app_user m WHERE m.tenant_id = t.id AND m.status = 'active' AND m.role = 'user')`.as(
          'users',
        ),
        sql<number>`(SELECT count(*)::int FROM rig r WHERE r.tenant_id = t.id)`.as('rigs'),
        sql<number>`(SELECT count(*)::int FROM nina_instance n WHERE n.tenant_id = t.id AND n.status = 'active')`.as(
          'ninaInstances',
        ),
        sql<Date | null>`(SELECT max(n.last_seen_at) FROM nina_instance n WHERE n.tenant_id = t.id)`.as(
          'ninaLastSeenAt',
        ),
        sql<Date | null>`(SELECT max(m.last_login_at) FROM app_user m WHERE m.tenant_id = t.id)`.as(
          'lastLoginAt',
        ),
        sql<
          string | null
        >`(SELECT s.file_bytes::text FROM tenant_storage s WHERE s.tenant_id = t.id)`.as(
          'storageBytes',
        ),
        sql<number | null>`(SELECT s.file_count FROM tenant_storage s WHERE s.tenant_id = t.id)`.as(
          'storageFileCount',
        ),
        sql<Date | null>`(SELECT s.measured_at FROM tenant_storage s WHERE s.tenant_id = t.id)`.as(
          'storageMeasuredAt',
        ),
      ]);
    if (tenantId) q = q.where('t.id', '=', tenantId);
    const rows = await q.orderBy('t.tenantKey').execute();
    return rows.map((r) => ({
      ...r,
      admins: Number(r.admins),
      users: Number(r.users),
      rigs: Number(r.rigs),
      ninaInstances: Number(r.ninaInstances),
      ninaLastSeenAt: r.ninaLastSeenAt ? new Date(r.ninaLastSeenAt) : null,
      lastLoginAt: r.lastLoginAt ? new Date(r.lastLoginAt) : null,
      storageBytes: r.storageBytes === null ? null : Number(r.storageBytes),
      storageFileCount: r.storageFileCount === null ? null : Number(r.storageFileCount),
      storageMeasuredAt: r.storageMeasuredAt ? new Date(r.storageMeasuredAt) : null,
    }));
  }

  async tenantSummary(tenantId: string) {
    const [row] = await this.listTenants(tenantId);
    if (!row) throw new ProblemError('tenant.not_found');
    return row;
  }

  /**
   * Mandant löschen (FA-MAN-03): nur nach exakter Eingabe der Mandanten-ID (E4), sonst
   * `422 validation.failed`. Sperrt zuerst (keine Anmeldung, keine NINA-Daten mehr), löscht dann
   * stapelweise und zuletzt die `tenant`-Zeile; das System-Audit behält den Vorgang ohne Fremdschlüssel.
   */
  async deleteTenant(tenantId: string, confirmTenantKey: string, now: Date) {
    const tenant = await this.tenantById(tenantId);
    if (!tenant) throw new ProblemError('tenant.not_found');
    if (confirmTenantKey.trim() !== tenant.tenantKey)
      throw new ProblemError('validation.failed', [
        { path: 'confirmTenantKey', message: 'Mandanten-ID stimmt nicht überein' },
      ]);
    if (tenant.status !== 'locked')
      await retryOcc(() =>
        this.db
          .updateTable('tenant')
          .set({ status: 'locked', updatedAt: now })
          .where('id', '=', tenantId)
          .execute(),
      );
    const rows = await deleteTenantData(this.db, tenant, this.txOptions);
    await withTx(
      this.db,
      async (trx) => {
        await trx.deleteFrom('tenant').where('id', '=', tenantId).execute();
        await this.audit(
          trx,
          'tenant.delete',
          null,
          { tenantId, tenantKey: tenant.tenantKey, displayName: tenant.displayName, rows },
          now,
        );
      },
      this.txOptions,
    );
    return rows;
  }

  /** System-Audit (FA-SU-09), neueste zuerst; optional auf einen Mandanten gefiltert. */
  listAudit(page: AuditPage & { tenantId?: string | undefined }) {
    return listSystemAudit(this.db, page);
  }

  async getSetting(key: SystemSettingKey) {
    const row = await this.db
      .selectFrom('systemSetting')
      .select(['key', 'value', 'updatedAt'])
      .where('key', '=', key)
      .executeTakeFirst();
    return { key, value: row?.value ?? null, updatedAt: row?.updatedAt ?? null };
  }

  /** Systemweite Einstellung setzen (FA-SU-08); Wert je Schlüssel gegen sein Schema geprüft. */
  async putSetting(key: SystemSettingKey, value: unknown, now: Date) {
    const parsed = SYSTEM_SETTING_SCHEMAS[key].safeParse(value);
    if (!parsed.success)
      throw new ProblemError(
        'validation.failed',
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    const json = JSON.stringify(parsed.data);
    const updatedBy = this.actor.kind === 'super_user' ? this.actor.identityId : null;
    await withTx(
      this.db,
      async (trx) => {
        await trx
          .insertInto('systemSetting')
          .values({ key, value: json, updatedBy, updatedAt: now })
          .onConflict((oc) =>
            oc.column('key').doUpdateSet({ value: json, updatedBy, updatedAt: now }),
          )
          .execute();
        await this.audit(trx, 'system_setting.update', null, { key, value: parsed.data }, now);
      },
      this.txOptions,
    );
    return this.getSetting(key);
  }

  /** Identität für das Sperren nachschlagen (FA-LOG-05) – nur Discord-Stammdaten. */
  async identityByDiscordId(discordUserId: string) {
    const row = await this.db
      .selectFrom('identity as i')
      .leftJoin('superUser as s', 's.identityId', 'i.id')
      .select([
        'i.id',
        'i.discordUserId',
        'i.discordUsername',
        'i.discordGlobalName',
        'i.status',
        'i.lastLoginAt',
        's.identityId as superUserId',
      ])
      .where('i.discordUserId', '=', discordUserId)
      .executeTakeFirst();
    if (!row) throw new ProblemError('resource.not_found');
    return row;
  }

  tenantById(tenantId: string) {
    return this.db.selectFrom('tenant').selectAll().where('id', '=', tenantId).executeTakeFirst();
  }

  tenantByKey(tenantKey: string) {
    return this.db
      .selectFrom('tenant')
      .selectAll()
      .where('tenantKey', '=', tenantKey)
      .executeTakeFirst();
  }

  async setTenantStatus(tenantId: string, status: 'active' | 'locked', now: Date) {
    return withTx(
      this.db,
      async (trx) => {
        const row = await trx
          .updateTable('tenant')
          .set({ status, updatedAt: now })
          .where('id', '=', tenantId)
          .returningAll()
          .executeTakeFirst();
        if (!row) throw new ProblemError('tenant.not_found');
        await this.audit(
          trx,
          status === 'locked' ? 'tenant.lock' : 'tenant.unlock',
          tenantId,
          {},
          now,
        );
        return row;
      },
      this.txOptions,
    );
  }

  /** Mitglieder für die Owner-Neuzuweisung – nur Anzeigename, Rolle, Status (TK 5.4). */
  async listMembers(tenantId: string) {
    const rows = await this.db
      .selectFrom('appUser as m')
      .innerJoin('tenant as t', 't.id', 'm.tenantId')
      .select(['m.id', 'm.displayName', 'm.role', 'm.status', 't.ownerMemberId'])
      .where('m.tenantId', '=', tenantId)
      .where('m.status', '!=', 'removed')
      .orderBy('m.displayName')
      .execute();
    return rows.map(({ ownerMemberId, ...r }) => ({
      ...r,
      role: ownerMemberId === r.id ? ('owner' as const) : r.role,
    }));
  }

  /** Owner-Einladung (FA-SU-05): eine Nutzung, optional an eine Discord-ID gebunden, keine Sonderregeln (E3). */
  createOwnerInvitation(
    tenantId: string,
    inv: { id: string; discordUserId?: string | undefined; validDays: number },
    now: Date,
  ): Promise<CreatedInvitation> {
    return this.createInvitation(tenantId, 'owner', inv, now);
  }

  /** Owner- bzw. Admin-Einladung aus dem System (`ops-cli create-invitation --role owner|admin`). */
  createInvitation(
    tenantId: string,
    role: 'owner' | 'admin',
    inv: { id: string; discordUserId?: string | undefined; validDays: number },
    now: Date,
  ): Promise<CreatedInvitation> {
    return withTx(
      this.db,
      async (trx) => {
        const tenant = await trx
          .selectFrom('tenant')
          .select('id')
          .where('id', '=', tenantId)
          .executeTakeFirst();
        if (!tenant) throw new ProblemError('tenant.not_found');
        const created = await insertInvitation(trx, {
          ...inv,
          tenantId,
          role,
          createdBySuper: this.actor.kind === 'super_user' ? this.actor.identityId : null,
          now,
        });
        await this.audit(
          trx,
          'invitation.create',
          tenantId,
          { role, invitationId: created.id, discordUserId: inv.discordUserId ?? null },
          now,
        );
        return created;
      },
      this.txOptions,
    );
  }

  /**
   * Notfall-Neuzuweisung (FA-SU-05, TK 5.5): an ein aktives Mitglied (wird Admin) oder per neuer
   * Owner-Einladung (Owner bis zur Annahme leer). Der bisherige Owner wird standardmäßig deaktiviert.
   * Benachrichtigt alle Admins einschließlich des bisherigen Owners.
   */
  reassignOwner(
    tenantId: string,
    req:
      | { memberId: string; reason: string; keepPreviousAsAdmin: boolean }
      | {
          invite: { id: string; discordUserId?: string | undefined; validDays: number };
          reason: string;
          keepPreviousAsAdmin: boolean;
        },
    now: Date,
  ): Promise<{ invitation?: CreatedInvitation }> {
    return withTx(
      this.db,
      async (trx) => {
        const tenant = await trx
          .selectFrom('tenant')
          .selectAll()
          .where('id', '=', tenantId)
          .forUpdate()
          .executeTakeFirst();
        if (!tenant) throw new ProblemError('tenant.not_found');
        const previous = tenant.ownerMemberId;
        let newOwner: string | null = null;
        let invitation: CreatedInvitation | undefined;
        if ('memberId' in req) {
          const target = await trx
            .selectFrom('appUser')
            .select(['id', 'role', 'status'])
            .where('id', '=', req.memberId)
            .where('tenantId', '=', tenantId)
            .executeTakeFirst();
          if (!target || target.status !== 'active' || target.id === previous)
            throw new ProblemError('owner_transfer.target_invalid');
          if (target.role !== 'admin')
            await trx
              .updateTable('appUser')
              .set({ role: 'admin', updatedAt: now })
              .where('id', '=', target.id)
              .execute();
          newOwner = target.id;
        } else {
          invitation = await insertInvitation(trx, {
            ...req.invite,
            tenantId,
            role: 'owner',
            createdBySuper: this.actor.kind === 'super_user' ? this.actor.identityId : null,
            now,
          });
        }
        await trx
          .updateTable('tenant')
          .set({ ownerMemberId: newOwner, updatedAt: now })
          .where('id', '=', tenantId)
          .execute();
        if (previous && !req.keepPreviousAsAdmin) {
          await trx
            .updateTable('appUser')
            .set({ status: 'disabled', updatedAt: now })
            .where('id', '=', previous)
            .execute();
          await trx
            .deleteFrom('authSession')
            .where('tenantId', '=', tenantId)
            .where(
              'identityId',
              '=',
              sql<string>`(SELECT identity_id FROM app_user WHERE id = ${previous})`,
            )
            .execute();
        }
        await trx
          .insertInto('changeLog')
          .values({
            tenantId,
            entity: 'tenant',
            entityId: tenantId,
            userId: null,
            action: 'update',
            diff: JSON.stringify({
              ownerMemberId: { from: previous, to: newOwner },
              by: 'super_user',
              reason: req.reason,
              previousDisabled: Boolean(previous && !req.keepPreviousAsAdmin),
            }),
            createdAt: now,
          })
          .execute();
        const admins = await trx
          .selectFrom('appUser')
          .select('id')
          .where('tenantId', '=', tenantId)
          .where('role', '=', 'admin')
          .where('status', '=', 'active')
          .execute();
        const recipients = [
          ...new Set([...admins.map((a) => a.id), ...(previous ? [previous] : [])]),
        ];
        await insertNotifications(trx, {
          tenantId,
          recipients,
          kind: 'owner.reassigned',
          payload: { from: previous, to: newOwner, by: 'super_user', reason: req.reason },
          now,
        });
        await this.audit(
          trx,
          'tenant.owner.reassign',
          tenantId,
          {
            from: previous,
            to: newOwner,
            invitationId: invitation?.id ?? null,
            reason: req.reason,
          },
          now,
        );
        return invitation ? { invitation } : {};
      },
      this.txOptions,
    );
  }

  async listSuperUsers() {
    return this.db
      .selectFrom('superUser as s')
      .innerJoin('identity as i', 'i.id', 's.identityId')
      .select([
        's.identityId',
        'i.discordUserId',
        'i.discordUsername',
        's.status',
        'i.mfaEnabled',
        's.createdAt',
      ])
      .orderBy('s.createdAt')
      .execute();
  }

  /** Super User hinzufügen (FA-SU-06): die Identität muss sich einmal angemeldet haben. */
  addSuperUser(discordUserId: string, now: Date) {
    return withTx(
      this.db,
      async (trx) => {
        const identity = await trx
          .selectFrom('identity')
          .select('id')
          .where('discordUserId', '=', discordUserId)
          .executeTakeFirst();
        if (!identity) throw new ProblemError('resource.not_found');
        await trx
          .insertInto('superUser')
          .values({
            identityId: identity.id,
            createdBy: this.actor.kind === 'super_user' ? this.actor.identityId : null,
            createdAt: now,
          })
          .onConflict((oc) => oc.column('identityId').doUpdateSet({ status: 'active' }))
          .execute();
        await this.audit(trx, 'super_user.add', null, { discordUserId }, now);
        return identity.id;
      },
      this.txOptions,
    );
  }

  /**
   * Status ändern bzw. entfernen mit Invariante „mindestens ein aktiver Super User“ (FA-SU-06):
   * alle aktiven Zeilen werden per `FOR UPDATE` in die Konfliktprüfung genommen.
   */
  changeSuperUser(
    identityId: string,
    change: { status: 'active' | 'disabled' } | 'delete',
    now: Date,
  ): Promise<void> {
    return withTx(
      this.db,
      async (trx) => {
        const active = await trx
          .selectFrom('superUser')
          .select('identityId')
          .where('status', '=', 'active')
          .orderBy('identityId')
          .forUpdate()
          .execute();
        const row = await trx
          .selectFrom('superUser')
          .select(['identityId', 'status'])
          .where('identityId', '=', identityId)
          .executeTakeFirst();
        if (!row) throw new ProblemError('resource.not_found');
        const leavesActive = change === 'delete' || change.status !== 'active';
        if (leavesActive && row.status === 'active' && active.length <= 1)
          throw new ProblemError('super_user.last_protected');
        // „Entfernen“ deaktiviert: system_audit, invitation und super_user.created_by verweisen per FK
        // auf die Zeile, und das System-Audit soll den Akteur behalten (SV-11).
        await trx
          .updateTable('superUser')
          .set({ status: change === 'delete' ? 'disabled' : change.status })
          .where('identityId', '=', identityId)
          .execute();
        if (leavesActive) {
          await trx
            .deleteFrom('authSession')
            .where('identityId', '=', identityId)
            .where('context', '=', 'system')
            .execute();
        }
        await this.audit(
          trx,
          change === 'delete' ? 'super_user.remove' : `super_user.${change.status}`,
          null,
          { identityId },
          now,
        );
      },
      this.txOptions,
    );
  }

  /** Identität systemweit sperren/entsperren (FA-LOG-05); Sperre beendet alle Sitzungen. */
  setIdentityStatus(
    identity: { id: string } | { discordUserId: string },
    status: 'active' | 'blocked',
    now: Date,
  ): Promise<string> {
    return withTx(
      this.db,
      async (trx) => {
        const row = await trx
          .updateTable('identity')
          .set({ status, updatedAt: now })
          .where(
            'id' in identity ? 'id' : 'discordUserId',
            '=',
            'id' in identity ? identity.id : identity.discordUserId,
          )
          .returning('id')
          .executeTakeFirst();
        if (!row) throw new ProblemError('resource.not_found');
        if (status === 'blocked')
          await trx.deleteFrom('authSession').where('identityId', '=', row.id).execute();
        await this.audit(
          trx,
          status === 'blocked' ? 'identity.block' : 'identity.unblock',
          null,
          { identityId: row.id },
          now,
        );
        return row.id;
      },
      this.txOptions,
    );
  }

  /** Alle Sitzungen einer Identität beenden (`ops-cli revoke-sessions`, TK 5.3). */
  revokeSessions(identity: { id: string } | { discordUserId: string }, now: Date): Promise<number> {
    return withTx(
      this.db,
      async (trx) => {
        const row = await trx
          .selectFrom('identity')
          .select('id')
          .where(
            'id' in identity ? 'id' : 'discordUserId',
            '=',
            'id' in identity ? identity.id : identity.discordUserId,
          )
          .executeTakeFirst();
        if (!row) throw new ProblemError('resource.not_found');
        const res = await trx
          .deleteFrom('authSession')
          .where('identityId', '=', row.id)
          .executeTakeFirst();
        await this.audit(
          trx,
          'sessions.revoke',
          null,
          { identityId: row.id, count: Number(res.numDeletedRows) },
          now,
        );
        return Number(res.numDeletedRows);
      },
      this.txOptions,
    );
  }

  /** Owner direkt setzen (`ops-cli set-owner`) – gleiche Regeln wie die Neuzuweisung an ein Mitglied. */
  setOwner(tenantId: string, memberId: string, now: Date) {
    return this.reassignOwner(
      tenantId,
      { memberId, reason: 'ops-cli set-owner', keepPreviousAsAdmin: false },
      now,
    );
  }
}

/** Wartung im `worker` (TK 13, `daily`): abgelaufene Einladungen in Stapeln löschen (app_job: SELECT, DELETE). */
export async function deleteExpiredInvitations(
  db: Kysely<Database>,
  now: Date,
  batch = 2500,
): Promise<number> {
  let total = 0;
  for (;;) {
    const res = await db
      .deleteFrom('invitation')
      .where(
        'id',
        'in',
        db.selectFrom('invitation').select('id').where('expiresAt', '<', now).limit(batch),
      )
      .executeTakeFirst();
    const n = Number(res.numDeletedRows);
    total += n;
    if (n < batch) return total;
  }
}
