/**
 * Projekte (AP-11a; FA-PRJ-01…22, FA-BER; TK 7.2): Projekt mit Bedingungen, Panels und Belichtungszeilen,
 * Zähler (FK 8.4), Status, Priorität, Favoriten, Notizen, Verlauf, Papierkorb. Datumsfelder mit
 * Standortbezug (`startDate`, `dueDate`) sind Nacht-Schlüssel (NT-04). Entwürfe dürfen unvollständig
 * sein (Koordinaten, Rig); Panels und Zeilen setzen Koordinaten voraus (Schema `project_panel`).
 */
import { z } from 'zod';
import { approvalStatuses, moonModes, projectStatuses, twilight } from '../generated/enums';
import { NightKey, UtcInstant, Uuid } from './common';

const text = (max: number) => z.string().max(max);
const nullableInt = z.number().int().nullable();

/** Aufnahmebedingungen (FA-PRJ-03) und Projekt-Mondwerte für Zeilen mit *Projektstandard* (FA-PRJ-22). */
const conditionShape = {
  minAltitudeDeg: z.number().min(0).max(90),
  minTimeOnTargetH: z.number().positive().max(24),
  twilight: z.enum(twilight),
  moonAvoidanceEnabled: z.boolean(),
  moonMustBeDown: z.boolean(),
  moonSeparationDeg: z.number().min(0).max(180),
  moonWidthDays: z.number().min(0),
  moonRelaxScale: z.number().min(0),
  moonMinAltDeg: z.number().min(-90).max(90),
  moonMaxAltDeg: z.number().min(-90).max(90),
  moonMaxIlluminationPct: z.number().min(0).max(100),
};

/** Vorbelegung der Bedingungen (Schema `project`, FA-PRJ-03; Mondwerte wie „Moderat“). */
export const DEFAULT_CONDITIONS = {
  minAltitudeDeg: 30,
  minTimeOnTargetH: 1,
  twilight: 'astronomical',
  moonAvoidanceEnabled: false,
  moonMustBeDown: false,
  moonSeparationDeg: 60,
  moonWidthDays: 5,
  moonRelaxScale: 2,
  moonMinAltDeg: -15,
  moonMaxAltDeg: 5,
  moonMaxIlluminationPct: 60,
} as const;

/** Aufnahmebedingungen (FA-PRJ-03) und Projekt-Mondwerte für Zeilen mit *Projektstandard* (FA-PRJ-22). */
export const ProjectConditions = z
  .object({
    minAltitudeDeg: conditionShape.minAltitudeDeg.default(DEFAULT_CONDITIONS.minAltitudeDeg),
    minTimeOnTargetH: conditionShape.minTimeOnTargetH.default(DEFAULT_CONDITIONS.minTimeOnTargetH),
    twilight: conditionShape.twilight.default(DEFAULT_CONDITIONS.twilight),
    moonAvoidanceEnabled: conditionShape.moonAvoidanceEnabled.default(
      DEFAULT_CONDITIONS.moonAvoidanceEnabled,
    ),
    moonMustBeDown: conditionShape.moonMustBeDown.default(DEFAULT_CONDITIONS.moonMustBeDown),
    moonSeparationDeg: conditionShape.moonSeparationDeg.default(
      DEFAULT_CONDITIONS.moonSeparationDeg,
    ),
    moonWidthDays: conditionShape.moonWidthDays.default(DEFAULT_CONDITIONS.moonWidthDays),
    moonRelaxScale: conditionShape.moonRelaxScale.default(DEFAULT_CONDITIONS.moonRelaxScale),
    moonMinAltDeg: conditionShape.moonMinAltDeg.default(DEFAULT_CONDITIONS.moonMinAltDeg),
    moonMaxAltDeg: conditionShape.moonMaxAltDeg.default(DEFAULT_CONDITIONS.moonMaxAltDeg),
    moonMaxIlluminationPct: conditionShape.moonMaxIlluminationPct.default(
      DEFAULT_CONDITIONS.moonMaxIlluminationPct,
    ),
  })
  .strict();

