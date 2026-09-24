/**
 * Ausrüstung (AP-09a; FA-STO, FA-TEL, FA-KAM, FA-FIL, FA-BPL, FA-MON, FA-RIG-01…14; TK 7.2):
 * Standorte samt Links, Teleskope, Kameras, Filter, Mondprofile, Belichtungsvorlagen und Rigs mit
 * Scheduler-Einstellungen und Filterradbelegung. Jede Abfrage ist an den Mandanten gebunden.
 *
 * - Anlage mit Client-UUID (rules/api.md): dieselbe ID im eigenen Mandanten liefert das Objekt erneut.
 * - Löschsperren (FA-RIG-13): `409 resource.in_use`, die Verwender in `errors[]` (`path` = Art,
 *   `message` = Name). Unterobjekte (Standort-Links, Vorlagenzeilen, Rig-Reservierung) werden mitgelöscht.
 * - Änderungen an Rig, Standort, Teleskop oder Kamera erhöhen `rig.settings_version` der betroffenen
 *   Rigs (Sync an NINA, FA-RIG-07).
 * - Jede Änderung landet im Änderungsprotokoll (`change_log`, S-72).
 */
import {
  ProblemError,
  suggestNinaFilterName,
  validateFlip,
  validateSortChain,
  type CameraInput,
  type ExposureTemplateInput,
  type FieldError,
  type FilterInput,
  type FilterWheelPut,
  type MoonProfileInput,
  type Overhead,
  type RigInput,
  type SchedulerSettings,
  type SiteInput,
  type SiteLinkInput,
  type TelescopeInput,
} from '@nina-pm/shared';
import { sql, type Selectable, type Transaction } from 'kysely';
import { withTx } from '../tx';
import type {
  CameraTable,
  Database,
  ExposureTemplateLineTable,
  ExposureTemplateTable,
  FilterTable,
  MoonProfileTable,
  RigTable,
  SiteLinkTable,
  SiteTable,
  TelescopeTable,
} from '../types';
import { TenantRepo } from './base';

type Tx = Transaction<Database>;

export type SiteRow = Selectable<SiteTable>;
export type SiteLinkRow = Selectable<SiteLinkTable>;
export type TelescopeRow = Selectable<TelescopeTable>;
export type FilterRow = Selectable<FilterTable>;
export type MoonProfileRow = Selectable<MoonProfileTable>;
export type TemplateLineRow = Selectable<ExposureTemplateLineTable>;
export type TemplateRow = Selectable<ExposureTemplateTable> & { lines: TemplateLineRow[] };

/** Kamera mit der Spalte `dark_current_e_s_20c` unter ihrem API-Namen (types.ts). */
export type CameraRow = Omit<
  Selectable<CameraTable>,
  'gain_e_per_adu' | 'dark_current_e_s_20c' | 'supportedBinning' | 'gainModes' | 'readoutModes'
> & {
  gainEPerAdu: number | null;
  darkCurrentES20c: number | null;
  supportedBinning: number[];
  gainModes: {
    name: string;
    gain: number;
    readNoiseE: number | null;
    fullWellE: number | null;
    ePerAdu: number | null;
  }[];
  readoutModes: string[];
};

export interface FilterWheelEntry {
  readonly position: number;
  readonly filterId: string | null;
  readonly ninaFilterName: string | null;
  readonly ninaConfirmedAt: string | null;
  readonly ninaConfirmedBy: string | null;
}

export interface ReportedWheel {
  readonly slots: { position: number; name: string; focusOffset: number | null }[];
  readonly reportedAt: string | null;
}

export type RigRow = Omit<
  Selectable<RigTable>,
  'filterWheel' | 'ninaFilterWheel' | 'overhead' | 'sortChain'
> & {
  filterWheel: FilterWheelEntry[];
  ninaFilterWheel: ReportedWheel | null;
  overhead: Overhead;
  sortChain: string[];
};

/** Standardwerte des Aufwands je Block (TK 7.2, Rig-Spalte `overhead`); `afEveryMin = 0` = aus. */
export const DEFAULT_OVERHEAD: Overhead = {
  slewCenterS: 120,
  filterChangeS: 10,
  ditherSettleS: 20,
  afEveryMin: 60,
  afDurationS: 180,
  downloadS: 5,
};

interface User {
  readonly kind: string;
  readonly name: string;
}

const inUse = (users: readonly User[]) =>
  new ProblemError(
    'resource.in_use',
    users.map<FieldError>((u) => ({ path: u.kind, message: u.name })),
  );

const nameTaken = (path = 'name') =>
  new ProblemError('validation.failed', [{ path, message: 'bereits vergeben' }]);

const notFound = () => new ProblemError('resource.not_found');

/** Eindeutigkeitsverletzung (SQLSTATE 23505), z. B. eine Client-UUID aus einem anderen Mandanten. */
const isUniqueViolation = (error: unknown) =>
  (error as { code?: unknown } | null)?.code === '23505';

const json = (value: unknown) => JSON.stringify(value);

function parseOverhead(value: unknown): Overhead {
  const o = (value ?? {}) as Partial<Overhead>;
  return { ...DEFAULT_OVERHEAD, ...o };
}

function parseReported(value: unknown): ReportedWheel | null {
  if (value === null || value === undefined) return null;
  // Heartbeat (AP-14): `{slots:[{position,name,focusOffset}], reportedAt}`; eine bloße Liste ist auch erlaubt.
  const obj = Array.isArray(value) ? { slots: value, reportedAt: null } : (value as ReportedWheel);
  const slots = Array.isArray(obj.slots) ? obj.slots : [];
  return {
    slots: slots.map((s) => ({
      position: Number(s.position),
      name: String(s.name),
      focusOffset: typeof s.focusOffset === 'number' ? s.focusOffset : null,
    })),
    reportedAt: typeof obj.reportedAt === 'string' ? obj.reportedAt : null,
  };
}

function toRig(row: Selectable<RigTable>): RigRow {
  return {
    ...row,
    filterWheel: (Array.isArray(row.filterWheel) ? row.filterWheel : []) as FilterWheelEntry[],
    ninaFilterWheel: parseReported(row.ninaFilterWheel),
    overhead: parseOverhead(row.overhead),
    sortChain: (Array.isArray(row.sortChain) ? row.sortChain : []) as string[],
  };
}

