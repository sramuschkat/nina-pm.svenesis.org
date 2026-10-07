/**
 * Auswertung einer Nacht aus den Session-Daten (AP-64; FA-AUS-03, FA-AUS-07, FA-AUS-08, FA-AUS-22): Projekt-Chips und
 * Effizienzbalken der Nächte-Liste (S-60), Prüfliste des Prüf-Banners, Ergebnis je Projekt, Aufnahmen-Typen und die
 * HFR-Reihe der Nacht (S-61). Rein: keine Uhr, keine Abfrage, keine Übersetzung – die Seite beschriftet.
 * Begriffe wie #303 (Entscheidung Sven 07.10.2026): Soll = erster Plan der Session ohne Bonus (Transit-Serie: Zeitfenster),
 * Ist = Aufnahmen dieser Session.
 */
import type {
  NightSessionCapture,
  NightSessionDetail,
  NightSessionLineRow,
  NightSessionListItem,
  NightSessionProject,
} from '../../api/client';

// ---- Nächte-Liste (S-60) ----

/** Chip eines Projekts: Transit als Serie („Transit · RED 558“), sonst Frames je Filter („HA 10 · OIII 10“). */
export interface ProjectChip {
  readonly projectId: string;
  readonly projectName: string;
  readonly createdBy: string | null;
  readonly series: boolean;
  readonly parts: readonly { readonly filter: string; readonly frames: number }[];
}

export function projectChips(projects: readonly NightSessionProject[]): ProjectChip[] {
  return projects.map((p) => ({
    projectId: p.projectId,
    projectName: p.projectName,
    createdBy: p.createdBy,
    series: p.transit,
    parts: p.filters.map((f) => ({ filter: f.filter, frames: f.frames })),
  }));
}

/** Effizienzbalken „8,2 von 9,6 h · 85 %“: Stunden und Breite (0–100 %); `null` ohne Effizienz. */
export function efficiencyBar(
  e: NightSessionListItem['efficiency'],
): { exposureH: number; darkH: number; pct: number | null; widthPct: number } | null {
  if (!e) return null;
  const pct = e.pct === null ? null : Math.round(e.pct);
  return {
    exposureH: e.exposureS / 3600,
    darkH: e.usableDarkS / 3600,
    pct,
    widthPct: Math.max(0, Math.min(100, e.pct ?? 0)),
  };
}

/** Wetterpunkt der Karte: Klasse der Bewertung (für die Farbe) aus dem Schnappschuss zum Sessionbeginn. */
export function weatherTone(w: NightSessionListItem['weather']): 'good' | 'fair' | 'poor' | 'none' {
  if (!w || w.ratingIndex === null) return 'none';
  return w.ratingIndex >= 3 ? 'good' : w.ratingIndex === 2 ? 'fair' : 'poor';
}

// ---- Prüf-Banner (S-61 Übersicht) ----

/** Lücke im Ist der Nacht (aus `actualView`, Sekunden UTC). */
export interface NightGap {
  readonly fromUtc: number;
  readonly toUtc: number;
  readonly kind: string;
  readonly reason?: string | null;
  readonly count?: number;
}

export type ReviewItem =
  | { readonly kind: 'assigned'; readonly ok: true; readonly count: number }
  | { readonly kind: 'unassigned'; readonly ok: false; readonly count: number }
  | {
      readonly kind: 'short';
      readonly ok: false;
      readonly lineId: string;
      readonly projectName: string;
      readonly filter: string;
      readonly acquired: number;
      readonly planned: number;
    }
  | {
      readonly kind: 'gap';
      readonly ok: false;
      readonly gapKind: string;
      readonly reason: string | null;
      readonly count: number;
      readonly fromUtc: number;
      readonly toUtc: number;
    };

/** Lücken ab dieser Dauer kommen in die Prüfliste („Lücken > 10 min mit Grund“). */
export const REVIEW_GAP_MIN_S = 600;

