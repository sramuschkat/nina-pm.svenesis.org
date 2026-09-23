/** Lambda `worker`: Job-Dispatcher für Zeitpläne und Jobs (TK 13, 7.4). */
import { lambdaDatabase } from '../lib/database';
import { dispatch } from '../worker/dispatch';
import { runJob, type JobRunnerDeps } from '../worker/jobs';
import { tickTasks } from '../worker/tasks';

const jobs: JobRunnerDeps = { queue: async () => (await lambdaDatabase()).jobQueue() };

export const handler = (event: unknown) =>
  dispatch(event, { tasks: tickTasks(jobs), runJob: (jobId) => runJob(jobs, jobId) });
