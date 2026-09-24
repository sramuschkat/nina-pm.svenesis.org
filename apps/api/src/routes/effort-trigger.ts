/**
 * Auslöser des Jobs `effort` (TK 7.4, AP-13e): nach Speichern, Einreichen und Freigeben eines Projekts
 * `effort:<projectId>` anlegen und `worker` asynchron aufrufen. Ein Fehler hier bricht die Anfrage nicht
 * ab – `effort_stale` ist gesetzt und der Standortlauf (NT-08) holt die Berechnung nach.
 */
import { dedupeKeys } from '@nina-pm/shared';
import { enqueueJob } from '../jobs/enqueue';
import { logger } from '../lib/logger';
import type { ApiRepositories, ApiServices } from './services';

export async function scheduleEffort(
  svc: Pick<ApiServices, 'jobInvoker'>,
  repos: Pick<ApiRepositories, 'job'>,
  projectId: string,
): Promise<void> {
  try {
    await enqueueJob(repos.job, svc.jobInvoker, {
      kind: 'effort',
      input: { projectId },
      dedupeKey: dedupeKeys.effort(projectId),
    });
  } catch (error) {
    logger.warn('effort_enqueue_failed', {
      projectId,
      error: error instanceof Error ? error.message : 'unbekannt',
    });
  }
}
