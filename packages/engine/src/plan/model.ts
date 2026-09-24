/**
 * Datenmodell der Nachtplanung (`specs/engine/allocation.md` §2–4): Einheiten-Profile, Stufen und die
 * Matrix, auf der `paint` arbeitet. Masken sind je Slot (300 s) indiziert; Zeiten in Sekunden ab Slot 0.
 */
import type { CompatSwitches } from './compat';
import type { GridMode, SortChainKey } from './grid';

/** Arbeitshinweis eines Slots (SE `SlotWorkType`). */
export type Hint = 'any' | 'la' | 'nonLa';

/** Mond-Stufe (§3.4). Stufe 0 = ohne Mondvermeidung. */
export interface Tier {
  /** Gruppierungsschlüssel: produktiv Profil-ID, Kompatibilität Profilname. */
  readonly key: string;
  readonly restrictiveness: number;
  readonly maxIllumPct: number;
  readonly requiresMoonDown: boolean;
}

/** Belichtungszeile einer Einheit (für Stufen, Arbeit und später `pick`). */
export interface UnitLine {
  readonly id: string;
  readonly panelIndex: number;
  readonly filter: string;
  readonly exposureS: number;
  readonly planned: number;
  readonly accepted: number;
  readonly enabled: boolean;
  /** Stufe der Zeile oder −1 (deaktiviert). */
  readonly tier: number;
  /** Planungsbedarf in Belichtungen (§2 `effRemaining`). */
  readonly effRemaining: number;
  /** Arbeitssekunden je Belichtung (`exposureS` bzw. `exposureS + ov`). */
  readonly secPerExposure: number;
  /** Zeilen-Sicherheit je Slot (Mond unten immer sicher). */
  readonly safe: readonly boolean[];
}

export interface UnitTransit {
  readonly startS: number;
  readonly endS: number;
  readonly lockedAtS: number;
  readonly lineId: string;
}

/** Profil einer Einheit (Projekt oder Panel, §3). */
export interface UnitProfile {
  readonly unitId: string;
  readonly projectId: string;
  /** Reihenfolge des ersten Auftretens des Projekts (Kompatibilität: `mosaic_grouping`). */
  readonly projectOrdinal: number;
  /** Panel-Index der Panel-Einheit (Grid/Datenmodell), sonst `null`. */
  readonly panelIndex: number | null;
  /** Position des Panels in der Panelliste des Projekts (Kompatibilität: Panel-Tie-Break). */
  readonly panelPos: number | null;
  readonly priority: number;
  readonly dueDate: string | null;
  readonly minTimeSec: number;
  readonly canImage: readonly boolean[];
  readonly peakAltDeg: number;
  readonly tiers: readonly Tier[];
  readonly tierWorkSec: readonly number[];
  readonly tierSafe: readonly (readonly boolean[])[];
  readonly lines: readonly UnitLine[];
  readonly transit: UnitTransit | null;
  /** Blockfixkosten `fix` (A-16), Kompatibilität 0. */
  readonly fixSec: number;
  readonly meridianAtS: number | null;
}

export interface ExcludedUnit {
  readonly unitId: string;
  readonly reason: 'below_min_time' | 'no_transit_window' | 'no_work' | 'no_need';
  /** Nutzbare Slots (`CanImage`) – 0 heißt „nie sichtbar“ (Diagnose `not_visible`). */
  readonly usableSlots: number;
  /** Zeilen der Einheit (zeilenweise Gründe für das Aufwand-Kennzeichen). */
  readonly lines: readonly UnitLine[];
}

/** Vorbelegung vergangener Slots bei Neuplanung (§5.3, A-10/A-11). */
export interface PastSlots {
  /** Einheit je Slot (`null` = frei) für Slots vor `startAtS`. */
  readonly byUnit: readonly (string | null)[];
  /** Erster nutzbarer Slot (Slot, in dem `startAtS` liegt). */
  readonly startSlot: number;
}

/** Panels eines Projekts mit allen Zeilen (auch bei Panel-Einheiten), nach Panel-Index. */
export interface ProjectLines {
  readonly projectId: string;
  readonly panels: readonly { readonly index: number; readonly lines: readonly UnitLine[] }[];
}

/** Alles, was `paint` außer den Profilen braucht. */
export interface NightSetup {
  readonly mode: GridMode;
  readonly switches: CompatSwitches;
  readonly slots: number;
  readonly moonAltDeg: readonly number[];
  readonly moonDown: readonly boolean[];
  readonly strategy: 'proportional' | 'manual_priority';
  readonly sortChain: readonly SortChainKey[];
  readonly bonusEnabled: boolean;
  readonly slewCenterS: number;
  readonly profiles: readonly UnitProfile[];
  readonly excluded: readonly ExcludedUnit[];
  readonly past: PastSlots | null;
  /** Projekte in Reihenfolge des ersten Auftretens (Walk, Filterwahl). */
  readonly projects: readonly ProjectLines[];
}

/** Zeile der Matrix (§4); `tierWorkSec` wird beim Malen verringert (live). */
export interface Row {
  readonly index: number;
  readonly profile: UnitProfile;
  readonly tierWorkSec: number[];
  readonly tierMoonUpSafeSlots: readonly number[];
  readonly usable: readonly boolean[];
  readonly firstUsableSlot: number;
  readonly lastUsableSlot: number;
  readonly totalUsableSlots: number;
  readonly moonDownSlots: number;
  readonly minChunkSec: number;
  readonly minChunkSlots: number;
  readonly isConstrained: boolean;
  readonly peakAltitude: number;
  readonly userPriorityIndex: number;
  /** Erwartete Blockzahl (§2, A-16). */
  readonly nBlocks: number;
  /** Vergangene Slots (A-10), nur produktiv bei Neuplanung. */
  readonly pastSlots: number;
  preFiltered: boolean;
  hasLockedWindow: boolean;
  transitConflict: boolean;
}

export interface Matrix {
  readonly setup: NightSetup;
  readonly slots: number;
  readonly moonDown: readonly boolean[];
  readonly rows: Row[];
  /** Zeilenindex je Slot, −1 = frei. */
  readonly assignment: number[];
  readonly locked: boolean[];
  readonly hint: Hint[];
  readonly firstUsableSlot: number;
  readonly lastUsableSlot: number;
  /** Prioritätsreihenfolge (Zeilenindizes) für die manuelle Priorität. */
  readonly priorityOrder: readonly number[];
}

export const SLOT_S = 300;

export function rowTotalWork(r: Row): number {
  let sum = 0;
  for (const w of r.tierWorkSec) sum += w;
  return sum;
}

export function rowLaWork(r: Row): number {
  let sum = 0;
  for (let t = 1; t < r.tierWorkSec.length; t++) sum += r.tierWorkSec[t] ?? 0;
  return sum;
}

export function rowNonLaWork(r: Row): number {
  return r.tierWorkSec[0] ?? 0;
}

export function rowHasLaWork(r: Row): boolean {
  for (let t = 1; t < r.tierWorkSec.length; t++) if ((r.tierWorkSec[t] ?? 0) > 0) return true;
  return false;
}

export function rowHasNonLaWork(r: Row): boolean {
  return (r.tierWorkSec[0] ?? 0) > 0;
}
