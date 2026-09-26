/**
 * Vorschaubild eines Projekts (AP-25, FA-PRJ-02): zuerst das selbst erzeugte Bild des Bildfelds
 * (`/catalog/thumbs/…`, Job `thumbnail`), sonst das kopierte Katalogbild (`/catalog/img/…`, AP-20),
 * sonst `fallback`. Ein fehlendes Bild zeigt nie ein kaputtes Symbol.
 */
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CatalogImage } from '../catalog/CatalogImage';

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
