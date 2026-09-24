/**
 * Kysely-Typen (CamelCasePlugin: Spalten in TS camelCase, in der DB snake_case, TK 3.2).
 * Stand AP-05: nur die Tabellen, die die bisherigen Repositories und Tests brauchen. Die übrigen Tabellen
 * kommen mit ihren fachlichen Repositories (ab AP-04a); Quelle sind die Migrationen.
 */
import type { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export interface TenantTable {
  id: Generated<string>;
  tenantKey: string;
  displayName: string;
  contact: string | null;
  status: Generated<'active' | 'locked'>;
  settings: Generated<Record<string, unknown>>;
  ownerMemberId: string | null;
  discordGuildName: string | null;
  discordGuildId: string | null;
  discordInviteUrl: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface IdentityTable {
  id: Generated<string>;
  discordUserId: string;
  discordUsername: string;
  discordGlobalName: string | null;
  avatarHash: string | null;
  email: string | null;
  mfaEnabled: Generated<boolean>;
  status: Generated<'active' | 'blocked'>;
  lastLoginAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface SuperUserTable {
  identityId: string;
  status: Generated<'active' | 'disabled'>;
  createdBy: string | null;
  createdAt: Timestamp;
}

export interface AppUserTable {
  id: Generated<string>;
  tenantId: string;
  identityId: string;
  displayName: string;
  role: 'admin' | 'user';
  status: Generated<'active' | 'disabled' | 'removed'>;
  invitedBy: string | null;
  lastLoginAt: Timestamp | null;
  allowedRigIds: unknown;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface SchemaMigrationTable {
  id: string;
  checksum: string;
  appliedAt: Timestamp;
}

export interface AuthSessionTable {
  id: Generated<string>;
  sessionHash: string;
  identityId: string;
  tenantId: string | null;
  context: 'tenant' | 'system' | 'select';
  userAgent: string | null;
  ipTruncated: string | null;
  createdAt: Timestamp;
  lastSeenAt: Timestamp;
  expiresAt: Timestamp;
}

export interface InvitationTable {
  id: Generated<string>;
  tenantId: string;
  tokenHash: string;
  role: 'owner' | 'admin' | 'user';
  discordUserId: string | null;
  note: string | null;
  maxUses: Generated<number>;
  usedCount: Generated<number>;
  expiresAt: Timestamp;
  createdByMember: string | null;
  createdBySuper: string | null;
  revokedAt: Timestamp | null;
  createdAt: Timestamp;
}

export interface SystemAuditTable {
  id: Generated<string>;
  actor: 'super_user' | 'ops_cli';
  superUserId: string | null;
  tenantId: string | null;
  action: string;
  details: ColumnType<unknown, string | undefined, string>;
  createdAt: Timestamp;
}

export interface SystemSettingTable {
  key: string;
  value: ColumnType<unknown, string, string>;
  updatedBy: string | null;
  updatedAt: Timestamp;
}

export interface TenantStorageTable {
  tenantId: string;
  fileBytes: ColumnType<string, number | bigint | string, number | bigint | string>;
  fileCount: number;
  measuredAt: Timestamp;
}

/** jsonb: gelesen als Objekt, geschrieben als JSON-Zeichenkette. */
type Json = ColumnType<unknown, string | undefined, string>;

/** `date`-Spalten (Nacht-Schlüssel, NT-04): als `YYYY-MM-DD` gelesen (Typ-Parser in connection.ts), geschrieben als Zeichenkette. */
type DateKey = ColumnType<string, string, string>;

export interface SiteTable {
  id: Generated<string>;
  tenantId: string;
  name: string;
  pierName: string | null;
  observatoryType: Generated<string>;
  latitudeDeg: number;
  longitudeDeg: number;
  elevationM: Generated<number>;
  bortleClass: number | null;
  timeZone: string;
  weatherSafetyUrl: string | null;
  notes: Generated<string>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface SiteLinkTable {
  id: Generated<string>;
  tenantId: string;
  siteId: string;
  serviceType: string;
  name: string;
  remoteIdOrUrl: string;
  notes: Generated<string>;
  isDefault: Generated<boolean>;
  createdAt: Timestamp;
}

export interface TelescopeTable {
  id: Generated<string>;
  tenantId: string;
  name: string;
  brand: Generated<string>;
  model: Generated<string>;
  opticalDesign: string;
  apertureMm: number;
  focalLengthMm: number;
  reducerFactor: Generated<number>;
  obstructionPct: Generated<number>;
  imageCircleMm: number | null;
  backfocusMm: number | null;
  spotAxisUm: number | null;
  spotEdgeUm: number | null;
  weightKg: number | null;
  lengthMm: number | null;
  focuserTravelMm: number | null;
  focuserMmPerTurn: number | null;
  notes: Generated<string>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CameraTable {
  id: Generated<string>;
  tenantId: string;
  name: string;
  brand: Generated<string>;
  model: Generated<string>;
  sensorName: Generated<string>;
  widthPx: number;
  heightPx: number;
  pixelSizeUm: number;
  bitDepth: Generated<number>;
  isCooled: Generated<boolean>;
  coolingSetpointC: number | null;
  coolingToleranceC: Generated<number>;
  isColor: Generated<boolean>;
  readNoiseE: number | null;
  fullWellE: number | null;
  quantumEfficiencyPct: number | null;
  /**
   * `gain_e_per_adu` und `dark_current_e_s_20c`: Das CamelCasePlugin bildet keinen camelCase-Namen auf
   * sie ab (Großbuchstabenfolge bzw. Ziffer nach Unterstrich). Geschrieben wird daher unter dem
   * Spaltennamen selbst, gelesen kommen sie als `gainEPerAdu` bzw. `darkCurrentES20c` zurück
   * (repositories/equipment.ts).
   */
  gain_e_per_adu: number | null;
  dark_current_e_s_20c: number | null;
  defaultGain: number | null;
  defaultOffset: number | null;
  defaultBinning: Generated<number>;
  defaultReadoutMode: Generated<string>;
  supportedBinning: Json;
  gainModes: Json;
  readoutModes: Json;
  ninaReported: Json | null;
  ninaReportDismissedHash: string | null;
  notes: Generated<string>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface FilterTable {
  id: Generated<string>;
  tenantId: string;
  telescopeId: string | null;
  shortName: string;
  fullName: Generated<string>;
  brand: Generated<string>;
  filterType: string;
  size: string | null;
  shape: string | null;
  mountType: string | null;
  bandwidthNm: number | null;
  centerWavelengthNm: number | null;
  photometricBand: Generated<string>;
  transmissionPct: number | null;
  thicknessMm: number | null;
  colorHex: Generated<string>;
  defaultOnNewProject: Generated<boolean>;
  defaultExposureS: number | null;
  defaultMoonProfileId: string | null;
  notes: Generated<string>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ExposureTemplateTable {
  id: Generated<string>;
  tenantId: string;
  name: string;
  telescopeId: string | null;
  cameraId: string | null;
  notes: Generated<string>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ExposureTemplateLineTable {
  id: Generated<string>;
  tenantId: string;
  templateId: string;
  filterId: string | null;
  filterShortName: string;
  exposureS: number;
  plannedCount: number;
  gain: number | null;
  offsetAdu: number | null;
  binning: Generated<number>;
  readoutMode: string | null;
  moonMode: Generated<string>;
  moonProfileId: string | null;
  enabled: Generated<boolean>;
  orderIndex: Generated<number>;
}

export interface RigTable {
  id: Generated<string>;
  tenantId: string;
  name: string;
  siteId: string;
  telescopeId: string;
  cameraId: string;
  showInPlanning: Generated<boolean>;
  ninaDeliveryEnabled: Generated<boolean>;
  filterWheel: Json;
  ninaFilterWheel: Json | null;
  defaultTemplateId: string | null;
  defaultRotationDeg: number | null;
  hasRotator: Generated<boolean>;
  rotationToleranceDeg: Generated<number>;
  skipOnRotationMismatch: Generated<boolean>;
  sessionReportDiscord: Generated<boolean>;
  strategy: Generated<string>;
  playback: Generated<string>;
  sortChain: Json;
  bonusEnabled: Generated<boolean>;
  overshootPct: Generated<number>;
  mosaicPanelsIndependent: Generated<boolean>;
  ditherEnabled: Generated<boolean>;
  ditherEvery: Generated<number>;
  filterSwitchEnabled: Generated<boolean>;
  filterSwitchEvery: Generated<number>;
  filterSwitchTolerancePct: Generated<number>;
  flatsEnabled: Generated<boolean>;
  flatsFullSet: Generated<boolean>;
  flatCount: Generated<number>;
  darkFlatsEnabled: Generated<boolean>;
  darkFlatCount: number | null;
  flatsSource: Generated<string>;
  flipEnabled: Generated<boolean>;
  flipAfterMeridianMin: Generated<number>;
  flipMaxAfterMeridianMin: Generated<number>;
  flipPauseBeforeMeridianMin: Generated<number>;
  flipDurationS: Generated<number>;
  overhead: Json;
  settingsVersion: Generated<number>;
  notes: Generated<string>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ProjectTable {
  id: Generated<string>;
  tenantId: string;
  rigId: string | null;
  requestedRigId: string | null;
  createdBy: string;
  projectType: Generated<'deep_sky' | 'exoplanet'>;
  name: string;
  targetName: string | null;
  targetType: string | null;
  dsoObjectId: string | null;
  catalogNames: Generated<string>;
  descriptionMd: Generated<string>;
  raDeg: number | null;
  decDeg: number | null;
  rotationDeg: Generated<number>;
  panelRows: Generated<number>;
  panelColumns: Generated<number>;
  panelOverlapPct: Generated<number>;
  minAltitudeDeg: Generated<number>;
  minTimeOnTargetH: Generated<number>;
  twilight: Generated<string>;
  moonAvoidanceEnabled: Generated<boolean>;
  moonMustBeDown: Generated<boolean>;
  moonSeparationDeg: Generated<number>;
  moonWidthDays: Generated<number>;
  moonRelaxScale: Generated<number>;
  moonMinAltDeg: Generated<number>;
  moonMaxAltDeg: Generated<number>;
  moonMaxIlluminationPct: Generated<number>;
  approvalStatus: Generated<string>;
  status: string | null;
  priority: Generated<number>;
  requestPeriodFrom: DateKey | null;
  requestPeriodTo: DateKey | null;
  submitterRank: number | null;
  contentChangedAt: Timestamp | null;
  effortStale: Generated<boolean>;
  requestComment: string | null;
  startDate: DateKey | null;
  dueDate: DateKey | null;
  completedAt: Timestamp | null;
  notesMd: Generated<string>;
  version: Generated<number>;
  deletedAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface FavoriteTable {
  tenantId: string;
  userId: string;
  projectId: string;
  createdAt: Timestamp;
}

export interface ProjectPanelTable {
  id: Generated<string>;
  tenantId: string;
  projectId: string;
  panelIndex: number;
  label: Generated<string>;
  raDeg: number;
  decDeg: number;
  rotationDeg: Generated<number>;
  notes: Generated<string>;
  deletedAt: Timestamp | null;
}

export interface ExposureLineTable {
  id: Generated<string>;
  tenantId: string;
  projectId: string;
  panelId: string;
  filterId: string | null;
  filterShortName: string;
  exposureS: number;
  plannedCount: number;
  gain: number | null;
  offsetAdu: number | null;
  binning: Generated<number>;
  readoutMode: string;
  moonMode: Generated<string>;
  moonProfileId: string | null;
  enabled: Generated<boolean>;
  disabledForNight: DateKey | null;
  orderIndex: Generated<number>;
  acquiredCount: Generated<number>;
  rejectedCount: Generated<number>;
  bonusCount: Generated<number>;
  bonusRejectedCount: Generated<number>;
  deletedAt: Timestamp | null;
  notes: Generated<string>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ProjectNoteTable {
  id: Generated<string>;
  tenantId: string;
  projectId: string;
  userId: string;
  sessionId: string | null;
  bodyMd: string;
  createdAt: Timestamp;
}

export interface ApprovalEventTable {
  id: Generated<string>;
  tenantId: string;
  projectId: string;
  userId: string | null;
  action: string;
  comment: string | null;
  snapshot: Json | null;
  createdAt: Timestamp;
}

export interface QueueVoteTable {
  tenantId: string;
  subjectKind: string;
  subjectId: string;
  projectId: string;
  voterId: string;
  createdAt: Timestamp;
  acknowledgedAt: Timestamp;
}

export interface CaptureNightTable {
  tenantId: string;
  exposureLineId: string;
  night: DateKey;
  projectId: string;
  acquiredCount: Generated<number>;
  rejectedIndividual: Generated<number>;
  rejectedCorrection: Generated<number>;
  rejectedCount: Generated<number>;
  bonusCount: Generated<number>;
  bonusRejectedCount: Generated<number>;
  integrationS: Generated<number>;
  sources: Json;
  updatedAt: Timestamp;
}

export interface NotificationTable {
  id: Generated<string>;
  tenantId: string | null;
  recipientId: string | null;
  recipientIdentityId: string | null;
  kind: string;
  projectId: string | null;
  payload: ColumnType<unknown, string | undefined, string>;
  readAt: Timestamp | null;
  createdAt: Timestamp;
}

export interface ChangeLogTable {
  id: Generated<string>;
  tenantId: string;
  entity: string;
  entityId: string;
  userId: string | null;
  action: string;
  diff: ColumnType<unknown, string | undefined, string>;
  createdAt: Timestamp;
}

export interface MoonProfileTable {
  id: Generated<string>;
  tenantId: string;
  name: string;
  description: Generated<string>;
  separationDeg: number;
  widthDays: number;
  relaxScale: number;
  moonMinAltDeg: number;
  moonMaxAltDeg: number;
  maxIlluminationPct: number;
  moonMustBeDown: Generated<boolean>;
  isBuiltIn: Generated<boolean>;
  createdAt: Timestamp;
}

export interface UserPreferenceTable {
  tenantId: string;
  userId: string;
  prefKey: string;
  value: ColumnType<unknown, string, string>;
  updatedAt: Timestamp;
}

export type JobStatusValue = 'pending' | 'running' | 'done' | 'failed';

/** Tabelle `job` (Migration 0005, TK 7.4). `input` ist jsonb und wird als JSON-Text geschrieben. */
export interface JobTable {
  id: Generated<string>;
  tenantId: string | null;
  kind: string;
  status: Generated<JobStatusValue>;
  dedupeKey: string | null;
  dedupeActive: string | null;
  input: ColumnType<unknown, string | undefined, string>;
  resultS3Key: string | null;
  error: string | null;
  attempts: Generated<number>;
  runAfter: Timestamp;
  startedAt: Timestamp | null;
  finishedAt: Timestamp | null;
  createdBy: string | null;
  createdAt: Timestamp;
}

export interface Database {
  tenant: TenantTable;
  identity: IdentityTable;
  superUser: SuperUserTable;
  appUser: AppUserTable;
  schemaMigration: SchemaMigrationTable;
  job: JobTable;
  authSession: AuthSessionTable;
  invitation: InvitationTable;
  systemAudit: SystemAuditTable;
  systemSetting: SystemSettingTable;
  tenantStorage: TenantStorageTable;
  notification: NotificationTable;
  changeLog: ChangeLogTable;
  moonProfile: MoonProfileTable;
  site: SiteTable;
  siteLink: SiteLinkTable;
  telescope: TelescopeTable;
  camera: CameraTable;
  filter: FilterTable;
  exposureTemplate: ExposureTemplateTable;
  exposureTemplateLine: ExposureTemplateLineTable;
  rig: RigTable;
  project: ProjectTable;
  favorite: FavoriteTable;
  projectPanel: ProjectPanelTable;
  exposureLine: ExposureLineTable;
  projectNote: ProjectNoteTable;
  approvalEvent: ApprovalEventTable;
  queueVote: QueueVoteTable;
  captureNight: CaptureNightTable;
  userPreference: UserPreferenceTable;
}
