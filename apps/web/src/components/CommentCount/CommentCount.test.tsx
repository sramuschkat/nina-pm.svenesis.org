// @vitest-environment jsdom
/**
 * `CommentCount` (components.md §2.24): Sprechblase mit Zahl und Beschriftung; bei 0 nichts; axe.
 */
import { render, screen } from '@testing-library/react';
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
});
