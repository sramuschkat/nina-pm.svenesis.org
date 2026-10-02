/**
 * Filterspektrum auf S-14 (FA-FIL-05; Darstellung nach Svens Vorlage, Entscheidung 24.09.2026):
 * Durchlasskurven über der Wellenlänge vor dem blassen Farbverlauf des sichtbaren Spektrums, am Fuß der
 * volle Farbbalken; Raster je 10 % und 50 nm, Achsentitel; je Filter ein Trapez in seiner Farbe und
 * darüber die Beschriftung „OIII 500,7 nm / 4,5 nm“ mit Führungslinie – überlappende Beschriftungen
 * rücken in eine weitere Zeile. Spektralfarben aus `@nina-pm/ui-tokens` (`SPECTRUM_STOPS`).
 */
import { SPECTRUM_STOPS } from '@nina-pm/ui-tokens';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FilterView } from '../../api/client';
import { parseColor } from '../../lib/color';
import { contrastRatio, FilterChip } from '../../components/FilterChip';
import styles from './equipment.module.css';
import { useNumber } from './shared';

/** Grenzen der Durchlassbereiche (Eingabe bis 300–1100 nm). */
const LAMBDA_MIN = 300;
const LAMBDA_MAX = 1100;
/** Standardbereich der Grafik: das sichtbare Spektrum; Filter außerhalb erweitern ihn in 50-nm-Schritten. */
const VISIBLE = { from: 380, to: 750 } as const;

/** Durchlassbereich als Zentralwellenlänge ± Bandbreite/2 (auf 300–1100 nm begrenzt). */
export function filterPassband(f: {
  centerWavelengthNm: number | null;
  bandwidthNm: number | null;
}): { from: number; to: number } | null {
  if (f.centerWavelengthNm === null || f.bandwidthNm === null) return null;
  return {
    from: Math.max(LAMBDA_MIN, f.centerWavelengthNm - f.bandwidthNm / 2),
    to: Math.min(LAMBDA_MAX, f.centerWavelengthNm + f.bandwidthNm / 2),
  };
}

/** Wellenlängenbereich der Grafik: sichtbares Spektrum, erweitert um alle Durchlassbereiche. */
export function spectrumRange(bands: readonly { from: number; to: number }[]) {
  const lo = Math.min(VISIBLE.from, ...bands.map((b) => Math.floor(b.from / 50) * 50));
  const hi = Math.max(VISIBLE.to, ...bands.map((b) => Math.ceil(b.to / 50) * 50));
  return { from: Math.max(LAMBDA_MIN, lo), to: Math.min(LAMBDA_MAX, hi) };
}

type Rgb = readonly [number, number, number];

/** Spektralfarbe zur Wellenlänge (linear zwischen den Stützstellen, außerhalb die Randfarbe). */
export function spectrumRgb(nm: number): Rgb {
  const first = SPECTRUM_STOPS[0];
  const last = SPECTRUM_STOPS[SPECTRUM_STOPS.length - 1];
  if (!first || !last) return [0, 0, 0];
  if (nm <= first[0]) return first[1];
  if (nm >= last[0]) return last[1];
  for (let i = 0; i + 1 < SPECTRUM_STOPS.length; i += 1) {
    const [a, ca] = SPECTRUM_STOPS[i] as readonly [number, Rgb];
    const [b, cb] = SPECTRUM_STOPS[i + 1] as readonly [number, Rgb];
    if (nm >= a && nm <= b) {
      const f = (nm - a) / (b - a);
      const mix = (k: 0 | 1 | 2) => Math.round(ca[k] + (cb[k] - ca[k]) * f);
      return [mix(0), mix(1), mix(2)];
    }
  }
  return last[1];
}

const hex2 = (n: number) =>
  Math.round(Math.max(0, Math.min(255, n)))
    .toString(16)
    .padStart(2, '0');
const toHex = (c: Rgb) => `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}`;
// Auch `#fff` – so kommt `--npm-white` des hellen Themes aus dem Build (vorher keine Kontrastanpassung).
const parse = (color: string): Rgb | null => {
  const c = parseColor(color);
  return c ? [c[0], c[1], c[2]] : null;
};

/**
 * Beschriftungsfarbe in der Filterfarbe, lesbar auf dem Theme-Grund: so lange Richtung Schwarz (heller
 * Grund) bzw. Weiß (dunkler Grund) gemischt, bis der Kontrast 4,5:1 erreicht (rules/ui.md, WCAG AA).
 */
export function readableOn(color: string, background: string): string {
  const c = parse(color);
  const bg = parse(background);
  if (!c || !bg) return color;
  const toward =
    contrastRatio('#000000', background) > contrastRatio('#ffffff', background) ? 0 : 255;
  let out = toHex(c);
  for (let i = 1; i <= 20 && contrastRatio(out, background) < 4.5; i += 1) {
    const f = i / 20;
    out = toHex([0, 1, 2].map((k) => c[k as 0] + (toward - c[k as 0]) * f) as unknown as Rgb);
  }
  return out;
}

