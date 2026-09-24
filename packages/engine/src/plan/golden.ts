/**
 * Soll-Plan-Format des Ablaufs (`contracts/golden-plans/README.md`, AP-13d): Einträge, Warnungen und
 * Diagnosen eines Grid-Plans in der Schreibweise der Soll-Pläne (Sekunden ab Slot 0, `unitId`).
 */
import type { PlanGridResult } from './run';

export type GoldenEntry = Readonly<Record<string, string | number | boolean | null>>;

export function goldenEntries(result: PlanGridResult): GoldenEntry[] {
  const out: GoldenEntry[] = [];
  for (const b of result.blocks)
    for (const e of b.entries)
      switch (e.cmd) {
        case 'slew_center':
        case 'slew_center_rotate':
          out.push({
            atS: e.atS,
            cmd: e.cmd,
            unit: b.unitId,
            panel: e.panelIndex,
            durationS: e.durationS,
          });
          break;
        case 'filter':
          out.push({ atS: e.atS, cmd: 'filter', filter: e.filter, durationS: e.durationS });
          break;
        case 'expose':
          out.push({
            atS: e.atS,
            cmd: 'expose',
            line: e.lineId,
            bonus: e.bonus,
            lastOfNight: e.lastOfNight,
          });
          break;
        case 'expose_series':
          out.push({ atS: e.atS, cmd: 'expose_series', line: e.lineId, untilS: e.untilS });
          break;
        case 'end':
          out.push({ atS: e.atS, cmd: 'end' });
          break;
        default:
          out.push({ atS: e.atS, cmd: e.cmd, durationS: e.durationS });
      }
  return out;
}

export function goldenWarnings(result: PlanGridResult): GoldenEntry[] {
  return result.warnings.map((w) => ({
    code: w.code,
    ...(w.unitId !== undefined ? { unitId: w.unitId } : {}),
    ...(w.atS !== undefined ? { atS: w.atS } : {}),
  }));
}

export function goldenDiagnostics(result: PlanGridResult): GoldenEntry[] {
  return result.diagnostics.map((d) => ({
    unitId: d.unitId,
    ...(d.lineId !== undefined ? { lineId: d.lineId } : {}),
    reason: d.reason,
  }));
}
