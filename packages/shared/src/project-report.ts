/**
 * Projektbericht (AP-34; FA-AUS-18, FA-AUS-10, FA-AUS-11, FA-AUS-13). Rein: Eingabe sind die Projektsichten
 * (Zähler je Zeile), die Aufnahmenächte je Zeile (`capture_night`, alle Nächte bis zum Ende des Zeitraums –
 * für den kumulierten Verlauf) und die Aufnahmen je Session und Zeile im Zeitraum.
 */
import type { z } from 'zod';
import type { ProjectView } from './contracts/projects';
import type { ProjectReport, ReportProject } from './contracts/reports';

type Project = z.infer<typeof ProjectView>;

export interface ReportNightRow {
  readonly projectId: string;
  readonly lineId: string;
  readonly night: string;
  readonly acquired: number;
  readonly rejected: number;
  readonly integrationS: number;
}

export interface ReportSessionRow {
  readonly sessionId: string;
  readonly projectId: string;
  readonly lineId: string;
  readonly night: string;
  readonly rigName: string;
  readonly status: string;
  readonly frames: number;
  readonly rejected: number;
  readonly weatherRatingIndex: number | null;
}

/** Abstand in Prozentpunkten, ab dem ein Filter als „zurück“ gilt (FA-AUS-13). */
export const CHANNEL_BALANCE_GAP = 30;

const round1 = (v: number) => Math.round(v * 10) / 10;
const inRange = (night: string, from: string | null, to: string | null) =>
  (from === null || night >= from) && (to === null || night <= to);

/** Kanalbalance: Filter mit Soll, deren Fortschritt ≥ 30 Punkte hinter dem besten liegt. */
export function channelBalance(filters: readonly ReportProject['filters'][number][]) {
  const planned = filters.filter((f) => f.planned > 0);
  if (planned.length < 2) return null;
  const best = Math.max(...planned.map((f) => f.percentDone));
  const behind = planned.filter((f) => f.percentDone <= best - CHANNEL_BALANCE_GAP);
  if (behind.length === 0) return null;
  const ahead = planned.filter((f) => f.percentDone > best - CHANNEL_BALANCE_GAP);
  const pick = (xs: typeof planned) =>
    xs.map((f) => ({ filter: f.filter, percentDone: f.percentDone }));
  return { behind: pick(behind), ahead: pick(ahead) };
}

