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
  'flagged',
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
    case 'flagged':
      return c.grade === 'flagged';
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

/** Kennzahlen der Qualitätskurve (AP-72, FA-AUS-23). */
export const QUALITY_KEYS = ['hfr', 'stars', 'rms', 'cloud', 'sqm', 'alt', 'adu'] as const;
export type QualityKey = (typeof QUALITY_KEYS)[number];

/** Punkt der Qualitätskurve: gespeichertes Light mit allen vorhandenen Werten; HFR in ″, wenn der Maßstab bekannt ist. */
export interface QualityPoint {
  readonly atS: number;
  readonly filter: string;
  readonly projectId: string | null;
  readonly values: Partial<Record<QualityKey, number>>;
}

export function qualityPoints(
  captures: readonly NightSessionCapture[],
  scaleArcsecPx: number | null,
): QualityPoint[] {
  return captures
    .filter((c) => c.frameType === 'light' && c.result === 'saved')
    .map((c) => {
      const q = c.quality ?? null;
      const values: Partial<Record<QualityKey, number>> = {};
      if (c.hfr !== null)
        values.hfr = scaleArcsecPx ? c.hfr * scaleArcsecPx * (c.binning ?? 1) : c.hfr;
      if (c.stars !== null) values.stars = c.stars;
      if (q?.rmsArcsec !== undefined) values.rms = q.rmsArcsec;
      if (q?.cloudCoverPct !== undefined) values.cloud = q.cloudCoverPct;
      if (q?.skyQualityMag !== undefined) values.sqm = q.skyQualityMag;
      if (q?.altitudeDeg !== undefined) values.alt = q.altitudeDeg;
      if (q?.medianAdu !== undefined) values.adu = q.medianAdu;
      return {
        atS: Date.parse(c.capturedAt) / 1000,
        filter: c.filterShortName,
        projectId: c.projectId,
        values,
      };
    })
    .filter((p) => Object.keys(p.values).length > 0)
    .sort((a, b) => a.atS - b.atS);
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

// ---- Eine Karte je Nacht und Rig (Entscheidung Sven 07.10.2026) ----

export interface NightGroup {
  readonly key: string;
  readonly rigId: string;
  readonly rigName: string;
  readonly siteTimeZone: string;
  readonly night: string;
  /** Sessions der Nacht in zeitlicher Reihenfolge. */
  readonly sessions: readonly NightSessionListItem[];
  readonly startedAt: string;
  /** `null`, solange eine Session läuft. */
  readonly endedAt: string | null;
  /** Ungeprüft, solange eine Session ungeprüft ist. */
  readonly reviewed: boolean;
  /** Laufend vor verwaist vor abgebrochen vor abgeschlossen. */
  readonly status: NightSessionListItem['status'];
  readonly integrationS: number;
  readonly efficiency: NightSessionListItem['efficiency'];
  readonly weather: NightSessionListItem['weather'];
  readonly projects: NightSessionProject[];
}

const STATUS_RANK: Record<string, number> = { running: 3, stale: 2, aborted: 1, completed: 0 };

const latest = (ends: readonly (string | null)[]): string | null =>
  ends.includes(null)
    ? null
    : (([...ends] as string[]).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) ?? null);

/** Effizienz der Nacht: Summe Belichtung / Summe nutzbare Dunkelzeit der Sessions mit Effizienz (gewichtet). */
export function mergeEfficiency(
  list: readonly NightSessionListItem['efficiency'][],
): NightSessionListItem['efficiency'] {
  const known = list.filter((e): e is NonNullable<typeof e> => e !== null);
  if (known.length === 0) return null;
  const exposureS = known.reduce((s, e) => s + e.exposureS, 0);
  const usableDarkS = known.reduce((s, e) => s + e.usableDarkS, 0);
  return {
    exposureS,
    usableDarkS,
    pct: usableDarkS > 0 ? Math.round((exposureS / usableDarkS) * 1000) / 10 : null,
  };
}

