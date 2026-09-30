/**
 * Nachtwahl als Mondkalender (Wunsch Sven 30.09.2026): die laufende Nacht und die folgenden sechs – so weit reicht
 * das Astro-Wetter (FA-WET-01). Je Nacht Doppeldatum mit Wochentag, Mondphase, Beleuchtung, mondfreie
 * Dunkelstunden und die Wetterbewertung, soweit eine Vorhersage vorliegt. Die Werte rechnet der Server
 * (`TonightRig.calendar`); das Mondsymbol kommt aus der Phase zur lokalen Mitternacht.
 */
import { formatNightKey } from '@nina-pm/shared';
import { useTranslation } from 'react-i18next';
import type { TonightRig } from '../../api/client';
import { MoonIcon, moonPhaseAt } from '../../components/moon-darkness';
import styles from './tonight.module.css';

const RATING_CLASS = ['ratingBad', 'ratingBad', 'ratingMid', 'ratingGood', 'ratingGood'] as const;

/** Lokale Mitternacht der Nacht (grob über die Länge) für das Mondsymbol. */
const midnightOf = (night: string, lonDeg: number) =>
  Date.parse(`${night}T12:00:00Z`) / 1000 + 12 * 3600 - (lonDeg / 15) * 3600;

export function MoonCalendar({
  rig,
  geo,
  selected,
  onSelect,
}: {
  rig: TonightRig;
  geo: { latDeg: number; lonDeg: number };
  selected: string;
  onSelect: (night: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const n = (x: number, d = 0) => x.toLocaleString(i18n.language, { maximumFractionDigits: d });
  const weekday = (night: string) =>
    new Intl.DateTimeFormat(i18n.language === 'en' ? 'en-GB' : 'de-DE', {
      weekday: 'short',
      timeZone: 'UTC',
    }).format(new Date(Date.parse(`${night}T12:00:00Z`)));
  return (
    <nav className={styles.calendar} aria-label={t('tonight.calendar.label')}>
      <ul className={styles.calendarList}>
        {rig.calendar.map((c) => {
          const rating =
            c.ratingIndex === null ? null : t(`weather.rating.${String(c.ratingIndex)}`);
          const label = t('tonight.calendar.nightAria', {
            night: formatNightKey(c.night),
            illum: n(c.moonIllumPct),
            free: n(c.moonlessDarkHours, 1),
            weather: rating ?? t('tonight.calendar.noWeather'),
          });
          const phase = moonPhaseAt(midnightOf(c.night, geo.lonDeg), geo);
          return (
            <li key={c.night}>
              <button
                type="button"
                className={styles.calendarNight}
                aria-pressed={c.night === selected}
                aria-label={label}
                title={label}
                onClick={() => onSelect(c.night)}
              >
                <span className={styles.calendarDate}>
                  {c.night === rig.currentNight
                    ? t('tonight.calendar.tonight')
                    : `${weekday(c.night)} ${formatNightKey(c.night)}`}
                </span>
                <span className={styles.calendarMoon}>
                  <MoonIcon angleDeg={phase.angleDeg} size={22} southern={geo.latDeg < 0} />
                  {n(c.moonIllumPct)} %
                </span>
                <span className={styles.calendarFree}>
                  {t('tonight.calendar.free', { h: n(c.moonlessDarkHours, 1) })}
                </span>
                <span
                  className={
                    c.ratingIndex === null
                      ? styles.ratingNone
                      : styles[RATING_CLASS[c.ratingIndex] ?? 'ratingNone']
                  }
                >
                  {rating ?? t('tonight.calendar.noWeather')}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
