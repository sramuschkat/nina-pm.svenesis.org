/**
 * NINA-Instanzen und Plugin-Zugriff (TK 5.6, 6.3, 7.3; SV-08, FA-SYN-01…03):
 * - `NinaInstanceRepository` (Web, mandantengebunden): anlegen mit Token-Hash, auflisten, widerrufen.
 * - `ninaTokenLookup`: Suche über den eindeutigen Index `token_hash` bei **jeder** Plugin-Anfrage
 *   (kein Cache) – wie die Anmeldesitzung eine bewusste Ausnahme von der tenant_id-Regel (TK 6.1).
 * - `NinaRigRepository`: Plugin-Sicht auf genau ein Rig (Übernahmestatus, ETag-Bausteine, offene Meldungen).
 */
import { ProblemError } from '@nina-pm/shared';
import type { Kysely, Selectable } from 'kysely';
import { withTx } from '../tx';
import type { Database, NinaInstanceTable } from '../types';
import { TenantRepo, type TenantContext } from './base';

export type NinaInstanceRow = Selectable<NinaInstanceTable>;

export interface NinaPrincipal {
  readonly instanceId: string;
  readonly instanceName: string;
  readonly tenantId: string;
  readonly rigId: string;
  readonly status: string;
  readonly tenantStatus: 'active' | 'locked';
  readonly lastSeenAt: Date | null;
  readonly lastState: unknown;
}

/** `last_seen_at` höchstens einmal je 5 min schreiben (TK 5.6). */
export const NINA_SEEN_INTERVAL_MS = 5 * 60_000;

export async function ninaTokenLookup(
  db: Kysely<Database>,
  tokenHash: string,
): Promise<NinaPrincipal | undefined> {
  const row = await db
    .selectFrom('ninaInstance as n')
    .innerJoin('tenant as t', 't.id', 'n.tenantId')
    .select([
      'n.id',
      'n.name',
      'n.tenantId',
      'n.rigId',
      'n.status',
      'n.lastSeenAt',
      'n.lastState',
      't.status as tenantStatus',
    ])
    .where('n.tokenHash', '=', tokenHash)
    .executeTakeFirst();
  if (!row) return undefined;
  return {
    instanceId: row.id,
    instanceName: row.name,
    tenantId: row.tenantId,
    rigId: row.rigId,
    status: row.status,
    tenantStatus: row.tenantStatus,
    lastSeenAt: row.lastSeenAt === null ? null : new Date(row.lastSeenAt),
    lastState: row.lastState,
  };
}

/** Letzte Nutzung vermerken, wenn die vorige länger als 5 min zurückliegt. */
export async function ninaTouch(
  db: Kysely<Database>,
  p: Pick<NinaPrincipal, 'instanceId' | 'tenantId' | 'lastSeenAt'>,
  now: Date,
): Promise<void> {
  if (p.lastSeenAt && now.getTime() - p.lastSeenAt.getTime() < NINA_SEEN_INTERVAL_MS) return;
  await db
    .updateTable('ninaInstance')
    .set({ lastSeenAt: now })
    .where('id', '=', p.instanceId)
    .where('tenantId', '=', p.tenantId)
    .execute();
}

export class NinaInstanceRepository extends TenantRepo {
  list(rigId?: string): Promise<NinaInstanceRow[]> {
    let q = this.db
      .selectFrom('ninaInstance')
      .selectAll()
      .where('tenantId', '=', this.ctx.tenantId);
    if (rigId) q = q.where('rigId', '=', rigId);
    return q.orderBy('createdAt').orderBy('id').execute();
  }

