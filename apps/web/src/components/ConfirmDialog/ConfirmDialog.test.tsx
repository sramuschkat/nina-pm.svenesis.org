// @vitest-environment jsdom
/** `ConfirmDialog` (components.md §2.10, §4): Doppelklick, Esc, Fokus, Namenseingabe, Zustände. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import { ConfirmDialog, type ConfirmDialogProps } from './index';

function Harness(props: Partial<ConfirmDialogProps> & { onConfirm?: () => void | Promise<void> }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        auslösen
      </button>
      <ConfirmDialog
        open={open}
        title="Projekt NGC 7380 löschen?"
        consequence="Das Projekt wird in den Papierkorb verschoben."
        confirmLabel="Löschen"
        variant="danger"
        onCancel={() => setOpen(false)}
        {...props}
        onConfirm={props.onConfirm ?? (() => undefined)}
      />
    </>
  );
}

describe('ConfirmDialog', () => {
  it('Fokus beim Öffnen auf Abbrechen; alertdialog mit Titel und Folgesatz; axe ohne serious/critical', async () => {
    render(<Harness />);
    const dialog = await screen.findByRole('alertdialog');
    expect(screen.getByRole('button', { name: 'Abbrechen' })).toHaveFocus();
    expect(dialog).toHaveAccessibleName('Projekt NGC 7380 löschen?');
    expect(dialog).toHaveAccessibleDescription('Das Projekt wird in den Papierkorb verschoben.');
    await expectNoSeriousA11y();
  });

  it('Doppelklick auf den Aktionsknopf → genau ein Aufruf', async () => {
    let release: () => void = () => undefined;
    const onConfirm = vi.fn(() => new Promise<void>((r) => (release = r)));
    render(<Harness onConfirm={onConfirm} />);
    const button = await screen.findByRole('button', { name: 'Löschen' });
    await userEvent.dblClick(button);
    await userEvent.click(button);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    release();
  });

  it('Esc = Abbrechen; Klick außerhalb schließt nicht', async () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="x?"
        consequence="y."
        confirmLabel="Widerrufen"
        onConfirm={() => undefined}
        onCancel={onCancel}
      />,
    );
    await screen.findByRole('alertdialog');
    // Radix sperrt Zeiger-Ereignisse außerhalb (modal); der Klick daneben darf den Dialog nicht schließen.
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);
    expect(onCancel).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('während loading: beide Knöpfe gesperrt, Esc schließt nicht', async () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        state="loading"
        title="x?"
        consequence="y."
        confirmLabel="Übertragen"
        onConfirm={() => undefined}
        onCancel={onCancel}
      />,
    );
    await screen.findByRole('alertdialog');
    expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Übertragen/ })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('error: Meldung aus errors.* per aria-live, Dialog bleibt offen, Knopf wieder aktiv', async () => {
    render(
      <ConfirmDialog
        open
        state="error"
        errorKey="errors.member.ownerProtected"
        title="x?"
        consequence="y."
        confirmLabel="Entziehen"
        variant="danger"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(await screen.findByText('Der Owner kann so nicht geändert werden')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entziehen' })).toBeEnabled();
  });

  it('Namenseingabe: falsche Eingabe hält den Knopf gesperrt, Fehlertext erst nach Verlassen; exakt (getrimmt) gibt frei', async () => {
    const onConfirm = vi.fn();
    render(<Harness confirmName="test" onConfirm={onConfirm} />);
    const input = await screen.findByLabelText('Zum Bestätigen „test“ eingeben');
    expect(input).toHaveFocus();
    const button = screen.getByRole('button', { name: 'Löschen' });
    await userEvent.type(input, 'Test');
    expect(button).toBeDisabled();
    expect(screen.queryByText(/stimmt nicht/)).not.toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    expect(onConfirm).not.toHaveBeenCalled();
    await userEvent.tab();
    expect(screen.getByText('Die Eingabe stimmt nicht mit „test“ überein.')).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, '  test ');
    expect(button).toBeEnabled();
    await userEvent.click(input);
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });

  it('lange Titel werden nach 60 Zeichen gekürzt, der volle Titel steht im title', async () => {
    const long = `Projekt ${'X'.repeat(80)} löschen?`;
    render(
      <ConfirmDialog
        open
        title={long}
        consequence="y."
        confirmLabel="Löschen"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    const heading = await screen.findByTitle(long);
    expect(heading.textContent?.endsWith('…')).toBe(true);
  });
});
