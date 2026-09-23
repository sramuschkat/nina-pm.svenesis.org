/** Einstieg für Handler: öffnet die Datenbank und liefert Repositories je Mandantenkontext. */
import type { Kysely } from 'kysely';
import { createDb, createPool, type DbConfig } from '../connection';
import type { Database } from '../types';
import type { TenantContext } from './base';

export type { AppDbRole, DbConfig } from '../connection';
import { JobQueue, JobRepository } from './job';
import { TenantRepository } from './tenant';

export interface OpenDatabase {
  readonly db: Kysely<Database>;
  repositories(ctx: TenantContext): { tenant: TenantRepository; job: JobRepository };
  /** Warteschlange des `worker` über alle Mandanten (TK 7.4). */
  jobQueue(): JobQueue;
  close(): Promise<void>;
}

export function openDatabase(config: DbConfig, onError?: (error: Error) => void): OpenDatabase {
  const db = createDb(createPool(config, onError));
  return {
    db,
    repositories: (ctx) => ({
      tenant: new TenantRepository(db, ctx),
      job: new JobRepository(db, ctx),
    }),
    jobQueue: () => new JobQueue(db),
    close: () => db.destroy(),
  };
}
