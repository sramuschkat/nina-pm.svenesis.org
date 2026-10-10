/**
 * Kennzahlen je Nacht für die Standort-Statistik (AP-77): Anteil guter Lights (innerhalb der Grenzen des Rigs, Bezug des
 * Projekts wie in der Bildbewertung), Bewölkung und SQM als Median der Lights; ohne Lights aus dem Wettergerät (Telemetrie
 * `weather`) über die astronomische Dunkelheit. Rein bis auf die Eingaben.
 */
import { imageGrade, type GradeRef, type ImageQualitySettings } from '@nina-pm/shared';
import { gradeCapture, gradeInputOf } from './project-images';

export interface NightGradeRow {
  readonly night: string;
  readonly rigId: string;
  readonly projectId: string;
  readonly filter: string;
  readonly rejected: boolean;
  readonly metrics: Readonly<Record<string, unknown>>;
}

export interface NightMeasure {
  /** Anteil guter Lights in % (gut = in Ordnung bzw. bestätigt; verworfen und auffällig zählen als schlecht). */
  readonly qualityPct: number | null;
  readonly cloudPct: number | null;
  readonly sqm: number | null;
}

const finite = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1
    ? (s[mid] as number)
    : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

/** Je Nacht aus den Lights: Qualität, Median der Bewölkung und des SQM (Wettergerät zum Zeitpunkt der Aufnahme). */
export function nightMeasures(
  rows: readonly NightGradeRow[],
  refs: Map<string, Map<string, GradeRef>>,
  settingsOf: (rigId: string) => ImageQualitySettings,
): Map<string, NightMeasure> {
  const byNight = new Map<string, NightGradeRow[]>();
  for (const r of rows) byNight.set(r.night, [...(byNight.get(r.night) ?? []), r]);
  const out = new Map<string, NightMeasure>();
  for (const [night, list] of byNight) {
    let good = 0;
    let graded = 0;
    const clouds: number[] = [];
    const sqms: number[] = [];
    for (const r of list) {
      const m = r.metrics as Record<string, unknown>;
      const flags = gradeCapture(refs, r.projectId, r.filter, m, settingsOf(r.rigId));
      const grade = imageGrade(gradeInputOf(m), flags, {
        rejected: r.rejected,
        kept: m.qualityKept === true,
      });
      if (grade !== 'none') {
        graded += 1;
        if (grade === 'ok' || grade === 'kept') good += 1;
      }
      const cloud = finite(m.cloudCoverPct);
      if (cloud !== null) clouds.push(cloud);
      const sqm = finite(m.skyQualityMag);
      if (sqm !== null && sqm > 0) sqms.push(sqm);
    }
    const c = median(clouds);
    const q = median(sqms);
    out.set(night, {
      qualityPct: graded === 0 ? null : round1((good / graded) * 100),
      cloudPct: c === null ? null : round1(c),
      sqm: q === null ? null : round2(q),
    });
  }
  return out;
}

/** Je Nacht aus dem Wettergerät: Mittel der Bewölkung und Median des SQM über die Messpunkte im Dunkel-Fenster. */
export function deviceMeasures(
  samples: readonly { readonly atUtc: Date; readonly metrics: Readonly<Record<string, unknown>> }[],
  windows: ReadonlyMap<string, { readonly fromMs: number; readonly toMs: number }>,
): Map<string, { cloudPct: number | null; sqm: number | null }> {
  const out = new Map<string, { cloudPct: number | null; sqm: number | null }>();
  for (const [night, w] of windows) {
    const inside = samples.filter(
      (s) => s.atUtc.getTime() >= w.fromMs && s.atUtc.getTime() < w.toMs,
    );
    const clouds = inside.flatMap((s) => {
      const v = finite(s.metrics.cloudCoverPct);
      return v === null ? [] : [v];
    });
    const sqms = inside.flatMap((s) => {
      const v = finite(s.metrics.skyQualityMag);
      return v === null || v <= 0 ? [] : [v];
    });
    if (clouds.length === 0 && sqms.length === 0) continue;
    const q = median(sqms);
    out.set(night, {
      cloudPct:
        clouds.length === 0 ? null : round1(clouds.reduce((a, b) => a + b, 0) / clouds.length),
      sqm: q === null ? null : round2(q),
    });
  }
  return out;
}