function toCamera(row: Record<string, unknown>): CameraRow {
  const {
    gainEPerAdu,
    gain_e_per_adu: gainRaw,
    darkCurrentES20c,
    dark_current_e_s_20c: darkRaw,
    ...rest
  } = row;
  return {
    ...(rest as Omit<CameraRow, 'gainEPerAdu' | 'darkCurrentES20c'>),
    gainEPerAdu: (gainEPerAdu ?? gainRaw ?? null) as number | null,
    darkCurrentES20c: (darkCurrentES20c ?? darkRaw ?? null) as number | null,
  };
}

const templateHead = (t: ExposureTemplateInput) => ({
  name: t.name,
  telescopeId: t.telescopeId,
  cameraId: t.cameraId,
  notes: t.notes,
});

/** Geänderte Felder `{from, to}` für das Änderungsprotokoll (nur Felder aus `after`). */
function diffOf(before: Record<string, unknown>, after: Record<string, unknown>) {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, to] of Object.entries(after)) {
    const from = before[key];
    if (json(from) !== json(to)) out[key] = { from: from ?? null, to };
  }
  return out;
}

export class EquipmentRepository extends TenantRepo {
  private get tenantId() {
    return this.ctx.tenantId;
  }

  private async log(
    trx: Tx,
    entity: string,
    entityId: string,
    action: 'create' | 'update' | 'delete',
    diff: Record<string, unknown>,
    now: Date,
  ) {
    await trx
      .insertInto('changeLog')
      .values({
        tenantId: this.tenantId,
        entity,
        entityId,
        userId: this.ctx.memberId ?? null,
        action,
        diff: json(diff),
        createdAt: now,
      })
      .execute();
  }

  /** Rigs, die Standort/Teleskop/Kamera nutzen, holen sich die Änderung beim nächsten Sync (FA-RIG-07). */
  private async bumpRigsUsing(
    trx: Tx,
    column: 'siteId' | 'telescopeId' | 'cameraId',
    id: string,
    now: Date,
  ) {
    await trx
      .updateTable('rig')
      .set((eb) => ({ settingsVersion: eb('settingsVersion', '+', 1), updatedAt: now }))
      .where('tenantId', '=', this.tenantId)
      .where(column, '=', id)
      .execute();
  }

  private tx<T>(fn: (trx: Tx) => Promise<T>, guard: { table: string; id: string }[] = []) {
    return withTx(this.db, fn, {
      guard: guard.map((g) => ({ ...g, tenantId: this.tenantId })),
    });
  }

