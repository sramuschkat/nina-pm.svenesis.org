/**
 * Freigabe-Workflow (AP-12a; FA-FRG-01…16, FK 6.14; TK 7.2): Einreichen, Zurückziehen, Freigeben,
 * Zurückgeben, Ablehnen – jeweils mit `If-Match` (Projektversion) und Wächter auf die Projektzeile;
 * Stimmen je Mitglied und Gegenstand (`queue_vote`, nie für eigene Objekte, nur solange eingereicht),
 * Rangfolge des Einreichers, Warteschlange und Entwürfe; Verfall offener Einreichungen nach
 * `approvalDeadlineDays` (→ *Zurückgegeben*, Ereignis `expired`, Entscheidung Sven 24.09.2026).
 *
 * - Stimmen ruhen beim Zurückziehen/Zurückgeben/Verfall (bleiben gespeichert, zählen nur im Status
 *   *Eingereicht*); mit Freigabe/Ablehnung ist die Abstimmung geschlossen, der Endstand steht im
 *   Freigabeereignis. Stimmen deaktivierter/entfernter Mitglieder zählen nicht (FA-BEN-11).
 * - „Geändert seit deiner Stimme“: `project.content_changed_at` > `queue_vote.acknowledged_at`.
 * - Jede Änderung setzt `effort_stale` und erhöht `version`.
 */
import {
  effectiveTenantSettings,
  missingForActivation,
  ProblemError,
  type ApproveInput,
  type NotificationKind,
  type SubmissionRanking,
  type SubmitInput,
} from '@nina-pm/shared';
import type { Kysely, Transaction } from 'kysely';
import { withTx } from '../tx';
import type { Database } from '../types';
import { TenantRepo } from './base';
import { insertNotifications } from './notification';
import { nextSubmitterRank, openRequests, renumberRanks } from './ranks';
import { ProjectRepository, type ProjectDetail, type ProjectRow } from './project';

type Tx = Transaction<Database>;

const json = (v: unknown) => JSON.stringify(v ?? null);
const notFound = () => new ProblemError('resource.not_found');
const notAllowed = (from: string, action: string) =>
  new ProblemError('approval.not_allowed', [
    { path: 'approvalStatus', message: `${from} → ${action}` },
  ]);

export interface VoteSummary {
  readonly count: number;
  readonly voters: { memberId: string; displayName: string; changedSinceVote: boolean }[];
  readonly mine: boolean;
  readonly mineChangedSince: boolean;
}

export interface QueueEntry {
  readonly detail: ProjectDetail;
  readonly createdByName: string;
  readonly submittedAt: Date | null;
  /** Verfall nach `approvalDeadlineDays` (Entscheidung 24.09.2026); `null` ohne Frist. */
  readonly expiresAt: Date | null;
  readonly votes: VoteSummary;
  readonly rank: { rank: number; of: number } | null;
}

/** Endstand der Stimmen für das Freigabeereignis (FA-FRG-14). */
async function voteSnapshot(db: Kysely<Database> | Tx, tenantId: string, projectId: string) {
  const rows = await db
    .selectFrom('queueVote as v')
    .innerJoin('appUser as u', 'u.id', 'v.voterId')
    .select(['v.voterId', 'u.displayName'])
    .where('v.tenantId', '=', tenantId)
    .where('v.subjectKind', '=', 'project')
    .where('v.subjectId', '=', projectId)
    .where('u.status', '=', 'active')
    .orderBy('v.createdAt')
    .execute();
  return {
    count: rows.length,
    voterIds: rows.map((r) => r.voterId),
    names: rows.map((r) => r.displayName),
  };
}

export class ApprovalRepository extends TenantRepo {
  private get tenantId() {
    return this.ctx.tenantId;
  }

  private get me(): string {
    const id = this.ctx.memberId;
    if (!id) throw new ProblemError('permission.denied');
    return id;
  }

  private projects(db?: Kysely<Database> | Tx) {
    return new ProjectRepository(db ?? this.db, this.ctx);
  }

  private tx<T>(fn: (trx: Tx) => Promise<T>, projectId: string) {
    return withTx(this.db, fn, {
      guard: [{ table: 'project', id: projectId, tenantId: this.tenantId }],
    });
  }

