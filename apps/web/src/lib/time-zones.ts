/**
 * Zeitzonenfelder (Standort S-11, Mandanteneinstellungen S-71). Gültig ist jede IANA-Zone, die die
 * Laufzeit kennt – dieselbe Prüfung wie `IanaTimeZone` in `packages/shared` (Server). Vorher prüften die
 * Seiten gegen `Intl.supportedValuesOf('timeZone')`; das liefert nur kanonische Namen und kennt je nach
 * Browser weder „UTC“ noch „Asia/Kolkata“ oder „Europe/Kyiv“ (Prüfung 28.09.2026).
 */
import { IanaTimeZone } from '@nina-pm/shared';

export const isTimeZone = (zone: string): boolean => IanaTimeZone.safeParse(zone).success;

/** Vorschläge für die Auswahlliste (`<datalist>`), „UTC“ vorn. */
export function timeZoneSuggestions(): string[] {
  try {
    return ['UTC', ...Intl.supportedValuesOf('timeZone').filter((z) => z !== 'UTC')];
  } catch {
    return ['UTC', 'Europe/Berlin', 'America/Chicago'];
  }
}