  /** Legt an; eine Eindeutigkeitsverletzung auf der ID (fremder Mandant) wird `validation.failed`. */
  private async insertGuarded<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken('id');
      throw error;
    }
  }

  // ---- Standort ----------------------------------------------------------------------------------

  sites(): Promise<SiteRow[]> {
    return this.db
      .selectFrom('site')
      .selectAll()
      .where('tenantId', '=', this.tenantId)
      .orderBy('name')
      .execute();
  }

  site(id: string, trx: Tx | undefined = undefined): Promise<SiteRow | undefined> {
    return (trx ?? this.db)
      .selectFrom('site')
      .selectAll()
      .where('tenantId', '=', this.tenantId)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  private async siteNameFree(trx: Tx, name: string, exceptId: string) {
    const other = await trx
      .selectFrom('site')
      .select('id')
      .where('tenantId', '=', this.tenantId)
      .where('name', '=', name)
      .where('id', '<>', exceptId)
      .executeTakeFirst();
    if (other) throw nameTaken();
  }

  createSite(id: string, input: SiteInput, now: Date): Promise<SiteRow> {
    return this.insertGuarded(() =>
      this.tx(async (trx) => {
        const existing = await this.site(id, trx);
        if (existing) return existing;
        await this.siteNameFree(trx, input.name, id);
        const row = await trx
          .insertInto('site')
          .values({ ...input, id, tenantId: this.tenantId, createdAt: now, updatedAt: now })
          .returningAll()
          .executeTakeFirstOrThrow();
        await this.log(trx, 'site', id, 'create', { name: input.name }, now);
        return row;
      }),
    );
  }

  updateSite(id: string, input: SiteInput, now: Date): Promise<SiteRow> {
    return this.tx(
      async (trx) => {
        const before = await this.site(id, trx);
        if (!before) throw notFound();
        await this.siteNameFree(trx, input.name, id);
        const row = await trx
          .updateTable('site')
          .set({ ...input, updatedAt: now })
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', id)
          .returningAll()
          .executeTakeFirstOrThrow();
        await this.bumpRigsUsing(trx, 'siteId', id, now);
        await this.log(trx, 'site', id, 'update', diffOf(before, input), now);
        return row;
      },
      [{ table: 'site', id }],
    );
  }

  deleteSite(id: string, now: Date): Promise<void> {
    return this.tx(
      async (trx) => {
        const site = await this.site(id, trx);
        if (!site) throw notFound();
        const users: User[] = (
          await trx
            .selectFrom('rig')
            .select('name')
            .where('tenantId', '=', this.tenantId)
            .where('siteId', '=', id)
            .orderBy('name')
            .execute()
        ).map((r) => ({ kind: 'rig', name: r.name }));
        const stats = await sql<{ n: number }>`
          SELECT count(*)::int AS n FROM site_night_stat
          WHERE tenant_id = ${this.tenantId} AND site_id = ${id}`.execute(trx);
        const n = stats.rows[0]?.n ?? 0;
        if (n > 0) users.push({ kind: 'nightStats', name: String(n) });
        if (users.length > 0) throw inUse(users);
        await trx
          .deleteFrom('siteLink')
          .where('tenantId', '=', this.tenantId)
          .where('siteId', '=', id)
          .execute();
        await trx
          .deleteFrom('site')
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', id)
          .execute();
        await this.log(trx, 'site', id, 'delete', { name: site.name }, now);
      },
      [{ table: 'site', id }],
    );
  }

  // ---- Standort-Links ----------------------------------------------------------------------------

  siteLinks(siteId?: string): Promise<SiteLinkRow[]> {
    let q = this.db.selectFrom('siteLink').selectAll().where('tenantId', '=', this.tenantId);
    if (siteId) q = q.where('siteId', '=', siteId);
    return q.orderBy('siteId').orderBy('name').execute();
  }

  private siteLink(id: string, trx: Tx) {
    return trx
      .selectFrom('siteLink')
      .selectAll()
      .where('tenantId', '=', this.tenantId)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  /** Höchstens ein Standard-Link je Standort (FA-STO-05). */
  private async clearDefault(trx: Tx, siteId: string, exceptId: string) {
    await trx
      .updateTable('siteLink')
      .set({ isDefault: false })
      .where('tenantId', '=', this.tenantId)
      .where('siteId', '=', siteId)
      .where('id', '<>', exceptId)
      .where('isDefault', '=', true)
      .execute();
  }

  private async requireSite(trx: Tx, siteId: string, path = 'siteId') {
    if (!(await this.site(siteId, trx)))
      throw new ProblemError('validation.failed', [{ path, message: 'Standort unbekannt' }]);
  }

  createSiteLink(id: string, input: SiteLinkInput, now: Date): Promise<SiteLinkRow> {
    return this.insertGuarded(() =>
      this.tx(
        async (trx) => {
          const existing = await this.siteLink(id, trx);
          if (existing) return existing;
          await this.requireSite(trx, input.siteId);
          if (input.isDefault) await this.clearDefault(trx, input.siteId, id);
          const row = await trx
            .insertInto('siteLink')
            .values({ ...input, id, tenantId: this.tenantId, createdAt: now })
            .returningAll()
            .executeTakeFirstOrThrow();
          await this.log(trx, 'site_link', id, 'create', { name: input.name }, now);
          return row;
        },
        [{ table: 'site', id: input.siteId }],
      ),
    );
  }

  updateSiteLink(id: string, input: SiteLinkInput, now: Date): Promise<SiteLinkRow> {
    return this.tx(
      async (trx) => {
        const before = await this.siteLink(id, trx);
        if (!before) throw notFound();
        await this.requireSite(trx, input.siteId);
        if (input.isDefault) await this.clearDefault(trx, input.siteId, id);
        const row = await trx
          .updateTable('siteLink')
          .set(input)
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', id)
          .returningAll()
          .executeTakeFirstOrThrow();
        await this.log(trx, 'site_link', id, 'update', diffOf(before, input), now);
        return row;
      },
      [{ table: 'site_link', id }],
    );
  }

  deleteSiteLink(id: string, now: Date): Promise<void> {
    return this.tx(async (trx) => {
      const link = await this.siteLink(id, trx);
      if (!link) throw notFound();
      await trx
        .deleteFrom('siteLink')
        .where('tenantId', '=', this.tenantId)
        .where('id', '=', id)
        .execute();
      await this.log(trx, 'site_link', id, 'delete', { name: link.name }, now);
    });
  }

  // ---- Teleskop ----------------------------------------------------------------------------------

  telescopes(): Promise<TelescopeRow[]> {
    return this.db
      .selectFrom('telescope')
      .selectAll()
      .where('tenantId', '=', this.tenantId)
      .orderBy('name')
      .execute();
  }

  telescope(id: string, trx: Tx | undefined = undefined): Promise<TelescopeRow | undefined> {
    return (trx ?? this.db)
      .selectFrom('telescope')
      .selectAll()
      .where('tenantId', '=', this.tenantId)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  private async telescopeNameFree(trx: Tx, name: string, exceptId: string) {
    const other = await trx
      .selectFrom('telescope')
      .select('id')
      .where('tenantId', '=', this.tenantId)
      .where('name', '=', name)
      .where('id', '<>', exceptId)
      .executeTakeFirst();
    if (other) throw nameTaken();
  }

  createTelescope(id: string, input: TelescopeInput, now: Date): Promise<TelescopeRow> {
    return this.insertGuarded(() =>
      this.tx(async (trx) => {
        const existing = await this.telescope(id, trx);
        if (existing) return existing;
        await this.telescopeNameFree(trx, input.name, id);
        const row = await trx
          .insertInto('telescope')
          .values({ ...input, id, tenantId: this.tenantId, createdAt: now, updatedAt: now })
          .returningAll()
          .executeTakeFirstOrThrow();
        await this.log(trx, 'telescope', id, 'create', { name: input.name }, now);
        return row;
      }),
    );
  }

  updateTelescope(id: string, input: TelescopeInput, now: Date): Promise<TelescopeRow> {
    return this.tx(
      async (trx) => {
        const before = await this.telescope(id, trx);
        if (!before) throw notFound();
        await this.telescopeNameFree(trx, input.name, id);
        const row = await trx
          .updateTable('telescope')
          .set({ ...input, updatedAt: now })
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', id)
          .returningAll()
          .executeTakeFirstOrThrow();
        await this.bumpRigsUsing(trx, 'telescopeId', id, now);
        await this.log(trx, 'telescope', id, 'update', diffOf(before, input), now);
        return row;
      },
      [{ table: 'telescope', id }],
    );
  }

  deleteTelescope(id: string, now: Date): Promise<void> {
    return this.tx(
      async (trx) => {
        const telescope = await this.telescope(id, trx);
        if (!telescope) throw notFound();
        const [rigs, filters, templates] = await Promise.all([
          this.namesWhere(trx, 'rig', 'telescopeId', id),
          trx
            .selectFrom('filter')
            .select('shortName as name')
            .where('tenantId', '=', this.tenantId)
            .where('telescopeId', '=', id)
            .orderBy('shortName')
            .execute(),
          this.namesWhere(trx, 'exposureTemplate', 'telescopeId', id),
        ]);
        const users = [
          ...rigs.map((r) => ({ kind: 'rig', name: r.name })),
          ...filters.map((r) => ({ kind: 'filter', name: r.name })),
          ...templates.map((r) => ({ kind: 'exposureTemplate', name: r.name })),
        ];
        if (users.length > 0) throw inUse(users);
        await trx
          .deleteFrom('telescope')
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', id)
          .execute();
        await this.log(trx, 'telescope', id, 'delete', { name: telescope.name }, now);
      },
      [{ table: 'telescope', id }],
    );
  }

  private namesWhere(
    trx: Tx,
    table: 'rig' | 'exposureTemplate',
    column: 'telescopeId' | 'cameraId' | 'siteId' | 'defaultTemplateId',
    id: string,
  ): Promise<{ name: string }[]> {
    if (table === 'rig')
      return trx
        .selectFrom('rig')
        .select('name')
        .where('tenantId', '=', this.tenantId)
        .where(column, '=', id)
        .orderBy('name')
        .execute();
    return trx
      .selectFrom('exposureTemplate')
      .select('name')
      .where('tenantId', '=', this.tenantId)
      .where(column as 'telescopeId' | 'cameraId', '=', id)
      .orderBy('name')
      .execute();
  }

  // ---- Kamera ------------------------------------------------------------------------------------

  async cameras(): Promise<CameraRow[]> {
    const rows = await this.db
      .selectFrom('camera')
      .selectAll()
      .where('tenantId', '=', this.tenantId)
      .orderBy('name')
      .execute();
    return rows.map((r) => toCamera(r));
  }

  async camera(id: string, trx: Tx | undefined = undefined): Promise<CameraRow | undefined> {
    const row = await (trx ?? this.db)
      .selectFrom('camera')
      .selectAll()
      .where('tenantId', '=', this.tenantId)
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? toCamera(row) : undefined;
  }

  private cameraValues(input: CameraInput) {
    const { gainEPerAdu, darkCurrentES20c, supportedBinning, gainModes, readoutModes, ...rest } =
      input;
    return {
      ...rest,
      gain_e_per_adu: gainEPerAdu,
      dark_current_e_s_20c: darkCurrentES20c,
      supportedBinning: json(supportedBinning),
      gainModes: json(gainModes),
      readoutModes: json(readoutModes),
    };
  }

  private async cameraNameFree(trx: Tx, name: string, exceptId: string) {
    const other = await trx
      .selectFrom('camera')
      .select('id')
      .where('tenantId', '=', this.tenantId)
      .where('name', '=', name)
      .where('id', '<>', exceptId)
      .executeTakeFirst();
    if (other) throw nameTaken();
  }

  createCamera(id: string, input: CameraInput, now: Date): Promise<CameraRow> {
    return this.insertGuarded(() =>
      this.tx(async (trx) => {
        const existing = await this.camera(id, trx);
        if (existing) return existing;
        await this.cameraNameFree(trx, input.name, id);
        await trx
          .insertInto('camera')
          .values({
            ...this.cameraValues(input),
            id,
            tenantId: this.tenantId,
            createdAt: now,
            updatedAt: now,
          })
          .execute();
        await this.log(trx, 'camera', id, 'create', { name: input.name }, now);
        return (await this.camera(id, trx)) as CameraRow;
      }),
    );
  }

  updateCamera(id: string, input: CameraInput, now: Date): Promise<CameraRow> {
    return this.tx(
      async (trx) => {
        const before = await this.camera(id, trx);
        if (!before) throw notFound();
        await this.cameraNameFree(trx, input.name, id);
        await trx
          .updateTable('camera')
          .set({ ...this.cameraValues(input), updatedAt: now })
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', id)
          .execute();
        await this.bumpRigsUsing(trx, 'cameraId', id, now);
        await this.log(trx, 'camera', id, 'update', diffOf(before, input), now);
        return (await this.camera(id, trx)) as CameraRow;
      },
      [{ table: 'camera', id }],
    );
  }

  deleteCamera(id: string, now: Date): Promise<void> {
    return this.tx(
      async (trx) => {
        const camera = await this.camera(id, trx);
        if (!camera) throw notFound();
        const [rigs, templates] = await Promise.all([
          this.namesWhere(trx, 'rig', 'cameraId', id),
          this.namesWhere(trx, 'exposureTemplate', 'cameraId', id),
        ]);
        const users = [
          ...rigs.map((r) => ({ kind: 'rig', name: r.name })),
          ...templates.map((r) => ({ kind: 'exposureTemplate', name: r.name })),
        ];
        if (users.length > 0) throw inUse(users);
        await trx
          .deleteFrom('camera')
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', id)
          .execute();
        await this.log(trx, 'camera', id, 'delete', { name: camera.name }, now);
      },
      [{ table: 'camera', id }],
    );
  }

  // ---- Mondprofil --------------------------------------------------------------------------------

  moonProfiles(): Promise<MoonProfileRow[]> {
    return this.db
      .selectFrom('moonProfile')
      .selectAll()
      .where('tenantId', '=', this.tenantId)
      .orderBy('isBuiltIn', 'desc')
      .orderBy('createdAt')
      .orderBy('name')
      .execute();
  }

  moonProfile(id: string, trx: Tx | undefined = undefined): Promise<MoonProfileRow | undefined> {
    return (trx ?? this.db)
      .selectFrom('moonProfile')
      .selectAll()
      .where('tenantId', '=', this.tenantId)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  private async moonNameFree(trx: Tx, name: string, exceptId: string) {
    const other = await trx
      .selectFrom('moonProfile')
      .select('id')
      .where('tenantId', '=', this.tenantId)
      .where('name', '=', name)
      .where('id', '<>', exceptId)
      .executeTakeFirst();
    if (other) throw nameTaken();
  }

  createMoonProfile(id: string, input: MoonProfileInput, now: Date): Promise<MoonProfileRow> {
    return this.insertGuarded(() =>
      this.tx(async (trx) => {
        const existing = await this.moonProfile(id, trx);
        if (existing) return existing;
        await this.moonNameFree(trx, input.name, id);
        const row = await trx
          .insertInto('moonProfile')
          .values({ ...input, id, tenantId: this.tenantId, isBuiltIn: false, createdAt: now })
          .returningAll()
          .executeTakeFirstOrThrow();
        await this.log(trx, 'moon_profile', id, 'create', { name: input.name }, now);
        return row;
      }),
    );
  }

  /** Built-ins sind nicht änderbar (FA-MON-02) → `409 resource.read_only`. */
  updateMoonProfile(id: string, input: MoonProfileInput, now: Date): Promise<MoonProfileRow> {
    return this.tx(
      async (trx) => {
        const before = await this.moonProfile(id, trx);
        if (!before) throw notFound();
        if (before.isBuiltIn) throw new ProblemError('resource.read_only');
        await this.moonNameFree(trx, input.name, id);
        const row = await trx
          .updateTable('moonProfile')
          .set(input)
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', id)
          .returningAll()
          .executeTakeFirstOrThrow();
        await this.log(trx, 'moon_profile', id, 'update', diffOf(before, input), now);
        return row;
      },
      [{ table: 'moon_profile', id }],
    );
  }

  deleteMoonProfile(id: string, now: Date): Promise<void> {
    return this.tx(
      async (trx) => {
        const profile = await this.moonProfile(id, trx);
        if (!profile) throw notFound();
        if (profile.isBuiltIn) throw new ProblemError('resource.read_only');
        const filters = await trx
          .selectFrom('filter')
          .select('shortName as name')
          .where('tenantId', '=', this.tenantId)
          .where('defaultMoonProfileId', '=', id)
          .orderBy('shortName')
          .execute();
        const templates = await trx
          .selectFrom('exposureTemplateLine as l')
          .innerJoin('exposureTemplate as t', 't.id', 'l.templateId')
          .select('t.name')
          .distinct()
          .where('l.tenantId', '=', this.tenantId)
          .where('l.moonProfileId', '=', id)
          .orderBy('t.name')
          .execute();
        const projects = await this.projectsWithLines(trx, sql`l.moon_profile_id = ${id}`);
        const users = [
          ...filters.map((r) => ({ kind: 'filter', name: r.name })),
          ...templates.map((r) => ({ kind: 'exposureTemplate', name: r.name })),
          ...projects.map((name) => ({ kind: 'project', name })),
        ];
        if (users.length > 0) throw inUse(users);
        await trx
          .deleteFrom('moonProfile')
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', id)
          .execute();
        await this.log(trx, 'moon_profile', id, 'delete', { name: profile.name }, now);
      },
      [{ table: 'moon_profile', id }],
    );
  }

  /** Projekte mit Belichtungszeilen, die die Bedingung erfüllen (Tabellen aus AP-10, hier nur lesend). */
  private async projectsWithLines(trx: Tx, condition: ReturnType<typeof sql>): Promise<string[]> {
    const res = await sql<{ name: string }>`
      SELECT DISTINCT p.name AS name FROM exposure_line l
      JOIN project p ON p.id = l.project_id AND p.tenant_id = l.tenant_id
      WHERE l.tenant_id = ${this.tenantId} AND ${condition}
      ORDER BY p.name`.execute(trx);
    return res.rows.map((r) => r.name);
  }

  // ---- Filter ------------------------------------------------------------------------------------

  filters(): Promise<FilterRow[]> {
    return this.db
      .selectFrom('filter')
      .selectAll()
      .where('tenantId', '=', this.tenantId)
      .orderBy('shortName')
      .execute();
  }

  filter(id: string, trx: Tx | undefined = undefined): Promise<FilterRow | undefined> {
    return (trx ?? this.db)
      .selectFrom('filter')
      .selectAll()
      .where('tenantId', '=', this.tenantId)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  private async checkFilterRefs(trx: Tx, input: FilterInput, id: string) {
    const other = await trx
      .selectFrom('filter')
      .select('id')
      .where('tenantId', '=', this.tenantId)
      .where('shortName', '=', input.shortName)
      .where('id', '<>', id)
      .executeTakeFirst();
    if (other) throw nameTaken('shortName');
    if (input.telescopeId && !(await this.telescope(input.telescopeId, trx)))
      throw new ProblemError('validation.failed', [
        { path: 'telescopeId', message: 'Teleskop unbekannt' },
      ]);
    if (input.defaultMoonProfileId && !(await this.moonProfile(input.defaultMoonProfileId, trx)))
      throw new ProblemError('validation.failed', [
        { path: 'defaultMoonProfileId', message: 'Mondprofil unbekannt' },
      ]);
  }

  createFilter(id: string, input: FilterInput, now: Date): Promise<FilterRow> {
    return this.insertGuarded(() =>
      this.tx(async (trx) => {
        const existing = await this.filter(id, trx);
        if (existing) return existing;
        await this.checkFilterRefs(trx, input, id);
        const row = await trx
          .insertInto('filter')
          .values({ ...input, id, tenantId: this.tenantId, createdAt: now, updatedAt: now })
          .returningAll()
          .executeTakeFirstOrThrow();
        await this.log(trx, 'filter', id, 'create', { shortName: input.shortName }, now);
        return row;
      }),
    );
  }

  updateFilter(id: string, input: FilterInput, now: Date): Promise<FilterRow> {
    return this.tx(
      async (trx) => {
        const before = await this.filter(id, trx);
        if (!before) throw notFound();
        await this.checkFilterRefs(trx, input, id);
        const row = await trx
          .updateTable('filter')
          .set({ ...input, updatedAt: now })
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', id)
          .returningAll()
          .executeTakeFirstOrThrow();
        await this.log(trx, 'filter', id, 'update', diffOf(before, input), now);
        return row;
      },
      [{ table: 'filter', id }],
    );
  }

  deleteFilter(id: string, now: Date): Promise<void> {
    return this.tx(
      async (trx) => {
        const filter = await this.filter(id, trx);
        if (!filter) throw notFound();
        const templates = await trx
          .selectFrom('exposureTemplateLine as l')
          .innerJoin('exposureTemplate as t', 't.id', 'l.templateId')
          .select('t.name')
          .distinct()
          .where('l.tenantId', '=', this.tenantId)
          .where('l.filterId', '=', id)
          .orderBy('t.name')
          .execute();
        const rigs = (await this.rigRows(trx)).filter((r) =>
          r.filterWheel.some((s) => s.filterId === id),
        );
        const projects = await this.projectsWithLines(trx, sql`l.filter_id = ${id}`);
        const users = [
          ...rigs.map((r) => ({ kind: 'rig', name: r.name })),
          ...templates.map((r) => ({ kind: 'exposureTemplate', name: r.name })),
          ...projects.map((name) => ({ kind: 'project', name })),
        ];
        if (users.length > 0) throw inUse(users);
        await trx
          .deleteFrom('filter')
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', id)
          .execute();
        await this.log(trx, 'filter', id, 'delete', { shortName: filter.shortName }, now);
      },
      [{ table: 'filter', id }],
    );
  }

  // ---- Belichtungsvorlage ------------------------------------------------------------------------

  async templates(): Promise<TemplateRow[]> {
    const [templates, lines] = await Promise.all([
      this.db
        .selectFrom('exposureTemplate')
        .selectAll()
        .where('tenantId', '=', this.tenantId)
        .orderBy('name')
        .execute(),
      this.db
        .selectFrom('exposureTemplateLine')
        .selectAll()
        .where('tenantId', '=', this.tenantId)
        .orderBy('templateId')
        .orderBy('orderIndex')
        .execute(),
    ]);
    return templates.map((t) => ({ ...t, lines: lines.filter((l) => l.templateId === t.id) }));
  }

  async template(id: string, trx: Tx | undefined = undefined): Promise<TemplateRow | undefined> {
    const db = trx ?? this.db;
    const template = await db
      .selectFrom('exposureTemplate')
      .selectAll()
      .where('tenantId', '=', this.tenantId)
      .where('id', '=', id)
      .executeTakeFirst();
    if (!template) return undefined;
    const lines = await db
      .selectFrom('exposureTemplateLine')
      .selectAll()
      .where('tenantId', '=', this.tenantId)
      .where('templateId', '=', id)
      .orderBy('orderIndex')
      .execute();
    return { ...template, lines };
  }

  /** Prüft Bezüge und schreibt die Zeilen neu (höchstens 50, FA-BPL-02). */
  private async writeLines(trx: Tx, templateId: string, input: ExposureTemplateInput) {
    if (input.telescopeId && !(await this.telescope(input.telescopeId, trx)))
      throw new ProblemError('validation.failed', [
        { path: 'telescopeId', message: 'Teleskop unbekannt' },
      ]);
    let camera: CameraRow | undefined;
    if (input.cameraId) {
      camera = await this.camera(input.cameraId, trx);
      if (!camera)
        throw new ProblemError('validation.failed', [
          { path: 'cameraId', message: 'Kamera unbekannt' },
        ]);
    }
    const filters = new Map((await this.filtersIn(trx)).map((f) => [f.id, f]));
    const profiles = new Set((await this.moonProfilesIn(trx)).map((p) => p.id));
    const errors: FieldError[] = [];
    input.lines.forEach((line, i) => {
      if (!filters.has(line.filterId))
        errors.push({ path: `lines[${String(i)}].filterId`, message: 'Filter unbekannt' });
      if (line.moonProfileId && !profiles.has(line.moonProfileId))
        errors.push({ path: `lines[${String(i)}].moonProfileId`, message: 'Mondprofil unbekannt' });
      if (camera && !camera.supportedBinning.includes(line.binning))
        errors.push({
          path: `lines[${String(i)}].binning`,
          message: 'von der Kamera nicht unterstützt',
        });
      if (camera && line.readoutMode !== null && !camera.readoutModes.includes(line.readoutMode))
        errors.push({
          path: `lines[${String(i)}].readoutMode`,
          message: 'von der Kamera nicht unterstützt',
        });
    });
    if (errors.length > 0) throw new ProblemError('validation.failed', errors);
    await trx
      .deleteFrom('exposureTemplateLine')
      .where('tenantId', '=', this.tenantId)
      .where('templateId', '=', templateId)
      .execute();
    if (input.lines.length === 0) return;
    await trx
      .insertInto('exposureTemplateLine')
      .values(
        input.lines.map((line, i) => ({
          ...line,
          tenantId: this.tenantId,
          templateId,
          filterShortName: filters.get(line.filterId)?.shortName ?? '',
          orderIndex: i,
        })),
      )
      .execute();
  }

  private filtersIn(trx: Tx) {
    return trx
      .selectFrom('filter')
      .select(['id', 'shortName'])
      .where('tenantId', '=', this.tenantId)
      .execute();
  }

  private moonProfilesIn(trx: Tx) {
    return trx
      .selectFrom('moonProfile')
      .select(['id'])
      .where('tenantId', '=', this.tenantId)
      .execute();
  }

  createTemplate(id: string, input: ExposureTemplateInput, now: Date): Promise<TemplateRow> {
    return this.insertGuarded(() =>
      this.tx(async (trx) => {
        const existing = await this.template(id, trx);
        if (existing) return existing;
        const head = templateHead(input);
        await trx
          .insertInto('exposureTemplate')
          .values({ ...head, id, tenantId: this.tenantId, createdAt: now, updatedAt: now })
          .execute();
        await this.writeLines(trx, id, input);
        await this.log(trx, 'exposure_template', id, 'create', { name: input.name }, now);
        return (await this.template(id, trx)) as TemplateRow;
      }),
    );
  }

  updateTemplate(id: string, input: ExposureTemplateInput, now: Date): Promise<TemplateRow> {
    return this.tx(
      async (trx) => {
        const before = await this.template(id, trx);
        if (!before) throw notFound();
        const head = templateHead(input);
        await trx
          .updateTable('exposureTemplate')
          .set({ ...head, updatedAt: now })
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', id)
          .execute();
        await this.writeLines(trx, id, input);
        const diff: Record<string, unknown> = diffOf(before, head);
        diff.lines = { from: before.lines.length, to: input.lines.length };
        await this.log(trx, 'exposure_template', id, 'update', diff, now);
        return (await this.template(id, trx)) as TemplateRow;
      },
      [{ table: 'exposure_template', id }],
    );
  }

  deleteTemplate(id: string, now: Date): Promise<void> {
    return this.tx(
      async (trx) => {
        const template = await this.template(id, trx);
        if (!template) throw notFound();
        const rigs = await this.namesWhere(trx, 'rig', 'defaultTemplateId', id);
        if (rigs.length > 0) throw inUse(rigs.map((r) => ({ kind: 'rig', name: r.name })));
        await trx
          .deleteFrom('exposureTemplateLine')
          .where('tenantId', '=', this.tenantId)
          .where('templateId', '=', id)
          .execute();
        await trx
          .deleteFrom('exposureTemplate')
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', id)
          .execute();
        await this.log(trx, 'exposure_template', id, 'delete', { name: template.name }, now);
      },
      [{ table: 'exposure_template', id }],
    );
  }

  // ---- Rig ---------------------------------------------------------------------------------------

  private async rigRows(trx: Tx | undefined = undefined): Promise<RigRow[]> {
    const rows = await (trx ?? this.db)
      .selectFrom('rig')
      .selectAll()
      .where('tenantId', '=', this.tenantId)
      .orderBy('name')
      .execute();
    return rows.map(toRig);
  }

  rigs(): Promise<RigRow[]> {
    return this.rigRows();
  }

  async rig(id: string, trx: Tx | undefined = undefined): Promise<RigRow | undefined> {
    const row = await (trx ?? this.db)
      .selectFrom('rig')
      .selectAll()
      .where('tenantId', '=', this.tenantId)
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? toRig(row) : undefined;
  }

  private async checkRigRefs(trx: Tx, input: RigInput, id: string) {
    const other = await trx
      .selectFrom('rig')
      .select('id')
      .where('tenantId', '=', this.tenantId)
      .where('name', '=', input.name)
      .where('id', '<>', id)
      .executeTakeFirst();
    if (other) throw nameTaken();
    const errors: FieldError[] = [];
    if (!(await this.site(input.siteId, trx)))
      errors.push({ path: 'siteId', message: 'Standort unbekannt' });
    if (!(await this.telescope(input.telescopeId, trx)))
      errors.push({ path: 'telescopeId', message: 'Teleskop unbekannt' });
    if (!(await this.camera(input.cameraId, trx)))
      errors.push({ path: 'cameraId', message: 'Kamera unbekannt' });
    if (input.defaultTemplateId && !(await this.template(input.defaultTemplateId, trx)))
      errors.push({ path: 'defaultTemplateId', message: 'Vorlage unbekannt' });
    if (errors.length > 0) throw new ProblemError('validation.failed', errors);
  }

  private rigGuards(input: RigInput) {
    return [
      { table: 'site', id: input.siteId },
      { table: 'telescope', id: input.telescopeId },
      { table: 'camera', id: input.cameraId },
    ];
  }

  createRig(id: string, input: RigInput, now: Date): Promise<RigRow> {
    return this.insertGuarded(() =>
      this.tx(async (trx) => {
        const existing = await this.rig(id, trx);
        if (existing) return existing;
        await this.checkRigRefs(trx, input, id);
        await trx
          .insertInto('rig')
          .values({
            ...input,
            id,
            tenantId: this.tenantId,
            filterWheel: '[]',
            sortChain: json([
              'lowest_peak_altitude',
              'setting_soonest',
              'most_remaining',
              'constrained',
            ]),
            overhead: json(DEFAULT_OVERHEAD),
            createdAt: now,
            updatedAt: now,
          })
          .execute();
        await this.log(trx, 'rig', id, 'create', { name: input.name }, now);
        return (await this.rig(id, trx)) as RigRow;
      }, this.rigGuards(input)),
    );
  }

  /** Optimistische Sperre über `settings_version` (`If-Match`) → `412 resource.version_conflict`. */
  private checkVersion(rig: RigRow, expected: number | undefined) {
    if (expected !== undefined && rig.settingsVersion !== expected)
      throw new ProblemError('resource.version_conflict');
  }

  updateRig(id: string, input: RigInput, now: Date, expectedVersion?: number): Promise<RigRow> {
    return this.tx(
      async (trx) => {
        const before = await this.rig(id, trx);
        if (!before) throw notFound();
        this.checkVersion(before, expectedVersion);
        await this.checkRigRefs(trx, input, id);
        await trx
          .updateTable('rig')
          .set({ ...input, settingsVersion: before.settingsVersion + 1, updatedAt: now })
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', id)
          .execute();
        await this.log(trx, 'rig', id, 'update', diffOf(before, input), now);
        return (await this.rig(id, trx)) as RigRow;
      },
      [{ table: 'rig', id }, ...this.rigGuards(input)],
    );
  }

  /** Scheduler-Einstellungen (FA-RIG-04, `PUT /rigs/{id}/scheduler-settings`); erhöht `settings_version`. */
  updateScheduler(
    id: string,
    input: SchedulerSettings,
    now: Date,
    expectedVersion?: number,
  ): Promise<RigRow> {
    validateSortChain(input.sortChain);
    validateFlip(input);
    return this.tx(
      async (trx) => {
        const before = await this.rig(id, trx);
        if (!before) throw notFound();
        this.checkVersion(before, expectedVersion);
        const { sortChain, overhead, ...rest } = input;
        await trx
          .updateTable('rig')
          .set({
            ...rest,
            sortChain: json(sortChain),
            overhead: json(overhead),
            settingsVersion: before.settingsVersion + 1,
            updatedAt: now,
          })
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', id)
          .execute();
        await this.log(trx, 'rig', id, 'update', diffOf(before, input), now);
        return (await this.rig(id, trx)) as RigRow;
      },
      [{ table: 'rig', id }],
    );
  }

  /**
   * Filterradbelegung bestätigen (FA-RIG-14, NT-E1): je Platz Web-Filter und NINA-Name; bestätigt am/von
   * wird gesetzt, unveränderte bestätigte Plätze behalten ihre Bestätigung. Erhöht `settings_version`.
   */
  putFilterWheel(
    id: string,
    input: FilterWheelPut,
    now: Date,
    expectedVersion?: number,
  ): Promise<RigRow> {
    return this.tx(
      async (trx) => {
        const before = await this.rig(id, trx);
        if (!before) throw notFound();
        this.checkVersion(before, expectedVersion);
        const known = new Set((await this.filtersIn(trx)).map((f) => f.id));
        const errors: FieldError[] = [];
        input.slots.forEach((s, i) => {
          if (s.filterId !== null && !known.has(s.filterId))
            errors.push({ path: `slots[${String(i)}].filterId`, message: 'Filter unbekannt' });
        });
        if (errors.length > 0) throw new ProblemError('validation.failed', errors);
        const nowIso = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
        const wheel: FilterWheelEntry[] = [...input.slots]
          .sort((a, b) => a.position - b.position)
          .map((s) => {
            const prev = before.filterWheel.find((p) => p.position === s.position);
            const unchanged =
              prev !== undefined &&
              prev.filterId === s.filterId &&
              prev.ninaFilterName === s.ninaFilterName &&
              prev.ninaConfirmedAt !== null;
            const named = s.ninaFilterName !== null;
            return {
              position: s.position,
              filterId: s.filterId,
              ninaFilterName: s.ninaFilterName,
              ninaConfirmedAt: unchanged ? prev.ninaConfirmedAt : named ? nowIso : null,
              ninaConfirmedBy: unchanged
                ? prev.ninaConfirmedBy
                : named
                  ? (this.ctx.memberId ?? null)
                  : null,
            };
          });
        await trx
          .updateTable('rig')
          .set({
            filterWheel: json(wheel),
            settingsVersion: before.settingsVersion + 1,
            updatedAt: now,
          })
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', id)
          .execute();
        await this.log(
          trx,
          'rig',
          id,
          'update',
          { filterWheel: { from: before.filterWheel, to: wheel } },
          now,
        );
        return (await this.rig(id, trx)) as RigRow;
      },
      [{ table: 'rig', id }],
    );
  }

  deleteRig(id: string, now: Date): Promise<void> {
    return this.tx(
      async (trx) => {
        const rig = await this.rig(id, trx);
        if (!rig) throw notFound();
        const t = this.tenantId;
        const [projects, instances, sessions, plans, lease] = await Promise.all([
          sql<{ name: string }>`
            SELECT name FROM project WHERE tenant_id = ${t} AND (rig_id = ${id} OR requested_rig_id = ${id})
            ORDER BY name`.execute(trx),
          sql<{ name: string }>`
            SELECT name FROM nina_instance WHERE tenant_id = ${t} AND rig_id = ${id} ORDER BY name`.execute(
            trx,
          ),
          sql<{ n: number }>`
            SELECT count(*)::int AS n FROM session WHERE tenant_id = ${t} AND rig_id = ${id}`.execute(
            trx,
          ),
          sql<{ n: number }>`
            SELECT count(*)::int AS n FROM night_plan WHERE tenant_id = ${t} AND rig_id = ${id}`.execute(
            trx,
          ),
          sql<{ active: string | null }>`
            SELECT active_session_id AS active FROM rig_lease WHERE tenant_id = ${t} AND rig_id = ${id}`.execute(
            trx,
          ),
        ]);
        const users: User[] = [
          ...projects.rows.map((r) => ({ kind: 'project', name: r.name })),
          ...instances.rows.map((r) => ({ kind: 'ninaInstance', name: r.name })),
        ];
        const sessionCount = sessions.rows[0]?.n ?? 0;
        const planCount = plans.rows[0]?.n ?? 0;
        if (sessionCount > 0) users.push({ kind: 'sessions', name: String(sessionCount) });
        if (planCount > 0) users.push({ kind: 'nightPlans', name: String(planCount) });
        if (lease.rows[0]?.active)
          users.push({ kind: 'activeSession', name: lease.rows[0].active });
        if (users.length > 0) throw inUse(users);
        await sql`DELETE FROM rig_lease WHERE tenant_id = ${t} AND rig_id = ${id}`.execute(trx);
        await trx.deleteFrom('rig').where('tenantId', '=', t).where('id', '=', id).execute();
        await this.log(trx, 'rig', id, 'delete', { name: rig.name }, now);
      },
      [{ table: 'rig', id }],
    );
  }

  /**
   * Filterrad-Ansicht (FA-RIG-14): gepflegte Plätze ∪ gemeldete Plätze, je Platz Vorschlag nach
   * `suggestNinaFilterName` und – für Plätze ohne Web-Filter – der passende Web-Filter.
   */
  async filterWheel(id: string) {
    const rig = await this.rig(id);
    if (!rig) throw notFound();
    const filters = await this.filters();
    const reported = rig.ninaFilterWheel;
    const reportedNames = reported?.slots.map((s) => s.name) ?? [];
    const positions = [
      ...new Set([
        ...rig.filterWheel.map((s) => s.position),
        ...(reported?.slots.map((s) => s.position) ?? []),
      ]),
    ].sort((a, b) => a - b);
    const slots = positions.map((position) => {
      const slot = rig.filterWheel.find((s) => s.position === position);
      const reportedName = reported?.slots.find((s) => s.position === position)?.name ?? null;
      const filter = slot?.filterId ? filters.find((f) => f.id === slot.filterId) : undefined;
      const suggestion = filter ? suggestNinaFilterName(filter.shortName, reportedNames) : null;
      const suggestedFilter =
        reportedName === null
          ? undefined
          : filters.find((f) => suggestNinaFilterName(f.shortName, [reportedName]) !== null);
      const confirmedName = slot?.ninaFilterName ?? null;
      return {
        position,
        filterId: slot?.filterId ?? null,
        ninaFilterName: confirmedName,
        ninaConfirmedAt: slot?.ninaConfirmedAt ?? null,
        ninaConfirmedBy: slot?.ninaConfirmedBy ?? null,
        reportedName,
        suggestion,
        suggestedFilterId: suggestedFilter?.id ?? null,
        changedByNina:
          confirmedName !== null &&
          (slot?.ninaConfirmedAt ?? null) === null &&
          reportedName !== null &&
          reportedName !== confirmedName,
      };
    });
    return { slots, reported, settingsVersion: rig.settingsVersion };
  }
}