  byId(id: string): Promise<NinaInstanceRow | undefined> {
    return this.db
      .selectFrom('ninaInstance')
      .selectAll()
      .where('tenantId', '=', this.ctx.tenantId)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  /** Anlegen mit Client-UUID; das Rig muss im Mandanten existieren (sonst 404). */
  async create(
    input: { id: string; rigId: string; name: string; tokenHash: string; tokenPrefix: string },
    now: Date,
  ): Promise<NinaInstanceRow> {
    const rig = await this.db
      .selectFrom('rig')
      .select('id')
      .where('tenantId', '=', this.ctx.tenantId)
      .where('id', '=', input.rigId)
      .executeTakeFirst();
    if (!rig) throw new ProblemError('resource.not_found');
    const existing = await this.db
      .selectFrom('ninaInstance')
      .select('tenantId')
      .where('id', '=', input.id)
      .executeTakeFirst();
    if (existing)
      throw new ProblemError('validation.failed', [{ path: 'id', message: 'vergeben' }]);
    return this.db
      .insertInto('ninaInstance')
      .values({
        id: input.id,
        tenantId: this.ctx.tenantId,
        rigId: input.rigId,
        name: input.name,
        tokenHash: input.tokenHash,
        tokenPrefix: input.tokenPrefix,
        createdBy: this.ctx.memberId ?? null,
        createdAt: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /** Widerruf wirkt sofort: die nächste Plugin-Anfrage findet `status = revoked` (401). */
  async revoke(id: string): Promise<NinaInstanceRow> {
    const row = await this.db
      .updateTable('ninaInstance')
      .set({ status: 'revoked' })
      .where('tenantId', '=', this.ctx.tenantId)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new ProblemError('resource.not_found');
    return row;
  }
}

/** Plugin-Sicht auf das Rig des Tokens (Mandant und Rig aus dem Token, TK 5.6). */
export class NinaRigRepository extends TenantRepo {
  constructor(
    db: Kysely<Database>,
    ctx: TenantContext,
    private readonly rigId: string,
  ) {
    super(db, ctx);
  }

  /** Übernahmestatus (FA-SIM-09): abgerufene Einstellungsversion und Zeitpunkt. */
  async recordSettingsFetched(instanceId: string, settingsVersion: number, now: Date) {
    await this.db
      .updateTable('ninaInstance')
      .set({ settingsVersionFetched: settingsVersion, settingsFetchedAt: now })
      .where('tenantId', '=', this.ctx.tenantId)
      .where('id', '=', instanceId)
      .execute();
  }

  /**
   * Bausteine des `targets`-ETags **ohne** Zähler aus Aufnahmemeldungen (NT-19): verworfene Anzahlen
   * je Zeile (Korrekturen/Verwerfen) der ausgelieferten Projekte.
   */
  async rejectedCounts(projectIds: readonly string[]): Promise<Record<string, number>> {
    if (projectIds.length === 0) return {};
    const rows = await this.db
      .selectFrom('exposureLine')
      .select(['id', 'rejectedCount', 'bonusRejectedCount'])
      .where('tenantId', '=', this.ctx.tenantId)
      .where('projectId', 'in', [...projectIds])
      .execute();
    return Object.fromEntries(
      rows.map((r) => [r.id, Number(r.rejectedCount) + Number(r.bonusRejectedCount)]),
    );
  }

  /** Offene Meldungen (NT-20): IDs, die schon in `capture` stehen, zählen nicht noch einmal. */
  async knownCaptureIds(ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.db
      .selectFrom('capture')
      .select('id')
      .where('tenantId', '=', this.ctx.tenantId)
      .where('id', 'in', [...ids])
      .execute();
    return new Set(rows.map((r) => r.id));
  }

  /**
   * Serverplan speichern (`night_plan(origin = 'server_plan')`, TK 7.3): Revision = höchste Revision der
   * Session + 1 (ohne Session 1). Gleiche Eingabe ergibt dieselbe `nightPlanId` (UUID aus dem Hash) –
   * dann bleibt die gespeicherte Revision. Eine Session eines anderen Rigs → 404 (SEC-53); die Session
   * erhält `session_end_utc` der letzten Revision (NT-09).
   */
  savePlan(input: {
    nightPlanId: string;
    night: string;
    sessionId: string | null;
    reason: string;
    engineVersion: string;
    inputHash: string;
    plan: { readonly blocks: readonly unknown[]; readonly sessionEndUtc: string };
    now: Date;
  }): Promise<number> {
    const tenantId = this.ctx.tenantId;
    return withTx(this.db, async (trx) => {
      let sessionId: string | null = null;
      if (input.sessionId) {
        const session = await trx
          .selectFrom('session')
          .select(['id', 'tenantId', 'rigId'])
          .where('id', '=', input.sessionId)
          .executeTakeFirst();
        if (session && (session.tenantId !== tenantId || session.rigId !== this.rigId))
          throw new ProblemError('resource.not_found');
        sessionId = session ? session.id : null;
      }
      const existing = await trx
        .selectFrom('nightPlan')
        .select(['revision', 'tenantId', 'rigId'])
        .where('id', '=', input.nightPlanId)
        .executeTakeFirst();
      if (existing) {
        if (existing.tenantId !== tenantId || existing.rigId !== this.rigId)
          throw new ProblemError('resource.not_found');
        return existing.revision;
      }
      let revision = 1;
      if (sessionId) {
        const max = await trx
          .selectFrom('nightPlan')
          .select((eb) => eb.fn.max('revision').as('rev'))
          .where('tenantId', '=', tenantId)
          .where('sessionId', '=', sessionId)
          .executeTakeFirst();
        revision = Number(max?.rev ?? 0) + 1;
      }
      const { blocks, ...summary } = input.plan as { blocks: readonly unknown[] } & Record<
        string,
        unknown
      >;
      await trx
        .insertInto('nightPlan')
        .values({
          id: input.nightPlanId,
          tenantId,
          rigId: this.rigId,
          night: input.night,
          origin: 'server_plan',
          sessionId,
          revision,
          reason: input.reason,
          engineVersion: input.engineVersion,
          inputHash: input.inputHash,
          summary: JSON.stringify(summary),
          blocks: JSON.stringify(blocks),
          createdAt: input.now,
        })
        .execute();
      if (sessionId) {
        const end = new Date(input.plan.sessionEndUtc);
        await trx
          .updateTable('session')
          .set({
            sessionEndUtc: end,
            reportDueAt: new Date(end.getTime() + 2 * 3_600_000),
          })
          .where('tenantId', '=', tenantId)
          .where('id', '=', sessionId)
          .execute();
      }
      return revision;
    });
  }

  get rig(): string {
    return this.rigId;
  }
}
