/**
 * Use-Cases Sessions, Meldungen und Heartbeat der NINA-API (AP-14b; TK 5.6, 6.6, 7.3, 7.6, 13;
 * FA-SYN-04…07, FA-RIG-06, FA-NIN-04, NT-01, NT-09, NT-14, NT-22, NT-E1, M5, M6, M7).
 * Mandant und Rig ausschließlich aus dem Token.
 */
import {
  activeAdminIds,
  alertSentSince,
  changedWheelPositions,
  enqueueDiscordEvent,
  LATE_REPORT_MS,
  OFFLINE_MAX_MS,
  type NinaPrincipal,
} from '@nina-pm/db';
import {
  currentNightRow,
  dedupeKeys,
  formatNightKey,
  nina,
  ProblemError,
  type NinaSettingsMismatchCode,
  type NotificationKind,
} from '@nina-pm/shared';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { isoUtc } from '../lib/format';
import { logger } from '../lib/logger';
import { captureForecastSnapshot } from '../sessions/log';
import { graceNight, noonNightKey, siteNights } from '../lib/night-table';
import { createNotificationService } from '../notifications/service';
import type { ApiServices } from '../routes/services';
import { targets } from './sync';

type SessionCreate = z.output<typeof nina.NinaSessionCreate>;
type SessionPatch = z.output<typeof nina.NinaSessionPatch>;
type Heartbeat = z.output<typeof nina.NinaHeartbeat>;

const isoOrNull = (d: Date | null) => (d === null ? null : isoUtc(d));

const DAY_MS = 86_400_000;
/**
 * Rückwirkend angenommene Nächte einer offline angelegten Session (Spec-Ergänzung 28.09.2026,
 * `night.md` §1.1): Offline-Modus höchstens 14 Tage (FA-NIN-04) plus die 7 Tage für späte Meldungen
 * (TK 6.6) – maßgeblich ist das Ende der Nacht (`noonEndUtc`).
 */
const OFFLINE_NIGHT_WINDOW_MS = OFFLINE_MAX_MS + LATE_REPORT_MS;

/**
 * `night` nur `currentNight` des Standorts oder die folgende Nacht (NT-01). Eine **offline** angelegte
 * Session darf zusätzlich eine vergangene Nacht tragen, deren Ende höchstens
 * `OFFLINE_NIGHT_WINDOW_MS` zurückliegt – sonst gingen die offline gepufferten Aufnahmen verloren.
 */
async function checkNight(
  svc: ApiServices,
  p: NinaPrincipal,
  night: string,
  opts: { offline: boolean } = { offline: false },
) {
  const eq = svc.repositories({ tenantId: p.tenantId }).equipment();
  const rig = await eq.rig(p.rigId);
  const site = rig ? await eq.site(rig.siteId) : undefined;
  if (!rig || !site) throw new ProblemError('nina.token_invalid');
  const now = svc.now();
  const earliest = now.getTime() - OFFLINE_NIGHT_WINDOW_MS;
  const table = opts.offline
    ? siteNights(
        site,
        now,
        noonNightKey(site.timeZone, earliest),
        Math.ceil(OFFLINE_NIGHT_WINDOW_MS / DAY_MS) + 4,
      )
    : siteNights(site, now, undefined, 3);
  const current = currentNightRow(table, isoUtc(now)).night;
  const currentIndex = table.nights.findIndex((n) => n.night === current);
  const next = table.nights[currentIndex + 1]?.night;
  if (night === current || night === next || night === graceNight(table, now)) return rig;
  if (opts.offline) {
    const index = table.nights.findIndex((n) => n.night === night);
    const row = table.nights[index];
    if (row && index < currentIndex && Date.parse(row.noonEndUtc) >= earliest) return rig;
  }
  throw new ProblemError('nina.night_invalid');
}

const HOUR_MS = 3_600_000;
/** Unveränderte Filterrad-Meldung höchstens stündlich neu speichern (`reportedAt`). */
const REPORTED_WHEEL_REFRESH_MS = HOUR_MS;

/**
 * Betriebsalarm in der App an alle aktiven Admins (AP-15, TK 16.2): entprellt über `payload.key` im
 * Zeitraum `debounceMs`; ein Fehler dabei ändert die Plugin-Antwort nie.
 */
