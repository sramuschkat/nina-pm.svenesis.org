/**
 * Warnungen und Diagnose (`specs/engine/allocation.md` §12, FA-SIM-03; AP-13d) auf Ebene der Einheiten
 * (`unitId`, Grid-Schreibweise). `planNight` übersetzt sie in `projectId`/`panelId` und ergänzt, was nur
 * mit Astronomie geht (`start_date`, `panel_rotation_mismatch`, `twilight_grazing`).
 */
import { SLOT_S, type ExcludedUnit, type Matrix, type Row, type UnitLine } from './model';
import type { TransitFlip, WalkBlock } from './walk';

export type DiagnosticReason =
  | 'start_date'
  | 'not_visible'
  | 'below_min_time'
  | 'moon_blocked'
  | 'prefiltered'
  | 'outranked'
  | 'no_need'
  | 'transit_conflict'
  | 'flip_in_transit'
  | 'filter_not_found'
  | 'rotation_mismatch';

export type WarningCode =
  | 'idle_gap'
  | 'la_unsafe'
  | 'total_min'
  | 'no_alloc'
  | 'la_miss'
  | 'filter_stuck'
  | 'past_mismatch'
  | 'panel_rotation_mismatch'
  | 'twilight_grazing';

export interface UnitDiagnostic {
  readonly unitId: string;
  readonly lineId?: string;
  readonly reason: DiagnosticReason;
  readonly message?: string;
}

export interface UnitWarning {
  readonly code: WarningCode;
  readonly level: 'warn' | 'error';
  readonly unitId?: string;
  readonly atS?: number;
  readonly durationS?: number;
  readonly message?: string;
}

export interface ValidateInput {
  readonly matrix: Matrix;
  readonly blocks: readonly WalkBlock[];
  readonly emitted: ReadonlyMap<string, number>;
  readonly transitFlips: readonly TransitFlip[];
  readonly excluded: readonly ExcludedUnit[];
  readonly downloadS: number;
  readonly flipDurationS: number;
  readonly slewCenterS: number;
  readonly tonight: {
    readonly pastSecByUnit: ReadonlyMap<string, number>;
    readonly exposedSecByUnit: Readonly<Record<string, number>>;
  } | null;
}

const ordinal = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function initialWork(row: Row): number {
  let sum = 0;
  for (const w of row.profile.tierWorkSec) sum += w;
  return sum;
}

