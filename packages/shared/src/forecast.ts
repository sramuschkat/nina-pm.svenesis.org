/**
 * Folgeplanung und Prognose (AP-33; FA-FOL-01…05, FA-FOL-07; FK 8.5). Rein: Eingabe sind die gespeicherten
 * Nächte der Mehrnacht-Prognose (Frames je Zeile, belegte Stunden je Projekt – ungewichtet), die
 * Nachtwetter der Vorhersage (7 Nächte) und die Klarnacht-Quote des Standorts. Die Funktion rechnet keine
 * Wetterwerte selbst, sie gewichtet nur (FK 8.5).
 *
 * - **Restbedarf** je Filter: verbleibende Frames (Geplant − Akzeptiert) und Stunden inkl. Overhead.
 * - **Spanne**: optimistisch (ohne Wetter) bzw. realistisch (Frames × Gewicht der Nacht); reicht der Horizont
 *   nicht, wird mit dem Mittel je Nacht fortgeschrieben (`extrapolated`).
 * - **Kandidatennächte** (7): erwartete Frames laut Simulation, Nutzen = Frames × Gewicht, Ampel.
 * - **Saisonwarnung** aus dem Aufwand-Kennzeichen (Saison) bzw. einer realistischen Fertigstellung nach dem
 *   Saisonende; **Handlungsvorschläge** dazu.
 */
import { daysFromKey, keyFromDays } from '@nina-pm/engine';
import type { z } from 'zod';
import type { ForecastView as ForecastViewSchema } from './contracts/forecast';
import type { ProjectView } from './contracts/projects';
import { weatherWeight } from './multi-sim';
import { tonightLines } from './tonight';

type Project = z.infer<typeof ProjectView>;
type View = z.infer<typeof ForecastViewSchema>;
type NightWeather = NonNullable<View['nights'][number]['weather']>;
type Estimate = View['projects'][number]['optimistic'];

export const FORECAST_NIGHTS = 14;
export const CANDIDATE_NIGHTS = 7;
/** Unter so vielen erfassten Nächten gilt die Startquote statt der Statistik (FK 8.5). */
export const MIN_QUOTA_NIGHTS = 10;
export const DEFAULT_CLEAR_QUOTA = 0.5;

export interface StoredForecastNight {
  readonly night: string;
  readonly darkHours: number | null;
  readonly lineFrames: Readonly<Record<string, number>>;
  readonly projectHours: Readonly<Record<string, number>>;
}