export interface LabelBox {
  readonly id: string;
  readonly center: number;
  readonly width: number;
}

/**
 * Zeilen der Beschriftungen: nach Lage sortiert, jede in die erste Zeile, in der sie die vorige nicht
 * überlappt (Abstand `gap`). Ergebnis: Zeile je `id` (0 = oberste).
 */
export function labelRows(labels: readonly LabelBox[], gap = 12): Map<string, number> {
  const ends: number[] = [];
  const rows = new Map<string, number>();
  for (const l of [...labels].sort((a, b) => a.center - b.center)) {
    const start = l.center - l.width / 2;
    let row = ends.findIndex((end) => end + gap <= start);
    if (row === -1) row = ends.length;
    ends[row] = l.center + l.width / 2;
    rows.set(l.id, row);
  }
  return rows;
}

/** Hintergrund des Themes (`--npm-white`), neu gelesen bei Theme-Wechsel. */
function useThemeBackground(): string {
  const read = () =>
    (typeof getComputedStyle === 'undefined'
      ? ''
      : getComputedStyle(document.documentElement).getPropertyValue('--npm-white').trim()) ||
    '#ffffff';
  const [bg, setBg] = useState(read);
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined;
    const mo = new MutationObserver(() => setBg(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  return bg;
}

const W = 800;
const PLOT = { left: 58, right: 14, height: 220 };
const ROW_H = 21;
const FONT = 14;
/** Geschätzte Zeichenbreite der Beschriftung in viewBox-Einheiten (für die Zeilenverteilung). */
const CHAR_W = 7.6;
const BAR_H = 12;

export function FilterSpectrum({ filters }: { filters: FilterView[] }) {
  const { t } = useTranslation();
  const num = useNumber();
  const gradientId = useId();
  const background = useThemeBackground();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const withBand = filters.filter((f) => filterPassband(f));
  const without = filters.filter((f) => !filterPassband(f));
  const visible = withBand.filter((f) => !hidden.has(f.id));
  const bands = visible.map((f) => ({
    f,
    band: filterPassband(f) as { from: number; to: number },
  }));
  const range = spectrumRange(bands.map((b) => b.band));
  const plotW = W - PLOT.left - PLOT.right;
  const x = (nm: number) => PLOT.left + ((nm - range.from) / (range.to - range.from)) * plotW;

  const text = (f: FilterView) =>
    `${f.shortName}  ${num(f.centerWavelengthNm, 1)} nm / ${num(f.bandwidthNm, 1)} nm`;
  const rows = labelRows(
    bands.map(({ f }) => ({
      id: f.id,
      center: x(f.centerWavelengthNm ?? 0),
      width: text(f).length * CHAR_W,
    })),
  );
  const rowCount = Math.max(1, ...[...rows.values()].map((r) => r + 1));
  const top = 8 + rowCount * ROW_H + 10;
  const bottom = top + PLOT.height;
  const y = (pct: number) => bottom - (pct / 100) * PLOT.height;
  const H = bottom + 56;
  const step = range.to - range.from > 500 ? 100 : 50;
  const ticks: number[] = [];
  for (let nm = Math.ceil(range.from / step) * step; nm <= range.to; nm += step) ticks.push(nm);
  // Farbverlauf: Stützstellen im Bereich plus die Randfarben an beiden Enden
  const stops = [
    range.from,
    ...SPECTRUM_STOPS.map(([nm]) => nm).filter((nm) => nm > range.from && nm < range.to),
    range.to,
  ];

  return (
    <figure className={styles.listEditor}>
      <div className={styles.legend}>
        {withBand.map((f) => (
          <FilterChip
            key={f.id}
            shortName={f.shortName}
            color={f.colorHex}
            selected={!hidden.has(f.id)}
            onToggle={() =>
              setHidden((h) => {
                const next = new Set(h);
                if (next.has(f.id)) next.delete(f.id);
                else next.add(f.id);
                return next;
              })
            }
            title={f.fullName || f.shortName}
          />
        ))}
      </div>
      <svg
        className={styles.spectrum}
        viewBox={`0 0 ${String(W)} ${String(H)}`}
        role="img"
        aria-label={t('equipment.filters.spectrumLabel')}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="0">
            {stops.map((nm) => (
              <stop
                key={nm}
                offset={(nm - range.from) / (range.to - range.from)}
                stopColor={toHex(spectrumRgb(nm))}
              />
            ))}
          </linearGradient>
        </defs>
        {/* blasser Spektralgrund und voller Farbbalken am Fuß */}
        <rect
          x={PLOT.left}
          y={top}
          width={plotW}
          height={PLOT.height}
          fill={`url(#${gradientId})`}
          opacity={0.16}
        />
        <rect
          x={PLOT.left}
          y={bottom - BAR_H}
          width={plotW}
          height={BAR_H}
          fill={`url(#${gradientId})`}
        />
        {Array.from({ length: 11 }, (_, i) => i * 10).map((pct) => (
          <g key={pct}>
            <line
              className={styles.spectrumGrid}
              x1={PLOT.left}
              x2={W - PLOT.right}
              y1={y(pct)}
              y2={y(pct)}
            />
            {pct % 20 === 0 ? (
              <text
                className={styles.spectrumTick}
                x={PLOT.left - 8}
                y={y(pct) + 5}
                textAnchor="end"
              >
                {pct}
              </text>
            ) : null}
          </g>
        ))}
        {ticks.map((nm) => (
          <g key={nm}>
            <line className={styles.spectrumGrid} x1={x(nm)} x2={x(nm)} y1={top} y2={bottom} />
            <text className={styles.spectrumTick} x={x(nm)} y={bottom + 20} textAnchor="middle">
              {nm}
            </text>
          </g>
        ))}
        <rect
          className={styles.spectrumFrame}
          x={PLOT.left}
          y={top}
          width={plotW}
          height={PLOT.height}
        />
        <text
          className={styles.spectrumTitle}
          x={PLOT.left + plotW / 2}
          y={bottom + 46}
          textAnchor="middle"
        >
          {t('equipment.filters.spectrumAxisX')}
        </text>
        <text
          className={styles.spectrumTitle}
          transform={`translate(18 ${String(top + PLOT.height / 2)}) rotate(-90)`}
          textAnchor="middle"
        >
          {t('equipment.filters.spectrumAxisY')}
        </text>
        {bands.map(({ f, band }) => {
          const peak = y(Math.max(1, Math.min(100, f.transmissionPct ?? 90)));
          const x0 = x(band.from);
          const x1 = x(band.to);
          const e = Math.min(6, (x1 - x0) / 3);
          const r = Math.min(6, (bottom - peak) / 4);
          const cx = x(f.centerWavelengthNm ?? 0);
          const labelY = 8 + (rows.get(f.id) ?? 0) * ROW_H + FONT;
          const n = (v: number) => v.toFixed(1);
          return (
            <g key={f.id}>
              <path
                d={`M${n(x0 - 1)},${n(bottom)} L${n(x0 + e * 0.3)},${n(peak + r)} Q${n(x0 + e * 0.5)},${n(peak)} ${n(x0 + e)},${n(peak)} L${n(x1 - e)},${n(peak)} Q${n(x1 - e * 0.5)},${n(peak)} ${n(x1 - e * 0.3)},${n(peak + r)} L${n(x1 + 1)},${n(bottom)} Z`}
                fill={f.colorHex}
                fillOpacity={0.35}
                stroke={f.colorHex}
                strokeWidth={2.5}
                strokeLinejoin="round"
              />
              <line
                x1={x0 - 6}
                x2={x1 + 6}
                y1={bottom}
                y2={bottom}
                stroke={f.colorHex}
                strokeWidth={2.5}
              />
              <line x1={cx} x2={cx} y1={labelY + 4} y2={peak} stroke={f.colorHex} strokeWidth={1} />
              <text
                x={Math.max(PLOT.left, Math.min(W - PLOT.right, cx))}
                y={labelY}
                textAnchor="middle"
                className={styles.spectrumLabel}
                fill={readableOn(f.colorHex, background)}
                style={{ whiteSpace: 'pre' }}
              >
                {text(f)}
              </text>
            </g>
          );
        })}
      </svg>
      {without.length > 0 ? (
        <p className={styles.muted}>
          {t('equipment.filters.spectrumMissing', {
            names: without.map((f) => f.shortName).join(', '),
          })}
        </p>
      ) : null}
      <details className={styles.details}>
        <summary>{t('equipment.textAlternative')}</summary>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('equipment.filters.field.shortName')}</th>
              <th className={styles.num}>{t('equipment.filters.field.center')}</th>
              <th className={styles.num}>{t('equipment.filters.field.bandwidth')}</th>
              <th className={styles.num}>{t('equipment.filters.field.transmission')}</th>
            </tr>
          </thead>
          <tbody>
            {withBand.map((f) => (
              <tr key={f.id}>
                <td>{f.shortName}</td>
                <td className={styles.num}>{num(f.centerWavelengthNm, 1)} nm</td>
                <td className={styles.num}>{num(f.bandwidthNm, 1)} nm</td>
                <td className={styles.num}>
                  {f.transmissionPct === null ? '–' : `${num(f.transmissionPct, 0)} %`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