  private async row(trx: Tx, id: string, expectedVersion?: number): Promise<ProjectRow> {
    const p = await trx
      .selectFrom('project')
      .selectAll()
      .where('tenantId', '=', this.tenantId)
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (!p) throw notFound();
    if (expectedVersion !== undefined && expectedVersion !== p.version)
      throw new ProblemError('resource.version_conflict');
    return p;
  }

  private async event(
    trx: Tx,
    projectId: string,
    action: string,
    snapshot: Record<string, unknown>,
    comment: string | null,
    now: Date,
  ) {
    await trx
      .insertInto('approvalEvent')
      .values({
        tenantId: this.tenantId,
        projectId,
        userId: this.ctx.memberId ?? null,
        action,
        comment,
        snapshot: json(snapshot),
        createdAt: now,
      })
      .execute();
  }

  private async notify(
    trx: Tx,
    recipients: readonly string[],
    kind: NotificationKind,
    projectId: string,
    payload: Record<string, unknown>,
    now: Date,
  ) {
    await insertNotifications(trx, {
      tenantId: this.tenantId,
      recipients: recipients.filter((r) => r !== this.ctx.memberId),
      kind,
      projectId,
      payload,
      now,
    });
  }

  private async activeAdmins(trx: Tx | Kysely<Database>): Promise<string[]> {
    const rows = await trx
      .selectFrom('appUser')
      .select('id')
      .where('tenantId', '=', this.tenantId)
      .where('role', '=', 'admin')
      .where('status', '=', 'active')
      .execute();
    return rows.map((r) => r.id);
  }

  private async voterIds(trx: Tx, projectId: string): Promise<string[]> {
    const rows = await trx
      .selectFrom('queueVote')
      .select('voterId')
      .where('tenantId', '=', this.tenantId)
      .where('subjectKind', '=', 'project')
      .where('subjectId', '=', projectId)
      .execute();
    return rows.map((r) => r.voterId);
  }

  private async update(trx: Tx, p: ProjectRow, set: Record<string, unknown>, now: Date) {
    await trx
      .updateTable('project')
      .set({ ...set, version: p.version + 1, effortStale: true, updatedAt: now })
      .where('tenantId', '=', this.tenantId)
      .where('id', '=', p.id)
      .execute();
  }

  private async activeLinesWithPlan(trx: Tx, projectId: string) {
    const r = await trx
      .selectFrom('exposureLine')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('tenantId', '=', this.tenantId)
      .where('projectId', '=', projectId)
      .where('deletedAt', 'is', null)
      .where('enabled', '=', true)
      .where('plannedCount', '>', 0)
      .executeTakeFirst();
    return Number(r?.n ?? 0);
  }

  /** Pflichtprüfung ab Einreichung bzw. Freigabe (FA-PRJ-01, FA-FRG-02) → `422 approval.incomplete`. */
  private async requireComplete(trx: Tx, p: ProjectRow, rigId: string | null) {
    const missing = missingForActivation({
      name: p.name,
      rigId,
      raDeg: p.raDeg,
      decDeg: p.decDeg,
      targetName: p.targetName ?? p.name,
      activeLinesWithPlan: await this.activeLinesWithPlan(trx, p.id),
    });
    if (missing.length > 0)
      throw new ProblemError(
        'approval.incomplete',
        missing.map((path) => ({ path, message: 'fehlt' })),
      );
  }

  private detail(trx: Tx, id: string) {
    return this.projects(trx).detail(id) as Promise<ProjectDetail>;
  }

  /** Mandanteneinstellungen und ob der Owner der einzige aktive Admin ist (FA-FRG-10). */
  async approvalContext(): Promise<{ adminSelfApproval: boolean; soleAdmin: boolean }> {
    const tenant = await this.db
      .selectFrom('tenant')
      .select('settings')
      .where('id', '=', this.tenantId)
      .executeTakeFirst();
    return {
      adminSelfApproval: effectiveTenantSettings(tenant?.settings).adminSelfApproval,
      soleAdmin: (await this.activeAdmins(this.db)).length <= 1,
    };
  }

  // ---- Einreichen / Zurückziehen ------------------------------------------------------------------

