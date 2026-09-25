/**
 * Reine Hilfen des Projekt-Editors S-31 (AP-11b): Schnelleingabe (Anzahl **oder** Stunden, FA-PRJ-20,
 * FA-BPL-03), Summen je Panel und Projekt (FA-PRJ-21), gesperrte Felder bei Zeilen mit Aufnahmen
 * (NT-E3) und die Vorlagen-Regel (FA-BPL-01/05). Ohne DOM, ohne Abfragen – getestet in `projects.test.tsx`.
 */
import { designationPrefix, LINE_LOCKED_FIELDS } from '@nina-pm/shared';
import type {
  ExposureTemplateView,
  LineView,
  MoonProfileView,
  ProjectView,
  RigView,
} from '../../api/client';

/** Anzahl aus Stunden: aufgerundet, damit die gewünschte Zeit mindestens erreicht wird. */
export function countFromHours(hours: number, exposureS: number): number {
  if (!(hours > 0) || !(exposureS > 0)) return 0;
  return Math.ceil((hours * 3600) / exposureS - 1e-9);
}

/** Stunden aus Anzahl × Belichtung. */
export function hoursFromCount(count: number, exposureS: number): number {
  if (!(count > 0) || !(exposureS > 0)) return 0;
  return (count * exposureS) / 3600;
}

export interface QuickEntry {
  readonly filterId: string;
  readonly exposureS: number | null;
  readonly mode: 'count' | 'hours';
  readonly value: number | null;
}

export interface QuickEntryDefaults {
  readonly gain: number | null;
  readonly offsetAdu: number | null;
  readonly binning: number;
  readonly readoutMode: string | null;
  readonly moonProfileId: string | null;
}

/**
 * Neue Zeile aus der Schnelleingabe (FA-PRJ-20): Filter, Belichtung, Anzahl oder Stunden; Gain,
 * Offset, Binning und Auslesemodus aus der Kamera des Rigs, Mondprofil aus dem Filter (sonst
 * Projektstandard). `null` = Eingabe unvollständig.
 */
export function quickEntryLine(
  entry: QuickEntry,
  defaults: QuickEntryDefaults,
): {
  filterId: string;
  exposureS: number;
  plannedCount: number;
  gain: number | null;
  offsetAdu: number | null;
  binning: number;
  readoutMode: string | null;
  moonMode: 'profile' | 'project_default';
  moonProfileId: string | null;
} | null {
  const exposureS = entry.exposureS ?? 0;
  if (!entry.filterId || !(exposureS > 0) || entry.value === null || !(entry.value > 0))
    return null;
  const plannedCount =
    entry.mode === 'hours' ? countFromHours(entry.value, exposureS) : Math.round(entry.value);
  if (plannedCount < 1) return null;
  return {
    filterId: entry.filterId,
    exposureS,
    plannedCount,
    gain: defaults.gain,
    offsetAdu: defaults.offsetAdu,
    binning: defaults.binning,
    readoutMode: defaults.readoutMode,
    moonMode: defaults.moonProfileId ? 'profile' : 'project_default',
    moonProfileId: defaults.moonProfileId,
  };
}

export interface PlanSums {
  /** Verschiedene Filter der aktiven Zeilen. */
  readonly filters: number;
  readonly plannedFrames: number;
  readonly plannedS: number;
  /** Akzeptierte Frames (Aufgenommen − Verworfen). */
  readonly acceptedFrames: number;
  /** Integrationszeit inkl. Bonus (FK 8.4). */
  readonly acceptedS: number;
  /** Akzeptiert (höchstens Geplant) / Geplant in %, ohne Bonus. */
  readonly percent: number;
}

/** Summenzeile und Kopfzahlen (FA-PRJ-21): nur aktive Zeilen zählen. */
export function planSums(lines: readonly LineView[]): PlanSums {
  const active = lines.filter((l) => l.enabled);
  const planned = active.reduce((s, l) => s + l.counters.planned, 0);
  const accepted = active.reduce(
    (s, l) => s + Math.min(l.counters.accepted, l.counters.planned),
    0,
  );
  return {
    filters: new Set(active.map((l) => l.filterId ?? l.filterShortName)).size,
    plannedFrames: planned,
    plannedS: active.reduce((s, l) => s + l.counters.planned * l.exposureS, 0),
    acceptedFrames: active.reduce((s, l) => s + l.counters.accepted, 0),
    acceptedS: active.reduce((s, l) => s + l.counters.integrationS, 0),
    percent: planned === 0 ? 0 : Math.min(100, (accepted / planned) * 100),
  };
}