async function alertAdmins(
  svc: ApiServices,
  tenantId: string,
  kind: NotificationKind,
  key: string,
  subject: string,
  debounceMs: number,
  extra: Record<string, unknown> = {},
) {
  try {
    const now = svc.now();
    if (await alertSentSince(svc.db, tenantId, kind, key, new Date(now.getTime() - debounceMs)))
      return;
    await createNotificationService(svc.db).notify(
      tenantId,
      kind,
      await activeAdminIds(svc.db, tenantId),
      { subject, key, ...extra },
      { now },
    );
  } catch (error) {
    logger.warn('alert_failed', { kind, error: error instanceof Error ? error.message : '' });
  }
}

/** Discord „Session gestartet/beendet“ (FA-DIS-03, AP-60); ein Fehler hält die NINA-API nicht auf. */
async function sessionDiscord(
  svc: ApiServices,
  tenantId: string,
  eventKey: 'session.started' | 'session.completed',
  sessionId: string,
) {
  try {
    await enqueueDiscordEvent(svc.db, {
      tenantId,
      eventKey,
      objectId: sessionId,
      data: { sessionId },
      now: svc.now(),
    });
  } catch (error) {
    logger.warn('discord_enqueue_failed', {
      eventKey,
      error: error instanceof Error ? error.message : '',
    });
  }
}

async function rigName(svc: ApiServices, p: NinaPrincipal) {
  return (await svc.repositories({ tenantId: p.tenantId }).equipment().rig(p.rigId))?.name ?? '';
}

export async function createSession(svc: ApiServices, p: NinaPrincipal, body: SessionCreate) {
  const repos = svc.repositories({ tenantId: p.tenantId });
  // Idempotenz vor der Nachtprüfung (execution.md §6): eine bekannte Session antwortet immer `200`,
  // auch wenn ihre Nacht inzwischen nicht mehr `currentNight` ist (Wiederholung nach Netzfehler).
  const known = await repos.ninaSession(p.rigId, p.instanceId).session(body.id);
  if (!known) await checkNight(svc, p, body.night, { offline: body.offline });
  const busyAlert = async () =>
    alertAdmins(
      svc,
      p.tenantId,
      'alert.rig_busy',
      `${p.rigId}:${body.night}`,
      `${await rigName(svc, p)} · ${formatNightKey(body.night)} · ${p.instanceName}`,
      12 * HOUR_MS,
      { rigId: p.rigId },
    );
  let r;
  try {
    r = await repos.ninaSession(p.rigId, p.instanceId).create(
      {
        id: body.id,
        night: body.night,
        nightPlanId: body.nightPlanId,
        startedAt: new Date(body.startedAtUtc),
        offline: body.offline,
        offlinePlan: body.offlinePlan ?? null,
      },
      svc.now(),
    );
  } catch (error) {
    // Zweite Instanz am belegten Rig (409 session.rig_busy): Betriebsalarm, dann die Ablehnung.
    if (error instanceof ProblemError && error.code === 'session.rig_busy') await busyAlert();
    throw error;
  }
  // Offline angelegt und schon eine andere Session in der Nacht: beide gespeichert, Alarm rig.busy.
  if (r.created && body.offline) {
    const others = await repos
      .ninaSession(p.rigId, p.instanceId)
      .otherSessionsInNight(body.id, body.night, r.session.startedAt);
    if (others > 0) {
      logger.warn('alert_rig_busy', { rigId: p.rigId, sessionId: body.id });
      await busyAlert();
    }
  }
  // Wetter-Schnappschuss zum Sessionbeginn für Protokoll und Treffsicherheit (AP-30, FA-AUS-15/16).
  if (r.created) await captureForecastSnapshot(svc, p.tenantId, p.rigId, r.session.id, body.night);
  if (r.created && !body.offline)
    await sessionDiscord(svc, p.tenantId, 'session.started', r.session.id);
  const upload = await svc.uploads.planLog(p.tenantId, body.id);
  return {
    created: r.created,
    body: {
      sessionId: r.session.id,
      lease: { untilUtc: isoOrNull(r.lease.untilUtc) },
      planLogUploadUrl: upload.url,
      planLogUploadFields: upload.fields,
    },
  };
}

