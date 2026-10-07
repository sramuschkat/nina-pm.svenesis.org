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
  storedPlan: StoredPlan | null;
  firstPlan: StoredPlan | null;
}

export async function nightActual(
  svc: ApiServices,
  ref: RigRef,
  d: RigDataResult,
  o: { night: string; currentNight: string; now: Date; names: ReadonlyMap<string, string> },
): Promise<NightActual> {
  const repo = d.repos.ninaRig(ref.rigId);
  const [actual, plans] = await Promise.all([repo.nightActual(o.night), repo.serverPlans(o.night)]);

  const blockKinds = new Map<string, 'regular' | 'transit'>();
  for (const p of [plans.first, plans.latest])
    for (const b of (p?.blocks ?? []) as { id?: string; kind?: string }[])
      if (b.id) blockKinds.set(b.id, b.kind === 'transit' ? 'transit' : 'regular');

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
          lights: actual.lights.map((l) => ({ ...l, capturedAt: isoUtc(l.capturedAt) })),
          running: actual.sessions.some((s) => s.status === 'running'),
          now: isoUtc(o.now),
          names: o.names,
          blockKinds,
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
  return { executed, storedPlan: view(plans.latest, true), firstPlan: view(plans.first, false) };
}
