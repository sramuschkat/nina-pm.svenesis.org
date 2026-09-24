/** Einstieg für Handler: öffnet die Datenbank und liefert Repositories je Mandantenkontext. */
import type { Kysely } from 'kysely';
import { createDb, createPool, type DbConfig } from '../connection';
import type { Database } from '../types';
import type { TenantContext } from './base';

export type { AppDbRole, DbConfig } from '../connection';
import { AuthRepository } from './auth';
import { JobQueue, JobRepository } from './job';
import { MemberRepository } from './member';
import { AuditRepository } from './audit';
import { EquipmentRepository } from './equipment';
import { ProjectRepository } from './project';
import { NotificationRepository } from './notification';
import { PreferenceRepository } from './preference';
import { TenantAdminRepository, type SystemActor } from './tenant-admin';
import { TenantRepository } from './tenant';

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
    }),
    tenantAdmin: (actor) => new TenantAdminRepository(db, actor),
    jobQueue: () => new JobQueue(db),
    auth: () => new AuthRepository(db),
    close: () => db.destroy(),
  };
}
