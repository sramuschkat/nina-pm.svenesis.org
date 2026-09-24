// @vitest-environment jsdom
import { notificationKinds } from '@nina-pm/shared';
import { flattenKeys, resources } from '@nina-pm/i18n';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import { NotificationList, type NotificationItem } from './index';

const items: NotificationItem[] = [
  {
    id: 'n1',
    kind: 'role.changed',
    payload: { from: 'user', to: 'admin' },
    readAt: null,
    createdAt: '2026-09-18T02:08:00Z',
  },
  {
    id: 'n2',
    kind: 'approval.approved',
    payload: { subject: 'NGC 7380' },
    readAt: '2026-09-18T03:00:00Z',
    createdAt: '2026-09-17T20:00:00Z',
  },
];

describe('NotificationList (FA-FRG-11)', () => {
  it('ein Text je Benachrichtigungsart in DE und EN', () => {
    for (const keys of [
      flattenKeys(resources.de.translation),
      flattenKeys(resources.en.translation),
    ]) {
      for (const kind of notificationKinds) expect(keys).toContain(`notifications.kind.${kind}`);
    }
  });

  it('Text mit übersetzten Rollen, Betreff, Zeit in Mandantenzeit mit Kürzel; ungelesen markierbar', async () => {
    const onMarkRead = vi.fn();
    render(
      <NotificationList
        state="ready"
        items={items}
        tenantTimeZone="America/Chicago"
        onMarkRead={onMarkRead}
      />,
    );
    expect(screen.getByText(/Deine Rolle wurde von User zu Admin geändert/)).toBeInTheDocument();
    expect(screen.getByText('NGC 7380')).toBeInTheDocument();
    expect(screen.getByText('17.09.2026 21:08 CDT')).toHaveAttribute(
      'title',
      'Mandantenzeit (America/Chicago)',
    );
    // Nur der ungelesene Eintrag hat den Knopf.
    const buttons = screen.getAllByRole('button', { name: 'Als gelesen markieren' });
    expect(buttons).toHaveLength(1);
    await userEvent.click(buttons[0] as HTMLElement);
    expect(onMarkRead).toHaveBeenCalledWith('n1');
    await expectNoSeriousA11y(document.body);
  });

  it('Zustände leer, laden, Fehler mit erneutem Versuch; unbekannte Art fällt auf Sammeltext zurück', async () => {
    const { rerender } = render(
      <NotificationList state="loading" items={[]} tenantTimeZone="Europe/Berlin" />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Wird geladen');
    rerender(<NotificationList state="ready" items={[]} tenantTimeZone="Europe/Berlin" />);
    expect(screen.getByText('Keine Benachrichtigungen.')).toBeInTheDocument();
    const onRetry = vi.fn();
    rerender(
      <NotificationList
        state="error"
        items={[]}
        tenantTimeZone="Europe/Berlin"
        onRetry={onRetry}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(onRetry).toHaveBeenCalled();
    rerender(
      <NotificationList
        state="ready"
        items={items.slice(1).map((n) => ({ ...n, kind: 'future.kind' }))}
        tenantTimeZone="Europe/Berlin"
      />,
    );
    expect(screen.getByText('Benachrichtigung')).toBeInTheDocument();
  });
});
