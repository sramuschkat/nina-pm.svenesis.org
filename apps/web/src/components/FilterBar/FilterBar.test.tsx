// @vitest-environment jsdom
/**
 * `FilterBar` (components.md §2.13, AP-26c): Suche, Chips mit × (Fokus bleibt in der Leiste), Knopf
 * *Filter* mit `aria-expanded` und Fokus in den Bereich, `Esc` schließt, *Alle zurücksetzen*,
 * Umschalter `aria-pressed`, Trefferzahl als Status, axe.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import { FilterBar, FilterCheck, FilterField, FilterToggle } from './index';

function Harness({ onSubmit }: { onSubmit?: () => void }) {
  const [q, setQ] = useState('');
  const [rig, setRig] = useState('');
  const [fav, setFav] = useState(false);
  const [trash, setTrash] = useState(false);
  const chips = [
    ...(rig ? [{ id: 'rig', label: `Rig: ${rig}`, onRemove: () => setRig('') }] : []),
    ...(fav ? [{ id: 'fav', label: 'nur Favoriten', onRemove: () => setFav(false) }] : []),
  ];
  return (
    <FilterBar
      label="Filter der Liste"
      search={{
        value: q,
        onChange: setQ,
        label: 'Suche',
        placeholder: 'Name',
        ...(onSubmit ? { onSubmit } : {}),
      }}
      chips={chips}
      panel={
        <>
          <FilterField label="Rig" htmlFor="rig">
            <select id="rig" value={rig} onChange={(e) => setRig(e.target.value)}>
              <option value="">alle</option>
              <option value="Rig A">Rig A</option>
            </select>
          </FilterField>
          <FilterCheck label="nur Favoriten" checked={fav} onChange={setFav} />
        </>
      }
      extra={<FilterToggle label="Papierkorb" pressed={trash} onChange={setTrash} />}
      count={`${q ? 1 : 3} von 3 Projekten`}
      view={<button type="button">Liste</button>}
      onReset={() => {
        setRig('');
        setFav(false);
      }}
    />
  );
}

describe('FilterBar', () => {
  it('eine Zeile: Suche, Knopf zu, Umschalter, Trefferzahl, Ansicht; axe', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByRole('group', { name: 'Filter der Liste' })).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Filter' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Rig')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Aktive Filter' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('3 von 3 Projekten');
    await user.type(screen.getByRole('searchbox', { name: 'Suche' }), 'M');
    expect(screen.getByRole('status')).toHaveTextContent('1 von 3 Projekten');
    const trash = screen.getByRole('button', { name: 'Papierkorb' });
    expect(trash).toHaveAttribute('aria-pressed', 'false');
    await user.click(trash);
    expect(trash).toHaveAttribute('aria-pressed', 'true');
    await expectNoSeriousA11y();
  });

  it('Aufklappen: Fokus im Bereich, Wert setzen ergibt Chip, × entfernt ihn; Esc schließt', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Filter' });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByRole('group', { name: 'Filter', hidden: false });
    expect(toggle).toHaveAttribute('aria-controls', panel.id);
    expect(screen.getByLabelText('Rig')).toHaveFocus();
    await user.selectOptions(screen.getByLabelText('Rig'), 'Rig A');
    await user.click(screen.getByLabelText('nur Favoriten'));
    const chips = screen.getByRole('list', { name: 'Aktive Filter' });
    expect(chips).toHaveTextContent('Rig: Rig A');
    expect(chips).toHaveTextContent('nur Favoriten');
    await expectNoSeriousA11y();
    // Esc im Bereich schließt ihn, der Fokus geht zurück auf den Knopf; die Chips bleiben.
    await user.keyboard('{Escape}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
    expect(screen.queryByLabelText('Rig')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Filter Rig: Rig A entfernen' }));
    expect(screen.getByRole('list', { name: 'Aktive Filter' })).not.toHaveTextContent('Rig A');
    // Fokus springt auf den nächsten Chip, nach dem letzten auf den Knopf.
    const fav = screen.getByRole('button', { name: 'Filter nur Favoriten entfernen' });
    expect(fav).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('list', { name: 'Aktive Filter' })).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
  });

  it('Alle zurücksetzen leert alle Filter', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    await user.selectOptions(screen.getByLabelText('Rig'), 'Rig A');
    await user.click(screen.getByLabelText('nur Favoriten'));
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Alle zurücksetzen' }));
    expect(screen.queryByRole('list', { name: 'Aktive Filter' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Rig')).toHaveValue('');
  });

  it('Enter im Suchfeld ruft onSubmit; ohne panel kein Knopf', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const { unmount } = render(<Harness onSubmit={onSubmit} />);
    await user.type(screen.getByRole('searchbox', { name: 'Suche' }), 'M 31{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    unmount();
    render(<FilterBar label="Leiste" count="0 von 0" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('0 von 0');
  });

  it('Grenzfall: langer Chip-Text wird gekürzt, voller Text im title und im Namen von ×', () => {
    const long = `Sternbild: ${'Andromeda '.repeat(8).trim()}`;
    render(
      <FilterBar label="Leiste" chips={[{ id: 'c', label: long, onRemove: () => undefined }]} />,
    );
    expect(screen.getByTitle(long)).toHaveTextContent(long);
    expect(screen.getByRole('button', { name: `Filter ${long} entfernen` })).toBeInTheDocument();
  });
});
