/**
 * Sternfeld um den Wirtsstern (FA-EXO-14): DSS2-Farbbild (CDS hips2fits, ca. 0,5°, Norden oben) mit Kreis um den
 * Stern und „In Framing öffnen“ (Sternkarte S-20). Das Bild lädt der Browser von CDS wie die HiPS-Kacheln der
 * Sternkarte (CSP `img-src`, Datenschutzhinweis „Himmelsausschnitte“).
 */
import { hips2fitsUrl, THUMBNAIL_SURVEY } from '@nina-pm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { skyMapHref } from '../planning/skymap/model';
import styles from './exo.module.css';

export const STAR_FIELD_DEG = 0.5;

export function StarField({
  raDeg,
  decDeg,
  star,
  rigId,
}: {
  raDeg: number;
  decDeg: number;
  star: string;
  rigId: string | null;
}) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const src = hips2fitsUrl({
    raDeg,
    decDeg,
    fovWidthDeg: STAR_FIELD_DEG,
    fovHeightDeg: STAR_FIELD_DEG,
    rotationDeg: 0,
    survey: THUMBNAIL_SURVEY,
  });
  return (
    <figure className={styles.starField}>
      <div className={styles.starFieldFrame}>
        {failed ? (
          <p className={styles.muted}>{t('exo.starField.failed')}</p>
        ) : (
          <img
            src={src}
            alt={t('exo.starField.alt', { star })}
            width={320}
            height={320}
            loading="lazy"
            onError={() => setFailed(true)}
          />
        )}
        {/* Kreis um den Wirtsstern: Radius ≈ 1,4′ bei 30′ Bildfeld */}
        <svg className={styles.starFieldMark} viewBox="0 0 100 100" aria-hidden>
          <circle cx="50" cy="50" r="4.5" />
        </svg>
      </div>
      <figcaption>
        {t('exo.starField.caption')} ·{' '}
        <Link to={skyMapHref({ ra: raDeg, dec: decDeg, rig: rigId, fov: 2 })}>
          {t('exo.starField.openFraming')}
        </Link>
      </figcaption>
    </figure>
  );
}
