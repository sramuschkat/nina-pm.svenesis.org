/**
 * Transit-Beobachtungen (AP-43; FA-EXO-18…21, 33; FA-FRG-09; transit.md §8): festlegen bzw. wünschen, aufheben,
 * bestätigen/ablehnen (Warteschlange), Übernahme bei der Freigabe sowie Verfall und Abschluss im Zeitplan
 * `tick-5min`. Konflikte auf dem Rig prüft `transitConflict` (shared) **in** der Transaktion; die Rig-Zeile ist
 * dabei gesperrt (`guard`), damit zwei gleichzeitige Festlegungen nicht beide durchkommen.
 */
import {
  ProblemError,
  transitConflict,
  type FieldError,
  type NotificationKind,
  type RigObservation,
  type TransitConflict,
  type TransitLine,
} from '@nina-pm/shared';
import type { Kysely, Selectable, Transaction } from 'kysely';
import { withTx } from '../tx';
import type { Database, TransitObservationTable } from '../types';
import { TenantRepo } from './base';
import { enqueueDiscordEvent } from './discord';
import { insertNotifications } from './notification';
import { renumberRanks } from './ranks';

type Tx = Transaction<Database>;
type Db = Kysely<Database> | Tx;
export type ObservationRow = Selectable<TransitObservationTable>;

export interface ObservationInsert {
  readonly projectId: string;
  readonly ephemerisId: string;
  readonly epoch: number;
  readonly night: string;
  readonly ingressUtc: Date;
  readonly midUtc: Date;
  readonly egressUtc: Date;
  readonly windowStartUtc: Date;
  readonly windowEndUtc: Date;
  readonly baselineBeforeMin: number;
  readonly baselineAfterMin: number;
  readonly bufferMin: number;
  readonly plannedCount: number;
  readonly confirmDeadlineUtc: Date;
}

export interface LockInput {
  readonly observation: ObservationInsert;
  readonly rigId: string;
  readonly planet: string;
  /** `wish` vor der Freigabe, `request` Bestätigung nötig, `lock` sofort (transit.md §8). */
  readonly mode: 'wish' | 'request' | 'lock';
  /** Obergrenze offener Beobachtungen; `null` = keine (Admin). */
  readonly maxOpen: number | null;
  readonly line: TransitLine | null;
}

const OPEN = ['requested', 'locked'] as const;
const notFound = () => new ProblemError('resource.not_found');
const ms = (d: Date | string) => new Date(d).getTime();
const iso = (d: Date | string) => new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Erste aktive Zeile des Projekts als Transit-Zeile (FA-EXO-20: genau eine aktive Zeile). */
export async function transitLine(db: Db, tenantId: string, projectId: string) {
  const row = await db
    .selectFrom('exposureLine')
    .select(['id', 'filterId', 'exposureS', 'gain', 'offsetAdu', 'binning', 'readoutMode'])
    .where('tenantId', '=', tenantId)
    .where('projectId', '=', projectId)
    .where('enabled', '=', true)
    .where('deletedAt', 'is', null)
    .orderBy('orderIndex')
    .orderBy('id')
    .executeTakeFirst();
  if (!row) return null;
  return {
    id: row.id,
    line: {
      filterId: row.filterId,
      exposureS: Number(row.exposureS),
      gain: row.gain,
      offsetAdu: row.offsetAdu,
      binning: row.binning,
      readoutMode: row.readoutMode,
    } satisfies TransitLine,
  };
}

/**
 * Offene Beobachtungen auf einem Rig (FA-EXO-33): festgelegte sowie gewünschte freigegebener Projekte (Wünsche aus
 * Entwürfen belegen nichts), Fensterende nach `now`, Projekte nicht gelöscht.
 */
