// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import { ProgressBar } from './index';

describe('ProgressBar (§2.2)', () => {
  it('Label „22/60 × 300 s · 37 %“ und progressbar mit aria-Werten', async () => {
    render(<ProgressBar acquired={22} planned={60} exposureS={300} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '22');
    expect(bar).toHaveAttribute('aria-valuemax', '60');
    expect(bar).toHaveAttribute('aria-valuetext', '22/60 × 300 s · 37 %');
    expect(screen.getByText('22/60 × 300 s · 37 %')).toBeInTheDocument();
    await expectNoSeriousA11y();
  });

  it('planned = 0 → empty „kein Plan“', () => {
    render(<ProgressBar acquired={0} planned={0} />);
    expect(screen.getByText('kein Plan')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('Grenzfall acquired > planned: Balken bei 100 %, Label 62/60, Überhang-Segment', () => {
    render(<ProgressBar acquired={62} planned={60} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '60');
    expect(screen.getByText('62/60 · 100 %')).toBeInTheDocument();
    expect(screen.getByTestId('progress-overflow')).toBeInTheDocument();
  });
});
