/**
 * Vorschaubild eines Projekts (AP-25, FA-PRJ-02): zuerst das selbst erzeugte Bild des Bildfelds
 * (`/catalog/thumbs/…`, Job `thumbnail`), sonst das kopierte Katalogbild (`/catalog/img/…`, AP-20),
 * sonst `fallback`. Ein fehlendes Bild zeigt nie ein kaputtes Symbol.
 */
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ThumbPreview } from '../../components/ThumbPreview';
import { CatalogImage } from '../catalog/CatalogImage';
import thumbStyles from './thumb.module.css';

export function ProjectImage(props: {
  readonly thumbnailUrl: string | null | undefined;
  readonly primaryId: string | null;
  readonly name: string;
  readonly className?: string;
  readonly fallback: ReactNode;
}) {
  // Neuer Zustand, wenn sich das Bild ändert (Projektwechsel, neues Bildfeld).
  return <Inner key={`${props.thumbnailUrl ?? ''}:${props.primaryId ?? ''}`} {...props} />;
}

function Inner({
  thumbnailUrl,
  primaryId,
  name,
  className,
  fallback,
}: Parameters<typeof ProjectImage>[0]) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  if (thumbnailUrl && !failed)
    return (
      <img
        className={className}
        src={thumbnailUrl}
        loading="lazy"
        decoding="async"
        alt={t('projectList.frameImageAlt', { name })}
        onError={() => setFailed(true)}
      />
    );
  if (primaryId)
    return (
      <CatalogImage
        primaryId={primaryId}
        name={name}
        size="large"
        className={className}
        fallback={fallback}
      />
    );
  return <>{fallback}</>;
}

/**
 * Kleines Vorschaubild eines Projekts in Listen (AP-26h, Wunsch Sven 26.09.2026): 40 px, beim Überfahren das
 * große Bild (`ThumbPreview`). Ohne Bild ein leeres Feld gleicher Größe, damit die Spalte fluchtet.
 */
export function ProjectThumb(props: {
  readonly thumbnailUrl: string | null | undefined;
  readonly primaryId: string | null;
  readonly name: string;
}) {
  const empty = <span className={thumbStyles.empty} aria-hidden />;
  if (!props.thumbnailUrl && !props.primaryId) return empty;
  return (
    <ThumbPreview preview={() => <ProjectImage {...props} fallback={null} />}>
      <ProjectImage {...props} className={thumbStyles.small} fallback={empty} />
    </ThumbPreview>
  );
}
