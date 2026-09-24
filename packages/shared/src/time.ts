/**
 * Zeitanzeige (NT-03, rules/ui.md): Zeitzonen-Kürzel und Doppeldatum. `Intl` dient **nur** der Anzeige;
 * Datumslogik läuft über Temporal bzw. die Nacht-Tabelle des Servers.
 */

const GMT_OFFSET = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/;

function shortZoneName(locale: string, atUtc: Date, timeZone: string): string {
  const part = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'short' })
    .formatToParts(atUtc)
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? 'UTC';
}

/**
 * Zeitzonen-Kürzel für einen Zeitpunkt in einer IANA-Zone: `de-DE` (z. B. „MESZ“); ergibt das nur
 * `GMT±x`, dann `en-US` (z. B. „CDT“); ergibt auch das `GMT±x`, dann `UTC±h` bzw. `UTC±h:mm`.
 */
export function formatTzAbbr(atUtc: Date | string, timeZone: string): string {
  const at = typeof atUtc === 'string' ? new Date(Date.parse(atUtc)) : atUtc;
  const de = shortZoneName('de-DE', at, timeZone);
  if (!GMT_OFFSET.test(de)) return de;
  const en = shortZoneName('en-US', at, timeZone);
  const m = GMT_OFFSET.exec(en);
  if (!m) return en;
  const [, sign, h, mm] = m;
  return `UTC${sign}${Number(h)}${mm && mm !== '00' ? `:${mm}` : ''}`;
}

/** Uhrzeit `HH:mm` in der Zone (24 h). */
export function formatZonedTime(atUtc: Date | string, timeZone: string): string {
  const at = typeof atUtc === 'string' ? new Date(Date.parse(atUtc)) : atUtc;
  return new Intl.DateTimeFormat('de-DE', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
}

/** Doppeldatum einer Nacht (rules/ui.md): Schlüssel `2026-09-17` → „17./18.09.“, über den Monatswechsel „30.09./01.10.“. */
export function formatNightKey(night: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(night);
  if (!m) throw new Error(`Nacht-Schlüssel erwartet: ${night}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Reine Kalenderrechnung ohne Zeitzone: Tage im Monat über UTC-Datum.
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const nextDay = d === daysInMonth ? 1 : d + 1;
  const nextMonth = d === daysInMonth ? (mo === 12 ? 1 : mo + 1) : mo;
  const dd = (n: number) => String(n).padStart(2, '0');
  return nextMonth === mo
    ? `${dd(d)}./${dd(nextDay)}.${dd(mo)}.`
    : `${dd(d)}.${dd(mo)}./${dd(nextDay)}.${dd(nextMonth)}.`;
}