  submit(id: string, input: SubmitInput, now: Date, expectedVersion?: number) {
    return this.tx(async (trx) => {
      const p = await this.row(trx, id, expectedVersion);
      if (p.approvalStatus !== 'draft' && p.approvalStatus !== 'returned')
        throw notAllowed(p.approvalStatus, 'submitted');
      const rigId =
        input.requestedRigId === undefined ? (p.rigId ?? p.requestedRigId) : input.requestedRigId;
      if (rigId) {
        const rig = await trx
          .selectFrom('rig')
          .select('id')
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', rigId)
          .executeTakeFirst();
        if (!rig)
          throw new ProblemError('validation.failed', [
            { path: 'requestedRigId', message: 'Rig unbekannt' },
          ]);
      }
      await this.requireComplete(trx, p, rigId);
      const resubmitted =
        p.approvalStatus === 'returned' || (await this.voterIds(trx, id)).length > 0;
      const rank = await nextSubmitterRank(trx, this.tenantId, p.createdBy);
      const wish = {
        requestedRigId: rigId,
        requestPeriodFrom:
          input.requestPeriodFrom === undefined ? p.requestPeriodFrom : input.requestPeriodFrom,
        requestPeriodTo:
          input.requestPeriodTo === undefined ? p.requestPeriodTo : input.requestPeriodTo,
        requestComment:
          input.requestComment === undefined ? p.requestComment : input.requestComment,
      };
      await this.update(
        trx,
        p,
        {
          ...wish,
          rigId: null,
          approvalStatus: 'submitted',
          submitterRank: rank,
          ...(resubmitted ? { contentChangedAt: now } : {}),
        },
        now,
      );
      await this.event(
        trx,
        id,
        'submitted',
        { ...wish, rank, resubmitted },
        wish.requestComment ?? null,
        now,
      );
      await this.notify(
        trx,
        await this.activeAdmins(trx),
        'submission.new',
        id,
        { name: p.name },
        now,
      );
      if (resubmitted)
        await this.notify(
          trx,
          await this.voterIds(trx, id),
          'vote.subject_resubmitted',
          id,
          { name: p.name },
          now,
        );
      return this.detail(trx, id);
    }, id);
  }

  withdraw(id: string, now: Date, expectedVersion?: number) {
    return this.tx(async (trx) => {
      const p = await this.row(trx, id, expectedVersion);
      if (p.approvalStatus !== 'submitted') throw notAllowed(p.approvalStatus, 'draft');
      await this.update(trx, p, { approvalStatus: 'draft', submitterRank: null }, now);
      await renumberRanks(trx, this.tenantId, p.createdBy);
      await this.event(trx, id, 'withdrawn', { rank: p.submitterRank }, null, now);
      await this.notify(
        trx,
        await this.activeAdmins(trx),
        'submission.withdrawn',
        id,
        { name: p.name },
        now,
      );
      return this.detail(trx, id);
    }, id);
  }

  // ---- Entscheiden --------------------------------------------------------------------------------

  /**
   * Eigene Objekte (FA-FRG-10): mit „Admin-Objekte ohne Warteschlange“ (`adminSelfApproval`, Standard an)
   * gibt ein Admin sein Objekt direkt frei (auch aus Entwurf/Zurückgegeben); sonst nur, wenn er der
   * einzige Admin ist – andernfalls `409 approval.own_object`.
   */
  private async checkOwn(p: ProjectRow): Promise<boolean> {
    if (p.createdBy !== this.ctx.memberId) return false;
    const c = await this.approvalContext();
    if (!c.adminSelfApproval && !c.soleAdmin) throw new ProblemError('approval.own_object');
    return true;
  }