/**
 * Prüfliste aus den Daten der Nacht: (1) Aufnahmen ohne Zuordnung → „zuordnen“ (sind alle zugeordnet, ein erledigter
 * Punkt), (2) Zeilen mit Ist < Soll → „Grund erfassen“, (3) Lücken über 10 min mit Grund → „ansehen“. Der Meridian-Flip
 * ist eine erwartete Lücke und kein Prüfpunkt. Keine Punkte (keine Lights, nichts offen) → leere Liste, kein Banner.
 */
export function reviewChecklist(
  detail: Pick<NightSessionDetail, 'captures' | 'rows'>,
  gaps: readonly NightGap[],
): ReviewItem[] {
  const items: ReviewItem[] = [];
  const lights = detail.captures.filter((c) => c.frameType === 'light' && c.result === 'saved');
  const unassigned = lights.filter((c) => c.assignment === 'unassigned').length;
  if (unassigned > 0) items.push({ kind: 'unassigned', ok: false, count: unassigned });
  else if (lights.length > 0) items.push({ kind: 'assigned', ok: true, count: lights.length });
  for (const r of detail.rows)
    if (r.planned !== null && r.plannedSeries === null && r.planned > 0 && r.acquired < r.planned)
      items.push({
        kind: 'short',
        ok: false,
        lineId: r.exposureLineId,
        projectName: r.projectName,
        filter: r.filterShortName,
        acquired: r.acquired,
        planned: r.planned,
      });
  for (const g of gaps)
    if (g.kind !== 'flip' && g.toUtc - g.fromUtc > REVIEW_GAP_MIN_S)
      items.push({
        kind: 'gap',
        ok: false,
        gapKind: g.kind,
        reason: g.reason ?? null,
        count: g.count ?? 1,
        fromUtc: g.fromUtc,
        toUtc: g.toUtc,
      });
  // Nur ein erledigter Punkt und sonst nichts: trotzdem ein Banner (die Nacht ist ungeprüft).
  return items;
}

// ---- Ergebnis je Projekt (S-61 Übersicht) ----

export interface FilterResult {
  readonly lineId: string;
  readonly filter: string;
  /** Ist = Aufnahmen dieser Session (ohne Bonus). */
  readonly acquired: number;
  /** Soll ohne Bonus; `null` ohne Plan bzw. ohne Soll (später eingeplant, nicht im ersten Plan). */
  readonly planned: number | null;
  readonly series: { readonly fromUtc: string; readonly untilUtc: string } | null;
  /** `true` Soll erreicht, `false` Ist < Soll, `null` ohne Soll. */
  readonly ok: boolean | null;
}

export interface ProjectResult {
  readonly projectId: string;
  readonly projectName: string;
  readonly createdBy: string | null;
  readonly filters: readonly FilterResult[];
  readonly rows: readonly NightSessionLineRow[];
  readonly integrationS: number;
  readonly transit: boolean;
  /** Verworfen bzw. Bonus über alle Zeilen – die Spalten erscheinen nur bei Werten > 0. */
  readonly rejected: number;
  readonly bonus: number;
}

export function projectResults(rows: readonly NightSessionLineRow[]): ProjectResult[] {
  const byProject = new Map<string, NightSessionLineRow[]>();
  for (const r of rows) byProject.set(r.projectId, [...(byProject.get(r.projectId) ?? []), r]);
  return [...byProject.values()].map((list) => {
    const first = list[0] as NightSessionLineRow;
    const filters = list.map((r): FilterResult => {
      const series = r.plannedSeries;
      const planned = series ? null : r.planned === null || r.planned === 0 ? null : r.planned;
      return {
        lineId: r.exposureLineId,
        filter: r.filterShortName,
        acquired: r.acquired,
        planned,
        series,
        ok: series ? r.acquired > 0 : planned === null ? null : r.acquired >= planned,
      };
    });
    return {
      projectId: first.projectId,
      projectName: first.projectName,
      createdBy: first.projectCreatedBy,
      filters,
      rows: list,
      integrationS: list.reduce((s, r) => s + r.integrationS, 0),
      transit: list.some((r) => r.plannedSeries !== null),
      rejected: list.reduce((s, r) => s + r.rejected + r.bonusRejected, 0),
      bonus: list.reduce((s, r) => s + r.bonus, 0),
    };
  });
}

