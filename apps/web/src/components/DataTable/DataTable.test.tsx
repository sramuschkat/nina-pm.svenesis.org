// @vitest-environment jsdom
/**
 * `DataTable` (components.md §2.11, AP-26a): Sortierung per Spaltenkopf (auf → ab → aus, stabil, leere
 * Werte zuletzt, natürliche Reihenfolge, `aria-sort`), gesteuert, Spalten ausblenden nach Priorität bei
 * schmalem Container mit Detailzeile, Gruppen, Zustände, Tastatur, axe.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import { DataTable, compareValues, hideOrder, nextSort, sortRows, type DataColumn } from './index';

interface Row {
  id: string;
  name: string;
  mag: number | null;
  rig: string;
  note: string;
}
const ROWS: Row[] = [
  { id: 'a', name: 'NGC 891', mag: 9.9, rig: 'A', note: 'Kante' },
  { id: 'b', name: 'M 31', mag: 3.4, rig: 'B', note: 'groß' },
  { id: 'c', name: 'NGC 7000', mag: null, rig: 'A', note: 'Nebel' },
  { id: 'd', name: 'M 101', mag: 7.9, rig: 'B', note: 'Spirale' },
];
const COLUMNS: DataColumn<Row>[] = [
  { id: 'name', header: 'Name', cell: (r) => r.name, sortValue: (r) => r.name },
  {
    id: 'mag',
    header: 'Helligkeit',
    cell: (r) => (r.mag === null ? '–' : String(r.mag)),
    sortValue: (r) => r.mag,
    align: 'end',
    priority: 2,
  },
  { id: 'note', header: 'Notiz', cell: (r) => r.note, priority: 3 },
];

const names = () =>
  within(screen.getByRole('table'))
    .getAllByRole('row')
    .slice(1)
    .map((r) => r.querySelector('td:not([class*=detailCol])')?.textContent);

afterEach(() => vi.restoreAllMocks());

describe('Modell', () => {
  it('nextSort: aus → auf → ab → aus; andere Spalte beginnt mit auf', () => {
    expect(nextSort(null, 'a')).toEqual({ id: 'a', dir: 'asc' });
    expect(nextSort({ id: 'a', dir: 'asc' }, 'a')).toEqual({ id: 'a', dir: 'desc' });
    expect(nextSort({ id: 'a', dir: 'desc' }, 'a')).toBeNull();
    expect(nextSort({ id: 'a', dir: 'desc' }, 'b')).toEqual({ id: 'b', dir: 'asc' });
  });
  it('sortRows: natürlich, stabil, leere Werte in beiden Richtungen hinten', () => {
    const rows = ['NGC 7000', 'NGC 891', 'M 101', 'M 31', '', null].map((v, i) => ({ v, i }));
    expect(sortRows(rows, (r) => r.v, 'asc', 'de').map((r) => r.v)).toEqual([
      'M 31',
      'M 101',
      'NGC 891',
      'NGC 7000',
      '',
      null,
    ]);
    expect(sortRows(rows, (r) => r.v, 'desc', 'de').map((r) => r.v)).toEqual([
      'NGC 7000',
      'NGC 891',
      'M 101',
      'M 31',
      '',
      null,
    ]);
    const same = [1, 2, 3].map((i) => ({ v: 5, i }));
    expect(sortRows(same, (r) => r.v, 'desc', 'de').map((r) => r.i)).toEqual([1, 2, 3]);
    expect(compareValues(true, false, 'asc', new Intl.Collator('de'))).toBe(1);
  });
  it('hideOrder: höchste Priorität zuerst, bei Gleichstand von rechts; Priorität 1 nie', () => {
    expect(
      hideOrder([
        { id: 'a' },
        { id: 'b', priority: 2 },
        { id: 'c', priority: 3 },
        { id: 'd', priority: 2 },
      ]),
    ).toEqual(['c', 'd', 'b']);
  });
});

describe('DataTable', () => {
  it('Sortieren per Klick auf den Spaltenkopf; aria-sort; axe', async () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} label="Objekte" />);
    expect(names()).toEqual(['NGC 891', 'M 31', 'NGC 7000', 'M 101']);
    const head = screen.getByRole('columnheader', { name: /Name/ });
    expect(head).toHaveAttribute('aria-sort', 'none');
    fireEvent.click(within(head).getByRole('button'));
    expect(head).toHaveAttribute('aria-sort', 'ascending');
    expect(names()).toEqual(['M 31', 'M 101', 'NGC 891', 'NGC 7000']);
    fireEvent.click(within(head).getByRole('button'));
    expect(head).toHaveAttribute('aria-sort', 'descending');
    expect(names()).toEqual(['NGC 7000', 'NGC 891', 'M 101', 'M 31']);
    fireEvent.click(within(head).getByRole('button'));
    expect(names()).toEqual(['NGC 891', 'M 31', 'NGC 7000', 'M 101']);
    // Zahlen, leerer Wert hinten
    fireEvent.click(screen.getByRole('button', { name: /Helligkeit/ }));
    expect(names()).toEqual(['M 31', 'M 101', 'NGC 891', 'NGC 7000']);
    // Spalte ohne sortValue ist nicht sortierbar
    expect(screen.getByRole('columnheader', { name: 'Notiz' })).not.toHaveAttribute('aria-sort');
    await expectNoSeriousA11y();
  });

  it('gesteuert: meldet die neue Sortierung, sortiert serverseitig nicht selbst', () => {
    const onSortChange = vi.fn();
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        label="Objekte"
        sort={{ id: 'name', dir: 'desc' }}
        onSortChange={onSortChange}
        serverSorted
      />,
    );
    expect(names()).toEqual(['NGC 891', 'M 31', 'NGC 7000', 'M 101']);
    fireEvent.click(screen.getByRole('button', { name: /Name/ }));
    expect(onSortChange).toHaveBeenCalledWith(null);
  });

  it('schmaler Container: Spalten nach Priorität ausblenden, Werte in der Detailzeile', () => {
    // Tabellenbreite = 200 px je sichtbarer Spalte, Container 450 px → zwei Spalten passen.
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(450);
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.tagName === 'TABLE'
        ? this.querySelectorAll('thead th:not([class*=detailCol])').length * 200
        : 450;
    });
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        label="Objekte"
        rowLabel={(r) => r.name}
      />,
    );
    expect(screen.queryByRole('columnheader', { name: 'Notiz' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Helligkeit/ })).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Weitere Angaben zu M 31' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const detail = screen.getByText('Notiz').closest('dl') as HTMLElement;
    expect(detail).toHaveTextContent('Notizgroß');
  });

  it('renderDetail: Detailzeile immer aufklappbar, eigener Inhalt (AP-26e)', () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        label="Objekte"
        rowLabel={(r) => r.name}
        renderDetail={(r) => <p>Diagramm {r.name}</p>}
      />,
    );
    const toggle = screen.getByRole('button', { name: 'Weitere Angaben zu M 101' });
    expect(screen.queryByText('Diagramm M 101')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText('Diagramm M 101')).toBeInTheDocument();
    // ohne ausgeblendete Spalten keine leere Liste
    expect(screen.queryByRole('term')).not.toBeInTheDocument();
  });

  it('Tastatur: Spaltenkopf und Detailzeile mit Tab und Enter/Leertaste', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(450);
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.tagName === 'TABLE'
        ? this.querySelectorAll('thead th:not([class*=detailCol])').length * 200
        : 450;
    });
    const user = userEvent.setup();
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        label="Objekte"
        rowLabel={(r) => r.name}
      />,
    );
    await user.tab();
    expect(screen.getByRole('button', { name: /Name/ })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    await user.tab();
    await user.keyboard(' ');
    expect(screen.getByRole('columnheader', { name: /Helligkeit/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    // Nach den Köpfen folgt der Detailknopf der ersten Zeile (sortiert: M 31).
    await user.tab();
    const toggle = screen.getByRole('button', { name: 'Weitere Angaben zu M 31' });
    expect(toggle).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('Gruppen als Zwischenüberschriften in einer Tabelle; Sortierung innerhalb der Gruppe', () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        label="Objekte"
        groups={{ key: (r) => r.rig, header: (k, rows) => `Rig ${k} (${String(rows.length)})` }}
        defaultSort={{ id: 'name', dir: 'asc' }}
      />,
    );
    expect(screen.getAllByRole('table')).toHaveLength(1);
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([
      'Rig A (2)',
      expect.stringContaining('NGC 891'),
      expect.stringContaining('NGC 7000'),
      'Rig B (2)',
      expect.stringContaining('M 31'),
      expect.stringContaining('M 101'),
    ]);
  });

  it('Zustände: laden, leer, Fehler', () => {
    const { rerender } = render(
      <DataTable columns={COLUMNS} rows={[]} rowKey={(r) => r.id} label="x" state="loading" />,
    );
    expect(screen.getByRole('status', { name: 'Wird geladen …' })).toBeInTheDocument();
    rerender(<DataTable columns={COLUMNS} rows={[]} rowKey={(r) => r.id} label="x" />);
    expect(screen.getByText('Keine Einträge.')).toBeInTheDocument();
    rerender(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        label="x"
        state="error"
        error={<p role="alert">kaputt</p>}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('kaputt');
  });
});
