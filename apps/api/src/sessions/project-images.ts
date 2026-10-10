/**
 * Bildbewertung (AP-72b, FA-AUS-25; seit AP-77 nur noch als Anteil): Reiter „Qualität“ des Projekts mit Dateiliste,
 * Bewertung je Aufnahme im Session-Detail. Bezug je Projekt und Filter = Median der nicht verworfenen Lights des
 * Projekts; Grenzwerte vom Rig (`ImageQualitySettings`).
 */
import type { ProjectImageRow } from '@nina-pm/db';
import {
  GRADE_MIN_REF,
  gradeFlags,
  gradeRefs,
  imageGrade,
  qualityStats,
  type GradeFlag,
  type GradeRef,
  type ImageGrade,
  type ImageQualitySettings,
  type ProjectQualityView,
} from '@nina-pm/shared';

const num = (m: Record<string, unknown>, key: string): number | null => {
  const v = m[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};
const positive = (m: Record<string, unknown>, key: string) => {
  const v = num(m, key);
  return v !== null && v > 0 ? v : null;
};

/** Messwerte der Bewertung aus `capture.metrics`. */
export function gradeInputOf(m: Record<string, unknown>) {
  return {
    hfr: positive(m, 'hfr'),
    stars: positive(m, 'stars'),
    rmsArcsec: num(m, 'guidingRmsArcsec'),
    cloudCoverPct: num(m, 'cloudCoverPct'),
  };
}

/** Ein bewertetes Light des Projekts (Qualität, Dateiliste). */
export interface GradedLight {
  readonly row: ProjectImageRow;
  readonly grade: ImageGrade;
  readonly flags: readonly GradeFlag[];
  readonly hfr: number | null;
  readonly stars: number | null;
  readonly rmsArcsec: number | null;
}

/** Lights des Projekts mit Bewertung: Bezug je Filter aus den nicht verworfenen Lights des Projekts. */
export function gradeProjectLights(
  rows: readonly ProjectImageRow[],
  settings: ImageQualitySettings,
): GradedLight[] {
  const graded = rows.map((r) => ({ r, g: gradeInputOf(r.metrics) }));
  const refs = gradeRefs(
    graded.map(({ r, g }) => ({
      filter: r.filter,
      hfr: g.hfr,
      stars: g.stars,
      rejected: r.rejected,
    })),
  );
  return graded.map(({ r, g }) => {
    const flags = gradeFlags(g, refs.get(r.filter) ?? null, settings);
    return {
      row: r,
      grade: imageGrade(g, flags, { rejected: r.rejected, kept: r.metrics.qualityKept === true }),
      flags,
      hfr: g.hfr,
      stars: g.stars,
      rmsArcsec: g.rmsArcsec,
    };
  });
}

const statsOf = (lights: readonly GradedLight[]) => qualityStats(lights);

/** Gruppen in der Reihenfolge ihres ersten Auftretens. */
function groupBy<T>(list: readonly T[], key: (x: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const x of list) out.set(key(x), [...(out.get(key(x)) ?? []), x]);
  return out;
}

/**
 * Reiter „Qualität“ des Projekts (AP-77, S-31): Anteile je Nacht und Filter, Summen je Nacht, je Filter, je Session und
 * gesamt. Filter in der Reihenfolge ihres ersten Lights (älteste Nacht zuerst), Nächte neueste zuerst.
 */
export function projectQualityView(input: {
  projectId: string;
  rigId: string | null;
  settings: ImageQualitySettings;
  rows: readonly ProjectImageRow[];
  truncated: boolean;
}): ProjectQualityView {
  const lights = gradeProjectLights(input.rows, input.settings);
  const oldestFirst = [...lights].sort((a, b) => a.row.capturedAt.localeCompare(b.row.capturedAt));
  const filterOrder = [...groupBy(oldestFirst, (l) => l.row.filter).keys()];
  const byFilter = (list: readonly GradedLight[]) => {
    const groups = groupBy(list, (l) => l.row.filter);
    return filterOrder.flatMap((filter) => {
      const g = groups.get(filter);
      return g ? [{ filter, ...statsOf(g) }] : [];
    });
  };
  const nights = [...groupBy(lights, (l) => l.row.night).entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([night, list]) => ({
      night,
      sessionIds: [...new Set(list.map((l) => l.row.sessionId))],
      filters: byFilter(list),
      total: statsOf(list),
    }));
  const sessions = [...groupBy(lights, (l) => l.row.sessionId).entries()].map(
    ([sessionId, list]) => ({ sessionId, ...statsOf(list) }),
  );
  return {
    projectId: input.projectId,
    rigId: input.rigId,
    settings: input.settings,
    minRef: GRADE_MIN_REF,
    filters: byFilter(lights),
    nights,
    sessions,
    total: statsOf(lights),
    truncated: input.truncated,
  };
}

const csvCell = (v: string | number | boolean | null) => {
  const text = v === null ? '' : String(v);
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * Dateiliste zum Stacken (AP-77): je Light Nacht, Zeit, Filter, Belichtung, Qualität mit Gründen, Messwerte, relativer
 * Pfad (zum NINA-Bildordner) und Dateiname; `good` = nur gute Lights. Semikolon, UTF-8 mit BOM (Excel).
 */
export function qualityFilesCsv(lights: readonly GradedLight[], good: boolean): string {
  const head = [
    'night',
    'capturedAtUtc',
    'filter',
    'exposureS',
    'quality',
    'reasons',
    'hfr',
    'stars',
    'guidingRmsArcsec',
    'relativePath',
    'fileName',
  ];
  const isGood = (l: GradedLight) => l.grade === 'ok' || l.grade === 'kept';
  const rows = [...lights]
    .filter((l) => !good || isGood(l))
    .sort((a, b) => a.row.capturedAt.localeCompare(b.row.capturedAt))
    .map((l) =>
      [
        l.row.night,
        l.row.capturedAt,
        l.row.filter,
        l.row.exposureS,
        isGood(l) ? 'good' : l.grade,
        l.flags.map((f) => f.metric).join(','),
        l.hfr,
        l.stars,
        l.rmsArcsec,
        typeof l.row.metrics.relativePath === 'string' ? l.row.metrics.relativePath : null,
        l.row.fileName,
      ]
        .map(csvCell)
        .join(';'),
    );
  return `\uFEFF${[head.join(';'), ...rows].join('\r\n')}\r\n`;
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
