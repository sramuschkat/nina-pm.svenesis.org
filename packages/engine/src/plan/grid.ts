/**
 * Grid-Format für Soll-Pläne und das Vergleichsorakel (AP-13a; `contracts/golden-plans/README.md`,
 * `specs/engine/allocation.md` §11.2). Ein Grid beschreibt eine Nacht ohne Astronomie: Slots, Mondhöhe
 * je Slot und je Einheit die Masken `canImage`/`safe` als inklusive Slot-Bereiche. Dieses Modul legt
 * die Typen fest, prüft die Querbezüge (`checkGrid`) und rechnet Bereiche in Masken um (`gridMasks`);
 * die Gegenstelle in C# ist `tools/astropm-oracle/cs/GridAdapter.cs`.
 */

export const GRID_SLOT_SECONDS = 300;

export const SORT_CHAIN_KEYS = [
  'lowest_peak_altitude',
  'setting_soonest',
  'most_remaining',
  'constrained',
  'most_moon_limited',
  'mosaic_grouping',
  'card_order',
  'due_soonest',
] as const;
export type SortChainKey = (typeof SORT_CHAIN_KEYS)[number];

/** Standardkette (`enums.json` → `sortChainDefault`, wie das Original). */
export const DEFAULT_SORT_CHAIN: readonly SortChainKey[] = [
  'lowest_peak_altitude',
  'setting_soonest',
  'most_remaining',
  'constrained',
];

export type GridMode = 'productive' | 'compat';
/** Inklusiver Slot-Bereich `[von, bis]`. */
export type SlotRange = readonly [number, number];

export interface GridLine {
  readonly id: string;
  readonly filter: string;
  readonly exposureS: number;
  readonly planned: number;
  readonly accepted: number;
  readonly enabled: boolean;
  /** ID aus `moonProfiles`; `null` = ohne Mondvermeidung (Stufe 0). */
  readonly moonProfile: string | null;
  /** Mond-oben-Sicherheit der Zeile (Mond unten ist immer sicher); bei `mustBeDown` ignoriert. */
  readonly safe: readonly SlotRange[];
}

export interface GridPanel {
  readonly index: number;
  /** Produktiv je Panel (A-19); fehlt der Wert, gilt der der Einheit. */
  readonly peakAltDeg?: number;
  readonly canImage?: readonly SlotRange[];
  readonly meridianAtS?: number | null;
  readonly lines: readonly GridLine[];
}

export interface GridTransit {
  /** Sekunden ab Slot 0, `[Fensterstart, Fensterende)`. */
  readonly windowS: readonly [number, number];
  readonly lineId: string;
  /** Entscheidet bei Überlappung (A-20). */
  readonly lockedAtS: number;
}

export interface GridUnit {
  /** `<projectId>` (Einzelfeld oder Mosaik ohne Panel-Einheiten) bzw. `<projectId>/p<index>`. */
  readonly unitId: string;
  readonly projectId: string;
  /** 1 = höchste, 0 = ohne (zuletzt). */
  readonly priority: number;
  readonly minTimeOnTargetH: number;
  /** `YYYY-MM-DD` oder `null`. */
  readonly dueDate: string | null;
  readonly peakAltDeg: number;
  readonly canImage: readonly SlotRange[];
  readonly meridianAtS: number | null;
  readonly transit: GridTransit | null;
  readonly panels: readonly GridPanel[];
  /** Aufwärtsdurchgang der eigenen Dämmerungsgrenze (s ab Slot 0, `block.twilightEndUtc`); fehlt = `null`. */
  readonly twilightEndS?: number | null;
}

export interface GridMoonProfile {
  readonly id: string;
  readonly distanceDeg: number;
  readonly maxIllumPct: number;
  readonly mustBeDown: boolean;
  /** Breite `W` in Tagen; produktiv Pflicht außer bei `mustBeDown` (Restriktivität A-31). */
  readonly widthDays?: number;
}

export interface GridOverhead {
  readonly slewCenterS: number;
  readonly filterChangeS: number;
  readonly ditherSettleS: number;
  readonly afEveryMin: number;
  readonly afDurationS: number;
  readonly downloadS: number;
}

export interface GridFlip {
  readonly enabled: boolean;
  readonly afterMin: number;
  readonly maxAfterMin: number;
  readonly pauseBeforeMin: number;
  readonly durationS: number;
}

