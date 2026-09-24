/**
 * `SiteTime` (NT-03, rules/ui.md): Nachtereignisse in **Standortzeit mit Kürzel** („21:08 CDT“), nie in
 * der Browserzone. Fristen ohne Standortbezug in Mandantenzeit, Standortzeit im Tooltip. Uhrzeiten
 * innerhalb einer genannten Nacht ohne Datum; sonst mit Kalenderdatum in derselben Zone.
 */
import { formatTzAbbr, formatZonedTime } from '@nina-pm/shared';
import { useTranslation } from 'react-i18next';

export interface SiteTimeProps {
  /** Zeitpunkt ISO-8601 UTC. */
  atUtc: string;
  /** IANA-Zone des Standorts. */
  siteTimeZone: string;
  /** `night`: Nachtereignis (Standortzeit); `deadline`: ohne Standortbezug (Mandantenzeit). */
  mode?: 'night' | 'deadline';
  /** Mandantenzeitzone (`tenantTimezone`) für `deadline`. */
  tenantTimeZone?: string;
  /** Kalenderdatum anzeigen (Uhrzeit ohne Nachtbezug). */
  withDate?: boolean;
}

function formatDate(atUtc: string, timeZone: string, lang: string): string {
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'de-DE', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(Date.parse(atUtc)));
}

export function SiteTime({
  atUtc,
  siteTimeZone,
  mode = 'night',
  tenantTimeZone,
  withDate,
}: SiteTimeProps) {
  const { t, i18n } = useTranslation();
  const zone = mode === 'deadline' && tenantTimeZone ? tenantTimeZone : siteTimeZone;
  const text = `${withDate ? `${formatDate(atUtc, zone, i18n.language)} ` : ''}${formatZonedTime(atUtc, zone)} ${formatTzAbbr(atUtc, zone)}`;
  const site = `${formatZonedTime(atUtc, siteTimeZone)} ${formatTzAbbr(atUtc, siteTimeZone)}`;
  const title =
    mode === 'deadline' && tenantTimeZone
      ? t('time.tenantTimeHint', { zone: tenantTimeZone, site })
      : t('time.siteTimeHint', { zone: siteTimeZone });
  return (
    <time dateTime={atUtc} title={title}>
      {text}
    </time>
  );
}
