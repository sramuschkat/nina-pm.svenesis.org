/**
 * Qualitätskurve der Nacht (AP-64 FA-AUS-08, AP-72 FA-AUS-23): Punkte je gespeichertem Light, farbig nach Filter, für die
 * gewählten Kennzahlen (HFR in ″ mit dem Pixelmaßstab des Rigs, sonst px; Sterne; Guiding-RMS; Wolken und SQM des
 * Wettergeräts; Höhe; Hintergrund). Meridian-Flip und Autofokus als Marken, Lücken im Ist schraffiert, darunter das Band
 * „klar laut Bildern“ je Stunde. Gezeichnet als HTML mit Prozent-Lagen (Punkte bleiben rund, die Breite folgt dem
 * Container); Stunden in Standortzeit mit Kürzel. Rein darstellend – Daten kommen von der Seite.
 */
import {
  clarityByHour,
  formatTzAbbr,
  formatZonedTime,
  type ClarityVerdict,
  type QualityRef,
} from '@nina-pm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NightSessionCapture, NightSessionDetail } from '../../api/client';
import { useEquipmentList } from '../equipment/shared';
import { QUALITY_KEYS, qualityPoints, type NightGap, type QualityKey } from './night-model';
import styles from './evaluation.module.css';

const iso = (sec: number) => new Date(sec * 1000).toISOString();

/** Nachkommastellen und Mindestspanne der Achse je Kennzahl. */
const AXIS: Record<QualityKey, { digits: number; pad: number; min?: number; max?: number }> = {
  hfr: { digits: 1, pad: 0.1, min: 0 },
  stars: { digits: 0, pad: 10, min: 0 },
  rms: { digits: 2, pad: 0.1, min: 0 },
  cloud: { digits: 0, pad: 5, min: 0, max: 100 },
  sqm: { digits: 2, pad: 0.1 },
  alt: { digits: 0, pad: 5, min: 0, max: 90 },
  adu: { digits: 0, pad: 50, min: 0 },
};

const DEFAULT_KEYS: readonly QualityKey[] = ['hfr', 'stars', 'rms'];

