/**
 * `NightStack` (components.md §2.27, AP-69, S-65): Zeitachse je Rig – je Nacht ein Balken mit den belichteten Stunden,
 * gestapelt nach Projekt (Farbe vom Aufrufer, gleich wie in der Karte), darunter eine gemeinsame Mondspur (Beleuchtung,
 * Mondsymbol bei Neu- und Vollmond). Überfahren eines Projekts meldet es (Hervorheben in der Karte), ein hervorgehobenes
 * Projekt bleibt kräftig, die übrigen treten zurück; Klick bzw. Enter auf eine Nacht öffnet sie.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoonIcon } from '../moon-darkness/MoonIcon';
import type { StackRow } from '../../pages/sessions/sky-model';
import styles from './NightStack.module.css';

export interface NightStackProps {
  readonly rows: readonly StackRow[];
  /** Alle Nächte des Zeitraums (Nacht-Schlüssel, aufsteigend). */
  readonly nights: readonly string[];
  readonly moon: ReadonlyMap<string, { illumPct: number; phaseDeg: number }>;
  readonly marks: ReadonlyMap<string, 'new' | 'full'>;
  readonly colorOf: (projectId: string) => string;
  readonly nameOf: (projectId: string) => string;
  readonly highlight: string | null;
  readonly onHover: (projectId: string | null) => void;
  readonly onOpenNight: (rigId: string, night: string) => void;
  /** Datum kurz in der Sprache der Oberfläche (Achse und Beschriftung). */
  readonly formatNight: (night: string) => string;
  /** Stunden mit einer Nachkommastelle in der Sprache der Oberfläche. */
  readonly formatHours: (hours: number) => string;
  readonly label: string;
}

const LABEL_W = 132;
const ROW_H = 84;
const MOON_H = 26;
const AXIS_H = 20;

export function NightStack(props: NightStackProps) {
  const { rows, nights, moon, marks, colorOf, nameOf, highlight, onHover, onOpenNight } = props;
  const { t } = useTranslation();
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    // Inhaltsbreite ohne Innenabstand der Fläche.
    const ro = new ResizeObserver((entries) =>
      setWidth(Math.floor(entries[0]?.contentRect.width ?? el.clientWidth)),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const plotW = Math.max(0, width - LABEL_W - 8);
  const n = Math.max(1, nights.length);
  const step = plotW / n;
  const barW = Math.max(1, Math.min(18, step * 0.8));
  const max = Math.max(1, ...rows.map((r) => r.maxHours));
  const yScale = (h: number) => (h / max) * (ROW_H - 14);
  const height = rows.length * ROW_H + MOON_H + AXIS_H;
  const xOf = (i: number) => LABEL_W + i * step + step / 2;
  // Achse: Monatsanfänge, bei kurzen Zeiträumen zusätzlich jeder 7. Tag.
  const ticks = nights
    .map((night, i) => ({ night, i }))
    .filter(({ night, i }) => night.endsWith('-01') || (n <= 62 && i % 7 === 0));

  return (
    <div ref={wrap} className={styles.wrap}>
      {width > 0 ? (
        <svg
          width={width}
          height={height}
          role="group"
          aria-label={props.label}
          className={styles.svg}
          data-testid="night-stack"
        >
          {rows.map((row, r) => {
            const top = r * ROW_H;
            const base = top + ROW_H - 4;
            return (
              <g key={row.rigId}>
                <text x={0} y={top + 16} className={styles.rigName}>
                  {row.name}
                </text>
                <text x={0} y={top + 32} className={styles.rigMax}>
                  {t('evaluation.sky.stack.max', { hours: props.formatHours(max) })}
                </text>
                <line x1={LABEL_W} x2={width - 8} y1={base} y2={base} className={styles.base} />
                {nights.map((night, i) => {
                  const stack = row.nights.get(night);
                  if (!stack) return null;
                  const total = stack.reduce((s, p) => s + p.hours, 0);
                  let y = base;
                  return (
                    <g
                      key={night}
                      role="link"
                      tabIndex={0}
                      className={styles.night}
                      aria-label={t('evaluation.sky.stack.nightLabel', {
                        night: props.formatNight(night),
                        rig: row.name,
                        hours: props.formatHours(total),
                      })}
                      onClick={() => onOpenNight(row.rigId, night)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onOpenNight(row.rigId, night);
                        }
                      }}
                    >
                      <title>
                        {`${props.formatNight(night)} · ${props.formatHours(total)} h\n${stack
                          .map((p) => `${nameOf(p.projectId)}: ${props.formatHours(p.hours)} h`)
                          .join('\n')}`}
                      </title>
                      {/* Unsichtbare Trefferfläche über die ganze Zeilenhöhe. */}
                      <rect
                        x={xOf(i) - step / 2}
                        y={top + 4}
                        width={step}
                        height={ROW_H - 8}
                        className={styles.hit}
                      />
                      {stack.map((p) => {
                        const h = Math.max(1, yScale(p.hours));
                        y -= h;
                        const dim = highlight !== null && highlight !== p.projectId;
                        return (
                          <rect
                            key={p.projectId}
                            data-project={p.projectId}
                            x={xOf(i) - barW / 2}
                            y={y}
                            width={barW}
                            height={h}
                            style={{ fill: colorOf(p.projectId), opacity: dim ? 0.3 : 1 }}
                            className={highlight === p.projectId ? styles.hot : undefined}
                            onPointerEnter={() => onHover(p.projectId)}
                            onPointerLeave={() => onHover(null)}
                          />
                        );
                      })}
                    </g>
                  );
                })}
              </g>
            );
          })}
          {/* Mondspur: Beleuchtung als Balken, Symbol bei Neu- und Vollmond. */}
          <g aria-hidden="true">
            <text x={0} y={rows.length * ROW_H + 17} className={styles.rigMax}>
              {t('evaluation.sky.stack.moon')}
            </text>
            {nights.map((night, i) => {
              const m = moon.get(night);
              if (!m) return null;
              const mark = marks.get(night);
              const top = rows.length * ROW_H;
              if (mark)
                return (
                  <g key={night} transform={`translate(${String(xOf(i) - 9)} ${String(top + 4)})`}>
                    <MoonIcon angleDeg={m.phaseDeg} size={18} />
                  </g>
                );
              const h = Math.max(1, (m.illumPct / 100) * (MOON_H - 8));
              return (
                <rect
                  key={night}
                  x={xOf(i) - barW / 2}
                  y={top + MOON_H - 4 - h}
                  width={barW}
                  height={h}
                  className={styles.moonBar}
                />
              );
            })}
          </g>
          <g aria-hidden="true">
            {ticks.map(({ night, i }) => (
              <text
                key={night}
                x={xOf(i)}
                y={height - 5}
                textAnchor="middle"
                className={styles.tick}
              >
                {props.formatNight(night)}
              </text>
            ))}
          </g>
        </svg>
      ) : null}
    </div>
  );
}