export function validatePlan(input: ValidateInput): {
  warnings: UnitWarning[];
  diagnostics: UnitDiagnostic[];
} {
  const { matrix: m, blocks, emitted } = input;
  const warnings: UnitWarning[] = [];
  const diagnostics: UnitDiagnostic[] = [];
  const exposesOf = new Map<string, { atS: number; line: string; slot: number }[]>();
  for (const b of blocks)
    for (const e of b.entries)
      if (e.cmd === 'expose') {
        const list = exposesOf.get(b.unitId) ?? [];
        list.push({ atS: e.atS, line: e.lineId, slot: Math.floor(e.atS / SLOT_S) });
        exposesOf.set(b.unitId, list);
      }
  const hasSeries = new Set(
    blocks.filter((b) => b.entries.some((e) => e.cmd === 'expose_series')).map((b) => b.unitId),
  );
  const linesById = new Map<string, UnitLine>();
  for (const p of m.setup.projects)
    for (const panel of p.panels) for (const l of panel.lines) linesById.set(l.id, l);
  const rest = (l: UnitLine) => l.effRemaining - (emitted.get(l.id) ?? 0);

  // ─── Diagnose ────────────────────────────────────────────────────────────────────────────────
  for (const e of input.excluded) {
    const usable = e.usableSlots;
    const reason: DiagnosticReason =
      e.reason === 'no_need' || e.reason === 'no_work'
        ? 'no_need'
        : e.reason === 'no_transit_window' || usable === 0
          ? 'not_visible'
          : 'below_min_time';
    diagnostics.push({ unitId: e.unitId, reason });
    if (reason !== 'no_need')
      for (const l of e.lines)
        if (l.effRemaining > 0) diagnostics.push({ unitId: e.unitId, lineId: l.id, reason });
  }
  for (const row of m.rows) {
    const unitId = row.profile.unitId;
    const lines = row.profile.lines.filter((l) => l.enabled && l.tier >= 0);
    const withWork = lines.filter((l) => l.effRemaining > 0);
    if (row.transitConflict) {
      diagnostics.push({ unitId, reason: 'transit_conflict' });
      continue;
    }
    if (row.profile.transit !== null) continue;
    if (initialWork(row) <= 0) {
      diagnostics.push({ unitId, reason: 'no_need' });
      continue;
    }
    const exposures = exposesOf.get(unitId) ?? [];
    const neverUsable = row.usable.every((u) => !u);
    // AP-71: Kein Slot mit Dunkelheit und Mindesthöhe (z. B. Neuplanung nach dem Untergang, Mindestzeit 0) heißt
    // `not_visible`; „Mond blockiert“ nur, wenn das Ziel sichtbar wäre und der Mond der einzige Grund ist.
    const neverVisible = row.profile.canImage.every((c) => c !== true);
    const unitReason: DiagnosticReason | null = row.preFiltered
      ? 'prefiltered'
      : neverUsable
        ? neverVisible
          ? 'not_visible'
          : 'moon_blocked'
        : exposures.length === 0
          ? 'outranked'
          : null;
    if (unitReason) diagnostics.push({ unitId, reason: unitReason });
    for (const l of withWork) {
      if ((emitted.get(l.id) ?? 0) > 0) continue;
      let safeSomewhere = false;
      for (let s = 0; s < m.slots && !safeSomewhere; s++)
        if (row.profile.canImage[s] === true && l.safe[s] === true) safeSomewhere = true;
      const reason: DiagnosticReason = row.preFiltered
        ? 'prefiltered'
        : neverVisible
          ? 'not_visible'
          : !safeSomewhere
            ? 'moon_blocked'
            : 'outranked';
      diagnostics.push({ unitId, lineId: l.id, reason });
    }
  }
  for (const f of input.transitFlips) {
    const message =
      f.gapDurationS !== null
        ? `Meridiandurchgang im Transitfenster – Flip unvermeidlich, erwartete Lücke ${String(f.gapDurationS)} s (Flip ${String(input.flipDurationS)} s + Zentrieren ${String(input.slewCenterS)} s): ${String(f.framesPlanned)} statt ${String(f.framesWithoutFlip)} Aufnahmen`
        : `Flip im Vorlauf – Serie beginnt ${String((f.delayedSeriesS ?? f.windowStartS) - f.windowStartS)} s nach dem Fensterbeginn: ${String(f.framesPlanned)} statt ${String(f.framesWithoutFlip)} Aufnahmen`;
    diagnostics.push({ unitId: f.unitId, reason: 'flip_in_transit', message });
  }

  // ─── Warnungen ───────────────────────────────────────────────────────────────────────────────
  const assignment = m.assignment;
  const hasReachableWork = (row: Row) =>
    !row.preFiltered &&
    row.profile.transit === null &&
    row.profile.lines.some((l) => l.enabled && l.tier >= 0 && rest(l) > 0);
  if (m.firstUsableSlot >= 0) {
    let start = -1;
    const flush = (end: number) => {
      if (start >= 0 && end - start >= 2)
        warnings.push({
          code: 'idle_gap',
          level: 'error',
          atS: start * SLOT_S,
          durationS: (end - start) * SLOT_S,
        });
      start = -1;
    };
    for (let s = m.firstUsableSlot; s <= m.lastUsableSlot + 1; s++) {
      const idle =
        s <= m.lastUsableSlot &&
        (assignment[s] ?? -1) < 0 &&
        m.rows.some((row) => row.usable[s] === true && hasReachableWork(row));
      if (idle && start < 0) start = s;
      else if (!idle) flush(s);
    }
  }
  for (const b of blocks)
    for (const e of b.entries) {
      if (e.cmd !== 'expose') continue;
      const l = linesById.get(e.lineId);
      if (!l || l.tier <= 0) continue;
      const end = e.atS + e.exposureS + input.downloadS;
      for (let s = Math.floor(e.atS / SLOT_S); s * SLOT_S < end && s < m.slots; s++)
        if (l.safe[s] !== true) {
          warnings.push({ code: 'la_unsafe', level: 'error', unitId: b.unitId, atS: e.atS });
          break;
        }
    }
  for (const row of m.rows) {
    const unitId = row.profile.unitId;
    if (row.profile.transit !== null) continue;
    const exposures = exposesOf.get(unitId) ?? [];
    const work = initialWork(row);
    let assigned = 0;
    for (const a of assignment) if (a === row.index) assigned++;
    if (exposures.length > 0 && assigned < row.minChunkSlots && work >= row.minChunkSec)
      warnings.push({ code: 'total_min', level: 'warn', unitId });
    if (exposures.length === 0 && work > 0 && row.totalUsableSlots > 0 && !hasSeries.has(unitId))
      warnings.push({ code: 'no_alloc', level: 'warn', unitId });
    let laWork = 0;
    for (let t = 1; t < row.profile.tierWorkSec.length; t++)
      laWork += row.profile.tierWorkSec[t] ?? 0;
    const moonDownUsable = row.usable.some((u, s) => u && m.moonDown[s] === true);
    if (laWork > 600 && moonDownUsable && !exposures.some((x) => m.moonDown[x.slot] === true))
      warnings.push({ code: 'la_miss', level: 'warn', unitId });
    const active = row.profile.lines.filter((l) => l.enabled && l.tier >= 0);
    if (active.length > 1) {
      let prev = '';
      let run = 0;
      for (const x of exposures) {
        const filter = linesById.get(x.line)?.filter ?? x.line;
        run = filter === prev ? run + 1 : 1;
        prev = filter;
        if (run === 31) warnings.push({ code: 'filter_stuck', level: 'warn', unitId, atS: x.atS });
      }
    }
  }
  if (input.tonight)
    for (const [unitId, sec] of Object.entries(input.tonight.exposedSecByUnit).sort(([a], [b]) =>
      ordinal(a, b),
    ))
      if (Math.abs(sec - (input.tonight.pastSecByUnit.get(unitId) ?? 0)) > 2 * SLOT_S)
        warnings.push({ code: 'past_mismatch', level: 'warn', unitId });

  const byUnit = (a: { unitId?: string }, b: { unitId?: string }) =>
    ordinal(a.unitId ?? '', b.unitId ?? '');
  diagnostics.sort(
    (a, b) =>
      byUnit(a, b) || ordinal(a.lineId ?? '', b.lineId ?? '') || ordinal(a.reason, b.reason),
  );
  warnings.sort((a, b) => (a.atS ?? -1) - (b.atS ?? -1) || byUnit(a, b) || ordinal(a.code, b.code));
  return { warnings, diagnostics };
}
