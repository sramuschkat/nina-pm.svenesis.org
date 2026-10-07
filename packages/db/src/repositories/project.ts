/**
 * Projekte (AP-11a; FA-PRJ-01…22, FK 8.4, TK 6.3/6.4/6.6/7.2): Projekte mit Panels und Belichtungszeilen,
 * Zähler, Status nach `projectStatusTransitions`, Priorität je Rig, Favoriten, Notizen, Verlauf,
 * Rig-Wechsel-Prüfung (FA-RIG-12) und Papierkorb (E4). Jede Abfrage ist mandantengebunden.
 *
 * - Projekte werden **immer** weich gelöscht (`deleted_at`); gelöschte Projekte erscheinen nur in der
 *   Ansicht „Gelöscht“ und lassen sich unverändert wiederherstellen. Panels und Zeilen mit Aufnahmen
 *   werden weich gelöscht, ohne Aufnahmen endgültig.
 * - Zeilen mit Aufnahmen: Filter, Belichtung, Gain, Offset, Binning, Auslesemodus gesperrt
 *   (`409 line.locked_by_captures`, NT-E3); Duplizieren legt eine neue Zeile mit Zählern 0 an.
 * - Jede Änderung setzt `effort_stale` (Job in AP-13e) und erhöht `version` (`If-Match` → 412).
 * - Verlauf: Änderungen stehen im `change_log` mit `entity = 'project'` und der Projekt-ID, auch wenn
 *   sie ein Panel oder eine Zeile betreffen (`diff.target`), Freigabeereignisse in `approval_event`.
 */
import {
  autoReactivate,
  autoReadyToProcess,
  canTransition,
  COMMENT_EDIT_WINDOW_MS,
  commentReactions,
  effectiveTenantSettings,
  imageScale,
  LINE_LOCKED_FIELDS,
  LineCreate as LineCreateSchema,
  missingForActivation,
  ProblemError,
  projectProgress,
  type CommentReaction,
  type FieldError,
  type LineCreate,
  type LinePatch,
  type ProjectCreate,
  type ProjectPatch,
  type ProjectStatus,
} from '@nina-pm/shared';
import { sql, type Selectable, type Transaction } from 'kysely';
import { withTx } from '../tx';
import type { Database, ExposureLineTable, ProjectPanelTable, ProjectTable } from '../types';
import { TenantRepo } from './base';
import { EquipmentRepository, type FilterWheelEntry } from './equipment';
import { exoDb } from './exo-catalog';
import { insertNotifications } from './notification';
import { lockSubmitters, nextSubmitterRank, renumberRanks } from './ranks';

type Tx = Transaction<Database>;
export type ProjectRow = Selectable<ProjectTable>;
export type PanelRow = Selectable<ProjectPanelTable>;
export type LineRow = Selectable<ExposureLineTable>;

export interface LineDetail extends LineRow {
  readonly hasCaptures: boolean;
  readonly integrationS: number;
}

export interface ProjectDetail {
  readonly project: ProjectRow;
  readonly panels: readonly (PanelRow & { lines: LineDetail[] })[];
  readonly favorite: boolean;
  readonly overshootPct: number;
  /** `primary_id` des verknüpften Katalogobjekts (Katalogbild, AP-20); `null` ohne Verknüpfung. */
  readonly dsoPrimaryId: string | null;
}

/** Ephemeride zum Speichern am Projekt (FA-EXO-16, Tabelle `ephemeris`). */
export interface EphemerisInsert {
  readonly t0BjdTdb: number;
  readonly t0SigmaD: number | null;
  readonly periodD: number;
  readonly periodSigmaD: number | null;
  readonly durationH: number | null;
  readonly durationEstimated: boolean;
  readonly timeSystemSource: string;
  readonly oMinusCMin: number | null;
  readonly depthMmag: number | null;
  readonly rpOverRs: number | null;
  /** Katalog der Ephemeride. */
  readonly source: string;
  /** Katalogstand als Datum (JJJJ-MM-TT). */
  readonly sourceDate: string | null;
}

/** Exoplaneten-Teil beim Anlegen aus der Transitsuche (FA-EXO-15). */
export interface ExoProjectInsert {
  readonly planet: string;
  readonly star: string;
  readonly catalog: string;
  readonly catalogEntryId: string | null;
  readonly bufferSigma: number;
  /** Katalogzeile (zusammengeführt) als Momentaufnahme. */
  readonly catalogSnapshot: unknown;
  readonly ephemeris: EphemerisInsert;
  /** Transit-Zeile mit dem abgebildeten Filter (FA-EXO-08); `null` ohne passenden Filter. */
  readonly line: { readonly filterId: string; readonly exposureS: number } | null;
}

export interface ProjectMeta {
  readonly id: string;
  readonly createdBy: string;
  readonly approvalStatus: string;
  readonly deletedAt: Date | null;
}

export interface ListFilter {
  readonly deleted?: boolean;
  readonly rigId?: string;
  readonly status?: string;
  readonly approvalStatus?: string;
  readonly mine?: boolean;
  readonly favorites?: boolean;
  /** Admin sieht alle; User nur eigene und fremde außerhalb von Entwurf/Zurückgegeben (FA-BER-02). */
  readonly admin: boolean;
}

/** Kommentar mit Reaktionen (FA-PRJ-17); gelöscht = leerer Text, keine Reaktionen. */
export interface NoteRecord {
  readonly id: string;
  readonly userId: string;
  readonly authorName: string;
  readonly bodyMd: string;
  readonly createdAt: Date;
  readonly parentId: string | null;
  readonly editedAt: Date | null;
  readonly deletedAt: Date | null;
  readonly reactions: readonly {
    readonly emoji: CommentReaction;
    readonly count: number;
    readonly mine: boolean;
  }[];
}

export interface RigConflict {
  readonly code: string;
  readonly lineId: string | null;
  readonly detail: string;
}

const notFound = () => new ProblemError('resource.not_found');
const invalid = (errors: FieldError[]) => new ProblemError('validation.failed', errors);
const json = (v: unknown) => JSON.stringify(v);

/** Bedingungen je Projekt (FA-PRJ-03) für die Ansicht. */
export function conditionsOf(p: ProjectRow) {
  return {
    minAltitudeDeg: p.minAltitudeDeg,
    minTimeOnTargetH: p.minTimeOnTargetH,
    twilight: p.twilight as 'astronomical' | 'nautical' | 'civil',
    moonAvoidanceEnabled: p.moonAvoidanceEnabled,
    moonMustBeDown: p.moonMustBeDown,
    moonSeparationDeg: p.moonSeparationDeg,
    moonWidthDays: p.moonWidthDays,
    moonRelaxScale: p.moonRelaxScale,
    moonMinAltDeg: p.moonMinAltDeg,
    moonMaxAltDeg: p.moonMaxAltDeg,
    moonMaxIlluminationPct: p.moonMaxIlluminationPct,
  };
}

/** Rig des Projekts: freigegeben `rig_id`, sonst der Wunsch `requested_rig_id`. */
export const projectRigId = (p: { rigId: string | null; requestedRigId: string | null }) =>
  p.rigId ?? p.requestedRigId;

/** Felder, die `duplicate` nicht vom Quellprojekt übernimmt (neu gesetzt bzw. Status/Freigabe). */
const DUPLICATE_SKIP = new Set([
  'id',
  'createdAt',
  'updatedAt',
  'version',
  'deletedAt',
  'rigId',
  'requestedRigId',
  'approvalStatus',
  'status',
  'priority',
  'submitterRank',
  'contentChangedAt',
  'completedAt',
  'effortStale',
  'effortTag',
  'effortNights',
  'effortDetail',
  'effortInputHash',
  'effortComputedAt',
  'createdBy',
]);

export class ProjectRepository extends TenantRepo {
  private get tenantId() {
    return this.ctx.tenantId;
  }

  private tx<T>(fn: (trx: Tx) => Promise<T>, guard: { table: string; id: string }[] = []) {
    return withTx(this.db, fn, { guard: guard.map((g) => ({ ...g, tenantId: this.tenantId })) });
  }

  private equipment(trx?: Tx) {
    return new EquipmentRepository(trx ?? this.db, this.ctx);
  }

  private async log(
    trx: Tx,
    projectId: string,
    action: string,
    diff: Record<string, unknown>,
    now: Date,
  ) {
    await trx
      .insertInto('changeLog')
      .values({
        tenantId: this.tenantId,
        entity: 'project',
        entityId: projectId,
        userId: this.ctx.memberId ?? null,
        action,
        diff: json(diff),
        createdAt: now,
      })
      .execute();
  }

  /** Projektzeile inkl. gelöschter (für Rechteprüfung und Wiederherstellen). */
  private row(id: string, trx?: Tx, includeDeleted = false) {
    let q = (trx ?? this.db)
      .selectFrom('project')
      .selectAll()
      .where('tenantId', '=', this.tenantId)
      .where('id', '=', id);
    if (!includeDeleted) q = q.where('deletedAt', 'is', null);
    return q.executeTakeFirst();
  }

  async meta(id: string, includeDeleted = false): Promise<ProjectMeta | undefined> {
    const p = await this.row(id, undefined, includeDeleted);
    return p
      ? {
          id: p.id,
          createdBy: p.createdBy,
          approvalStatus: p.approvalStatus,
          deletedAt: p.deletedAt,
        }
      : undefined;
  }

  private async overshootPct(trx: Tx | Kysely, p: ProjectRow): Promise<number> {
    const rigId = projectRigId(p);
    if (!rigId) return 0;
    const rig = await trx
      .selectFrom('rig')
      .select('overshootPct')
      .where('tenantId', '=', this.tenantId)
      .where('id', '=', rigId)
      .executeTakeFirst();
    return rig?.overshootPct ?? 0;
  }

  /** Zeilen mit Aufnahmen: Zähler > 0 oder gemeldete Aufnahmen (auch unbestätigte Meldungen). */
  private async captureInfo(trx: Tx | Kysely, projectId: string) {
    const rows = await sql<{ lineId: string; integrationS: number; captures: number }>`
      SELECT l.id AS "lineId",
             COALESCE((SELECT SUM(n.integration_s) FROM capture_night n
                        WHERE n.tenant_id = l.tenant_id AND n.exposure_line_id = l.id), 0)::float8 AS "integrationS",
             (l.acquired_count + l.bonus_count
              + (SELECT COUNT(*) FROM capture c WHERE c.tenant_id = l.tenant_id AND c.exposure_line_id = l.id))::int AS "captures"
        FROM exposure_line l
       WHERE l.tenant_id = ${this.tenantId} AND l.project_id = ${projectId}`.execute(trx);
    return new Map(rows.rows.map((r) => [r.lineId, r]));
  }

  async detail(id: string, includeDeleted = false): Promise<ProjectDetail | undefined> {
    const project = await this.row(id, undefined, includeDeleted);
    if (!project) return undefined;
    return this.detailOf(this.db, project);
  }