/** Projekt-Chips mehrerer Sessions: Frames je Filter summiert, Reihenfolge des ersten Auftretens. */
export function mergeProjects(
  lists: readonly (readonly NightSessionProject[])[],
): NightSessionProject[] {
  const out = new Map<string, NightSessionProject>();
  for (const list of lists)
    for (const p of list) {
      const cur = out.get(p.projectId);
      if (!cur) {
        out.set(p.projectId, { ...p, filters: p.filters.map((f) => ({ ...f })) });
        continue;
      }
      const filters = cur.filters.map((f) => ({ ...f }));
      for (const f of p.filters) {
        const hit = filters.find((x) => x.filter === f.filter);
        if (hit) hit.frames += f.frames;
        else filters.push({ ...f });
      }
      out.set(p.projectId, {
        ...cur,
        transit: cur.transit || p.transit,
        frames: cur.frames + p.frames,
        filters,
      });
    }
  return [...out.values()];
}

/** Sessions der Liste je Nacht und Rig zusammenfassen (Reihenfolge der Liste: neueste Nacht zuerst). */
export function groupNights(items: readonly NightSessionListItem[]): NightGroup[] {
  const groups = new Map<string, NightSessionListItem[]>();
  for (const s of items) {
    const key = `${s.night}|${s.rigId}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups].map(([key, list]) => {
    const sessions = [...list].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    const first = sessions[0] as NightSessionListItem;
    return {
      key,
      rigId: first.rigId,
      rigName: first.rigName,
      siteTimeZone: first.siteTimeZone,
      night: first.night,
      sessions,
      startedAt: first.startedAt,
      endedAt: latest(sessions.map((s) => s.endedAt)),
      reviewed: sessions.every((s) => s.reviewed),
      status: sessions.reduce<NightSessionListItem['status']>(
        (w, s) => ((STATUS_RANK[s.status] ?? 0) > (STATUS_RANK[w] ?? 0) ? s.status : w),
        'completed',
      ),
      integrationS: sessions.reduce((n, s) => n + s.integrationS, 0),
      efficiency: mergeEfficiency(sessions.map((s) => s.efficiency)),
      weather: sessions.find((s) => s.weather !== null)?.weather ?? null,
      projects: mergeProjects(sessions.map((s) => s.projects)),
    };
  });
}

/**
 * Daten der ganzen Nacht aus mehreren Session-Details (Nacht-Seite, Auswahl „Ganze Nacht“): Aufnahmen, Ereignisse
 * und Flats zusammen in zeitlicher Reihenfolge, Zeilen je Belichtungszeile einmal (für Zuordnen und Rechte), Kennzahlen
 * summiert (Effizienz gewichtet). Soll/Ist und „geprüft“ bleiben je Session.
 */
export function mergeDetails(details: readonly NightSessionDetail[]): NightSessionDetail {
  const first = details[0] as NightSessionDetail;
  if (details.length === 1) return first;
  const rows = new Map<string, NightSessionLineRow>();
  for (const d of details)
    for (const r of d.rows) if (!rows.has(r.exposureLineId)) rows.set(r.exposureLineId, r);
  const k = details.map((d) => d.kpis);
  const exposureS = k.reduce((s, x) => s + x.exposureS, 0);
  const dark = k.reduce((s, x) => s + (x.usableDarkS ?? 0), 0);
  return {
    ...first,
    session: {
      ...first.session,
      endedAt: latest(details.map((d) => d.session.endedAt)),
      reviewed: details.every((d) => d.session.reviewed),
    },
    rows: [...rows.values()],
    captures: details
      .flatMap((d) => d.captures)
      .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt)),
    capturesTruncated: details.some((d) => d.capturesTruncated),
    events: details
      .flatMap((d) => d.events)
      .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt)),
    flats: details.flatMap((d) => d.flats),
    kpis: {
      ...first.kpis,
      darkToUtc: details.at(-1)?.kpis.darkToUtc ?? first.kpis.darkToUtc,
      exposureS,
      usableDarkS: dark,
      efficiencyPct: dark > 0 ? Math.round((exposureS / dark) * 1000) / 10 : null,
    },
    reasons: details.flatMap((d) => d.reasons),
  };
}

/** Lücken im Zeitraum einer Session (Prüfliste je Session). */
export function gapsWithin(
  gaps: readonly NightGap[],
  session: { readonly startedAt: string; readonly endedAt: string | null },
): NightGap[] {
  const from = Date.parse(session.startedAt) / 1000;
  const to = session.endedAt ? Date.parse(session.endedAt) / 1000 : Number.POSITIVE_INFINITY;
  return gaps.filter((g) => g.toUtc > from && g.fromUtc < to);
}
