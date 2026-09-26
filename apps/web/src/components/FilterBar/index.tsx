/**
 * `FilterBar` – Filterleiste einer Liste in **einer** Zeile (components.md §2.13, AP-26c): Suchfeld,
 * wichtigste Filter direkt in der Zeile (`inline`), aktive Filter als Chips („Rig: Rig A ×“), Knopf
 * *+ Filter* (`aria-expanded`) für die übrigen Filter in einem Bereich unter der Zeile mit
 * *Alle zurücksetzen*, Umschalter (`extra`, z. B. *Papierkorb*), rechts Trefferzahl und Ansicht. Die Zeile
 * bricht bei wenig Platz um, sie scrollt nie. Keine Datenabfrage, keine Rechteprüfung.
 */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ICON_SIZE, actionIcons, uiIcons } from '../icons';
import styles from './FilterBar.module.css';

export interface FilterBarChip {
  readonly id: string;
  /** Sichtbarer Text, z. B. „Rig: Rig A“ (zugleich Teil des Namens von ×). */
  readonly label: string;
  readonly onRemove: () => void;
}

export interface FilterBarSearch {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Zugänglicher Name des Suchfelds (Beschriftung nur für Screenreader). */
  readonly label: string;
  readonly placeholder?: string;
  /** `Enter` im Suchfeld (z. B. Suche sofort statt nach der Pause übernehmen). */
  readonly onSubmit?: () => void;
  readonly maxLength?: number;
}

export interface FilterBarProps {
  /** Zugänglicher Name der Leiste. */
  readonly label: string;
  readonly search?: FilterBarSearch;
  /** Wichtigste Filter direkt in der Zeile (kleine Auswahllisten); sie brauchen keinen Chip. */
  readonly inline?: ReactNode;
  /** Aktive Filter aus dem aufklappbaren Bereich. */
  readonly chips?: readonly FilterBarChip[];
  /** Übrige Filterfelder; ohne `panel` kein Knopf *Filter*. */
  readonly panel?: ReactNode;
  /** Beschriftung des Knopfs (Standard „Filter“, im Objektbrowser „Weitere Filter“). */
  readonly panelLabel?: string;
  /** Umschalter in der Zeile, z. B. `FilterToggle` *Papierkorb*. */
  readonly extra?: ReactNode;
  /** Trefferzahl, z. B. „3 von 8 Projekten“ (`role="status"`). */
  readonly count?: ReactNode;
  /** Ansichtsumschalter rechts in der Zeile. */
  readonly view?: ReactNode;
  /** *Alle zurücksetzen* im aufgeklappten Bereich. */
  readonly onReset?: () => void;
  readonly defaultOpen?: boolean;
  readonly className?: string;
}

const FOCUSABLE =
  'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export function FilterBar(props: FilterBarProps) {
  const { t } = useTranslation();
  const { search, chips = [], panel } = props;
  const base = useId();
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLUListElement>(null);
  const focusPanel = useRef(false);
  const focusChip = useRef<number | null>(null);
  const panelLabel = props.panelLabel ?? t('filterBar.more');

  // Aufklappen per Knopf: Fokus auf das erste Feld des Bereichs (er steht nach dem Zeilenende).
  useEffect(() => {
    if (!open || !focusPanel.current) return;
    focusPanel.current = false;
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, [open]);

  // Chip entfernt: Fokus auf den Chip an derselben Stelle, sonst den vorigen, sonst Knopf bzw. Suche.
  useLayoutEffect(() => {
    const i = focusChip.current;
    if (i === null) return;
    focusChip.current = null;
    const buttons = [...(chipsRef.current?.querySelectorAll('button') ?? [])];
    const next = buttons[Math.min(i, buttons.length - 1)];
    (next ?? toggleRef.current ?? searchRef.current)?.focus();
  });

  const toggle = () => {
    focusPanel.current = !open;
    setOpen(!open);
  };
  const onPanelKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    setOpen(false);
    toggleRef.current?.focus();
  };
  const Chevron = open ? uiIcons.detailOpen : uiIcons.menu;

  return (
    <div
      role="group"
      aria-label={props.label}
      className={[styles.bar, props.className ?? ''].filter(Boolean).join(' ')}
    >
      <div className={styles.row}>
        {search ? (
          <div className={styles.search}>
            <label htmlFor={`${base}-q`} className={styles.srOnly}>
              {search.label}
            </label>
            <input
              ref={searchRef}
              id={`${base}-q`}
              type="search"
              className={styles.input}
              value={search.value}
              placeholder={search.placeholder}
              maxLength={search.maxLength}
              onChange={(e) => search.onChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && search.onSubmit) {
                  e.preventDefault();
                  search.onSubmit();
                }
              }}
            />
          </div>
        ) : null}
        {props.inline ? <div className={styles.inline}>{props.inline}</div> : null}
        {chips.length > 0 ? (
          <ul ref={chipsRef} className={styles.chips} aria-label={t('filterBar.chips')}>
            {chips.map((c, i) => (
              <li key={c.id} className={styles.chip}>
                <span className={styles.chipText} title={c.label}>
                  {c.label}
                </span>
                <button
                  type="button"
                  className={styles.chipRemove}
                  aria-label={t('filterBar.remove', { label: c.label })}
                  title={t('filterBar.remove', { label: c.label })}
                  onClick={() => {
                    focusChip.current = i;
                    c.onRemove();
                  }}
                >
                  <uiIcons.remove size={ICON_SIZE.table} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {panel ? (
          <button
            ref={toggleRef}
            type="button"
            className={styles.toggle}
            aria-expanded={open}
            aria-controls={`${base}-panel`}
            onClick={toggle}
          >
            <actionIcons.add size={ICON_SIZE.table} aria-hidden />
            {panelLabel}
            <Chevron size={ICON_SIZE.table} aria-hidden />
          </button>
        ) : null}
        {props.extra}
        {props.count !== undefined || props.view ? (
          <div className={styles.end}>
            {props.count !== undefined ? (
              <span className={styles.count} role="status">
                {props.count}
              </span>
            ) : null}
            {props.view}
          </div>
        ) : null}
      </div>
      {panel && open ? (
        <div
          ref={panelRef}
          id={`${base}-panel`}
          role="group"
          aria-label={panelLabel}
          className={styles.panel}
          onKeyDown={onPanelKey}
        >
          {panel}
          {props.onReset ? (
            <div className={styles.panelActions}>
              <button type="button" className={styles.toggle} onClick={props.onReset}>
                {t('filterBar.reset')}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Umschalter in der Filterzeile (`aria-pressed`), z. B. *Papierkorb* der Projektliste. */
export function FilterToggle({
  pressed,
  onChange,
  label,
  icon,
}: {
  pressed: boolean;
  onChange: (pressed: boolean) => void;
  label: string;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={styles.toggle}
      aria-pressed={pressed}
      onClick={() => onChange(!pressed)}
    >
      {icon}
      {label}
    </button>
  );
}

/** Beschriftetes Feld im aufgeklappten Bereich (Auswahlliste oder Eingabe als `children`). */
export function FilterField({
  label,
  htmlFor,
  children,
}: {
  label: ReactNode;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.field}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

/** Kontrollkästchen im aufgeklappten Bereich. */
export function FilterCheck({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={styles.check}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
