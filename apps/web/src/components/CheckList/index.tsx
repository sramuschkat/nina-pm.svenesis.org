/**
 * `CheckList` (components.md §2.9): ✓/✗/– über **Symbolform und** Farbe (nie nur Farbe).
 * `items` leer → `empty`; mehr als 8 Einträge und `compact` → „n von m erfüllt“ mit Aufklappen.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ICON_SIZE, uiIcons } from '../icons';
import styles from './CheckList.module.css';

export interface CheckItem {
  id: string;
  label: string;
  /** `null` = nicht geprüft. */
  ok: boolean | null;
  detail?: string;
}

export interface CheckListProps {
  items: readonly CheckItem[];
  compact?: boolean;
}

const COMPACT_LIMIT = 8;

export function CheckList({ items, compact }: CheckListProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return <p className={styles.empty}>{t('checkList.empty')}</p>;
  const okCount = items.filter((i) => i.ok === true).length;
  const collapsed = compact === true && items.length > COMPACT_LIMIT && !expanded;
  return (
    <div className={styles.wrap}>
      {collapsed ? (
        <p className={styles.summary}>
          {t('checkList.summary', { ok: okCount, total: items.length })}
        </p>
      ) : (
        <ul className={styles.list}>
          {items.map((item) => {
            const Icon =
              item.ok === true
                ? uiIcons.ok
                : item.ok === false
                  ? uiIcons.failed
                  : uiIcons.unchecked;
            const state = item.ok === true ? 'ok' : item.ok === false ? 'failed' : 'unchecked';
            return (
              <li key={item.id} className={styles[state]} data-state={state}>
                <Icon size={ICON_SIZE.table} aria-hidden className={styles.icon} />
                <span className="visually-hidden">{t(`checkList.${state}`)}: </span>
                <span>{item.label}</span>
                {item.detail ? <span className={styles.detail}>{item.detail}</span> : null}
              </li>
            );
          })}
        </ul>
      )}
      {compact === true && items.length > COMPACT_LIMIT ? (
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? t('checkList.collapse') : t('checkList.expand')}
        </button>
      ) : null}
    </div>
  );
}
