/**
 * Auto-Flats je Projekt (AP-50b, FA-SCH-08): Gelten die vorhandenen Flats eines Projekts noch für eine Kombination?
 * Dieselbe Regel nutzt das Plugin (`NinaPm.Core/Flats/FlatCoverage.cs`) beim Flat-Lauf und die Web-App für die
 * Markierung je Belichtungszeile. Muster nach dem Astro-PM-Plugin (MIT), `Services/FlatsLedger.cs`
 * (`FlatsAutoPolicy.IsCovered`, `FindCoverage`), Commit edbb301 – dort mit fester Winkeltoleranz 2°, hier wie bei der
 * Kombinationsbildung `max(1°, Rotationstoleranz/2)` (flip-rotation.md §4).
 */
import type { FlatsAutoMode } from './generated/enums';

/** Vorhandene Flats eines Projekts je Kombination (Server: `flat_combination` der Sessions des Rigs). */
export interface FlatRecordData {
  readonly filterShortName: string;
  /** Mechanischer Rotatorwinkel in Zehntelgrad (Schlüssel, NIN5-8). */
  readonly rotatorMechDg: number;
  /** Gain/Offset `null` stehen als `-1` (NT-38). */
  readonly gain: number;
  readonly offset: number;
  readonly binning: number;
  readonly readoutModeIndex: number;
  /** Ende der Session, in der die Flats entstanden (ISO-UTC). */
  readonly lastUtc: string;
  readonly count: number;
}

/** Gesuchte Kombination; `rotatorMechDg = null` = beliebiger Winkel (Zeile ohne Lights, z. B. vollständiger Flat-Satz). */
export interface FlatKeyData {
  readonly filterShortName: string;
  readonly rotatorMechDg: number | null;
  readonly gain: number;
  readonly offset: number;
  readonly binning: number;
  readonly readoutModeIndex: number;
}

export interface FlatAutoRule {
  readonly mode: FlatsAutoMode;
  readonly intervalDays: number;
  /** Rotationstoleranz des Rigs in Grad. */
  readonly rotationToleranceDeg: number;
}

export interface FlatCoverageResult {
  /** Gültige Flats vorhanden: die Kombination wird nicht noch einmal aufgenommen. */
  readonly covered: boolean;
  /** Neueste passende Flats (auch wenn zu alt). */
  readonly lastUtc: string | null;
  readonly count: number;
}

const FULL_CIRCLE_DG = 3600;

/** `max(1°, Toleranz/2)` in Zehntelgrad – wie die Kombinationsbildung. */
export function flatToleranceDg(rotationToleranceDeg: number): number {
  return Math.round(Math.max(1, rotationToleranceDeg / 2) * 10);
}

function circularDg(a: number, b: number): number {
  const d = Math.abs(a - b) % FULL_CIRCLE_DG;
  return Math.min(d, FULL_CIRCLE_DG - d);
}

/**
 * `once_per_project`: gültig, sobald passende Flats existieren. `time_based`: gültig, solange die neuesten passenden
 * jünger als `intervalDays` Tage sind (genau N Tage alt → neu aufnehmen). `off`: nie gültig (Flats nach jeder Nacht).
 */
export function flatCoverage(
  records: readonly FlatRecordData[],
  key: FlatKeyData,
  rule: FlatAutoRule,
  nowUtc: string,
): FlatCoverageResult {
  const tol = flatToleranceDg(rule.rotationToleranceDeg);
  const matches = records.filter(
    (r) =>
      r.filterShortName === key.filterShortName &&
      r.gain === key.gain &&
      r.offset === key.offset &&
      r.binning === key.binning &&
      r.readoutModeIndex === key.readoutModeIndex &&
      (key.rotatorMechDg === null || circularDg(r.rotatorMechDg, key.rotatorMechDg) <= tol),
  );
  const lastUtc = matches.reduce<string | null>(
    (latest, r) => (latest === null || r.lastUtc > latest ? r.lastUtc : latest),
    null,
  );
  const count = matches.reduce((n, r) => n + r.count, 0);
  if (rule.mode === 'off' || lastUtc === null) return { covered: false, lastUtc, count };
  if (rule.mode === 'once_per_project') return { covered: true, lastUtc, count };
  const ageMs = Date.parse(nowUtc) - Date.parse(lastUtc);
  return { covered: ageMs < Math.max(1, rule.intervalDays) * 86_400_000, lastUtc, count };
}
