// @vitest-environment jsdom
/**
 * `CommentCount` (components.md §2.24): Sprechblase mit Zahl und Beschriftung; bei 0 nichts; axe.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import { CommentCount } from '.';

describe('CommentCount (Baustein)', () => {
  it('Zahl mit Beschriftung; axe', async () => {
    const { container } = render(<CommentCount count={12} />);
    const badge = screen.getByRole('img', { name: 'Kommentare: 12' });
    expect(badge).toHaveTextContent('12');
    expect(badge).toHaveAttribute('title', 'Kommentare: 12');
    await expectNoSeriousA11y(container);
  });

  it('bei 0 nichts', () => {
    const { container } = render(<CommentCount count={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('Vorschau beim Fokussieren: lädt beim ersten Öffnen, Kommentare chronologisch, ältere als Zahl', async () => {
    let opened = 0;
    const { container } = render(
      <CommentCount
        count={7}
        onPreviewOpen={() => (opened += 1)}
        preview={{
          state: 'ready',
          older: 2,
          items: [
            { id: 'a', author: 'Andreas', when: '07.10.2026, 21:10', text: 'RGB bitte mit 180 s' },
            { id: 'b', author: 'SvenR', when: '08.10.2026, 11:02', text: 'Passt, ist eingeplant.' },
          ],
        }}
      />,
    );
    const badge = screen.getByRole('img', { name: 'Kommentare: 7' });
    fireEvent.focus(badge);
    const tip = await screen.findByRole('tooltip');
    expect(opened).toBe(1);
    expect(tip).toHaveTextContent('Letzte Kommentare (7)');
    expect(tip).toHaveTextContent('… und 2 ältere');
    const text = tip.textContent ?? '';
    expect(text.indexOf('RGB bitte')).toBeLessThan(text.indexOf('Passt, ist eingeplant.'));
    await expectNoSeriousA11y(container);
  });

  it('Vorschau lädt noch bzw. Fehler', async () => {
    const { rerender } = render(
      <CommentCount
        count={2}
        onPreviewOpen={() => undefined}
        preview={{ state: 'loading', items: [], older: 0 }}
      />,
    );
    fireEvent.focus(screen.getByRole('img', { name: 'Kommentare: 2' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Wird geladen');
    rerender(
      <CommentCount
        count={2}
        onPreviewOpen={() => undefined}
        preview={{ state: 'error', items: [], older: 0 }}
      />,
    );
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Kommentare konnten nicht geladen werden.',
    );
  });
});
