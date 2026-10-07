/**
 * Ist einer Nacht (AP-53c, FA-SIM-10): was die Rig in einer Nacht getan hat, aus `session_event` und `capture` aller
 * Sessions des Rigs – erledigte Blöcke, Filterabschnitte der Aufnahmen, Ereignisse, Lücken mit Grund und Zähler. Der
 * Web-Simulator, „Heute Nacht“ und der Simulator im Plugin zeichnen daraus das Erledigte (blass); das Kommende kommt aus
 * der letzten gespeicherten Planrevision (`StoredPlanInfo`, kräftig). Aufbau: `executedNight` in `executed-night.ts`.
 */
import { z } from 'zod';
import { NightKey, UtcInstant, Uuid } from './common';
import { PlanBlockSchema } from './plan';

const Code = z.string().max(64);

export const ExecutedBlock = z
  .object({
    blockId: Uuid.nullable(),
    nightPlanId: Uuid.nullable(),
    projectId: Uuid,
    panelId: Uuid.nullable(),
    title: z.string().max(300),
    kind: z.enum(['regular', 'transit']),
    /** Beginn des Anfahrens (Plugin ≥ 0.4.13), sonst Beginn der ersten Aufnahme. */
    startUtc: UtcInstant,
    /** Blockende; `null`, solange der Block läuft. */
    endUtc: UtcInstant.nullable(),
    endReason: Code.nullable(),
    exposures: z.number().int().min(0),
    running: z.boolean(),
  })
  .meta({ id: 'ExecutedBlock' });
export type ExecutedBlock = z.infer<typeof ExecutedBlock>;

/** Zusammenhängende Aufnahmen gleichen Filters je Block (Pause ≤ 15 min) – 558 Transit-Frames sind ein Abschnitt. */
export const ExecutedSegment = z
  .object({
    blockId: Uuid.nullable(),
    projectId: Uuid.nullable(),
    filter: Code,
    startUtc: UtcInstant,
    endUtc: UtcInstant,
    saved: z.number().int().min(0),
    failed: z.number().int().min(0),
    exposureS: z.number().min(0),
  })
  .meta({ id: 'ExecutedSegment' });
export type ExecutedSegment = z.infer<typeof ExecutedSegment>;

export const executedEventKinds = [
  'plan_built',
  'plan_rebuilt',
  'block_skipped',
  'skipped_timeaware',
  'safety_pause',
  'safety_resume',
  'af',
  'flip',
  'flats_start',
  'flats_end',
] as const;

export const ExecutedEvent = z
  .object({
    kind: z.enum(executedEventKinds),
    atUtc: UtcInstant,
    blockId: Uuid.nullable(),
    projectId: Uuid.nullable(),
    /** Grund bzw. Code (übersprungen, Neuplanung). */
    code: Code.nullable(),
    durationS: z.number().min(0).nullable(),
    /** Planrevision bei `plan_built`/`plan_rebuilt`. */
    revision: z.number().int().min(1).nullable(),
  })
  .meta({ id: 'ExecutedEvent' });
export type ExecutedEvent = z.infer<typeof ExecutedEvent>;

export const executedGapKinds = ['idle', 'safety', 'flip', 'empty_blocks', 'skipped'] as const;

/** Lücke im Erledigten (schraffiert): Leerlauf, Safety-Pause, Flip, leere Blöcke in Folge, übersprungene Blöcke. */
export const ExecutedGap = z
  .object({
    kind: z.enum(executedGapKinds),
    fromUtc: UtcInstant,
    toUtc: UtcInstant,
    reason: Code.nullable(),
    count: z.number().int().min(1),
  })
  .meta({ id: 'ExecutedGap' });
export type ExecutedGap = z.infer<typeof ExecutedGap>;

export const ExecutedNight = z
  .object({
    night: NightKey,
    sessions: z.number().int().min(0),
    blocks: z.array(ExecutedBlock).max(5000),
    segments: z.array(ExecutedSegment).max(5000),
    events: z.array(ExecutedEvent).max(5000),
    gaps: z.array(ExecutedGap).max(5000),
    counters: z
      .object({
        saved: z.number().int().min(0),
        skipped: z.number().int().min(0),
        failed: z.number().int().min(0),
      })
      .meta({ id: 'ExecutedCounters' }),
  })
  .meta({ id: 'ExecutedNight' });
export type ExecutedNight = z.infer<typeof ExecutedNight>;

/**
 * Letzte gespeicherte Planrevision der Nacht (`night_plan`, `origin = server_plan`) – das, was das Plugin ausführt.
 * `stale`: Die Eingabe hat sich seither geändert (neues Ziele-ETag bzw. höhere Einstellungsversion); das Plugin plant
 * bei neuen Zielen nach höchstens 1 min neu (0.4.12), bei neuen Einstellungen vor dem nächsten Block.
 */
export const StoredPlanInfo = z
  .object({
    nightPlanId: Uuid,
    revision: z.number().int().min(1),
    reason: Code,
    createdAtUtc: UtcInstant,
    stale: z.boolean(),
    staleCause: z.enum(['targets', 'settings']).nullable(),
  })
  .meta({ id: 'StoredPlanInfo' });
export type StoredPlanInfo = z.infer<typeof StoredPlanInfo>;

/** Revision mit Blöcken (Web: Rest-Plan ab jetzt bzw. Ursprungsplan als Umriss). */
export const StoredPlan = StoredPlanInfo.extend({
  blocks: z.array(PlanBlockSchema).max(2000),
}).meta({ id: 'StoredPlan' });
export type StoredPlan = z.infer<typeof StoredPlan>;