  approve(id: string, input: ApproveInput, now: Date, expectedVersion?: number) {
    return this.tx(async (trx) => {
      const p = await this.row(trx, id, expectedVersion);
      const own = await this.checkOwn(p);
      const allowed =
        p.approvalStatus === 'submitted' ||
        (own && (p.approvalStatus === 'draft' || p.approvalStatus === 'returned'));
      if (!allowed) throw notAllowed(p.approvalStatus, 'approved');
      const rig = await trx
        .selectFrom('rig')
        .select('id')
        .where('tenantId', '=', this.tenantId)
        .where('id', '=', input.rigId)
        .executeTakeFirst();
      if (!rig)
        throw new ProblemError('validation.failed', [{ path: 'rigId', message: 'Rig unbekannt' }]);
      await this.requireComplete(trx, p, input.rigId);
      if (input.rigId !== (p.requestedRigId ?? p.rigId) && !input.acceptRigConflicts) {
        const check = await this.projects(trx).rigCheck(id, input.rigId);
        const blocking = check.conflicts.filter((c) => c.code !== 'fov_changed');
        if (blocking.length > 0)
          throw new ProblemError(
            'approval.rig_conflict',
            blocking.map((c) => ({
              path: c.lineId ? `lines.${c.lineId}` : 'rigId',
              message: `${c.code}: ${c.detail}`,
            })),
          );
      }
      const votes = await voteSnapshot(trx, this.tenantId, id);
      // Position je Rig: alle freigegebenen, nicht gelöschten Projekte des Rigs neu nummerieren.
      const peers = await trx
        .selectFrom('project')
        .select(['id', 'priority'])
        .where('tenantId', '=', this.tenantId)
        .where('rigId', '=', input.rigId)
        .where('approvalStatus', '=', 'approved')
        .where('deletedAt', 'is', null)
        .where('id', '!=', id)
        .orderBy('priority')
        .orderBy('id')
        .execute();
      const order = peers.map((x) => x.id);
      const position = Math.min(input.priorityPosition ?? order.length + 1, order.length + 1);
      order.splice(position - 1, 0, id);
      for (const [i, pid] of order.entries())
        if (pid !== id && peers.find((x) => x.id === pid)?.priority !== i + 1)
          await trx
            .updateTable('project')
            .set({ priority: i + 1, updatedAt: now })
            .where('tenantId', '=', this.tenantId)
            .where('id', '=', pid)
            .execute();
      await this.update(
        trx,
        p,
        {
          approvalStatus: 'approved',
          status: input.status,
          rigId: input.rigId,
          priority: position,
          submitterRank: null,
          ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
          ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
        },
        now,
      );
      await renumberRanks(trx, this.tenantId, p.createdBy);
      await this.event(
        trx,
        id,
        'approved',
        { votes, rank: p.submitterRank, rigId: input.rigId, status: input.status, position, own },
        input.comment ?? null,
        now,
      );
      await this.notify(trx, [p.createdBy], 'approval.approved', id, { name: p.name }, now);
      return this.detail(trx, id);
    }, id);
  }

  private decide(
    id: string,
    to: 'returned' | 'rejected',
    comment: string,
    now: Date,
    expectedVersion?: number,
  ) {
    return this.tx(async (trx) => {
      const p = await this.row(trx, id, expectedVersion);
      await this.checkOwn(p);
      if (p.approvalStatus !== 'submitted') throw notAllowed(p.approvalStatus, to);
      const votes = await voteSnapshot(trx, this.tenantId, id);
      await this.update(trx, p, { approvalStatus: to, submitterRank: null }, now);
      await renumberRanks(trx, this.tenantId, p.createdBy);
      await this.event(trx, id, to, { votes, rank: p.submitterRank }, comment, now);
      await this.notify(
        trx,
        [p.createdBy],
        to === 'returned' ? 'approval.returned' : 'approval.rejected',
        id,
        { name: p.name, comment },
        now,
      );
      return this.detail(trx, id);
    }, id);
  }

  returnToUser(id: string, comment: string, now: Date, expectedVersion?: number) {
    return this.decide(id, 'returned', comment, now, expectedVersion);
  }

  reject(id: string, comment: string, now: Date, expectedVersion?: number) {
    return this.decide(id, 'rejected', comment, now, expectedVersion);
  }

  // ---- Stimmen ------------------------------------------------------------------------------------

  /** Stimme abgeben (`on`) oder zurücknehmen; eigene → 409 `vote.own_object`, nicht eingereicht → `vote.closed`. */
  vote(projectId: string, on: boolean, now: Date): Promise<VoteSummary> {
    const me = this.me;
    return this.tx(async (trx) => {
      const p = await this.row(trx, projectId);
      if (p.createdBy === me) throw new ProblemError('vote.own_object');
      if (p.approvalStatus !== 'submitted') throw new ProblemError('vote.closed');
      if (on)
        await trx
          .insertInto('queueVote')
          .values({
            tenantId: this.tenantId,
            subjectKind: 'project',
            subjectId: projectId,
            projectId,
            voterId: me,
            createdAt: now,
            acknowledgedAt: now,
          })
          .onConflict((oc) =>
            oc
              .columns(['tenantId', 'subjectKind', 'subjectId', 'voterId'])
              .doUpdateSet({ acknowledgedAt: now }),
          )
          .execute();
      else
        await trx
          .deleteFrom('queueVote')
          .where('tenantId', '=', this.tenantId)
          .where('subjectKind', '=', 'project')
          .where('subjectId', '=', projectId)
          .where('voterId', '=', me)
          .execute();
      return (await this.voteSummaries(trx, [p]))[0] as VoteSummary;
    }, projectId);
  }

