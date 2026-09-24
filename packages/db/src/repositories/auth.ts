/**
 * Anmeldung und Sitzungen (TK 5.2–5.4, SV-01). Diese Abfragen liegen **vor** der Mandantenwahl und sind
 * deshalb an Sitzung bzw. Identität gebunden statt an `tenant_id` (bewusste Ausnahme von TK 6.7):
 * jede Methode filtert nach `session_hash`, `identity_id` oder dem Token-Hash einer Einladung.
 */
import {
  ProblemError,
  SESSION_IDLE_DAYS,
  SESSION_MAX_DAYS,
  SESSION_TOUCH_INTERVAL_MS,
} from '@nina-pm/shared';
import { sql, type Kysely, type Selectable } from 'kysely';
import { isOccConflict, withTx, type WithTxOptions } from '../tx';
import type { AuthSessionTable, Database, IdentityTable } from '../types';

const DAY_MS = 86_400_000;

export type Identity = Selectable<IdentityTable>;
export type AuthSession = Selectable<AuthSessionTable>;

/** Ergebnis der **einen** Abfrage je Anfrage (TK 5.3). */
export interface SessionRow {
  readonly sessionId: string;
  readonly identityId: string;
  readonly tenantId: string | null;
  readonly context: 'tenant' | 'system' | 'select';
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly expiresAt: Date;
  readonly identityStatus: 'active' | 'blocked';
  readonly mfaEnabled: boolean;
  readonly memberId: string | null;
  readonly memberRole: 'admin' | 'user' | null;
  readonly memberStatus: 'active' | 'disabled' | 'removed' | null;
  readonly tenantStatus: 'active' | 'locked' | null;
  readonly ownerMemberId: string | null;
  readonly superUserStatus: 'active' | 'disabled' | null;
}

export interface DiscordProfile {
  readonly discordUserId: string;
  readonly username: string;
  readonly globalName: string | null;
  readonly avatarHash: string | null;
  readonly mfaEnabled: boolean;
}

export interface Membership {
  readonly memberId: string;
  readonly tenantId: string;
  readonly tenantKey: string;
  readonly tenantName: string;
  readonly displayName: string;
  readonly role: 'admin' | 'user';
  readonly isOwner: boolean;
}

export interface NewSession {
  readonly sessionHash: string;
  readonly identityId: string;
  readonly tenantId: string | null;
  readonly context: 'tenant' | 'system' | 'select';
  readonly userAgent: string | null;
  readonly ipTruncated: string | null;
  readonly now: Date;
}

export interface ClaimableInvitation {
  readonly id: string;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly role: 'owner' | 'admin' | 'user';
  readonly expiresAt: Date;
}

/** Sitzung gültig: `last_seen_at > jetzt − 14 Tage` und `expires_at > jetzt` (TK 5.3). */
export function sessionAlive(
  row: Pick<SessionRow, 'lastSeenAt' | 'expiresAt'>,
  now: Date,
): boolean {
  return (
    new Date(row.expiresAt).getTime() > now.getTime() &&
    new Date(row.lastSeenAt).getTime() > now.getTime() - SESSION_IDLE_DAYS * DAY_MS
  );
}

