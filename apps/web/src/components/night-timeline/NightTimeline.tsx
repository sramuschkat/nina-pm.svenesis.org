/**
 * Zeitleiste der Nacht (Heute Nacht, 28.09.2026): mehrere Spuren – Himmel, Wetter, Mond, Plan, Filter,
 * Ereignisse – auf **einer** gemeinsamen Zeitachse in Standortzeit, dazu eine rote Linie „jetzt“ durch alle
 * Spuren. Reine Anzeige: die Seite liefert Abschnitte (von–bis, Farbe, Beschriftung) und Marken; der Baustein
 * rechnet nichts und fragt keine Daten ab. Farben kommen als CSS-Werte (Tokens) von der Seite.
 * Zugänglich: jede Spur mit Beschriftung trägt eine Liste ihrer Abschnitte als Text (visuell verborgen).
 */
import { formatTzAbbr, formatZonedTime } from '@nina-pm/shared';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { hourTicks, iso } from '../night-chart/model';
import styles from './NightTimeline.module.css';

export interface TimelineSegment {
  readonly fromUtc: number;
  readonly toUtc: number;
  /** CSS-Farbe (Token, `var(--npm-…)`, oder aus einer Tokenfunktion). */
  readonly color: string;
  /** Beschriftung im Balken (wird abgeschnitten, wenn er zu schmal ist). */
  readonly label?: string;
  /** Deckkraft 0–1 (z. B. nach Höhe). */
  readonly opacity?: number;
  /** Text für Tooltip und Textalternative; ohne → nur Beschriftung. */
  readonly title?: string;
}

export interface TimelineMarker {
  readonly atUtc: number;
  readonly color: string;
  readonly title: string;
}

export interface TimelineLane {
  readonly key: string;
  readonly label: string;
  readonly segments: readonly TimelineSegment[];
  readonly markers?: readonly TimelineMarker[];
  /** Text statt leerer Spur (z. B. „nichts geplant“, „rechnet …“). */
  readonly note?: string;
  /** Abschnitte als Textliste für Screenreader ausgeben (Plan, Filter, Ereignisse). */
  readonly describe?: boolean;
  /** Durchgehendes Band ohne Abstände (Himmel, Wetter) statt einzelner Balken. */
  readonly continuous?: boolean;
}

export interface NightTimelineProps {
  readonly fromUtc: number;
  readonly toUtc: number;
  readonly timeZone: string;
  /** Rote Linie „jetzt“, nur innerhalb des Fensters. */
  readonly nowUtc?: number;
  readonly lanes: readonly TimelineLane[];
  /** Name der Gruppe für Screenreader. */
  readonly label: string;
  /** Zeitzone des Geräts (zweite Stundenzeile); ohne Angabe die des Browsers, nur Anzeige. */
  readonly deviceTimeZone?: string;
}

function browserZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