export interface GridSettings {
  readonly strategy: 'proportional' | 'manual_priority';
  readonly sortChain: readonly SortChainKey[];
  readonly bonusEnabled: boolean;
  readonly overshootPct: number;
  readonly mosaicPanelsIndependent: boolean;
  readonly dither: { readonly enabled: boolean; readonly every: number };
  readonly filterSwitch: {
    readonly enabled: boolean;
    readonly every: number;
    readonly tolerancePct: number;
  };
  readonly overhead: GridOverhead;
  readonly flip: GridFlip;
}

export interface GridTonight {
  readonly pastBlocks: readonly {
    readonly unitId: string;
    readonly fromS: number;
    readonly toS: number;
  }[];
  readonly exposedSecByUnit: Readonly<Record<string, number>>;
  readonly lastAutofocusS: number | null;
  readonly filterCycle: readonly {
    readonly unitId: string;
    readonly lineId: string;
    readonly subsOnLine: number;
  }[];
  readonly flipDoneByPanel: Readonly<Record<string, boolean>>;
  readonly currentUnitId: string | null;
}

export interface GridInput {
  /** Einziges Modusfeld (allocation.md §11.1). */
  readonly mode: GridMode;
  readonly slotS: number;
  readonly slots: number;
  /** Neuplanung: Sekunden ab Slot 0; `null` = Erstplan. */
  readonly startAtS: number | null;
  readonly moonAltDeg: readonly number[];
  readonly settings: GridSettings;
  readonly moonProfiles: readonly GridMoonProfile[];
  readonly units: readonly GridUnit[];
  readonly tonight: GridTonight | null;
  /** `darknessEndUtc` in s ab Slot 0 (NT-12); fehlt = `null` (Kulanz nur bis Blockende). */
  readonly darknessEndS?: number | null;
}

export type GridIssueCode =
  | 'grid.slot_size'
  | 'grid.slot_count'
  | 'grid.moon_length'
  | 'grid.range'
  | 'grid.unit_id'
  | 'grid.duplicate_unit'
  | 'grid.duplicate_line'
  | 'grid.duplicate_profile'
  | 'grid.unknown_profile'
  | 'grid.profile_width'
  | 'grid.profile_name'
  | 'grid.project_mixed'
  | 'grid.project_inconsistent'
  | 'grid.panels'
  | 'grid.transit'
  | 'grid.exposure'
  | 'grid.counts'
  | 'grid.sort_chain'
  | 'grid.unsupported_sort_key'
  | 'grid.tonight';

export interface GridIssue {
  readonly code: GridIssueCode;
  readonly path: string;
  readonly message: string;
}

const PANEL_UNIT = /^(.+)\/p(0|[1-9][0-9]*)$/;

/** Einheit mit Panel-ID (`<projectId>/p<index>`) → Panel-Index, sonst `null`. */
export function panelUnitIndex(unitId: string): number | null {
  const m = PANEL_UNIT.exec(unitId);
  return m?.[2] === undefined ? null : Number(m[2]);
}

function isInt(x: number): boolean {
  return Number.isInteger(x);
}

/**
 * Querbezüge und Wertebereiche, die das Schema nicht ausdrücken kann. Leere Liste = gültig.
 * Kompatibilitätsmodus: `due_soonest` gibt es im Original nicht → `grid.unsupported_sort_key`.
 */
