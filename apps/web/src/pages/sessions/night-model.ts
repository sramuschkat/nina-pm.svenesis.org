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

// ---- Lücken und Hinweise (S-61 Übersicht) ----

/** Lücke im Ist der Nacht (aus `actualView`, Sekunden UTC). */
export interface NightGap {
  readonly fromUtc: number;
  readonly toUtc: number;
  readonly kind: string;
  readonly reason?: string | null;
  readonly count?: number;
}

/**
 * Ereignisse, die als Hinweis über der Übersicht stehen (AP-77): Fehler und Warnungen des Plugins, verlorene Lease,
 * fehlgeschlagenes Zentrieren und Abweichungen bei Filter, Auslesemodus, Rotation und Flip. Fehler zuerst.
 */
export const NIGHT_WARNING_KINDS = [
  'error',
  'warning',
  'lease_lost',
  'lease_conflict',
  'center_failed',
  'filter_not_found',
  'readout_mode_not_found',
  'rotation_mismatch',
  'rotation_unknown',
  'flip_settings_mismatch',
  'flip_undetected',
  'past_mismatch',
] as const;

export function nightWarnings(events: NightSessionDetail['events']): {
  errors: number;
  warnings: number;
  kinds: { kind: string; count: number }[];
} {
  const kinds = new Map<string, number>();
  for (const e of events)
    if ((NIGHT_WARNING_KINDS as readonly string[]).includes(e.kind))
      kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
  const list = NIGHT_WARNING_KINDS.flatMap((kind) => {
    const count = kinds.get(kind);
    return count ? [{ kind, count }] : [];
  });
  return {
    errors: kinds.get('error') ?? 0,
    warnings: list.filter((k) => k.kind !== 'error').reduce((n, k) => n + k.count, 0),
    kinds: list,
  };
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
 * summiert (Effizienz gewichtet), Bedingungen über alle Sessions. Soll/Ist und die Qualität je Zeile bleiben je Session.
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
    conditions: mergeConditions(details.map((d) => d.conditions ?? [])),
  };
}

type Condition = NonNullable<NightSessionDetail['conditions']>[number];

/**
 * Bedingungen mehrerer Sessions: je Größe die Quelle der ersten Session, Spanne über alle, als Mittelwert der Median der
 * Mediane (genug für die seltenen Nächte mit mehreren Sessions).
 */
export function mergeConditions(lists: readonly (readonly Condition[])[]): Condition[] {
  const byMetric = new Map<Condition['metric'], Condition[]>();
  for (const list of lists)
    for (const c of list) byMetric.set(c.metric, [...(byMetric.get(c.metric) ?? []), c]);
  return [...byMetric.values()].map((list) => {
    const first = list[0] as Condition;
    return {
      ...first,
      median: median(list.map((c) => c.median)) ?? first.median,
      min: Math.min(...list.map((c) => c.min)),
      max: Math.max(...list.map((c) => c.max)),
    };
  });
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
