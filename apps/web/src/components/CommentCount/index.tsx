/**
 * `CommentCount` (FA-PRJ-17, components.md §2.24): Sprechblase mit der Anzahl nicht gelöschter Kommentare
 * eines Projekts – in Projektliste, Warteschlange, *An NINA ausgeliefert*, Projektbericht, Übersicht (aktive Projekte,
 * Warteschlange), *Heute Nacht* (Plan) und den Zielkarten des Simulators. Bei 0 nichts,
 * damit Listen ruhig bleiben; die Zahl trägt die Bedeutung, das Symbol ist dekorativ.
 *
 * Vorschau (08.10.2026): Mit `onPreviewOpen` zeigt die Sprechblase beim Überfahren bzw. Fokussieren die letzten
 * Kommentare chronologisch als Tooltip. Der Baustein lädt nichts selbst – `preview` kommt vom Aufrufer
 * (`lib/project-comments.tsx`), `onPreviewOpen` stößt das Laden beim ersten Öffnen an.
 */
import * as Tooltip from '@radix-ui/react-tooltip';
import { useTranslation } from 'react-i18next';
import { ICON_SIZE, uiIcons } from '../icons';
import styles from './CommentCount.module.css';

export interface CommentPreviewItem {
  readonly id: string;
  readonly author: string;
  /** Bereits formatierte Zeit. */
  readonly when: string;
  /** Klartext, gekürzt. */
  readonly text: string;
}

export interface CommentPreview {
  readonly state: 'loading' | 'error' | 'ready';
  /** Die letzten Kommentare, ältester zuerst. */
  readonly items: readonly CommentPreviewItem[];
  /** Weitere, ältere Kommentare, die nicht gezeigt werden. */
  readonly older: number;
}

export interface CommentCountProps {
  count: number;
  /** Vorschau der letzten Kommentare; ohne `onPreviewOpen` keine Vorschau. */
  preview?: CommentPreview;
  onPreviewOpen?: () => void;
}

export function CommentCount({ count, preview, onPreviewOpen }: CommentCountProps) {
  const { t } = useTranslation();
  if (!(count > 0)) return null;
  const Icon = uiIcons.comments;
  const label = t('comments.count', { count });
  if (!onPreviewOpen)
    return (
      <span className={styles.count} title={label} aria-label={label} role="img">
        <Icon size={ICON_SIZE.table} aria-hidden />
        <span aria-hidden>{count}</span>
      </span>
    );
  return (
    <Tooltip.Provider delayDuration={250} skipDelayDuration={100}>
      <Tooltip.Root
        onOpenChange={(open) => {
          if (open) onPreviewOpen();
        }}
      >
        <Tooltip.Trigger asChild>
          <span
            className={`${styles.count} ${styles.trigger}`}
            aria-label={label}
            role="img"
            tabIndex={0}
          >
            <Icon size={ICON_SIZE.table} aria-hidden />
            <span aria-hidden>{count}</span>
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className={styles.preview}
            side="bottom"
            align="start"
            sideOffset={6}
            collisionPadding={8}
          >
            <strong className={styles.previewTitle}>
              {t('comments.preview.title', { count })}
            </strong>
            {!preview || preview.state === 'loading' ? (
              <span className={styles.previewMuted}>{t('common.loading')}</span>
            ) : preview.state === 'error' ? (
              <span className={styles.previewMuted}>{t('comments.preview.error')}</span>
            ) : (
              <>
                {preview.older > 0 ? (
                  <span className={styles.previewMuted}>
                    {t('comments.preview.older', { count: preview.older })}
                  </span>
                ) : null}
                <ol className={styles.previewList}>
                  {preview.items.map((c) => (
                    <li key={c.id}>
                      <span className={styles.previewMeta}>
                        <strong>{c.author}</strong> · {c.when}
                      </span>
                      <span className={styles.previewText}>{c.text}</span>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
