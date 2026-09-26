/**
 * Auslöser der Jobs nach einer Projektänderung (TK 7.4): `effort` (AP-13e) und `thumbnail` (AP-25,
 * Vorschaubild des Bildfelds) nach Speichern, Einreichen und Freigeben anlegen und `worker` asynchron
 * aufrufen. Ein Fehler hier bricht die Anfrage nicht ab – `effort_stale` ist gesetzt und der Standortlauf
 * (NT-08) holt die Berechnung nach, fehlende Vorschaubilder holt `tick-hourly` nach.
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

/** Vorschaubild (AP-25); der Job tut nichts, wenn sich Ausschnitt und Schlüssel nicht geändert haben. */
export async function scheduleThumbnail(
  svc: Pick<ApiServices, 'jobInvoker'>,
  repos: Pick<ApiRepositories, 'job'>,
  projectId: string,
): Promise<void> {
  try {
    await enqueueJob(repos.job, svc.jobInvoker, {
      kind: 'thumbnail',
      input: { projectId },
      dedupeKey: dedupeKeys.thumbnail(projectId),
    });
  } catch (error) {
    logger.warn('thumbnail_enqueue_failed', {
      projectId,
      error: error instanceof Error ? error.message : 'unbekannt',
    });
  }
}

/** Nach jeder Projektänderung: Aufwand und Vorschaubild. */
export async function scheduleProjectJobs(
  svc: Pick<ApiServices, 'jobInvoker'>,
  repos: Pick<ApiRepositories, 'job'>,
  projectId: string,
): Promise<void> {
  await scheduleEffort(svc, repos, projectId);
  await scheduleThumbnail(svc, repos, projectId);
}
