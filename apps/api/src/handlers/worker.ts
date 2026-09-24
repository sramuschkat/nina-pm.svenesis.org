/** Lambda `worker`: Job-Dispatcher für Zeitpläne und Jobs (TK 13, 7.4). */
import { deleteExpiredInvitations } from '@nina-pm/db';
import { lambdaDatabase } from '../lib/database';
import { logger } from '../lib/logger';
import { dispatch } from '../worker/dispatch';
import { runJob, type JobRunnerDeps } from '../worker/jobs';
import { tickTasks } from '../worker/tasks';

const jobs: JobRunnerDeps = { queue: async () => (await lambdaDatabase()).jobQueue() };

const maintenance = {
  cleanupInvitations: async () => {
    const deleted = await deleteExpiredInvitations((await lambdaDatabase()).db, new Date());
    logger.info('invitation_cleanup', { deleted });
    return deleted;
  },
};

export const handler = (event: unknown) =>
  dispatch(event, { tasks: tickTasks(jobs, maintenance), runJob: (jobId) => runJob(jobs, jobId) });
