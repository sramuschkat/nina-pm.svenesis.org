/**
 * Zeitraum des Aufwand-Kennzeichens (`effort.md` „Eingabe“, FK 8.9): Wunschzeitraum der Einreichung,
 * sonst `heute … Saisonende`, höchstens 180 Nächte. „heute“ = `currentNight` des Rig-Standorts (NT-01).
 */
import { daysFromKey, keyFromDays } from '../astro/time';
import { EFFORT_MAX_NIGHTS } from './estimate';

export interface EffortPeriodInput {
  readonly currentNight: string;
  readonly requestFrom: string | null;
  readonly requestTo: string | null;
  /** Saisonende aus `seasonWindow` (`null` = zirkumpolar bzw. keine Pause im Suchzeitraum). */
  readonly seasonEnd: string | null;
}

/**
 * Wunschzeitraum vor `currentNight` wird auf `currentNight` gekürzt; liegt er ganz in der Vergangenheit,
 * gilt der Standardzeitraum bis Saisonende. Ohne Saisonende 180 Nächte.
 */
export function effortPeriod(input: EffortPeriodInput): { fromNight: string; toNight: string } {
  const today = daysFromKey(input.currentNight);
  const cap = (from: number, to: number) => ({
    fromNight: keyFromDays(from),
    toNight: keyFromDays(Math.min(to, from + EFFORT_MAX_NIGHTS - 1)),
  });
  const reqTo = input.requestTo === null ? null : daysFromKey(input.requestTo);
  if (input.requestFrom !== null || reqTo !== null) {
    const from = Math.max(
      today,
      input.requestFrom === null ? today : daysFromKey(input.requestFrom),
    );
    const seasonTo = input.seasonEnd === null ? null : daysFromKey(input.seasonEnd);
    const to =
      reqTo ?? (seasonTo !== null && seasonTo >= from ? seasonTo : from + EFFORT_MAX_NIGHTS - 1);
    if (to >= from) return cap(from, to);
  }
  const seasonTo = input.seasonEnd === null ? null : daysFromKey(input.seasonEnd);
  const to = seasonTo !== null && seasonTo >= today ? seasonTo : today + EFFORT_MAX_NIGHTS - 1;
  return cap(today, to);
}
