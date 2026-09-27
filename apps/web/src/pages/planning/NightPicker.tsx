/**
 * Datumswahl der Nacht mit Mondkalender (Planung, Vorbild „Nacht ab dem Abend des … mit Mondphasen“ und
 * `renderMoonCal` im Beobachtungsplaner): ← Datum [mit Mondphasen] →. Der Kalender zeigt je Nacht Mondsymbol und
 * Beleuchtung um Mitternacht, einen Balken der mondfreien astronomischen Dunkelheit (voll = längste des Monats,
 * mindestens 8 h), Sterne für die drei besten Nächte, getönt die Nächte ab Freitag und Samstag, Viertel mit Rahmen
 * und Namen, orange umrandet die heutige Nacht (aus der Nacht-Tabelle des Servers, nie aus dem Browserdatum) und
 * unten die Viertel mit Uhrzeit in Standortzeit (in Klammern die Gerätezeit, wenn abweichend). Das Datum ist der
 * Nacht-Schlüssel (Abend), ohne `Date`-Rechnung.
 */
import { daysFromKey, keyFromDays, type TimeZoneTransition } from '@nina-pm/engine';
import { formatNightKey, formatTzAbbr, formatZonedTime } from '@nina-pm/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { equipmentApi } from '../../api/client';
import { ICON_SIZE, actionIcons, uiIcons } from '../../components/icons';
import { MoonIcon, calendarMonth, type Geo } from '../../components/moon-darkness';
import { iso } from '../../components/night-chart/model';
import styles from './NightPicker.module.css';

const NIGHT_KEY = /^\d{4}-\d{2}-\d{2}$/;

function deviceZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/** Uhrzeit auf 10 min gerundet (Viertel „etwa …“). */
const round10 = (at: number) => Math.round(at / 600) * 600;

