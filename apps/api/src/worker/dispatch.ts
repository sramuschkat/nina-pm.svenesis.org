import { logger } from '../lib/logger';

/** Die vier Zeitpläne (TK 13); weitere sind nicht vorgesehen (rules/api.md). */
export const TICKS = ['tick-5min', 'tick-hourly', 'daily', 'weekly'] as const;
export type Tick = (typeof TICKS)[number];

export type WorkerEvent = { tick: Tick } | { jobId: string };

export type Task = () => Promise<void>;

/** Aufgaben je Zeitplan; die Aufgaben aus TK 13 kommen mit ihren Paketen (Wetter AP-23 …). */
export type TickTasks = Readonly<Record<Tick, readonly { name: string; run: Task }[]>>;

export interface DispatchDeps {
  readonly tasks: TickTasks;
  /** Führt einen Job aus der Tabelle `job` aus (worker/jobs.ts). */
  readonly runJob: (jobId: string) => Promise<unknown>;
}

export function isWorkerEvent(event: unknown): event is WorkerEvent {
  if (typeof event !== 'object' || event === null) return false;
  const e = event as Record<string, unknown>;
  if (typeof e.tick === 'string') return (TICKS as readonly string[]).includes(e.tick);
  return typeof e.jobId === 'string' && e.jobId.length > 0;
}

/**
 * Dispatcher der Lambda `worker` (TK 13, 7.4). Zeitpläne rufen mit `{tick}`, die API mit `{jobId}`.
 * Ein unbekanntes Ereignis ist ein Konfigurationsfehler und wirft – das landet über EventInvokeConfig
 * in der SQS `nina-pm-worker-failures` und löst den Alarm aus.
 */
export async function dispatch(event: unknown, deps: DispatchDeps): Promise<{ ran: string[] }> {
  if (!isWorkerEvent(event)) {
    logger.error('worker_unknown_event', { event });
    throw new Error('Unbekanntes Worker-Ereignis');
  }
  if ('jobId' in event) {
    await deps.runJob(event.jobId);
    return { ran: [`job:${event.jobId}`] };
  }
  const ran: string[] = [];
  for (const task of deps.tasks[event.tick]) {
    const started = Date.now();
    await task.run();
    logger.info('worker_task_done', {
      tick: event.tick,
      task: task.name,
      durationMs: Date.now() - started,
    });
    ran.push(task.name);
  }
  logger.info('worker_tick_done', { tick: event.tick, tasks: ran.length });
  return { ran };
}
