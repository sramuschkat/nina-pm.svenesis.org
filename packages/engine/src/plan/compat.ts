/**
 * Schalterliste Kompatibilitätsmodus (`specs/engine/allocation.md` §10, §11.1; AP-13a). Jeder Schalter
 * steht für eine Abweichung vom C#-Original: `true` = Abweichung aktiv (Produktivmodus), `false` =
 * Verhalten des Originals. `PlanInput.mode` bzw. `GridInput.mode` ist das **einzige** Modusfeld; die
 * Schalter werden daraus abgeleitet (`compatSwitches`), nie einzeln gesetzt. A-8 (toter Code) und A-30
 * (entfallen) haben keinen Schalter. Die Engine-Logik dazu folgt in AP-13b…13d.
 */
import type { GridMode } from './grid';

export interface CompatSwitches {
  /** A-1: Astronomie aus AP-08b (sonst liefert das Grid die Masken). */
  readonly preciseAstronomy: boolean;
  /** A-2: `moonSafe` nach `moon.md`. */
  readonly moonSafeProfiles: boolean;
  /** A-3: „Kein Mond“ überall ⇔ Mondhöhe ≤ 0°. */
  readonly noMoonIsMoonDown: boolean;
  /** A-4: Overheads `ov`/Walk mit Slew, Filterwechsel, Download, Dither, AF (sonst `ov = 0`, Einträge ohne Zeit). */
  readonly overheads: boolean;
  /** A-5: Meridian-Flip im Plan, vor der Filterwahl. */
  readonly meridianFlip: boolean;
  /** A-6: Pass 0/0b, enforceMinimum, gapFill prüfen `UsableSlot` (sonst `CanImage`). */
  readonly usableSlotPasses: boolean;
  /** A-7: Belichtung nur bis Blockende; `pick` ohne Seiteneffekte. */
  readonly hardBlockEnd: boolean;
  /** A-9: vollständige Tie-Breaks, Einheitenreihenfolge Projekt-ID/Panel-Index (sonst Grid-Reihenfolge, OrdinalIgnoreCase). */
  readonly fullTieBreaks: boolean;
  /** A-10: Nachtfairness mit bereits Belichtetem. */
  readonly nightFairness: boolean;
  /** A-11: Neuplanung mit `startAtUtc`/`tonight` (sonst `startAtUtc` nur Uhrstart). */
  readonly replanTonight: boolean;
  /** A-12: Transitfenster aus `transit.md` mit Unsicherheitspuffer. */
  readonly transitUncertainty: boolean;
  /** A-13: Sortierschlüssel `due_soonest`. */
  readonly dueSoonest: boolean;
  /** A-14: `accessible` nach Pass 3a neu berechnen. */
  readonly accessibleAfter3a: boolean;
  /** A-15: gemeinsamer Bedarf je Projekt (Mosaik-Deckel). */
  readonly mosaicGroupCap: boolean;
  /** A-16: Blockfixkosten `fix` in MinChunk, Aussortieren und Bedarf. */
  readonly blockFixCost: boolean;
  /** A-17: Blockanfang-Ersatz nur mit CanImage in allen Slots, ohne Transit/Vorgefilterte. */
  readonly fallbackAllSlots: boolean;
  /** A-18: Slew/Zentrieren nach jedem Leerlauf. */
  readonly slewAfterIdle: boolean;
  /** A-19: Panel-Einheiten mit Panel-Koordinaten, Panel-Lock mit Panel-Index. */
  readonly panelCoordinates: boolean;
  /** A-20: Transit-Vorabbelegung nach `locked_at`. */
  readonly transitByLockedAt: boolean;
  /** A-21: Transitreihe bis Fensterende. */
  readonly transitUntilWindowEnd: boolean;
  /** A-22: Filterzyklus je Zeilen-ID; aktives Panel = Panel der letzten Belichtung. */
  readonly cycleByLine: boolean;
  /** A-23: „Letzte Zeile wiederholen“ nur für dieselbe Einheit (sonst globales `lastEs`). */
  readonly repeatSameUnit: boolean;
  /** A-24: Nachtende-Kulanz nur im letzten Block, `lastOfNight`. */
  readonly lastBlockGrace: boolean;
  /** A-25: Nachtgrenzen nur aus Einheiten mit Arbeit oder Bonus-Möglichkeit. */
  readonly nightBoundsWithWork: boolean;
  /** A-26: Slot nutzbar nur, wenn die Bedingung zu Beginn und am Ende gilt. */
  readonly slotStartAndEnd: boolean;
  /** A-27: Budgets normiert und auf ganze Slots quantisiert. */
  readonly quantizedBudgets: boolean;
  /** A-28: Stufe sicher, wenn eine Zeile mit Arbeit sicher ist (sonst Repräsentant). */
  readonly tierSafeAnyLine: boolean;
  /** A-29: leeres `pick` mitten im Block gibt den Rest des Laufs frei (`idle_gap`). */
  readonly releaseIdleRun: boolean;
  /** A-32: fortgesetzte Einheit einer Neuplanung ohne Mindestzeit, solange nutzbar (Entscheidung Sven 07.10.2026). */
  readonly continuation: boolean;
  /**
   * A-33: im Ablauf frei gewordene Zeit neu vergeben – vorige Einheit verlängern, nächste früher beginnen, andere
   * Einheit nur bei lohnendem Rest (Entscheidung Sven 07.10.2026).
   */
  readonly reofferFreedTime: boolean;
  /** A-34: kein `slew_center` am Beginn des ersten Blocks, wenn er die fortgesetzte Einheit weiterführt (A-32). */
  readonly continuationNoSlew: boolean;
  /**
   * A-35: Aufrücken – ein regulärer Block beginnt direkt nach der letzten Aktion des unmittelbar vorigen Blocks statt an
   * der nächsten Slotgrenze, wenn seine Einheit im angeschnittenen Slot nutzbar ist (Zuteilung bleibt im 5-min-Raster).
   */
  readonly moveUpBlocks: boolean;
  /**
   * A-36: Ein neuer Block mit Slew braucht Platz für mindestens `MIN_VISIT_SUBS` Belichtungen, außer er stellt die
   * Einheit fertig (Entscheidung Sven 09.10.2026); sonst wird er behandelt wie ein Blockanfang ohne Arbeit (A-17/A-33).
   */
  readonly minVisitSubs: boolean;
  /** A-31: Restriktivität `A · W · arctan(14,77/W)` (sonst `A × (1 + 100/(maxIllum+1))`). */
  readonly restrictivenessWidth: boolean;
}