export async function rigObservations(
  db: Db,
  tenantId: string,
  rigId: string,
  now: Date,
): Promise<RigObservation[]> {
  const rows = await db
    .selectFrom('transitObservation as o')
    .innerJoin('project as p', 'p.id', 'o.projectId')
    .innerJoin('exoProject as x', 'x.projectId', 'o.projectId')
    .leftJoin('appUser as u', (j) =>
      j.onRef('u.id', '=', 'p.createdBy').on('u.tenantId', '=', tenantId),
    )
    .select([
      'o.id',
      'o.projectId',
      'p.name as projectName',
      'p.createdBy',
      'u.displayName as createdByName',
      'x.planet',
      'o.epoch',
      'o.windowStartUtc',
      'o.windowEndUtc',
      'o.status',
      'o.lockedAt',
      'o.createdAt',
      'o.primaryObservationId',
    ])
    .where('o.tenantId', '=', tenantId)
    .where('p.tenantId', '=', tenantId)
    .where('x.tenantId', '=', tenantId)
    .where('p.deletedAt', 'is', null)
    .where((eb) => eb.or([eb('p.rigId', '=', rigId), eb('p.requestedRigId', '=', rigId)]))
    .where((eb) =>
      eb.or([
        eb('o.status', '=', 'locked'),
        eb.and([eb('o.status', '=', 'requested'), eb('p.approvalStatus', '=', 'approved')]),
      ]),
    )
    .where('o.windowEndUtc', '>', now)
    .orderBy('o.id')
    .execute();
  const out: RigObservation[] = [];
  for (const r of rows) {
    const l = await transitLine(db, tenantId, r.projectId);
    out.push({
      id: r.id,
      projectId: r.projectId,
      projectName: r.projectName,
      createdBy: r.createdBy,
      createdByName: r.createdByName ?? '',
      planet: r.planet,
      epoch: r.epoch,
      windowStartMs: ms(r.windowStartUtc),
      windowEndMs: ms(r.windowEndUtc),
      status: r.status as 'requested' | 'locked',
      orderMs: ms(r.lockedAt ?? r.createdAt),
      primaryObservationId: r.primaryObservationId,
      line: l?.line ?? null,
    });
  }
  return out;
}

/** Konflikt als Problem Details (409) mit der belegenden Beobachtung in `errors[]`. */
export function conflictProblem(c: Exclude<TransitConflict, { kind: 'share' }>): ProblemError {
  const w = c.with;
  const errors: FieldError[] = [
    {
      path: 'epoch',
      message: `${w.projectName} (${w.createdByName}) ${new Date(w.windowStartMs).toISOString()} – ${new Date(w.windowEndMs).toISOString()}`,
    },
  ];
  return new ProblemError(
    c.kind === 'overlap' ? 'transit.window_overlap' : 'transit.share_mismatch',
    errors,
  );
}

/** Richtwert der nächsten offenen Beobachtung auf die aktive Zeile übertragen (FA-EXO-20, transit.md §8). */
async function syncLinePlanned(trx: Tx, tenantId: string, projectId: string, now: Date) {
  const next = await trx
    .selectFrom('transitObservation')
    .select('plannedCount')
    .where('tenantId', '=', tenantId)
    .where('projectId', '=', projectId)
    .where('status', 'in', [...OPEN])
    .where('windowEndUtc', '>', now)
    .orderBy('windowStartUtc')
    .orderBy('id')
    .executeTakeFirst();
  const line = await transitLine(trx, tenantId, projectId);
  if (!next || !line) return;
  await trx
    .updateTable('exposureLine')
    .set({ plannedCount: next.plannedCount, updatedAt: now })
    .where('tenantId', '=', tenantId)
    .where('id', '=', line.id)
    .where('plannedCount', '!=', next.plannedCount)
    .execute();
}

