/**
 * Planrevisionen von `POST /plan` (TK 7.3, NT-09; Analyse 07.10.2026):
 * - `planContentKey`: Inhalt eines Serverplans ohne die Werte, die nur aus `startAtUtc` folgen (`nightPlanId`,
 *   `inputHash`, `outputHash`, `startAtUtc`, Block-IDs). Gleicher Schlüssel wie die letzte Revision der Session → keine
 *   neue Revision; der Server antwortet mit der gespeicherten (`savePlan`, `execution.md` §3.2). Die Engine bleibt
 *   unverändert – `startAtUtc` gehört zu ihrer Eingabe und damit zur `nightPlanId`.
 * - `PlanRequestRate`: mehr als `PLAN_STORM_LIMIT` Planabrufe einer Session in `PLAN_STORM_WINDOW_MS` → Warnung im Log
 *   (keine Ablehnung; Zählung je Lambda-Container, also eine Untergrenze).
 */
import { canonicalInputJson, sha256hex } from '@nina-pm/engine';

/** Planabrufe einer Session, ab denen gewarnt wird. */
export const PLAN_STORM_LIMIT = 20;
export const PLAN_STORM_WINDOW_MS = 60_000;

interface PlanLike {
  readonly blocks: readonly { readonly id?: unknown; readonly startUtc?: unknown }[];
}

/**
 * Inhaltsschlüssel eines Serverplans (`sha256` über kanonisches JSON) samt Ziele-ETag und Einstellungsversion der
 * Anfrage – ändern sie sich, entsteht eine neue Revision, damit „Rig plant noch mit Rev. n“ (AP-53c) stimmt.
 */
export function planContentKey<P extends PlanLike>(
  plan: P,
  extra: { readonly targetsEtag: string | null; readonly settingsVersion: number },
): string {
  const content = {
    ...omit(plan, ['nightPlanId', 'inputHash', 'outputHash', 'startAtUtc', 'blocks']),
    blocks: plan.blocks.map((b) => omit(b, ['id'])),
    targetsEtag: extra.targetsEtag,
    settingsVersion: extra.settingsVersion,
  };
  return `sha256:${sha256hex(canonicalInputJson(content))}`;
}

/** Objekt ohne die genannten Schlüssel (flach). */
export function omit(value: object, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([k]) => !keys.includes(k)));
}

/**
 * Darf eine inhaltsgleiche Revision wiederverwendet werden? Nur wenn kein Block vor `now` beginnt: dann hat das Plugin
 * aus der gespeicherten Revision noch keinen dieser Blöcke begonnen, und deren erledigte Blöcke gehen nicht verloren.
 */
export function reusablePlan<P extends PlanLike>(plan: P, now: Date): boolean {
  return plan.blocks.every(
    (b) => typeof b.startUtc === 'string' && Date.parse(b.startUtc) >= now.getTime(),
  );
}

/** Planabrufe je Session im gleitenden Fenster (Schutz gegen Abrufstürme, nur Warnung). */
export class PlanRequestRate {
  private readonly calls = new Map<string, number[]>();

  constructor(
    private readonly limit = PLAN_STORM_LIMIT,
    private readonly windowMs = PLAN_STORM_WINDOW_MS,
  ) {}

  /** Abruf zählen; liefert die Zahl im Fenster, wenn sie über der Grenze liegt, sonst `null`. */
  record(sessionId: string, now: Date): number | null {
    const from = now.getTime() - this.windowMs;
    const list = (this.calls.get(sessionId) ?? []).filter((t) => t > from);
    list.push(now.getTime());
    this.calls.set(sessionId, list);
    // Alte Sessions nicht ewig halten (Lambda-Container leben Stunden).
    if (this.calls.size > 200)
      for (const [key, times] of this.calls)
        if ((times.at(-1) ?? 0) <= from) this.calls.delete(key);
    return list.length > this.limit ? list.length : null;
  }
}
