import { logger } from '../lib/logger';

/** Die vier Zeitpläne (TK 13); weitere sind nicht vorgesehen (rules/api.md). */
export const TICKS = ['tick-5min', 'tick-hourly', 'daily', 'weekly'] as const;
export type Tick = (typeof TICKS)[number];

export type WorkerEvent = { tick: Tick } | { jobId: string };

export type Task = () => Promise<void>;

/**
 * Aufgaben je Zeitplan. Stand AP-02b leer; die Aufgaben aus TK 13 kommen mit ihren Paketen
 * (Jobs-Infrastruktur AP-05, Wetter AP-23, Kataloge AP-20/AP-40 …).
 */
export type TickTasks = Readonly<Record<Tick, readonly { name: string; run: Task }[]>>;

export const defaultTickTasks: TickTasks = {
  'tick-5min': [],
  'tick-hourly': [],
  daily: [],
  weekly: [],
};

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
export async function dispatch(
  event: unknown,
  tasks: TickTasks = defaultTickTasks,
): Promise<{ ran: string[] }> {
  if (!isWorkerEvent(event)) {
    logger.error('worker_unknown_event', { event });
    throw new Error('Unbekanntes Worker-Ereignis');
  }
  if ('jobId' in event) {
    // Jobs aus der Tabelle `job` führt der Dispatcher ab AP-05 aus.
    logger.warn('worker_job_not_implemented', { jobId: event.jobId });
    return { ran: [] };
  }
  const ran: string[] = [];
  for (const task of tasks[event.tick]) {
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
