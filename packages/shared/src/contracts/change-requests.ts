/**
 * Änderungsanträge (AP-32b; FA-FRG-08, FA-FRG-04/11/14/15; TK 7.2): Ein User beantragt für sein freigegebenes
 * Objekt eine Änderung; die freigegebene Fassung bleibt bis zur Entscheidung aktiv. Umfang (Entscheidung
 * Sven 26.09.2026): Zeilen (geplante Anzahl, aktiv, neue Zeilen), Bedingungen, Zeitraum (Start/Fälligkeit)
 * und Beschreibung – Koordinaten, Panels und Rig ändert weiterhin nur der Admin.
 *
 * Der Antrag führt eine **eigene Version** (`If-Match` → 412). Die Entscheidung nennt die Projektversion,
 * gegen die entschieden wird: hat sich das Projekt seither geändert, `409 change_request.conflict`, und die
 * Gegenüberstellung zeigt die aktuelle Fassung. Angenommen werden nur die im Antrag geänderten Felder.
 */
import { z } from 'zod';
import { changeRequestStatuses } from '../generated/enums';
import { NightKey, UtcInstant, Uuid } from './common';
import { ConditionsPatch, LineCreate } from './projects';

/** Änderung einer bestehenden Zeile. */
export const ChangeRequestLineChange = z
  .strictObject({
    lineId: Uuid,
    plannedCount: z.number().int().min(0).max(100_000).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((l) => l.plannedCount !== undefined || l.enabled !== undefined, {
    message: 'keine Änderung',
  })
  .meta({ id: 'ChangeRequestLineChange' });

/** Vorschlag (Eingabe). Neue Zeilen wie `LineCreate` (Client-UUID, Panel, Filter …). */
export const ChangeRequestProposal = z
  .strictObject({
    descriptionMd: z.string().max(20_000).optional(),
    startDate: NightKey.nullable().optional(),
    dueDate: NightKey.nullable().optional(),
    conditions: ConditionsPatch.optional(),
    lines: z.array(ChangeRequestLineChange).max(200).default([]),
    newLines: z.array(LineCreate).max(50).default([]),
  })
  .refine(
    (p) =>
      p.descriptionMd !== undefined ||
      p.startDate !== undefined ||
      p.dueDate !== undefined ||
      (p.conditions !== undefined && Object.keys(p.conditions).length > 0) ||
      p.lines.length > 0 ||
      p.newLines.length > 0,
    { message: 'Der Antrag ändert nichts' },
  )
  .meta({ id: 'ChangeRequestProposal' });
export type ChangeRequestProposal = z.infer<typeof ChangeRequestProposal>;

/** Gespeicherter Vorschlag: neue Zeilen zusätzlich mit dem Kurznamen des Filters (vom Server ergänzt). */
export type StoredChangeRequestProposal = Omit<ChangeRequestProposal, 'newLines'> & {
  newLines: (ChangeRequestProposal['newLines'][number] & { filterShortName?: string })[];
};

export const ChangeRequestInput = z
  .strictObject({
    /** Client-UUID (idempotent); ohne Angabe vergibt der Server eine. */
    id: Uuid.optional(),
    proposal: ChangeRequestProposal,
    /** Begründung des Antragstellers. */
    comment: z.string().trim().max(4000).nullable().default(null),
  })
  .meta({ id: 'ChangeRequestInput' });

export const ChangeRequestUpdate = ChangeRequestInput.omit({ id: true }).meta({
  id: 'ChangeRequestUpdate',
});

export const ChangeRequestDecision = z
  .strictObject({
    decision: z.enum(['approved', 'rejected']),
    /** Pflicht beim Ablehnen (FA-FRG-08 „Admin, Kommentar“). */
    comment: z.string().trim().max(4000).nullable().default(null),
    /** Projektversion, gegen die der Admin entschieden hat (Gegenüberstellung) – sonst 409. */
    projectVersion: z.number().int().min(1),
  })
  .refine((d) => d.decision === 'approved' || (d.comment ?? '').length > 0, {
    path: ['comment'],
    message: 'Kommentar fehlt',
  })
  .meta({ id: 'ChangeRequestDecision' });

/** Eine Zeile der Gegenüberstellung alt/neu (gegen die **aktuelle** Fassung des Projekts). */
export const ChangeRequestDiffEntry = z
  .object({
    /** `descriptionMd`, `startDate`, `dueDate`, `conditions.<feld>`, `line.plannedCount`, `line.enabled`, `newLine`. */
    field: z.string(),
    /** Zeile bzw. neue Zeile, auf die sich der Eintrag bezieht. */
    lineId: Uuid.nullable(),
    /** Beschriftung der Zeile („Ha · 300 s · Panel 1“) bzw. `null`. */
    lineLabel: z.string().nullable(),
    current: z.unknown(),
    proposed: z.unknown(),
    /** Aktuelle Fassung entspricht schon dem Vorschlag (z. B. inzwischen vom Admin geändert). */
    unchanged: z.boolean(),
  })
  .meta({ id: 'ChangeRequestDiffEntry' });
export type ChangeRequestDiffEntry = z.infer<typeof ChangeRequestDiffEntry>;

/** Angaben eines Antrags in der Warteschlange (`QueueItem.changeRequest`) und in der Einzelansicht. */
export const ChangeRequestInfo = z
  .object({
    status: z.enum(changeRequestStatuses),
    proposal: z.unknown(),
    comment: z.string().nullable(),
    baseVersion: z.number().int(),
    /** Aktuelle Projektversion – wird bei der Entscheidung mitgeschickt. */
    projectVersion: z.number().int(),
    /** Das Projekt wurde seit der Antragstellung geändert (Gegenüberstellung gegen die aktuelle Fassung). */
    projectChangedSince: z.boolean(),
    diff: z.array(ChangeRequestDiffEntry),
  })
  .meta({ id: 'ChangeRequestInfo' });

export const ChangeRequestView = ChangeRequestInfo.extend({
  id: Uuid,
  projectId: Uuid,
  projectName: z.string(),
  requestedBy: Uuid,
  requestedByName: z.string(),
  version: z.number().int(),
  createdAt: UtcInstant,
  updatedAt: UtcInstant,
  decidedAt: UtcInstant.nullable(),
  decidedByName: z.string().nullable(),
  decisionComment: z.string().nullable(),
}).meta({ id: 'ChangeRequestView' });
export type ChangeRequestView = z.infer<typeof ChangeRequestView>;

export const ChangeRequestList = z
  .object({ items: z.array(ChangeRequestView) })
  .meta({ id: 'ChangeRequestList' });
