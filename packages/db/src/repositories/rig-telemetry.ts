/**
 * Rig-Telemetrie (AP-67, FA-RIG-15 … 18, Migration 0015): Messpunkte der Skripte am Rig (Mini-PC, Powerbox).
 *
 * - **Ingest** (`api`, NINA-Token): ein Messpunkt je (Rig, Quelle, Zeitpunkt), `ON CONFLICT DO NOTHING` – erneutes
 *   Senden schadet nicht. Mandant und Rig kommen aus dem Token; das Rig wird gegen den Mandanten geprüft.
 * - **Lesen** (`api`, Web): Rohwerte bzw. Stundenwerte eines Zeitraums, jüngster Messpunkt.
 * - **Verdichten und Aufbewahren** (`worker`, `tick-hourly`, mandantenübergreifend wie `deleteExpiredInvitations`):
 *   abgeschlossene Stunden der letzten 7 Tage, deren Anzahl Rohwerte sich von der gespeicherten Stunde unterscheidet,
 *   neu verdichten; Rohwerte älter als 90 Tage in Stapeln löschen (rules/dsql.md: ≤ 2.500 Zeilen je Transaktion).
 *   Stunden werden in UTC gerechnet (`date_trunc` auf `at_utc AT TIME ZONE 'UTC'`).
 */
import { sql, type Kysely, type Transaction } from 'kysely';
import { ProblemError, telemetrySources } from '@nina-pm/shared';
import { TenantRepo } from './base';
import { retryOcc, withTx } from '../tx';
import type { Database, TelemetryStat } from '../types';

type Tx = Transaction<Database>;

export interface TelemetrySampleInput {
  readonly atUtc: Date;
  readonly metrics: Readonly<Record<string, number>>;
}

export interface TelemetryRawRow {
  readonly atUtc: Date;
  readonly metrics: Record<string, number>;
}

export interface TelemetryHourRow {
  readonly hourUtc: Date;
  readonly samples: number;
  readonly stats: Record<string, TelemetryStat>;
}

/** Rohwerte bleiben so lange (Entscheidung Sven 08.10.2026). */
export const TELEMETRY_RAW_DAYS = 90;
/** So weit zurück prüft die Verdichtung auf spät eingetroffene Werte (= ältester angenommener Messpunkt). */
export const TELEMETRY_ROLLUP_DAYS = 7;
/** Stapel beim Löschen (rules/dsql.md: ≤ 2.500 je Transaktion). */
export const TELEMETRY_DELETE_BATCH = 2500;

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

const asDate = (v: Date | string) => (v instanceof Date ? v : new Date(v));
const asJson = <T>(v: unknown): T => (typeof v === 'string' ? (JSON.parse(v) as T) : (v as T));

export class RigTelemetryRepository extends TenantRepo {
  private get tenantId() {
    return this.ctx.tenantId;
  }

  /** Rig gehört zum Mandanten (Kette prüfen, rules/dsql.md) – sonst `false`. */
  async rigExists(rigId: string, trx: Kysely<Database> = this.db): Promise<boolean> {
    const row = await trx
      .selectFrom('rig')
      .select('id')
      .where('tenantId', '=', this.tenantId)
      .where('id', '=', rigId)
      .executeTakeFirst();
    return row !== undefined;
  }

  /** `POST /nina/v1/telemetry`: idempotent über (Rig, Quelle, Zeitpunkt). */
  ingest(
    rigId: string,
    source: string,
    samples: readonly TelemetrySampleInput[],
    now: Date,
  ): Promise<{ accepted: number; duplicate: number }> {
    return withTx(this.db, async (trx) => {
      if (samples.length === 0) return { accepted: 0, duplicate: 0 };
      if (!(await this.rigExists(rigId, trx))) throw new ProblemError('resource.not_found');
      const inserted = await trx
        .insertInto('rigTelemetrySample')
        .values(
          samples.map((s) => ({
            tenantId: this.tenantId,
            rigId,
            source,
            atUtc: s.atUtc,
            metrics: JSON.stringify(s.metrics) as unknown as Record<string, number>,
            receivedAt: now,
          })),
        )
        .onConflict((oc) => oc.columns(['rigId', 'source', 'atUtc']).doNothing())
        .returning('atUtc')
        .execute();
      return { accepted: inserted.length, duplicate: samples.length - inserted.length };
    });
  }

