// @vitest-environment jsdom
/**
 * `EmojiPicker` (components.md §2.23): Knopf öffnet die feste Auswahl, Klick wählt und schließt, gewählte
 * Einträge mit `aria-pressed`, `Esc` schließt ohne Auswahl, gesperrt ohne Wirkung; axe.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import { uiIcons } from '../icons';
import { EmojiPicker } from '.';

const EMOJIS = ['👍', '❤️', '🔭'] as const;

describe('EmojiPicker (Baustein)', () => {
  it('öffnet die Auswahl, wählt und schließt; aria-pressed für gewählte; axe', async () => {
    const onPick = vi.fn();
    const { container } = render(
      <EmojiPicker
        emojis={EMOJIS}
        selected={['🔭']}
        label="Reaktion hinzufügen"
        icon={uiIcons.react}
        onPick={onPick}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Reaktion hinzufügen' });
    fireEvent.click(trigger);
    const group = await screen.findByRole('group', { name: 'Reaktion hinzufügen' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual([...EMOJIS]);
    expect(within(group).getByRole('button', { name: '🔭' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expectNoSeriousA11y(container.ownerDocument.body);
    fireEvent.click(within(group).getByRole('button', { name: '❤️' }));
    expect(onPick).toHaveBeenCalledWith('❤️');
    await waitFor(() => expect(screen.queryByRole('group')).toBeNull());
  });

  it('Esc schließt ohne Auswahl; gesperrt öffnet nicht', async () => {
    const onPick = vi.fn();
    const { rerender } = render(
      <EmojiPicker emojis={EMOJIS} label="Emoji einfügen" icon={uiIcons.emoji} onPick={onPick} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Emoji einfügen' }));
    const group = await screen.findByRole('group', { name: 'Emoji einfügen' });
    fireEvent.keyDown(group, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('group')).toBeNull());
    expect(onPick).not.toHaveBeenCalled();
    rerender(
      <EmojiPicker
        emojis={EMOJIS}
        label="Emoji einfügen"
        icon={uiIcons.emoji}
        onPick={onPick}
        disabled
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Emoji einfügen' });
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByRole('group')).toBeNull();
  });
});