export interface ForecastInput {
  readonly rig: { readonly id: string; readonly name: string };
  readonly siteTimeZone: string;
  readonly computedAt: string | null;
  /** Aktuelle Nacht des Standorts (NT-01): Bezug für „nur für die kommende Nacht“ (FA-FOL-05). */
  readonly currentNight: string;
  /** Projekte des Rigs (freigegeben); aktive werden prognostiziert, unfertige/pausierte zur Wiederaufnahme. */
  readonly projects: readonly Project[];
  readonly stored: readonly StoredForecastNight[];
  /** Nachtwetter innerhalb des Vorhersagehorizonts. */
  readonly weather: ReadonlyMap<string, NightWeather>;
  /** Klarnacht-Statistik des Standorts: nutzbare / erfasste Nächte. */
  readonly clearNights: { readonly usable: number; readonly recorded: number };
  /** Overhead je Belichtung in Sekunden (Rig-Einstellungen, allocation.md §2). */
  readonly overheadS: (exposureS: number) => number;
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;
const EPS = 1e-9;

/** Aktive Zeilen mit Restbedarf (Geplant − Akzeptiert). */
function needLines(p: Project) {
  return p.panels
    .filter((panel) => panel.enabled)
    .flatMap((panel) => panel.lines)
    .filter((l) => l.enabled)
    .map((l) => ({
      id: l.id,
      filter: l.filterShortName,
      exposureS: l.exposureS,
      need: Math.max(0, l.counters.remaining),
    }));
}

/** Nächte bis zur Fertigstellung aus Frames je Nacht (kumuliert je Zeile). */
function estimate(
  lines: readonly { id: string; need: number }[],
  nights: readonly { night: string; frames: Record<string, number> }[],
): Estimate {
  const total = lines.reduce((s, l) => s + l.need, 0);
  if (total === 0) return { nights: 0, completesNight: null, extrapolated: false };
  const cum = new Map(lines.map((l) => [l.id, 0]));
  let used = 0;
  let sum = 0;
  for (const n of nights) {
    let got = 0;
    for (const l of lines) {
      const f = n.frames[l.id] ?? 0;
      if (f <= 0) continue;
      cum.set(l.id, (cum.get(l.id) ?? 0) + f);
      got += f;
    }
    if (got > EPS) {
      used += 1;
      sum += got;
    }
    if (lines.every((l) => (cum.get(l.id) ?? 0) + EPS >= l.need))
      return { nights: used, completesNight: n.night, extrapolated: false };
  }
  const last = nights.at(-1);
  if (used === 0 || !last) return { nights: null, completesNight: null, extrapolated: false };
  // Fortschreibung: Rest ÷ Mittel je genutzter Nacht, verteilt auf die Kalendernächte wie im Horizont.
  const rest = lines.reduce((s, l) => s + Math.max(0, l.need - (cum.get(l.id) ?? 0)), 0);
  const perNight = sum / used;
  const moreUsed = Math.ceil(rest / perNight);
  const moreCalendar = Math.ceil(moreUsed / (used / nights.length));
  return {
    nights: used + moreUsed,
    completesNight: keyFromDays(daysFromKey(last.night) + moreCalendar),
    extrapolated: true,
  };
}

export function forecastView(input: ForecastInput): View {
  const recorded = input.clearNights.recorded;
  const quota =
    recorded >= MIN_QUOTA_NIGHTS
      ? {
          rate: round2(input.clearNights.usable / recorded),
          source: 'stats' as const,
          recordedNights: recorded,
        }
      : { rate: DEFAULT_CLEAR_QUOTA, source: 'default' as const, recordedNights: recorded };
  const nights = input.stored.slice(0, FORECAST_NIGHTS).map((n, i) => {
    const w = i < CANDIDATE_NIGHTS ? (input.weather.get(n.night) ?? null) : null;
    const fromForecast = w !== null && w.nightMean !== null;
    return {
      night: n.night,
      darkHours: n.darkHours,
      weight: fromForecast ? weatherWeight(w.nightMean) : quota.rate,
      weightSource: fromForecast ? ('forecast' as const) : ('quota' as const),
      weather: w,
    };
  });
  const weightOf = new Map(nights.map((n) => [n.night, n]));

  const active = input.projects.filter(
    (p) => p.approvalStatus === 'approved' && p.status === 'active',
  );
  const projects = active.map((p) => {
    const lines = needLines(p);
    const byFilter = new Map<string, { frames: number; hours: number }>();
    for (const l of lines) {
      const f = byFilter.get(l.filter) ?? { frames: 0, hours: 0 };
      f.frames += l.need;
      f.hours += (l.need * (l.exposureS + input.overheadS(l.exposureS))) / 3600;
      byFilter.set(l.filter, f);
    }
    const need = [...byFilter.entries()].map(([filter, f]) => ({
      filter,
      frames: f.frames,
      hours: round2(f.hours),
    }));
    const needFrames = lines.reduce((s, l) => s + l.need, 0);
    const lineIds = new Set(lines.map((l) => l.id));
    const filterOf = new Map(lines.map((l) => [l.id, l.filter]));
    const raw = input.stored.map((n) => ({
      night: n.night,
      frames: Object.fromEntries(Object.entries(n.lineFrames).filter(([id]) => lineIds.has(id))),
    }));
    const weighted = raw.map((n) => {
      const w = weightOf.get(n.night)?.weight ?? quota.rate;
      return {
        night: n.night,
        frames: Object.fromEntries(Object.entries(n.frames).map(([id, f]) => [id, f * w])),
      };
    });
    const optimistic = estimate(lines, raw);
    const realistic = estimate(lines, weighted);
    const candidates = input.stored.slice(0, CANDIDATE_NIGHTS).map((n) => {
      const info = weightOf.get(n.night);
      const weight = info?.weight ?? quota.rate;
      const perFilter = new Map<string, number>();
      let frames = 0;
      for (const [id, f] of Object.entries(n.lineFrames)) {
        if (!lineIds.has(id)) continue;
        frames += f;
        const filter = filterOf.get(id) ?? '';
        perFilter.set(filter, (perFilter.get(filter) ?? 0) + f);
      }
      const flagged = info?.weather
        ? info.weather.aerosolMissing || info.weather.incomplete
        : false;
      const light: 'green' | 'yellow' | 'red' =
        frames <= 0 || weight <= 0.1 + EPS
          ? 'red'
          : weight >= 1 - EPS && !flagged
            ? 'green'
            : 'yellow';
      return {
        night: n.night,
        frames,
        hours: round2(n.projectHours[p.id] ?? 0),
        benefit: round1(frames * weight),
        light,
        filters: [...perFilter.entries()].map(([filter, f]) => ({ filter, frames: f })),
      };
    });
    const effort = p.effort;
    const seasonEnd = effort?.toNight ?? null;
    const beyondSeason =
      seasonEnd !== null &&
      realistic.completesNight !== null &&
      realistic.completesNight > seasonEnd;
    const notAchievable =
      effort?.achievablePct !== null &&
      effort?.achievablePct !== undefined &&
      effort.achievablePct < 100;
    const seasonWarning =
      needFrames > 0 && (notAchievable || beyondSeason)
        ? { achievablePct: effort?.achievablePct ?? null, seasonEnd }
        : null;
    const noTime = needFrames > 0 && optimistic.nights === null;
    const suggestions: View['projects'][number]['suggestions'] = [];
    if (seasonWarning || noTime) {
      if (p.priority > 1) suggestions.push({ kind: 'raise_priority', oneClick: true });
      if (noTime) suggestions.push({ kind: 'pause', oneClick: true });
      suggestions.push({ kind: 'reduce_frames', oneClick: false });
      suggestions.push({ kind: 'other_rig', oneClick: false });
      suggestions.push({ kind: 'next_year', oneClick: false });
    }
    return {
      projectId: p.id,
      name: p.name,
      createdBy: p.createdBy,
      priority: p.priority,
      status: p.status,
      need,
      needFrames,
      needHours: round2(need.reduce((s, n) => s + n.hours, 0)),
      optimistic,
      realistic,
      candidates,
      seasonWarning,
      suggestions,
      lines: tonightLines(
        p,
        input.currentNight,
        input.stored.find((n) => n.night === input.currentNight)?.lineFrames,
      ),
    };
  });

  const resume = input.projects
    .filter(
      (p) =>
        p.approvalStatus === 'approved' && (p.status === 'unfinished' || p.status === 'on_hold'),
    )
    .map((p) => ({
      projectId: p.id,
      name: p.name,
      createdBy: p.createdBy,
      status: p.status ?? '',
      needFrames: needLines(p).reduce((s, l) => s + l.need, 0),
      target: p.raDeg !== null && p.decDeg !== null ? { raDeg: p.raDeg, decDeg: p.decDeg } : null,
      conditions: {
        minAltitudeDeg: p.conditions.minAltitudeDeg,
        minTimeOnTargetH: p.conditions.minTimeOnTargetH,
        twilight: p.conditions.twilight,
      },
    }))
    .filter((r) => r.needFrames > 0);

  return {
    rigId: input.rig.id,
    rigName: input.rig.name,
    siteTimeZone: input.siteTimeZone,
    computedAt: input.computedAt,
    currentNight: input.currentNight,
    nights,
    clearQuota: quota,
    projects: projects.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name)),
    resume,
  };
}
