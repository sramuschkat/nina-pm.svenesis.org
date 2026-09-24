/**
 * Zeitpunkte mit Datum, Uhrzeit und Zonenkürzel in einer **genannten** Zone (FK 8.1, NT-03) – nie in der
 * Browserzone. Für Protokolle und Listen ohne Standortbezug (Mandanten- bzw. Betreiberzeit).
 */
import { DEFAULT_TENANT_TIMEZONE, formatTzAbbr, formatZonedTime } from '@nina-pm/shared';

/** Zone für den System-Kontext (kein Mandant): Betreiberzeit wie der Standard der Mandanten. */
export const SYSTEM_TIMEZONE = DEFAULT_TENANT_TIMEZONE;

export function formatDate(atUtc: string, timeZone: string, lang: string): string {
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'de-DE', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(Date.parse(atUtc)));
}

/** „24.09.2026 12:00 MESZ“. */
export function formatDateTime(atUtc: string, timeZone: string, lang: string): string {
  return `${formatDate(atUtc, timeZone, lang)} ${formatZonedTime(atUtc, timeZone)} ${formatTzAbbr(atUtc, timeZone)}`;
}