  /** Rohwerte im Zeitraum `[from, to)`, aufsteigend. */
  async raw(rigId: string, source: string, from: Date, to: Date): Promise<TelemetryRawRow[]> {
    const rows = await this.db
      .selectFrom('rigTelemetrySample')
      .select(['atUtc', 'metrics'])
      .where('tenantId', '=', this.tenantId)
      .where('rigId', '=', rigId)
      .where('source', '=', source)
      .where('atUtc', '>=', from)
      .where('atUtc', '<', to)
      .orderBy('atUtc')
      .execute();
    return rows.map((r) => ({
      atUtc: asDate(r.atUtc),
      metrics: asJson<Record<string, number>>(r.metrics),
    }));
  }

  /** Stundenwerte im Zeitraum `[from, to)`, aufsteigend. */
  async hourly(rigId: string, source: string, from: Date, to: Date): Promise<TelemetryHourRow[]> {
    const rows = await this.db
      .selectFrom('rigTelemetryHourly')
      .select(['hourUtc', 'samples', 'stats'])
      .where('tenantId', '=', this.tenantId)
      .where('rigId', '=', rigId)
      .where('source', '=', source)
      .where('hourUtc', '>=', from)
      .where('hourUtc', '<', to)
      .orderBy('hourUtc')
      .execute();
    return rows.map((r) => ({
      hourUtc: asDate(r.hourUtc),
      samples: r.samples,
      stats: asJson<Record<string, TelemetryStat>>(r.stats),
    }));
  }

  /** Jüngster Messpunkt der Quelle; `null` = keiner (mehr) gespeichert. */
  async latest(rigId: string, source: string): Promise<TelemetryRawRow | null> {
    const row = await this.db
      .selectFrom('rigTelemetrySample')
      .select(['atUtc', 'metrics'])
      .where('tenantId', '=', this.tenantId)
      .where('rigId', '=', rigId)
      .where('source', '=', source)
      .orderBy('atUtc', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row
      ? { atUtc: asDate(row.atUtc), metrics: asJson<Record<string, number>>(row.metrics) }
      : null;
  }
}

/**
 * Telemetrie eines Rigs löschen, höchstens `limit` Zeilen je Tabelle und Quelle (Rig löschen, `equipment.ts`).
 * Liefert die Anzahl gelöschter Zeilen.
 */
export async function deleteRigTelemetryBatch(
  trx: Tx,
  tenantId: string,
  rigId: string,
  limit: number,
): Promise<number> {
  let n = 0;
  for (const source of telemetrySources) {
    const a = await sql`
      DELETE FROM rig_telemetry_sample WHERE tenant_id = ${tenantId} AND rig_id = ${rigId} AND source = ${source}
        AND at_utc IN (SELECT at_utc FROM rig_telemetry_sample
          WHERE tenant_id = ${tenantId} AND rig_id = ${rigId} AND source = ${source} LIMIT ${limit})`.execute(
      trx,
    );
    const b = await sql`
      DELETE FROM rig_telemetry_hourly WHERE tenant_id = ${tenantId} AND rig_id = ${rigId} AND source = ${source}
        AND hour_utc IN (SELECT hour_utc FROM rig_telemetry_hourly
          WHERE tenant_id = ${tenantId} AND rig_id = ${rigId} AND source = ${source} LIMIT ${limit})`.execute(
      trx,
    );
    n += Number(a.numAffectedRows ?? 0) + Number(b.numAffectedRows ?? 0);
  }
  return n;
}

/** Statistik je Messgröße über die Rohwerte einer Stunde. */
export function hourStats(
  rows: readonly { metrics: Record<string, number> }[],
): Record<string, TelemetryStat> {
  const acc = new Map<string, { min: number; max: number; sum: number; n: number }>();
  for (const r of rows)
    for (const [k, v] of Object.entries(r.metrics)) {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const a = acc.get(k);
      if (a) {
        a.min = Math.min(a.min, v);
        a.max = Math.max(a.max, v);
        a.sum += v;
        a.n += 1;
      } else acc.set(k, { min: v, max: v, sum: v, n: 1 });
    }
  const out: Record<string, TelemetryStat> = {};
  for (const [k, a] of acc)
    out[k] = { min: a.min, avg: Math.round((a.sum / a.n) * 1000) / 1000, max: a.max, n: a.n };
  return out;
}

/** Rigs aller Mandanten (die Telemetrie hängt am Rig). */
async function allRigs(db: Kysely<Database>): Promise<{ id: string; tenantId: string }[]> {
  return db.selectFrom('rig').select(['id', 'tenantId']).execute();
}

/**
 * Wartung im `worker` (`tick-hourly`): abgeschlossene Stunden der letzten `TELEMETRY_ROLLUP_DAYS` Tage verdichten,
 * deren Anzahl Rohwerte nicht zur gespeicherten Stunde passt (neu oder spät eingetroffen). Liefert die Anzahl
 * geschriebener Stunden.
 */
export async function rollupRigTelemetry(db: Kysely<Database>, now: Date): Promise<number> {
  const to = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);
  const from = new Date(to.getTime() - TELEMETRY_ROLLUP_DAYS * DAY_MS);
  let written = 0;
  for (const rig of await allRigs(db))
    for (const source of telemetrySources) {
      const counts = await sql<{ hour: Date | string; n: number | string }>`
        SELECT date_trunc('hour', at_utc AT TIME ZONE 'UTC') AS hour, count(*) AS n
        FROM rig_telemetry_sample
        WHERE tenant_id = ${rig.tenantId} AND rig_id = ${rig.id} AND source = ${source}
          AND at_utc >= ${from} AND at_utc < ${to}
        GROUP BY 1`.execute(db);
      if (counts.rows.length === 0) continue;
      const stored = await db
        .selectFrom('rigTelemetryHourly')
        .select(['hourUtc', 'samples'])
        .where('tenantId', '=', rig.tenantId)
        .where('rigId', '=', rig.id)
        .where('source', '=', source)
        .where('hourUtc', '>=', from)
        .where('hourUtc', '<', to)
        .execute();
      const have = new Map(stored.map((s) => [asDate(s.hourUtc).getTime(), s.samples]));
      for (const c of counts.rows) {
        const hour = utcHour(c.hour);
        if (have.get(hour.getTime()) === Number(c.n)) continue;
        const raw = await db
          .selectFrom('rigTelemetrySample')
          .select('metrics')
          .where('tenantId', '=', rig.tenantId)
          .where('rigId', '=', rig.id)
          .where('source', '=', source)
          .where('atUtc', '>=', hour)
          .where('atUtc', '<', new Date(hour.getTime() + HOUR_MS))
          .execute();
        const stats = hourStats(
          raw.map((r) => ({ metrics: asJson<Record<string, number>>(r.metrics) })),
        );
        await retryOcc(() =>
          db
            .insertInto('rigTelemetryHourly')
            .values({
              tenantId: rig.tenantId,
              rigId: rig.id,
              source,
              hourUtc: hour,
              samples: raw.length,
              stats: JSON.stringify(stats) as unknown as Record<string, TelemetryStat>,
              updatedAt: now,
            })
            .onConflict((oc) =>
              oc.columns(['rigId', 'source', 'hourUtc']).doUpdateSet((eb) => ({
                samples: eb.ref('excluded.samples'),
                stats: eb.ref('excluded.stats'),
                updatedAt: eb.ref('excluded.updatedAt'),
              })),
            )
            .execute(),
        );
        written += 1;
      }
    }
  return written;
}