/**
 * Sessionende legt die Jobs an (TK 13, NIN5-7, NT-09): `session_close` und `session_report` erst bei
 * `outbox_pending = 0` (sonst übernimmt `tick-5min` nach 6 h, AP-15); `session_report` frühestens bei
 * `max(ended_at, darknessEndUtc ?? sessionEndUtc)` der letzten Planrevision.
 */
async function enqueueSessionJobs(
  svc: ApiServices,
  p: NinaPrincipal,
  sessionId: string,
  endedAt: Date,
) {
  const repos = svc.repositories({ tenantId: p.tenantId });
  const plan = await repos.ninaSession(p.rigId, p.instanceId).lastPlanSummary(sessionId);
  const marks = [plan?.darknessEndUtc, plan?.sessionEndUtc]
    .filter((x): x is string => !!x)
    .map((x) => new Date(x));
  const reportAt = new Date(Math.max(endedAt.getTime(), marks[0]?.getTime() ?? endedAt.getTime()));
  await repos.job.enqueue({
    kind: 'session_close',
    input: { sessionId },
    dedupeKey: dedupeKeys.sessionClose(sessionId),
  });
  await repos.job.enqueue({
    kind: 'session_report',
    input: { sessionId },
    dedupeKey: dedupeKeys.sessionReport(sessionId),
    runAfter: reportAt,
  });
}

export async function patchSession(
  svc: ApiServices,
  p: NinaPrincipal,
  sessionId: string,
  body: SessionPatch,
) {
  const repos = svc.repositories({ tenantId: p.tenantId });
  const now = svc.now();
  const r = await repos.ninaSession(p.rigId, p.instanceId).patch(
    sessionId,
    {
      ...(body.status ? { status: body.status } : {}),
      ...(body.endedAtUtc ? { endedAt: new Date(body.endedAtUtc) } : {}),
      ...(body.outboxPending !== undefined ? { outboxPending: body.outboxPending } : {}),
      ...(body.ninaConditions !== undefined ? { ninaConditions: body.ninaConditions } : {}),
      ...(body.offline !== undefined ? { offline: body.offline } : {}),
      ...(body.offlinePlan ? { offlinePlan: body.offlinePlan } : {}),
    },
    now,
  );
  // Nur beim Übergang: Session gerade beendet bzw. Outbox gerade leer geworden – nicht bei jedem
  // weiteren PATCH einer abgeschlossenen Session (sonst je PATCH ein neuer Close-/Berichtsjob).
  const closed = r.session.status === 'completed' || r.session.status === 'aborted';
  if (closed && r.ended) await sessionDiscord(svc, p.tenantId, 'session.completed', sessionId);
  if (
    closed &&
    (r.ended || r.outboxDrained) &&
    (r.session.outboxPending ?? 0) === 0 &&
    r.session.endedAt !== null
  )
    await enqueueSessionJobs(svc, p, sessionId, new Date(r.session.endedAt));
  return {
    sessionId,
    status: r.session.status as 'running' | 'completed' | 'aborted' | 'stale',
    lease: { untilUtc: isoOrNull(r.lease.untilUtc), leaseLost: r.lease.leaseLost },
    nightPlanId: r.nightPlanId,
    reportStatus: r.session.reportStatus as 'none' | 'pending' | 'sent' | 'failed' | 'skipped',
  };
}

export async function ingestCaptures(
  svc: ApiServices,
  p: NinaPrincipal,
  sessionId: string,
  body: z.output<typeof nina.NinaCaptureBatch>,
) {
  const r = await svc
    .repositories({ tenantId: p.tenantId })
    .ninaIngest(p.rigId)
    .ingestCaptures(sessionId, body.captures, svc.now(), () => randomUUID());
  if (r.withoutLease) logger.warn('captures_without_lease', { sessionId, rigId: p.rigId });
  return { results: r.results };
}

export async function ingestEvents(
  svc: ApiServices,
  p: NinaPrincipal,
  sessionId: string,
  body: z.output<typeof nina.NinaEventBatch>,
) {
  return svc
    .repositories({ tenantId: p.tenantId })
    .ninaIngest(p.rigId)
    .ingestEvents(sessionId, body.events, svc.now());
}

