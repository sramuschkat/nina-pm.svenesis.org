/**
 * Karte *Belichtung* der aufgeklappten Zeile (FA-EXO-14a, transit.md §6): Empfehlung als große Zahl mit vier
 * Kennwerten, bei hellen Sternen Defokus-Hinweis und zusätzlich die kurze Belichtung im Fokus (Wunsch Sven
 * 30.09.2026: beides zeigen). Ohne bestätigten Filterradplatz rechnet die API mit dem Web-Filter des Platzes
 * und die Karte weist darauf hin. Gerechnet wird in der API; die Karte formatiert nur.
 */
import type { ExoExposure } from '@nina-pm/shared';
import { useTranslation } from 'react-i18next';
import { useNumber } from '../equipment/shared';
import { HelpTip } from './HelpTip';
import styles from './exo.module.css';

type Ok = Extract<ExoExposure, { status: 'ok' }>;
type Point = Pick<Ok, 'exposureS' | 'framesInWindow' | 'precisionMmag' | 'transitSnr'>;

/** Einstufung des Transit-SNR (transit.md §6): ≥ 10 gut, ≥ 5 knapp, sonst schwach. */
export function snrGrade(snr: number): 'good' | 'marginal' | 'weak' {
  return snr >= 10 ? 'good' : snr >= 5 ? 'marginal' : 'weak';
}
const GRADE_CLASS = { good: 'fit_ok', marginal: 'fit_close', weak: 'fit_insufficient' } as const;

export function ExposureCard({ exposure, star }: { exposure: ExoExposure; star: string }) {
  const { t } = useTranslation();
  const fmt = useNumber();
  const seconds = (s: number) => `${fmt(s, s < 10 && s % 1 !== 0 ? 1 : 0)} s`;
  const title = t('exo.exposure.title', { star });

  if (exposure.status === 'missing') {
    return (
      <section className={`${styles.card} ${styles.exposureCard}`} aria-label={title}>
        <h3 className={styles.cardTitle}>{t('exo.exposure.heading')}</h3>
        <p className={styles.muted}>
          {t('exo.exposure.missing', {
            list: exposure.missing.map((m) => t(`exo.exposure.missingItem.${m}`)).join(', '),
          })}
        </p>
      </section>
    );
  }

  const x = exposure;
  const grade = snrGrade(x.transitSnr);
  const facts: [string, string, string, string?][] = [
    [
      t('exo.exposure.frames'),
      t('exo.exposure.framesValue', { n: fmt(x.framesInWindow, 0) }),
      t('exo.exposure.explain.frames'),
    ],
    [
      t('exo.exposure.precision'),
      t('exo.exposure.precisionValue', { mmag: fmt(x.precisionMmag, 1) }),
      t('exo.exposure.explain.precision'),
    ],
    [
      t('exo.exposure.snr'),
      t('exo.exposure.snrValue', {
        snr: fmt(x.transitSnr, 1),
        grade: t(`exo.exposure.grade.${grade}`),
      }),
      t('exo.exposure.explain.snr'),
      styles[GRADE_CLASS[grade]],
    ],
    [
      t('exo.exposure.peak'),
      t('exo.exposure.peakValue', { pct: fmt(x.peakPct, 0) }),
      t('exo.exposure.explain.peak'),
    ],
  ];
  const line = (p: Point) =>
    t('exo.exposure.pointLine', {
      exposure: seconds(p.exposureS),
      n: fmt(p.framesInWindow, 0),
      mmag: fmt(p.precisionMmag, 1),
      snr: fmt(p.transitSnr, 1),
    });

  return (
    <section className={`${styles.card} ${styles.exposureCard}`} aria-label={title}>
      <div className={styles.cardHead}>
        <h3 className={styles.cardTitle}>
          {t('exo.exposure.headingFor', {
            filter: x.filterShortName,
            gain: x.gain === null ? t('exo.exposure.gainDefault') : String(x.gain),
          })}
        </h3>
        <HelpTip
          label={t('exo.explainLabel', { name: t('exo.exposure.heading') })}
          text={t('exo.exposure.explain.model', {
            sky: fmt(x.skyMagArcsec2, 1),
            bortle: x.bortle === null ? t('exo.exposure.bortleUnknown') : fmt(x.bortle, 0),
            airmass: fmt(x.airmass, 2),
          })}
        />
      </div>
      {x.filterConfirmed ? null : (
        <p className={styles.exposureUnconfirmed}>
          {t('exo.exposure.filterUnconfirmed', { filter: x.filterShortName })}
        </p>
      )}
      <p className={styles.exposureValue}>{seconds(x.exposureS)}</p>
      {x.defocus ? (
        <p className={styles.exposureDefocus}>
          {t('exo.exposure.defocusTo', { fwhm: fmt(x.fwhmArcsec, 1) })}
        </p>
      ) : null}
      <dl className={styles.exposureFacts}>
        {facts.map(([label, value, why, cls]) => (
          <div key={label} className={styles.fact}>
            <dt>{label}</dt>
            <dd>
              <HelpTip label={t('exo.explainLabel', { name: label })} text={why} />
              <span className={cls}>{value}</span>
            </dd>
          </div>
        ))}
      </dl>
      <p className={styles.muted}>
        {t(`exo.exposure.limitedBy.${x.limitedBy}`, {
          focus: x.inFocus ? seconds(x.inFocus.exposureS) : '',
        })}
      </p>
      {x.inFocus ? (
        <div className={styles.exposureAlt}>
          <p className={styles.exposureAltTitle}>{t('exo.exposure.inFocusTitle')}</p>
          <p>{line(x.inFocus)}</p>
        </div>
      ) : null}
    </section>
  );
}
