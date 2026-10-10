/**
 * Sessionqualität und Bedingungen im Nacht-Detail (AP-77, S-61). Rein bis auf die Eingaben:
 * - `lineQualities`: je Zeile (Projekt und Filter) Anteile, Gründe, Median/Spanne und Verlauf aus den bewerteten Lights.
 * - `sessionQualityByList`: Zählung je Session für die Liste „Nächte“.
 * - `nightConditions`: Wolken/SQM aus den Lights, sonst aus dem Wettergerät; Temperatur, Feuchte, Taupunkt aus der
 *   Powerbox, sonst aus dem Wettergerät; Wind aus dem Wettergerät; Seeing und Transparenz aus der Vorhersage.
 */
import {
  combineQualityCounts,
  GRADE_MIN_REF,
  imageGrade,
  qualityCounts,
  type QualityCounts,
  medianOf,
  qualityStats,
  sessionGrade,
  type ConditionMetric,
  type GradeRef,
  type ImageQualitySettings,
  type NightCondition,
  type NightLineQuality,
  type NightSessionCapture,
} from '@nina-pm/shared';
import { gradeCapture, gradeInputOf } from './project-images';

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

/** Bewertete Lights (gespeichert, zugeordnet, mit `grade`) je Zeile; Zeilen in der Reihenfolge ihres ersten Lights. */
export function lineQualities(
  captures: readonly NightSessionCapture[],
  refs: Map<string, Map<string, GradeRef>>,
  settings: ImageQualitySettings,
): NightLineQuality[] {
  const groups = new Map<string, NightSessionCapture[]>();
  for (const c of captures) {
    if (!c.grade || !c.projectId) continue;
    const key = `${c.projectId}|${c.exposureLineId ?? c.filterShortName}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const out: NightLineQuality[] = [];
  for (const list of groups.values()) {
    const first = list[0] as NightSessionCapture;
    const projectId = first.projectId as string;
    const sorted = [...list].sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
    const lights = sorted.map((c) => ({
      grade: c.grade ?? 'none',
      flags: c.flags ?? [],
      hfr: c.hfr,
      stars: c.stars,
      rmsArcsec: c.quality?.rmsArcsec ?? null,
    }));
    const ref = refs.get(projectId)?.get(first.filterShortName) ?? null;
    out.push({
      projectId,
      exposureLineId: first.exposureLineId,
      filter: first.filterShortName,
      ...qualityStats(lights),
      hfrLimit:
        ref && ref.n >= GRADE_MIN_REF && ref.hfr !== null && settings.hfrPct !== null
          ? round(ref.hfr * (1 + settings.hfrPct / 100), 3)
          : null,
      rmsLimit: settings.rmsArcsec,
      series: sorted
        .filter((c) => c.grade !== 'rejected')
        .map((c) => ({
          atUtc: c.capturedAt,
          hfr: c.hfr,
          rmsArcsec: c.quality?.rmsArcsec ?? null,
          flagged: c.grade === 'flagged',
        })),
    });
  }
  return out;
}

/** Summe der Session mit Urteil. */
export function sessionQuality(lines: readonly NightLineQuality[]) {
  const counts = combineQualityCounts(lines);
  return { ...counts, grade: sessionGrade(counts.sharePct) };
}

/** Messpunkt der Telemetrie: Rohwert bzw. Stundenwert (Mittel, Minimum, Maximum). */
export interface ConditionSample {
  readonly metrics: Readonly<Record<string, number | { min: number; avg: number; max: number }>>;
}

/** Wetter-Schnappschuss zum Sessionbeginn (Teil von `ForecastSnapshot`). */
export interface ConditionForecast {
  readonly seeingScore: number | null;
  readonly transparencyPct: number | null;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function fromValues(
  metric: ConditionMetric,
  source: NightCondition['source'],
  values: readonly { v: number; min: number; max: number }[],
  digits: number,
): NightCondition | null {
  const m = medianOf(values.map((x) => x.v));
  if (m === null) return null;
  return {
    metric,
    source,
    median: round(m, digits),
    min: round(Math.min(...values.map((x) => x.min)), digits),
    max: round(Math.max(...values.map((x) => x.max)), digits),
  };
}

function fromSamples(
  samples: readonly ConditionSample[],
  key: string,
): { v: number; min: number; max: number }[] {
  return samples.flatMap((s) => {
    const x = s.metrics[key];
    if (finite(x)) return [{ v: x, min: x, max: x }];
    if (x && typeof x === 'object' && finite(x.avg) && finite(x.min) && finite(x.max))
      return [{ v: x.avg, min: x.min, max: x.max }];
    return [];
  });
}

export function nightConditions(input: {
  readonly captures: readonly NightSessionCapture[];
  readonly powerBox: readonly ConditionSample[];
  readonly weather: readonly ConditionSample[];
  readonly forecast: ConditionForecast | null;
}): NightCondition[] {
  const lights = input.captures.filter((c) => c.frameType === 'light' && c.result === 'saved');
  const fromLights = (key: 'cloudCoverPct' | 'skyQualityMag') =>
    lights.flatMap((c) => {
      const v = c.quality?.[key];
      return finite(v) && (key !== 'skyQualityMag' || v > 0) ? [{ v, min: v, max: v }] : [];
    });
  const pick = (
    metric: ConditionMetric,
    digits: number,
    options: readonly [NightCondition['source'], { v: number; min: number; max: number }[]][],
  ) => {
    for (const [source, values] of options) {
      const c = fromValues(metric, source, values, digits);
      if (c) return c;
    }
    return null;
  };
  const f = input.forecast;
  const single = (metric: ConditionMetric, v: number | null): NightCondition | null =>
    v === null ? null : { metric, source: 'forecast', median: v, min: v, max: v };
  return [
    pick('cloudPct', 0, [
      ['captures', fromLights('cloudCoverPct')],
      ['telemetry', fromSamples(input.weather, 'cloudCoverPct')],
    ]),
    pick('sqm', 2, [
      ['captures', fromLights('skyQualityMag')],
      ['telemetry', fromSamples(input.weather, 'skyQualityMag')],
    ]),
    pick('temperatureC', 1, [
      ['telemetry', fromSamples(input.powerBox, 'airC')],
      ['telemetry', fromSamples(input.weather, 'temperatureC')],
    ]),
    pick('humidityPct', 0, [
      ['telemetry', fromSamples(input.powerBox, 'humidityPct')],
      ['telemetry', fromSamples(input.weather, 'humidityPct')],
    ]),
    pick('dewPointC', 1, [
      ['telemetry', fromSamples(input.powerBox, 'dewPointC')],
      ['telemetry', fromSamples(input.weather, 'dewPointC')],
    ]),
    pick('windMs', 1, [['telemetry', fromSamples(input.weather, 'windSpeedMs')]]),
    single('seeingScore', f?.seeingScore ?? null),
    single('transparencyPct', f?.transparencyPct ?? null),
  ].filter((c): c is NightCondition => c !== null);
}

/** Sessionqualität je Session für die Liste „Nächte“ (AP-77): dieselbe Bewertung wie im Detail, nur die Zählung. */
export function sessionQualityByList(
  rows: readonly {
    sessionId: string;
    rigId: string;
    projectId: string;
    filter: string;
    rejected: boolean;
    metrics: Readonly<Record<string, unknown>>;
  }[],
  refs: Map<string, Map<string, GradeRef>>,
  settingsOf: (rigId: string) => ImageQualitySettings,
): Map<string, QualityCounts> {
  const bySession = new Map<string, Parameters<typeof qualityCounts>[0][number][]>();
  for (const r of rows) {
    const m = r.metrics as Record<string, unknown>;
    const input = gradeInputOf(m);
    const flags = gradeCapture(refs, r.projectId, r.filter, m, settingsOf(r.rigId));
    const light = {
      grade: imageGrade(input, flags, { rejected: r.rejected, kept: m.qualityKept === true }),
      flags,
      hfr: input.hfr,
      stars: input.stars,
      rmsArcsec: input.rmsArcsec,
    };
    bySession.set(r.sessionId, [...(bySession.get(r.sessionId) ?? []), light]);
  }
  return new Map([...bySession].map(([id, lights]) => [id, qualityCounts(lights)]));
}
