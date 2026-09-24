/**
 * `ProgressBar` (components.md §2.2): „x/y × t“ mit Segmenten akzeptiert, verworfen, Bonus.
 * `planned = 0` → `empty`; `acquired > planned` → Balken bleibt bei 100 %, Überhang als eigenes Segment.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './ProgressBar.module.css';

export interface ProgressBarProps {
  acquired: number;
  planned: number;
  rejected?: number;
  bonus?: number;
  exposureS?: number;
  showLabel?: boolean;
  size?: 'sm' | 'md';
}

/** Unter 140 px entfällt das Label und wandert in den `title` (§2.2). */
const LABEL_MIN_WIDTH = 140;

export function progressLabel(
  p: Pick<ProgressBarProps, 'acquired' | 'planned' | 'exposureS'>,
  t: (k: string, o: Record<string, unknown>) => string,
): string {
  const pct = p.planned > 0 ? Math.round((Math.min(p.acquired, p.planned) / p.planned) * 100) : 0;
  return p.exposureS
    ? t('progress.label', { acquired: p.acquired, planned: p.planned, exposure: p.exposureS, pct })
    : t('progress.labelNoExposure', { acquired: p.acquired, planned: p.planned, pct });
}

export function ProgressBar({
  acquired,
  planned,
  rejected = 0,
  bonus = 0,
  exposureS,
  showLabel = true,
  size = 'md',
}: ProgressBarProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) =>
      setNarrow((entry?.contentRect.width ?? LABEL_MIN_WIDTH) < LABEL_MIN_WIDTH),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (planned <= 0) {
    return (
      <div className={`${styles.wrap} ${styles.empty}`} ref={ref}>
        {t('progress.noPlan')}
      </div>
    );
  }
  const label = progressLabel({ acquired, planned, exposureS }, (k, o) => t(k, o));
  const share = (n: number) => `${Math.max(0, Math.min(100, (n / planned) * 100))}%`;
  const accepted = Math.min(acquired, planned);
  const over = acquired > planned;
  return (
    <div
      className={`${styles.wrap} ${size === 'sm' ? styles.sm : styles.md}`}
      ref={ref}
      title={narrow || !showLabel ? label : undefined}
    >
      <div
        className={styles.bar}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={planned}
        aria-valuenow={accepted}
        aria-valuetext={label}
        aria-label={label}
      >
        <span className={styles.accepted} style={{ width: share(accepted) }} />
        {rejected > 0 ? (
          <span className={styles.rejected} style={{ width: share(rejected) }} />
        ) : null}
        {bonus > 0 ? <span className={styles.bonus} style={{ width: share(bonus) }} /> : null}
        {over ? <span className={styles.overflow} data-testid="progress-overflow" /> : null}
      </div>
      {showLabel && !narrow ? <span className={styles.label}>{label}</span> : null}
    </div>
  );
}