export function NightPicker({
  night,
  onChange,
  today,
  siteId,
  site,
  timeZone,
  prevLabel,
  nextLabel,
}: {
  night: string;
  onChange: (night: string) => void;
  /** Heutige Nacht (`currentNight` der Server-Tabelle). */
  today: string | null;
  siteId: string;
  site: Geo;
  timeZone: string;
  prevLabel: string;
  nextLabel: string;
}) {
  const { t, i18n } = useTranslation();
  const ids = { date: useId(), dialog: useId() };
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => night.slice(0, 7));
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) setMonth(night.slice(0, 7));
  }, [open, night]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const [year, mon] = month.split('-').map(Number) as [number, number];
  const tables = useQuery({
    queryKey: ['site-nights', siteId, 'month', month],
    queryFn: () => equipmentApi.nights(siteId, 34, `${month}-01`),
    enabled: open,
    staleTime: 60 * 60 * 1000,
  });
  const cal = useMemo(() => {
    if (!tables.data) return null;
    const transitions: TimeZoneTransition[] = tables.data.timeZoneTransitions.map((z) => ({
      atUtc: Date.parse(z.atUtc) / 1000,
      utcOffsetMinutes: z.utcOffsetMinutes,
    }));
    return calendarMonth(year, mon, site, transitions);
  }, [tables.data, year, mon, site]);

  const shift = (days: number) => onChange(keyFromDays(daysFromKey(night) + days));
  const stepMonth = (d: number) => {
    const m0 = year * 12 + (mon - 1) + d;
    setMonth(`${String(Math.floor(m0 / 12))}-${String((m0 % 12) + 1).padStart(2, '0')}`);
  };
  const lang = i18n.language === 'en' ? 'en-GB' : 'de-DE';
  const monthTitle = new Intl.DateTimeFormat(lang, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(Date.UTC(year, mon - 1, 1));
  // Wochentage Mo … So nur zur Anzeige (Intl), ab Montag, 05.01.1970 (UTC).
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(lang, { weekday: 'short', timeZone: 'UTC' })
      .format(Date.UTC(1970, 0, 5 + i))
      .replace('.', ''),
  );
  const device = deviceZone();
  const at = (sec: number) => {
    const site = formatZonedTime(iso(sec), timeZone);
    if (!device || formatTzAbbr(iso(sec), device) === formatTzAbbr(iso(sec), timeZone)) return site;
    return `${site} (${formatZonedTime(iso(sec), device)})`;
  };
  const dayLabel = (sec: number) =>
    new Intl.DateTimeFormat(lang, {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      timeZone,
    }).format(sec * 1000);
  const n = (x: number, d = 0) => x.toLocaleString(i18n.language, { maximumFractionDigits: d });

  return (
    <div className={styles.picker} ref={box}>
      <button
        type="button"
        className={styles.iconButton}
        aria-label={prevLabel}
        title={prevLabel}
        onClick={() => shift(-1)}
      >
        <uiIcons.previous size={ICON_SIZE.table} aria-hidden />
      </button>
      <label className={styles.pickerLabel} htmlFor={ids.date}>
        {t('moonCal.nightFrom')}
        <span className={styles.dateRow}>
          <input
            id={ids.date}
            type="date"
            className={styles.dateInput}
            value={night}
            onChange={(e) => {
              if (NIGHT_KEY.test(e.target.value)) onChange(e.target.value);
            }}
          />
          <button
            type="button"
            className={styles.calToggle}
            aria-expanded={open}
            aria-controls={ids.dialog}
            onClick={() => setOpen((o) => !o)}
          >
            <uiIcons.calendar size={ICON_SIZE.table} aria-hidden />
            {t('moonCal.withPhases')}
          </button>
        </span>
      </label>
      <button
        type="button"
        className={styles.iconButton}
        aria-label={nextLabel}
        title={nextLabel}
        onClick={() => shift(1)}
      >
        <uiIcons.next size={ICON_SIZE.table} aria-hidden />
      </button>
      {open ? (
        <div
          id={ids.dialog}
          className={styles.popover}
          role="dialog"
          aria-label={t('moonCal.title', { month: monthTitle })}
        >
          <div className={styles.calHead}>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={t('moonCal.prevMonth')}
              title={t('moonCal.prevMonth')}
              onClick={() => stepMonth(-1)}
            >
              <uiIcons.previous size={ICON_SIZE.table} aria-hidden />
            </button>
            <h3 className={styles.calTitle}>{monthTitle}</h3>
            <button
              type="button"
              className={styles.buttonSm}
              disabled={!today}
              onClick={() => {
                if (!today) return;
                onChange(today);
                setOpen(false);
              }}
            >
              {t('moonCal.today')}
            </button>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={t('moonCal.nextMonth')}
              title={t('moonCal.nextMonth')}
              onClick={() => stepMonth(1)}
            >
              <uiIcons.next size={ICON_SIZE.table} aria-hidden />
            </button>
          </div>
          {!cal ? (
            <p className={styles.calNote} role="status">
              {t('common.loading')}
            </p>
          ) : (
            <>
              <div className={styles.grid}>
                {weekdays.map((w) => (
                  <span key={w} className={styles.weekday} aria-hidden>
                    {w}
                  </span>
                ))}
                {Array.from({ length: cal.firstWeekday }, (_, i) => (
                  <span key={`pad-${String(i)}`} aria-hidden />
                ))}
                {cal.days.map((d) => {
                  const weekday = (cal.firstWeekday + d.day - 1) % 7;
                  const cls = [
                    styles.day,
                    weekday === 4 || weekday === 5 ? styles.weekend : '',
                    d.quarter ? styles.quarterDay : '',
                    d.night === night ? styles.selected : '',
                    d.night === today ? styles.today : '',
                  ].join(' ');
                  const best = cal.best.includes(d.night);
                  const hours = d.moonFreeSec / 3600;
                  return (
                    <button
                      key={d.night}
                      type="button"
                      className={cls}
                      aria-pressed={d.night === night}
                      aria-label={t('moonCal.dayAria', {
                        night: formatNightKey(d.night),
                        pct: n(d.phase.illumPct),
                        h: n(hours, 1),
                        extra: [
                          d.quarter ? t(`moonCal.quarter.${d.quarter}`) : '',
                          best ? t('moonCal.bestShort') : '',
                          d.night === today ? t('moonCal.today') : '',
                        ]
                          .filter(Boolean)
                          .join(', '),
                      })}
                      onClick={() => {
                        onChange(d.night);
                        setOpen(false);
                      }}
                    >
                      <span className={styles.dayNum}>
                        {d.day}
                        {best ? (
                          <actionIcons.favorite
                            className={styles.star}
                            size={11}
                            fill="currentColor"
                            aria-hidden
                          />
                        ) : null}
                      </span>
                      <MoonIcon angleDeg={d.phase.angleDeg} size={26} southern={site.latDeg < 0} />
                      <span>{n(d.phase.illumPct)} %</span>
                      <span className={styles.bar} aria-hidden>
                        <span
                          className={styles.barFill}
                          style={{
                            width: `${String(Math.round((d.moonFreeSec / cal.barMaxSec) * 100))}%`,
                          }}
                        />
                      </span>
                      {d.quarter ? (
                        <span className={styles.quarterLabel}>
                          {t(`moonCal.quarter.${d.quarter}`)}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <p className={styles.calNote}>
                {cal.quarters
                  .map((q) =>
                    t('moonCal.quarterAt', {
                      name: t(`moonCal.quarterLong.${q.kind}`),
                      day: dayLabel(round10(q.atUtc)),
                      time: at(round10(q.atUtc)),
                    }),
                  )
                  .join(' · ')}
              </p>
              <p className={styles.calNote}>
                {t('moonCal.note')} {t('moonCal.darkKey')} {t('moonCal.bestKey')}
              </p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
