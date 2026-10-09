/**
 * Bildqualität (AP-72): Bezugswerte je Projekt und Filter, Autofokus-Läufe des Rigs und die Lights je Nacht eines
 * Standorts für „klar laut Bildern“. Nur lesend, ohne Migration – die Werte stehen in `capture.metrics` (Plugin
 * ≥ 0.4.21/0.4.22) und `session_event.data` (`af`). Jede Abfrage mandantengebunden.
 */
import { medianOf, type ClarityLight, type QualityRef } from '@nina-pm/shared';
import { sql } from 'kysely';
import { TenantRepo } from './base';

/** Fenster der Bezugswerte bzw. Autofokus-Läufe in Nächten bis zur Nacht der Session. */
export const QUALITY_REF_NIGHTS = 30;
export const FOCUS_RUN_NIGHTS = 60;
/** Obergrenze je Abfrage (eine Nacht hat einige hundert Lights). */
const ROW_LIMIT = 60_000;

const dayMs = 86_400_000;
const nightKey = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
const ms = (v: unknown) => (v instanceof Date ? v.getTime() : Date.parse(String(v)));
const windowStart = (toNight: string, nights: number) =>
  new Date(Date.parse(`${toNight}T00:00:00Z`) - (nights - 1) * dayMs).toISOString().slice(0, 10);
const finite = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const positive = (v: unknown) => {
  const n = finite(v);
  return n !== null && n > 0 ? n : null;
};

/** Ein Autofokus-Lauf mit Nacht (Ereignis `af`, Ergebnis ok). */
export interface FocusRunRow {
  readonly night: string;
  readonly occurredAt: string;
  readonly filter: string;
  readonly position: number;
  readonly temperatureC: number;
}

/** Lights einer Nacht (für „klar laut Bildern“ in der Standort-Statistik). */
export interface NightLights {
  readonly night: string;
  readonly rigId: string;
  readonly lights: ClarityLight[];
}

export class ImageQualityRepository extends TenantRepo {
  /** Gespeicherte, zugeordnete, nicht verworfene Lights des Rigs mit Messwerten in den Nächten `from…to`. */
  private lightRows(rigIds: readonly string[], fromNight: string, toNight: string) {
    return this.db
      .selectFrom('capture as c')
      .innerJoin('session as s', (j) =>
        j.onRef('s.id', '=', 'c.sessionId').onRef('s.tenantId', '=', 'c.tenantId'),
      )
      .select([
        's.night',
        's.rigId',
        'c.capturedAt',
        'c.projectId',
        'c.filterShortName',
        sql<unknown>`c.metrics->>'stars'`.as('stars'),
        sql<unknown>`c.metrics->>'hfr'`.as('hfr'),
        sql<unknown>`c.metrics->>'medianAdu'`.as('medianAdu'),
        sql<unknown>`c.metrics->>'cloudCoverPct'`.as('cloudCoverPct'),
      ])
      .where('c.tenantId', '=', this.ctx.tenantId)
      .where('s.rigId', 'in', [...rigIds])
      .where('s.night', '>=', fromNight)
      .where('s.night', '<=', toNight)
      .where('c.frameType', '=', 'light')
      .where('c.result', '=', 'saved')
      .where('c.assignment', '=', 'assigned')
      .where('c.rejected', '=', false)
      .where('c.metrics', 'is not', null)
      .orderBy('c.capturedAt')
      .limit(ROW_LIMIT)
      .execute();
  }