/** Verknüpfte Beobachtungen einer aufgehobenen primären: die nächstfrühere wird primär (FA-EXO-33a). */
async function repointShared(trx: Tx, tenantId: string, primaryId: string) {
  const linked = await trx
    .selectFrom('transitObservation')
    .select(['id', 'lockedAt', 'createdAt'])
    .where('tenantId', '=', tenantId)
    .where('primaryObservationId', '=', primaryId)
    .where('status', 'in', [...OPEN])
    .execute();
  const sorted = linked.sort(
    (a, b) =>
      ms(a.lockedAt ?? a.createdAt) - ms(b.lockedAt ?? b.createdAt) || (a.id < b.id ? -1 : 1),
  );
  const [first, ...rest] = sorted;
  if (!first) return;
  await trx
    .updateTable('transitObservation')
    .set({ primaryObservationId: null })
    .where('tenantId', '=', tenantId)
    .where('id', '=', first.id)
    .execute();
  if (rest.length > 0)
    await trx
      .updateTable('transitObservation')
      .set({ primaryObservationId: first.id })
      .where('tenantId', '=', tenantId)
      .where(
        'id',
        'in',
        rest.map((r) => r.id),
      )
      .execute();
}

async function activeAdmins(db: Db, tenantId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('appUser')
    .select('id')
    .where('tenantId', '=', tenantId)
    .where('role', '=', 'admin')
    .where('status', '=', 'active')
    .execute();
  return rows.map((r) => r.id);
}

/** Festlegen einer gewünschten Beobachtung mit erneuter Konfliktprüfung (Freigabe, Bestätigung). */
async function lockExisting(
  trx: Tx,
  tenantId: string,
  o: ObservationRow,
  rigId: string,
  actorId: string | null,
  now: Date,
) {
  const planet = await trx
    .selectFrom('exoProject')
    .select('planet')
    .where('tenantId', '=', tenantId)
    .where('projectId', '=', o.projectId)
    .executeTakeFirst();
  const line = await transitLine(trx, tenantId, o.projectId);
  const others = (await rigObservations(trx, tenantId, rigId, now)).filter((x) => x.id !== o.id);
  const conflict = transitConflict(
    {
      projectId: o.projectId,
      planet: planet?.planet ?? '',
      epoch: o.epoch,
      windowStartMs: ms(o.windowStartUtc),
      windowEndMs: ms(o.windowEndUtc),
      line: line?.line ?? null,
    },
    others,
  );
  if (conflict && conflict.kind !== 'share') throw conflictProblem(conflict);
  await trx
    .updateTable('transitObservation')
    .set({
      status: 'locked',
      lockedAt: now,
      lockedBy: actorId,
      primaryObservationId: conflict?.kind === 'share' ? conflict.primary.id : null,
    })
    .where('tenantId', '=', tenantId)
    .where('id', '=', o.id)
    .execute();
}

/**
 * Freigabe eines Exoplaneten-Projekts (transit.md §8): der Wunsch mit Fensterende in der Zukunft wird festgelegt
 * (Konflikt → 409), vergangene Wünsche werden storniert. Aufruf in der Transaktion der Freigabe.
 */
export async function lockWishesOnApprove(
  trx: Tx,
  tenantId: string,
  projectId: string,
  rigId: string,
  actorId: string | null,
  now: Date,
): Promise<void> {
  const wishes = await trx
    .selectFrom('transitObservation')
    .selectAll()
    .where('tenantId', '=', tenantId)
    .where('projectId', '=', projectId)
    .where('status', '=', 'requested')
    .execute();
  for (const w of wishes) {
    if (ms(w.windowEndUtc) <= now.getTime()) {
      await trx
        .updateTable('transitObservation')
        .set({ status: 'cancelled' })
        .where('tenantId', '=', tenantId)
        .where('id', '=', w.id)
        .execute();
      continue;
    }
    await lockExisting(trx, tenantId, w, rigId, actorId, now);
  }
  await syncLinePlanned(trx, tenantId, projectId, now);
}

/** *Ablehnen* eines eingereichten Projekts storniert dessen Wünsche. */
export async function cancelWishes(trx: Tx, tenantId: string, projectId: string): Promise<void> {
  await trx
    .updateTable('transitObservation')
    .set({ status: 'cancelled' })
    .where('tenantId', '=', tenantId)
    .where('projectId', '=', projectId)
    .where('status', '=', 'requested')
    .execute();
}

