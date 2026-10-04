/**
 * Session-Aufgaben der Zeitpläne (AP-15; TK 13, 16.2; FK 8.1; NT-08, NT-09):
 * - `sessionTick` (`tick-5min`): verwaiste Sessions markieren, Metrik `StaleRunningSessions` (CC-16)
 *   schreiben, Betriebsalarm `alert.session_no_heartbeat` an die Admins, fällige `session_close` und
 *   `session_report` anlegen (Outbox leer oder 6 h nach Ende; verwaiste sofort).
 * - `reconcileSiteTick` (`tick-hourly`): je Standort einmal je Nacht nach dem lokalen Mittag den Job
 *   `reconcile` (Zähler-Abgleich, überspringt Rigs mit laufender Session).
 */
import {
  activeAdminIds,
  enqueueDiscordEvent,
  markStaleSessions,
  reconcileSite,
  sessionsDueForClose,
  type OpenDatabase,
} from '@nina-pm/db';
import {
  APP_METRICS,
  currentNightRow,
  dedupeKeys,
  emfLine,
  formatNightKey,
  type NotificationKind,
} from '@nina-pm/shared';
import { z } from 'zod';
import { logger } from '../lib/logger';
import type { EffortTickDeps } from './effort';
import { runJob, type JobHandler, type JobRunnerDeps } from './jobs';

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

export interface SessionOpsDeps {
  readonly db: () => Promise<OpenDatabase['db']>;
  enqueue: EffortTickDeps['enqueue'];
  notify(
    tenantId: string,
    kind: NotificationKind,
    recipients: readonly string[],
    payload: Record<string, unknown>,
    now: Date,
  ): Promise<number>;
  /** Schreibt eine EMF-Zeile (stdout der Lambda → CloudWatch-Metrik). */
  emit(line: string): void;
  /** Funktionsname = Dimension `service` der Metriken (TK 16.1). */
  readonly service: string;
}

export async function sessionTick(
  deps: SessionOpsDeps,
  now: Date,
): Promise<{ stale: number; noHeartbeat: number; closing: number }> {
  const db = await deps.db();
  const stale = await markStaleSessions(db, now);
  const noHeartbeat = stale.filter((s) => s.reason === 'no_heartbeat');
  deps.emit(
    emfLine(deps.service, now.getTime(), [
      { name: APP_METRICS.staleRunningSessions, value: noHeartbeat.length },
    ]),
  );
  // Discord „Session ohne Abschluss“ (FA-DIS-03, AP-60) für jede verwaiste Session.
  for (const s of stale)
    await enqueueDiscordEvent(db, {
      tenantId: s.tenantId,
      eventKey: 'session.stale',
      objectId: s.sessionId,
      data: { sessionId: s.sessionId },
      now,
    });
  for (const s of noHeartbeat) {
    logger.warn('alert_session_no_heartbeat', { tenantId: s.tenantId, sessionId: s.sessionId });
    await deps.notify(
      s.tenantId,
      'alert.session_no_heartbeat',
      await activeAdminIds(db, s.tenantId),
      {
        subject: `${s.rigName} · ${formatNightKey(s.night)}`,
        key: s.sessionId,
        sessionId: s.sessionId,
        rigId: s.rigId,
      },
      now,
    );
  }
  const due = await sessionsDueForClose(db, now);
  for (const d of due) {
    await deps.enqueue(d.tenantId, {
      kind: 'session_close',
      input: { sessionId: d.sessionId },
      dedupeKey: dedupeKeys.sessionClose(d.sessionId),
    });
    await deps.enqueue(d.tenantId, {
      kind: 'session_report',
      input: { sessionId: d.sessionId },
      dedupeKey: dedupeKeys.sessionReport(d.sessionId),
      runAfter: d.reportAt,
    });
  }
  return { stale: stale.length, noHeartbeat: noHeartbeat.length, closing: due.length };
}

const ReconcileInput = z.object({ siteId: z.uuid(), night: z.string() });

export function reconcileJobHandler(deps: Pick<SessionOpsDeps, 'db'>): JobHandler {
  return async ({ job }) => {
    if (!job.tenantId) throw new Error('reconcile ohne Mandant');
    const { siteId, night } = ReconcileInput.parse(job.input);
    const r = await reconcileSite(await deps.db(), job.tenantId, siteId, new Date());
    if (r.linesFixed > 0) logger.warn('reconcile_fixed', { siteId, night, ...r });
    else logger.info('reconcile', { siteId, night, ...r });
    return undefined;
  };
}

/**
 * `tick-hourly` (NT-08): je Standort, sobald der lokale Mittag der Nacht `currentNight` erreicht ist,
 * einmal `reconcile:<siteId>:<night>` anlegen und sofort ausführen.
 */
export async function reconcileSiteTick(
  deps: EffortTickDeps,
  jobs: JobRunnerDeps,
  now: Date,
): Promise<number> {
  let runs = 0;
  for (const site of await deps.sites()) {
    try {
      const row = currentNightRow(deps.nights(site, now, 2), iso(now));
      if (now.getTime() < Date.parse(row.noonStartUtc)) continue;
      const key = dedupeKeys.reconcileSiteNight(site.siteId, row.night);
      if (await deps.runDone(site.tenantId, key)) continue;
      const job = await deps.enqueue(site.tenantId, {
        kind: 'reconcile',
        input: { siteId: site.siteId, night: row.night },
        dedupeKey: key,
      });
      if (!job.created) continue;
      await runJob(jobs, job.jobId);
      runs += 1;
    } catch (error) {
      logger.warn('reconcile_site_tick_failed', {
        siteId: site.siteId,
        error: error instanceof Error ? error.message : 'unbekannt',
      });
    }
  }
  return runs;
}