// ---- Kennzahlen der Nacht (S-61 Übersicht) ----

export interface NightFacts {
  /** Astronomische Dunkelheit laut erstem Plan, Sekunden; `null` ohne. */
  readonly darkS: number | null;
  readonly exposureS: number;
  readonly efficiencyPct: number | null;
  readonly lights: number;
  readonly flats: number;
  readonly darkFlats: number;
  /** Lücken im Ist ohne Flip (Leerlauf, Safety, leere bzw. übersprungene Blöcke); `null` ohne Ist. */
  readonly idleS: number | null;
  readonly flips: number;
  readonly autofocus: number;
}

export function nightFacts(
  detail: Pick<NightSessionDetail, 'captures' | 'events' | 'kpis'>,
  gaps: readonly NightGap[] | null,
): NightFacts {
  const k = detail.kpis;
  const saved = detail.captures.filter((c) => c.result === 'saved');
  return {
    darkS:
      k.darkFromUtc && k.darkToUtc
        ? Math.max(0, Date.parse(k.darkToUtc) - Date.parse(k.darkFromUtc)) / 1000
        : null,
    exposureS: k.exposureS,
    efficiencyPct: k.efficiencyPct,
    lights: saved.filter((c) => c.frameType === 'light').length,
    flats: saved.filter((c) => c.frameType === 'flat').length,
    darkFlats: saved.filter((c) => c.frameType === 'dark_flat').length,
    idleS:
      gaps === null
        ? null
        : gaps.filter((g) => g.kind !== 'flip').reduce((s, g) => s + (g.toUtc - g.fromUtc), 0),
    flips: detail.events.filter((e) => e.kind === 'flip').length,
    autofocus: detail.events.filter((e) => e.kind === 'af').length,
  };
}

// ---- Aufnahmen (S-61 Reiter Aufnahmen) ----

export const CAPTURE_TYPES = [
  'all',
  'lights',
  'flats',
  'deviations',
  'unassigned',
  'rejected',
] as const;
export type CaptureType = (typeof CAPTURE_TYPES)[number];

export function captureMatches(c: NightSessionCapture, type: CaptureType): boolean {
  switch (type) {
    case 'lights':
      return c.frameType === 'light';
    case 'flats':
      return c.frameType === 'flat' || c.frameType === 'dark_flat';
    case 'deviations':
      return c.temperatureDeviation || c.settingsDeviation;
    case 'unassigned':
      return c.assignment === 'unassigned';
    case 'rejected':
      return c.rejected;
    default:
      return true;
  }
}

export function captureCounts(
  captures: readonly NightSessionCapture[],
): Record<CaptureType, number> {
  return Object.fromEntries(
    CAPTURE_TYPES.map((t) => [t, captures.filter((c) => captureMatches(c, t)).length]),
  ) as Record<CaptureType, number>;
}

/** Punkt der HFR-/Sterne-Reihe (FA-AUS-08): gespeicherte Lights mit Messwert, Zeit in Sekunden UTC. */
export interface MetricPoint {
  readonly atS: number;
  readonly hfr: number | null;
  readonly stars: number | null;
  readonly filter: string;
}

export function metricPoints(captures: readonly NightSessionCapture[]): MetricPoint[] {
  return captures
    .filter(
      (c) =>
        c.frameType === 'light' && c.result === 'saved' && (c.hfr !== null || c.stars !== null),
    )
    .map((c) => ({
      atS: Date.parse(c.capturedAt) / 1000,
      hfr: c.hfr,
      stars: c.stars,
      filter: c.filterShortName,
    }))
    .sort((a, b) => a.atS - b.atS);
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}
