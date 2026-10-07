/**
 * Ist und gespeicherter Plan einer Nacht (AP-53c, FA-SIM-10): für den Web-Simulator, „Heute Nacht“ und den Simulator im
 * Plugin dieselben Daten.
 * - **Ist** aus `session_event` und `capture` aller Sessions des Rigs in der Nacht (`executedNight`), sonst `null`.
 * - **Gespeicherter Plan:** letzte Serverrevision (das, was das Plugin ausführt) und erste (Ursprungsplan).
 * - **`stale`:** Die Rig plant noch mit älterer Eingabe, wenn das Ziele-ETag der Revision nicht mehr dem aktuellen
 *   entspricht (Projekt, Zeile, Transit, Filterrad geändert) bzw. die Einstellungsversion gestiegen ist. Nur für die
 *   aktuelle und die folgende Nacht – vergangene Nächte sind abgeschlossen.
 */
import type { StoredServerPlan } from '@nina-pm/db';
import { executedNight, type ExecutedNight, type StoredPlan } from '@nina-pm/shared';
import { isoUtc } from '../lib/format';
import type { ApiServices } from '../routes/services';
import { targets, type RigDataResult, type RigRef } from './sync';

export interface NightActual {
  executed: ExecutedNight | null;
  /** `names` des Aufrufers plus die Namen belichteter Projekte, die nicht mehr im Plan stehen (07.10.2026). */
  names: ReadonlyMap<string, string>;
  storedPlan: StoredPlan | null;
  firstPlan: StoredPlan | null;
  /**
   * Blöcke, die das Plugin beendet bzw. übersprungen hat (`block_end`, `block_skipped`) – auch leere, die im Ist nur als
   * Lücke stehen. Das Web zeigt sie nicht mehr als „geplant“ (07.10.2026); nur `GET /web/v1/simulations/input`.
   */
  endedBlockIds: string[];
}

export async function nightActual(
  svc: ApiServices,
  ref: RigRef,
  d: RigDataResult,
  o: { night: string; currentNight: string; now: Date; names: ReadonlyMap<string, string> },
): Promise<NightActual> {
  const repo = d.repos.ninaRig(ref.rigId);
  const [actual, plans] = await Promise.all([repo.nightActual(o.night), repo.serverPlans(o.night)]);

  // Belichtete Projekte außerhalb der Eingabe (fertig, pausiert, Transit vorbei): Namen nachladen, sonst stehen Ist-Blöcke
  // und „Heute Nacht abgearbeitet“ ohne Namen da (07.10.2026).
  const missing = [...actual.lights, ...actual.events]
    .map((x) => x.projectId)
    .filter((id): id is string => id !== null && !o.names.has(id));
  const names = new Map([...o.names, ...(await d.repos.projects().names(missing))]);

  const blockKinds = new Map<string, 'regular' | 'transit'>();
  // Geplanter Beginn je Block: Plugin vor 0.4.13 meldet keinen block_start (Anfahren/Autofokus sonst „Leerlauf“).
  const blockStarts = new Map<string, string>();
  for (const p of [plans.first, plans.latest])
    for (const b of (p?.blocks ?? []) as { id?: string; kind?: string; startUtc?: string }[])
      if (b.id) {
        blockKinds.set(b.id, b.kind === 'transit' ? 'transit' : 'regular');
        if (typeof b.startUtc === 'string') blockStarts.set(b.id, b.startUtc);
      }
  // Blöcke aus Zwischenrevisionen (Analyse 07.10.2026): eine Transit-Aufnahme macht ihren Block zum Transitblock – sonst
  // erschiene er bei Plugins vor 0.4.13 (ohne `block_start.data.kind`) als regulär.
  for (const l of actual.lights)
    if (l.blockId && l.transitObservationId) blockKinds.set(l.blockId, 'transit');
  const endedBlockIds = [
    ...new Set(
      actual.events
        .filter((e) => (e.kind === 'block_end' || e.kind === 'block_skipped') && e.blockId)
        .map((e) => e.blockId as string),
    ),
  ];

  const executed =
    actual.sessions.length === 0
      ? null
      : executedNight({
          night: o.night,
          sessions: actual.sessions.length,
          events: actual.events.map((e) => ({
            occurredAt: isoUtc(e.occurredAt),
            kind: e.kind,
            blockId: e.blockId,
            projectId: e.projectId,
            nightPlanId: e.nightPlanId,
            durationS: e.durationS,
            data: (typeof e.data === 'string' ? JSON.parse(e.data) : e.data) as Record<
              string,
              unknown
            > | null,
          })),
          lights: actual.lights.map((l) => ({
            capturedAt: isoUtc(l.capturedAt),
            exposureS: l.exposureS,
            result: l.result,
            filter: l.filter,
            blockId: l.blockId,
            projectId: l.projectId,
            panelId: l.panelId,
            nightPlanId: l.nightPlanId,
          })),
          running: actual.sessions.some((s) => s.status === 'running'),
          now: isoUtc(o.now),
          names,
          blockKinds,
          blockStarts,
        });

  // „Rig plant noch mit Rev. n“ nur für Nächte, die noch laufen bzw. kommen.
  let stale: { stale: boolean; staleCause: 'targets' | 'settings' | null } = {
    stale: false,
    staleCause: null,
  };
  if (plans.latest && o.night >= o.currentNight) {
    const summary = plans.latest.summary;
    const settings = typeof summary.settingsVersion === 'number' ? summary.settingsVersion : null;
    const etag = typeof summary.targetsEtag === 'string' ? summary.targetsEtag : null;
    if (settings !== null && settings < d.rig.settingsVersion)
      stale = { stale: true, staleCause: 'settings' };
    else if (etag !== null && (await targets(svc, ref)).etag !== etag)
      stale = { stale: true, staleCause: 'targets' };
  }
  const view = (p: StoredServerPlan | null, withStale: boolean): StoredPlan | null =>
    p
      ? {
          nightPlanId: p.id,
          revision: p.revision,
          reason: p.reason,
          createdAtUtc: isoUtc(p.createdAt),
          ...(withStale ? stale : { stale: false, staleCause: null }),
          blocks: p.blocks as StoredPlan['blocks'],
        }
      : null;
  return {
    executed,
    names,
    storedPlan: view(plans.latest, true),
    firstPlan: view(plans.first, false),
    endedBlockIds,
  };
}