export function checkGrid(grid: GridInput): GridIssue[] {
  const issues: GridIssue[] = [];
  const add = (code: GridIssueCode, path: string, message: string) =>
    issues.push({ code, path, message });
  if (grid.slotS !== GRID_SLOT_SECONDS) add('grid.slot_size', 'slotS', 'slotS muss 300 sein');
  if (!isInt(grid.slots) || grid.slots < 1) add('grid.slot_count', 'slots', 'slots ≥ 1');
  if (grid.moonAltDeg.length !== grid.slots)
    add('grid.moon_length', 'moonAltDeg', 'moonAltDeg braucht einen Wert je Slot');
  if (grid.startAtS !== null && (!isInt(grid.startAtS) || grid.startAtS < 0))
    add('grid.range', 'startAtS', 'startAtS ist eine ganze Zahl ≥ 0');

  const ranges = (list: readonly SlotRange[], path: string) =>
    list.forEach(([from, to], i) => {
      if (!isInt(from) || !isInt(to) || from < 0 || to < from || to >= grid.slots)
        add('grid.range', `${path}[${String(i)}]`, `Bereich [${String(from)}, ${String(to)}]`);
    });

  const chain = grid.settings.sortChain;
  if (new Set(chain).size !== chain.length)
    add('grid.sort_chain', 'settings.sortChain', 'Schlüssel doppelt');
  if (grid.mode === 'compat' && chain.includes('due_soonest'))
    add(
      'grid.unsupported_sort_key',
      'settings.sortChain',
      'due_soonest gibt es im Original nicht (allocation.md §11.2)',
    );

  const profiles = new Set<string>();
  grid.moonProfiles.forEach((p, i) => {
    const at = `moonProfiles[${String(i)}]`;
    if (profiles.has(p.id)) add('grid.duplicate_profile', at, p.id);
    profiles.add(p.id);
    if (grid.mode === 'productive' && !p.mustBeDown && p.widthDays === undefined)
      add('grid.profile_width', `${at}.widthDays`, 'produktiv braucht die Breite W (A-31)');
    // Das Original erkennt „Kein Mond“ am Namen (SE 55): der Name ist dafür reserviert.
    if (grid.mode === 'compat' && !p.mustBeDown && p.id.toLowerCase() === 'no moon')
      add('grid.profile_name', `${at}.id`, '„No Moon“ nur für mustBeDown');
  });

  const unitIds = new Set<string>();
  const lineIds = new Set<string>();
  const projects = new Map<string, { kind: 'panel' | 'whole'; first: GridUnit }>();
  grid.units.forEach((u, ui) => {
    const at = `units[${String(ui)}]`;
    if (unitIds.has(u.unitId)) add('grid.duplicate_unit', `${at}.unitId`, u.unitId);
    unitIds.add(u.unitId);
    const panelIdx = panelUnitIndex(u.unitId);
    const kind = panelIdx === null ? 'whole' : 'panel';
    if (panelIdx === null && u.unitId !== u.projectId)
      add('grid.unit_id', `${at}.unitId`, 'unitId = projectId oder projectId/p<index>');
    if (panelIdx !== null) {
      if (!u.unitId.startsWith(`${u.projectId}/p`))
        add('grid.unit_id', `${at}.unitId`, 'Panel-Einheit gehört zu projectId');
      if (u.panels.length !== 1 || u.panels[0]?.index !== panelIdx)
        add('grid.panels', `${at}.panels`, 'Panel-Einheit hat genau ihr Panel');
    }
    const seen = projects.get(u.projectId);
    if (!seen) projects.set(u.projectId, { kind, first: u });
    else {
      if (seen.kind !== kind || kind === 'whole')
        add('grid.project_mixed', `${at}.projectId`, 'Projekt als Einheit oder Panel-Einheiten');
      if (
        seen.first.priority !== u.priority ||
        seen.first.minTimeOnTargetH !== u.minTimeOnTargetH ||
        seen.first.dueDate !== u.dueDate
      )
        add('grid.project_inconsistent', at, 'Projektwerte je Panel-Einheit gleich');
    }
    if (u.panels.length === 0) add('grid.panels', `${at}.panels`, 'mindestens ein Panel');
    const panelIdxs = new Set<number>();
    u.panels.forEach((p, pi) => {
      const pat = `${at}.panels[${String(pi)}]`;
      if (!isInt(p.index) || p.index < 0 || panelIdxs.has(p.index))
        add('grid.panels', `${pat}.index`, 'Panel-Index eindeutig, ganzzahlig ≥ 0');
      panelIdxs.add(p.index);
      if (p.canImage) ranges(p.canImage, `${pat}.canImage`);
      p.lines.forEach((l, li) => {
        const lat = `${pat}.lines[${String(li)}]`;
        if (lineIds.has(l.id)) add('grid.duplicate_line', `${lat}.id`, l.id);
        lineIds.add(l.id);
        if (l.moonProfile !== null && !profiles.has(l.moonProfile))
          add('grid.unknown_profile', `${lat}.moonProfile`, l.moonProfile);
        if (!isInt(l.exposureS) || l.exposureS <= 0)
          add('grid.exposure', `${lat}.exposureS`, 'exposureS ganzzahlig > 0');
        if (!isInt(l.planned) || !isInt(l.accepted) || l.planned < 0 || l.accepted < 0)
          add('grid.counts', lat, 'planned/accepted ganzzahlig ≥ 0');
        ranges(l.safe, `${lat}.safe`);
      });
    });
    ranges(u.canImage, `${at}.canImage`);
    if (u.transit) {
      const [from, to] = u.transit.windowS;
      const lines = u.panels.flatMap((p) => p.lines.map((l) => l.id));
      if (!isInt(from) || !isInt(to) || from >= to || !lines.includes(u.transit.lineId))
        add('grid.transit', `${at}.transit`, 'Fenster [von, bis) und Zeile der Einheit');
    }
  });
  for (const [projectId, p] of [...projects].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (p.kind !== 'panel') continue;
    const count = grid.units.filter((u) => u.projectId === projectId).length;
    if (count < 2) add('grid.panels', projectId, 'Panel-Einheiten nur bei mindestens zwei Panels');
  }

  const t = grid.tonight;
  if (t) {
    const known = (id: string, path: string) => {
      if (!unitIds.has(id)) add('grid.tonight', path, `unbekannte Einheit ${id}`);
    };
    t.pastBlocks.forEach((b, i) => known(b.unitId, `tonight.pastBlocks[${String(i)}]`));
    t.filterCycle.forEach((c, i) => known(c.unitId, `tonight.filterCycle[${String(i)}]`));
    if (t.currentUnitId !== null) known(t.currentUnitId, 'tonight.currentUnitId');
  }
  return issues;
}

