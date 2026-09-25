/**
 * Katalogsuche im Projekt-Editor (FA-FRM-01, AP-20): Autovervollständigung über `GET /web/v1/dso`
 * (Bezeichnungen, Aliase, Trivialnamen); die Auswahl übernimmt der Editor in die Zielfelder.
 * Tastatur nach dem ARIA-Combobox-Muster: ↓/↑ wählen, Enter übernimmt, Esc schließt.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { catalogApi, type DsoView } from '../../api/client';
import { aliasesOf } from './model';
import styles from './catalog.module.css';

export const PICKER_LIMIT = 8;

export function CatalogSearch({
  onPick,
  disabled,
  linkedName,
  onUnlink,
}: {
  onPick: (o: DsoView) => void;
  disabled?: boolean;
  /** Anzeigename des verknüpften Katalogobjekts (Projekt mit `dsoObjectId`). */
  linkedName?: string | null;
  onUnlink?: () => void;
}) {
  const { t } = useTranslation();
  const ids = { input: useId(), list: useId(), hint: useId() };
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  useEffect(() => {
    const id = window.setTimeout(() => setQ(text.trim()), 200);
    return () => window.clearTimeout(id);
  }, [text]);
  const result = useQuery({
    queryKey: ['dso', 'picker', q],
    queryFn: () => catalogApi.search({ q, limit: PICKER_LIMIT }),
    enabled: q.length >= 2,
    staleTime: 60_000,
  });
  const items = q.length >= 2 ? (result.data?.items ?? []) : [];
  const expanded = open && q.length >= 2 && (items.length > 0 || result.isSuccess);
  const pick = (o: DsoView) => {
    onPick(o);
    setText('');
    setQ('');
    setOpen(false);
  };
  const optionId = (i: number) => `${ids.list}-${String(i)}`;
  return (
    <div className={styles.picker}>
      <label htmlFor={ids.input}>{t('catalog.editor.label')}</label>
      <input
        id={ids.input}
        type="search"
        role="combobox"
        className={styles.input}
        value={text}
        placeholder={t('catalog.editor.placeholder')}
        aria-expanded={expanded}
        aria-controls={ids.list}
        aria-autocomplete="list"
        aria-describedby={ids.hint}
        aria-activedescendant={expanded && items[active] ? optionId(active) : undefined}
        maxLength={80}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, Math.max(items.length - 1, 0)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter' && expanded && items[active]) {
            e.preventDefault();
            pick(items[active]);
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      <span id={ids.hint} className={styles.muted}>
        {t('catalog.editor.hint')}
      </span>
      <ul
        id={ids.list}
        role="listbox"
        aria-label={t('catalog.editor.label')}
        className={styles.options}
        hidden={!expanded}
      >
        {items.length === 0 ? (
          <li className={styles.option} role="option" aria-selected={false} aria-disabled>
            {t('catalog.editor.empty')}
          </li>
        ) : (
          items.map((o, i) => {
            const { designations, common } = aliasesOf(o);
            return (
              <li
                key={o.id}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                className={styles.option}
                // mousedown statt click: sonst schließt onBlur die Liste vor der Auswahl.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <strong>{o.displayName}</strong>
                {common[0] ? <span>{common[0]}</span> : null}
                <span className={styles.muted}>
                  {t(`catalog.groups.${o.group}`)} · {o.constellation ?? '–'}
                  {designations.length > 0 ? ` · ${designations.slice(0, 2).join(', ')}` : ''}
                </span>
              </li>
            );
          })
        )}
      </ul>
      {linkedName ? (
        <p className={styles.linked}>
          <span>{t('catalog.editor.linked', { name: linkedName })}</span>
          {onUnlink && !disabled ? (
            <button type="button" className={styles.button} onClick={onUnlink}>
              {t('catalog.editor.unlink')}
            </button>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
