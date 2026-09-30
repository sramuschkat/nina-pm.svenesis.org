/**
 * Schematische Lichtkurve eines Transits (FA-EXO-10): Form aus Rp/R★, a/R★ und Inklination – flacher Boden
 * zwischen dem 2. und 3. Kontakt, bei streifendem Transit (b > 1 − k) eine V-Form; Tiefe in % beschriftet.
 * Ohne Geometrie ein Trapez mit 10 % Ein- bzw. Austritt. Baseline je Seite im Verhältnis zur Dauer.
 */
import { useTranslation } from 'react-i18next';
import styles from './exo.module.css';

export interface LightCurveProps {
  readonly depthMmag: number | null;
  readonly durationH: number;
  readonly rpOverRs: number | null;
  readonly aOverRs: number | null;
  readonly inclinationDeg: number | null;
  readonly baselineBeforeMin: number;
  readonly baselineAfterMin: number;
  /** Beschriftung der Kontakte (Standortzeit mit Kürzel). */
  readonly ingressLabel: string;
  readonly egressLabel: string;
}

/** Anteil von T23 an T14 (flacher Boden); 0 = V-Form (streifend). */
export function flatFraction(k: number | null, aOverRs: number | null, incDeg: number | null) {
  if (k === null || aOverRs === null || incDeg === null) return 0.8;
  const b = aOverRs * Math.cos((incDeg * Math.PI) / 180);
  const outer = (1 + k) ** 2 - b * b;
  const inner = (1 - k) ** 2 - b * b;
  if (!(outer > 0) || !(inner > 0)) return 0;
  return Math.sqrt(inner / outer);
}

const W = 320;
const H = 120;
const PAD = { l: 8, r: 8, t: 22, b: 22 };

export function LightCurve(p: LightCurveProps) {
  const { t, i18n } = useTranslation();
  const t14Min = p.durationH * 60;
  const span = p.baselineBeforeMin + t14Min + p.baselineAfterMin;
  const x = (min: number) => PAD.l + ((min + p.baselineBeforeMin) / span) * (W - PAD.l - PAD.r);
  const flat = flatFraction(p.rpOverRs, p.aOverRs, p.inclinationDeg);
  const edge = ((1 - flat) / 2) * t14Min;
  const top = PAD.t;
  const bottom = H - PAD.b - 8;
  const points: [number, number][] = [
    [x(-p.baselineBeforeMin), top],
    [x(0), top],
    ...(flat > 0
      ? ([
          [x(edge), bottom],
          [x(t14Min - edge), bottom],
        ] as [number, number][])
      : ([[x(t14Min / 2), bottom]] as [number, number][])),
    [x(t14Min), top],
    [x(t14Min + p.baselineAfterMin), top],
  ];
  // Tiefe als Anteil: 1 − 10^(−mmag/2500)
  const pct = p.depthMmag === null ? null : (1 - 10 ** (-p.depthMmag / 2500)) * 100;
  const fmt = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 });
  return (
    <figure className={styles.lightCurve}>
      <svg
        viewBox={`0 0 ${String(W)} ${String(H)}`}
        role="img"
        aria-label={t('exo.lightCurve.label', {
          depth: pct === null ? '–' : `${fmt.format(pct)} %`,
          shape: flat > 0 ? t('exo.lightCurve.flat') : t('exo.lightCurve.grazing'),
        })}
      >
        <rect
          x={x(0)}
          y={top - 6}
          width={x(t14Min) - x(0)}
          height={bottom - top + 12}
          className={styles.lcTransit}
        />
        <polyline
          points={points.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' ')}
          className={styles.lcCurve}
        />
        <text x={x(t14Min / 2)} y={bottom + 16} textAnchor="middle" className={styles.lcLabel}>
          {pct === null ? '–' : `−${fmt.format(pct)} %`}
        </text>
        <text x={x(0)} y={12} textAnchor="middle" className={styles.lcLabel}>
          {p.ingressLabel}
        </text>
        <text x={x(t14Min)} y={12} textAnchor="middle" className={styles.lcLabel}>
          {p.egressLabel}
        </text>
      </svg>
      <figcaption className={styles.muted}>
        {flat > 0 ? t('exo.lightCurve.flatHint') : t('exo.lightCurve.grazingHint')}
      </figcaption>
    </figure>
  );
}