/**
 * Vollständige Bedingungen ohne Standardwerte – Wert der Einstellung `project.defaultConditions`
 * („Als Standard setzen“, FA-PRJ-04: Vorbelegung neuer Projekte je Mitglied).
 */
export const ConditionsValue = z.object(conditionShape).strict();

/** Teiländerung der Bedingungen – **ohne** Standardwerte, sonst setzte ein Patch alle übrigen zurück. */
const ConditionsPatch = z.object(conditionShape).partial().strict();

const projectFields = {
  name: z.string().trim().min(1).max(200),
  /** Wunsch-Rig vor der Freigabe bzw. Rig freigegebener Projekte. */
  rigId: Uuid.nullable().default(null),
  targetName: text(200).nullable().default(null),
  targetType: text(40).nullable().default(null),
  catalogNames: text(500).default(''),
  descriptionMd: text(20000).default(''),
  /** J2000, Grad; `null` = noch nicht gesetzt (Entwurf). */
  raDeg: z.number().min(0).lt(360).nullable().default(null),
  decDeg: z.number().min(-90).max(90).nullable().default(null),
  rotationDeg: z.number().min(0).lt(360).default(0),
  startDate: NightKey.nullable().default(null),
  dueDate: NightKey.nullable().default(null),
  requestPeriodFrom: NightKey.nullable().default(null),
  requestPeriodTo: NightKey.nullable().default(null),
  requestComment: text(4000).nullable().default(null),
};

export const ProjectCreate = z
  .object({
    id: Uuid,
    ...projectFields,
    conditions: ProjectConditions.default(ProjectConditions.parse({})),
  })
  .strict()
  .meta({ id: 'ProjectCreate' });
export type ProjectCreate = z.infer<typeof ProjectCreate>;

/**
 * Teiländerung mit `If-Match: "<version>"` (412 bei Konflikt). Ein Rig-Wechsel freigegebener Projekte
 * mit Konflikten verlangt `acceptRigConflicts: true` (FA-RIG-12), sonst `409 approval.rig_conflict`
 * bzw. `409 rig.change_has_captures` mit Konfliktliste in `errors[]`.
 */
export const ProjectPatch = z
  .object({
    name: projectFields.name.optional(),
    rigId: Uuid.nullable().optional(),
    targetName: text(200).nullable().optional(),
    targetType: text(40).nullable().optional(),
    catalogNames: text(500).optional(),
    descriptionMd: text(20000).optional(),
    raDeg: z.number().min(0).lt(360).nullable().optional(),
    decDeg: z.number().min(-90).max(90).nullable().optional(),
    rotationDeg: z.number().min(0).lt(360).optional(),
    startDate: NightKey.nullable().optional(),
    dueDate: NightKey.nullable().optional(),
    requestPeriodFrom: NightKey.nullable().optional(),
    requestPeriodTo: NightKey.nullable().optional(),
    requestComment: text(4000).nullable().optional(),
    conditions: ConditionsPatch.optional(),
    acceptRigConflicts: z.boolean().optional(),
  })
  .strict()
  .meta({ id: 'ProjectPatch' });
export type ProjectPatch = z.infer<typeof ProjectPatch>;

export const PanelInput = z
  .object({
    label: z.string().trim().min(1).max(60).default('Main'),
    raDeg: z.number().min(0).lt(360),
    decDeg: z.number().min(-90).max(90),
    rotationDeg: z.number().min(0).lt(360).default(0),
    notes: text(4000).default(''),
  })
  .strict();
export const PanelCreate = PanelInput.extend({ id: Uuid }).meta({ id: 'PanelCreate' });
export const PanelPatch = z
  .object({
    label: z.string().trim().min(1).max(60),
    raDeg: z.number().min(0).lt(360),
    decDeg: z.number().min(-90).max(90),
    rotationDeg: z.number().min(0).lt(360),
    notes: text(4000),
  })
  .partial()
  .strict()
  .meta({ id: 'PanelPatch' });