export function NightTimeline({
  fromUtc,
  toUtc,
  timeZone,
  nowUtc,
  lanes,
  label,
  deviceTimeZone,
}: NightTimelineProps) {
  const { t } = useTranslation();
  const span = Math.max(1, toUtc - fromUtc);
  const pct = (at: number) =>
    `${String(((Math.min(toUtc, Math.max(fromUtc, at)) - fromUtc) / span) * 100)}%`;
  const width = (a: number, b: number) =>
    `${String(((Math.min(toUtc, b) - Math.max(fromUtc, a)) / span) * 100)}%`;
  const hm = (at: number) => formatZonedTime(iso(at), timeZone);
  const ticks = hourTicks(fromUtc, toUtc, timeZone);
  const every = ticks.length > 16 ? 2 : 1;
  // Zweite Stundenzeile in der Zeit des Geräts, wenn sie von der Standortzeit abweicht (rules/ui.md).
  const device = deviceTimeZone ?? browserZone();
  const siteAbbr = formatTzAbbr(iso(fromUtc), timeZone);
  const deviceAbbr = device ? formatTzAbbr(iso(fromUtc), device) : siteAbbr;
  const dual = device !== undefined && deviceAbbr !== siteAbbr;
  const deviceTicks = dual && device ? hourTicks(fromUtc, toUtc, device) : [];
  const nowIn = nowUtc !== undefined && nowUtc >= fromUtc && nowUtc <= toUtc;
  return (
    <div className={styles.timeline} role="group" aria-label={label}>
      <div className={styles.row} aria-hidden>
        <span className={styles.laneLabel}>{t('timeline.site', { zone: siteAbbr })}</span>
        <div className={styles.axis}>
          {ticks
            .filter((_, i) => i % every === 0)
            .map((tk) => (
              <span key={tk.atUtc} className={styles.tick} style={{ left: pct(tk.atUtc) }}>
                {tk.label}
              </span>
            ))}
        </div>
      </div>
      {dual ? (
        <div className={styles.row} aria-hidden>
          <span className={styles.laneLabelDevice}>
            {t('timeline.device', { zone: deviceAbbr })}
          </span>
          <div className={styles.axis}>
            {deviceTicks
              .filter((_, i) => i % every === 0)
              .map((tk) => (
                <span key={tk.atUtc} className={styles.tickDevice} style={{ left: pct(tk.atUtc) }}>
                  {tk.label}
                </span>
              ))}
          </div>
        </div>
      ) : null}
      <div className={styles.lanes}>
        {lanes.map((lane) => (
          <div key={lane.key} className={styles.row}>
            <span className={styles.laneLabel}>{lane.label}</span>
            <div className={styles.track}>
              {ticks
                .filter((_, i) => i % every === 0)
                .map((tk) => (
                  <span
                    key={tk.atUtc}
                    className={styles.grid}
                    style={{ left: pct(tk.atUtc) }}
                    aria-hidden
                  />
                ))}
              {lane.segments
                .filter((s) => s.toUtc > fromUtc && s.fromUtc < toUtc)
                .map((s, i) => {
                  const style: CSSProperties = {
                    left: pct(s.fromUtc),
                    width: width(s.fromUtc, s.toUtc),
                    background: s.color,
                    opacity: s.opacity ?? 1,
                  };
                  return (
                    <span
                      key={`${String(s.fromUtc)}-${String(i)}`}
                      className={
                        lane.continuous
                          ? styles.band
                          : s.label
                            ? styles.segmentLabelled
                            : styles.segment
                      }
                      style={style}
                      title={s.title ?? s.label}
                      aria-hidden
                    >
                      {s.label}
                    </span>
                  );
                })}
              {(lane.markers ?? []).map((m) => (
                <span
                  key={`${String(m.atUtc)}-${m.title}`}
                  className={styles.marker}
                  style={{ left: pct(m.atUtc), background: m.color }}
                  title={m.title}
                  aria-hidden
                />
              ))}
              {lane.note && lane.segments.length === 0 && (lane.markers ?? []).length === 0 ? (
                <span className={styles.note}>{lane.note}</span>
              ) : null}
            </div>
            {lane.describe && (lane.segments.length > 0 || (lane.markers ?? []).length > 0) ? (
              <ul className="visually-hidden">
                {lane.segments.map((s, i) => (
                  <li key={`${String(s.fromUtc)}-${String(i)}`}>
                    {t('timeline.item', {
                      from: hm(s.fromUtc),
                      to: hm(s.toUtc),
                      text: s.title ?? s.label ?? '',
                    })}
                  </li>
                ))}
                {(lane.markers ?? []).map((m) => (
                  <li key={`${String(m.atUtc)}-${m.title}`}>
                    {t('timeline.marker', { at: hm(m.atUtc), text: m.title })}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
        {nowIn ? (
          <span
            className={styles.now}
            style={{ '--now-f': String((nowUtc - fromUtc) / span) } as CSSProperties}
            title={t('timeline.now', { at: hm(nowUtc) })}
            aria-hidden
          />
        ) : null}
      </div>
      <p className={styles.caption}>
        {dual
          ? t('timeline.captionDual', { zone: siteAbbr, device: deviceAbbr })
          : t('timeline.caption', { zone: siteAbbr })}
      </p>
    </div>
  );
}
