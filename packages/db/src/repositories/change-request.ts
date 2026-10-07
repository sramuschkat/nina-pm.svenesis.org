/**
 * Änderungsanträge (AP-32b; FA-FRG-08, FA-FRG-04/11/14/15; TK 7.2): Ein Antrag gehört zu einem freigegebenen
 * Projekt, führt eine eigene Version (`If-Match` → 412) und merkt sich die Projektversion bei der
 * Antragstellung (`base_version`). Umfang: Zeilen (Anzahl, aktiv, neue Zeilen), Bedingungen, Zeitraum und
 * Beschreibung (Entscheidung Sven 26.09.2026).
 *
 * - Offen → angenommen/abgelehnt (Admin) bzw. zurückgezogen (Antragsteller); nur offene Anträge ändern sich
 *   (`409 change_request.not_open`).
 * - Annehmen wendet **in einer Transaktion** (Wächter Projekt und Antrag) nur die beantragten Felder über
 *   `ProjectRepository.patchIn/patchLineIn/addLineIn` an; hat sich das Projekt seit der vom Admin gesehenen
 *   Fassung geändert, `409 change_request.conflict`.
 * - Stimmen (`queue_vote`, `subject_kind = change_request`) nur solange offen und nicht für eigene Anträge;
 *   Rang in der gemeinsamen Rangfolge des Einreichers (`renumberRanks`).
 */
import {
  ChangeRequestProposal,
  effectiveTenantSettings,
  ProblemError,
  type FieldError,
  type StoredChangeRequestProposal,
} from '@nina-pm/shared';
import type { Kysely, Selectable, Transaction } from 'kysely';
import { withTx, retryOcc } from '../tx';
import type { ChangeRequestTable, Database } from '../types';
import type { VoteSummary } from './approval';
import { nextSubmitterRank, openRequests, renumberRanks } from './ranks';
import { TenantRepo } from './base';
import { insertNotifications } from './notification';
import { ProjectRepository } from './project';

type Tx = Transaction<Database>;
export type ChangeRequestRow = Selectable<ChangeRequestTable>;

export interface ChangeRequestRecord {
  readonly row: ChangeRequestRow;
  readonly proposal: StoredChangeRequestProposal;
  readonly comment: string | null;
  readonly projectName: string;
  readonly projectVersion: number;
  readonly requestedByName: string;
  readonly decidedByName: string | null;
}

export interface ChangeRequestInputData {
  readonly id?: string | undefined;
  readonly proposal: ChangeRequestProposal;
  readonly comment: string | null;
}

const KIND = 'change_request';
const json = (v: unknown) => JSON.stringify(v ?? null);
const notFound = () => new ProblemError('resource.not_found');
const notOpen = () => new ProblemError('change_request.not_open');

function parseStored(raw: unknown): {
  proposal: StoredChangeRequestProposal;
  comment: string | null;
} {
  const v = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
    proposal?: unknown;
    comment?: unknown;
  } | null;
  // Kurzname des Filters vor der Prüfung entfernen (`LineCreate` ist strikt).
  const input = (v?.proposal ?? {}) as { newLines?: Record<string, unknown>[] };
  const parsed = ChangeRequestProposal.safeParse({
    ...input,
    newLines: (input.newLines ?? []).map(({ filterShortName: _f, ...l }) => {
      void _f;
      return l;
    }),
  });
  const proposal = (
    parsed.success ? parsed.data : { lines: [], newLines: [] }
  ) as StoredChangeRequestProposal;
  // Kurzname des Filters neuer Zeilen (vom Server beim Speichern ergänzt, `safeParse` entfernt ihn).
  const rawLines = ((v?.proposal as { newLines?: { id?: string; filterShortName?: string }[] })
    ?.newLines ?? []) as { id?: string; filterShortName?: string }[];
  const names = new Map(rawLines.map((l) => [l.id, l.filterShortName]));
  return {
    proposal: {
      ...proposal,
      newLines: proposal.newLines.map((l) => ({ ...l, filterShortName: names.get(l.id) ?? '' })),
    },
    comment: typeof v?.comment === 'string' ? v.comment : null,
  };
}

