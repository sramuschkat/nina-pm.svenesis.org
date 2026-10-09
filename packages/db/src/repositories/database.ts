/** Einstieg für Handler: öffnet die Datenbank und liefert Repositories je Mandantenkontext. */
import { SessionReviewRepository } from './session-review';
import { SessionLogRepository } from './session-log';
import { ChangeRequestRepository } from './change-request';
import type { Kysely } from 'kysely';
import { createDb, createPool, type DbConfig } from '../connection';
import type { Database } from '../types';
import type { TenantContext } from './base';

export type { AppDbRole, DbConfig } from '../connection';
import { AuthRepository } from './auth';
import { DiscordRepository } from './discord';
import { JobQueue, JobRepository } from './job';
import { MemberRepository } from './member';
import { AuditRepository } from './audit';
import { EquipmentRepository } from './equipment';
import { ProjectRepository } from './project';
import { ExoProjectRepository } from './exo-project';
import { TransitRepository } from './transit';
import { ApprovalRepository } from './approval';
import { EffortRepository } from './effort';
import { SimulationRepository } from './simulation';
import { NinaInstanceRepository, NinaRigRepository } from './nina';
import { NinaIngestRepository } from './nina-ingest';
import { NinaSessionRepository } from './nina-session';
import { NotificationRepository } from './notification';
import { PreferenceRepository } from './preference';
import { TenantAdminRepository, type SystemActor } from './tenant-admin';
import { TenantRepository } from './tenant';
import { ImageQualityRepository } from './image-quality';
import { RigTelemetryRepository } from './rig-telemetry';

export interface OpenDatabase {
  readonly db: Kysely<Database>;
  repositories(ctx: TenantContext): {
    tenant: TenantRepository;
    job: JobRepository;
    member: MemberRepository;
    preference: () => PreferenceRepository;
    notification: () => NotificationRepository;
    audit: () => AuditRepository;
    equipment: () => EquipmentRepository;
    projects: () => ProjectRepository;
    approvals: () => ApprovalRepository;
    effort: () => EffortRepository;
    simulations: () => SimulationRepository;
    ninaInstances: () => NinaInstanceRepository;
    ninaRig: (rigId: string) => NinaRigRepository;
    ninaSession: (rigId: string, instanceId: string) => NinaSessionRepository;
    ninaIngest: (rigId: string) => NinaIngestRepository;
    sessionReview: () => SessionReviewRepository;
    sessionLog: () => SessionLogRepository;
    changeRequests: () => ChangeRequestRepository;
    exoProjects: () => ExoProjectRepository;
    transits: () => TransitRepository;
    discord: () => DiscordRepository;
    telemetry: () => RigTelemetryRepository;
    imageQuality: () => ImageQualityRepository;
  };
  /** Systemverwaltung (Super User bzw. ops-cli, TK 5.4). */
  tenantAdmin(actor: SystemActor): TenantAdminRepository;
  /** Warteschlange des `worker` über alle Mandanten (TK 7.4). */
  jobQueue(): JobQueue;
  /** Anmeldung und Sitzungen – an Sitzung/Identität gebunden (TK 5.3). */
  auth(): AuthRepository;
  close(): Promise<void>;
}

export function openDatabase(config: DbConfig, onError?: (error: Error) => void): OpenDatabase {
  const db = createDb(createPool(config, onError));
  return {
    db,
    repositories: (ctx) => ({
      tenant: new TenantRepository(db, ctx),
      job: new JobRepository(db, ctx),
      member: new MemberRepository(db, ctx),
      preference: () => new PreferenceRepository(db, ctx),
      notification: () => new NotificationRepository(db, ctx),
      audit: () => new AuditRepository(db, ctx),
      equipment: () => new EquipmentRepository(db, ctx),
      projects: () => new ProjectRepository(db, ctx),
      approvals: () => new ApprovalRepository(db, ctx),
      effort: () => new EffortRepository(db, ctx),
      simulations: () => new SimulationRepository(db, ctx),
      ninaInstances: () => new NinaInstanceRepository(db, ctx),
      ninaRig: (rigId) => new NinaRigRepository(db, ctx, rigId),
      ninaSession: (rigId, instanceId) => new NinaSessionRepository(db, ctx, rigId, instanceId),
      ninaIngest: (rigId) => new NinaIngestRepository(db, ctx, rigId),
      sessionReview: () => new SessionReviewRepository(db, ctx),
      sessionLog: () => new SessionLogRepository(db, ctx),
      changeRequests: () => new ChangeRequestRepository(db, ctx),
      exoProjects: () => new ExoProjectRepository(db, ctx),
      transits: () => new TransitRepository(db, ctx),
      discord: () => new DiscordRepository(db, ctx),
      telemetry: () => new RigTelemetryRepository(db, ctx),
      imageQuality: () => new ImageQualityRepository(db, ctx),
    }),
    tenantAdmin: (actor) => new TenantAdminRepository(db, actor),
    jobQueue: () => new JobQueue(db),
    auth: () => new AuthRepository(db),
    close: () => db.destroy(),
  };
}
