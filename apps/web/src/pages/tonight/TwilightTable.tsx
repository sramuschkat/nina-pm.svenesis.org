/**
 * Kachel „Dunkel“ auf der Startseite „Heute“ (AP-73, FA-FOL-11; Sven 09.10.2026): nautische und astronomische
 * Dämmerung je Abend und Morgen in Standortzeit. Weicht die Zeitzone des Geräts ab, steht die eigene Zeit gedämpft
 * direkt dahinter in derselben Zelle; liegt sie an einem anderen Kalendertag, mit ±1.
 */
import { formatTzAbbr, formatZonedTime } from '@nina-pm/shared';
import { useTranslation } from 'react-i18next';
import type { TonightRig } from '../../api/client';
import styles from './tonight.module.css';

type Twilight = TonightRig['twilight'];
const ROWS = ['nautical', 'astronomical'] as const;

function browserZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/** Kalendertag (JJJJ-MM-TT) eines Zeitpunkts in einer Zone. */
const dayIn = (atUtc: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(atUtc));

/** Tage zwischen dem Kalendertag am Standort und dem auf dem Gerät (−1, 0, +1). */
export function dayShift(atUtc: string, siteZone: string, deviceZone: string): number {
  return Math.round(
    (Date.parse(dayIn(atUtc, deviceZone)) - Date.parse(dayIn(atUtc, siteZone))) / 86_400_000,
  );
}

/** Gerät zeigt andere Uhrzeiten als der Standort (gleicher Versatz in anderer Zone zählt nicht als abweichend). */
export function zonesDiffer(
  atUtc: string,
  siteZone: string,
  deviceZone: string | undefined,
): deviceZone is string {
  return (
    deviceZone !== undefined &&
    (formatZonedTime(atUtc, siteZone) !== formatZonedTime(atUtc, deviceZone) ||
      dayShift(atUtc, siteZone, deviceZone) !== 0)
  );
}

export function TwilightTable({
  twilight,
  timeZone,
  deviceTimeZone = browserZone(),
}: {
  twilight: Twilight;
  timeZone: string;
  /** Zeitzone des Geräts; ohne Angabe die des Browsers (Tests setzen sie fest). */
  deviceTimeZone?: string | undefined;
}) {
  const { t } = useTranslation();
  const ref =
    twilight.astronomical.duskUtc ??
    twilight.nautical.duskUtc ??
    twilight.sun.duskUtc ??
    twilight.sun.dawnUtc;
  if (!ref) return null;
  const device = zonesDiffer(ref, timeZone, deviceTimeZone) ? deviceTimeZone : null;
  const cell = (at: string | null) => {
    if (!at) return <td className={styles.twilightTime}>–</td>;
    const shift = device ? dayShift(at, timeZone, device) : 0;
    return (
      <td className={styles.twilightTime}>
        {formatZonedTime(at, timeZone)}
        {device ? (
          <span className={styles.twilightDevice}>
            {' '}
            {formatZonedTime(at, device)}
            {shift !== 0 ? (shift > 0 ? `+${String(shift)}` : String(shift)) : ''}
          </span>
        ) : null}
      </td>
    );
  };
  return (
    <table className={styles.twilight} aria-label={t('tonight.kpi.twilight.caption')}>
      <thead>
        <tr>
          <th scope="col">
            <span className="visually-hidden">{t('tonight.kpi.twilight.kind')}</span>
          </th>
          <th scope="col">{t('tonight.kpi.twilight.dusk')}</th>
          <th scope="col">{t('tonight.kpi.twilight.dawn')}</th>
        </tr>
      </thead>
      <tbody>
        {ROWS.map((k) => (
          <tr key={k} data-kind={k}>
            <th scope="row">{t(`tonight.kpi.twilight.${k}`)}</th>
            {cell(twilight[k].duskUtc)}
            {cell(twilight[k].dawnUtc)}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={3}>
            {device
              ? t('tonight.kpi.twilight.zones', {
                  site: formatTzAbbr(ref, timeZone),
                  device: formatTzAbbr(ref, device),
                })
              : formatTzAbbr(ref, timeZone)}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}