/** Schalter → Abweichungs-ID aus allocation.md §10 (für Diagnose und Tests). */
export const DEVIATION_IDS: Readonly<Record<keyof CompatSwitches, string>> = {
  preciseAstronomy: 'A-1',
  moonSafeProfiles: 'A-2',
  noMoonIsMoonDown: 'A-3',
  overheads: 'A-4',
  meridianFlip: 'A-5',
  usableSlotPasses: 'A-6',
  hardBlockEnd: 'A-7',
  fullTieBreaks: 'A-9',
  nightFairness: 'A-10',
  replanTonight: 'A-11',
  transitUncertainty: 'A-12',
  dueSoonest: 'A-13',
  accessibleAfter3a: 'A-14',
  mosaicGroupCap: 'A-15',
  blockFixCost: 'A-16',
  fallbackAllSlots: 'A-17',
  slewAfterIdle: 'A-18',
  panelCoordinates: 'A-19',
  transitByLockedAt: 'A-20',
  transitUntilWindowEnd: 'A-21',
  cycleByLine: 'A-22',
  repeatSameUnit: 'A-23',
  lastBlockGrace: 'A-24',
  nightBoundsWithWork: 'A-25',
  slotStartAndEnd: 'A-26',
  quantizedBudgets: 'A-27',
  tierSafeAnyLine: 'A-28',
  releaseIdleRun: 'A-29',
  restrictivenessWidth: 'A-31',
  continuation: 'A-32',
  reofferFreedTime: 'A-33',
  continuationNoSlew: 'A-34',
  moveUpBlocks: 'A-35',
  minVisitSubs: 'A-36',
};

const SWITCH_KEYS = Object.keys(DEVIATION_IDS).sort() as (keyof CompatSwitches)[];

/** Produktiv: alle Abweichungen aktiv; Kompatibilität: alle aus (allocation.md §11.1). */
export function compatSwitches(mode: GridMode): CompatSwitches {
  const on = mode === 'productive';
  return Object.fromEntries(SWITCH_KEYS.map((k) => [k, on])) as unknown as CompatSwitches;
}