  private async detailOf(db: Tx | Kysely, project: ProjectRow): Promise<ProjectDetail> {
    const [panels, lines, info, favorite, overshootPct, dso] = await Promise.all([
      db
        .selectFrom('projectPanel')
        .selectAll()
        .where('tenantId', '=', this.tenantId)
        .where('projectId', '=', project.id)
        .where('deletedAt', 'is', null)
        .orderBy('panelIndex')
        .execute(),
      db
        .selectFrom('exposureLine')
        .selectAll()
        .where('tenantId', '=', this.tenantId)
        .where('projectId', '=', project.id)
        .where('deletedAt', 'is', null)
        .orderBy('orderIndex')
        .orderBy('createdAt')
        .execute(),
      this.captureInfo(db, project.id),
      this.ctx.memberId
        ? db
            .selectFrom('favorite')
            .select('projectId')
            .where('tenantId', '=', this.tenantId)
            .where('userId', '=', this.ctx.memberId)
            .where('projectId', '=', project.id)
            .executeTakeFirst()
        : Promise.resolve(undefined),
      this.overshootPct(db, project),
      // Katalog ist systemweit (ohne Mandanten), die Verknüpfung hängt am mandantengebundenen Projekt.
      project.dsoObjectId
        ? db
            .selectFrom('dsoObject')
            .select('primaryId')
            .where('id', '=', project.dsoObjectId)
            .executeTakeFirst()
        : Promise.resolve(undefined),
    ]);
    return {
      project,
      favorite: favorite !== undefined,
      overshootPct,
      dsoPrimaryId: dso?.primaryId ?? null,
      panels: panels.map((panel) => ({
        ...panel,
        lines: lines
          .filter((l) => l.panelId === panel.id)
          .map((l) => ({
            ...l,
            hasCaptures: (info.get(l.id)?.captures ?? 0) > 0,
            integrationS: info.get(l.id)?.integrationS ?? 0,
          })),
      })),
    };
  }

  /** Projektliste (TK 7.2) mit Fortschritt; gelöschte nur mit `deleted` (Ansicht „Gelöscht“). */
  async list(filter: ListFilter) {
    let q = this.db.selectFrom('project').selectAll().where('tenantId', '=', this.tenantId);
    q = filter.deleted ? q.where('deletedAt', 'is not', null) : q.where('deletedAt', 'is', null);
    const rigId = filter.rigId;
    if (rigId)
      q = q.where((eb) => eb.or([eb('rigId', '=', rigId), eb('requestedRigId', '=', rigId)]));
    if (filter.status) q = q.where('status', '=', filter.status);
    if (filter.approvalStatus) q = q.where('approvalStatus', '=', filter.approvalStatus);
    if (filter.mine && this.ctx.memberId) q = q.where('createdBy', '=', this.ctx.memberId);
    if (!filter.admin) {
      const me = this.ctx.memberId ?? '';
      q = q.where((eb) =>
        eb.or([eb('createdBy', '=', me), eb('approvalStatus', 'not in', ['draft', 'returned'])]),
      );
    }
    if (filter.favorites && this.ctx.memberId)
      q = q.where('id', 'in', (eb) =>
        eb
          .selectFrom('favorite')
          .select('projectId')
          .where('tenantId', '=', this.tenantId)
          .where('userId', '=', this.ctx.memberId as string),
      );
    const projects = await q.orderBy('priority').orderBy('name').execute();
    const creators = [...new Set(projects.map((p) => p.createdBy))];
    const names = new Map(
      creators.length === 0
        ? []
        : (
            await this.db
              .selectFrom('appUser')
              .select(['id', 'displayName'])
              .where('tenantId', '=', this.tenantId)
              .where('id', 'in', creators)
              .execute()
          ).map((u) => [u.id, u.displayName] as const),
    );
    const comments = await this.commentCounts(projects.map((p) => p.id));
    return Promise.all(
      projects.map(async (p) => ({
        ...(await this.detailOf(this.db, p)),
        createdByName: names.get(p.createdBy) ?? '',
        commentCount: comments.get(p.id) ?? 0,
      })),
    );
  }

  // ---- Projekt ------------------------------------------------------------------------------------

  private async checkRig(trx: Tx, rigId: string | null, path = 'rigId') {
    if (rigId && !(await this.equipment(trx).rig(rigId, trx)))
      throw invalid([{ path, message: 'Rig unbekannt' }]);
  }

  /** Katalogobjekt muss existieren (sonst Fremdschlüsselfehler statt 422). */
  private async checkDso(trx: Tx, dsoObjectId: string | null | undefined) {
    if (!dsoObjectId) return;
    const row = await trx
      .selectFrom('dsoObject')
      .select('id')
      .where('id', '=', dsoObjectId)
      .executeTakeFirst();
    if (!row) throw invalid([{ path: 'dsoObjectId', message: 'Katalogobjekt unbekannt' }]);
  }

  /**
   * Wiederholte Anlage mit derselben Client-ID (Idempotenz, rules/api.md): nur das **eigene**, nicht
   * gelöschte Projekt kommt zurück. Gehört die ID einem anderen Mitglied oder ist das Projekt gelöscht,
   * `409 resource.in_use` – ohne Inhalte preiszugeben (sonst läse jedes Mitglied fremde Entwürfe).
   */
  private idempotentReplay(trx: Tx, existing: ProjectRow, memberId: string) {
    if (existing.createdBy !== memberId || existing.deletedAt !== null)
      throw new ProblemError('resource.in_use', [{ path: 'id', message: 'ID bereits vergeben' }]);
    return this.detailOf(trx, existing);
  }

  create(input: ProjectCreate, now: Date): Promise<ProjectDetail> {
    const memberId = this.ctx.memberId;
    if (!memberId) throw new ProblemError('permission.denied');
    return this.tx(async (trx) => {
      const existing = await this.row(input.id, trx, true);
      if (existing) return this.idempotentReplay(trx, existing, memberId);
      await this.insertProject(trx, input, memberId, 'deep_sky', now);
      return this.detailOf(trx, (await this.row(input.id, trx)) as ProjectRow);
    });
  }

