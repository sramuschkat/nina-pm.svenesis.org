/**
 * Bildbewertung (AP-72b, FA-AUS-25): Ansicht „Bilder“ des Projekts, Bewertung je Aufnahme im Session-Detail und
 * automatisches Verwerfen beim Eingang. Bezug je Projekt und Filter = Median der nicht verworfenen Lights des Projekts;
 * Grenzwerte vom Rig (`ImageQualitySettings`).
 */
import type { ProjectImageRow } from '@nina-pm/db';
import {
  GRADE_MIN_REF,
  gradeFlags,
  gradeRefs,
  imageGrade,
  medianOf,
  type GradeFlag,
  type GradeRef,
  type ImageQualitySettings,
  type ProjectImage,
  type ProjectImagesView,
} from '@nina-pm/shared';

const num = (m: Record<string, unknown>, key: string): number | null => {
  const v = m[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};
const positive = (m: Record<string, unknown>, key: string) => {
  const v = num(m, key);
  return v !== null && v > 0 ? v : null;
};
const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

/** Messwerte der Bewertung aus `capture.metrics`. */
export function gradeInputOf(m: Record<string, unknown>) {
  return {
    hfr: positive(m, 'hfr'),
    stars: positive(m, 'stars'),
    rmsArcsec: num(m, 'guidingRmsArcsec'),
    cloudCoverPct: num(m, 'cloudCoverPct'),
  };
}

export function projectImagesView(input: {
  projectId: string;
  rigId: string | null;
  settings: ImageQualitySettings;
  scaleArcsecPx: number | null;
  rows: readonly ProjectImageRow[];
  truncated: boolean;
  canCorrect: boolean;
}): ProjectImagesView {
  const { settings, scaleArcsecPx: scale } = input;
  const graded = input.rows.map((r) => ({ r, g: gradeInputOf(r.metrics) }));
  const refs = gradeRefs(
    graded.map(({ r, g }) => ({
      filter: r.filter,
      hfr: g.hfr,
      stars: g.stars,
      rejected: r.rejected,
    })),
  );
  const rmsByFilter = new Map<string, number[]>();
  for (const { r, g } of graded)
    if (!r.rejected && g.rmsArcsec !== null)
      rmsByFilter.set(r.filter, [...(rmsByFilter.get(r.filter) ?? []), g.rmsArcsec]);
  const items: ProjectImage[] = graded.map(({ r, g }) => {
    const flags = gradeFlags(g, refs.get(r.filter) ?? null, settings);
    const kept = r.metrics.qualityKept === true;
    const m = r.metrics;
    return {
      id: r.id,
      sessionId: r.sessionId,
      night: r.night,
      capturedAt: r.capturedAt,
      filter: r.filter,
      exposureS: r.exposureS,
      gain: r.gain,
      offset: r.offset,
      binning: r.binning,
      isBonus: r.isBonus,
      rejected: r.rejected,
      rejectReason: r.rejectReason as ProjectImage['rejectReason'],
      kept,
      grade: imageGrade(g, flags, { rejected: r.rejected, kept }),
      flags,
      fileName: r.fileName,
      relativePath: typeof m.relativePath === 'string' ? m.relativePath : null,
      hfr: g.hfr,
      hfrArcsec: g.hfr !== null && scale ? round(g.hfr * scale * (r.binning ?? 1), 3) : null,
      stars: g.stars,
      rmsArcsec: g.rmsArcsec,
      rmsRaArcsec: num(m, 'rmsRaArcsec'),
      rmsDecArcsec: num(m, 'rmsDecArcsec'),
      cloudCoverPct: g.cloudCoverPct,
      skyQualityMag: num(m, 'skyQualityMag'),
      altitudeDeg: num(m, 'altitudeDeg'),
      airmass: num(m, 'airmass'),
      focusPosition: num(m, 'focusPosition'),
      focuserTemperatureC: num(m, 'focuserTemperatureC'),
      medianAdu: num(m, 'medianAdu'),
      saturatedPct: num(m, 'saturatedPct'),
      sensorTempC: num(m, 'sensorTempC'),
      setPointC: num(m, 'setPointC'),
    };
  });
  return {
    projectId: input.projectId,
    rigId: input.rigId,
    settings,
    scaleArcsecPx: scale,
    minRef: GRADE_MIN_REF,
    refs: [...refs.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([filter, ref]) => ({
        filter,
        hfr: ref.hfr,
        hfrArcsec: ref.hfr !== null && scale ? round(ref.hfr * scale, 3) : null,
        stars: ref.stars,
        rmsArcsec: medianOf(rmsByFilter.get(filter) ?? []),
        n: ref.n,
      })),
    items,
    truncated: input.truncated,
    canCorrect: input.canCorrect,
  };
}

/** Bezug je Projekt und Filter für mehrere Projekte (Session-Detail, Eingang). */
export function refsByProject(
  basis: readonly {
    projectId: string;
    filter: string;
    hfr: number | null;
    stars: number | null;
    rejected: boolean;
  }[],
): Map<string, Map<string, GradeRef>> {
  const byProject = new Map<string, (typeof basis)[number][]>();
  for (const b of basis) byProject.set(b.projectId, [...(byProject.get(b.projectId) ?? []), b]);
  return new Map([...byProject.entries()].map(([p, list]) => [p, gradeRefs(list)]));
}

/** Bewertung einer Aufnahme mit dem Bezug ihres Projekts. */
export function gradeCapture(
  refs: Map<string, Map<string, GradeRef>>,
  projectId: string,
  filter: string,
  metrics: Record<string, unknown>,
  settings: ImageQualitySettings,
): GradeFlag[] {
  return gradeFlags(gradeInputOf(metrics), refs.get(projectId)?.get(filter) ?? null, settings);
}