  /**
   * Bezugswerte (FA-AUS-23): Median von Sternen, HFR (px) und Hintergrund je Projekt und Filter über die nicht
   * verworfenen Lights des Rigs in den `QUALITY_REF_NIGHTS` Nächten bis `toNight` (diese Nacht eingeschlossen).
   */
  async refs(rigId: string, toNight: string): Promise<QualityRef[]> {
    const rows = await this.lightRows([rigId], windowStart(toNight, QUALITY_REF_NIGHTS), toNight);
    const groups = new Map<
      string,
      {
        projectId: string;
        filter: string;
        stars: number[];
        hfr: number[];
        adu: number[];
        n: number;
      }
    >();
    for (const r of rows) {
      if (!r.projectId) continue;
      const key = `${r.projectId}|${r.filterShortName}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          projectId: r.projectId,
          filter: r.filterShortName,
          stars: [],
          hfr: [],
          adu: [],
          n: 0,
        };
        groups.set(key, g);
      }
      g.n++;
      const stars = positive(r.stars);
      const hfr = positive(r.hfr);
      const adu = positive(r.medianAdu);
      if (stars !== null) g.stars.push(stars);
      if (hfr !== null) g.hfr.push(hfr);
      if (adu !== null) g.adu.push(adu);
    }
    return [...groups.values()]
      .map((g) => ({
        projectId: g.projectId,
        filter: g.filter,
        stars: medianOf(g.stars),
        hfr: medianOf(g.hfr),
        medianAdu: medianOf(g.adu),
        n: g.n,
      }))
      .sort((a, b) => a.projectId.localeCompare(b.projectId) || a.filter.localeCompare(b.filter));
  }

  /** Erfolgreiche Autofokus-Läufe des Rigs mit Filter, Position und Temperatur (FA-RIG-20), neueste Nacht `toNight`. */
  async focusRuns(rigId: string, toNight: string): Promise<FocusRunRow[]> {
    const rows = await this.db
      .selectFrom('sessionEvent as e')
      .innerJoin('session as s', (j) =>
        j.onRef('s.id', '=', 'e.sessionId').onRef('s.tenantId', '=', 'e.tenantId'),
      )
      .select(['s.night', 'e.occurredAt', 'e.data'])
      .where('e.tenantId', '=', this.ctx.tenantId)
      .where('s.rigId', '=', rigId)
      .where('s.night', '>=', windowStart(toNight, FOCUS_RUN_NIGHTS))
      .where('s.night', '<=', toNight)
      .where('e.kind', '=', 'af')
      .orderBy('e.occurredAt')
      .limit(ROW_LIMIT)
      .execute();
    const out: FocusRunRow[] = [];
    for (const r of rows) {
      const d = (typeof r.data === 'string' ? JSON.parse(r.data) : r.data) as Record<
        string,
        unknown
      > | null;
      if (!d || d.result === 'failed' || d.code === 'failed') continue;
      const position = finite(d.position);
      const temperatureC = finite(d.temperatureC);
      const filter = typeof d.filter === 'string' && d.filter.trim() !== '' ? d.filter : null;
      if (position === null || temperatureC === null || filter === null) continue;
      out.push({
        night: nightKey(r.night),
        occurredAt: new Date(ms(r.occurredAt)).toISOString(),
        filter,
        position,
        temperatureC,
      });
    }
    return out;
  }

  /** Lights je Nacht und Rig in `from…to` (Standort-Statistik, „klar laut Bildern“). */
  async nightLights(
    rigIds: readonly string[],
    fromNight: string,
    toNight: string,
  ): Promise<NightLights[]> {
    if (rigIds.length === 0) return [];
    const rows = await this.lightRows(rigIds, fromNight, toNight);
    const byNight = new Map<string, NightLights>();
    for (const r of rows) {
      const night = nightKey(r.night);
      const key = `${night}|${r.rigId}`;
      let g = byNight.get(key);
      if (!g) {
        g = { night, rigId: r.rigId, lights: [] };
        byNight.set(key, g);
      }
      g.lights.push({
        atS: ms(r.capturedAt) / 1000,
        projectId: r.projectId,
        filter: r.filterShortName,
        stars: positive(r.stars),
        medianAdu: positive(r.medianAdu),
        cloudCoverPct: finite(r.cloudCoverPct),
      });
    }
    return [...byNight.values()].sort(
      (a, b) => a.night.localeCompare(b.night) || a.rigId.localeCompare(b.rigId),
    );
  }
}
