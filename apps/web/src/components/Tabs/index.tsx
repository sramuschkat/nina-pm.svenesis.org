/**
 * `Tabs` – Reiterleiste mit Reiterinhalt (components.md §2.12, AP-26b): Tastatur nach WAI-ARIA
 * (Pfeiltasten wechseln und aktivieren, `Pos1`/`Ende`, nur der aktive Reiter ist per `Tab` erreichbar),
 * optional rechts in der Leiste Werkzeuge (`toolbar`), waagerecht oder senkrecht (Unterreiter).
 * `keepMounted` lässt verdeckte Reiter im DOM (`hidden`) – für Formulare, deren Felder über Reiter
 * verteilt sind. Keine Datenabfrage, keine Rechteprüfung.
 */
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import styles from './Tabs.module.css';

export interface TabItem<K extends string> {
  readonly key: K;
  readonly label: ReactNode;
  /** Zusatz hinter der Beschriftung, z. B. Hinweis „enthält Fehler“. */
  readonly badge?: ReactNode;
  readonly title?: string;
}

export interface TabsProps<K extends string> {
  readonly tabs: readonly TabItem<K>[];
  readonly value: K;
  readonly onChange: (key: K) => void;
  /** Zugänglicher Name der Reiterleiste. */
  readonly label: string;
  /** Inhalt je Reiter; ohne `keepMounted` wird nur der aktive gezeichnet. */
  readonly panels: Partial<Record<K, ReactNode>>;
  readonly keepMounted?: boolean;
  /** Werkzeuge rechts in der Leiste (waagerecht). */
  readonly toolbar?: ReactNode;
  readonly orientation?: 'horizontal' | 'vertical';
  readonly className?: string;
  readonly panelClassName?: string;
}

export function Tabs<K extends string>(props: TabsProps<K>) {
  const { tabs, value, onChange, orientation = 'horizontal' } = props;
  const base = useId();
  const refs = useRef(new Map<K, HTMLButtonElement>());
  const tabId = (k: K) => `${base}-tab-${k}`;
  const panelId = (k: K) => `${base}-panel-${k}`;
  const vertical = orientation === 'vertical';

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((x) => x.key === value);
    const prev = vertical ? 'ArrowUp' : 'ArrowLeft';
    const next = vertical ? 'ArrowDown' : 'ArrowRight';
    let j: number | null = null;
    if (e.key === prev) j = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === next) j = (i + 1) % tabs.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = tabs.length - 1;
    const target = j === null ? undefined : tabs[j];
    if (!target) return;
    e.preventDefault();
    onChange(target.key);
    refs.current.get(target.key)?.focus();
  };

  const shown = props.keepMounted ? tabs : tabs.filter((x) => x.key === value);
  return (
    <div
      className={[vertical ? styles.vertical : styles.horizontal, props.className ?? '']
        .filter(Boolean)
        .join(' ')}
    >
      <div className={styles.bar}>
        <div
          role="tablist"
          aria-label={props.label}
          aria-orientation={orientation}
          className={styles.list}
          onKeyDown={onKeyDown}
        >
          {tabs.map((x) => {
            const selected = x.key === value;
            return (
              <button
                key={x.key}
                ref={(el) => {
                  if (el) refs.current.set(x.key, el);
                  else refs.current.delete(x.key);
                }}
                type="button"
                role="tab"
                id={tabId(x.key)}
                aria-selected={selected}
                aria-controls={panelId(x.key)}
                tabIndex={selected ? 0 : -1}
                title={x.title}
                className={styles.tab}
                onClick={() => onChange(x.key)}
              >
                {x.label}
                {x.badge}
              </button>
            );
          })}
        </div>
        {props.toolbar && !vertical ? <div className={styles.toolbar}>{props.toolbar}</div> : null}
      </div>
      {shown.map((x) => (
        <div
          key={x.key}
          role="tabpanel"
          id={panelId(x.key)}
          aria-labelledby={tabId(x.key)}
          hidden={x.key !== value}
          tabIndex={0}
          className={[styles.panel, props.panelClassName ?? ''].filter(Boolean).join(' ')}
        >
          {props.panels[x.key]}
        </div>
      ))}
    </div>
  );
}
