/**
 * „Klar laut Bildern“ je Nacht für die Standort-Statistik (AP-72, FA-AUS-24): Bezug je Projekt und Filter aus allen
 * Lights des Zeitraums, Urteil je Stunde (`clarityByHour`) und je Nacht (`nightClarity`).
 */
import {
  clarityByHour,
  clearShare,
  medianOf,
  nightClarity,
  type QualityRef,
} from '@nina-pm/shared';
import type { NightLights } from '@nina-pm/db';

export function imagesClarityByNight(
  nights: readonly NightLights[],
): Map<string, { verdict: 'clear' | 'thin' | 'cloudy'; clearPct: number }> {
  const groups = new Map<
    string,
    { projectId: string; filter: string; stars: number[]; adu: number[]; n: number }
  >();
  for (const night of nights)
    for (const l of night.lights) {
      if (!l.projectId) continue;
      const key = `${l.projectId}|${l.filter}`;
      let g = groups.get(key);
      if (!g) {
        g = { projectId: l.projectId, filter: l.filter, stars: [], adu: [], n: 0 };
        groups.set(key, g);
      }
      g.n++;
      if (l.stars !== null) g.stars.push(l.stars);
      if (l.medianAdu !== null) g.adu.push(l.medianAdu);
    }
  const refs: QualityRef[] = [...groups.values()].map((g) => ({
    projectId: g.projectId,
    filter: g.filter,
    stars: medianOf(g.stars),
    hfr: null,
    medianAdu: medianOf(g.adu),
    n: g.n,
  }));
  const byNight = new Map<string, NightLights['lights']>();
  for (const n of nights) byNight.set(n.night, [...(byNight.get(n.night) ?? []), ...n.lights]);
  const out = new Map<string, { verdict: 'clear' | 'thin' | 'cloudy'; clearPct: number }>();
  for (const [night, lights] of byNight) {
    const hours = clarityByHour(lights, refs);
    const verdict = nightClarity(hours);
    const share = clearShare(hours);
    if (verdict !== null && share !== null)
      out.set(night, { verdict, clearPct: Math.round(share * 100) });
  }
  return out;
}
