// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import { EffortChip } from './index';

const base = {
  tag: 'single_night' as const,
  nights: 1,
  achievablePct: null,
  requiredHours: 4.2,
  bestNight: '2026-10-12',
  bestNightHoursByStage: [
    { moonProfileId: null, filters: ['Ha', 'OIII'], hours: 2.1 },
    { moonProfileId: 'p', filters: ['L'], hours: 2.1 },
  ],
  limitingFactor: null,
  earliestCompletion: '2026-10-12',
  fullyObservable: null,
  coveragePct: null,
  fromNight: '2026-09-24',
  toNight: '2027-01-15',
};

describe('EffortChip (FA-PRJ-23)', () => {
  it('1 Nacht grün mit Tooltip: Stunden, beste Nacht je Stufe, frühestes Ende, Zeitraum', async () => {
    render(<EffortChip effort={base} />);
    const chip = screen.getByText('1 Nacht');
    expect(chip).toHaveAttribute('data-tone', 'success');
    const tip = chip.getAttribute('title') ?? '';
    expect(tip).toContain('Benötigt ca. 4,2 h inkl. Overhead.');
    expect(tip).toContain('Beste Nacht 12./13.10.: Ha/OIII 2,1 h · L 2,1 h.');
    expect(tip).toContain('Frühestens fertig in der Nacht 12./13.10.');
    expect(tip).toContain('Zeitraum 24./25.09. bis 15./16.01.');
    await expectNoSeriousA11y();
  });

  it('ca. n Nächte blau, veraltet mit „wird aktualisiert“', () => {
    render(<EffortChip effort={{ ...base, tag: 'multi_night', nights: 4 }} stale />);
    const chip = screen.getByText('ca. 4 Nächte');
    expect(chip).toHaveAttribute('data-tone', 'info');
    expect(chip).toHaveTextContent('ca. 4 Nächte · wird aktualisiert');
  });

  it('Tabellengröße sm: veraltet nur als Symbol, Text im Tooltip und im zugänglichen Namen', () => {
    render(<EffortChip effort={{ ...base, tag: 'multi_night', nights: 4 }} stale size="sm" />);
    const chip = screen.getByText('ca. 4 Nächte');
    expect(chip).toHaveTextContent(/^ca\. 4 Nächte$/);
    expect(chip.getAttribute('title')).toMatch(/^wird aktualisiert\n/);
    expect(chip).toHaveAccessibleName(/ca\. 4 Nächte · wird aktualisiert/);
    expect(chip.querySelector('svg')).not.toBeNull();
  });

  it('nicht machbar rot mit Anteil und begrenzendem Faktor', () => {
    render(
      <EffortChip
        effort={{
          ...base,
          tag: 'not_feasible',
          nights: 20,
          achievablePct: 66,
          limitingFactor: { lineId: 'l', filterShortName: 'L', reason: 'moon_blocked' },
        }}
      />,
    );
    const chip = screen.getByText('nicht machbar (66 %)');
    expect(chip).toHaveAttribute('data-tone', 'danger');
    expect(chip.getAttribute('title')).toContain('Begrenzt durch L: Mond blockiert.');
  });

  it('Transit violett: vollständig, teilweise mit Anteil, ohne Fenster', () => {
    const { rerender } = render(
      <EffortChip effort={{ ...base, tag: 'transit', fullyObservable: true, coveragePct: 100 }} />,
    );
    expect(screen.getByText('Transit · vollständig')).toHaveAttribute('data-tone', 'violet');
    rerender(
      <EffortChip effort={{ ...base, tag: 'transit', fullyObservable: false, coveragePct: 80 }} />,
    );
    expect(screen.getByText('Transit · teilweise (80 %)')).toBeInTheDocument();
    rerender(<EffortChip effort={{ ...base, tag: 'transit' }} />);
    expect(screen.getByText('Transit').getAttribute('title')).toContain(
      'Noch kein Transitfenster festgelegt.',
    );
  });

  it('Grenzfall Planungsbedarf 0 → „fertig“; noch nicht berechnet → „Schätzung folgt“', () => {
    const { rerender } = render(<EffortChip effort={{ ...base, tag: null }} />);
    expect(screen.getByText('fertig')).toHaveAttribute('data-tone', 'muted');
    rerender(<EffortChip effort={null} />);
    expect(screen.getByText('Aufwand: Schätzung folgt')).toBeInTheDocument();
    rerender(<EffortChip effort={null} stale />);
    expect(screen.getByText('wird aktualisiert')).toBeInTheDocument();
  });

  it('Zustände laden und Fehler mit „Erneut versuchen“', async () => {
    const retry = vi.fn();
    const { rerender } = render(<EffortChip effort={null} state="loading" />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    rerender(<EffortChip effort={null} state="error" onRetry={retry} />);
    await userEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('Tastatur: das Kennzeichen ist fokussierbar und nennt Tooltip-Inhalt im Namen', async () => {
    render(<EffortChip effort={base} />);
    await userEvent.tab();
    const chip = screen.getByText('1 Nacht');
    expect(chip).toHaveFocus();
    expect(chip.getAttribute('aria-label')).toMatch(/^Aufwand: 1 Nacht\. Schätzung unter/);
  });
});
