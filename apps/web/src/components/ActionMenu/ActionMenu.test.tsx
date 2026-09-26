// @vitest-environment jsdom
/** `ActionMenu` (components.md §2.15, AP-26d): Knopf mit Namen, Einträge, Gefahr, deaktiviert, Tastatur; axe. */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import { ActionMenu } from './index';

describe('ActionMenu', () => {
  it('öffnet per Klick und Tastatur, löst Einträge aus, deaktivierte nicht; axe', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const onArchive = vi.fn();
    render(
      <ActionMenu
        label="Weitere Aktionen zu M 31"
        items={[
          { key: 'archive', label: 'Archivieren', onSelect: onArchive, disabled: true },
          { key: 'delete', label: 'Löschen', onSelect: onDelete, danger: true },
        ]}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Weitere Aktionen zu M 31' });
    await expectNoSeriousA11y();
    await user.click(trigger);
    expect(await screen.findByRole('menuitem', { name: 'Archivieren' })).toHaveAttribute(
      'data-disabled',
    );
    await user.click(screen.getByRole('menuitem', { name: 'Löschen' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onArchive).not.toHaveBeenCalled();
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('ohne Einträge kein Knopf', () => {
    const { container } = render(<ActionMenu label="x" items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
