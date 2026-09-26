// @vitest-environment jsdom
/** `ThumbPreview` (components.md §2.16, AP-26h): großes Bild erst beim Überfahren, als Portal, nicht vorlesbar. */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import { ThumbPreview } from './index';

describe('ThumbPreview', () => {
  it('zeigt das große Bild erst beim Überfahren und entfernt es beim Verlassen; axe', async () => {
    const preview = vi.fn(() => <img alt="" src="/gross.jpg" />);
    const { container } = render(
      <ThumbPreview preview={preview}>
        <img alt="M 31" src="/klein.jpg" />
      </ThumbPreview>,
    );
    expect(preview).not.toHaveBeenCalled();
    const wrap = container.firstElementChild as HTMLElement;
    fireEvent.mouseEnter(wrap);
    const big = document.body.querySelector('img[src="/gross.jpg"]');
    expect(big).not.toBeNull();
    // Im Portal über der Seite, nicht im Tabellenfluss; für Screenreader verborgen.
    expect(wrap.contains(big)).toBe(false);
    expect(big?.parentElement).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('img', { name: 'M 31' })).toBeInTheDocument();
    await expectNoSeriousA11y();
    fireEvent.mouseLeave(wrap);
    expect(document.body.querySelector('img[src="/gross.jpg"]')).toBeNull();
  });
});
