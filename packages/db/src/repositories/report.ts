/**
 * Projektbericht (AP-34; FA-AUS-18/10/11): Aufnahmenächte je Zeile (`capture_night`, alle Nächte bis `to` –
 * für den kumulierten Verlauf) und gespeicherte, zugeordnete Lights je Session und Zeile im Zeitraum mit
 * der Wetterbewertung des Schnappschusses zum Sessionbeginn (AP-30). Mandantengebunden.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../types';

export interface ReportRows {
  readonly nights: {
    projectId: string;
    lineId: string;
    night: string;
    acquired: number;
    rejected: number;
    integrationS: number;
  }[];
  readonly sessions: {
    sessionId: string;
    projectId: string;
    lineId: string;
    night: string;
    rigName: string;
    status: string;
    frames: number;
    rejected: number;
    weatherRatingIndex: number | null;
  }[];
}

const key = (v: unknown) => String(v).slice(0, 10);

export async function projectReportRows(
  db: Kysely<Database>,
  tenantId: string,
  projectIds: readonly string[],
  from: string | null,
  to: string | null,
  /** `sessions: false` (Himmel, AP-69): nur die Aufnahmenächte, ohne Sessions und Wetter. */
  options: { readonly sessions?: boolean } = {},
): Promise<ReportRows> {
  if (projectIds.length === 0) return { nights: [], sessions: [] };
  let nq = db
    .selectFrom('captureNight')
    .select([
      'projectId',
      'exposureLineId',
      'night',
      'acquiredCount',
      'rejectedCount',
      'integrationS',
    ])
    .where('tenantId', '=', tenantId)
    .where('projectId', 'in', [...projectIds]);
  if (to) nq = nq.where('night', '<=', to);
  let sq = db
    .selectFrom('capture as c')
    .innerJoin('session as s', (j) =>
      j.onRef('s.id', '=', 'c.sessionId').onRef('s.tenantId', '=', 'c.tenantId'),
    )
    .innerJoin('rig as r', (j) =>
      j.onRef('r.id', '=', 's.rigId').onRef('r.tenantId', '=', 's.tenantId'),
    )
    .select([
      's.id as sessionId',
      'c.projectId',
      'c.exposureLineId',
      's.night',
      'r.name as rigName',
      's.status',
      sql<number>`count(*)`.as('frames'),
      sql<number>`sum(CASE WHEN c.rejected THEN 1 ELSE 0 END)`.as('rejected'),
    ])
    .where('c.tenantId', '=', tenantId)
    .where('c.projectId', 'in', [...projectIds])
    .where('c.frameType', '=', 'light')
    .where('c.result', '=', 'saved')
    .where('c.assignment', '=', 'assigned')
    .where('c.isBonus', '=', false)
    .groupBy(['s.id', 'c.projectId', 'c.exposureLineId', 's.night', 'r.name', 's.status']);
  if (from) sq = sq.where('s.night', '>=', from);
  if (to) sq = sq.where('s.night', '<=', to);
  const [nights, sessions] = await Promise.all([
    nq.execute(),
    options.sessions === false ? Promise.resolve([]) : sq.execute(),
  ]);
  // Wetter-Schnappschuss je Session getrennt (kein GROUP BY über jsonb, DSQL).
  const sessionIds = [...new Set(sessions.map((x) => x.sessionId))];
  const snapshots =
    sessionIds.length === 0
      ? []
      : await db
          .selectFrom('session')
          .select(['id', 'forecastSnapshot'])
          .where('tenantId', '=', tenantId)
          .where('id', 'in', sessionIds)
          .execute();
  const snapshotOf = new Map(snapshots.map((x) => [x.id, x.forecastSnapshot]));
  const rating = (snap: unknown) => {
    const v = (typeof snap === 'string' ? JSON.parse(snap) : snap) as {
      ratingIndex?: unknown;
    } | null;
    return typeof v?.ratingIndex === 'number' ? v.ratingIndex : null;
  };
  return {
    nights: nights.map((n) => ({
      projectId: n.projectId,
      lineId: n.exposureLineId,
      night: key(n.night),
      acquired: Number(n.acquiredCount),
      rejected: Number(n.rejectedCount),
      integrationS: Number(n.integrationS),
    })),
    sessions: sessions.map((s) => ({
      sessionId: s.sessionId,
      projectId: s.projectId as string,
      lineId: s.exposureLineId as string,
      night: key(s.night),
      rigName: s.rigName,
      status: s.status,
      frames: Number(s.frames),
      rejected: Number(s.rejected),
      weatherRatingIndex: rating(snapshotOf.get(s.sessionId)),
    })),
  };
}
