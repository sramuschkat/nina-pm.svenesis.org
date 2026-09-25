/**
 * Jobs am Sessionende (TK 7.4, 13; AP-14b legt sie an):
 * - `session_close`: Flat-Kombinationen abschließen (`done`/`skipped`, DAT5-7) und Aufwand-Kennzeichen
 *   der Projekte mit Aufnahmen neu rechnen (NT-48). KPIs, Klarnacht-Statistik und Transit-Abdeckung
 *   ergänzt AP-15.
 * - `session_report`: Der Nachtbericht geht per Discord (AP-60); bis dahin gibt es keinen Kanal, der
 *   Status wird `skipped`.
 */
import {
  closeSessionFlats,
  setReportStatus,
  type EnqueueInput,
  type OpenDatabase,
} from '@nina-pm/db';
import { dedupeKeys } from '@nina-pm/shared';
import { z } from 'zod';
import { logger } from '../lib/logger';
import type { JobHandler } from './jobs';

const Input = z.object({ sessionId: z.uuid() });

export interface SessionJobDeps {
  readonly db: () => Promise<OpenDatabase['db']>;
  enqueue(tenantId: string, input: EnqueueInput): Promise<unknown>;
}

export function sessionCloseHandler(deps: SessionJobDeps): JobHandler {
  return async ({ job }) => {
    if (!job.tenantId) throw new Error('session_close ohne Mandant');
    const { sessionId } = Input.parse(job.input);
    const { projectIds } = await closeSessionFlats(await deps.db(), job.tenantId, sessionId);
    for (const projectId of projectIds)
      await deps.enqueue(job.tenantId, {
        kind: 'effort',
        input: { projectId },
        dedupeKey: dedupeKeys.effort(projectId),
      });
    logger.info('session_close', { sessionId, projects: projectIds.length });
    return undefined;
  };
}

export function sessionReportHandler(deps: SessionJobDeps): JobHandler {
  return async ({ job }) => {
    if (!job.tenantId) throw new Error('session_report ohne Mandant');
    const { sessionId } = Input.parse(job.input);
    await setReportStatus(await deps.db(), job.tenantId, sessionId, 'skipped');
    logger.info('session_report_skipped', { sessionId, reason: 'discord_delivery_ap60' });
    return undefined;
  };
}