/** Gesperrtes Feld einer Zeile (NT-E3): mit Aufnahmen nur Anzahl geplant, Mondprofil und aktiv. */
export function isLocked(line: Pick<LineView, 'hasCaptures'>, field: string): boolean {
  return line.hasCaptures && (LINE_LOCKED_FIELDS as readonly string[]).includes(field);
}

/**
 * Vorlagen-Regel: passend sind Vorlagen ohne bzw. mit der Teleskop-/Kamera-Kombination des Rigs
 * (FA-BPL-01); anwendbar nur, solange keine Zeile Aufnahmen hat (FA-BPL-05).
 */
export function templatesFor(
  templates: readonly ExposureTemplateView[],
  rig: Pick<RigView, 'telescopeId' | 'cameraId'> | null,
): ExposureTemplateView[] {
  return templates.filter(
    (tpl) =>
      !rig ||
      ((tpl.telescopeId === null || tpl.telescopeId === rig.telescopeId) &&
        (tpl.cameraId === null || tpl.cameraId === rig.cameraId)),
  );
}

export const templateAllowed = (lines: readonly Pick<LineView, 'hasCaptures'>[]) =>
  !lines.some((l) => l.hasCaptures);

/** Filter der Zeile ist auf dem Rig nicht bestätigt zugeordnet (FA-RIG-14). */
export function filterUnassigned(
  filterId: string | null,
  wheel: RigView['filterWheel'] | undefined,
): boolean {
  if (!wheel || wheel.length === 0 || filterId === null) return false;
  return !wheel.some((s) => s.filterId === filterId && s.ninaConfirmedAt !== null);
}

// ---- Entwurf des Kopfes (Zielinformationen, Bedingungen) -----------------------------------------

export type Conditions = ProjectView['conditions'];

export interface ProjectDraft {
  name: string;
  rigId: string | null;
  targetName: string;
  targetType: string;
  /** Aus der Katalogsuche übernommen (AP-20); frei eingegebene Ziele ohne. */
  dsoObjectId: string | null;
  catalogNames: string;
  descriptionMd: string;
  raDeg: number | null;
  decDeg: number | null;
  rotationDeg: number | null;
  /** Nacht-Schlüssel `YYYY-MM-DD` oder leer (NT-04). */
  startDate: string;
  dueDate: string;
  conditions: Conditions;
}

export function emptyDraft(conditions: Conditions): ProjectDraft {
  return {
    name: '',
    rigId: null,
    targetName: '',
    targetType: '',
    dsoObjectId: null,
    catalogNames: '',
    descriptionMd: '',
    raDeg: null,
    decDeg: null,
    rotationDeg: 0,
    startDate: '',
    dueDate: '',
    conditions,
  };
}

export function toDraft(p: ProjectView): ProjectDraft {
  return {
    name: p.name,
    rigId: p.rigId,
    targetName: p.targetName ?? '',
    targetType: p.targetType ?? '',
    dsoObjectId: p.dsoObjectId,
    catalogNames: p.catalogNames,
    descriptionMd: p.descriptionMd,
    raDeg: p.raDeg,
    decDeg: p.decDeg,
    rotationDeg: p.rotationDeg,
    startDate: p.startDate ?? '',
    dueDate: p.dueDate ?? '',
    conditions: p.conditions,
  };
}

const orNull = (s: string) => (s.trim() === '' ? null : s.trim());

/** Katalogobjekt → Zielfelder des Entwurfs (Katalogsuche im Editor, „Projekt anlegen“ in S-21). */
export interface CatalogPick {
  readonly id: string;
  readonly displayName: string;
  readonly names: readonly string[];
  readonly primaryId: string;
  readonly raDeg: number;
  readonly decDeg: number;
  /** Anzeigegruppe, bereits übersetzt. */
  readonly typeLabel: string;
}

