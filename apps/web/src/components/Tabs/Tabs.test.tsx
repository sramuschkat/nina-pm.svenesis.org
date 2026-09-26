// @vitest-environment jsdom
/**
 * `Tabs` (components.md §2.12, AP-26b): Rollen und Verknüpfung Reiter ↔ Inhalt, Tastatur (Pfeile,
 * Pos1/Ende, nur der aktive Reiter in der Tab-Reihenfolge), `keepMounted`, Werkzeuge, axe.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import { Tabs } from './index';

type Key = 'a' | 'b' | 'c';

function Harness({
  keepMounted = false,
  orientation,
}: {
  keepMounted?: boolean;
  orientation?: 'horizontal' | 'vertical';
}) {
  const [value, setValue] = useState<Key>('a');
  return (
    <Tabs<Key>
      label="Bereich"
      value={value}
      onChange={setValue}
      keepMounted={keepMounted}
      {...(orientation ? { orientation } : {})}
      tabs={[
        { key: 'a', label: 'Ziel' },
        { key: 'b', label: 'Bedingungen', badge: <span> (Fehler)</span> },
        { key: 'c', label: 'Bild' },
      ]}
      panels={{ a: <p>Inhalt A</p>, b: <p>Inhalt B</p>, c: <p>Inhalt C</p> }}
      toolbar={<button type="button">Werkzeug</button>}
    />
  );
}

describe('Tabs', () => {
  it('Rollen, Verknüpfung und Wechsel per Klick; axe', async () => {
    render(<Harness />);
    const list = screen.getByRole('tablist', { name: 'Bereich' });
    expect(list).toHaveAttribute('aria-orientation', 'horizontal');
    const a = screen.getByRole('tab', { name: 'Ziel' });
    expect(a).toHaveAttribute('aria-selected', 'true');
    const panel = screen.getByRole('tabpanel', { name: 'Ziel' });
    expect(panel).toHaveTextContent('Inhalt A');
    expect(a).toHaveAttribute('aria-controls', panel.id);
    expect(screen.queryByText('Inhalt B')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /Bedingungen/ }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Inhalt B');
    expect(screen.getByRole('button', { name: 'Werkzeug' })).toBeInTheDocument();
    await expectNoSeriousA11y();
  });

  it('Tastatur: nur der aktive Reiter per Tab, Pfeile wechseln, Pos1/Ende', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.tab();
    expect(screen.getByRole('tab', { name: 'Ziel' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /Bedingungen/ })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Inhalt B');
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Bild' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Ziel' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}{Home}');
    expect(screen.getByRole('tab', { name: 'Ziel' })).toHaveAttribute('aria-selected', 'true');
    // Tab verlässt die Leiste: erst die Werkzeuge, dann der Inhalt des aktiven Reiters.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Werkzeug' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('tabpanel')).toHaveFocus();
  });

  it('senkrecht: Pfeil runter/hoch', async () => {
    const user = userEvent.setup();
    render(<Harness orientation="vertical" />);
    expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'vertical');
    await user.tab();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('tab', { name: /Bedingungen/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('tab', { name: 'Ziel' })).toHaveAttribute('aria-selected', 'true');
  });

  it('keepMounted: verdeckte Reiter bleiben im DOM (hidden)', () => {
    render(<Harness keepMounted />);
    expect(screen.getByText('Inhalt B').closest('[role=tabpanel]')).toHaveAttribute('hidden');
    expect(screen.getByText('Inhalt A').closest('[role=tabpanel]')).not.toHaveAttribute('hidden');
  });
});
