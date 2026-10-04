/**
 * `CommentCount` (FA-PRJ-17, components.md §2.24): Sprechblase mit der Anzahl nicht gelöschter Kommentare
 * eines Projekts – in Projektliste, Warteschlange, *An NINA ausgeliefert*, Projektbericht, Übersicht (aktive Projekte,
 * Warteschlange), *Heute Nacht* (Plan) und den Zielkarten des Simulators. Bei 0 nichts,
 * damit Listen ruhig bleiben; die Zahl trägt die Bedeutung, das Symbol ist dekorativ.
 */
import { useTranslation } from 'react-i18next';
import { ICON_SIZE, uiIcons } from '../icons';
import styles from './CommentCount.module.css';

export interface CommentCountProps {
  count: number;
}

export function CommentCount({ count }: CommentCountProps) {
  const { t } = useTranslation();
  if (!(count > 0)) return null;
  const Icon = uiIcons.comments;
  const label = t('comments.count', { count });
  return (
    <span className={styles.count} title={label} aria-label={label} role="img">
      <Icon size={ICON_SIZE.table} aria-hidden />
      <span aria-hidden>{count}</span>
    </span>
  );
}
