/**
 * Saisonbeginn und Saisonende (FK 8.1, FA-SIC-02/04; night.md §1 „Saisonsuche nur online“):
 * Saisonende = die erste Nacht ab heute, nach der das Ziel mindestens 30 Nächte in Folge weniger
 * nutzbare Zeit als die Mindestzeit hat; ist das Ziel heute außerhalb der Saison, ist der Saisonbeginn
 * die erste Nacht mit ausreichender Zeit und das Saisonende die erste Pause danach. Ohne Pause im
 * Suchzeitraum (zirkumpolar, nie pausierend) gibt es kein Saisonende.
 *
 * „Ausreichend“ heißt: der **längste zusammenhängende** nutzbare Lauf der Nacht erreicht die Mindestzeit –
 * dieselbe Bedingung, mit der eine Einheit an einer Nacht überhaupt teilnimmt (allocation.md §3.2).
 */
import type { Site } from '../astro/horizon';
import type { Target } from '../astro/target';
import type { TimeZoneTransition } from '../astro/timezone';
import { buildEligibility, type TwilightLimit } from './eligibility';
import { buildNightContext, SLOT_SECONDS } from './night-context';

/** Länge der Pause, ab der die Saison endet (FK 8.1). */
export const SEASON_PAUSE_NIGHTS = 30;

export interface SeasonInput {
  readonly site: Site;
  /** Aufeinanderfolgende Nacht-Schlüssel ab „heute“ (`currentNight`) aus der Server-Tabelle, ≤ 365. */
  readonly nights: readonly string[];
  readonly timeZoneTransitions: readonly TimeZoneTransition[];
  readonly target: Target;
  readonly twilight: TwilightLimit;
  readonly minAltDeg: number;
  /** Mindestzeit am Ziel in Sekunden. */
  readonly minTimeSec: number;
  readonly startDate?: string | null;
}

export interface SeasonNight {
  readonly night: string;
  readonly usableSec: number;
  readonly longestRunSec: number;
  readonly sufficient: boolean;
}

export interface SeasonResult {
  /** `never`: in keiner Nacht ausreichend (bzw. nie über der Mindesthöhe). */
  readonly status: 'in_season' | 'out_of_season' | 'never';
  /** Nur bei `out_of_season`: erste Nacht mit ausreichender Zeit. */
  readonly seasonStart: string | null;
  /** Letzte Nacht vor der ersten Pause von ≥ 30 Nächten; `null` = kein Saisonende im Suchzeitraum. */
  readonly seasonEnd: string | null;
  /** Nutzbare Sekunden von der ersten Nacht bis einschließlich Saisonende (FA-SIC-04). */
  readonly usableSecToSeasonEnd: number;
  readonly nights: readonly SeasonNight[];
}

/** Letzte ausreichende Nacht ab `from`, auf die ≥ 30 nicht ausreichende Nächte folgen; sonst `null`. */
function pauseAfter(ok: readonly boolean[], from: number): number | null {
  for (let i = from; i < ok.length; i += 1) {
    if (!ok[i]) continue;
    const end = i + SEASON_PAUSE_NIGHTS;
    if (end >= ok.length) return null;
    let pause = true;
    for (let j = i + 1; j <= end; j += 1) {
      if (ok[j]) {
        pause = false;
        break;
      }
    }
    if (pause) return i;
  }
  return null;
}

export function seasonWindow(input: SeasonInput): SeasonResult {
  const nights: SeasonNight[] = [];
  let never = false;
  for (const night of input.nights) {
    // Vorfilter (AST-N11): ergibt die erste Nacht „nie sichtbar“, entfällt der Rasterlauf für den Rest.
    if (never) {
      nights.push({ night, usableSec: 0, longestRunSec: 0, sufficient: false });
      continue;
    }
    const ctx = buildNightContext({
      site: input.site,
      night,
      timeZoneTransitions: input.timeZoneTransitions,
      includeMoon: false,
    });
    const e = buildEligibility(ctx, {
      target: input.target,
      twilight: input.twilight,
      minAltDeg: input.minAltDeg,
      startDate: input.startDate ?? null,
    });
    never = e.visibility === 'never';
    const longestRunSec = e.longestRunSlots * SLOT_SECONDS;
    nights.push({
      night,
      usableSec: e.usableSlots * SLOT_SECONDS,
      longestRunSec,
      sufficient: longestRunSec >= input.minTimeSec,
    });
  }
  const ok = nights.map((n) => n.sufficient);
  const startIndex = ok.indexOf(true);
  if (startIndex < 0)
    return { status: 'never', seasonStart: null, seasonEnd: null, usableSecToSeasonEnd: 0, nights };
  const endIndex = pauseAfter(ok, startIndex);
  const until = endIndex ?? nights.length - 1;
  let usable = 0;
  for (let i = 0; i <= until; i += 1) usable += (nights[i] as SeasonNight).usableSec;
  return {
    status: startIndex === 0 ? 'in_season' : 'out_of_season',
    seasonStart: startIndex === 0 ? null : (nights[startIndex] as SeasonNight).night,
    seasonEnd: endIndex === null ? null : (nights[endIndex] as SeasonNight).night,
    usableSecToSeasonEnd: usable,
    nights,
  };
}