export class ChangeRequestRepository extends TenantRepo {
  private get tenantId() {
    return this.ctx.tenantId;
  }

  private get me(): string {
    const id = this.ctx.memberId;
    if (!id) throw new ProblemError('permission.denied');
    return id;
  }

  private tx<T>(fn: (trx: Tx) => Promise<T>, guard: { table: string; id: string }[]) {
    return withTx(this.db, fn, {
      guard: guard.map((g) => ({ ...g, tenantId: this.tenantId })),
    });
  }

  private async records(rows: readonly ChangeRequestRow[], db: Tx | Kysely<Database> = this.db) {
    if (rows.length === 0) return [];
    const users = [
      ...new Set(rows.flatMap((r) => [r.requestedBy, r.decidedBy]).filter((x): x is string => !!x)),
    ];
    const [names, projects] = await Promise.all([
      db
        .selectFrom('appUser')
        .select(['id', 'displayName'])
        .where('tenantId', '=', this.tenantId)
        .where('id', 'in', users)
        .execute(),
      db
        .selectFrom('project')
        .select(['id', 'name', 'version'])
        .where('tenantId', '=', this.tenantId)
        .where('id', 'in', [...new Set(rows.map((r) => r.projectId))])
        .execute(),
    ]);
    const name = new Map(names.map((n) => [n.id, n.displayName]));
    const project = new Map(projects.map((p) => [p.id, p]));
    return rows.map((row): ChangeRequestRecord => {
      const stored = parseStored(row.proposal);
      return {
        row,
        ...stored,
        projectName: project.get(row.projectId)?.name ?? '',
        projectVersion: project.get(row.projectId)?.version ?? 0,
        requestedByName: name.get(row.requestedBy) ?? '',
        decidedByName: row.decidedBy ? (name.get(row.decidedBy) ?? '') : null,
      };
    });
  }

  private async rowOf(db: Tx | Kysely<Database>, id: string): Promise<ChangeRequestRow> {
    const row = await db
      .selectFrom('changeRequest')
      .selectAll()
      .where('tenantId', '=', this.tenantId)
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw notFound();
    return row;
  }

  async byId(id: string): Promise<ChangeRequestRecord> {
    const [r] = await this.records([await this.rowOf(this.db, id)]);
    return r as ChangeRequestRecord;
  }

  async forProject(projectId: string): Promise<ChangeRequestRecord[]> {
    const rows = await this.db
      .selectFrom('changeRequest')
      .selectAll()
      .where('tenantId', '=', this.tenantId)
      .where('projectId', '=', projectId)
      .orderBy('createdAt', 'desc')
      .execute();
    return this.records(rows);
  }

  /** Offene Anträge für die Warteschlange (FA-FRG-04), ohne Anträge zu gelöschten Projekten. */
  async open(): Promise<ChangeRequestRecord[]> {
    const rows = await this.db
      .selectFrom('changeRequest as c')
      .innerJoin('project as p', (j) =>
        j.onRef('p.id', '=', 'c.projectId').onRef('p.tenantId', '=', 'c.tenantId'),
      )
      .selectAll('c')
      .where('c.tenantId', '=', this.tenantId)
      .where('c.status', '=', 'open')
      .where('p.deletedAt', 'is', null)
      .orderBy('c.createdAt')
      .execute();
    return this.records(rows);
  }

