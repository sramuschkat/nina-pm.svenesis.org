/**
 * Auswertungs-Demo (Betrieb, `ops-cli demo-evaluation`): Auswertungsdaten **eines** Mandanten löschen und aus
 * `demoEvaluation` (packages/shared) neu schreiben. Nur Auswertungsdaten – Projekte, Ausrüstung, Mitglieder,
 * gespeicherte Simulationen und die Prognose bleiben; Zähler rechnet danach `reconcileSite` aus den Aufnahmen.
 *
 * DSQL (rules/dsql.md): Löschen Kinder vor Eltern in Stapeln (`DEMO_BATCH` Zeilen je Transaktion), Schreiben in
 * Stapeln ≤ 2.500 Zeilen je Transaktion; jeder Schritt ist wiederholbar (Löschen setzt fort, Schreiben mit
 * festen IDs `ON CONFLICT DO NOTHING`).
 */
import type { DemoCapture, DemoNight } from '@nina-pm/shared';
import { sql, type Kysely, type Transaction } from 'kysely';
import { withTx } from '../tx';
import type { Database } from '../types';

export const DEMO_BATCH = 1000;
/** Zeilen je INSERT-Anweisung bzw. Transaktion beim Schreiben. */
const INSERT_CHUNK = 500;
const TX_ROWS = 2500;

/**
 * Auswertungsdaten in Löschreihenfolge (Kinder zuerst). `where` schränkt ein: von `night_plan` nur Pläne der
 * Sessions (Server- und Offline-Pläne), von `notification` nur Session-Alarme.
 */
export const DEMO_CLEAR_ORDER: readonly {
  table: string;
  key: readonly string[];
  where?: ReturnType<typeof sql>;
}[] = [
  { table: 'capture', key: ['id'] },
  { table: 'capture_night', key: ['exposure_line_id', 'night'] },
  { table: 'correction', key: ['id'] },
  {
    table: 'flat_combination',
    key: [
      'session_id',
      'filter_short_name',
      'rotator_mech_deg_dg',
      'gain',
      'offset_adu',
      'binning',
      'readout_mode_index',
    ],
  },
  { table: 'session_event', key: ['id'] },
  { table: 'session_log', key: ['session_id'] },
  { table: 'site_night_stat', key: ['site_id', 'night'] },
  { table: 'session', key: ['id'] },
  {
    table: 'night_plan',
    key: ['id'],
    where: sql`origin IN ('server_plan', 'plugin_offline')`,
  },
  {
    table: 'notification',
    key: ['id'],
    where: sql`kind = 'alert.session_no_heartbeat'`,
  },
];

export interface DemoClearProgress {
  readonly deleted: Record<string, number>;
  readonly done: boolean;
}

