// @vitest-environment jsdom
/**
 * `SeasonChart` (components.md §2.4, AP-24): Zustände leer/laden/Fehler, Balken je Nacht bzw. Woche,
 * Marken heute/Saisonende/Saisonbeginn, Grenzfälle zirkumpolar („ganzjährig“, keine Marke) und außerhalb
 * der Saison, Tastaturpfad mit aria-live, Textalternative, axe.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import { SeasonChart, type SeasonChartBar } from './index';

let texts: string[] = [];
beforeEach(() => {
  texts = [];
  const ctx = new Proxy(
    {},
    {
      get(_, key) {
        if (key === 'fillText') return (s: string) => texts.push(s);
        if (key === 'measureText') return (s: string) => ({ width: s.length * 5 });
        return () => undefined;
      },
      set: () => true,
    },
  );
  HTMLCanvasElement.prototype.getContext = (() => ctx) as never;
});

const day = (i: number) => new Date(Date.UTC(2026, 8, 26 + i)).toISOString().slice(0, 10);
const weeks = (n: number, over: (i: number) => Partial<SeasonChartBar> = () => ({})) =>
  Array.from({ length: n }, (_, i): SeasonChartBar => ({
    month: day(i * 7),
    nights: 7,
    usableHours: 4 + (i % 3),
    moonPct: 30,
    usable: true,
    peakAltDeg: 70,
    ...over(i),
  }));

describe('SeasonChart', () => {
  it('bereit: Legende, Saisonende, Textalternative je Woche; axe', async () => {
    render(
      <SeasonChart
        months={weeks(13)}
        range="3m"
        seasonEnd="2026-11-20"
        minTimeH={2}
        today="2026-09-26"
        status="in_season"
      />,
    );
    expect(screen.getByText('mondfrei')).toBeInTheDocument();
    expect(screen.getByText('mit Mond', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Mindestzeit 2,0 h')).toBeInTheDocument();
    expect(screen.getByText('Saisonende 20.11.')).toBeInTheDocument();
    expect(texts).toContain('heute');
    expect(texts).toContain('Ende 20.11.');
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(14);
    expect(rows[1]).toHaveTextContent('Woche ab 26.09.4,0 h30 %70°Mindestzeit erreicht');
    await expectNoSeriousA11y();
  });

  it('1 Monat: Balken je Nacht', () => {
    const nights = Array.from({ length: 30 }, (_, i) => ({
      month: day(i),
      nights: 1,
      usableHours: 5,
      moonPct: 0,
      usable: true,
    }));
    render(<SeasonChart months={nights} range="1m" status="in_season" seasonEnd="2027-03-01" />);
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('26.09.5,0 h0 %–Mindestzeit erreicht');
    expect(screen.getByRole('columnheader', { name: 'Nacht' })).toBeInTheDocument();
  });

  it('zirkumpolar: keine Endmarke, Fußnote „ganzjährig“', () => {
    render(<SeasonChart months={weeks(52)} range="1y" status="in_season" seasonEnd={null} />);
    expect(screen.getByText('Ganzjährig nutzbar (kein Saisonende).')).toBeInTheDocument();
    expect(texts.some((x) => x.startsWith('Ende'))).toBe(false);
  });

  it('außerhalb der Saison: Beginn als zweite Marke, Balken davor nicht ausreichend', () => {
    render(
      <SeasonChart
        months={weeks(26, (i) =>
          i < 8 ? { usable: false, usableHours: 0, peakAltDeg: null } : {},
        )}
        range="6m"
        status="out_of_season"
        seasonStart="2026-11-21"
        seasonEnd="2027-03-10"
      />,
    );
    expect(texts).toContain('Beginn 21.11.');
    expect(texts).toContain('Ende 10.03.');
    expect(screen.getByText('Saisonbeginn 21.11. · Saisonende 10.03.')).toBeInTheDocument();
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Mindestzeit nicht erreicht');
  });

  it('nie lang genug nutzbar', () => {
    render(
      <SeasonChart
        months={weeks(4, () => ({ usable: false, usableHours: 0 }))}
        range="1m"
        status="never"
      />,
    );
    expect(screen.getByText('Im Zeitraum nie lang genug nutzbar.')).toBeInTheDocument();
  });

  it('Tastatur: → tastet die Balken ab (aria-live)', () => {
    render(<SeasonChart months={weeks(13)} range="3m" status="in_season" seasonEnd={null} />);
    const chart = screen.getByRole('img', { name: /Saisondiagramm/ });
    chart.focus();
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(
      screen.getByText('Woche ab 26.09.: 4,0 h je Nacht, 30 % mit Mond, Mindestzeit erreicht'),
    ).toBeInTheDocument();
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(screen.getByText(/^Woche ab 03\.10\.: 5,0 h/)).toBeInTheDocument();
  });

  it('Zustände: laden, Fehler mit Erneut versuchen, leer', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<SeasonChart months={[]} range="3m" state="loading" />);
    expect(screen.getByRole('status', { name: 'Wird geladen …' })).toBeInTheDocument();
    rerender(<SeasonChart months={[]} range="3m" state="error" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(onRetry).toHaveBeenCalled();
    rerender(<SeasonChart months={[]} range="3m" />);
    expect(screen.getByText('Keine Nächte für das Saisondiagramm.')).toBeInTheDocument();
  });
});