/**
 * NINA-Einstellungen gegen Vorgaben und Rig-Werte (NT-22, execution.md §6): Codes aus
 * `ninaSettingsMismatchCodes`; umbenannte Filter an bestätigten Plätzen gelten als unbestätigt (NT-E1).
 */
export function settingsMismatch(
  hb: Heartbeat,
  rig: {
    hasRotator: boolean;
    rotationToleranceDeg: number;
    flipEnabled: boolean;
    flipAfterMeridianMin: number;
    flipMaxAfterMeridianMin: number;
    flipPauseBeforeMeridianMin: number;
    afEveryMin: number;
    site: { latitudeDeg: number; longitudeDeg: number };
    filterWheel: readonly {
      position: number;
      ninaFilterName: string | null;
      ninaConfirmedAt: string | null;
    }[];
  },
): { codes: NinaSettingsMismatchCode[]; changedPositions: number[] } {
  const codes = new Set<NinaSettingsMismatchCode>();
  const f = hb.meridianFlip;
  if (f && rig.flipEnabled) {
    // Unbekannt (noch kein Container gelaufen) ist keine Abweichung – sonst kam nach jedem NINA-Start ein Alarm.
    if (f.triggerPresent === false) codes.add('flip_trigger_missing');
    const off = (a: number, b: number) => Math.abs(a - b) > 0.5;
    if (
      off(f.afterMin, rig.flipAfterMeridianMin) ||
      off(f.maxAfterMin, rig.flipMaxAfterMeridianMin) ||
      off(f.pauseBeforeMin, rig.flipPauseBeforeMeridianMin)
    )
      codes.add('flip_timing_mismatch');
  }
  if (f?.recenter) codes.add('recenter_after_flip_on');
  if (rig.hasRotator && (!hb.rotator || !hb.rotator.connected)) codes.add('rotator_unavailable');
  if (hb.rotator?.rangeType === 'QUARTER') codes.add('rotator_range_quarter');
  if (hb.plateSolve && hb.plateSolve.rotationToleranceDeg > rig.rotationToleranceDeg)
    codes.add('plate_solve_tolerance');
  const m = hb.mount;
  if (m) {
    if (m.equatorialSystem === 'B1950' || m.equatorialSystem === 'J2050')
      codes.add('mount_epoch_unsupported');
    if (
      Math.abs(m.siteLatDeg - rig.site.latitudeDeg) > 0.01 ||
      Math.abs(m.siteLonDeg - rig.site.longitudeDeg) > 0.01 ||
      Math.abs(m.siderealTimeDeltaS) > 60
    )
      codes.add('mount_site_mismatch');
  }
  const t = hb.sequenceTriggers;
  if (t) {
    if (t.dither.length > 0) codes.add('nina_dither_trigger_present');
    // Wie execution.md §6: nur bei afEveryMin > 0, Abweichung erst über 0,5 min (Analyse 04.10.2026).
    if (rig.afEveryMin > 0 && t.autofocusAfterTimeMin === null)
      codes.add('af_time_trigger_missing');
    else if (
      rig.afEveryMin > 0 &&
      t.autofocusAfterTimeMin !== null &&
      Math.abs(t.autofocusAfterTimeMin - rig.afEveryMin) > 0.5
    )
      codes.add('af_time_mismatch');
  }
  // Dieselbe Regel wie beim Speichern (`reportNinaFilterWheel`): fehlende Plätze gelten nicht als geändert.
  const changedPositions = hb.filterWheel
    ? changedWheelPositions(rig.filterWheel, hb.filterWheel)
    : [];
  if (changedPositions.length > 0) codes.add('filter_wheel_changed');
  return { codes: [...codes].sort(), changedPositions };
}