export class AuthRepository {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly txOptions: WithTxOptions = {},
  ) {}

  /** Sitzung + Mitgliedschaft + Identität + Mandant + Super User in **einer** indizierten Abfrage, ohne Cache. */
  async resolveSession(sessionHash: string): Promise<SessionRow | undefined> {
    const row = await this.db
      .selectFrom('authSession as s')
      .innerJoin('identity as i', 'i.id', 's.identityId')
      .leftJoin('appUser as m', (j) =>
        j.onRef('m.identityId', '=', 's.identityId').onRef('m.tenantId', '=', 's.tenantId'),
      )
      .leftJoin('tenant as t', 't.id', 's.tenantId')
      .leftJoin('superUser as su', 'su.identityId', 's.identityId')
      .select([
        's.id as sessionId',
        's.identityId',
        's.tenantId',
        's.context',
        's.createdAt',
        's.lastSeenAt',
        's.expiresAt',
        'i.status as identityStatus',
        'i.mfaEnabled',
        'm.id as memberId',
        'm.role as memberRole',
        'm.status as memberStatus',
        't.status as tenantStatus',
        't.ownerMemberId',
        'su.status as superUserStatus',
      ])
      .where('s.sessionHash', '=', sessionHash)
      .executeTakeFirst();
    return row as SessionRow | undefined;
  }

  /** `last_seen_at` höchstens alle 5 min; ein OCC-Konflikt dabei wird ignoriert (TK 5.3). */
  async touch(row: Pick<SessionRow, 'sessionId' | 'lastSeenAt'>, now: Date): Promise<boolean> {
    if (now.getTime() - new Date(row.lastSeenAt).getTime() < SESSION_TOUCH_INTERVAL_MS)
      return false;
    try {
      await this.db
        .updateTable('authSession')
        .set({ lastSeenAt: now })
        .where('id', '=', row.sessionId)
        .where('lastSeenAt', '<', new Date(now.getTime() - SESSION_TOUCH_INTERVAL_MS))
        .execute();
      return true;
    } catch (error) {
      if (isOccConflict(error)) return false;
      throw error;
    }
  }

  /** Identität anlegen bzw. aktualisieren (TK 5.2 Schritt 4): Profil, `mfa_enabled`, `last_login_at`. */
  async upsertIdentity(profile: DiscordProfile, now: Date): Promise<Identity> {
    return this.db
      .insertInto('identity')
      .values({
        discordUserId: profile.discordUserId,
        discordUsername: profile.username,
        discordGlobalName: profile.globalName,
        avatarHash: profile.avatarHash,
        mfaEnabled: profile.mfaEnabled,
        lastLoginAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflict((oc) =>
        oc.column('discordUserId').doUpdateSet({
          discordUsername: profile.username,
          discordGlobalName: profile.globalName,
          avatarHash: profile.avatarHash,
          mfaEnabled: profile.mfaEnabled,
          lastLoginAt: now,
          updatedAt: now,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  identityById(identityId: string): Promise<Identity | undefined> {
    return this.db
      .selectFrom('identity')
      .selectAll()
      .where('id', '=', identityId)
      .executeTakeFirst();
  }

  /** Aktive Mitgliedschaften in aktiven Mandanten (FA-LOG-02, FA-MAN-02). */
  async memberships(identityId: string): Promise<Membership[]> {
    const rows = await this.db
      .selectFrom('appUser as m')
      .innerJoin('tenant as t', 't.id', 'm.tenantId')
      .select([
        'm.id as memberId',
        'm.tenantId',
        't.tenantKey',
        't.displayName as tenantName',
        'm.displayName',
        'm.role',
        't.ownerMemberId',
      ])
      .where('m.identityId', '=', identityId)
      .where('m.status', '=', 'active')
      .where('t.status', '=', 'active')
      .orderBy('t.tenantKey')
      .execute();
    return rows.map(({ ownerMemberId, ...r }) => ({ ...r, isOwner: ownerMemberId === r.memberId }));
  }

  async superUserStatus(identityId: string): Promise<'active' | 'disabled' | undefined> {
    const row = await this.db
      .selectFrom('superUser')
      .select('status')
      .where('identityId', '=', identityId)
      .executeTakeFirst();
    return row?.status;
  }

  /**
   * Bootstrap (TK 5.4, SV-17): gelistete Discord-ID mit 2FA und noch kein `super_user` → anlegen und
   * `system_audit` (`super_user.bootstrap`). Liefert `true`, wenn angelegt.
   */
  bootstrapSuperUser(identityId: string, discordUserId: string): Promise<boolean> {
    return withTx(
      this.db,
      async (trx) => {
        const created = await trx
          .insertInto('superUser')
          .values({ identityId, createdBy: null })
          .onConflict((oc) => oc.column('identityId').doNothing())
          .returning('identityId')
          .executeTakeFirst();
        if (!created) return false;
        await trx
          .insertInto('systemAudit')
          .values({
            actor: 'super_user',
            superUserId: identityId,
            action: 'super_user.bootstrap',
            details: JSON.stringify({
              discordUserId,
              source: 'ssm:/nina-pm/bootstrap-super-users',
            }),
          })
          .execute();
        return true;
      },
      this.txOptions,
    );
  }

  /** Bis zu 500 abgelaufene Sitzungen löschen (Höchstdauer oder Leerlauf; bei jeder Anmeldung, TK 5.3). */
  async cleanupExpired(now: Date, limit = 500): Promise<number> {
    const idleBefore = new Date(now.getTime() - SESSION_IDLE_DAYS * DAY_MS);
    const res = await this.db
      .deleteFrom('authSession')
      .where(
        'id',
        'in',
        this.db
          .selectFrom('authSession')
          .select('id')
          .where((eb) => eb.or([eb('expiresAt', '<=', now), eb('lastSeenAt', '<=', idleBefore)]))
          .limit(limit),
      )
      .executeTakeFirst();
    return Number(res.numDeletedRows);
  }

  async createSession(session: NewSession): Promise<AuthSession> {
    return this.db
      .insertInto('authSession')
      .values({
        sessionHash: session.sessionHash,
        identityId: session.identityId,
        tenantId: session.tenantId,
        context: session.context,
        userAgent: session.userAgent,
        ipTruncated: session.ipTruncated,
        createdAt: session.now,
        lastSeenAt: session.now,
        expiresAt: new Date(session.now.getTime() + SESSION_MAX_DAYS * DAY_MS),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /** Kontextwechsel in **dieselbe** Sitzungszeile (TK 5.2). */
  async setContext(
    sessionId: string,
    identityId: string,
    context: 'tenant' | 'system' | 'select',
    tenantId: string | null,
  ): Promise<void> {
    await this.db
      .updateTable('authSession')
      .set({ context, tenantId })
      .where('id', '=', sessionId)
      .where('identityId', '=', identityId)
      .execute();
  }

  async touchMemberLogin(memberId: string, now: Date): Promise<void> {
    await this.db
      .updateTable('appUser')
      .set({ lastLoginAt: now })
      .where('id', '=', memberId)
      .execute();
  }

  async tenantByKey(tenantKey: string) {
    return this.db
      .selectFrom('tenant')
      .select(['id', 'tenantKey', 'displayName', 'status', 'ownerMemberId'])
      .where('tenantKey', '=', tenantKey)
      .executeTakeFirst();
  }

  async tenantById(tenantId: string) {
    return this.db
      .selectFrom('tenant')
      .select(['id', 'tenantKey', 'displayName', 'status', 'ownerMemberId'])
      .where('id', '=', tenantId)
      .executeTakeFirst();
  }

  async memberOf(identityId: string, tenantId: string) {
    return this.db
      .selectFrom('appUser')
      .select(['id', 'displayName', 'role', 'status'])
      .where('identityId', '=', identityId)
      .where('tenantId', '=', tenantId)
      .executeTakeFirst();
  }

  async deleteSessionByHash(sessionHash: string): Promise<void> {
    await this.db.deleteFrom('authSession').where('sessionHash', '=', sessionHash).execute();
  }

  /** Eigene Sitzung beenden; liefert `false`, wenn sie nicht zur Identität gehört. */
  async deleteSession(identityId: string, sessionId: string): Promise<boolean> {
    const res = await this.db
      .deleteFrom('authSession')
      .where('id', '=', sessionId)
      .where('identityId', '=', identityId)
      .executeTakeFirst();
    return Number(res.numDeletedRows) > 0;
  }

  /** „Überall abmelden“ bzw. `revoke-sessions` (TK 5.3). */
  async deleteAllSessions(identityId: string): Promise<number> {
    const res = await this.db
      .deleteFrom('authSession')
      .where('identityId', '=', identityId)
      .executeTakeFirst();
    return Number(res.numDeletedRows);
  }

  async listSessions(identityId: string, now: Date): Promise<AuthSession[]> {
    const rows = await this.db
      .selectFrom('authSession')
      .selectAll()
      .where('identityId', '=', identityId)
      .orderBy('lastSeenAt', 'desc')
      .execute();
    return rows.filter((r) => sessionAlive(r, now));
  }

  /**
   * Einladung prüfen, ohne sie zu verbrauchen (`POST /auth/invitation/claim`, TK 5.2): nicht widerrufen,
   * nicht abgelaufen (`410 invitation.expired`), Nutzungen frei, Mandant aktiv, Owner-Einladung nur ohne
   * vorhandenen Owner – sonst `404 invitation.invalid`.
   */
  async claimableInvitation(tokenHash: string, now: Date): Promise<ClaimableInvitation> {
    const row = await this.db
      .selectFrom('invitation as v')
      .innerJoin('tenant as t', 't.id', 'v.tenantId')
      .select([
        'v.id',
        'v.tenantId',
        'v.role',
        'v.maxUses',
        'v.usedCount',
        'v.expiresAt',
        'v.revokedAt',
        't.displayName as tenantName',
        't.status as tenantStatus',
        't.ownerMemberId',
      ])
      .where('v.tokenHash', '=', tokenHash)
      .executeTakeFirst();
    if (
      !row ||
      row.revokedAt !== null ||
      row.tenantStatus !== 'active' ||
      row.usedCount >= row.maxUses
    ) {
      throw new ProblemError('invitation.invalid');
    }
    if (new Date(row.expiresAt).getTime() <= now.getTime())
      throw new ProblemError('invitation.expired');
    if (row.role === 'owner' && row.ownerMemberId !== null)
      throw new ProblemError('invitation.invalid');
    return {
      id: row.id,
      tenantId: row.tenantId,
      tenantName: row.tenantName,
      role: row.role,
      expiresAt: new Date(row.expiresAt),
    };
  }

  /**
   * Einladung im Callback einlösen (TK 5.2 Schritt 5) – in **einer** Transaktion mit Wächtern auf
   * Einladung und Mandant: prüfen, `app_user` anlegen, `used_count++`; Rolle `owner` → `role='admin'`
   * und `tenant.owner_member_id` setzen (nur wenn leer). Gebundene Einladung nur für diese Discord-ID.
   */
  redeemInvitation(
    tokenHash: string,
    identity: Pick<Identity, 'id' | 'discordUserId' | 'discordUsername' | 'discordGlobalName'>,
    now: Date,
  ): Promise<{ memberId: string; tenantId: string }> {
    return withTx(
      this.db,
      async (trx) => {
        const inv = await trx
          .selectFrom('invitation as v')
          .innerJoin('tenant as t', 't.id', 'v.tenantId')
          .select([
            'v.id',
            'v.tenantId',
            'v.role',
            'v.discordUserId',
            'v.maxUses',
            'v.usedCount',
            'v.expiresAt',
            'v.revokedAt',
            'v.createdByMember',
            't.status as tenantStatus',
            't.ownerMemberId',
          ])
          .where('v.tokenHash', '=', tokenHash)
          .forUpdate()
          .executeTakeFirst();
        if (
          !inv ||
          inv.revokedAt !== null ||
          inv.tenantStatus !== 'active' ||
          inv.usedCount >= inv.maxUses
        ) {
          throw new ProblemError('invitation.invalid');
        }
        if (new Date(inv.expiresAt).getTime() <= now.getTime())
          throw new ProblemError('invitation.expired');
        if (inv.discordUserId !== null && inv.discordUserId !== identity.discordUserId) {
          throw new ProblemError('invitation.invalid');
        }
        // Wächter auf den Mandanten: die Owner-Prüfung ist Teil der Konfliktprüfung (DSQL OCC).
        await sql`SELECT 1 FROM tenant WHERE id = ${inv.tenantId} FOR UPDATE`.execute(trx);
        if (inv.role === 'owner' && inv.ownerMemberId !== null)
          throw new ProblemError('invitation.invalid');
        const existing = await trx
          .selectFrom('appUser')
          .select('id')
          .where('tenantId', '=', inv.tenantId)
          .where('identityId', '=', identity.id)
          .executeTakeFirst();
        if (existing) throw new ProblemError('invitation.already_member');
        const member = await trx
          .insertInto('appUser')
          .values({
            tenantId: inv.tenantId,
            identityId: identity.id,
            displayName: identity.discordGlobalName ?? identity.discordUsername,
            role: inv.role === 'user' ? 'user' : 'admin',
            invitedBy: inv.createdByMember,
            lastLoginAt: now,
            allowedRigIds: null,
            createdAt: now,
            updatedAt: now,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await trx
          .updateTable('invitation')
          .set({ usedCount: inv.usedCount + 1 })
          .where('id', '=', inv.id)
          .execute();
        if (inv.role === 'owner') {
          await trx
            .updateTable('tenant')
            .set({ ownerMemberId: member.id, updatedAt: now })
            .where('id', '=', inv.tenantId)
            .where('ownerMemberId', 'is', null)
            .execute();
        }
        return { memberId: member.id, tenantId: inv.tenantId };
      },
      this.txOptions,
    );
  }
}
