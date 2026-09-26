/**
 * Projektbericht S-63 (AP-34; FA-AUS-18, FA-AUS-10, FA-AUS-11, FA-AUS-13; Sichtbarkeit FA-BER-02): Zeitraum
 * (Nacht-Schlüssel, NT-04), Filter nach Status, Rig und Objekttyp; je Projekt Frames/Integration je Filter
 * und Nacht mit kumuliertem Verlauf, Sessions mit Verworfen-Quote und Wetterbewertung, Bedingungen und
 * Kanalbalance-Hinweis. Druckansicht und CSV entstehen im Browser (kein PDF-Server).
 */
import { z } from 'zod';
import { approvalStatuses, projectStatuses, twilight } from '../generated/enums';
import { NightKey, UtcInstant, Uuid } from './common';

export const ProjectReportQuery = z.object({
  from: NightKey.optional(),
  to: NightKey.optional(),
  status: z.enum(projectStatuses).optional(),
  rigId: Uuid.optional(),
  type: z.enum(['deep_sky', 'exoplanet']).optional(),
});

export const ReportFilterTotal = z
  .object({
    filter: z.string(),
    planned: z.number().int().min(0),
    accepted: z.number().int().min(0),
    remaining: z.number().int().min(0),
    /** Gesamte akzeptierte Integration (alle Nächte) in Sekunden. */
    integrationS: z.number().min(0),
    percentDone: z.number().min(0).max(100),
  })
  .meta({ id: 'ReportFilterTotal' });

/** Frames und Integration je Filter in einer Nacht des Zeitraums (FA-AUS-10/19). */
export const ReportNight = z
  .object({
    night: NightKey,
    filters: z.array(
      z.object({
        filter: z.string(),
        acquired: z.number().int().min(0),
        rejected: z.number().int().min(0),
        accepted: z.number().int().min(0),
        integrationS: z.number(),
        /** Kumulierte akzeptierte Integration des Filters bis einschließlich dieser Nacht (alle Nächte). */
        cumulativeS: z.number(),
      }),
    ),
  })
  .meta({ id: 'ReportNight' });

/** Session des Projekts im Zeitraum (FA-AUS-11). */
export const ReportSession = z
  .object({
    sessionId: Uuid,
    night: NightKey,
    rigName: z.string(),
    status: z.string(),
    filters: z.array(z.object({ filter: z.string(), frames: z.number().int().min(0) })),
    frames: z.number().int().min(0),
    rejectedPct: z.number().min(0).max(100).nullable(),
    /** Bewertung der Nacht aus dem Wetter-Schnappschuss zum Sessionbeginn (AP-30); `null` ohne. */
    weatherRatingIndex: z.number().int().min(0).max(4).nullable(),
  })
  .meta({ id: 'ReportSession' });

/** Kanalbalance (FA-AUS-13): Filter deutlich hinter den übrigen. */
export const ChannelBalanceHint = z
  .object({
    behind: z.array(z.object({ filter: z.string(), percentDone: z.number() })),
    ahead: z.array(z.object({ filter: z.string(), percentDone: z.number() })),
  })
  .meta({ id: 'ChannelBalanceHint' });

export const ReportProject = z
  .object({
    projectId: Uuid,
    name: z.string(),
    projectType: z.enum(['deep_sky', 'exoplanet']),
    targetName: z.string().nullable(),
    rigId: Uuid.nullable(),
    rigName: z.string().nullable(),
    approvalStatus: z.enum(approvalStatuses),
    status: z.enum(projectStatuses).nullable(),
    percentDone: z.number().min(0).max(100),
    filters: z.array(ReportFilterTotal),
    /** Im Zeitraum akzeptierte Frames und Integration. */
    periodAccepted: z.number().int().min(0),
    periodIntegrationS: z.number(),
    nights: z.array(ReportNight),
    sessions: z.array(ReportSession),
    conditions: z.object({
      minAltitudeDeg: z.number(),
      minTimeOnTargetH: z.number(),
      twilight: z.enum(twilight),
      moonAvoidanceEnabled: z.boolean(),
      moonSeparationDeg: z.number(),
    }),
    channelBalance: ChannelBalanceHint.nullable(),
  })
  .meta({ id: 'ReportProject' });
export type ReportProject = z.infer<typeof ReportProject>;

export const ProjectReport = z
  .object({
    from: NightKey.nullable(),
    to: NightKey.nullable(),
    generatedAt: UtcInstant,
    totals: z.object({
      projects: z.number().int().min(0),
      periodAccepted: z.number().int().min(0),
      periodIntegrationS: z.number(),
    }),
    projects: z.array(ReportProject),
  })
  .meta({ id: 'ProjectReport' });
export type ProjectReport = z.infer<typeof ProjectReport>;