  private async insertProject(
    trx: Tx,
    input: ProjectCreate,
    memberId: string,
    projectType: 'deep_sky' | 'exoplanet',
    now: Date,
  ) {
    await this.checkRig(trx, input.rigId);
    await this.checkDso(trx, input.dsoObjectId);
    await trx
      .insertInto('project')
      .values({
        id: input.id,
        tenantId: this.tenantId,
        createdBy: memberId,
        name: input.name,
        projectType,
        requestedRigId: input.rigId,
        targetName: input.targetName,
        targetType: input.targetType,
        dsoObjectId: input.dsoObjectId,
        catalogNames: input.catalogNames,
        descriptionMd: input.descriptionMd,
        raDeg: input.raDeg,
        decDeg: input.decDeg,
        rotationDeg: input.rotationDeg,
        startDate: input.startDate,
        dueDate: input.dueDate,
        requestPeriodFrom: input.requestPeriodFrom,
        requestPeriodTo: input.requestPeriodTo,
        requestComment: input.requestComment,
        ...input.conditions,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    if (input.raDeg !== null && input.decDeg !== null)
      await this.insertPanel(trx, input.id, 0, {
        label: 'Main',
        raDeg: input.raDeg,
        decDeg: input.decDeg,
        rotationDeg: input.rotationDeg,
        notes: '',
      });
    await this.log(trx, input.id, 'create', { name: input.name }, now);
  }

  /**
   * Exoplaneten-Projekt aus der Transitsuche (FA-EXO-15/16): Projekt vom Typ `exoplanet` mit Wunsch-Rig, Panel am
   * Wirtsstern, `exo_project`, aktive Ephemeride und – wenn ein bestätigter Filter passt – genau eine Transit-Zeile
   * (FA-EXO-20; *Geplant* setzt erst die Festlegung, AP-43). Eine Transaktion; idempotent über die Projekt-ID.
   */
  createExoplanet(input: ProjectCreate, exo: ExoProjectInsert, now: Date): Promise<ProjectDetail> {
    const memberId = this.ctx.memberId;
    if (!memberId) throw new ProblemError('permission.denied');
    return this.tx(async (trx) => {
      const existing = await this.row(input.id, trx, true);
      if (existing) return this.idempotentReplay(trx, existing, memberId);
      await this.insertProject(trx, input, memberId, 'exoplanet', now);
      await trx
        .insertInto('exoProject')
        .values({
          projectId: input.id,
          tenantId: this.tenantId,
          planet: exo.planet,
          star: exo.star,
          catalog: exo.catalog,
          catalogEntryId: exo.catalogEntryId,
          bufferSigma: exo.bufferSigma,
          catalogSnapshot: json(exo.catalogSnapshot),
        })
        .execute();
      await this.insertEphemeris(trx, input.id, exo.ephemeris);
      if (exo.line) {
        const panel = await trx
          .selectFrom('projectPanel')
          .select('id')
          .where('tenantId', '=', this.tenantId)
          .where('projectId', '=', input.id)
          .executeTakeFirst();
        if (panel)
          await this.addLineIn(
            trx,
            input.id,
            LineCreateSchema.parse({
              id: crypto.randomUUID(),
              panelId: panel.id,
              filterId: exo.line.filterId,
              exposureS: exo.line.exposureS,
              plannedCount: 0,
              moonMode: 'none',
            }),
            now,
          );
      }
      return this.detailOf(trx, (await this.row(input.id, trx)) as ProjectRow);
    });
  }

  private async insertEphemeris(trx: Tx, projectId: string, e: EphemerisInsert) {
    await exoDb(trx)
      .insertInto('ephemeris')
      .values({ tenantId: this.tenantId, projectId, ...e, isActive: true })
      .execute();
  }

  /**
   * Transit-Einstellungen (FA-EXO-19/20, transit.md §8): Baseline, Puffer k, Autofokus/Zentrieren im Fenster,
   * Defokus-Hinweis. Wirkt auf Vorhersage und neue Festlegungen; Version +1, Verlauf.
   */
  patchExoplanet(
    projectId: string,
    patch: {
      readonly baselineBeforeMin?: number | undefined;
      readonly baselineAfterMin?: number | undefined;
      readonly bufferSigma?: number | undefined;
      readonly allowAutofocus?: boolean | undefined;
      readonly allowRecenter?: boolean | undefined;
      readonly defocusHint?: string | null | undefined;
    },
    now: Date,
  ): Promise<ProjectDetail> {
    return this.tx(
      async (trx) => {
        const p = await this.row(projectId, trx);
        if (!p || p.projectType !== 'exoplanet') throw notFound();
        const set = Object.fromEntries(
          Object.entries(patch).filter(([, v]) => v !== undefined),
        ) as Record<string, unknown>;
        if (Object.keys(set).length > 0) {
          await trx
            .updateTable('exoProject')
            .set(set)
            .where('tenantId', '=', this.tenantId)
            .where('projectId', '=', projectId)
            .execute();
          await this.touch(trx, p, now);
          await this.log(trx, projectId, 'update', { target: 'exoplanet', ...set }, now);
        }
        return this.detailOf(trx, (await this.row(projectId, trx)) as ProjectRow);
      },
      [{ table: 'project', id: projectId }],
    );
  }

  /**
   * Neuere Katalog-Ephemeride übernehmen (FA-EXO-16): die bisherige bleibt als Historie (`is_active = false`),
   * Katalogbezug und Momentaufnahme folgen dem Katalog. Erhöht die Version (Aufwand neu, Auslieferung).
   */
  replaceEphemeris(
    projectId: string,
    update: {
      readonly catalog: string;
      readonly catalogEntryId: string | null;
      readonly catalogSnapshot: unknown;
      readonly ephemeris: EphemerisInsert;
    },
    now: Date,
  ): Promise<ProjectDetail> {
    return this.tx(
      async (trx) => {
        const p = await this.row(projectId, trx);
        if (!p || p.projectType !== 'exoplanet') throw notFound();
        await exoDb(trx)
          .updateTable('ephemeris')
          .set({ isActive: false })
          .where('tenantId', '=', this.tenantId)
          .where('projectId', '=', projectId)
          .where('isActive', '=', true)
          .execute();
        await this.insertEphemeris(trx, projectId, update.ephemeris);
        await trx
          .updateTable('exoProject')
          .set({
            catalog: update.catalog,
            catalogEntryId: update.catalogEntryId,
            catalogSnapshot: json(update.catalogSnapshot),
          })
          .where('tenantId', '=', this.tenantId)
          .where('projectId', '=', projectId)
          .execute();
        await this.touch(trx, p, now);
        await this.log(
          trx,
          projectId,
          'update',
          {
            target: 'ephemeris',
            source: update.ephemeris.source,
            t0BjdTdb: update.ephemeris.t0BjdTdb,
            periodD: update.ephemeris.periodD,
          },
          now,
        );
        return this.detailOf(trx, (await this.row(projectId, trx)) as ProjectRow);
      },
      [{ table: 'project', id: projectId }],
    );
  }

  private async insertPanel(
    trx: Tx,
    projectId: string,
    panelIndex: number,
    p: {
      label: string;
      raDeg: number;
      decDeg: number;
      rotationDeg: number;
      notes: string;
      enabled?: boolean;
    },
    id?: string,
  ) {
    await trx
      .insertInto('projectPanel')
      .values({ ...(id ? { id } : {}), tenantId: this.tenantId, projectId, panelIndex, ...p })
      .execute();
  }

  /** Version, `effort_stale`, `updated_at` (jede inhaltliche Änderung, auch an Panels/Zeilen). */
  private async touch(trx: Tx, p: ProjectRow, now: Date, set: Record<string, unknown> = {}) {
    const adminEdit =
      p.approvalStatus === 'submitted' &&
      this.ctx.memberId !== undefined &&
      this.ctx.memberId !== null &&
      this.ctx.memberId !== p.createdBy;
    await trx
      .updateTable('project')
      .set({
        ...set,
        ...(adminEdit ? { contentChangedAt: now } : {}),
        version: p.version + 1,
        effortStale: true,
        updatedAt: now,
      })
      .where('tenantId', '=', this.tenantId)
      .where('id', '=', p.id)
      .execute();
    if (adminEdit) await this.adminEdited(trx, p, Object.keys(set), now);
  }

  /**
   * Admin ändert ein eingereichtes Objekt, ohne zu entscheiden (FA-FRG-14): Ereignis
   * `edited_by_admin`, „geändert seit deiner Stimme“ über `content_changed_at`; Einreicher und
   * Stimmende werden benachrichtigt – höchstens einmal je 15 Minuten, damit eine Folge kleiner
   * Änderungen nicht jede einzeln meldet.
   */
  private async adminEdited(trx: Tx, p: ProjectRow, fields: string[], now: Date) {
    const recent = await trx
      .selectFrom('approvalEvent')
      .select('id')
      .where('tenantId', '=', this.tenantId)
      .where('projectId', '=', p.id)
      .where('action', '=', 'edited_by_admin')
      .where('createdAt', '>', new Date(now.getTime() - 15 * 60_000))
      .executeTakeFirst();
    await trx
      .insertInto('approvalEvent')
      .values({
        tenantId: this.tenantId,
        projectId: p.id,
        userId: this.ctx.memberId ?? null,
        action: 'edited_by_admin',
        comment: null,
        snapshot: json({ fields }),
        createdAt: now,
      })
      .execute();
    if (recent) return;
    const voters = await trx
      .selectFrom('queueVote')
      .select('voterId')
      .where('tenantId', '=', this.tenantId)
      .where('subjectKind', '=', 'project')
      .where('subjectId', '=', p.id)
      .execute();
    const me = this.ctx.memberId;
    await insertNotifications(trx, {
      tenantId: this.tenantId,
      recipients: [p.createdBy].filter((r) => r !== me),
      kind: 'submission.edited_by_admin',
      projectId: p.id,
      payload: { name: p.name },
      now,
    });
    await insertNotifications(trx, {
      tenantId: this.tenantId,
      recipients: voters.map((v) => v.voterId).filter((r) => r !== me),
      kind: 'vote.subject_changed',
      projectId: p.id,
      payload: { name: p.name },
      now,
    });
  }

  patch(
    id: string,
    patch: ProjectPatch,
    now: Date,
    expectedVersion?: number,
  ): Promise<ProjectDetail> {
    return this.tx(
      (trx) => this.patchIn(trx, id, patch, now, expectedVersion),
      [{ table: 'project', id }],
    );
  }

  /** `patch` innerhalb einer bestehenden Transaktion (Änderungsantrag annehmen, AP-32b). */
  async patchIn(
    trx: Tx,
    id: string,
    patch: ProjectPatch,
    now: Date,
    expectedVersion?: number,
  ): Promise<ProjectDetail> {
    const p = await this.row(id, trx);
    if (!p) throw notFound();
    if (expectedVersion !== undefined && expectedVersion !== p.version)
      throw new ProblemError('resource.version_conflict');
    const { conditions, acceptRigConflicts, rigId, ...fields } = patch;
    await this.checkDso(trx, fields.dsoObjectId);
    const set: Record<string, unknown> = { ...fields, ...(conditions ?? {}) };
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    for (const [k, v] of Object.entries(set)) {
      const from = (p as Record<string, unknown>)[k];
      if (json(from) !== json(v)) diff[k] = { from: from ?? null, to: v };
    }
    if (rigId !== undefined && rigId !== projectRigId(p)) {
      await this.checkRig(trx, rigId);
      if (p.approvalStatus === 'approved') {
        if (rigId === null)
          throw invalid([{ path: 'rigId', message: 'Pflicht für freigegebene Projekte' }]);
        const check = await this.rigCheckIn(trx, p, rigId);
        if (!acceptRigConflicts) {
          if (check.hasCaptures && check.opticsChanged)
            throw new ProblemError('rig.change_has_captures', toErrors(check.conflicts));
          const blocking = check.conflicts.filter((c) => c.code !== 'fov_changed');
          if (blocking.length > 0)
            throw new ProblemError('approval.rig_conflict', toErrors(blocking));
        }
        set.rigId = rigId;
      } else set.requestedRigId = rigId;
      diff.rigId = { from: projectRigId(p), to: rigId };
    }
    if (Object.keys(set).length === 0) return this.detailOf(trx, p);
    await this.touch(trx, p, now, set);
    // Einzelfeld: Panel 0 folgt den Projektkoordinaten; ohne aktives Panel entsteht eines mit den
    // Koordinaten – nur wenn die Änderung Koordinaten enthält (nicht bei jedem Umbenennen) und mit dem
    // nächsten freien Index über **alle** Panels: `UNIQUE (project_id, panel_index)` gilt auch für weich
    // gelöschte (sonst 500 nach dem Löschen von Panel 0, wie in `addPanel`/`applyMosaic`).
    const ra = (set.raDeg as number | null | undefined) ?? p.raDeg;
    const dec = (set.decDeg as number | null | undefined) ?? p.decDeg;
    const rot = (set.rotationDeg as number | undefined) ?? p.rotationDeg;
    const coordinatesChanged = 'raDeg' in set || 'decDeg' in set || 'rotationDeg' in set;
    const panels = await this.panelsOf(trx, id);
    if (ra !== null && dec !== null && coordinatesChanged) {
      if (panels.length === 0)
        await this.insertPanel(trx, id, await this.nextPanelIndex(trx, id), {
          label: 'Main',
          raDeg: ra,
          decDeg: dec,
          rotationDeg: rot,
          notes: '',
        });
      else if (panels.length === 1)
        await trx
          .updateTable('projectPanel')
          .set({ raDeg: ra, decDeg: dec, rotationDeg: rot })
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', (panels[0] as PanelRow).id)
          .execute();
    }
    await this.log(trx, id, 'update', diff, now);
    return this.detailOf(trx, (await this.row(id, trx)) as ProjectRow);
  }

  /** Nächster freier `panel_index` über alle Panels des Projekts, auch weich gelöschte. */
  private async nextPanelIndex(trx: Tx, projectId: string): Promise<number> {
    const max = await trx
      .selectFrom('projectPanel')
      .select((eb) => eb.fn.max('panelIndex').as('max'))
      .where('tenantId', '=', this.tenantId)
      .where('projectId', '=', projectId)
      .executeTakeFirst();
    return max?.max === null || max?.max === undefined ? 0 : Number(max.max) + 1;
  }

  private panelsOf(trx: Tx, projectId: string) {
    return trx
      .selectFrom('projectPanel')
      .selectAll()
      .where('tenantId', '=', this.tenantId)
      .where('projectId', '=', projectId)
      .where('deletedAt', 'is', null)
      .orderBy('panelIndex')
      .execute();
  }

  /**
   * Papierkorb (FA-PRJ-15, E4): immer weich. Was an der Sichtbarkeit hängt, wird mit aufgeräumt:
   * - offene Änderungsanträge zum Projekt werden zurückgezogen (wie `ChangeRequestRepository.withdraw`:
   *   Status `withdrawn`, Rang frei, Stimmen ruhen) – sonst blockierten sie unsichtbar die Rangfolge des
   *   Antragstellers (`422 ranking.incomplete`, „n von m“);
   * - ein eingereichtes Projekt gibt seinen Rang beim Einreicher frei, die übrigen rücken nach;
   * - ein freigegebenes Projekt verlässt die Priorität seines Rigs (Lücke geschlossen); sein Wert bleibt
   *   gespeichert, damit `restore` es an dieselbe Stelle zurücksetzt.
   * Wächter: Projektzeile, dazu `app_user` der betroffenen Einreicher (rules/dsql.md).
   */
  softDelete(id: string, now: Date): Promise<void> {
    return this.tx(
      async (trx) => {
        const p = await this.row(id, trx);
        if (!p) throw notFound();
        const requests = await trx
          .selectFrom('changeRequest')
          .select(['id', 'requestedBy', 'version'])
          .where('tenantId', '=', this.tenantId)
          .where('projectId', '=', id)
          .where('status', '=', 'open')
          .orderBy('id')
          .execute();
        const submitters = [
          ...new Set([
            ...(p.approvalStatus === 'submitted' || p.submitterRank !== null ? [p.createdBy] : []),
            ...requests.map((r) => r.requestedBy),
          ]),
        ].sort();
        await lockSubmitters(trx, this.tenantId, submitters);
        await trx
          .updateTable('project')
          .set({ deletedAt: now, submitterRank: null, updatedAt: now, version: p.version + 1 })
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', id)
          .execute();
        for (const r of requests)
          await trx
            .updateTable('changeRequest')
            .set({
              status: 'withdrawn',
              submitterRank: null,
              version: r.version + 1,
              updatedAt: now,
            })
            .where('tenantId', '=', this.tenantId)
            .where('id', '=', r.id)
            .where('status', '=', 'open')
            .execute();
        for (const member of submitters) await renumberRanks(trx, this.tenantId, member);
        if (p.approvalStatus === 'approved' && p.rigId)
          await this.renumberPriority(trx, p.rigId, null, now);
        await this.log(
          trx,
          id,
          'delete',
          {
            name: p.name,
            ...(requests.length > 0 ? { changeRequestsWithdrawn: requests.map((r) => r.id) } : {}),
            ...(p.submitterRank !== null ? { rank: p.submitterRank } : {}),
          },
          now,
        );
      },
      [{ table: 'project', id }],
    );
  }

  /**
   * Wiederherstellen mit unverändertem Freigabe- und Projektstatus (FA-PRJ-15). Rang und Priorität folgen
   * dem Papierkorb: ein eingereichtes Projekt reiht sich am Ende der Rangfolge seines Einreichers ein, ein
   * freigegebenes kehrt an seine frühere Position im Rig zurück (höchstens ans Ende).
   */
  restore(id: string, now: Date): Promise<ProjectDetail> {
    return this.tx(
      async (trx) => {
        const p = await this.row(id, trx, true);
        if (!p || p.deletedAt === null) throw notFound();
        const submitted = p.approvalStatus === 'submitted';
        if (submitted) await lockSubmitters(trx, this.tenantId, [p.createdBy]);
        const rank = submitted ? await nextSubmitterRank(trx, this.tenantId, p.createdBy) : null;
        await trx
          .updateTable('project')
          .set({ deletedAt: null, submitterRank: rank, updatedAt: now, version: p.version + 1 })
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', id)
          .execute();
        if (submitted) await renumberRanks(trx, this.tenantId, p.createdBy);
        if (p.approvalStatus === 'approved' && p.rigId)
          await this.renumberPriority(trx, p.rigId, { id, position: p.priority }, now);
        await this.log(trx, id, 'restore', { name: p.name }, now);
        return this.detailOf(trx, (await this.row(id, trx)) as ProjectRow);
      },
      [{ table: 'project', id }],
    );
  }

  /**
   * Priorität je Rig 1…n über die freigegebenen, nicht gelöschten Projekte (FA-PRJ-13); `insert` setzt
   * ein Projekt an `position` (1 = höchste, höchstens ans Ende). Schreibt nur geänderte Zeilen.
   */
  private async renumberPriority(
    trx: Tx,
    rigId: string,
    insert: { id: string; position: number } | null,
    now: Date,
  ) {
    const peers = await trx
      .selectFrom('project')
      .select(['id', 'priority'])
      .where('tenantId', '=', this.tenantId)
      .where('rigId', '=', rigId)
      .where('approvalStatus', '=', 'approved')
      .where('deletedAt', 'is', null)
      .orderBy('priority')
      .orderBy('id')
      .execute();
    const order = peers.map((x) => x.id).filter((x) => x !== insert?.id);
    if (insert)
      order.splice(Math.min(Math.max(insert.position, 1) - 1, order.length), 0, insert.id);
    for (const [i, pid] of order.entries())
      if (peers.find((x) => x.id === pid)?.priority !== i + 1)
        await trx
          .updateTable('project')
          .set({ priority: i + 1, updatedAt: now })
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', pid)
          .execute();
  }

  /** Duplizieren (FA-PRJ-08): neuer Entwurf mit denselben Panels und Zeilen, Zähler 0. */
  duplicate(
    sourceId: string,
    input: { id: string; name?: string | undefined; rigId?: string | null | undefined },
    now: Date,
  ): Promise<ProjectDetail> {
    const memberId = this.ctx.memberId;
    if (!memberId) throw new ProblemError('permission.denied');
    return this.tx(async (trx) => {
      const existing = await this.row(input.id, trx, true);
      if (existing) return this.idempotentReplay(trx, existing, memberId);
      const src = await this.row(sourceId, trx);
      if (!src) throw notFound();
      const rigId = input.rigId === undefined ? projectRigId(src) : input.rigId;
      await this.checkRig(trx, rigId);
      const copy = Object.fromEntries(Object.entries(src).filter(([k]) => !DUPLICATE_SKIP.has(k)));
      await trx
        .insertInto('project')
        .values({
          ...copy,
          id: input.id,
          createdBy: memberId,
          name: input.name ?? `${src.name} (Kopie)`,
          requestedRigId: rigId,
          createdAt: now,
          updatedAt: now,
        } as never)
        .execute();
      const panels = await this.panelsOf(trx, sourceId);
      const lines = await trx
        .selectFrom('exposureLine')
        .selectAll()
        .where('tenantId', '=', this.tenantId)
        .where('projectId', '=', sourceId)
        .where('deletedAt', 'is', null)
        .execute();
      for (const panel of panels) {
        const panelId = crypto.randomUUID();
        await this.insertPanel(
          trx,
          input.id,
          panel.panelIndex,
          {
            label: panel.label,
            raDeg: panel.raDeg,
            decDeg: panel.decDeg,
            rotationDeg: panel.rotationDeg,
            notes: panel.notes,
          },
          panelId,
        );
        const own = lines.filter((l) => l.panelId === panel.id);
        if (own.length > 0)
          await trx
            .insertInto('exposureLine')
            .values(
              own.map((l) => ({
                ...copyLine(l),
                projectId: input.id,
                panelId,
                createdAt: now,
                updatedAt: now,
              })),
            )
            .execute();
      }
      await this.log(trx, input.id, 'create', { duplicatedFrom: sourceId }, now);
      return this.detailOf(trx, (await this.row(input.id, trx)) as ProjectRow);
    });
  }

  // ---- Panels -------------------------------------------------------------------------------------

  addPanel(
    projectId: string,
    input: {
      id: string;
      label: string;
      raDeg: number;
      decDeg: number;
      rotationDeg: number;
      notes: string;
      enabled?: boolean;
    },
    now: Date,
  ): Promise<ProjectDetail> {
    return this.tx(
      async (trx) => {
        const p = await this.row(projectId, trx);
        if (!p) throw notFound();
        const exists = await trx
          .selectFrom('projectPanel')
          .select('id')
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', input.id)
          .executeTakeFirst();
        if (!exists) {
          const index = await this.nextPanelIndex(trx, projectId);
          const { id, ...panel } = input;
          await this.insertPanel(trx, projectId, index, panel, id);
          await this.touch(trx, p, now);
          await this.log(
            trx,
            projectId,
            'update',
            { target: 'panel', panelId: id, action: 'create' },
            now,
          );
        }
        return this.detailOf(trx, (await this.row(projectId, trx)) as ProjectRow);
      },
      [{ table: 'project', id: projectId }],
    );
  }

  private async panel(trx: Tx, projectId: string, panelId: string) {
    const panel = await trx
      .selectFrom('projectPanel')
      .selectAll()
      .where('tenantId', '=', this.tenantId)
      .where('projectId', '=', projectId)
      .where('id', '=', panelId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (!panel) throw notFound();
    return panel;
  }

  patchPanel(
    projectId: string,
    panelId: string,
    patch: Partial<{
      label: string;
      raDeg: number;
      decDeg: number;
      rotationDeg: number;
      notes: string;
      enabled: boolean;
    }>,
    now: Date,
  ): Promise<ProjectDetail> {
    return this.tx(
      async (trx) => {
        const p = await this.row(projectId, trx);
        if (!p) throw notFound();
        await this.panel(trx, projectId, panelId);
        if (Object.keys(patch).length > 0) {
          await trx
            .updateTable('projectPanel')
            .set(patch)
            .where('tenantId', '=', this.tenantId)
            .where('id', '=', panelId)
            .execute();
          await this.touch(trx, p, now);
          await this.log(trx, projectId, 'update', { target: 'panel', panelId, ...patch }, now);
        }
        return this.detailOf(trx, (await this.row(projectId, trx)) as ProjectRow);
      },
      [{ table: 'project', id: projectId }],
    );
  }

  /** Panel mit Aufnahmen weich, ohne Aufnahmen endgültig (FA-PRJ-06, E4). */
  deletePanel(projectId: string, panelId: string, now: Date): Promise<{ soft: boolean }> {
    return this.tx(
      async (trx) => {
        const p = await this.row(projectId, trx);
        if (!p) throw notFound();
        await this.panel(trx, projectId, panelId);
        const info = await this.captureInfo(trx, projectId);
        const soft = await this.removePanel(trx, panelId, info, now);
        await this.touch(trx, p, now);
        await this.log(
          trx,
          projectId,
          'update',
          { target: 'panel', panelId, action: soft ? 'soft_delete' : 'delete' },
          now,
        );
        return { soft };
      },
      [{ table: 'project', id: projectId }],
    );
  }

  /** Panel entfernen: mit Aufnahmen weich (samt Zeilen), sonst endgültig; liefert `soft`. */
  private async removePanel(
    trx: Tx,
    panelId: string,
    info: Awaited<ReturnType<ProjectRepository['captureInfo']>>,
    now: Date,
  ): Promise<boolean> {
    const lines = await trx
      .selectFrom('exposureLine')
      .select(['id', 'deletedAt'])
      .where('tenantId', '=', this.tenantId)
      .where('panelId', '=', panelId)
      .execute();
    const soft = lines.some((l) => (info.get(l.id)?.captures ?? 0) > 0);
    if (soft) {
      await trx
        .updateTable('projectPanel')
        .set({ deletedAt: now })
        .where('tenantId', '=', this.tenantId)
        .where('id', '=', panelId)
        .execute();
      await trx
        .updateTable('exposureLine')
        .set({ deletedAt: now, updatedAt: now })
        .where('tenantId', '=', this.tenantId)
        .where('panelId', '=', panelId)
        .where('deletedAt', 'is', null)
        .execute();
    } else {
      await trx
        .deleteFrom('exposureLine')
        .where('tenantId', '=', this.tenantId)
        .where('panelId', '=', panelId)
        .execute();
      await trx
        .deleteFrom('projectPanel')
        .where('tenantId', '=', this.tenantId)
        .where('id', '=', panelId)
        .execute();
    }
    return soft;
  }

  /**
   * Panels umsortieren (FA-PRJ-06): `panelIds` = alle aktiven Panels in neuer Reihenfolge (NINA-Nummer
   * 1…n). Die bisherigen Indizes werden neu verteilt – weich gelöschte Panels behalten ihren Index
   * (`UNIQUE (project_id, panel_index)`); zweistufig über negative Zwischenwerte.
   */
  reorderPanels(
    projectId: string,
    panelIds: readonly string[],
    now: Date,
    expectedVersion?: number,
  ): Promise<ProjectDetail> {
    return this.tx(
      async (trx) => {
        const p = await this.row(projectId, trx);
        if (!p) throw notFound();
        if (expectedVersion !== undefined && expectedVersion !== p.version)
          throw new ProblemError('resource.version_conflict');
        const active = await this.panelsOf(trx, projectId);
        const known = new Set(active.map((x) => x.id));
        if (
          panelIds.length !== active.length ||
          new Set(panelIds).size !== panelIds.length ||
          panelIds.some((id) => !known.has(id))
        )
          throw invalid([
            { path: 'panelIds', message: 'alle aktiven Panels genau einmal angeben' },
          ]);
        const indexes = active.map((x) => x.panelIndex).sort((a, b) => a - b);
        for (const [k, id] of panelIds.entries())
          await trx
            .updateTable('projectPanel')
            .set({ panelIndex: -(k + 1) })
            .where('tenantId', '=', this.tenantId)
            .where('id', '=', id)
            .execute();
        for (const [k, id] of panelIds.entries())
          await trx
            .updateTable('projectPanel')
            .set({ panelIndex: indexes[k] as number })
            .where('tenantId', '=', this.tenantId)
            .where('id', '=', id)
            .execute();
        await this.touch(trx, p, now);
        await this.log(
          trx,
          projectId,
          'update',
          { target: 'panel', action: 'reorder', panelIds },
          now,
        );
        return this.detailOf(trx, (await this.row(projectId, trx)) as ProjectRow);
      },
      [{ table: 'project', id: projectId }],
    );
  }

  /**
   * Mosaik übernehmen (AP-22, FA-FRM-06/12): `panels` sind die mit der Engine gerechneten Panels in
   * NINA-Reihenfolge (geometry.md §2, NT-32). Bestehende aktive Panels werden der Reihe nach auf die neuen
   * Zentren gesetzt und behalten Zeilen und Fortschritt (FA-PRJ-06); fehlende entstehen neu – mit
   * `copyPlan` mit den Zeilen von Panel 1 (Zähler 0) –, überzählige werden entfernt (mit Aufnahmen weich).
   */
  applyMosaic(
    projectId: string,
    input: {
      readonly raDeg: number;
      readonly decDeg: number;
      readonly rotationDeg: number;
      readonly cols: number;
      readonly rows: number;
      readonly overlapPct: number;
      readonly copyPlan: boolean;
      readonly panels: readonly {
        readonly n: number;
        readonly raDeg: number;
        readonly decDeg: number;
        readonly paDeg: number;
      }[];
    },
    now: Date,
    expectedVersion?: number,
  ): Promise<ProjectDetail & { removed: { soft: number; hard: number } }> {
    return this.tx(
      async (trx) => {
        const p = await this.row(projectId, trx);
        if (!p) throw notFound();
        if (expectedVersion !== undefined && expectedVersion !== p.version)
          throw new ProblemError('resource.version_conflict');
        const active = await this.panelsOf(trx, projectId);
        const grid = [...input.panels].sort((a, b) => a.n - b.n);
        const single = grid.length === 1;
        const label = (n: number, current?: string) =>
          single ? (current ?? 'Main') : `Panel ${String(n)}`;
        for (const [k, g] of grid.slice(0, active.length).entries()) {
          const panel = active[k] as PanelRow;
          await trx
            .updateTable('projectPanel')
            .set({
              raDeg: g.raDeg,
              decDeg: g.decDeg,
              rotationDeg: g.paDeg,
              label: label(g.n, panel.label),
            })
            .where('tenantId', '=', this.tenantId)
            .where('id', '=', panel.id)
            .execute();
        }
        if (grid.length > active.length) {
          const max = await trx
            .selectFrom('projectPanel')
            .select((eb) => eb.fn.max('panelIndex').as('max'))
            .where('tenantId', '=', this.tenantId)
            .where('projectId', '=', projectId)
            .executeTakeFirst();
          let next = max?.max === null || max?.max === undefined ? 0 : Number(max.max) + 1;
          const source = active[0];
          const sourceLines =
            input.copyPlan && source
              ? await trx
                  .selectFrom('exposureLine')
                  .selectAll()
                  .where('tenantId', '=', this.tenantId)
                  .where('panelId', '=', source.id)
                  .where('deletedAt', 'is', null)
                  .orderBy('orderIndex')
                  .execute()
              : [];
          for (const g of grid.slice(active.length)) {
            const inserted = await trx
              .insertInto('projectPanel')
              .values({
                tenantId: this.tenantId,
                projectId,
                panelIndex: next,
                label: label(g.n),
                raDeg: g.raDeg,
                decDeg: g.decDeg,
                rotationDeg: g.paDeg,
                notes: '',
                enabled: true,
              })
              .returning('id')
              .executeTakeFirstOrThrow();
            next += 1;
            if (sourceLines.length > 0)
              await trx
                .insertInto('exposureLine')
                .values(
                  sourceLines.map((l) => ({
                    tenantId: this.tenantId,
                    projectId,
                    panelId: inserted.id,
                    filterId: l.filterId,
                    filterShortName: l.filterShortName,
                    exposureS: l.exposureS,
                    plannedCount: l.plannedCount,
                    gain: l.gain,
                    offsetAdu: l.offsetAdu,
                    binning: l.binning,
                    readoutMode: l.readoutMode,
                    moonMode: l.moonMode,
                    moonProfileId: l.moonProfileId,
                    enabled: l.enabled,
                    orderIndex: l.orderIndex,
                    notes: l.notes,
                    createdAt: now,
                    updatedAt: now,
                  })),
                )
                .execute();
          }
        }
        const removed = { soft: 0, hard: 0 };
        if (active.length > grid.length) {
          const info = await this.captureInfo(trx, projectId);
          for (const panel of active.slice(grid.length)) {
            if (await this.removePanel(trx, panel.id, info, now)) removed.soft += 1;
            else removed.hard += 1;
          }
        }
        await this.touch(trx, p, now, {
          raDeg: input.raDeg,
          decDeg: input.decDeg,
          rotationDeg: input.rotationDeg,
          panelColumns: input.cols,
          panelRows: input.rows,
          panelOverlapPct: input.overlapPct,
        });
        await this.log(
          trx,
          projectId,
          'update',
          {
            target: 'mosaic',
            cols: input.cols,
            rows: input.rows,
            overlapPct: input.overlapPct,
            panels: grid.length,
            removed,
          },
          now,
        );
        return {
          ...(await this.detailOf(trx, (await this.row(projectId, trx)) as ProjectRow)),
          removed,
        };
      },
      [{ table: 'project', id: projectId }],
    );
  }

  // ---- Zeilen -------------------------------------------------------------------------------------

  private async lineRow(trx: Tx, projectId: string, lineId: string) {
    const line = await trx
      .selectFrom('exposureLine')
      .selectAll()
      .where('tenantId', '=', this.tenantId)
      .where('projectId', '=', projectId)
      .where('id', '=', lineId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (!line) throw notFound();
    return line;
  }

  /** Filter-Kurzname und Auslesemodus-Standard der Kamera des Projekt-Rigs. */
  private async lineDefaults(trx: Tx, p: ProjectRow, filterId: string | undefined) {
    const errors: FieldError[] = [];
    let filterShortName: string | undefined;
    if (filterId !== undefined) {
      const f = await this.equipment(trx).filter(filterId, trx);
      if (!f) errors.push({ path: 'filterId', message: 'Filter unbekannt' });
      else filterShortName = f.shortName;
    }
    const rigId = projectRigId(p);
    const rig = rigId ? await this.equipment(trx).rig(rigId, trx) : undefined;
    const camera = rig ? await this.equipment(trx).camera(rig.cameraId, trx) : undefined;
    return { errors, filterShortName, camera };
  }

  private async checkMoonProfile(
    trx: Tx,
    moonProfileId: string | null | undefined,
    errors: FieldError[],
  ) {
    if (moonProfileId && !(await this.equipment(trx).moonProfile(moonProfileId, trx)))
      errors.push({ path: 'moonProfileId', message: 'Mondprofil unbekannt' });
  }

  addLine(projectId: string, input: LineCreate, now: Date): Promise<ProjectDetail> {
    return this.tx(
      (trx) => this.addLineIn(trx, projectId, input, now),
      [{ table: 'project', id: projectId }],
    );
  }

  /** `addLine` innerhalb einer bestehenden Transaktion (Änderungsantrag annehmen, AP-32b). */
  async addLineIn(
    trx: Tx,
    projectId: string,
    input: LineCreate,
    now: Date,
  ): Promise<ProjectDetail> {
    const p = await this.row(projectId, trx);
    if (!p) throw notFound();
    const exists = await trx
      .selectFrom('exposureLine')
      .select('id')
      .where('tenantId', '=', this.tenantId)
      .where('id', '=', input.id)
      .executeTakeFirst();
    if (!exists) {
      await this.panel(trx, projectId, input.panelId);
      const { errors, filterShortName, camera } = await this.lineDefaults(trx, p, input.filterId);
      await this.checkMoonProfile(trx, input.moonProfileId, errors);
      if (camera && !camera.supportedBinning.includes(input.binning))
        errors.push({ path: 'binning', message: 'von der Kamera nicht unterstützt' });
      if (errors.length > 0) throw invalid(errors);
      const count = await trx
        .selectFrom('exposureLine')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('tenantId', '=', this.tenantId)
        .where('panelId', '=', input.panelId)
        .executeTakeFirst();
      await trx
        .insertInto('exposureLine')
        .values({
          ...input,
          tenantId: this.tenantId,
          projectId,
          filterShortName: filterShortName ?? '',
          readoutMode: input.readoutMode ?? camera?.defaultReadoutMode ?? 'Default',
          orderIndex: Number(count?.n ?? 0),
          createdAt: now,
          updatedAt: now,
        })
        .execute();
      await this.afterLineChange(trx, p, now);
      await this.log(
        trx,
        projectId,
        'update',
        { target: 'line', lineId: input.id, action: 'create', filter: filterShortName },
        now,
      );
    }
    return this.detailOf(trx, (await this.row(projectId, trx)) as ProjectRow);
  }

  /**
   * Zeile ändern; mit Aufnahmen sind die Felder aus `LINE_LOCKED_FIELDS` gesperrt (NT-E3) – geändert
   * werden dürfen dann nur geplant, Mondprofil, aktiv und Notizen.
   */
  patchLine(
    projectId: string,
    lineId: string,
    patch: LinePatch,
    now: Date,
  ): Promise<ProjectDetail> {
    return this.tx(
      (trx) => this.patchLineIn(trx, projectId, lineId, patch, now),
      [{ table: 'project', id: projectId }],
    );
  }

  /** `patchLine` innerhalb einer bestehenden Transaktion (Änderungsantrag annehmen, AP-32b). */
  async patchLineIn(
    trx: Tx,
    projectId: string,
    lineId: string,
    patch: LinePatch,
    now: Date,
  ): Promise<ProjectDetail> {
    const p = await this.row(projectId, trx);
    if (!p) throw notFound();
    const line = await this.lineRow(trx, projectId, lineId);
    const info = await this.captureInfo(trx, projectId);
    const hasCaptures = (info.get(lineId)?.captures ?? 0) > 0;
    const changed = LINE_LOCKED_FIELDS.filter(
      (k) =>
        patch[k] !== undefined && json(patch[k]) !== json((line as Record<string, unknown>)[k]),
    );
    if (hasCaptures && changed.length > 0)
      throw new ProblemError(
        'line.locked_by_captures',
        changed.map((path) => ({ path, message: 'Zeile hat Aufnahmen – Zeile duplizieren' })),
      );
    const { errors, filterShortName, camera } = await this.lineDefaults(trx, p, patch.filterId);
    await this.checkMoonProfile(trx, patch.moonProfileId, errors);
    if (patch.binning !== undefined && camera && !camera.supportedBinning.includes(patch.binning))
      errors.push({ path: 'binning', message: 'von der Kamera nicht unterstützt' });
    const moonMode = patch.moonMode ?? line.moonMode;
    const moonProfileId =
      patch.moonProfileId === undefined ? line.moonProfileId : patch.moonProfileId;
    if (moonMode === 'profile' && moonProfileId === null)
      errors.push({ path: 'moonProfileId', message: 'Mondprofil fehlt' });
    if (errors.length > 0) throw invalid(errors);
    const set: Record<string, unknown> = { ...patch, updatedAt: now };
    if (filterShortName !== undefined) set.filterShortName = filterShortName;
    if (patch.readoutMode === null) set.readoutMode = camera?.defaultReadoutMode ?? 'Default';
    await trx
      .updateTable('exposureLine')
      .set(set)
      .where('tenantId', '=', this.tenantId)
      .where('id', '=', lineId)
      .execute();
    await this.afterLineChange(trx, p, now);
    await this.log(trx, projectId, 'update', { target: 'line', lineId, ...patch }, now);
    return this.detailOf(trx, (await this.row(projectId, trx)) as ProjectRow);
  }

  /**
   * Zeile nur für eine Nacht ab- bzw. wieder einschalten (FA-FOL-05): `disabled_for_night` = Nacht-Schlüssel
   * oder `null`. Gilt nur, solange diese Nacht die aktuelle ist – ab dem nächsten lokalen Mittag plant die Zeile
   * wieder mit, ohne dass jemand zurücksetzt. Keine Sperre durch Aufnahmen (wie *aktiv*).
   */
  setLineDisabledForNight(
    projectId: string,
    lineId: string,
    night: string | null,
    now: Date,
  ): Promise<ProjectDetail> {
    return this.tx(
      async (trx) => {
        const p = await this.row(projectId, trx);
        if (!p) throw notFound();
        await this.lineRow(trx, projectId, lineId);
        await trx
          .updateTable('exposureLine')
          .set({ disabledForNight: night, updatedAt: now })
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', lineId)
          .execute();
        await this.afterLineChange(trx, p, now);
        await this.log(
          trx,
          projectId,
          'update',
          { target: 'line', lineId, disabledForNight: night },
          now,
        );
        return this.detailOf(trx, (await this.row(projectId, trx)) as ProjectRow);
      },
      [{ table: 'project', id: projectId }],
    );
  }

  /** Zeile mit Aufnahmen weich, ohne Aufnahmen endgültig (FA-PRJ-07, E4). */
  deleteLine(projectId: string, lineId: string, now: Date): Promise<{ soft: boolean }> {
    return this.tx(
      async (trx) => {
        const p = await this.row(projectId, trx);
        if (!p) throw notFound();
        await this.lineRow(trx, projectId, lineId);
        const soft = ((await this.captureInfo(trx, projectId)).get(lineId)?.captures ?? 0) > 0;
        if (soft)
          await trx
            .updateTable('exposureLine')
            .set({ deletedAt: now, updatedAt: now })
            .where('tenantId', '=', this.tenantId)
            .where('id', '=', lineId)
            .execute();
        else
          await trx
            .deleteFrom('exposureLine')
            .where('tenantId', '=', this.tenantId)
            .where('id', '=', lineId)
            .execute();
        await this.afterLineChange(trx, p, now);
        await this.log(
          trx,
          projectId,
          'update',
          { target: 'line', lineId, action: soft ? 'soft_delete' : 'delete' },
          now,
        );
        return { soft };
      },
      [{ table: 'project', id: projectId }],
    );
  }

  /** Zeile duplizieren (NT-E3): neue Zeile mit denselben Werten und Zählern 0, alte optional inaktiv. */
  duplicateLine(
    projectId: string,
    lineId: string,
    input: { id: string; deactivateSource: boolean },
    now: Date,
  ): Promise<ProjectDetail> {
    return this.tx(
      async (trx) => {
        const p = await this.row(projectId, trx);
        if (!p) throw notFound();
        const exists = await trx
          .selectFrom('exposureLine')
          .select('id')
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', input.id)
          .executeTakeFirst();
        if (!exists) {
          const line = await this.lineRow(trx, projectId, lineId);
          await trx
            .insertInto('exposureLine')
            .values({
              ...copyLine(line),
              id: input.id,
              orderIndex: line.orderIndex + 1,
              createdAt: now,
              updatedAt: now,
            })
            .execute();
          if (input.deactivateSource)
            await trx
              .updateTable('exposureLine')
              .set({ enabled: false, updatedAt: now })
              .where('tenantId', '=', this.tenantId)
              .where('id', '=', lineId)
              .execute();
          await this.afterLineChange(trx, p, now);
          await this.log(
            trx,
            projectId,
            'update',
            {
              target: 'line',
              lineId: input.id,
              duplicatedFrom: lineId,
              deactivateSource: input.deactivateSource,
            },
            now,
          );
        }
        return this.detailOf(trx, (await this.row(projectId, trx)) as ProjectRow);
      },
      [{ table: 'project', id: projectId }],
    );
  }

  /**
   * Automatischer Statuswechsel nach Zähler- oder Zeilenänderungen (FA-PRJ-11/12), beide Richtungen:
   * - *Bereit zur Bearbeitung* bzw. *Abgeschlossen* → *Aktiv*, wenn der Planungsbedarf wieder über 0 steigt
   *   (`autoReactivateOnRemaining`, Standard an);
   * - *Aktiv* → *Bereit zur Bearbeitung*, wenn das Projekt „fertig“ ist und am Rig kein Bonus aktiv ist
   *   (`autoReadyToProcess`, Standard aus; nicht für Exoplaneten, FA-EXO-34).
   * Nur freigegebene, nicht gelöschte Projekte. Liefert den neuen Status oder `null`.
   */
  private async automaticStatus(trx: Tx, p: ProjectRow): Promise<ProjectStatus | null> {
    if (p.approvalStatus !== 'approved' || p.deletedAt !== null) return null;
    const status = p.status as ProjectStatus | null;
    if (status !== 'active' && status !== 'ready_to_process' && status !== 'completed') return null;
    const tenant = await trx
      .selectFrom('tenant')
      .select('settings')
      .where('id', '=', this.tenantId)
      .executeTakeFirst();
    const settings = effectiveTenantSettings(tenant?.settings);
    if (status === 'active' && !settings.autoReadyToProcess) return null;
    if (status !== 'active' && !settings.autoReactivateOnRemaining) return null;
    const lines = await trx
      .selectFrom('exposureLine')
      .selectAll()
      .where('tenantId', '=', this.tenantId)
      .where('projectId', '=', p.id)
      .where('deletedAt', 'is', null)
      .execute();
    const progress = projectProgress(lines, await this.overshootPct(trx, p));
    if (status !== 'active')
      return autoReactivate(status, progress.planningNeed, settings.autoReactivateOnRemaining);
    const rigId = projectRigId(p);
    const rig = rigId
      ? await trx
          .selectFrom('rig')
          .select('bonusEnabled')
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', rigId)
          .executeTakeFirst()
      : undefined;
    return autoReadyToProcess({
      status,
      projectType: p.projectType,
      finished: progress.finished,
      bonusEnabled: rig?.bonusEnabled ?? false,
      autoReadyToProcess: settings.autoReadyToProcess,
    });
  }

  /** Felder und Protokolleintrag eines automatischen Statuswechsels (`completed_at` wie beim manuellen). */
  private async automaticStatusSet(trx: Tx, p: ProjectRow, next: ProjectStatus, now: Date) {
    await this.log(trx, p.id, 'status', { from: p.status, to: next, automatic: true }, now);
    return { status: next, completedAt: next === 'active' ? null : p.completedAt };
  }

  /**
   * Nach einer Zähleränderung außerhalb des Editors (Aufnahmen-Ingest, Korrektur, Verwerfen,
   * Zähler-Abgleich): automatischer Statuswechsel nach `automaticStatus` – mit Protokolleintrag.
   * Liefert den neuen Status oder `null`.
   */
  async autoStatusAfterCounts(trx: Tx, projectId: string, now: Date): Promise<string | null> {
    const p = await this.row(projectId, trx);
    if (!p) return null;
    const next = await this.automaticStatus(trx, p);
    if (!next) return null;
    await trx
      .updateTable('project')
      .set({
        ...(await this.automaticStatusSet(trx, p, next, now)),
        version: p.version + 1,
        updatedAt: now,
      })
      .where('tenantId', '=', this.tenantId)
      .where('id', '=', p.id)
      .execute();
    return next;
  }

  /**
   * Nach einer Zeilenänderung: Version/`effort_stale` und der automatische Statuswechsel (FA-PRJ-12) –
   * zurück nach *Aktiv* bei neuem Planungsbedarf bzw. *Bereit zur Bearbeitung*, wenn nun „fertig“.
   */
  private async afterLineChange(trx: Tx, p: ProjectRow, now: Date) {
    const next = await this.automaticStatus(trx, p);
    const set = next ? await this.automaticStatusSet(trx, p, next, now) : {};
    await this.touch(trx, p, now, set);
  }

  /** Vorlage anwenden (FA-BPL-04/05): kopiert Zeilen; nur solange das Projekt keine Aufnahmen hat. */
  applyTemplate(
    projectId: string,
    input: { templateId: string; panelId: string | null; replace: boolean },
    now: Date,
  ): Promise<ProjectDetail> {
    return this.tx(
      async (trx) => {
        const p = await this.row(projectId, trx);
        if (!p) throw notFound();
        const info = await this.captureInfo(trx, projectId);
        if ([...info.values()].some((i) => i.captures > 0))
          throw new ProblemError('line.locked_by_captures', [
            { path: 'templateId', message: 'Projekt hat Aufnahmen – Zeilen einzeln ergänzen' },
          ]);
        const template = await this.equipment(trx).template(input.templateId, trx);
        if (!template) throw invalid([{ path: 'templateId', message: 'Vorlage unbekannt' }]);
        const panels = (await this.panelsOf(trx, projectId)).filter(
          (panel) => input.panelId === null || panel.id === input.panelId,
        );
        if (panels.length === 0)
          throw invalid([{ path: 'panelId', message: 'kein Panel – Koordinaten fehlen' }]);
        const { camera } = await this.lineDefaults(trx, p, undefined);
        for (const panel of panels) {
          if (input.replace)
            await trx
              .deleteFrom('exposureLine')
              .where('tenantId', '=', this.tenantId)
              .where('panelId', '=', panel.id)
              .execute();
          if (template.lines.length > 0)
            await trx
              .insertInto('exposureLine')
              .values(
                template.lines.map((l, i) => ({
                  tenantId: this.tenantId,
                  projectId,
                  panelId: panel.id,
                  filterId: l.filterId,
                  filterShortName: l.filterShortName,
                  exposureS: l.exposureS,
                  plannedCount: l.plannedCount,
                  gain: l.gain,
                  offsetAdu: l.offsetAdu,
                  binning: l.binning,
                  readoutMode: l.readoutMode ?? camera?.defaultReadoutMode ?? 'Default',
                  moonMode: l.moonMode,
                  moonProfileId: l.moonProfileId,
                  enabled: l.enabled,
                  orderIndex: i,
                  createdAt: now,
                  updatedAt: now,
                })),
              )
              .execute();
        }
        await this.afterLineChange(trx, p, now);
        await this.log(
          trx,
          projectId,
          'update',
          { target: 'template', templateId: input.templateId, panels: panels.length },
          now,
        );
        return this.detailOf(trx, (await this.row(projectId, trx)) as ProjectRow);
      },
      [{ table: 'project', id: projectId }],
    );
  }

  // ---- Status, Priorität --------------------------------------------------------------------------

  /** Statuswechsel nach `projectStatusTransitions`; *Aktiv* prüft die Vollständigkeit (FA-PRJ-01/11). */
  setStatus(id: string, to: ProjectStatus, now: Date): Promise<ProjectDetail> {
    return this.tx(
      async (trx) => {
        const p = await this.row(id, trx);
        if (!p) throw notFound();
        if (
          p.approvalStatus !== 'approved' ||
          p.status === null ||
          !canTransition(p.status as ProjectStatus, to)
        )
          throw new ProblemError('project.status_transition_invalid', [
            { path: 'status', message: `${String(p.status ?? p.approvalStatus)} → ${to}` },
          ]);
        if (to === 'active') {
          const active = await trx
            .selectFrom('exposureLine')
            .select((eb) => eb.fn.countAll<string>().as('n'))
            .where('tenantId', '=', this.tenantId)
            .where('projectId', '=', id)
            .where('deletedAt', 'is', null)
            .where('enabled', '=', true)
            .where('plannedCount', '>', 0)
            .executeTakeFirst();
          const missing = missingForActivation({
            name: p.name,
            rigId: p.rigId,
            raDeg: p.raDeg,
            decDeg: p.decDeg,
            targetName: p.targetName ?? p.name,
            activeLinesWithPlan: Number(active?.n ?? 0),
          });
          if (missing.length > 0)
            throw new ProblemError(
              'approval.incomplete',
              missing.map((path) => ({ path, message: 'fehlt' })),
            );
        }
        await this.touch(trx, p, now, {
          status: to,
          completedAt: to === 'completed' ? now : to === 'active' ? null : p.completedAt,
        });
        await this.log(trx, id, 'status', { from: p.status, to }, now);
        return this.detailOf(trx, (await this.row(id, trx)) as ProjectRow);
      },
      [{ table: 'project', id }],
    );
  }

  /**
   * Priorität je Rig (FA-PRJ-13): das Projekt rückt an `position` (1 = höchste), alle freigegebenen,
   * nicht gelöschten Projekte desselben Rigs werden 1…n neu nummeriert.
   */
  setPriority(id: string, position: number, now: Date): Promise<{ order: string[] }> {
    return this.tx(
      async (trx) => {
        const p = await this.row(id, trx);
        if (!p) throw notFound();
        if (p.approvalStatus !== 'approved' || !p.rigId)
          throw new ProblemError('project.status_transition_invalid', [
            { path: 'priority', message: 'nur freigegebene Projekte mit Rig' },
          ]);
        const peers = await trx
          .selectFrom('project')
          .select(['id', 'priority'])
          .where('tenantId', '=', this.tenantId)
          .where('rigId', '=', p.rigId)
          .where('approvalStatus', '=', 'approved')
          .where('deletedAt', 'is', null)
          .orderBy('priority')
          .orderBy('id')
          .execute();
        const order = peers.map((x) => x.id).filter((x) => x !== id);
        order.splice(Math.min(position - 1, order.length), 0, id);
        for (const [i, pid] of order.entries()) {
          const current = peers.find((x) => x.id === pid)?.priority;
          if (current !== i + 1)
            await trx
              .updateTable('project')
              .set({ priority: i + 1, updatedAt: now })
              .where('tenantId', '=', this.tenantId)
              .where('id', '=', pid)
              .execute();
        }
        await this.log(trx, id, 'priority', { from: p.priority, to: position }, now);
        return { order };
      },
      [{ table: 'project', id }],
    );
  }

  // ---- Favoriten, Kommentare, Verlauf -------------------------------------------------------------

  async setFavorite(projectId: string, on: boolean, now: Date): Promise<void> {
    const memberId = this.ctx.memberId;
    if (!memberId) throw new ProblemError('permission.denied');
    if (!(await this.row(projectId))) throw notFound();
    if (on)
      await this.db
        .insertInto('favorite')
        .values({ tenantId: this.tenantId, userId: memberId, projectId, createdAt: now })
        .onConflict((oc) => oc.columns(['userId', 'projectId']).doNothing())
        .execute();
    else
      await this.db
        .deleteFrom('favorite')
        .where('tenantId', '=', this.tenantId)
        .where('userId', '=', memberId)
        .where('projectId', '=', projectId)
        .execute();
  }

  /**
   * Namen je Projekt (auch gelöschte, abgeschlossene, pausierte) – eine Abfrage für ganze Listen. Für das Ist einer Nacht
   * (AP-53c): belichtete Projekte, die nicht mehr im Plan stehen, brauchen trotzdem ihren Namen (07.10.2026).
   */
  async names(projectIds: readonly string[]): Promise<Map<string, string>> {
    const ids = [...new Set(projectIds)];
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .selectFrom('project')
      .select(['id', 'name'])
      .where('tenantId', '=', this.tenantId)
      .where('id', 'in', ids)
      .execute();
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  // ---- Kommentare (FA-PRJ-17, Ausbau der Notizen 04.10.2026) --------------------------------------

  /** Nicht gelöschte Kommentare je Projekt – eine gruppierte Abfrage für ganze Listen (kein N+1). */
  async commentCounts(projectIds: readonly string[]): Promise<Map<string, number>> {
    const ids = [...new Set(projectIds)];
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .selectFrom('projectNote')
      .select(['projectId', (eb) => eb.fn.countAll<string>().as('n')])
      .where('tenantId', '=', this.tenantId)
      .where('projectId', 'in', ids)
      .where('deletedAt', 'is', null)
      .groupBy('projectId')
      .execute();
    return new Map(rows.map((r) => [r.projectId, Number(r.n)]));
  }

  private noteRow(trx: Tx | Kysely, projectId: string, noteId: string) {
    return trx
      .selectFrom('projectNote')
      .selectAll()
      .where('tenantId', '=', this.tenantId)
      .where('projectId', '=', projectId)
      .where('id', '=', noteId)
      .executeTakeFirst();
  }

  /**
   * Kommentar oder Antwort anlegen. Eine Antwort auf eine Antwort hängt sich an denselben Strang (eine
   * Ebene tief). Benachrichtigt (`project.comment`) den Ersteller des Projekts und alle, die dort schon
   * kommentiert haben – außer dem Verfasser –, in derselben Transaktion.
   */
  async addNote(
    projectId: string,
    input: { bodyMd: string; parentId?: string | null | undefined },
    now: Date,
  ) {
    const memberId = this.ctx.memberId;
    if (!memberId) throw new ProblemError('permission.denied');
    return this.tx(async (trx) => {
      const project = await this.row(projectId, trx);
      if (!project) throw notFound();
      let parentId: string | null = null;
      if (input.parentId) {
        const parent = await this.noteRow(trx, projectId, input.parentId);
        if (!parent) throw notFound();
        parentId = parent.parentId ?? parent.id;
      }
      const row = await trx
        .insertInto('projectNote')
        .values({
          tenantId: this.tenantId,
          projectId,
          userId: memberId,
          bodyMd: input.bodyMd,
          parentId,
          createdAt: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      // Empfänger: Ersteller und bisherige Verfasser, nur aktive Mitglieder, nie der Verfasser selbst.
      const [recipients, author] = await Promise.all([
        trx
          .selectFrom('appUser')
          .select('id')
          .where('tenantId', '=', this.tenantId)
          .where('status', '=', 'active')
          .where('id', '<>', memberId)
          .where((eb) =>
            eb.or([
              eb('id', '=', project.createdBy),
              eb(
                'id',
                'in',
                eb
                  .selectFrom('projectNote')
                  .select('userId')
                  .where('tenantId', '=', this.tenantId)
                  .where('projectId', '=', projectId),
              ),
            ]),
          )
          .execute(),
        trx
          .selectFrom('appUser')
          .select('displayName')
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', memberId)
          .executeTakeFirst(),
      ]);
      await insertNotifications(trx, {
        tenantId: this.tenantId,
        recipients: recipients.map((r) => r.id),
        kind: 'project.comment',
        projectId,
        payload: {
          subject: project.name,
          author: author?.displayName ?? '',
          noteId: row.id,
        },
        now,
      });
      return row;
    });
  }

  /** Eigenen Kommentar bearbeiten: nur der Verfasser, höchstens 1 h nach dem Anlegen. */
  async editNote(projectId: string, noteId: string, bodyMd: string, now: Date) {
    const memberId = this.ctx.memberId;
    if (!memberId) throw new ProblemError('permission.denied');
    if (!(await this.row(projectId))) throw notFound();
    const note = await this.noteRow(this.db, projectId, noteId);
    if (!note || note.deletedAt !== null) throw notFound();
    if (note.userId !== memberId) throw new ProblemError('permission.denied');
    if (now.getTime() - new Date(note.createdAt).getTime() > COMMENT_EDIT_WINDOW_MS)
      throw new ProblemError('comment.edit_window_closed');
    await this.db
      .updateTable('projectNote')
      .set({ bodyMd, editedAt: now })
      .where('tenantId', '=', this.tenantId)
      .where('id', '=', noteId)
      .execute();
  }

  /** Kommentar weich löschen (Admin/Owner, Route `project.note.delete`); wiederholbar, Antworten bleiben. */
  async deleteNote(projectId: string, noteId: string, now: Date) {
    if (!(await this.row(projectId))) throw notFound();
    const note = await this.noteRow(this.db, projectId, noteId);
    if (!note) throw notFound();
    if (note.deletedAt !== null) return;
    await this.db
      .updateTable('projectNote')
      .set({ deletedAt: now, deletedBy: this.ctx.memberId ?? null })
      .where('tenantId', '=', this.tenantId)
      .where('id', '=', noteId)
      .execute();
  }

  /** Eigene Reaktion setzen bzw. entfernen (idempotent); nicht an gelöschten Kommentaren. */
  async setReaction(
    projectId: string,
    noteId: string,
    emoji: CommentReaction,
    active: boolean,
    now: Date,
  ) {
    const memberId = this.ctx.memberId;
    if (!memberId) throw new ProblemError('permission.denied');
    if (!(await this.row(projectId))) throw notFound();
    const note = await this.noteRow(this.db, projectId, noteId);
    if (!note || note.deletedAt !== null) throw notFound();
    if (active)
      await this.db
        .insertInto('projectNoteReaction')
        .values({ tenantId: this.tenantId, noteId, userId: memberId, emoji, createdAt: now })
        .onConflict((oc) => oc.columns(['noteId', 'userId', 'emoji']).doNothing())
        .execute();
    else
      await this.db
        .deleteFrom('projectNoteReaction')
        .where('tenantId', '=', this.tenantId)
        .where('noteId', '=', noteId)
        .where('userId', '=', memberId)
        .where('emoji', '=', emoji)
        .execute();
  }

  /**
   * Kommentare des Projekts, neueste zuerst, mit Reaktionen (Zähler, eigene). Gelöschte behalten Verfasser
   * und Zeit, aber ohne Text und Reaktionen.
   */
  async notes(projectId: string, only?: string): Promise<NoteRecord[]> {
    let noteQuery = this.db
      .selectFrom('projectNote as n')
      .innerJoin('appUser as u', 'u.id', 'n.userId')
      .select([
        'n.id',
        'n.userId',
        'u.displayName as authorName',
        'n.bodyMd',
        'n.createdAt',
        'n.parentId',
        'n.editedAt',
        'n.deletedAt',
      ])
      .where('n.tenantId', '=', this.tenantId)
      .where('n.projectId', '=', projectId);
    let reactionQuery = this.db
      .selectFrom('projectNoteReaction as r')
      .innerJoin('projectNote as n', (j) =>
        j.onRef('n.id', '=', 'r.noteId').onRef('n.tenantId', '=', 'r.tenantId'),
      )
      .select(['r.noteId', 'r.emoji', 'r.userId'])
      .where('r.tenantId', '=', this.tenantId)
      .where('n.projectId', '=', projectId);
    if (only) {
      noteQuery = noteQuery.where('n.id', '=', only);
      reactionQuery = reactionQuery.where('r.noteId', '=', only);
    }
    const [notes, reactions] = await Promise.all([
      noteQuery.orderBy('n.createdAt', 'desc').orderBy('n.id', 'desc').execute(),
      reactionQuery.execute(),
    ]);
    const me = this.ctx.memberId;
    const byNote = new Map<string, { emoji: string; userId: string }[]>();
    for (const r of reactions) byNote.set(r.noteId, [...(byNote.get(r.noteId) ?? []), r]);
    return notes.map((n) => {
      const deleted = n.deletedAt !== null;
      const own = deleted ? [] : (byNote.get(n.id) ?? []);
      return {
        ...n,
        bodyMd: deleted ? '' : n.bodyMd,
        reactions: commentReactions.flatMap((emoji) => {
          const users = own.filter((r) => r.emoji === emoji);
          return users.length === 0
            ? []
            : [{ emoji, count: users.length, mine: users.some((r) => r.userId === me) }];
        }),
      };
    });
  }

  /** Freigabe- und Änderungsverlauf (FA-PRJ-17, FA-BER-03), neueste zuerst. */
  async history(projectId: string) {
    const [approvals, changes, requests] = await Promise.all([
      this.db
        .selectFrom('approvalEvent as e')
        .leftJoin('appUser as u', 'u.id', 'e.userId')
        .select(['e.action', 'e.userId', 'u.displayName', 'e.snapshot', 'e.comment', 'e.createdAt'])
        .where('e.tenantId', '=', this.tenantId)
        .where('e.projectId', '=', projectId)
        .execute(),
      this.db
        .selectFrom('changeLog as c')
        .leftJoin('appUser as u', 'u.id', 'c.userId')
        .select(['c.action', 'c.userId', 'u.displayName', 'c.diff', 'c.entity', 'c.createdAt'])
        .where('c.tenantId', '=', this.tenantId)
        .where('c.entity', '=', 'project')
        .where('c.entityId', '=', projectId)
        .execute(),
      this.db
        .selectFrom('changeRequest as r')
        .leftJoin('appUser as a', 'a.id', 'r.requestedBy')
        .leftJoin('appUser as d', 'd.id', 'r.decidedBy')
        .select([
          'r.id',
          'r.status',
          'r.requestedBy',
          'r.decidedBy',
          'r.proposal',
          'r.decisionComment',
          'r.createdAt',
          'r.decidedAt',
          'r.updatedAt',
          'r.finalVotes',
          'a.displayName as requestedByName',
          'd.displayName as decidedByName',
        ])
        .where('r.tenantId', '=', this.tenantId)
        .where('r.projectId', '=', projectId)
        .execute(),
    ]);
    // Änderungsanträge (AP-32b): gestellt und – falls entschieden bzw. zurückgezogen – der Ausgang.
    const requestEntries = requests.flatMap((r) => {
      const stored = (typeof r.proposal === 'string' ? JSON.parse(r.proposal) : r.proposal) as {
        comment?: string | null;
      } | null;
      const created = {
        kind: 'change_request' as const,
        action: 'created',
        userId: r.requestedBy,
        userName: r.requestedByName,
        entity: 'change_request',
        detail: { changeRequestId: r.id },
        comment: stored?.comment ?? null,
        createdAt: r.createdAt,
      };
      if (r.status === 'open') return [created];
      const byRequester = r.status === 'withdrawn';
      return [
        created,
        {
          kind: 'change_request' as const,
          action: r.status,
          userId: byRequester ? r.requestedBy : r.decidedBy,
          userName: byRequester ? r.requestedByName : r.decidedByName,
          entity: 'change_request',
          detail: { changeRequestId: r.id, votes: r.finalVotes },
          comment: byRequester ? null : r.decisionComment,
          createdAt: r.decidedAt ?? r.updatedAt,
        },
      ];
    });
    return [
      ...approvals.map((a) => ({
        kind: 'approval' as const,
        action: a.action,
        userId: a.userId,
        userName: a.displayName,
        entity: 'project',
        detail: a.snapshot,
        comment: a.comment,
        createdAt: a.createdAt,
      })),
      ...changes.map((c) => ({
        kind: 'change' as const,
        action: c.action,
        userId: c.userId,
        userName: c.displayName,
        entity: c.entity,
        detail: c.diff,
        comment: null,
        createdAt: c.createdAt,
      })),
      ...requestEntries,
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  // ---- Rig-Wechsel (FA-RIG-12) --------------------------------------------------------------------

  async rigCheck(projectId: string, rigId: string) {
    const p = await this.row(projectId);
    if (!p) throw notFound();
    return this.rigCheckIn(this.db as Tx, p, rigId);
  }

  private async rigCheckIn(trx: Tx, p: ProjectRow, rigId: string) {
    const eq = this.equipment(trx);
    const rig = await eq.rig(rigId, trx);
    if (!rig) throw invalid([{ path: 'rigId', message: 'Rig unbekannt' }]);
    const camera = await eq.camera(rig.cameraId, trx);
    const telescope = await eq.telescope(rig.telescopeId, trx);
    const currentRigId = projectRigId(p);
    const current = currentRigId ? await eq.rig(currentRigId, trx) : undefined;
    const lines = await trx
      .selectFrom('exposureLine')
      .selectAll()
      .where('tenantId', '=', this.tenantId)
      .where('projectId', '=', p.id)
      .where('deletedAt', 'is', null)
      .where('enabled', '=', true)
      .execute();
    const conflicts: RigConflict[] = [];
    const wheel: readonly FilterWheelEntry[] = rig.filterWheel;
    for (const l of lines) {
      if (camera && !camera.isColor && wheel.length > 0) {
        const slot = wheel.find((s) => s.filterId === l.filterId);
        if (!slot)
          conflicts.push({ code: 'filter_not_in_wheel', lineId: l.id, detail: l.filterShortName });
        else if (slot.ninaFilterName === null || slot.ninaConfirmedAt === null)
          conflicts.push({ code: 'filter_unconfirmed', lineId: l.id, detail: l.filterShortName });
      }
      if (camera && !camera.supportedBinning.includes(l.binning))
        conflicts.push({
          code: 'binning_unsupported',
          lineId: l.id,
          detail: `${String(l.binning)}×${String(l.binning)}`,
        });
      if (camera && !camera.readoutModes.includes(l.readoutMode))
        conflicts.push({ code: 'readout_unsupported', lineId: l.id, detail: l.readoutMode });
    }
    const info = await this.captureInfo(trx, p.id);
    const hasCaptures = [...info.values()].some((i) => i.captures > 0);
    let opticsChanged = false;
    if (current && current.id !== rig.id && telescope && camera) {
      const oldTelescope = await eq.telescope(current.telescopeId, trx);
      const oldCamera = await eq.camera(current.cameraId, trx);
      if (oldTelescope && oldCamera) {
        const before = imageScale({ ...oldTelescope, ...oldCamera });
        const after = imageScale({ ...telescope, ...camera });
        opticsChanged =
          before.effFocalMm !== after.effFocalMm ||
          oldCamera.pixelSizeUm !== camera.pixelSizeUm ||
          oldCamera.widthPx !== camera.widthPx ||
          oldCamera.heightPx !== camera.heightPx;
        if (before.fovWidthDeg !== after.fovWidthDeg || before.fovHeightDeg !== after.fovHeightDeg)
          conflicts.push({
            code: 'fov_changed',
            lineId: null,
            detail: `${String(before.fovWidthDeg)}°×${String(before.fovHeightDeg)}° → ${String(after.fovWidthDeg)}°×${String(after.fovHeightDeg)}°`,
          });
        if (hasCaptures && opticsChanged)
          conflicts.push({ code: 'optics_changed_with_captures', lineId: null, detail: rig.name });
      }
    }
    return { conflicts, hasCaptures, opticsChanged };
  }
}

type Kysely = import('kysely').Kysely<Database>;

function toErrors(conflicts: readonly RigConflict[]): FieldError[] {
  return conflicts.map((c) => ({
    path: c.lineId ? `lines.${c.lineId}` : c.code,
    message: `${c.code}: ${c.detail}`,
  }));
}

/** Zeile ohne Identität und Zähler kopieren (Duplizieren von Projekt oder Zeile). */
function copyLine(l: LineRow) {
  return {
    tenantId: l.tenantId,
    projectId: l.projectId,
    panelId: l.panelId,
    filterId: l.filterId,
    filterShortName: l.filterShortName,
    exposureS: l.exposureS,
    plannedCount: l.plannedCount,
    gain: l.gain,
    offsetAdu: l.offsetAdu,
    binning: l.binning,
    readoutMode: l.readoutMode,
    moonMode: l.moonMode,
    moonProfileId: l.moonProfileId,
    enabled: l.enabled,
    orderIndex: l.orderIndex,
    notes: l.notes,
  };
}
