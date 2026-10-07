/**
 * Auslöser der Jobs nach einer Projektänderung (TK 7.4): `effort` (AP-13e) und `thumbnail` (AP-25,
 * Vorschaubild des Bildfelds) nach Speichern, Einreichen und Freigeben anlegen und `worker` asynchron
 * aufrufen. Ein Fehler hier bricht die Anfrage nicht ab – `effort_stale` ist gesetzt und der Standortlauf
 * (NT-08) holt die Berechnung nach, fehlende Vorschaubilder holt `tick-hourly` nach.
 * Dazu die Folgeplanung `forecast` des Standorts (07.10.2026): Ändert sich ein freigegebenes Projekt (Freigabe,
 * Status, Zeilen, Transit festlegen/aufheben), rechnet der Server die Prognose gleich neu statt erst am nächsten Mittag –
 * „Plan für diese Nacht“ und S-62 zeigten sonst Projekte, die nach dem Mittagslauf freigegeben wurden, mit 0 Frames.
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

/**
 * Folgeplanung des Standorts neu rechnen, wenn das Projekt freigegeben ist und an einem Rig hängt. Dedupliziert wie
 * *Neu berechnen* in S-62 (ein offener Lauf je Standort); Fehler brechen die Anfrage nicht ab.
 */
export async function scheduleForecast(
  svc: Pick<ApiServices, 'jobInvoker'>,
  repos: Pick<ApiRepositories, 'job' | 'projects' | 'equipment'>,
  projectId: string,
): Promise<void> {
  try {
    const d = await repos.projects().detail(projectId, true);
    const rigId = d?.project.rigId;
    if (!d || !rigId || d.project.approvalStatus !== 'approved') return;
    const rig = await repos.equipment().rig(rigId);
    if (!rig) return;
    await enqueueJob(repos.job, svc.jobInvoker, {
      kind: 'forecast',
      input: { siteId: rig.siteId },
      dedupeKey: dedupeKeys.forecastSiteManual(rig.siteId),
    });
  } catch (error) {
    logger.warn('forecast_enqueue_failed', {
      projectId,
      error: error instanceof Error ? error.message : 'unbekannt',
    });
  }
}

/** Nach jeder Projektänderung: Aufwand, Vorschaubild und Folgeplanung. */
export async function scheduleProjectJobs(
  svc: Pick<ApiServices, 'jobInvoker'>,
  repos: Pick<ApiRepositories, 'job' | 'projects' | 'equipment'>,
  projectId: string,
): Promise<void> {
  await scheduleEffort(svc, repos, projectId);
  await scheduleThumbnail(svc, repos, projectId);
  await scheduleForecast(svc, repos, projectId);
}
