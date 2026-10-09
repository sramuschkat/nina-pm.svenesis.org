/**
 * Reiter „Bilder“ im Projekt (AP-72b, FA-AUS-25): Auswahl nach Filter, Bewertung und Nacht, Zähler der Chips und die CSV
 * mit Dateinamen und relativen Pfaden. Rein – die Komponente zeigt nur an.
 */
import type { ProjectImage } from '../../api/client';

export type GradeChip = 'all' | 'flagged' | 'rejected' | 'ok';

export interface ImageSelection {
  readonly filter: string | null;
  readonly grade: GradeChip;
  readonly night: string | null;
}

/** `ok` umfasst „ok“ und „behalten“; `none` (ohne Messwert) nur unter „alle“. */
const gradeMatches = (img: ProjectImage, chip: GradeChip) =>
  chip === 'all' ||
  (chip === 'flagged' && img.grade === 'flagged') ||
  (chip === 'rejected' && img.grade === 'rejected') ||
  (chip === 'ok' && (img.grade === 'ok' || img.grade === 'kept'));

export function selectImages(items: readonly ProjectImage[], s: ImageSelection): ProjectImage[] {
  return items.filter(
    (i) =>
      (s.filter === null || i.filter === s.filter) &&
      (s.night === null || i.night === s.night) &&
      gradeMatches(i, s.grade),
  );
}

/** Zähler der Bewertungs-Chips für Filter und Nacht der Auswahl. */
export function gradeCounts(
  items: readonly ProjectImage[],
  s: Omit<ImageSelection, 'grade'>,
): Record<GradeChip, number> {
  const base = selectImages(items, { ...s, grade: 'all' });
  return {
    all: base.length,
    flagged: base.filter((i) => gradeMatches(i, 'flagged')).length,
    rejected: base.filter((i) => gradeMatches(i, 'rejected')).length,
    ok: base.filter((i) => gradeMatches(i, 'ok')).length,
  };
}

export const filtersOf = (items: readonly ProjectImage[]) =>
  [...new Set(items.map((i) => i.filter))].sort((a, b) => a.localeCompare(b));

/** Nächte neueste zuerst. */
export const nightsOf = (items: readonly ProjectImage[]) =>
  [...new Set(items.map((i) => i.night))].sort((a, b) => b.localeCompare(a));

const csvCell = (v: unknown) => {
  const text = v === null || v === undefined ? '' : String(v);
  return /[;"\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/** CSV (Semikolon) der Auswahl: Zeit UTC, Nacht, Filter, Bewertung, Kennzahlen, Datei und relativer Pfad. */
export function imagesCsv(items: readonly ProjectImage[], header: readonly string[]): string {
  const rows = items.map((i) => [
    i.capturedAt,
    i.night,
    i.filter,
    i.grade,
    i.flags.map((f) => f.metric).join(','),
    i.hfrArcsec ?? i.hfr,
    i.stars,
    i.rmsArcsec,
    i.cloudCoverPct,
    i.fileName,
    i.relativePath,
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\n');
}
