/**
 * Aufwand-Kennzeichen (FA-PRJ-23, TK 7.4/13, `specs/engine/effort.md`; AP-13e):
 * - `EffortRepository` (mandantengebunden, Rolle `app_job`): Kandidaten eines Standorts und Speichern.
 * - `effortSites` / `siteNightRunDone`: standortbezogener Lauf aus `tick-hourly` über alle Mandanten –
 *   wie der Verfall der Einreichungen eine bewusste Ausnahme von der tenant_id-Regel (TK 6.1, 13).
 *
 * Speichern schreibt nur bei geändertem `effort_input_hash` und setzt `effort_stale` nur zurück, wenn
 * sich das Projekt seit dem Laden nicht geändert hat (Version); sonst bleibt es veraltet, der nächste
 * Auslöser rechnet neu.
 */
import { sql, type Kysely } from 'kysely';
import { withTx } from '../tx';
import type { Database } from '../types';
import { TenantRepo } from './base';

/** Höchstens so viele Projekte je Standortlauf (TK 13, NT-08). */
export const EFFORT_SITE_BATCH = 200;
/** Ohne `effort_stale` wird ein Kennzeichen spätestens nach so vielen Tagen neu gerechnet. */
export const EFFORT_MAX_AGE_DAYS = 7;

export interface EffortRow {
  readonly tag: string | null;
  readonly nights: number | null;
  /** `project.effort_detail` (jsonb). */
  readonly detail: Record<string, unknown>;
  readonly inputHash: string;
  readonly computedAt: Date;
}

export type EffortSaveOutcome = 'saved' | 'unchanged' | 'changed' | 'missing';

export interface EffortSite {
  readonly tenantId: string;
  readonly siteId: string;
  readonly timeZone: string;
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly elevationM: number;
}

export class EffortRepository extends TenantRepo {
  /**
   * Projekte eines Standorts für den Nachtlauf: eingereicht oder freigegeben und aktiv, Rig (bzw.
   * Wunsch-Rig) am Standort, `effort_stale` oder älter als 7 Tage. Veraltete zuerst, dann die ältesten.
   */
  async candidates(siteId: string, now: Date, limit = EFFORT_SITE_BATCH): Promise<string[]> {
    const before = new Date(now.getTime() - EFFORT_MAX_AGE_DAYS * 86_400_000);
    const rows = await this.db
      .selectFrom('project as p')
      .innerJoin('rig as r', (j) =>
        j
          .onRef('r.tenantId', '=', 'p.tenantId')
          .on((eb) =>
            eb.or([
              eb('r.id', '=', eb.ref('p.rigId')),
              eb.and([eb('p.rigId', 'is', null), eb('r.id', '=', eb.ref('p.requestedRigId'))]),
            ]),
          ),
      )
      .select(['p.id', 'p.effortStale', 'p.effortComputedAt'])
      .where('p.tenantId', '=', this.ctx.tenantId)
      .where('r.siteId', '=', siteId)
      .where('p.deletedAt', 'is', null)
      .where((eb) =>
        eb.or([
          eb('p.approvalStatus', '=', 'submitted'),
          eb.and([eb('p.approvalStatus', '=', 'approved'), eb('p.status', '=', 'active')]),
        ]),
      )
      .where((eb) =>
        eb.or([
          eb('p.effortStale', '=', true),
          eb('p.effortComputedAt', 'is', null),
          eb('p.effortComputedAt', '<', before),
        ]),
      )
      .orderBy('p.effortStale', 'desc')
      .orderBy(sql`p.effort_computed_at NULLS FIRST`)
      .orderBy('p.id')
      .limit(limit)
      .execute();
    return rows.map((r) => r.id);
  }

  /**
   * Ergebnis speichern (Wächter auf das Projekt, DSQL OCC): unveränderter Hash → nur `effort_stale`
   * zurücksetzen; geänderte Version → nichts schreiben (`changed`).
   */
  save(projectId: string, version: number, row: EffortRow): Promise<EffortSaveOutcome> {
    const tenantId = this.ctx.tenantId;
    return withTx(
      this.db,
      async (trx) => {
        const p = await trx
          .selectFrom('project')
          .select(['version', 'effortInputHash', 'deletedAt'])
          .where('tenantId', '=', tenantId)
          .where('id', '=', projectId)
          .executeTakeFirst();
        if (!p || p.deletedAt !== null) return 'missing';
        if (p.version !== version) return 'changed';
        const same = p.effortInputHash === row.inputHash;
        await trx
          .updateTable('project')
          .set(
            same
              ? { effortStale: false }
              : {
                  effortStale: false,
                  effortTag: row.tag,
                  effortNights: row.nights,
                  effortDetail: JSON.stringify(row.detail),
                  effortInputHash: row.inputHash,
                  effortComputedAt: row.computedAt,
                },
          )
          .where('tenantId', '=', tenantId)
          .where('id', '=', projectId)
          .execute();
        return same ? 'unchanged' : 'saved';
      },
      { guard: [{ table: 'project', id: projectId, tenantId }] },
    );
  }

  /** Veraltet markieren (Abbruch nach > 5 s, effort.md „Leistung“). */
  async markStale(projectId: string): Promise<void> {
    await this.db
      .updateTable('project')
      .set({ effortStale: true })
      .where('tenantId', '=', this.ctx.tenantId)
      .where('id', '=', projectId)
      .execute();
  }
}

/** Standorte mit mindestens einem Rig, über alle Mandanten (Rolle `app_job`). */
export async function effortSites(db: Kysely<Database>): Promise<EffortSite[]> {
  const rows = await db
    .selectFrom('site as s')
    .select(['s.tenantId', 's.id', 's.timeZone', 's.latitudeDeg', 's.longitudeDeg', 's.elevationM'])
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('rig as r')
          .select('r.id')
          .whereRef('r.siteId', '=', 's.id')
          .whereRef('r.tenantId', '=', 's.tenantId'),
      ),
    )
    .orderBy('s.tenantId')
    .orderBy('s.id')
    .execute();
  return rows.map((r) => ({
    tenantId: r.tenantId,
    siteId: r.id,
    timeZone: r.timeZone,
    latitudeDeg: r.latitudeDeg,
    longitudeDeg: r.longitudeDeg,
    elevationM: r.elevationM,
  }));
}

/** Gab es für diesen Schlüssel schon einen Job (gleich welcher Status)? Idempotenz je `(site, night)`. */
export async function siteNightRunDone(
  db: Kysely<Database>,
  tenantId: string,
  key: string,
): Promise<boolean> {
  const row = await db
    .selectFrom('job')
    .select('id')
    .where('dedupeKey', '=', key)
    .where('tenantId', '=', tenantId)
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}
