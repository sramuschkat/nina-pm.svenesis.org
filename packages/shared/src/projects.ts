/**
 * Projekte in `packages/shared` (AP-11a; FK 8.4, FA-PRJ-10/11/12, TK 6.3/6.4): Zähler je Belichtungszeile
 * (ganzzahlig), „Soll erreicht“/„fertig“, Statusübergänge, Vollständigkeit beim Aktivieren bzw.
 * Einreichen und die Auslieferungsregel `isDeliverable`. Browser und API rechnen dasselbe.
 */
import { projectStatusTransitions, type ProjectStatus } from './generated/enums';

export interface LineCounterInput {
  readonly plannedCount: number;
  readonly acquiredCount: number;
  readonly rejectedCount: number;
  readonly bonusCount: number;
  readonly bonusRejectedCount: number;
}

export interface LineCounters {
  readonly planned: number;
  readonly acquired: number;
  readonly rejected: number;
  /** Aufgenommen − Verworfen, mindestens 0. */
  readonly accepted: number;
  /** max(0, Geplant − Akzeptiert) – Anzeige und Fortschritt. */
  readonly remaining: number;
  /** max(0, Geplant + ⌈Geplant · Überschuss‰ / 1000⌉ − Akzeptiert) – Grundlage des Schedulers. */
  readonly planningNeed: number;
  readonly bonus: number;
  readonly bonusRejected: number;
  /** Akzeptiert / Geplant in %, höchstens 100 (ohne Bonus). */
  readonly percentDone: number;
}

/** Überschuss in Promille, ganzzahlig (FK 8.4: keine Gleitkomma-Multiplikation im Planungsbedarf). */
export function overshootPermille(overshootPct: number): number {
  const x = overshootPct * 10;
  return x >= 0 ? Math.floor(x + 0.5) : -Math.floor(-x + 0.5);
}

/** ⌈a / b⌉ für nicht negative ganze Zahlen. */
const ceilDiv = (a: number, b: number) => Math.floor((a + b - 1) / b);

/** Zähler einer Zeile (FK 8.4, TK 6.4); `overshootPct` aus `rig.overshoot_pct`. */
export function lineCounters(line: LineCounterInput, overshootPct: number): LineCounters {
  const planned = Math.max(0, line.plannedCount);
  const accepted = Math.max(0, line.acquiredCount - line.rejectedCount);
  const extra = ceilDiv(planned * Math.max(0, overshootPermille(overshootPct)), 1000);
  return {
    planned,
    acquired: line.acquiredCount,
    rejected: line.rejectedCount,
    accepted,
    remaining: Math.max(0, planned - accepted),
    planningNeed: Math.max(0, planned + extra - accepted),
    bonus: line.bonusCount,
    bonusRejected: line.bonusRejectedCount,
    percentDone: planned === 0 ? 0 : Math.min(100, (accepted / planned) * 100),
  };
}

export interface ProgressLine extends LineCounterInput {
  readonly enabled: boolean;
  readonly deleted?: boolean;
}

/**
 * „Soll erreicht“ = alle aktiven Zeilen Verbleibend 0; „fertig“ = zusätzlich Planungsbedarf 0
 * (FA-PRJ-12). Ohne aktive Zeile ist ein Projekt weder das eine noch das andere.
 */
export function projectProgress(lines: readonly ProgressLine[], overshootPct: number) {
  const active = lines.filter((l) => l.enabled && !l.deleted);
  const counters = active.map((l) => lineCounters(l, overshootPct));
  const planned = counters.reduce((s, c) => s + c.planned, 0);
  const accepted = counters.reduce((s, c) => s + Math.min(c.accepted, c.planned), 0);
  return {
    targetReached: active.length > 0 && counters.every((c) => c.remaining === 0),
    finished: active.length > 0 && counters.every((c) => c.planningNeed === 0),
    planningNeed: counters.reduce((s, c) => s + c.planningNeed, 0),
    percentDone: planned === 0 ? 0 : Math.min(100, (accepted / planned) * 100),
  };
}

/** Zulässige Übergänge (contracts/enums.json `projectStatusTransitions`, FA-PRJ-11). */
export function canTransition(from: ProjectStatus, to: ProjectStatus): boolean {
  const allowed = (projectStatusTransitions as Record<string, readonly string[] | undefined>)[from];
  return allowed?.includes(to) ?? false;
}

/**
 * Automatische Rückkehr nach *Aktiv* (FA-PRJ-12, TK 6.3): steigt der Planungsbedarf eines Projekts in
 * *Bereit zur Bearbeitung* bzw. *Abgeschlossen* wieder über 0 und ist `autoReactivateOnRemaining` an.
 */
export function autoReactivate(
  status: ProjectStatus | null,
  planningNeed: number,
  autoReactivateOnRemaining: boolean,
): ProjectStatus | null {
  if (!autoReactivateOnRemaining || planningNeed <= 0) return null;
  return status === 'ready_to_process' || status === 'completed' ? 'active' : null;
}

export interface CompletenessInput {
  readonly name: string;
  readonly rigId: string | null;
  readonly raDeg: number | null;
  readonly decDeg: number | null;
  readonly targetName: string | null;
  readonly activeLinesWithPlan: number;
}

/**
 * Pflichtangaben ab Einreichung bzw. Aktivierung (FA-PRJ-01): Name, Rig, Koordinaten, Zielname und
 * mindestens eine aktive Zeile mit geplanten Aufnahmen. Leer = vollständig; sonst die fehlenden Felder
 * (Pfade für `approval.incomplete`).
 */
export function missingForActivation(p: CompletenessInput): string[] {
  const missing: string[] = [];
  if (!p.name.trim()) missing.push('name');
  if (!p.rigId) missing.push('rigId');
  if (p.raDeg === null || p.decDeg === null) missing.push('coordinates');
  if (!p.targetName?.trim()) missing.push('targetName');
  if (p.activeLinesWithPlan === 0) missing.push('lines');
  return missing;
}

export interface DeliverableInput {
  readonly approvalStatus: string;
  readonly status: string | null;
  readonly deletedAt: string | Date | null;
  readonly ninaDeliveryEnabled: boolean;
  readonly bonusEnabled: boolean;
  readonly startDate: string | null;
  readonly projectType: 'deep_sky' | 'exoplanet';
  readonly lines: readonly (ProgressLine & { readonly disabledForNight?: string | null })[];
  readonly overshootPct: number;
  /** Exoplaneten: eine festgelegte Beobachtung mit Fensterende in der Zukunft (AP-40). */
  readonly hasLockedTransit?: boolean;
}

/**
 * Auslieferung an NINA und Eingabe des Schedulers (TK 6.3 `isDeliverable`): freigegeben, *Aktiv*, nicht
 * gelöscht, Rig liefert aus, Startdatum erreicht und Arbeit vorhanden (Planungsbedarf > 0 oder Bonus).
 */
export function isDeliverable(p: DeliverableInput, night: string): boolean {
  if (p.approvalStatus !== 'approved' || p.status !== 'active' || p.deletedAt !== null)
    return false;
  if (!p.ninaDeliveryEnabled) return false;
  if (p.startDate !== null && p.startDate > night) return false;
  if (p.projectType === 'exoplanet') return p.hasLockedTransit === true;
  return p.lines.some(
    (l) =>
      l.enabled &&
      !l.deleted &&
      l.disabledForNight !== night &&
      (p.bonusEnabled || lineCounters(l, p.overshootPct).planningNeed > 0),
  );
}
