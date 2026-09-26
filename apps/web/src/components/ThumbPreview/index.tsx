/**
 * `ThumbPreview` (components.md §2.16, AP-26h): kleines Vorschaubild in Listen und Tabellen; beim Überfahren
 * mit der Maus erscheint daneben das große Bild. Die große Fassung wird erst dann geladen und liegt in einem
 * Portal über der Seite (feste Position), damit Tabellen mit `overflow-x: clip` sie nicht abschneiden. Nur
 * Zusatz fürs Auge (`aria-hidden`): der Alternativtext steht am kleinen Bild, die Zeile bleibt der Link.
 */
import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './ThumbPreview.module.css';

/** Größe des großen Bildes (px) und Abstand zum kleinen. */
const SIZE = 320;
const GAP = 12;
const MARGIN = 8;

export interface ThumbPreviewProps {
  /** Das kleine Bild. */
  readonly children: ReactNode;
  /** Das große Bild; wird erst beim Überfahren erzeugt. */
  readonly preview: () => ReactNode;
}

export function ThumbPreview({ children, preview }: ThumbPreviewProps) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const show = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const box = SIZE + 16;
    // Rechts neben das Bild, sonst links davon; senkrecht mittig, im Fenster gehalten.
    const right = r.right + GAP;
    const left =
      right + box <= window.innerWidth - MARGIN ? right : Math.max(MARGIN, r.left - GAP - box);
    const top = Math.min(
      Math.max(MARGIN, r.top + r.height / 2 - box / 2),
      Math.max(MARGIN, window.innerHeight - box - MARGIN),
    );
    setAt({ left, top });
  };
  return (
    <span
      className={styles.thumb}
      onMouseEnter={(e) => show(e.currentTarget)}
      onMouseLeave={() => setAt(null)}
    >
      {children}
      {at
        ? createPortal(
            <div className={styles.preview} style={at} aria-hidden="true">
              {preview()}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
