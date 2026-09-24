// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import { chipTextColor, contrastRatio, FilterChip } from './index';

describe('FilterChip (§2.1)', () => {
  it('ohne onToggle ein span, mit onToggle ein button aria-pressed; Tastatur', async () => {
    const onToggle = vi.fn();
    const { rerender } = render(<FilterChip shortName="Ha" color="#d32f2f" />);
    expect(screen.getByText('Ha').tagName).toBe('SPAN');
    rerender(<FilterChip shortName="Ha" color="#d32f2f" selected onToggle={onToggle} />);
    const button = screen.getByRole('button', { name: 'Ha' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    button.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(onToggle).toHaveBeenCalledTimes(2);
    await expectNoSeriousA11y();
  });

  it('Kurznamen über 4 Zeichen gekürzt, voller Name im title', () => {
    render(<FilterChip shortName="HaOIII" color="#888888" />);
    expect(screen.getByText('HaOI')).toHaveAttribute('title', 'HaOIII');
  });

  it.each([
    '#ffeb3b',
    '#d32f2f',
    '#1565c0',
    '#00e5ff',
    '#ff9800',
    '#9e9e9e',
    '#4caf50',
    '#ffffff',
    '#000000',
    '#e040fb',
  ])('Grenzfall Kontrast: Schrift auf %s ≥ 4,5:1', (color) => {
    expect(contrastRatio(chipTextColor(color), color)).toBeGreaterThanOrEqual(4.5);
  });
});
