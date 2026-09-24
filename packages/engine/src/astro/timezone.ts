/**
 * Zeitzonen nur aus der Übergangstabelle des Servers (night.md §1, NT-02) – nie aus `Intl`.
 * Erster Eintrag = letzter Übergang vor Tabellenbeginn (liefert den Anfangs-Offset).
 */
import { daysFromKey, EngineInputError } from './time';

export interface TimeZoneTransition {
  /** Unix-Sekunden (UTC) des Übergangs. */
  readonly atUtc: number;
  /** Offset ab diesem Zeitpunkt in Minuten (Chicago Sommerzeit −300). */
  readonly utcOffsetMinutes: number;
}

/** Offset in Minuten, der zum UTC-Zeitpunkt gilt. */
export function offsetMinutesAt(
  transitions: readonly TimeZoneTransition[],
  unixSec: number,
): number {
  const first = transitions[0];
  if (!first) throw new EngineInputError('engine.input_invalid', 'leere Übergangstabelle');
  let offset = first.utcOffsetMinutes;
  for (const t of transitions) {
    if (t.atUtc <= unixSec) offset = t.utcOffsetMinutes;
    else break;
  }
  return offset;
}

/**
 * Lokale Zeit (Sekunden seit 1970-01-01 in Ortszeit) → UTC. Gibt es die Ortszeit nicht (Sprung) oder
 * mehrfach (Rückstellung), liefert sie `null` bzw. den **frühesten** UTC-Zeitpunkt.
 */
export function localToUtc(
  transitions: readonly TimeZoneTransition[],
  localSec: number,
): number | null {
  const offsets: number[] = [];
  for (const t of transitions)
    if (!offsets.includes(t.utcOffsetMinutes)) offsets.push(t.utcOffsetMinutes);
  let best: number | null = null;
  for (const off of offsets) {
    const utc = localSec - off * 60;
    if (offsetMinutesAt(transitions, utc) === off && (best === null || utc < best)) best = utc;
  }
  return best;
}

/**
 * Grenzen einer Nacht (night.md §1): lokaler Mittag des Schlüsseldatums bis lokaler Mittag des
 * Folgetags (23/24/25 h). Existiert der lokale Mittag nicht (Datumslinie, z. B. Pacific/Apia
 * 30.12.2011) → `validation.failed`.
 */
export function nightBounds(
  night: string,
  transitions: readonly TimeZoneTransition[],
): { noonStartUtc: number; noonEndUtc: number } {
  const days = daysFromKey(night);
  const start = localToUtc(transitions, days * 86400 + 43200);
  const end = localToUtc(transitions, (days + 1) * 86400 + 43200);
  if (start === null || end === null)
    throw new EngineInputError(
      'validation.failed',
      `Nacht ${night} existiert in dieser Zeitzone nicht`,
    );
  return { noonStartUtc: start, noonEndUtc: end };
}

/** Lokale Uhrzeit (Sekunden nach Mitternacht) am Schlüsseldatum → UTC (z. B. 18:00 im Polartag-Zweig). */
export function localTimeOfNightUtc(
  night: string,
  secondsAfterMidnight: number,
  transitions: readonly TimeZoneTransition[],
): number {
  const utc = localToUtc(transitions, daysFromKey(night) * 86400 + secondsAfterMidnight);
  if (utc === null)
    throw new EngineInputError('validation.failed', `Ortszeit in Nacht ${night} existiert nicht`);
  return utc;
}