/** Inklusive Bereiche → Maske der Länge `slots`. */
export function rangesToMask(list: readonly SlotRange[], slots: number): boolean[] {
  const mask = new Array<boolean>(slots).fill(false);
  for (const [from, to] of list)
    for (let s = Math.max(0, from); s <= Math.min(slots - 1, to); s++) mask[s] = true;
  return mask;
}

/** Maske → inklusive Bereiche (für Ausgaben und den Zufallsgenerator). */
export function maskToRanges(mask: readonly boolean[]): SlotRange[] {
  const out: SlotRange[] = [];
  let start = -1;
  for (let s = 0; s <= mask.length; s++) {
    const on = s < mask.length && mask[s] === true;
    if (on && start < 0) start = s;
    else if (!on && start >= 0) {
      out.push([start, s - 1]);
      start = -1;
    }
  }
  return out;
}

export interface GridLineMask {
  readonly id: string;
  /** Mit Mondvermeidung (Profil gesetzt). */
  readonly moonAvoid: boolean;
  readonly mustBeDown: boolean;
  /** Zeilen-Sicherheit je Slot: ohne Mondvermeidung immer, Mond unten immer, `mustBeDown` nur Mond unten. */
  readonly safe: readonly boolean[];
}

export interface GridPanelMask {
  readonly index: number;
  /** Produktiv je Panel, Kompatibilität = Einheit (allocation.md §11.1 A-19). */
  readonly canImage: readonly boolean[];
  readonly peakAltDeg: number;
  readonly lines: readonly GridLineMask[];
}

export interface GridUnitMask {
  readonly unitId: string;
  readonly canImage: readonly boolean[];
  readonly panels: readonly GridPanelMask[];
}

export interface GridMasks {
  /** Mondhöhe ≤ 0° (allocation.md §2, A-3). */
  readonly moonDown: readonly boolean[];
  readonly units: readonly GridUnitMask[];
}

/** Bereiche → Masken; die Moduswahl betrifft nur die Panel-Werte (A-19). */
export function gridMasks(grid: GridInput): GridMasks {
  const moonDown = grid.moonAltDeg.map((a) => a <= 0);
  const profiles = new Map(grid.moonProfiles.map((p) => [p.id, p]));
  const units = grid.units.map((u): GridUnitMask => {
    const canImage = rangesToMask(u.canImage, grid.slots);
    return {
      unitId: u.unitId,
      canImage,
      panels: u.panels.map((p): GridPanelMask => {
        const perPanel = grid.mode === 'productive';
        return {
          index: p.index,
          canImage: perPanel && p.canImage ? rangesToMask(p.canImage, grid.slots) : canImage,
          peakAltDeg: perPanel && p.peakAltDeg !== undefined ? p.peakAltDeg : u.peakAltDeg,
          lines: p.lines.map((l): GridLineMask => {
            const profile = l.moonProfile === null ? undefined : profiles.get(l.moonProfile);
            const moonAvoid = profile !== undefined;
            const mustBeDown = profile?.mustBeDown ?? false;
            const up = rangesToMask(l.safe, grid.slots);
            return {
              id: l.id,
              moonAvoid,
              mustBeDown,
              safe: moonDown.map(
                (down, s) => !moonAvoid || down || (!mustBeDown && up[s] === true),
              ),
            };
          }),
        };
      }),
    };
  });
  return { moonDown, units };
}