const lineShape = {
  filterId: Uuid,
  exposureS: z.number().positive().max(7200),
  plannedCount: z.number().int().min(0).max(100000),
  /** `null` = NINA-Standard (NT-38). */
  gain: nullableInt,
  offsetAdu: nullableInt,
  binning: z.number().int().min(1).max(4),
  /** Exakt wie im Treiber; `null` = Standard der Kamera. */
  readoutMode: z.string().max(60).nullable(),
  moonMode: z.enum(moonModes),
  moonProfileId: Uuid.nullable(),
  enabled: z.boolean(),
  notes: text(4000),
};

const lineFields = z
  .object({
    ...lineShape,
    gain: lineShape.gain.default(null),
    offsetAdu: lineShape.offsetAdu.default(null),
    binning: lineShape.binning.default(1),
    readoutMode: lineShape.readoutMode.default(null),
    moonMode: lineShape.moonMode.default('project_default'),
    moonProfileId: lineShape.moonProfileId.default(null),
    enabled: lineShape.enabled.default(true),
    notes: lineShape.notes.default(''),
  })
  .strict();

const moonProfileNeeded = (l: { moonMode?: string; moonProfileId?: string | null }) =>
  l.moonMode !== 'profile' || (l.moonProfileId ?? null) !== null;

export const LineCreate = lineFields
  .extend({ id: Uuid, panelId: Uuid })
  .refine(moonProfileNeeded, { path: ['moonProfileId'], message: 'Mondprofil fehlt' })
  .meta({ id: 'LineCreate' });
export type LineCreate = z.infer<typeof LineCreate>;

/** Mit Aufnahmen sind Filter, Belichtung, Gain, Offset, Binning, Auslesemodus gesperrt (NT-E3). */
export const LinePatch = z
  .object(lineShape)
  .partial()
  .strict()
  .refine(moonProfileNeeded, { path: ['moonProfileId'], message: 'Mondprofil fehlt' })
  .meta({ id: 'LinePatch' });
export type LinePatch = z.infer<typeof LinePatch>;

/** Felder, die eine Zeile mit Aufnahmen nicht mehr ändern darf (NT-E3, `409 line.locked_by_captures`). */
export const LINE_LOCKED_FIELDS = [
  'filterId',
  'exposureS',
  'gain',
  'offsetAdu',
  'binning',
  'readoutMode',
] as const;

export const LineDuplicate = z
  .object({ id: Uuid, deactivateSource: z.boolean().default(false) })
  .strict()
  .meta({ id: 'LineDuplicate' });

export const ApplyTemplate = z
  .object({
    templateId: Uuid,
    /** Ohne Angabe: auf alle Panels (FA-PRJ-05 „Auf alle Panels kopieren“). */
    panelId: Uuid.nullable().default(null),
    /** Bestehende Zeilen ohne Aufnahmen vorher entfernen. */
    replace: z.boolean().default(true),
  })
  .strict()
  .meta({ id: 'ApplyTemplate' });

export const ProjectDuplicate = z
  .object({
    id: Uuid,
    name: z.string().trim().min(1).max(200).optional(),
    rigId: Uuid.nullable().optional(),
  })
  .strict()
  .meta({ id: 'ProjectDuplicate' });

export const StatusChange = z
  .object({ status: z.enum(projectStatuses) })
  .strict()
  .meta({ id: 'StatusChange' });

export const PriorityChange = z
  .object({ position: z.number().int().min(1) })
  .strict()
  .meta({ id: 'PriorityChange' });

export const NoteCreate = z
  .object({ bodyMd: z.string().trim().min(1).max(20000) })
  .strict()
  .meta({ id: 'NoteCreate' });

export const RigCheck = z.object({ rigId: Uuid }).strict().meta({ id: 'RigCheck' });

// ---- Ansichten ------------------------------------------------------------------------------------

export const LineCountersView = z.object({
  planned: z.number().int(),
  acquired: z.number().int(),
  rejected: z.number().int(),
  accepted: z.number().int(),
  remaining: z.number().int(),
  planningNeed: z.number().int(),
  bonus: z.number().int(),
  bonusRejected: z.number().int(),
  percentDone: z.number(),
  integrationS: z.number(),
});