export async function heartbeat(svc: ApiServices, p: NinaPrincipal, hb: Heartbeat) {
  const now = svc.now();
  const repos = svc.repositories({ tenantId: p.tenantId });
  const eq = repos.equipment();
  const rig = await eq.rig(p.rigId);
  const site = rig ? await eq.site(rig.siteId) : undefined;
  if (!rig || !site) throw new ProblemError('nina.token_invalid');
  const sessions = repos.ninaSession(p.rigId, p.instanceId);
  const lease = await sessions.heartbeat(
    {
      sessionId: hb.sessionId ?? null,
      offline: hb.state === 'offline',
      offlineUntil: hb.offlineUntil ? new Date(hb.offlineUntil) : null,
    },
    now,
  );
  const mismatch = settingsMismatch(hb, {
    hasRotator: rig.hasRotator,
    rotationToleranceDeg: rig.rotationToleranceDeg,
    flipEnabled: rig.flipEnabled,
    flipAfterMeridianMin: rig.flipAfterMeridianMin,
    flipMaxAfterMeridianMin: rig.flipMaxAfterMeridianMin,
    flipPauseBeforeMeridianMin: rig.flipPauseBeforeMeridianMin,
    afEveryMin: rig.overhead.afEveryMin,
    site,
    filterWheel: rig.filterWheel,
  });
  // Gemeldetes Filterrad speichern (NT-E1, S-10) und umgesteckte Plätze entbestätigen – dieselbe Regel
  // wie `settingsMismatch` (fehlende Plätze gelten nicht als geändert). Geschrieben wird die Rig-Zeile
  // nur bei Änderung bzw. höchstens stündlich, damit der 60-s-Heartbeat nicht mit Rig-Änderungen
  // kollidiert (OCC, DAT-17).
  if (hb.filterWheel)
    await eq.reportNinaFilterWheel(p.rigId, hb.filterWheel, now, {
      refreshMs: REPORTED_WHEEL_REFRESH_MS,
    });
  // Auslesemodi der Kamera (FA-KAM-07): Anzeige des Abgleichs auf der Kameraseite. Eine leere Liste (Kamera
  // getrennt) überschreibt die letzte Meldung nicht.
  if (hb.cameraReadoutModes && hb.cameraReadoutModes.length > 0)
    await eq.reportNinaReadoutModes(
      p.rigId,
      [...hb.cameraReadoutModes].sort((a, b) => a.index - b.index).map((m) => m.name),
      now,
      { refreshMs: REPORTED_WHEEL_REFRESH_MS },
    );
  if (mismatch.codes.length > 0) {
    logger.warn('alert_nina_settings_mismatch', { rigId: p.rigId, codes: mismatch.codes });
    // Mit Code-Liste; dieselbe Liste höchstens einmal je 24 h, eine geänderte sofort.
    await alertAdmins(
      svc,
      p.tenantId,
      'alert.nina_settings_mismatch',
      `${p.instanceId}:${mismatch.codes.join(',')}`,
      `${rig.name} · ${p.instanceName}: ${mismatch.codes.join(', ')}`,
      24 * HOUR_MS,
      { rigId: p.rigId, codes: mismatch.codes.join(',') },
    );
  }
  if ((hb.deadLetters ?? 0) > 0)
    await alertAdmins(
      svc,
      p.tenantId,
      'alert.plugin_dead_letters',
      `${p.instanceId}:dead_letters`,
      `${rig.name} · ${p.instanceName}: ${String(hb.deadLetters)}`,
      24 * HOUR_MS,
      { rigId: p.rigId },
    );
  await sessions.recordInstanceState(
    {
      pluginVersion: hb.pluginVersion,
      engineVersion: hb.engineVersion,
      profileLat: hb.profileLocation?.latDeg ?? null,
      profileLon: hb.profileLocation?.lonDeg ?? null,
      lastState: { ...hb, mismatchCodes: mismatch.codes, receivedAtUtc: isoUtc(now) },
    },
    now,
  );
  const commands = await sessions.commands(hb.ackedCommandIds ?? [], now);
  const { etag } = await targets(svc, p);
  const fresh = await eq.rig(p.rigId);
  return {
    serverTimeUtc: isoUtc(now),
    lease: lease ? { untilUtc: isoOrNull(lease.untilUtc), leaseLost: lease.leaseLost } : null,
    settingsVersion: fresh?.settingsVersion ?? rig.settingsVersion,
    targetsEtag: etag,
    commands: commands as { id: string; command: 'refresh_targets' | 'reset_plan' }[],
  };
}