  /** „Geändert seit deiner Stimme“ quittieren (auch beim Öffnen des Objekts). */
  async acknowledge(projectId: string, now: Date): Promise<void> {
    await this.db
      .updateTable('queueVote')
      .set({ acknowledgedAt: now })
      .where('tenantId', '=', this.tenantId)
      .where('subjectKind', '=', 'project')
      .where('subjectId', '=', projectId)
      .where('voterId', '=', this.me)
      .execute();
  }

  private async voteSummaries(db: Kysely<Database> | Tx, projects: readonly ProjectRow[]) {
    const ids = projects.map((p) => p.id);
    const rows =
      ids.length === 0
        ? []
        : await db
            .selectFrom('queueVote as v')
            .innerJoin('appUser as u', 'u.id', 'v.voterId')
            .select(['v.subjectId', 'v.voterId', 'v.acknowledgedAt', 'u.displayName'])
            .where('v.tenantId', '=', this.tenantId)
            .where('v.subjectKind', '=', 'project')
            .where('v.subjectId', 'in', ids)
            .where('u.status', '=', 'active')
            .orderBy('v.createdAt')
            .execute();
    return projects.map((p): VoteSummary => {
      const changed = p.contentChangedAt ? new Date(p.contentChangedAt).getTime() : null;
      const voters = rows
        .filter((r) => r.subjectId === p.id)
        .map((r) => ({
          memberId: r.voterId,
          displayName: r.displayName,
          changedSinceVote: changed !== null && changed > new Date(r.acknowledgedAt).getTime(),
        }));
      const mine = voters.find((v) => v.memberId === this.ctx.memberId);
      return {
        count: voters.length,
        voters,
        mine: mine !== undefined,
        mineChangedSince: mine?.changedSinceVote ?? false,
      };
    });
  }

  // ---- Rangfolge ----------------------------------------------------------------------------------

  /** Vollständige Liste der eigenen offenen Gegenstände in neuer Reihenfolge, sonst `422 ranking.incomplete`. */
  setRanking(ranking: SubmissionRanking, now: Date): Promise<void> {
    const me = this.me;
    return withTx(this.db, async (trx) => {
      const open = await trx
        .selectFrom('project')
        .select('id')
        .where('tenantId', '=', this.tenantId)
        .where('createdBy', '=', me)
        .where('approvalStatus', '=', 'submitted')
        .where('deletedAt', 'is', null)
        .execute();
      const requests = await openRequests(trx, this.tenantId)
        .select('c.id')
        .where('c.requestedBy', '=', me)
        .execute();
      const expected = new Set([
        ...open.map((o) => `project:${o.id}`),
        ...requests.map((r) => `change-request:${r.id}`),
      ]);
      const given = ranking.items.map((i) => `${i.kind}:${i.id}`);
      if (given.length !== expected.size || given.some((g) => !expected.has(g)))
        throw new ProblemError('ranking.incomplete');
      for (const [i, item] of ranking.items.entries())
        if (item.kind === 'project')
          await trx
            .updateTable('project')
            .set({ submitterRank: i + 1, updatedAt: now })
            .where('tenantId', '=', this.tenantId)
            .where('id', '=', item.id)
            .execute();
        else
          await trx
            .updateTable('changeRequest')
            .set({ submitterRank: i + 1 })
            .where('tenantId', '=', this.tenantId)
            .where('id', '=', item.id)
            .execute();
    });
  }

  // ---- Warteschlange und Entwürfe -----------------------------------------------------------------