export class DemoEvaluationRepository {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly tenantId: string,
  ) {}

  private tx<T>(fn: (trx: Transaction<Database>) => Promise<T>) {
    return withTx(this.db, fn);
  }

  /** Anleger der Demo-Projekte: Owner, sonst das erste aktive Admin-Mitglied. */
  async creator(ownerMemberId: string | null): Promise<string | undefined> {
    if (ownerMemberId) return ownerMemberId;
    const row = await this.db
      .selectFrom('appUser')
      .select('id')
      .where('tenantId', '=', this.tenantId)
      .where('role', '=', 'admin')
      .where('status', '=', 'active')
      .orderBy('id')
      .executeTakeFirst();
    return row?.id;
  }

  /** Zeilen je Tabelle, die `clear` löschen würde (Probelauf). */
  async counts(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const { table, where } of DEMO_CLEAR_ORDER) {
      const res = await sql<{ n: number }>`
        SELECT count(*)::int AS n FROM ${sql.table(table)}
        WHERE tenant_id = ${this.tenantId} ${where ? sql`AND ${where}` : sql``}`.execute(this.db);
      out[table] = Number(res.rows[0]?.n ?? 0);
    }
    return out;
  }

  /**
   * Löscht stapelweise, bis `deadline` (ms seit Epoche) erreicht ist; `done = false` → erneut aufrufen.
   * Vorher werden Verweise ohne Fremdschlüssel auf Sessions geleert (Lease, Notizen, Transits).
   */
  async clear(deadline: number, batch = DEMO_BATCH): Promise<DemoClearProgress> {
    const deleted: Record<string, number> = {};
    await this.tx(async (trx) => {
      await sql`UPDATE rig_lease SET active_session_id = NULL, released_session_id = NULL
                WHERE tenant_id = ${this.tenantId}
                  AND (active_session_id IS NOT NULL OR released_session_id IS NOT NULL)`.execute(
        trx,
      );
      await sql`UPDATE project_note SET session_id = NULL
                WHERE tenant_id = ${this.tenantId} AND session_id IS NOT NULL`.execute(trx);
      await sql`UPDATE transit_observation SET session_id = NULL
                WHERE tenant_id = ${this.tenantId} AND session_id IS NOT NULL`.execute(trx);
    });
    for (const { table, key, where } of DEMO_CLEAR_ORDER) {
      const cols = sql.join(key.map((k) => sql.ref(k)));
      const filter = where ? sql`AND ${where}` : sql``;
      for (;;) {
        if (Date.now() > deadline) return { deleted, done: false };
        const n = await this.tx(async (trx) => {
          const res = await sql`
            DELETE FROM ${sql.table(table)}
            WHERE tenant_id = ${this.tenantId} AND (${cols}) IN (
              SELECT ${cols} FROM ${sql.table(table)}
              WHERE tenant_id = ${this.tenantId} ${filter} LIMIT ${batch})`.execute(trx);
          return Number(res.numAffectedRows ?? 0);
        });
        deleted[table] = (deleted[table] ?? 0) + n;
        if (n < batch) break;
      }
    }
    return { deleted, done: true };
  }

  /** Demo-Projekte freigeben: Rig, Status, Priorität je Rig (fortlaufend hinter vorhandenen). */
  async approve(
    projects: readonly { id: string; rigId: string; status: string }[],
    now: Date,
  ): Promise<void> {
    await this.tx(async (trx) => {
      for (const p of projects) {
        const max = await trx
          .selectFrom('project')
          .select(sql<number>`coalesce(max(priority), 0)`.as('m'))
          .where('tenantId', '=', this.tenantId)
          .where('rigId', '=', p.rigId)
          .where('approvalStatus', '=', 'approved')
          .where('id', '!=', p.id)
          .executeTakeFirst();
        await trx
          .updateTable('project')
          .set({
            approvalStatus: 'approved',
            status: p.status,
            rigId: p.rigId,
            requestedRigId: p.rigId,
            priority: Number(max?.m ?? 0) + 1,
            completedAt: null,
            updatedAt: now,
          })
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', p.id)
          .where('approvalStatus', '!=', 'approved')
          .execute();
        // Wiederholter Lauf: bereits freigegeben → nur Status zurück auf den Ausgangszustand.
        await trx
          .updateTable('project')
          .set({ status: p.status, completedAt: null, updatedAt: now })
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', p.id)
          .execute();
      }
    });
  }

  /** Sessions, Protokolle, Aufnahmen und Klarnacht-Statistik der Nächte schreiben (wiederholbar). */
  async insertNights(
    nights: readonly DemoNight[],
    now: Date,
  ): Promise<{ sessions: number; captures: number }> {
    const sessions = nights.flatMap((n) => n.sessions);
    const captures = nights.flatMap((n) => n.captures);
    const stats = nights.flatMap((n) => n.stats);
    await this.tx(async (trx) => {
      if (sessions.length > 0)
        await trx
          .insertInto('session')
          .values(
            sessions.map((s) => ({
              id: s.id,
              tenantId: this.tenantId,
              rigId: s.rigId,
              ninaInstanceId: s.ninaInstanceId,
              night: s.night,
              nightPlanId: null,
              startedAt: new Date(s.startedAt),
              endedAt: new Date(s.endedAt),
              sessionEndUtc: new Date(s.endedAt),
              status: s.status,
              lastHeartbeatAt: new Date(s.endedAt),
              reviewed: s.reviewed,
              forecastSnapshot: JSON.stringify(s.forecastSnapshot),
              reportStatus: 'skipped',
            })),
          )
          .onConflict((oc) => oc.column('id').doNothing())
          .execute();
      const logs = sessions.filter((s) => s.log !== null);
      if (logs.length > 0)
        await trx
          .insertInto('sessionLog')
          .values(
            logs.map((s) => {
              const l = s.log as NonNullable<typeof s.log>;
              return {
                sessionId: s.id,
                tenantId: this.tenantId,
                startTime: new Date(l.startTime),
                endTime: new Date(l.endTime),
                seeingArcsec: l.seeingArcsec,
                transparencyPct: l.transparencyPct,
                sqm: l.sqm,
                temperatureC: l.temperatureC,
                humidityPct: l.humidityPct,
                windKmh: l.windKmh,
                cloudsNote: l.cloudsNote,
                moonIlluminationPct: l.moonIlluminationPct,
                valueSources: JSON.stringify(l.valueSources),
                updatedBy: null,
                updatedAt: now,
              };
            }),
          )
          .onConflict((oc) => oc.column('sessionId').doNothing())
          .execute();
      if (stats.length > 0)
        await trx
          .insertInto('siteNightStat')
          .values(
            stats.map((x) => ({
              tenantId: this.tenantId,
              siteId: x.siteId,
              night: x.night,
              usable: x.usable,
              usableHours: x.usableHours,
              source: x.source,
            })),
          )
          .onConflict((oc) =>
            oc.columns(['siteId', 'night']).doUpdateSet((eb) => ({
              usable: eb.ref('excluded.usable'),
              usableHours: eb.ref('excluded.usableHours'),
              source: eb.ref('excluded.source'),
            })),
          )
          .execute();
    });
    for (let i = 0; i < captures.length; i += TX_ROWS) {
      const part = captures.slice(i, i + TX_ROWS);
      await this.tx(async (trx) => {
        for (let k = 0; k < part.length; k += INSERT_CHUNK)
          await trx
            .insertInto('capture')
            .values(part.slice(k, k + INSERT_CHUNK).map((c) => this.captureRow(c)))
            .onConflict((oc) => oc.column('id').doNothing())
            .execute();
      });
    }
    return { sessions: sessions.length, captures: captures.length };
  }

  private captureRow(c: DemoCapture) {
    return {
      id: c.id,
      tenantId: this.tenantId,
      sessionId: c.sessionId,
      projectId: c.projectId,
      panelId: c.panelId,
      exposureLineId: c.lineId,
      frameType: 'light',
      assignment: 'assigned',
      night: c.night,
      capturedAt: new Date(c.capturedAt),
      exposureMidUtc: new Date(c.exposureMidUtc),
      filterShortName: c.filter,
      filterActual: c.filter,
      exposureS: c.exposureS,
      gain: c.gain,
      offsetAdu: c.offsetAdu,
      binning: c.binning,
      readoutMode: c.readoutMode,
      raDeg: c.raDeg,
      decDeg: c.decDeg,
      rotationDeg: c.rotationDeg,
      pierSide: c.pierSide,
      result: 'saved',
      rejected: c.rejected,
      rejectReason: c.rejectReason,
      fileName: c.fileName,
      metrics: JSON.stringify(c.metrics),
    };
  }

  /** Endstatus der Projekte nach der Geschichte; Aufwand neu rechnen lassen. */
  async finish(
    status: ReadonlyMap<string, 'active' | 'completed' | 'on_hold' | 'unfinished'>,
    now: Date,
  ): Promise<void> {
    await this.tx(async (trx) => {
      for (const [id, s] of status)
        await trx
          .updateTable('project')
          .set({ status: s, completedAt: s === 'completed' ? now : null, updatedAt: now })
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', id)
          .execute();
      await trx
        .updateTable('project')
        .set({ effortStale: true })
        .where('tenantId', '=', this.tenantId)
        .where('approvalStatus', '=', 'approved')
        .execute();
    });
  }
}
