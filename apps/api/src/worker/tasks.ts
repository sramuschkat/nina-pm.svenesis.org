import type { TickTasks } from './dispatch';
import { pickupStaleJobs, type JobRunnerDeps } from './jobs';

export interface MaintenanceDeps {
  /** Abgelaufene Einladungen löschen (TK 13, `daily`); liefert die Anzahl. */
  readonly cleanupInvitations: () => Promise<number>;
}

/**
 * Aufgaben je Zeitplan (TK 13). Stand AP-04b: `tick-5min` übernimmt liegengebliebene Jobs (7.4),
 * `daily` räumt abgelaufene Einladungen auf.
 */
export function tickTasks(jobs: JobRunnerDeps, maintenance?: MaintenanceDeps): TickTasks {
  return {
    'tick-5min': [{ name: 'job_pickup', run: async () => void (await pickupStaleJobs(jobs)) }],
    'tick-hourly': [],
    daily: maintenance
      ? [
          {
            name: 'invitation_cleanup',
            run: async () => void (await maintenance.cleanupInvitations()),
          },
        ]
      : [],
    weekly: [],
  };
}