/** Erster Trivialname (ohne Katalogkürzel), z. B. „Andromeda Galaxy“. */
export const commonName = (names: readonly string[]) =>
  names.find((n) => designationPrefix(n) === null) ?? null;

export function applyCatalogPick(d: ProjectDraft, o: CatalogPick): ProjectDraft {
  const designations = [o.primaryId, ...o.names].filter(
    (n) => designationPrefix(n) !== null && n !== o.displayName,
  );
  const common = commonName(o.names);
  return {
    ...d,
    name: d.name.trim() === '' ? (common ? `${o.displayName} – ${common}` : o.displayName) : d.name,
    targetName: o.displayName,
    targetType: o.typeLabel,
    dsoObjectId: o.id,
    catalogNames: [...new Set(designations)].join(', ').slice(0, 500),
    raDeg: o.raDeg,
    decDeg: o.decDeg,
  };
}

/** Entwurf → Felder der API (leere Texte/Daten als `null`, Rotation leer = 0). */
export function draftBody(d: ProjectDraft) {
  return {
    name: d.name.trim(),
    rigId: d.rigId,
    targetName: orNull(d.targetName),
    targetType: orNull(d.targetType),
    dsoObjectId: d.dsoObjectId,
    catalogNames: d.catalogNames,
    descriptionMd: d.descriptionMd,
    raDeg: d.raDeg,
    decDeg: d.decDeg,
    rotationDeg: d.rotationDeg ?? 0,
    startDate: orNull(d.startDate),
    dueDate: orNull(d.dueDate),
    conditions: d.conditions,
  };
}

/**
 * Teiländerung gegen die gespeicherte Fassung: nur geänderte Felder, bei den Bedingungen nur die
 * geänderten Werte (ProjectPatch ohne Standardwerte, AP-11a). Leeres Objekt = nichts geändert.
 */
export function changedFields(d: ProjectDraft, saved: ProjectView): Record<string, unknown> {
  const body = draftBody(d);
  const base = draftBody(toDraft(saved));
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(body) as (keyof typeof body)[]) {
    if (key === 'conditions') continue;
    if (body[key] !== base[key]) out[key] = body[key];
  }
  const cond: Record<string, unknown> = {};
  for (const key of Object.keys(body.conditions) as (keyof Conditions)[])
    if (body.conditions[key] !== base.conditions[key]) cond[key] = body.conditions[key];
  if (Object.keys(cond).length > 0) out.conditions = cond;
  return out;
}

/** Mondwerte eines Profils in die Projekt-Bedingungen übernehmen (FA-PRJ-22, Projektstandard). */
export function conditionsFromProfile(
  c: Conditions,
  p: Pick<
    MoonProfileView,
    | 'separationDeg'
    | 'widthDays'
    | 'relaxScale'
    | 'moonMinAltDeg'
    | 'moonMaxAltDeg'
    | 'maxIlluminationPct'
    | 'moonMustBeDown'
  >,
): Conditions {
  return {
    ...c,
    moonAvoidanceEnabled: true,
    moonMustBeDown: p.moonMustBeDown,
    moonSeparationDeg: p.separationDeg,
    moonWidthDays: p.widthDays,
    moonRelaxScale: p.relaxScale,
    moonMinAltDeg: p.moonMinAltDeg,
    moonMaxAltDeg: p.moonMaxAltDeg,
    moonMaxIlluminationPct: p.maxIlluminationPct,
  };
}

/** Projekt-Mondwerte als Engine-Profil (Streifen „Empfohlene Belichtungszeit“); aus = keines. */
export function engineMoonProfile(c: Conditions) {
  return c.moonAvoidanceEnabled
    ? {
        separationDeg: c.moonSeparationDeg,
        widthDays: c.moonWidthDays,
        relaxScale: c.moonRelaxScale,
        moonMinAltDeg: c.moonMinAltDeg,
        moonMaxAltDeg: c.moonMaxAltDeg,
        maxIlluminationPct: c.moonMaxIlluminationPct,
        moonMustBeDown: c.moonMustBeDown,
      }
    : null;
}
