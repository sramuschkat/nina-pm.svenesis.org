import type { EnqueueInput, EnqueueResult, Job } from '@nina-pm/db';
import type { TenantContext } from '@nina-pm/db';
import type { DownloadSigner } from '../files/download';
import type { JobInvoker } from '../jobs/enqueue';

/** Was die Routen von der Datenbank brauchen – im Test durch Fälschungen ersetzbar. */
export interface ApiRepositories {
  readonly job: {
    byId(id: string): Promise<Job | undefined>;
    enqueue(input: EnqueueInput): Promise<EnqueueResult>;
  };
}

/** Dienste der Lambda `api`, einmal je Container erzeugt (DB-Pool, S3, Lambda). */
export interface ApiServices {
  repositories(ctx: TenantContext): ApiRepositories;
  readonly downloads: DownloadSigner;
  readonly jobInvoker: JobInvoker;
  now(): Date;
}