  /** Eingereichte Projekte mit Stimmen und Rang; Sortierung: Stimmen ↓, Rang ↑, Einreichung ↑ (FA-FRG-04). */
  async queue(): Promise<QueueEntry[]> {
    const rows = await this.db
      .selectFrom('project')
      .selectAll()
      .where('tenantId', '=', this.tenantId)
      .where('approvalStatus', '=', 'submitted')
      .where('deletedAt', 'is', null)
      .execute();
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [votes, events, names, ranks] = await Promise.all([
      this.voteSummaries(this.db, rows),
      this.db
        .selectFrom('approvalEvent')
        .select(['projectId', (eb) => eb.fn.max('createdAt').as('at')])
        .where('tenantId', '=', this.tenantId)
        .where('action', '=', 'submitted')
        .where('projectId', 'in', ids)
        .groupBy('projectId')
        .execute(),
      this.db
        .selectFrom('appUser')
        .select(['id', 'displayName'])
        .where('tenantId', '=', this.tenantId)
        .where('id', 'in', [...new Set(rows.map((r) => r.createdBy))])
        .execute(),
      this.db
        .selectFrom('project')
        .select(['createdBy', (eb) => eb.fn.countAll<string>().as('n')])
        .where('tenantId', '=', this.tenantId)
        .where('approvalStatus', '=', 'submitted')
        .where('deletedAt', 'is', null)
        .groupBy('createdBy')
        .execute(),
    ]);
    const requestCounts = await openRequests(this.db, this.tenantId)
      .select(['c.requestedBy', (eb) => eb.fn.countAll<string>().as('n')])
      .groupBy('c.requestedBy')
      .execute();
    const projects = this.projects();
    const tenant = await this.db
      .selectFrom('tenant')
      .select('settings')
      .where('id', '=', this.tenantId)
      .executeTakeFirst();
    const days = effectiveTenantSettings(tenant?.settings).approvalDeadlineDays;
    const entries = await Promise.all(
      rows.map(async (p, i): Promise<QueueEntry> => {
        const at = events.find((e) => e.projectId === p.id)?.at;
        const of =
          Number(ranks.find((r) => r.createdBy === p.createdBy)?.n ?? 0) +
          Number(requestCounts.find((r) => r.requestedBy === p.createdBy)?.n ?? 0);
        return {
          detail: (await projects.detail(p.id)) as ProjectDetail,
          createdByName: names.find((n) => n.id === p.createdBy)?.displayName ?? '',
          submittedAt: at ? new Date(at as unknown as string) : null,
          expiresAt:
            at && days !== null
              ? new Date(new Date(at as unknown as string).getTime() + days * 86_400_000)
              : null,
          votes: votes[i] as VoteSummary,
          rank: p.submitterRank ? { rank: p.submitterRank, of } : null,
        };
      }),
    );
    return entries.sort(
      (a, b) =>
        b.votes.count - a.votes.count ||
        (a.rank?.rank ?? 999) - (b.rank?.rank ?? 999) ||
        (a.submittedAt?.getTime() ?? 0) - (b.submittedAt?.getTime() ?? 0),
    );
  }

  /**
   * Freigegebene Projekte je Rig in Prioritätsreihenfolge mit dem Endstand der Stimmen ihrer letzten
   * Freigabe (FA-FRG-16, Einfügeposition). Ohne Freigabeereignis (z. B. vom Admin selbst angelegt) 0.
   */
  async rigPriorityVotes(
    rigIds: readonly string[],
  ): Promise<Map<string, { projectId: string; priority: number; votes: number }[]>> {
    const out = new Map<string, { projectId: string; priority: number; votes: number }[]>();
    if (rigIds.length === 0) return out;
    const peers = await this.db
      .selectFrom('project')
      .select(['id', 'rigId', 'priority'])
      .where('tenantId', '=', this.tenantId)
      .where('rigId', 'in', [...new Set(rigIds)])
      .where('approvalStatus', '=', 'approved')
      .where('deletedAt', 'is', null)
      .orderBy('priority')
      .orderBy('id')
      .execute();
    const events =
      peers.length === 0
        ? []
        : await this.db
            .selectFrom('approvalEvent')
            .select(['projectId', 'snapshot', 'createdAt'])
            .where('tenantId', '=', this.tenantId)
            .where('action', '=', 'approved')
            .where(
              'projectId',
              'in',
              peers.map((p) => p.id),
            )
            .orderBy('createdAt', 'desc')
            .execute();
    const votesOf = new Map<string, number>();
    for (const e of events) {
      if (votesOf.has(e.projectId)) continue;
      const snap = (typeof e.snapshot === 'string' ? JSON.parse(e.snapshot) : e.snapshot) as {
        votes?: { count?: unknown };
      } | null;
      const n = snap?.votes?.count;
      votesOf.set(e.projectId, typeof n === 'number' ? n : 0);
    }
    for (const p of peers) {
      if (p.rigId === null) continue;
      const list = out.get(p.rigId) ?? [];
      list.push({ projectId: p.id, priority: p.priority, votes: votesOf.get(p.id) ?? 0 });
      out.set(p.rigId, list);
    }
    return out;
  }

