import type { AuthRepository, EnqueueInput, EnqueueResult, Job, TenantContext } from '@nina-pm/db';
import type { AuthConfig } from '../auth/config';
import type { DiscordClient } from '../auth/discord';
import type { DownloadSigner } from '../files/download';
import type { JobInvoker } from '../jobs/enqueue';

/** Was die Routen von der Datenbank brauchen – im Test auf PGlite bzw. durch Fälschungen ersetzbar. */
export interface ApiRepositories {
  readonly job: {
    byId(id: string): Promise<Job | undefined>;
    enqueue(input: EnqueueInput): Promise<EnqueueResult>;
  };
}

/** Dienste der Lambda `api`, einmal je Container erzeugt (DB-Pool, S3, Lambda, SSM). */
export interface ApiServices {
  repositories(ctx: TenantContext): ApiRepositories;
  /** Anmeldung und Sitzungen (an Sitzung/Identität gebunden, TK 5.3). */
  readonly auth: AuthRepository;
  readonly authConfig: AuthConfig;
  readonly discord: DiscordClient;
  readonly downloads: DownloadSigner;
  readonly jobInvoker: JobInvoker;
  now(): Date;
}
