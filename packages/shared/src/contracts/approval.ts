/**
 * Freigabe-Workflow (AP-12a; FA-FRG-01…16, FK 6.14; TK 7.2 Warteschlange, Freigabe, Entwürfe):
 * Einreichen/Zurückziehen/Freigeben/Zurückgeben/Ablehnen mit `If-Match`, Stimmen je Mitglied und
 * Gegenstand, Rangfolge des Einreichers, Warteschlange und Entwürfe. `effort` und
 * `suggestedPriorityPosition` bleiben bis AP-13e `null`. Verfall nach `approvalDeadlineDays` →
 * *Zurückgegeben* (Entscheidung Sven, 24.09.2026, wie FA-FRG-09).
 */
import { z } from 'zod';
import { ChangeRequestInfo } from './change-requests';
import { EffortView } from './effort';
import { moonModes, twilight } from '../generated/enums';
import { NightKey, UtcInstant, Uuid } from './common';

const comment = z.string().trim().max(4000);

/** Einreichen (FA-FRG-02): Wunschangaben; fehlt `requestedRigId`, gilt das Rig des Entwurfs. */
export const SubmitInput = z
  .object({
    requestedRigId: Uuid.nullable().optional(),
    requestPeriodFrom: NightKey.nullable().optional(),
    requestPeriodTo: NightKey.nullable().optional(),
    requestComment: comment.nullable().optional(),
  })
  .strict()
  .refine(
    (s) => !s.requestPeriodFrom || !s.requestPeriodTo || s.requestPeriodFrom <= s.requestPeriodTo,
    { path: ['requestPeriodTo'], message: 'Ende vor Beginn' },
  )
  .meta({ id: 'SubmitInput' });
export type SubmitInput = z.infer<typeof SubmitInput>;

/** Freigeben (FA-FRG-06): Rig, Position je Rig (ohne Angabe: ans Ende), Projektstatus, Termine. */
export const ApproveInput = z
  .object({
    rigId: Uuid,
    priorityPosition: z.number().int().min(1).optional(),
    status: z.enum(['planning', 'active']),
    startDate: NightKey.nullable().optional(),
    dueDate: NightKey.nullable().optional(),
    comment: comment.nullable().optional(),
    /** Rig-Wechsel trotz Konflikten (FA-RIG-12), sonst `409 approval.rig_conflict`. */
    acceptRigConflicts: z.boolean().optional(),
  })
  .strict()
  .meta({ id: 'ApproveInput' });
export type ApproveInput = z.infer<typeof ApproveInput>;

/** Zurückgeben/Ablehnen (FA-FRG-07): Kommentar ist Pflicht. */
export const DecisionComment = z
  .object({ comment: z.string().trim().min(1).max(4000) })
  .strict()
  .meta({ id: 'DecisionComment' });

/**
 * Gegenstand in Pfaden und Rangfolge: Projekt oder (ab R3) Änderungsantrag – Schreibweise der URL
 * (`/queue/{kind}/{id}/vote`); in der Datenbank `voteSubjectKinds` (`change_request`).
 */
export const QueueKind = z.enum(['project', 'change-request']);
export type QueueKind = z.infer<typeof QueueKind>;

/** Rangfolge der eigenen offenen Gegenstände (FA-FRG-15): vollständige Liste, sonst 422. */
export const SubmissionRanking = z
  .object({
    items: z
      .array(z.object({ kind: QueueKind, id: Uuid }).strict())
      .max(500)
      .refine((items) => new Set(items.map((i) => `${i.kind}:${i.id}`)).size === items.length, {
        message: 'doppelt',
      }),
  })
  .strict()
  .meta({ id: 'SubmissionRanking' });
export type SubmissionRanking = z.infer<typeof SubmissionRanking>;

// ---- Ansichten ------------------------------------------------------------------------------------

export const QueueVoter = z.object({
  memberId: Uuid,
  displayName: z.string(),
  /** Inhalt seit der Stimme geändert (Admin-Änderung bzw. erneute Einreichung, FA-FRG-14). */
  changedSinceVote: z.boolean(),
});

export const QueueVotes = z
  .object({
    count: z.number().int(),
    voters: z.array(QueueVoter),
    mine: z.boolean(),
    mineChangedSince: z.boolean(),
  })
  .meta({ id: 'QueueVotes' });

/** Plan-Chip je aktiver Zeile („Ha 40 × 300 s“, FA-FRG-04). */
export const PlanChip = z.object({
  filterId: Uuid.nullable(),
  filterShortName: z.string(),
  count: z.number().int(),
  exposureS: z.number(),
  gain: z.number().int().nullable(),
  offset: z.number().int().nullable(),
  binning: z.number().int(),
  readoutMode: z.string().nullable(),
  moonMode: z.enum(moonModes),
  moonProfileId: Uuid.nullable(),
});

export const QueueItem = z
  .object({
    kind: QueueKind,
    id: Uuid,
    projectId: Uuid,
    name: z.string(),
    projectType: z.enum(['deep_sky', 'exoplanet']),
    targetName: z.string().nullable(),
    targetType: z.string().nullable(),
    /** Katalogobjekt und Bild des Bildfelds – Vorschaubild in der Warteschlange (AP-26h). */
    dsoPrimaryId: z.string().nullable(),
    thumbnailUrl: z.string().nullable(),
    createdBy: Uuid,
    createdByName: z.string(),
    submittedAt: UtcInstant.nullable(),
    /** Verfall nach `approvalDeadlineDays` ab Einreichung; `null` = keine Frist (FA-FRG-04 „Frist“). */
    expiresAt: UtcInstant.nullable(),
    requestedRigId: Uuid.nullable(),
    /** Ziel J2000 (Panel 1 bzw. Projektkoordinaten); `null` ohne Koordinaten – für die Sichtbarkeit (AP-24). */
    target: z.object({ raDeg: z.number(), decDeg: z.number() }).nullable(),
    /** Bedingungen der Sichtbarkeit „4 Wochen“ (S-33, AP-24): Mindesthöhe, Mindestzeit, Dämmerung. */
    conditions: z.object({
      minAltitudeDeg: z.number(),
      minTimeOnTargetH: z.number(),
      twilight: z.enum(twilight),
    }),
    startDate: NightKey.nullable(),
    requestPeriodFrom: NightKey.nullable(),
    requestPeriodTo: NightKey.nullable(),
    requestComment: z.string().nullable(),
    /** Erneut eingereicht nach Überarbeitung bzw. vom Admin geändert (FA-FRG-14). */
    contentChangedAt: UtcInstant.nullable(),
    votes: QueueVotes,
    submitterRank: z.object({ rank: z.number().int(), of: z.number().int() }).nullable(),
    planSummary: z.array(PlanChip),
    panelCount: z.number().int(),
    estimatedHours: z.number(),
    /** Aufwand-Kennzeichen (AP-13e); `null` = noch nicht berechnet. */
    effort: EffortView.nullable(),
    /** Vorschlag der Einfügeposition in die Rig-Priorität (FA-FRG-16), nur für Admins. */
    suggestedPriorityPosition: z.number().int().nullable(),
    /** Bei `kind = project` die Projektversion, bei `change-request` die Version des Antrags. */
    version: z.number().int(),
    /** Nur bei Änderungsanträgen (AP-32b): Vorschlag, Gegenüberstellung, Projektversion. */
    changeRequest: ChangeRequestInfo.nullable(),
  })
  .meta({ id: 'QueueItem' });
export type QueueItem = z.infer<typeof QueueItem>;