  /** Entwürfe und zurückgegebene Objekte aller Mitglieder (S-34, FA-BER-02; nur Admin). */
  async drafts() {
    const projects = this.projects();
    const [draft, returned] = await Promise.all([
      projects.list({
        admin: true,
        deleted: false,
        approvalStatus: 'draft',
        mine: false,
        favorites: false,
      }),
      projects.list({
        admin: true,
        deleted: false,
        approvalStatus: 'returned',
        mine: false,
        favorites: false,
      }),
    ]);
    return [...draft, ...returned].sort((a, b) => a.project.name.localeCompare(b.project.name));
  }
}

// ---- Verfall (Zeitplan `tick-hourly`, Rolle `app_job`) ---------------------------------------------

/**
 * Offene Einreichungen verfallen nach `approvalDeadlineDays` ab der letzten Einreichung (Entscheidung
 * Sven, 24.09.2026): *Zurückgegeben*, Rang frei, Ereignis `expired` (ohne Benutzer, Endstand der
 * Stimmen), Benachrichtigung `approval.expired` an den Einreicher. Stimmen ruhen. Je Projekt eine
 * Transaktion mit Wächter; liefert die Anzahl verfallener Einreichungen.
 */
export async function expireSubmissions(db: Kysely<Database>, now: Date): Promise<number> {
  const tenants = await db.selectFrom('tenant').select(['id', 'settings']).execute();
  let expired = 0;
  for (const t of tenants) {
    const days = effectiveTenantSettings(t.settings).approvalDeadlineDays;
    if (days === null) continue;
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    const due = await db
      .selectFrom('project as p')
      .select('p.id')
      .where('p.tenantId', '=', t.id)
      .where('p.approvalStatus', '=', 'submitted')
      .where('p.deletedAt', 'is', null)
      .where((eb) =>
        eb(
          eb
            .selectFrom('approvalEvent as e')
            .select((e) => e.fn.max('e.createdAt').as('at'))
            .whereRef('e.projectId', '=', 'p.id')
            .where('e.tenantId', '=', t.id)
            .where('e.action', '=', 'submitted'),
          '<',
          cutoff,
        ),
      )
      .execute();
    for (const { id } of due) {
      const done = await withTx(
        db,
        async (trx) => {
          const p = await trx
            .selectFrom('project')
            .selectAll()
            .where('tenantId', '=', t.id)
            .where('id', '=', id)
            .executeTakeFirst();
          if (!p || p.approvalStatus !== 'submitted' || p.deletedAt !== null) return false;
          const votes = await voteSnapshot(trx, t.id, id);
          await trx
            .updateTable('project')
            .set({
              approvalStatus: 'returned',
              submitterRank: null,
              version: p.version + 1,
              effortStale: true,
              updatedAt: now,
            })
            .where('tenantId', '=', t.id)
            .where('id', '=', id)
            .execute();
          await renumberRanks(trx, t.id, p.createdBy);
          await trx
            .insertInto('approvalEvent')
            .values({
              tenantId: t.id,
              projectId: id,
              userId: null,
              action: 'expired',
              comment: null,
              snapshot: json({ votes, rank: p.submitterRank, deadlineDays: days }),
              createdAt: now,
            })
            .execute();
          await insertNotifications(trx, {
            tenantId: t.id,
            recipients: [p.createdBy],
            kind: 'approval.expired',
            projectId: id,
            payload: { name: p.name, deadlineDays: days },
            now,
          });
          return true;
        },
        { guard: [{ table: 'project', id, tenantId: t.id }] },
      );
      if (done) expired += 1;
    }
  }
  return expired;
}
