/**
 * `tick-5min` (TK 7.7): fällige `discord_post`-Jobs ausführen – neu angelegte (ausgelöst in der Transaktion
 * des Ereignisses) und die nach Backoff wieder fälligen. Zeitbudget, damit der Lauf unter dem Lambda-Timeout
 * bleibt (je Aufruf höchstens `WEBHOOK_TIMEOUT_MS`).
 */
import { dueDiscordJobs, type OpenDatabase } from '@nina-pm/db';
import { runJob, type JobRunnerDeps } from '../worker/jobs';

export const DISCORD_TICK_BUDGET_MS = 4 * 60_000;

export async function discordTick(
  db: OpenDatabase['db'],
  jobs: JobRunnerDeps,
  now: Date,
  clock: () => number = Date.now,
): Promise<number> {
  const started = clock();
  let runs = 0;
  for (const id of await dueDiscordJobs(db, now)) {
    if (clock() - started > DISCORD_TICK_BUDGET_MS) break;
    await runJob(jobs, id);
    runs += 1;
  }
  return runs;
}
