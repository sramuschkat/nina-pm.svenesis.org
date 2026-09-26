import type {
  AuditRepository,
  AuthRepository,
  EnqueueInput,
  EnqueueResult,
  EquipmentRepository,
  ApprovalRepository,
  ProjectRepository,
  SimulationRepository,
  NinaInstanceRepository,
  NinaRigRepository,
  NinaSessionRepository,
  NinaIngestRepository,
  SessionReviewRepository,
  SessionLogRepository,
  ChangeRequestRepository,
  NinaPrincipal,
  Job,
  MemberRepository,
  NotificationRepository,
  PreferenceRepository,
  SystemActor,
  TenantAdminRepository,
  TenantContext,
  TenantRepository,
} from '@nina-pm/db';
import type { AuthConfig } from '../auth/config';
import type { DiscordClient } from '../auth/discord';
import type { DownloadSigner } from '../files/download';
import type { TenantFileStore } from '../files/tenant-files';
import type { JobInvoker } from '../jobs/enqueue';

/** Was die Routen von der Datenbank brauchen – im Test auf PGlite bzw. durch Fälschungen ersetzbar. */
export interface ApiRepositories {
  readonly job: {
    byId(id: string): Promise<Job | undefined>;
    enqueue(input: EnqueueInput): Promise<EnqueueResult>;
  };
  readonly member: MemberRepository;
  preference(): PreferenceRepository;
  notification(): NotificationRepository;
  audit(): AuditRepository;
  equipment(): EquipmentRepository;
  projects(): ProjectRepository;
  approvals(): ApprovalRepository;
  simulations(): SimulationRepository;
  ninaInstances(): NinaInstanceRepository;
  ninaRig(rigId: string): NinaRigRepository;
  ninaSession(rigId: string, instanceId: string): NinaSessionRepository;
  ninaIngest(rigId: string): NinaIngestRepository;
  sessionReview(): SessionReviewRepository;
  sessionLog(): SessionLogRepository;
  changeRequests(): ChangeRequestRepository;
  tenant(): TenantRepository;
}

/** Dienste der Lambda `api`, einmal je Container erzeugt (DB-Pool, S3, Lambda, SSM). */
export interface ApiServices {
  repositories(ctx: TenantContext): ApiRepositories;
  /** Systemverwaltung im System-Kontext (TK 5.4). */
  tenantAdmin(actor: SystemActor): TenantAdminRepository;
  /** Anmeldung und Sitzungen (an Sitzung/Identität gebunden, TK 5.3). */
  readonly auth: AuthRepository;
  readonly authConfig: AuthConfig;
  readonly discord: DiscordClient;
  readonly downloads: DownloadSigner;
  /** Dateien eines gelöschten Mandanten (FA-MAN-03). */
  readonly tenantFiles: TenantFileStore;
  /** Aktiver Wartungshinweis für alle (FA-SU-08). */
  maintenanceBanner(): Promise<{ de: string; en: string } | null>;
  readonly jobInvoker: JobInvoker;
  /** Presigned POST für Dateien, die das Plugin hochlädt (Planprotokoll, SEC-23). */
  readonly uploads: {
    planLog(
      tenantId: string,
      sessionId: string,
    ): Promise<{ url: string; fields: Record<string, string> }>;
  };
  /** Ergebnisse von `multi_sim`/`impact` aus S3 lesen (`tenant/<tid>/jobs/…`); `null`, wenn fehlend. */
  readonly jobResults: { get(key: string): Promise<unknown> };
  /** Datenbank für Mehrzeilen-Vorgänge außerhalb eines Repositories (Korrektur, Zuordnung, Lease). */
  readonly db: import('@nina-pm/db').OpenDatabase['db'];
  /** Token-Suche der NINA-API über alle Mandanten (TK 5.6, kein Cache). */
  readonly nina: {
    lookup(tokenHash: string): Promise<NinaPrincipal | undefined>;
    touch(p: NinaPrincipal, now: Date): Promise<void>;
  };
  now(): Date;
}
