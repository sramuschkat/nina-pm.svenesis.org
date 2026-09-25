/** Lambda `worker`: Job-Dispatcher für Zeitpläne und Jobs (TK 13, 7.4). */
import { S3Client } from '@aws-sdk/client-s3';
import {
  deleteExpiredInvitations,
  expireSubmissions,
  recordTenantStorage,
  tenantIdsForStorage,
} from '@nina-pm/db';
import { s3TenantUsageReader } from '../files/tenant-files';
import { lambdaDatabase } from '../lib/database';
import { logger } from '../lib/logger';
import { dispatch } from '../worker/dispatch';
import { effortJobHandler, effortSiteTick } from '../worker/effort';
import { effortDbDeps } from '../worker/effort-db';
import {
  sessionCloseHandler,
  sessionReportHandler,
  type SessionJobDeps,
} from '../worker/session-jobs';
import { JOB_HANDLERS, runJob, type JobRunnerDeps } from '../worker/jobs';
import { requiredEnv } from '../lib/params';
import { measureTenantStorage, tickTasks } from '../worker/tasks';

const effort = effortDbDeps(async () => (await lambdaDatabase()).db);
const sessionJobs: SessionJobDeps = {
  db: async () => (await lambdaDatabase()).db,
  enqueue: async (tenantId, input) =>
    (await lambdaDatabase()).repositories({ tenantId }).job.enqueue(input),
};
const jobs: JobRunnerDeps = {
  queue: async () => (await lambdaDatabase()).jobQueue(),
  handlers: {
    ...JOB_HANDLERS,
    effort: effortJobHandler(effort),
    session_close: sessionCloseHandler(sessionJobs),
    session_report: sessionReportHandler(sessionJobs),
  },
};

const maintenance = {
  cleanupInvitations: async () => {
    const deleted = await deleteExpiredInvitations((await lambdaDatabase()).db, new Date());
    logger.info('invitation_cleanup', { deleted });
    return deleted;
  },
  effortSiteNights: async () => {
    const runs = await effortSiteTick(effort, jobs, new Date());
    logger.info('effort_site_nights', { runs });
    return runs;
  },
  expireSubmissions: async () => {
    const expired = await expireSubmissions((await lambdaDatabase()).db, new Date());
    logger.info('submission_expiry', { expired });
    return expired;
  },
  measureStorage: async () => {
    const db = (await lambdaDatabase()).db;
    const reader = s3TenantUsageReader(new S3Client({}), requiredEnv('DATA_BUCKET'));
    const measured = await measureTenantStorage({
      tenantIds: () => tenantIdsForStorage(db),
      usage: (id) => reader.usage(id),
      record: (id, usage) => recordTenantStorage(db, id, usage, new Date()),
      onError: (tenantId, error) =>
        logger.warn('tenant_storage_failed', {
          tenantId,
          error: error instanceof Error ? error.message : 'unbekannt',
        }),
    });
    logger.info('tenant_storage', { measured });
    return measured;
  },
};

export const handler = (event: unknown) =>
  dispatch(event, { tasks: tickTasks(jobs, maintenance), runJob: (jobId) => runJob(jobs, jobId) });