export function MetricsChart({
  captures,
  events,
  gaps,
  timeZone,
  fromUtc,
  toUtc,
  scaleArcsecPx = null,
  refs = [],
}: {
  captures: readonly NightSessionCapture[];
  events: NightSessionDetail['events'];
  gaps: readonly NightGap[];
  timeZone: string;
  fromUtc: string;
  toUtc: string | null;
  scaleArcsecPx?: number | null;
  refs?: readonly QualityRef[];
}) {
  const { t, i18n } = useTranslation();
  const filters = useEquipmentList('filters');
  const [chosen, setChosen] = useState<readonly QualityKey[]>(DEFAULT_KEYS);
  const colorOf = (short: string) =>
    (filters.data ?? []).find((f) => f.shortName === short)?.colorHex ?? '#888888';
  const points = qualityPoints(captures, scaleArcsecPx);
  if (points.length === 0) return null;
  const available = QUALITY_KEYS.filter((k) => points.some((p) => p.values[k] !== undefined));
  const shown = available.filter((k) => chosen.includes(k));
  const first = points[0] as (typeof points)[number];
  const last = points.at(-1) as (typeof points)[number];
  const start = Math.min(Date.parse(fromUtc) / 1000, first.atS);
  const end = Math.max(toUtc ? Date.parse(toUtc) / 1000 : last.atS, last.atS, start + 3600);
  const x = (sec: number) => ((sec - start) / (end - start)) * 100;
  const marks = (kind: string) =>
    events
      .filter((e) => e.kind === kind && (kind !== 'af' || e.af?.ok !== false))
      .map((e) => ({ atS: Date.parse(e.occurredAt) / 1000, filter: e.af?.filter ?? null }))
      .filter((m) => m.atS >= start && m.atS <= end);
  const flips = marks('flip');
  const afs = marks('af');
  const shownGaps = gaps.filter((g) => g.toUtc > start && g.fromUtc < end && g.kind !== 'flip');
  // „Klar laut Bildern“ je Stunde (Bezug: Projekt und Filter der letzten 30 Nächte).
  const clarity = clarityByHour(
    captures
      .filter((c) => c.frameType === 'light' && c.result === 'saved' && !c.rejected)
      .map((c) => ({
        atS: Date.parse(c.capturedAt) / 1000,
        projectId: c.projectId,
        filter: c.filterShortName,
        stars: c.stars,
        medianAdu: c.quality?.medianAdu ?? null,
        cloudCoverPct: c.quality?.cloudCoverPct ?? null,
      })),
    refs,
  ).filter((h) => h.fromS + 3600 > start && h.fromS < end);
  // Volle Standortstunden als Achse (höchstens etwa 8 Beschriftungen).
  const ticks: number[] = [];
  const step = Math.max(1, Math.ceil((end - start) / 3600 / 8)) * 3600;
  for (let s = Math.ceil(start / 3600) * 3600; s <= end; s += step) ticks.push(s);
  const n = (v: number, d = 2) => v.toLocaleString(i18n.language, { maximumFractionDigits: d });
  const unitOf = (key: QualityKey) =>
    key === 'hfr' && !scaleArcsecPx
      ? t('evaluation.quality.unit.hfrPx')
      : t(`evaluation.quality.unit.${key}`);
  const panel = (key: QualityKey) => {
    const values = points.flatMap((p) => (p.values[key] === undefined ? [] : [p.values[key]]));
    if (values.length === 0) return null;
    const a = AXIS[key];
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = Math.max((hi - lo) * 0.15, a.pad);
    const min = a.min === undefined ? lo - pad : Math.max(a.min, lo - pad);
    const max = a.max === undefined ? hi + pad : Math.min(a.max, hi + pad);
    const y = (v: number) => ((v - min) / (max - min || 1)) * 100;
    const label = `${t(`evaluation.quality.key.${key}`)} ${unitOf(key)}`.trim();
    return (
      <div key={key} className={styles.metricPanel} data-kind={key}>
        <span className={styles.metricAxis} aria-hidden="true">
          <span>{n(max, a.digits)}</span>
          <span>{label}</span>
          <span>{n(min, a.digits)}</span>
        </span>
        <div className={styles.metricPlot} aria-hidden="true">
          {shownGaps.map((g) => (
            <span
              key={`gap-${String(g.fromUtc)}`}
              className={styles.metricGap}
              style={{
                left: `${String(Math.max(0, x(g.fromUtc)))}%`,
                width: `${String(Math.max(0.3, x(Math.min(end, g.toUtc)) - x(Math.max(start, g.fromUtc))))}%`,
              }}
            />
          ))}
          {flips.map((f) => (
            <span
              key={`flip-${String(f.atS)}`}
              className={styles.metricFlip}
              style={{ left: `${String(x(f.atS))}%` }}
            >
              {key === shown[0] ? (
                <span className={styles.metricFlipLabel}>{t('evaluation.captures.flip')}</span>
              ) : null}
            </span>
          ))}
          {afs.map((f) => (
            <span
              key={`af-${String(f.atS)}`}
              className={styles.metricAf}
              title={`${t('evaluation.quality.af')} ${formatZonedTime(iso(f.atS), timeZone)}${f.filter ? ` · ${f.filter}` : ''}`}
              style={{ left: `${String(x(f.atS))}%` }}
            />
          ))}
          {points.map((p) => {
            const v = p.values[key];
            return v === undefined ? null : (
              <span
                key={`${key}-${String(p.atS)}-${p.filter}`}
                className={styles.metricDot}
                title={`${formatZonedTime(iso(p.atS), timeZone)} · ${p.filter} · ${n(v)}`}
                style={{
                  left: `${String(x(p.atS))}%`,
                  bottom: `${String(y(v))}%`,
                  background: colorOf(p.filter),
                }}
              />
            );
          })}
        </div>
      </div>
    );
  };
  const legend = [...new Set(points.map((p) => p.filter))];
  const hfrValues = points.flatMap((p) => (p.values.hfr === undefined ? [] : [p.values.hfr]));
  const count = (v: ClarityVerdict) => clarity.filter((h) => h.verdict === v).length;
  const summary = [
    t('evaluation.captures.chartSummary', {
      count: points.length,
      min: hfrValues.length ? n(Math.min(...hfrValues)) : '–',
      max: hfrValues.length ? n(Math.max(...hfrValues)) : '–',
      unit: unitOf('hfr'),
      flips: flips.length,
    }),
    t('evaluation.quality.afSummary', { count: afs.length }),
    clarity.length > 0
      ? t('evaluation.quality.claritySummary', {
          clear: count('clear'),
          thin: count('thin'),
          cloudy: count('cloudy'),
        })
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const toggle = (key: QualityKey) => {
    setChosen((c) => (c.includes(key) ? c.filter((k) => k !== key) : [...c, key]));
  };
  return (
    <div className={styles.quality}>
      {available.length > 1 ? (
        <div className={styles.qualityKeys} role="group" aria-label={t('evaluation.quality.keys')}>
          {available.map((k) => (
            <button
              key={k}
              type="button"
              className={styles.qualityKey}
              aria-pressed={shown.includes(k)}
              onClick={() => toggle(k)}
            >
              {t(`evaluation.quality.key.${k}`)}
            </button>
          ))}
        </div>
      ) : null}
      <figure className={styles.metrics} role="img" aria-label={summary}>
        {shown.map(panel)}
        {clarity.length > 0 ? (
          <div className={styles.clarityRow} aria-hidden="true">
            <span className={styles.clarityLabel}>{t('evaluation.quality.clarity')}</span>
            <div className={styles.clarityBand}>
              {clarity.map((h) => (
                <span
                  key={h.fromS}
                  className={styles.clarityHour}
                  data-verdict={h.verdict}
                  title={`${formatZonedTime(iso(h.fromS), timeZone)} · ${t(`evaluation.quality.verdict.${h.verdict}`)}`}
                  style={{
                    left: `${String(Math.max(0, x(h.fromS)))}%`,
                    width: `${String(x(Math.min(end, h.fromS + 3600)) - x(Math.max(start, h.fromS)))}%`,
                  }}
                />
              ))}
            </div>
          </div>
        ) : null}
        <div className={styles.metricTicks} aria-hidden="true">
          {ticks.map((s) => (
            <span key={s} style={{ left: `${String(x(s))}%` }}>
              {formatZonedTime(iso(s), timeZone).slice(0, 2)}
            </span>
          ))}
          <span className={styles.metricZone}>{formatTzAbbr(iso(end), timeZone)}</span>
        </div>
        <figcaption className={styles.metricLegend} aria-hidden="true">
          {legend.map((f) => (
            <span key={f}>
              <span className={styles.legendDot} style={{ background: colorOf(f) }} />
              {f}
            </span>
          ))}
          {flips.length > 0 ? (
            <span>
              <span className={styles.legendFlip} />
              {t('evaluation.captures.flip')}
            </span>
          ) : null}
          {afs.length > 0 ? (
            <span>
              <span className={styles.legendAf} />
              {t('evaluation.quality.af')}
            </span>
          ) : null}
          {shownGaps.length > 0 ? (
            <span>
              <span className={styles.legendGap} />
              {t('evaluation.captures.gap')}
            </span>
          ) : null}
          {clarity.length > 0
            ? (['clear', 'thin', 'cloudy'] as const).map((v) => (
                <span key={v}>
                  <span className={styles.legendClarity} data-verdict={v} />
                  {t(`evaluation.quality.verdict.${v}`)}
                </span>
              ))
            : null}
        </figcaption>
      </figure>
    </div>
  );
}