  /**
   * Vorschlag gegen das Projekt prüfen und für die Speicherung ergänzen: Zeilen und Panels des Projekts,
   * Filter des Mandanten (Kurzname für die Anzeige) – sonst `422 validation.failed`.
   */
  private async stored(
    trx: Tx,
    projectId: string,
    proposal: ChangeRequestProposal,
  ): Promise<StoredChangeRequestProposal> {
    const errors: FieldError[] = [];
    const lines = await trx
      .selectFrom('exposureLine')
      .select('id')
      .where('tenantId', '=', this.tenantId)
      .where('projectId', '=', projectId)
      .where('deletedAt', 'is', null)
      .execute();
    const lineIds = new Set(lines.map((l) => l.id));
    for (const [i, l] of proposal.lines.entries())
      if (!lineIds.has(l.lineId))
        errors.push({
          path: `proposal.lines.${String(i)}.lineId`,
          message: 'keine Zeile des Projekts',
        });
    const panels = await trx
      .selectFrom('projectPanel')
      .select('id')
      .where('tenantId', '=', this.tenantId)
      .where('projectId', '=', projectId)
      .where('deletedAt', 'is', null)
      .execute();
    const panelIds = new Set(panels.map((p) => p.id));
    const filterIds = [...new Set(proposal.newLines.map((l) => l.filterId))];
    const filters =
      filterIds.length === 0
        ? []
        : await trx
            .selectFrom('filter')
            .select(['id', 'shortName'])
            .where('tenantId', '=', this.tenantId)
            .where('id', 'in', filterIds)
            .execute();
    const shortName = new Map(filters.map((f) => [f.id, f.shortName]));
    for (const [i, l] of proposal.newLines.entries()) {
      if (!panelIds.has(l.panelId))
        errors.push({
          path: `proposal.newLines.${String(i)}.panelId`,
          message: 'kein Panel des Projekts',
        });
      if (!shortName.has(l.filterId))
        errors.push({
          path: `proposal.newLines.${String(i)}.filterId`,
          message: 'Filter unbekannt',
        });
      if (lineIds.has(l.id))
        errors.push({
          path: `proposal.newLines.${String(i)}.id`,
          message: 'Zeile existiert schon',
        });
    }
    if (errors.length > 0) throw new ProblemError('validation.failed', errors);
    return {
      ...proposal,
      newLines: proposal.newLines.map((l) => ({
        ...l,
        filterShortName: shortName.get(l.filterId),
      })),
    };
  }

  private async activeAdmins(trx: Tx): Promise<string[]> {
    const rows = await trx
      .selectFrom('appUser')
      .select('id')
      .where('tenantId', '=', this.tenantId)
      .where('role', '=', 'admin')
      .where('status', '=', 'active')
      .execute();
    return rows.map((r) => r.id);
  }

  private notify(
    trx: Tx,
    recipients: readonly string[],
    kind:
      | 'change_request.new'
      | 'change_request.decided'
      | 'submission.edited_by_admin'
      | 'vote.subject_changed',
    projectId: string,
    payload: Record<string, unknown>,
    now: Date,
  ) {
    return insertNotifications(trx, {
      tenantId: this.tenantId,
      recipients: recipients.filter((r) => r !== this.ctx.memberId),
      kind,
      projectId,
      payload,
      now,
    });
  }

  // ---- Antrag stellen, ändern, zurückziehen -------------------------------------------------------

