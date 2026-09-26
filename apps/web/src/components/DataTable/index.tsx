/**
 * `DataTable` – Datentabelle (components.md §2.11, AP-26a; Entscheidung Sven 26.09.2026): Sortieren per
 * Klick auf den Spaltenkopf (auf → ab → aus, `aria-sort`, stabil, leere Werte zuletzt), bei wenig Platz
 * **Spalten ausblenden statt horizontal scrollen** – nach Priorität, die ausgeblendeten Werte stehen in
 * einer je Zeile aufklappbaren Detailzeile. Gruppen als Zwischenüberschriften in einer Tabelle (Spalten
 * fluchten), stehender Kopf, Zustände laden/leer/Fehler. Keine Datenabfrage, keine Rechteprüfung.
 */
import {
  Fragment,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ICON_SIZE, uiIcons } from '../icons';
import { hideOrder, nextSort, sortRows, type SortState, type SortValue } from './model';
import styles from './DataTable.module.css';

export type { SortDir, SortState, SortValue } from './model';
export { compareValues, hideOrder, nextSort, sortRows } from './model';

export interface DataColumn<T> {
  readonly id: string;
  /** Spaltenkopf; zugleich Beschriftung in der Detailzeile. */
  readonly header: string;
  readonly cell: (row: T) => ReactNode;
  /** Wert für die Sortierung; ohne ihn ist die Spalte nicht sortierbar. */
  readonly sortValue?: (row: T) => SortValue;
  /** Serverseitig sortierbar (gesteuerte Sortierung ohne `sortValue`). */
  readonly sortable?: boolean;
  /** 1 = nie ausblenden (Standard); je größer, desto früher wird die Spalte bei Platzmangel ausgeblendet. */
  readonly priority?: number;
  readonly align?: 'start' | 'end';
  /** Zellinhalt nicht umbrechen. */
  readonly nowrap?: boolean;
  /** Kopf nur für Screenreader (z. B. Bild- oder Aktionsspalte). */
  readonly headerHidden?: boolean;
  readonly className?: string;
}

export interface DataTableGroups<T> {
  readonly key: (row: T) => string;
  readonly header: (key: string, rows: readonly T[]) => ReactNode;
}

export interface DataTableProps<T> {
  readonly columns: readonly DataColumn<T>[];
  readonly rows: readonly T[];
  readonly rowKey: (row: T) => string;
  /** Zugänglicher Name der Tabelle. */
  readonly label: string;
  /** Kurzname einer Zeile für den Knopf der Detailzeile („Details zu M 31“). */
  readonly rowLabel?: (row: T) => string;
  /** Gesteuerte Sortierung (URL-Zustand, Server); ohne sie verwaltet der Baustein sie selbst. */
  readonly sort?: SortState | null;
  readonly onSortChange?: (sort: SortState | null) => void;
  readonly defaultSort?: SortState | null;
  /** Zeilen kommen schon sortiert (Server); der Baustein sortiert dann nicht selbst. */
  readonly serverSorted?: boolean;
  readonly groups?: DataTableGroups<T>;
  readonly rowProps?: (
    row: T,
  ) => HTMLAttributes<HTMLTableRowElement> & Record<`data-${string}`, unknown>;
  readonly state?: 'loading' | 'error' | 'ready';
  /** Inhalt bei leerer Liste (Standard: „Keine Einträge.“). */
  readonly empty?: ReactNode;
  /** Inhalt im Fehlerzustand (z. B. `ProblemMessage`). */
  readonly error?: ReactNode;
  readonly className?: string;
}