export interface PendingConfirmation {
  readonly observation: ObservationRow;
  readonly projectName: string;
  readonly planet: string;
  readonly createdBy: string;
  readonly createdByName: string;
  readonly rigId: string | null;
}

export class TransitRepository extends TenantRepo {
  private get tenantId() {
    return this.ctx.tenantId;
  }

  /** Beobachtungen eines Projekts, neueste Nacht zuerst, mit Namen des Festlegenden. */
  async observations(projectId: string) {
    const rows = await this.db
      .selectFrom('transitObservation as o')
      .leftJoin('appUser as u', (j) =>
        j.onRef('u.id', '=', 'o.lockedBy').on('u.tenantId', '=', this.tenantId),
      )
      .selectAll('o')
      .select('u.displayName as lockedByName')
      .where('o.tenantId', '=', this.tenantId)
      .where('o.projectId', '=', projectId)
      .orderBy('o.windowStartUtc', 'desc')
      .orderBy('o.id')
      .execute();
    return rows;
  }

  rigObservations(rigId: string, now: Date) {
    return rigObservations(this.db, this.tenantId, rigId, now);
  }

  async observation(id: string) {
    return this.db
      .selectFrom('transitObservation')
      .selectAll()
      .where('tenantId', '=', this.tenantId)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  /**
   * Festlegen bzw. wünschen (FA-EXO-18). Idempotent je Epoche: gibt es schon eine offene eigene Beobachtung dieser
   * Epoche, kommt sie zurück. Vor der Freigabe ersetzt ein Wunsch den bisherigen (höchstens einer).
   */
  lock(input: LockInput, now: Date): Promise<string> {
    const o = input.observation;
    return withTx(
      this.db,
      async (trx) => {
        const same = await trx
          .selectFrom('transitObservation')
          .select('id')
          .where('tenantId', '=', this.tenantId)
          .where('projectId', '=', o.projectId)
          .where('epoch', '=', o.epoch)
          .where('status', 'in', [...OPEN])
          .executeTakeFirst();
        if (same) return same.id;
        if (input.mode === 'wish')
          await trx
            .updateTable('transitObservation')
            .set({ status: 'cancelled' })
            .where('tenantId', '=', this.tenantId)
            .where('projectId', '=', o.projectId)
            .where('status', '=', 'requested')
            .execute();
        if (input.maxOpen !== null && input.mode !== 'wish') {
          const open = await trx
            .selectFrom('transitObservation')
            .select((eb) => eb.fn.countAll<string>().as('n'))
            .where('tenantId', '=', this.tenantId)
            .where('projectId', '=', o.projectId)
            .where('status', 'in', [...OPEN])
            .where('windowEndUtc', '>', now)
            .executeTakeFirst();
          if (Number(open?.n ?? 0) >= input.maxOpen)
            throw new ProblemError('transit.too_many_open', [
              { path: 'epoch', message: `höchstens ${String(input.maxOpen)} offen` },
            ]);
        }
        let primary: string | null = null;
        if (input.mode !== 'wish') {
          const conflict = transitConflict(
            {
              projectId: o.projectId,
              planet: input.planet,
              epoch: o.epoch,
              windowStartMs: o.windowStartUtc.getTime(),
              windowEndMs: o.windowEndUtc.getTime(),
              line: input.line,
            },
            await rigObservations(trx, this.tenantId, input.rigId, now),
          );
          if (conflict && conflict.kind !== 'share') throw conflictProblem(conflict);
          primary = conflict?.kind === 'share' ? conflict.primary.id : null;
        }
        const locked = input.mode === 'lock';
        const row = await trx
          .insertInto('transitObservation')
          .values({
            tenantId: this.tenantId,
            ...o,
            status: locked ? 'locked' : 'requested',
            lockedAt: locked ? now : null,
            lockedBy: locked ? (this.ctx.memberId ?? null) : null,
            primaryObservationId: primary,
            createdAt: now,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await syncLinePlanned(trx, this.tenantId, o.projectId, now);
        if (input.mode === 'request')
          await insertNotifications(trx, {
            tenantId: this.tenantId,
            recipients: (await activeAdmins(trx, this.tenantId)).filter(
              (r) => r !== this.ctx.memberId,
            ),
            kind: 'transit.confirmation_needed',
            projectId: o.projectId,
            payload: { planet: input.planet, night: o.night, observationId: row.id },
            now,
          });
        return row.id;
      },
      {
        guard: [
          { table: 'project', id: o.projectId, tenantId: this.tenantId },
          { table: 'rig', id: input.rigId, tenantId: this.tenantId },
        ],
      },
    );
  }

  /** Aufheben (→ storniert), solange das Fenster nicht vorbei ist (transit.md §8). */
  cancel(projectId: string, observationId: string, now: Date): Promise<void> {
    return withTx(
      this.db,
      async (trx) => {
        const o = await trx
          .selectFrom('transitObservation')
          .selectAll()
          .where('tenantId', '=', this.tenantId)
          .where('projectId', '=', projectId)
          .where('id', '=', observationId)
          .executeTakeFirst();
        if (!o) throw notFound();
        if (!OPEN.includes(o.status as 'locked') || ms(o.windowEndUtc) <= now.getTime())
          throw new ProblemError('transit.lock_not_allowed', [
            { path: 'observationId', message: `Status ${o.status}` },
          ]);
        await trx
          .updateTable('transitObservation')
          .set({ status: 'cancelled', primaryObservationId: null })
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', o.id)
          .execute();
        if (o.primaryObservationId === null) await repointShared(trx, this.tenantId, o.id);
        await syncLinePlanned(trx, this.tenantId, projectId, now);
      },
      { guard: [{ table: 'project', id: projectId, tenantId: this.tenantId }] },
    );
  }

  /** Warteschlange: gewünschte Beobachtungen freigegebener Projekte (Transit-Bestätigung, FA-EXO-18). */
  async pendingConfirmations(): Promise<PendingConfirmation[]> {
    const rows = await this.db
      .selectFrom('transitObservation as o')
      .innerJoin('project as p', 'p.id', 'o.projectId')
      .innerJoin('exoProject as x', 'x.projectId', 'o.projectId')
      .leftJoin('appUser as u', (j) =>
        j.onRef('u.id', '=', 'p.createdBy').on('u.tenantId', '=', this.tenantId),
      )
      .selectAll('o')
      .select([
        'p.name as projectName',
        'x.planet',
        'p.createdBy',
        'u.displayName as createdByName',
        'p.rigId',
      ])
      .where('o.tenantId', '=', this.tenantId)
      .where('p.tenantId', '=', this.tenantId)
      .where('x.tenantId', '=', this.tenantId)
      .where('o.status', '=', 'requested')
      .where('p.approvalStatus', '=', 'approved')
      .where('p.deletedAt', 'is', null)
      .orderBy('o.confirmDeadlineUtc')
      .orderBy('o.id')
      .execute();
    return rows.map((r) => {
      const { projectName, planet, createdBy, createdByName, rigId, ...observation } = r;
      return {
        observation,
        projectName,
        planet,
        createdBy,
        createdByName: createdByName ?? '',
        rigId,
      };
    });
  }

  /** Offene Wünsche je Projekt (für eingereichte Exoplaneten-Projekte in der Warteschlange). */
  async wishes(projectIds: readonly string[]) {
    if (projectIds.length === 0) return [];
    return this.db
      .selectFrom('transitObservation')
      .selectAll()
      .where('tenantId', '=', this.tenantId)
      .where('projectId', 'in', [...projectIds])
      .where('status', '=', 'requested')
      .execute();
  }

  /** Bestätigen (→ festgelegt, Konfliktprüfung) bzw. ablehnen (→ storniert); Ersteller wird benachrichtigt. */
  decide(
    observationId: string,
    decision: 'confirm' | 'decline',
    comment: string | null,
    now: Date,
  ): Promise<{ projectId: string }> {
    return withTx(this.db, async (trx) => {
      const o = await trx
        .selectFrom('transitObservation')
        .selectAll()
        .where('tenantId', '=', this.tenantId)
        .where('id', '=', observationId)
        .executeTakeFirst();
      if (!o) throw notFound();
      const p = await trx
        .selectFrom('project')
        .select(['id', 'name', 'createdBy', 'rigId', 'approvalStatus', 'deletedAt'])
        .where('tenantId', '=', this.tenantId)
        .where('id', '=', o.projectId)
        .forUpdate()
        .executeTakeFirst();
      if (!p || p.deletedAt !== null) throw notFound();
      if (o.status !== 'requested' || p.approvalStatus !== 'approved' || !p.rigId)
        throw new ProblemError('transit.lock_not_allowed', [
          { path: 'observationId', message: `Status ${o.status}` },
        ]);
      if (decision === 'confirm') {
        await sqlLockRig(trx, this.tenantId, p.rigId);
        await lockExisting(trx, this.tenantId, o, p.rigId, this.ctx.memberId ?? null, now);
      } else
        await trx
          .updateTable('transitObservation')
          .set({ status: 'cancelled' })
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', o.id)
          .execute();
      await syncLinePlanned(trx, this.tenantId, o.projectId, now);
      const kind: NotificationKind =
        decision === 'confirm' ? 'transit.confirmed' : 'transit.declined';
      await insertNotifications(trx, {
        tenantId: this.tenantId,
        recipients: [p.createdBy].filter((r) => r !== this.ctx.memberId),
        kind,
        projectId: o.projectId,
        payload: { name: p.name, night: o.night, observationId: o.id, comment },
        now,
      });
      return { projectId: o.projectId };
    });
  }
}

/** Rig-Zeile sperren (Serialisierung konkurrierender Festlegungen, transit.md §8). */
async function sqlLockRig(trx: Tx, tenantId: string, rigId: string) {
  await trx
    .selectFrom('rig')
    .select('id')
    .where('tenantId', '=', tenantId)
    .where('id', '=', rigId)
    .forUpdate()
    .execute();
}

export interface SettleResult {
  readonly expired: number;
  readonly observed: number;
  readonly missed: number;
  /** *Beobachtet* mit nachgemeldeten Aufnahmen neu gezählt (ohne neues Discord-Ereignis). */
  readonly recounted?: number;
}

/**
 * Wartezeit nach Fensterende, bevor eine festgelegte Beobachtung abgeschlossen wird (transit.md §8): Die letzte
 * Belichtung der Serie kann über das Fensterende hinauslaufen, und die Aufnahmemeldungen kommen aus dem Postausgang
 * des Plugins erst Sekunden bis Minuten später. Ohne Wartezeit würde eine beobachtete Beobachtung zuerst *verpasst*
 * (Discord „Transit verpasst“) und kurz darauf *beobachtet*.
 */
export const TRANSIT_SETTLE_GRACE_MS = 30 * 60_000;
/** Nachmeldungen werden 14 Tage nach Fensterende noch gezählt (FA-EXO-21). */
const LATE_CAPTURES_MS = 14 * 86_400_000;

/** Aufnahmen einer Beobachtung je Session; verknüpfte zählen die ihrer primären (FA-EXO-33a). */
async function transitCaptures(
  db: Db,
  tenantId: string,
  o: { id: string; primaryObservationId: string | null },
) {
  const captures = await db
    .selectFrom('capture')
    .select(['sessionId', (eb) => eb.fn.countAll<string>().as('n')])
    .where('tenantId', '=', tenantId)
    .where('transitObservationId', '=', o.primaryObservationId ?? o.id)
    .groupBy('sessionId')
    .orderBy('sessionId')
    .execute();
  return { captures, count: captures.reduce((s, c) => s + Number(c.n), 0) };
}

/**
 * Zeitplan `tick-5min` (transit.md §8, FA-FRG-09, FA-EXO-21) über alle Mandanten:
 * - gewünscht und Frist verstrichen → storniert; eingereichtes Projekt → zurückgegeben („Frist verpasst“);
 * - festgelegt und Fensterende + `TRANSIT_SETTLE_GRACE_MS` erreicht → beobachtet (Aufnahmen vorhanden) bzw. verpasst;
 * - verpasst mit nachgemeldeten Aufnahmen (≤ 14 Tage) → beobachtet;
 * - beobachtet mit weiteren nachgemeldeten Aufnahmen (≤ 14 Tage) → Anzahl neu gezählt, ohne neues Ereignis.
 * Verknüpfte Beobachtungen zählen die Aufnahmen ihrer primären.
 */
export async function settleTransits(db: Kysely<Database>, now: Date): Promise<SettleResult> {
  let expired = 0;
  let observed = 0;
  let missed = 0;
  let recounted = 0;
  const settleBefore = new Date(now.getTime() - TRANSIT_SETTLE_GRACE_MS);
  const due = await db
    .selectFrom('transitObservation')
    .select(['id', 'tenantId', 'projectId', 'status', 'primaryObservationId', 'acquiredCount'])
    .where((eb) =>
      eb.or([
        eb.and([eb('status', '=', 'requested'), eb('confirmDeadlineUtc', '<', now)]),
        eb.and([eb('status', '=', 'locked'), eb('windowEndUtc', '<=', settleBefore)]),
        eb.and([
          eb('status', 'in', ['missed', 'observed']),
          eb('windowEndUtc', '>', new Date(now.getTime() - LATE_CAPTURES_MS)),
        ]),
      ]),
    )
    .orderBy('tenantId')
    .orderBy('id')
    .execute();
  for (const d of due) {
    // Nachmeldungen: ohne neue Aufnahmen keine Transaktion (läuft alle 5 min über 14 Tage).
    if (d.status === 'missed' || d.status === 'observed') {
      const { count } = await transitCaptures(db, d.tenantId, d);
      if (d.status === 'missed' ? count === 0 : count === Number(d.acquiredCount)) continue;
    }
    const result = await withTx(
      db,
      async (trx) => {
        const o = await trx
          .selectFrom('transitObservation')
          .selectAll()
          .where('tenantId', '=', d.tenantId)
          .where('id', '=', d.id)
          .executeTakeFirst();
        if (!o) return null;
        if (o.status === 'requested') {
          if (!o.confirmDeadlineUtc || ms(o.confirmDeadlineUtc) >= now.getTime()) return null;
          const p = await trx
            .selectFrom('project')
            .selectAll()
            .where('tenantId', '=', d.tenantId)
            .where('id', '=', o.projectId)
            .executeTakeFirst();
          await trx
            .updateTable('transitObservation')
            .set({ status: 'cancelled' })
            .where('tenantId', '=', d.tenantId)
            .where('id', '=', o.id)
            .execute();
          if (p && p.deletedAt === null && p.approvalStatus === 'approved')
            await insertNotifications(trx, {
              tenantId: d.tenantId,
              recipients: [p.createdBy],
              kind: 'transit.expired',
              projectId: p.id,
              payload: { name: p.name, night: o.night, observationId: o.id },
              now,
            });
          if (p && p.deletedAt === null && p.approvalStatus === 'submitted') {
            await trx
              .updateTable('project')
              .set({
                approvalStatus: 'returned',
                submitterRank: null,
                version: p.version + 1,
                effortStale: true,
                updatedAt: now,
              })
              .where('tenantId', '=', d.tenantId)
              .where('id', '=', p.id)
              .execute();
            await renumberRanks(trx, d.tenantId, p.createdBy);
            await trx
              .insertInto('approvalEvent')
              .values({
                tenantId: d.tenantId,
                projectId: p.id,
                userId: null,
                action: 'expired',
                comment: 'Frist verpasst',
                snapshot: JSON.stringify({
                  rank: p.submitterRank,
                  transitDeadline: iso(o.confirmDeadlineUtc),
                }),
                createdAt: now,
              })
              .execute();
            await insertNotifications(trx, {
              tenantId: d.tenantId,
              recipients: [p.createdBy],
              kind: 'approval.expired',
              projectId: p.id,
              payload: { name: p.name, transitDeadline: iso(o.confirmDeadlineUtc) },
              now,
            });
          }
          return 'expired' as const;
        }
        if (ms(o.windowEndUtc) > settleBefore.getTime()) return null;
        // Aufnahmen hängen an der primären Beobachtung (FA-EXO-33a).
        const { captures, count } = await transitCaptures(trx, d.tenantId, o);
        if (o.status === 'observed') {
          // Schon gemeldet: nur die Anzahl nachziehen, kein zweites Discord-Ereignis.
          if (count === Number(o.acquiredCount)) return null;
          await trx
            .updateTable('transitObservation')
            .set({ acquiredCount: count })
            .where('tenantId', '=', d.tenantId)
            .where('id', '=', o.id)
            .execute();
          return 'recounted' as const;
        }
        if (o.status !== 'locked' && o.status !== 'missed') return null;
        // Discord „Transit beobachtet/verpasst“ (FA-DIS-03, AP-60): Name, Abdeckung, Ein-/Austritt in Standortzeit.
        const discord = async (eventKey: 'transit.observed' | 'transit.missed') => {
          const p = await trx
            .selectFrom('project as p')
            .leftJoin('rig as r', (j) =>
              j.onRef('r.id', '=', 'p.rigId').onRef('r.tenantId', '=', 'p.tenantId'),
            )
            .leftJoin('site as s', (j) =>
              j.onRef('s.id', '=', 'r.siteId').onRef('s.tenantId', '=', 'r.tenantId'),
            )
            .select(['p.name', 's.timeZone'])
            .where('p.tenantId', '=', d.tenantId)
            .where('p.id', '=', o.projectId)
            .executeTakeFirst();
          const planned = Number(o.plannedCount);
          await enqueueDiscordEvent(trx, {
            tenantId: d.tenantId,
            eventKey,
            objectId: o.id,
            data: {
              planet: p?.name ?? '',
              projectId: o.projectId,
              coveragePct: planned > 0 ? Math.min(100, (100 * count) / planned) : null,
              startUtc: iso(o.ingressUtc),
              endUtc: iso(o.egressUtc),
              siteTimeZone: p?.timeZone ?? null,
            },
            now,
          });
        };
        if (count === 0) {
          if (o.status === 'missed') return null;
          await trx
            .updateTable('transitObservation')
            .set({ status: 'missed' })
            .where('tenantId', '=', d.tenantId)
            .where('id', '=', o.id)
            .execute();
          await discord('transit.missed');
          return 'missed' as const;
        }
        await trx
          .updateTable('transitObservation')
          .set({
            status: 'observed',
            acquiredCount: count,
            sessionId: captures[0]?.sessionId ?? null,
          })
          .where('tenantId', '=', d.tenantId)
          .where('id', '=', o.id)
          .execute();
        await discord('transit.observed');
        return 'observed' as const;
      },
      { guard: [{ table: 'transit_observation', id: d.id, tenantId: d.tenantId }] },
    );
    if (result === 'expired') expired += 1;
    if (result === 'observed') observed += 1;
    if (result === 'missed') missed += 1;
    if (result === 'recounted') recounted += 1;
  }
  return { expired, observed, missed, ...(recounted > 0 ? { recounted } : {}) };
}