  /** Antrag zu einem freigegebenen Projekt (sonst `409 approval.not_allowed`); idempotent über die ID. */
  create(
    projectId: string,
    input: ChangeRequestInputData,
    now: Date,
  ): Promise<ChangeRequestRecord> {
    const me = this.me;
    return this.tx(
      async (trx) => {
        if (input.id) {
          const existing = await trx
            .selectFrom('changeRequest')
            .selectAll()
            .where('tenantId', '=', this.tenantId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          if (existing) {
            if (existing.projectId !== projectId) throw notFound();
            return (await this.records([existing], trx))[0] as ChangeRequestRecord;
          }
        }
        const p = await trx
          .selectFrom('project')
          .select(['id', 'name', 'version', 'approvalStatus', 'deletedAt'])
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', projectId)
          .executeTakeFirst();
        if (!p || p.deletedAt !== null) throw notFound();
        if (p.approvalStatus !== 'approved')
          throw new ProblemError('approval.not_allowed', [
            { path: 'approvalStatus', message: `${p.approvalStatus} → change_request` },
          ]);
        const proposal = await this.stored(trx, projectId, input.proposal);
        const rank = await nextSubmitterRank(trx, this.tenantId, me);
        const row = await trx
          .insertInto('changeRequest')
          .values({
            ...(input.id ? { id: input.id } : {}),
            tenantId: this.tenantId,
            projectId,
            requestedBy: me,
            proposal: json({ proposal, comment: input.comment }),
            submitterRank: rank,
            baseVersion: p.version,
            updatedAt: now,
            createdAt: now,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await this.notify(
          trx,
          await this.activeAdmins(trx),
          'change_request.new',
          projectId,
          { name: p.name, changeRequestId: row.id },
          now,
        );
        return (await this.records([row], trx))[0] as ChangeRequestRecord;
      },
      [{ table: 'project', id: projectId }],
    );
  }

  /**
   * Offenen Antrag bearbeiten (Antragsteller oder Admin, FA-FRG-08/14). Ändert ein Admin, wird der
   * Antragsteller benachrichtigt und Stimmende sehen „geändert seit deiner Stimme“.
   */
  update(
    id: string,
    input: Omit<ChangeRequestInputData, 'id'>,
    now: Date,
    expectedVersion?: number,
  ): Promise<ChangeRequestRecord> {
    const me = this.me;
    return this.tx(
      async (trx) => {
        const row = await this.rowOf(trx, id);
        if (row.status !== 'open') throw notOpen();
        if (expectedVersion !== undefined && expectedVersion !== row.version)
          throw new ProblemError('resource.version_conflict');
        const proposal = await this.stored(trx, row.projectId, input.proposal);
        const byAdmin = me !== row.requestedBy;
        const updated = await trx
          .updateTable('changeRequest')
          .set({
            proposal: json({ proposal, comment: input.comment }),
            version: row.version + 1,
            updatedAt: now,
            contentChangedAt: now,
          })
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', id)
          .returningAll()
          .executeTakeFirstOrThrow();
        const record = (await this.records([updated], trx))[0] as ChangeRequestRecord;
        if (byAdmin) {
          await this.notify(
            trx,
            [row.requestedBy],
            'submission.edited_by_admin',
            row.projectId,
            { name: record.projectName, changeRequestId: id },
            now,
          );
          await this.notify(
            trx,
            await this.voterIds(trx, id),
            'vote.subject_changed',
            row.projectId,
            { name: record.projectName, changeRequestId: id },
            now,
          );
        }
        return record;
      },
      [{ table: 'change_request', id }],
    );
  }

  /** Zurückziehen – nur der Antragsteller, nur offen; Rang frei, Stimmen ruhen. */
  withdraw(id: string, now: Date, expectedVersion?: number): Promise<ChangeRequestRecord> {
    const me = this.me;
    return this.tx(
      async (trx) => {
        const row = await this.rowOf(trx, id);
        if (row.requestedBy !== me) throw new ProblemError('permission.denied');
        if (row.status !== 'open') throw notOpen();
        if (expectedVersion !== undefined && expectedVersion !== row.version)
          throw new ProblemError('resource.version_conflict');
        const updated = await trx
          .updateTable('changeRequest')
          .set({
            status: 'withdrawn',
            submitterRank: null,
            version: row.version + 1,
            updatedAt: now,
          })
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', id)
          .returningAll()
          .executeTakeFirstOrThrow();
        await renumberRanks(trx, this.tenantId, row.requestedBy);
        return (await this.records([updated], trx))[0] as ChangeRequestRecord;
      },
      [{ table: 'change_request', id }],
    );
  }

  // ---- Entscheiden --------------------------------------------------------------------------------

  /**
   * Annehmen oder Ablehnen (Admin). Eigene Anträge wie eigene Objekte (FA-FRG-10): nur mit „Admin-Objekte
   * ohne Warteschlange“ oder als einziger Admin, sonst `409 approval.own_object`.
   */
  async decide(
    id: string,
    input: { decision: 'approved' | 'rejected'; comment: string | null; projectVersion: number },
    now: Date,
    expectedVersion?: number,
  ): Promise<ChangeRequestRecord> {
    const me = this.me;
    const head = await this.rowOf(this.db, id);
    if (head.requestedBy === me) {
      const tenant = await this.db
        .selectFrom('tenant')
        .select('settings')
        .where('id', '=', this.tenantId)
        .executeTakeFirst();
      const admins = await this.db
        .selectFrom('appUser')
        .select('id')
        .where('tenantId', '=', this.tenantId)
        .where('role', '=', 'admin')
        .where('status', '=', 'active')
        .execute();
      if (!effectiveTenantSettings(tenant?.settings).adminSelfApproval && admins.length > 1)
        throw new ProblemError('approval.own_object');
    }
    return this.tx(
      async (trx) => {
        const row = await this.rowOf(trx, id);
        if (row.status !== 'open') throw notOpen();
        if (expectedVersion !== undefined && expectedVersion !== row.version)
          throw new ProblemError('resource.version_conflict');
        const project = await trx
          .selectFrom('project')
          .select(['id', 'name', 'version', 'approvalStatus', 'deletedAt'])
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', row.projectId)
          .executeTakeFirst();
        if (!project || project.deletedAt !== null) throw notFound();
        const { proposal } = parseStored(row.proposal);
        if (input.decision === 'approved') {
          if (project.approvalStatus !== 'approved')
            throw new ProblemError('approval.not_allowed', [
              { path: 'approvalStatus', message: `${project.approvalStatus} → change_request` },
            ]);
          if (project.version !== input.projectVersion)
            throw new ProblemError('change_request.conflict', [
              { path: 'projectVersion', message: `aktuell ${String(project.version)}` },
            ]);
          await this.apply(trx, row.projectId, proposal, now);
        }
        const votes = await this.voteSnapshot(trx, id);
        const updated = await trx
          .updateTable('changeRequest')
          .set({
            status: input.decision,
            decidedBy: me,
            decidedAt: now,
            decisionComment: input.comment,
            finalVotes: json(votes),
            submitterRank: null,
            version: row.version + 1,
            updatedAt: now,
          })
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', id)
          .returningAll()
          .executeTakeFirstOrThrow();
        await renumberRanks(trx, this.tenantId, row.requestedBy);
        await this.notify(
          trx,
          [row.requestedBy],
          'change_request.decided',
          row.projectId,
          {
            name: project.name,
            decision: input.decision,
            comment: input.comment,
            changeRequestId: id,
          },
          now,
        );
        return (await this.records([updated], trx))[0] as ChangeRequestRecord;
      },
      [
        { table: 'change_request', id },
        { table: 'project', id: head.projectId },
      ],
    );
  }

  /** Nur die beantragten Felder übernehmen (FA-FRG-08); Änderungsprotokoll und Version wie beim Bearbeiten. */
  private async apply(trx: Tx, projectId: string, p: StoredChangeRequestProposal, now: Date) {
    const projects = new ProjectRepository(trx, this.ctx);
    const fields = {
      ...(p.descriptionMd !== undefined ? { descriptionMd: p.descriptionMd } : {}),
      ...(p.startDate !== undefined ? { startDate: p.startDate } : {}),
      ...(p.dueDate !== undefined ? { dueDate: p.dueDate } : {}),
      ...(p.conditions && Object.keys(p.conditions).length > 0 ? { conditions: p.conditions } : {}),
    };
    if (Object.keys(fields).length > 0) await projects.patchIn(trx, projectId, fields, now);
    for (const change of p.lines)
      await projects.patchLineIn(
        trx,
        projectId,
        change.lineId,
        {
          ...(change.plannedCount !== undefined ? { plannedCount: change.plannedCount } : {}),
          ...(change.enabled !== undefined ? { enabled: change.enabled } : {}),
        },
        now,
      );
    for (const add of p.newLines) {
      const { filterShortName: _name, ...line } = add;
      void _name;
      await projects.addLineIn(trx, projectId, line, now);
    }
  }

  // ---- Stimmen ------------------------------------------------------------------------------------

  private async voterIds(trx: Tx, id: string): Promise<string[]> {
    const rows = await trx
      .selectFrom('queueVote')
      .select('voterId')
      .where('tenantId', '=', this.tenantId)
      .where('subjectKind', '=', KIND)
      .where('subjectId', '=', id)
      .execute();
    return rows.map((r) => r.voterId);
  }

  private async voteSnapshot(trx: Tx, id: string) {
    const rows = await trx
      .selectFrom('queueVote as v')
      .innerJoin('appUser as u', 'u.id', 'v.voterId')
      .select(['v.voterId', 'u.displayName'])
      .where('v.tenantId', '=', this.tenantId)
      .where('v.subjectKind', '=', KIND)
      .where('v.subjectId', '=', id)
      .where('u.status', '=', 'active')
      .orderBy('v.createdAt')
      .execute();
    return {
      count: rows.length,
      voterIds: rows.map((r) => r.voterId),
      names: rows.map((r) => r.displayName),
    };
  }

  /** Stimme für einen offenen Antrag (nicht den eigenen, FA-FRG-14). */
  vote(id: string, on: boolean, now: Date): Promise<VoteSummary> {
    const me = this.me;
    return this.tx(
      async (trx) => {
        const row = await this.rowOf(trx, id);
        if (row.requestedBy === me) throw new ProblemError('vote.own_object');
        if (row.status !== 'open') throw new ProblemError('vote.closed');
        if (on)
          await trx
            .insertInto('queueVote')
            .values({
              tenantId: this.tenantId,
              subjectKind: KIND,
              subjectId: id,
              projectId: row.projectId,
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
            .where('subjectKind', '=', KIND)
            .where('subjectId', '=', id)
            .where('voterId', '=', me)
            .execute();
        const [record] = await this.records([row], trx);
        return (await this.voteSummaries([record as ChangeRequestRecord], trx))[0] as VoteSummary;
      },
      [{ table: 'change_request', id }],
    );
  }

  async acknowledge(id: string, now: Date): Promise<void> {
    await this.rowOf(this.db, id);
    await retryOcc(() =>
      this.db
        .updateTable('queueVote')
        .set({ acknowledgedAt: now })
        .where('tenantId', '=', this.tenantId)
        .where('subjectKind', '=', KIND)
        .where('subjectId', '=', id)
        .where('voterId', '=', this.me)
        .execute(),
    );
  }

  async voteSummaries(
    records: readonly ChangeRequestRecord[],
    db: Tx | Kysely<Database> = this.db,
  ): Promise<VoteSummary[]> {
    const ids = records.map((r) => r.row.id);
    const rows =
      ids.length === 0
        ? []
        : await db
            .selectFrom('queueVote as v')
            .innerJoin('appUser as u', 'u.id', 'v.voterId')
            .select(['v.subjectId', 'v.voterId', 'v.acknowledgedAt', 'u.displayName'])
            .where('v.tenantId', '=', this.tenantId)
            .where('v.subjectKind', '=', KIND)
            .where('v.subjectId', 'in', ids)
            .where('u.status', '=', 'active')
            .orderBy('v.createdAt')
            .execute();
    return records.map((r) => {
      const changed = r.row.contentChangedAt ? new Date(r.row.contentChangedAt).getTime() : null;
      const voters = rows
        .filter((v) => v.subjectId === r.row.id)
        .map((v) => ({
          memberId: v.voterId,
          displayName: v.displayName,
          changedSinceVote: changed !== null && changed > new Date(v.acknowledgedAt).getTime(),
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

  /** Rang beim Einreicher „n von m“ über Einreichungen und offene Anträge (FA-FRG-15). */
  async ranks(records: readonly ChangeRequestRecord[]) {
    const users = [...new Set(records.map((r) => r.row.requestedBy))];
    if (users.length === 0) return [];
    const [projects, requests] = await Promise.all([
      this.db
        .selectFrom('project')
        .select(['createdBy', (eb) => eb.fn.countAll<string>().as('n')])
        .where('tenantId', '=', this.tenantId)
        .where('approvalStatus', '=', 'submitted')
        .where('deletedAt', 'is', null)
        .where('createdBy', 'in', users)
        .groupBy('createdBy')
        .execute(),
      openRequests(this.db, this.tenantId)
        .select(['c.requestedBy', (eb) => eb.fn.countAll<string>().as('n')])
        .where('c.requestedBy', 'in', users)
        .groupBy('c.requestedBy')
        .execute(),
    ]);
    return records.map((r) => {
      const of =
        Number(projects.find((x) => x.createdBy === r.row.requestedBy)?.n ?? 0) +
        Number(requests.find((x) => x.requestedBy === r.row.requestedBy)?.n ?? 0);
      return r.row.submitterRank ? { rank: r.row.submitterRank, of } : null;
    });
  }
}
