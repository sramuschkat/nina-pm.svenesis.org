/** Jobs (TK 7.4, 13): Status-Abfrage, Eingaben benutzerausgelöster Jobs und ihre Grenzen (SV-06). */
import { z } from 'zod';
import { jobKinds, jobStatuses, type JobKind } from '../generated/enums';
import { NightKey, Uuid, UtcInstant } from './common';

/** Von Mitgliedern ausgelöste Jobs; für sie gilt die Obergrenze offener Jobs je Mitglied (TK 13). */
export const USER_JOB_KINDS: readonly JobKind[] = ['multi_sim', 'impact'];
export const MAX_OPEN_USER_JOBS = 3;
/** Mehrnacht-Simulation: höchstens 14 Nächte (SV-06). */
export const MAX_MULTI_SIM_NIGHTS = 14;

/** Übernahme liegengebliebener Jobs durch `tick-5min` (TK 7.4). */
export const JOB_PENDING_STALE_MS = 2 * 60_000;
export const JOB_RUNNING_STALE_MS = 20 * 60_000;
export function maxJobAttempts(kind: JobKind): number {
  return kind === 'discord_post' ? 5 : 3;
}

/**
 * Vorrang im Dispatcher (TK 13): Zeitplan- und Systemjobs vor Admin-Jobs vor benutzerausgelösten
 * Jobs – sonst belegt ein einzelner User die auf 5 begrenzte `worker`-Lambda.
 */
export function jobPriority(kind: JobKind): number {
  if (USER_JOB_KINDS.includes(kind)) return 2;
  if (kind === 'export' || kind === 'import' || kind === 'transit_result_parse') return 1;
  return 0;
}

export const JobKindSchema = z.enum(jobKinds);
export const JobStatusSchema = z.enum(jobStatuses);

export const MultiSimInput = z
  .object({
    rigId: Uuid,
    nightFrom: NightKey,
    nights: z.number().int().min(1).max(MAX_MULTI_SIM_NIGHTS),
    /** Vorschau mit eigenen Entwürfen und eingereichten Objekten (FK 6.14). */
    includeOwnDrafts: z.boolean().default(false),
  })
  .meta({ id: 'MultiSimInput' });
export type MultiSimInput = z.infer<typeof MultiSimInput>;

export const ImpactInput = z.object({ queueItemId: Uuid }).meta({ id: 'ImpactInput' });
export type ImpactInput = z.infer<typeof ImpactInput>;

/**
 * Job `effort` (TK 7.4, 13; AP-13e): je Projekt (`effort:<projectId>`) oder als Standortlauf einmal je
 * `(site, night)` (`effort:<siteId>:<night>`, NT-08), der die Projekt-Jobs des Standorts anlegt.
 */
export const EffortJobInput = z.union([
  z.object({ projectId: Uuid }).strict(),
  z.object({ siteId: Uuid, night: NightKey }).strict(),
]);
export type EffortJobInput = z.infer<typeof EffortJobInput>;

/** `dedupe_key` ist für `multi_sim` und `impact` Pflicht (TK 7.4, SEC-51). */
export const dedupeKeys = {
  multiSim: (i: Pick<MultiSimInput, 'rigId' | 'nightFrom'>) =>
    `multi_sim:${i.rigId}:${i.nightFrom}`,
  impact: (i: ImpactInput) => `impact:${i.queueItemId}`,
  effort: (projectId: string) => `effort:${projectId}`,
  effortSiteNight: (siteId: string, night: string) => `effort:${siteId}:${night}`,
  reconcileSiteNight: (siteId: string, night: string) => `reconcile:${siteId}:${night}`,
  sessionClose: (sessionId: string) => `session_close:${sessionId}`,
  sessionReport: (sessionId: string) => `session_report:${sessionId}`,
} as const;

export const JobAccepted = z.object({ jobId: Uuid }).meta({ id: 'JobAccepted' });

export const JobView = z
  .object({
    id: Uuid,
    kind: JobKindSchema,
    status: JobStatusSchema,
    attempts: z.number().int(),
    /** Fehlercode aus errors.json bei `failed`, z. B. `validation.failed`. */
    errorCode: z.string().nullable(),
    createdAt: UtcInstant,
    startedAt: UtcInstant.nullable(),
    finishedAt: UtcInstant.nullable(),
    /** Ergebnis vorhanden → Download über `GET /web/v1/files/download-url?purpose=job_result&id=…`. */
    hasResult: z.boolean(),
  })
  .meta({ id: 'JobView' });
export type JobView = z.infer<typeof JobView>;