export function projectReport(input: {
  readonly from: string | null;
  readonly to: string | null;
  readonly generatedAt: string;
  readonly projects: readonly Project[];
  readonly rigNames: ReadonlyMap<string, string>;
  readonly nights: readonly ReportNightRow[];
  readonly sessions: readonly ReportSessionRow[];
}): ProjectReport {
  const projects = input.projects.map((p): ReportProject => {
    const lines = p.panels.flatMap((panel) => panel.lines);
    const filterOf = new Map(lines.map((l) => [l.id, l.filterShortName]));
    const order = [...new Set(lines.map((l) => l.filterShortName))];
    const filters = order.map((filter) => {
      const own = lines.filter((l) => l.filterShortName === filter && l.enabled);
      const planned = own.reduce((s, l) => s + l.counters.planned, 0);
      const accepted = own.reduce((s, l) => s + l.counters.accepted, 0);
      return {
        filter,
        planned,
        accepted,
        remaining: own.reduce((s, l) => s + Math.max(0, l.counters.remaining), 0),
        integrationS: lines
          .filter((l) => l.filterShortName === filter)
          .reduce((s, l) => s + l.counters.integrationS, 0),
        percentDone: planned > 0 ? Math.min(100, round1((accepted / planned) * 100)) : 0,
      };
    });
    // Verlauf je Nacht und Filter; kumuliert über alle Nächte bis zum Ende des Zeitraums.
    const rows = input.nights
      .filter((n) => n.projectId === p.id)
      .sort((a, b) => (a.night < b.night ? -1 : a.night > b.night ? 1 : 0));
    const cumulative = new Map<string, number>();
    const byNight = new Map<
      string,
      Map<string, ReportProject['nights'][number]['filters'][number]>
    >();
    for (const r of rows) {
      const filter = filterOf.get(r.lineId) ?? '?';
      const accepted = Math.max(0, r.acquired - r.rejected);
      cumulative.set(filter, (cumulative.get(filter) ?? 0) + r.integrationS);
      if (!inRange(r.night, input.from, input.to)) continue;
      const night = byNight.get(r.night) ?? new Map();
      const f = night.get(filter) ?? {
        filter,
        acquired: 0,
        rejected: 0,
        accepted: 0,
        integrationS: 0,
        cumulativeS: 0,
      };
      f.acquired += r.acquired;
      f.rejected += r.rejected;
      f.accepted += accepted;
      f.integrationS += r.integrationS;
      f.cumulativeS = cumulative.get(filter) ?? 0;
      night.set(filter, f);
      byNight.set(r.night, night);
    }
    const nights = [...byNight.entries()].map(([night, fs]) => ({
      night,
      filters: [...fs.values()].map((f) => ({
        ...f,
        integrationS: round1(f.integrationS),
        cumulativeS: round1(f.cumulativeS),
      })),
    }));
    // Sessions des Projekts im Zeitraum (FA-AUS-11).
    const bySession = new Map<string, ReportSessionRow[]>();
    for (const s of input.sessions)
      if (s.projectId === p.id)
        bySession.set(s.sessionId, [...(bySession.get(s.sessionId) ?? []), s]);
    const sessions = [...bySession.values()]
      .map((list) => {
        const head = list[0] as ReportSessionRow;
        const perFilter = new Map<string, number>();
        for (const x of list) {
          const filter = filterOf.get(x.lineId) ?? '?';
          perFilter.set(filter, (perFilter.get(filter) ?? 0) + x.frames);
        }
        const frames = list.reduce((s, x) => s + x.frames, 0);
        const rejected = list.reduce((s, x) => s + x.rejected, 0);
        return {
          sessionId: head.sessionId,
          night: head.night,
          rigName: head.rigName,
          status: head.status,
          filters: [...perFilter.entries()].map(([filter, n]) => ({ filter, frames: n })),
          frames,
          rejectedPct: frames > 0 ? round1((rejected / frames) * 100) : null,
          weatherRatingIndex: head.weatherRatingIndex,
        };
      })
      .sort((a, b) => (a.night < b.night ? 1 : a.night > b.night ? -1 : 0));
    const planned = filters.reduce((s, f) => s + f.planned, 0);
    const accepted = filters.reduce((s, f) => s + Math.min(f.accepted, f.planned), 0);
    return {
      projectId: p.id,
      name: p.name,
      createdBy: p.createdBy,
      projectType: p.projectType,
      targetName: p.targetName,
      rigId: p.rigId,
      rigName: p.rigId ? (input.rigNames.get(p.rigId) ?? null) : null,
      approvalStatus: p.approvalStatus,
      status: p.status,
      percentDone: planned > 0 ? Math.min(100, round1((accepted / planned) * 100)) : 0,
      filters,
      periodAccepted: nights.reduce((s, n) => s + n.filters.reduce((t, f) => t + f.accepted, 0), 0),
      periodIntegrationS: round1(
        nights.reduce((s, n) => s + n.filters.reduce((t, f) => t + f.integrationS, 0), 0),
      ),
      nights,
      sessions,
      conditions: {
        minAltitudeDeg: p.conditions.minAltitudeDeg,
        minTimeOnTargetH: p.conditions.minTimeOnTargetH,
        twilight: p.conditions.twilight,
        moonAvoidanceEnabled: p.conditions.moonAvoidanceEnabled,
        moonSeparationDeg: p.conditions.moonSeparationDeg,
      },
      channelBalance: channelBalance(filters),
    };
  });
  return {
    from: input.from,
    to: input.to,
    generatedAt: input.generatedAt,
    totals: {
      projects: projects.length,
      periodAccepted: projects.reduce((s, p) => s + p.periodAccepted, 0),
      periodIntegrationS: round1(projects.reduce((s, p) => s + p.periodIntegrationS, 0)),
    },
    projects,
  };
}