/**
 * `date_trunc` auf `timestamp` (ohne Zone, Wert in UTC): der Treiber liefert einen String ohne Zone bzw. ein Date in
 * der Prozesszone – beides als UTC lesen.
 */
function utcHour(v: Date | string): Date {
  if (v instanceof Date)
    return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate(), v.getHours(), 0, 0, 0));
  const iso = v.includes('T') ? v : v.replace(' ', 'T');
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
}

/** Wartung im `worker` (`tick-hourly`): Rohwerte älter als `TELEMETRY_RAW_DAYS` Tage in Stapeln löschen. */
export async function purgeRigTelemetry(
  db: Kysely<Database>,
  now: Date,
  batch = TELEMETRY_DELETE_BATCH,
): Promise<number> {
  const cutoff = new Date(now.getTime() - TELEMETRY_RAW_DAYS * DAY_MS);
  let total = 0;
  for (const rig of await allRigs(db))
    for (const source of telemetrySources)
      for (;;) {
        const res = await retryOcc(() =>
          sql`
            DELETE FROM rig_telemetry_sample
            WHERE tenant_id = ${rig.tenantId} AND rig_id = ${rig.id} AND source = ${source}
              AND at_utc IN (SELECT at_utc FROM rig_telemetry_sample
                WHERE tenant_id = ${rig.tenantId} AND rig_id = ${rig.id} AND source = ${source}
                  AND at_utc < ${cutoff}
                ORDER BY at_utc LIMIT ${batch})`.execute(db),
        );
        const n = Number(res.numAffectedRows ?? 0);
        total += n;
        if (n < batch) break;
      }
  return total;
}
