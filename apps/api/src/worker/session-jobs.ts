/**
 * Jobs am Sessionende (TK 7.4, 13; AP-14b legt sie an):
 * - `session_close`: Flat-Kombinationen abschließen (`done`/`skipped`, DAT5-7) und Aufwand-Kennzeichen
 *   der Projekte mit Aufnahmen neu rechnen (NT-48); Klarnacht-Statistik des Standorts für die Nacht
 *   fortschreiben (`site_night_stat`, AP-30, FA-AUS-17); gemessene Overheads des Rigs neu rechnen (AP-65,
 *   `session.kpis.measuredOverhead`). Läuft die Session inzwischen wieder
 *   (`stale → running`), tut der Job nichts; der neu scharf geschaltete Schlüssel schließt sie beim Ende.
 * - `session_report`: Nachtbericht nach Discord (AP-60, FA-AUS-21): ist am Rig „Nachtbericht nach Discord“
 *   an, je passendem Kanal (Kategorie *sessions*) eine Zustellung `session.report` – der Job `discord_post`
 *   baut den Bericht beim Senden aus dem Session-Detail und setzt den Status (`sent`/`failed`). Ohne
 *   Schalter oder ohne Kanal `skipped`.
 */
import {
  closeSessionFlats,
  deliveryStatuses,
  discordSessionBrief,
  enqueueDiscordEvent,
  EquipmentRepository,
  overheadIstForSession,
  saveMeasuredOverhead,
  setReportStatus,
  upsertSiteNightStatForSession,
  type EnqueueInput,
  type OpenDatabase,
} from '@nina-pm/db';
import { dedupeKeys, measuredOverheads, type MeasuredOverheads } from '@nina-pm/shared';
import { isoUtc } from '../lib/format';
import { z } from 'zod';
import { logger } from '../lib/logger';
import type { JobHandler } from './jobs';

const Input = z.object({ sessionId: z.uuid() });

export interface SessionJobDeps {
  readonly db: () => Promise<OpenDatabase['db']>;
  enqueue(tenantId: string, input: EnqueueInput): Promise<unknown>;
}

export function sessionCloseHandler(deps: SessionJobDeps): JobHandler {
  return async ({ job, now }) => {
    if (!job.tenantId) throw new Error('session_close ohne Mandant');
    const { sessionId } = Input.parse(job.input);
    const db = await deps.db();
    const { projectIds, skipped } = await closeSessionFlats(db, job.tenantId, sessionId);
    if (skipped) {
      // Session läuft wieder (stale → running); geschlossen wird beim nächsten Ende (rearmClose).
      logger.info('session_close_skipped', { sessionId, reason: 'session_running' });
      return undefined;
    }
    const stat = await upsertSiteNightStatForSession(db, job.tenantId, sessionId);
    const measured = await measureOverheads(db, job.tenantId, sessionId, now()).catch(
      (error: unknown) => {
        // Die Messung ist Zusatz (AP-65): ein Fehler hält den Sessionabschluss nicht auf.
        logger.warn('measured_overhead_failed', {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      },
    );
    for (const projectId of projectIds)
      await deps.enqueue(job.tenantId, {
        kind: 'effort',
        input: { projectId },
        dedupeKey: dedupeKeys.effort(projectId),
      });
    logger.info('session_close', {
      sessionId,
      projects: projectIds.length,
      usableHours: stat?.usableHours ?? null,
      overheadNights: measured?.nights ?? null,
    });
    return undefined;
  };
}

/**
 * Gemessene Overheads des Rigs neu rechnen (AP-65, FA-RIG-04b): Ist der letzten 30 Nächte bis zur Nacht der Session,
 * Dither-Regel und Rückfallwerte aus den Rig-Einstellungen; Ergebnis an der Session (`kpis.measuredOverhead`).
 */
export async function measureOverheads(
  db: OpenDatabase['db'],
  tenantId: string,
  sessionId: string,
  now: Date,
): Promise<MeasuredOverheads | null> {
  const ist = await overheadIstForSession(db, tenantId, sessionId);
  if (!ist) return null;
  const rig = await new EquipmentRepository(db, { tenantId }).rig(ist.rigId);
  if (!rig) return null;
  const measured: MeasuredOverheads = {
    computedAtUtc: isoUtc(now),
    fromNight: ist.fromNight,
    toNight: ist.toNight,
    nights: ist.nights.length,
    values: measuredOverheads(ist.nights, {
      ditherEnabled: rig.ditherEnabled,
      ditherEvery: rig.ditherEvery,
      typedDownloadS: rig.overhead.downloadS,
      typedDitherSettleS: rig.overhead.ditherSettleS,
    }),
  };
  await saveMeasuredOverhead(db, tenantId, sessionId, measured);
  return measured;
}

export function sessionReportHandler(deps: SessionJobDeps): JobHandler {
  return async ({ job, now }) => {
    if (!job.tenantId) throw new Error('session_report ohne Mandant');
    const tenantId = job.tenantId;
    const { sessionId } = Input.parse(job.input);
    const db = await deps.db();
    const session = await discordSessionBrief(db, tenantId, sessionId);
    if (!session) return undefined;
    if (!session.sessionReportDiscord) {
      await setReportStatus(db, tenantId, sessionId, 'skipped');
      logger.info('session_report_skipped', { sessionId, reason: 'rig_switch_off' });
      return undefined;
    }
    const created = await enqueueDiscordEvent(db, {
      tenantId,
      eventKey: 'session.report',
      objectId: sessionId,
      data: { sessionId },
      now: now(),
    });
    // Schon zugestellt bzw. unterwegs (Job wiederholt): Status bleibt beim discord_post.
    const existing =
      created > 0 ? [] : await deliveryStatuses(db, tenantId, 'session.report', sessionId);
    if (created === 0 && existing.length === 0) {
      await setReportStatus(db, tenantId, sessionId, 'skipped');
      logger.info('session_report_skipped', { sessionId, reason: 'no_channel' });
      return undefined;
    }
    if (created > 0) await setReportStatus(db, tenantId, sessionId, 'pending');
    logger.info('session_report_queued', { sessionId, channels: created });
    return undefined;
  };
}
