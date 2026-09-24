import type {
  AuditRepository,
  AuthRepository,
  EnqueueInput,
  EnqueueResult,
  EquipmentRepository,
  ApprovalRepository,
  ProjectRepository,
  SimulationRepository,
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
  now(): Date;
}
