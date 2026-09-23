import type { TickTasks } from './dispatch';
import { pickupStaleJobs, type JobRunnerDeps } from './jobs';

/** Aufgaben je Zeitplan (TK 13). Stand AP-05: `tick-5min` übernimmt liegengebliebene Jobs (7.4). */
export function tickTasks(jobs: JobRunnerDeps): TickTasks {
  return {
    'tick-5min': [{ name: 'job_pickup', run: async () => void (await pickupStaleJobs(jobs)) }],
    'tick-hourly': [],
    daily: [],
    weekly: [],
  };
}
