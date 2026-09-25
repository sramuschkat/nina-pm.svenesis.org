/**
 * Katalogbild (AP-20, H-11): die aus dem Website-Ordner kopierten Bilder unter `catalog/img/…`, gefunden
 * über die normalisierte `primary_id` (dso-import.md §2, §3a Nr. 8). `large` versucht 320 px, dann
 * 128 px; `small` nur 128 px. Fehlt das Bild, erscheint `fallback` – nie ein kaputtes Bild.
 */
import { catalogImagePaths } from '@nina-pm/shared';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export interface CatalogImageProps {
  readonly primaryId: string;
  /** Anzeigename für den Alternativtext. */
  readonly name: string;
  readonly size: 'small' | 'large';
  readonly className?: string;
  readonly fallback?: ReactNode;
}

export function CatalogImage(props: CatalogImageProps) {
  // Neuer Zustand je Objekt (Blättern, Filtern, Auswahl im Editor).
  return <Image key={`${props.primaryId}:${props.size}`} {...props} />;
}

function Image({ primaryId, name, size, className, fallback = null }: CatalogImageProps) {
  const { t } = useTranslation();
  const paths = catalogImagePaths(primaryId);
  const sources = size === 'large' ? [paths.large, paths.small] : [paths.small];
  const [index, setIndex] = useState(0);
  const src = sources[index];
  if (src === undefined) return <>{fallback}</>;
  const px = size === 'large' ? 320 : 128;
  return (
    <img
      className={className}
      src={src}
      width={px}
      height={px}
      loading="lazy"
      decoding="async"
      alt={t('catalog.imageAlt', { name })}
      onError={() => setIndex((i) => i + 1)}
    />
  );
}