export function DataTable<T>(props: DataTableProps<T>) {
  const { t, i18n } = useTranslation();
  const { columns, rows, rowKey, groups } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [ownSort, setOwnSort] = useState<SortState | null>(props.defaultSort ?? null);
  const sort = props.sort !== undefined ? props.sort : ownSort;
  const [hidden, setHidden] = useState(0);
  // Letzte Stufe: passt die Tabelle auch nur mit Priorität 1 nicht, dürfen alle Zellen umbrechen.
  const [squeezed, setSqueezed] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [width, setWidth] = useState(0);

  const order = useMemo(() => hideOrder(columns), [columns]);
  const hiddenIds = useMemo(() => new Set(order.slice(0, hidden)), [order, hidden]);
  const visible = columns.filter((c) => !hiddenIds.has(c.id));
  const hiddenCols = columns.filter((c) => hiddenIds.has(c.id));
  const detail = hiddenCols.length > 0;

  // Container beobachten: bei neuer Breite wieder alle Spalten zeigen und neu ausblenden.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => {
    setHidden(0);
    setSqueezed(false);
  }, [width, rows.length, columns.length]);
  // Solange die Tabelle breiter ist als der Container, die nächste Spalte ausblenden (vor dem Zeichnen);
  // reicht das nicht, Umbruch zulassen.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const table = tableRef.current;
    if (!wrap || !table || wrap.clientWidth === 0) return;
    if (table.scrollWidth <= wrap.clientWidth + 1) return;
    if (hidden < order.length) setHidden(hidden + 1);
    else if (!squeezed) setSqueezed(true);
  });

  const sorted = useMemo(() => {
    if (!sort || props.serverSorted) return rows;
    const col = columns.find((c) => c.id === sort.id);
    if (!col?.sortValue) return rows;
    return sortRows(rows, col.sortValue, sort.dir, i18n.language);
  }, [rows, sort, columns, props.serverSorted, i18n.language]);

  const grouped = useMemo(() => {
    if (!groups) return [{ key: '', rows: sorted }];
    const map = new Map<string, T[]>();
    for (const row of sorted) {
      const k = groups.key(row);
      map.set(k, [...(map.get(k) ?? []), row]);
    }
    // Reihenfolge der Gruppen: erstes Auftreten in der unsortierten Liste.
    const first = [...new Set(rows.map((r) => groups.key(r)))];
    return first.filter((k) => map.has(k)).map((k) => ({ key: k, rows: map.get(k) ?? [] }));
  }, [sorted, rows, groups]);

  const changeSort = (id: string) => {
    const next = nextSort(sort, id);
    if (props.sort === undefined) setOwnSort(next);
    props.onSortChange?.(next);
  };
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (props.state === 'loading')
    return <div className={styles.skeleton} role="status" aria-label={t('common.loading')} />;
  if (props.state === 'error') return <>{props.error ?? null}</>;
  if (rows.length === 0)
    return <p className={styles.empty}>{props.empty ?? t('dataTable.empty')}</p>;

  const span = visible.length + (detail ? 1 : 0);
  const SortIcon = ({ id }: { id: string }) => {
    const Icon =
      sort?.id !== id ? uiIcons.sortable : sort.dir === 'asc' ? uiIcons.up : uiIcons.down;
    return (
      <Icon size={ICON_SIZE.table} aria-hidden className={sort?.id === id ? '' : styles.sortIdle} />
    );
  };
  const alignClass = (c: DataColumn<T>) =>
    [
      c.align === 'end' ? styles.end : '',
      c.nowrap && !squeezed ? styles.nowrap : '',
      c.className ?? '',
    ]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <div ref={wrapRef} className={`${styles.wrap} ${props.className ?? ''}`}>
      <table
        ref={tableRef}
        className={`${styles.table} ${squeezed ? styles.squeezed : ''}`}
        aria-label={props.label}
      >
        <thead>
          <tr>
            {detail ? (
              <th scope="col" className={styles.detailCol}>
                <span className="visually-hidden">{t('dataTable.details')}</span>
              </th>
            ) : null}
            {visible.map((c) => {
              const sortable = !!c.sortValue || !!c.sortable;
              const ariaSort = sortable
                ? sort?.id === c.id
                  ? sort.dir === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none'
                : undefined;
              return (
                <th key={c.id} scope="col" aria-sort={ariaSort} className={alignClass(c)}>
                  {sortable ? (
                    <button
                      type="button"
                      className={styles.sortButton}
                      onClick={() => changeSort(c.id)}
                      title={t('dataTable.sortBy', { column: c.header })}
                    >
                      <span className={c.headerHidden ? 'visually-hidden' : undefined}>
                        {c.header}
                      </span>
                      <SortIcon id={c.id} />
                    </button>
                  ) : (
                    <span className={c.headerHidden ? 'visually-hidden' : undefined}>
                      {c.header}
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {grouped.map((g) => (
            <Fragment key={g.key}>
              {groups ? (
                <tr className={styles.groupRow}>
                  <th scope="colgroup" colSpan={span}>
                    {groups.header(g.key, g.rows)}
                  </th>
                </tr>
              ) : null}
              {g.rows.map((row) => {
                const key = rowKey(row);
                const expanded = detail && open.has(key);
                const Toggle = expanded ? uiIcons.detailOpen : uiIcons.detailClosed;
                return (
                  <Fragment key={key}>
                    <tr {...(props.rowProps?.(row) ?? {})}>
                      {detail ? (
                        <td className={styles.detailCol}>
                          <button
                            type="button"
                            className={styles.detailButton}
                            aria-expanded={expanded}
                            aria-label={t('dataTable.detailsOf', {
                              row: props.rowLabel?.(row) ?? key,
                            })}
                            onClick={() => toggle(key)}
                          >
                            <Toggle size={ICON_SIZE.table} aria-hidden />
                          </button>
                        </td>
                      ) : null}
                      {visible.map((c) => (
                        <td key={c.id} className={alignClass(c)}>
                          {c.cell(row)}
                        </td>
                      ))}
                    </tr>
                    {expanded ? (
                      <tr className={styles.detailRow}>
                        <td colSpan={span}>
                          <dl className={styles.detailList}>
                            {hiddenCols.map((c) => (
                              <div key={c.id}>
                                <dt>{c.header}</dt>
                                <dd>{c.cell(row)}</dd>
                              </div>
                            ))}
                          </dl>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