export const LineView = z
  .object({
    id: Uuid,
    panelId: Uuid,
    filterId: Uuid.nullable(),
    filterShortName: z.string(),
    exposureS: z.number(),
    plannedCount: z.number().int(),
    gain: z.number().int().nullable(),
    offsetAdu: z.number().int().nullable(),
    binning: z.number().int(),
    readoutMode: z.string().nullable(),
    moonMode: z.enum(moonModes),
    moonProfileId: Uuid.nullable(),
    enabled: z.boolean(),
    orderIndex: z.number().int(),
    notes: z.string(),
    /** Aufnahmen vorhanden → gesperrte Felder (NT-E3). */
    hasCaptures: z.boolean(),
    counters: LineCountersView,
  })
  .meta({ id: 'LineView' });

export const PanelView = z
  .object({
    id: Uuid,
    panelIndex: z.number().int(),
    label: z.string(),
    raDeg: z.number(),
    decDeg: z.number(),
    rotationDeg: z.number(),
    notes: z.string(),
    lines: z.array(LineView),
  })
  .meta({ id: 'PanelView' });

export const ProgressView = z.object({
  targetReached: z.boolean(),
  finished: z.boolean(),
  planningNeed: z.number().int(),
  percentDone: z.number(),
  plannedS: z.number(),
  integrationS: z.number(),
});

export const ProjectView = z
  .object({
    id: Uuid,
    name: z.string(),
    projectType: z.enum(['deep_sky', 'exoplanet']),
    rigId: Uuid.nullable(),
    createdBy: Uuid,
    targetName: z.string().nullable(),
    targetType: z.string().nullable(),
    catalogNames: z.string(),
    descriptionMd: z.string(),
    raDeg: z.number().nullable(),
    decDeg: z.number().nullable(),
    rotationDeg: z.number(),
    startDate: NightKey.nullable(),
    dueDate: NightKey.nullable(),
    requestPeriodFrom: NightKey.nullable(),
    requestPeriodTo: NightKey.nullable(),
    requestComment: z.string().nullable(),
    conditions: ProjectConditions,
    approvalStatus: z.enum(approvalStatuses),
    status: z.enum(projectStatuses).nullable(),
    priority: z.number().int(),
    effortStale: z.boolean(),
    favorite: z.boolean(),
    version: z.number().int(),
    deletedAt: UtcInstant.nullable(),
    createdAt: UtcInstant,
    updatedAt: UtcInstant,
    progress: ProgressView,
    panels: z.array(PanelView),
  })
  .meta({ id: 'ProjectView' });

export const ProjectListItem = ProjectView.omit({ panels: true, descriptionMd: true }).meta({
  id: 'ProjectListItem',
});

export const ProjectListQuery = z.object({
  deleted: z.enum(['true', 'false']).optional(),
  rigId: Uuid.optional(),
  status: z.enum(projectStatuses).optional(),
  approvalStatus: z.enum(approvalStatuses).optional(),
  mine: z.enum(['true', 'false']).optional(),
  favorites: z.enum(['true', 'false']).optional(),
});

export const NoteView = z
  .object({
    id: Uuid,
    userId: Uuid,
    authorName: z.string(),
    bodyMd: z.string(),
    createdAt: UtcInstant,
  })
  .meta({ id: 'NoteView' });

export const HistoryEntry = z
  .object({
    kind: z.enum(['approval', 'change']),
    action: z.string(),
    userId: Uuid.nullable(),
    userName: z.string().nullable(),
    entity: z.string(),
    detail: z.unknown(),
    comment: z.string().nullable(),
    createdAt: UtcInstant,
  })
  .meta({ id: 'HistoryEntry' });

export const RigConflict = z.object({
  /** `filter_not_in_wheel`, `filter_unconfirmed`, `binning_unsupported`, `readout_unsupported`, `fov_changed`, `optics_changed_with_captures`. */
  code: z.string(),
  lineId: Uuid.nullable(),
  detail: z.string(),
});
export const RigCheckView = z
  .object({ conflicts: z.array(RigConflict), hasCaptures: z.boolean(), opticsChanged: z.boolean() })
  .meta({ id: 'RigCheckView' });
