// @vitest-environment jsdom
/**
 * Nachtdiagramm (components.md §2.3, AP-10): Zustände, Tastaturpfad mit aria-live, Textalternative,
 * Grenzfälle (Zeitumstellung 25 h, nur eine Zone stellt um, Kürzel-Rückfall CDT, mehr als 12 Reihen),
 * axe; dazu der Engine-Adapter für NGC 281.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import { nightChartFromEngine } from '../../lib/night-chart-data';
import { hourTicks } from './model';
import { NightChart, type AltitudeSeries } from './index';

beforeAll(() => {
  // jsdom zeichnet nicht; der Baustein muss ohne 2D-Kontext trotzdem vollständig bedienbar sein.
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

const H = 3600;
/** Nacht 17./18.09.2026 Starfront: 00:00Z – 13:00Z (19:00–08:00 CDT). */
const START = Date.UTC(2026, 8, 18, 0) / 1000;
const END = START + 13 * H;

const series = (id: string, label: string, peakAt = START + 6 * H): AltitudeSeries => ({
  id,
  label,
  color: '#1f6aa5',
  points: Array.from({ length: 14 }, (_, i) => ({
    atUtc: START + i * H,
    altDeg: 65 - Math.abs(START + i * H - peakAt) / 600,
  })),
});

describe('NightChart', () => {
  it('bereit: Achse in Standortzeit mit Kürzel, Legende, Textalternative; axe', async () => {
    render(
      <NightChart
        window={{ startUtc: START, endUtc: END }}
        series={[series('ngc281', 'NGC 281')]}
        minAltDeg={30}
        markers={[{ atUtc: START + 6 * H, kind: 'transit', label: 'Meridian' }]}
        timeZone="America/Chicago"
      />,
    );
    expect(screen.getByRole('img', { name: /Standortzeit \(CDT\)/ })).toBeInTheDocument();
    expect(screen.getAllByText('NGC 281')).toHaveLength(2); // Legende und Textalternative
    expect(screen.getByText('Mindesthöhe 30°')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('19:00 CDT – 08:00 CDT')).toBeInTheDocument();
    expect(within(table).getByText(/höchster Stand 01:00 CDT \(65\.0°\)/)).toBeInTheDocument();
    expect(within(table).getByText('Meridian')).toBeInTheDocument();
    await expectNoSeriousA11y();
  });

  it('Tastatur: → tastet 5-min-Schritte ab, Wert per aria-live; Enter meldet den Zeitpunkt', () => {
    const selected: number[] = [];
    render(
      <NightChart
        window={{ startUtc: START, endUtc: END }}
        series={[series('a', 'NGC 281')]}
        moon={{
          points: [
            { atUtc: START, altDeg: 10 },
            { atUtc: END, altDeg: 10 },
          ],
          illuminationPct: 42,
        }}
        timeZone="America/Chicago"
        onSelect={(at) => selected.push(at)}
      />,
    );
    const chart = screen.getByRole('img');
    chart.focus();
    expect(chart).toHaveFocus();
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(screen.getByText(/^19:05 CDT – NGC 281 \d+°, Mond 10°$/)).toBeInTheDocument();
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    // am Fensteranfang bleibt der Cursor stehen
    expect(chart.nextElementSibling).toHaveTextContent(/^19:00 CDT – NGC 281/);
    fireEvent.keyDown(chart, { key: 'Enter' });
    expect(selected).toEqual([START]);
    expect(screen.getByText('Mond (42 % beleuchtet)')).toBeInTheDocument();
  });

  it('Zustände: laden, Fehler (ohne Fenster) mit Erneut versuchen, leer', () => {
    const { rerender } = render(
      <NightChart window={null} state="loading" timeZone="America/Chicago" />,
    );
    expect(screen.getByRole('status', { name: 'Wird geladen …' })).toBeInTheDocument();
    let retried = 0;
    rerender(
      <NightChart window={null} timeZone="America/Chicago" onRetry={() => (retried += 1)} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(retried).toBe(1);
    rerender(
      <NightChart
        window={{ startUtc: START, endUtc: END }}
        series={[]}
        timeZone="America/Chicago"
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Keine Nacht mit Dunkelheit');
  });

  it('mehr als 12 Reihen: nur 12 gezeichnet, Rest als „+n weitere“', () => {
    render(
      <NightChart
        window={{ startUtc: START, endUtc: END }}
        series={Array.from({ length: 14 }, (_, i) => series(`s${String(i)}`, `Ziel ${String(i)}`))}
        timeZone="America/Chicago"
      />,
    );
    expect(screen.getByText('+2 weitere')).toBeInTheDocument();
    expect(screen.queryByText('Ziel 12')).not.toBeInTheDocument();
  });

  it('Polarnacht-Band und fehlende Durchgänge in der Textalternative („keine“)', () => {
    render(
      <NightChart
        window={{ startUtc: START, endUtc: END }}
        series={[series('a', 'Ziel')]}
        twilight={{
          civil: { startUtc: null, endUtc: null },
          nautical: { startUtc: START + H, endUtc: END - H },
          astronomical: { startUtc: null, endUtc: null, allNight: true },
        }}
        timeZone="America/Chicago"
      />,
    );
    expect(screen.getByText('Bürgerliche Dämmerung').nextSibling).toHaveTextContent(
      'keine – keine',
    );
    expect(screen.getByText('Nautische Dämmerung').nextSibling).toHaveTextContent(
      '20:00 CDT – 07:00 CDT',
    );
  });
});

describe('Zeitachse (NT-03, components.md §2.3 Grenzfälle)', () => {
  it('Chicago 31.10./01.11.2026: 25 Stunden, die Beschriftung springt (01 zweimal)', () => {
    const start = Date.UTC(2026, 9, 31, 17) / 1000;
    const end = Date.UTC(2026, 10, 1, 18) / 1000;
    const ticks = hourTicks(start, end, 'America/Chicago').map((t) => t.label);
    expect(ticks).toHaveLength(26);
    expect(ticks.filter((l) => l === '01')).toHaveLength(2);
  });

  it('nur Berlin stellt um (24./25.10.2026): 19:30 CDT = 02:30 MESZ, 20:30 CDT = 02:30 MEZ', () => {
    const at1930 = Date.UTC(2026, 9, 25, 0, 30) / 1000;
    const at2030 = Date.UTC(2026, 9, 25, 1, 30) / 1000;
    const chicago = hourTicks(at1930 - 1800, at2030 + 1800, 'America/Chicago').map((t) => t.label);
    const berlin = hourTicks(at1930 - 1800, at2030 + 1800, 'Europe/Berlin').map((t) => t.label);
    expect(chicago).toEqual(['19', '20', '21']);
    // Berlin: 02:00 MESZ, 02:00 MEZ (Umstellung um 01:00 UTC), 03:00 MEZ
    expect(berlin).toEqual(['02', '02', '03']);
  });
});

describe('Engine-Adapter (AP-10, menschliche Freigabe „NGC 281 plausibel“)', () => {
  it('NGC 281 an Starfront 2026-09-17: Fenster 00:00Z–13:00Z, Kulmination ~ 07:43Z, Meridianmarke', () => {
    const { props, ctx } = nightChartFromEngine({
      site: { latDeg: 31.5471, lonDeg: -99.3823 },
      night: '2026-09-17',
      timeZoneTransitions: [
        { atUtc: Date.UTC(2026, 2, 8, 8) / 1000, utcOffsetMinutes: -300 },
        { atUtc: Date.UTC(2026, 10, 1, 7) / 1000, utcOffsetMinutes: -360 },
      ],
      timeZone: 'America/Chicago',
      targets: [
        {
          id: 'ngc281',
          label: 'NGC 281',
          color: '#1f6aa5',
          target: { raJ2000Deg: 13.2458, decJ2000Deg: 56.6194 },
        },
      ],
      minAltDeg: 30,
      twilight: 'astronomical',
      transitLabel: 'Meridian',
    });
    expect(props.window).toEqual({ startUtc: START, endUtc: END });
    expect(ctx.slotCount).toBe(156);
    const [s] = props.series ?? [];
    expect(s?.points).toHaveLength(157);
    const top = s?.points.reduce((a, b) => (b.altDeg > a.altDeg ? b : a));
    // flip-rotation.md §1.1: NGC 281 kulminiert 07:42:55Z; die Grenze des Maximums liegt ±5 min daneben.
    expect(
      Math.abs((top?.atUtc ?? 0) - Date.UTC(2026, 8, 18, 7, 42, 55) / 1000),
    ).toBeLessThanOrEqual(300);
    expect(
      Math.abs((props.markers?.[0]?.atUtc ?? 0) - Date.UTC(2026, 8, 18, 7, 42, 55) / 1000),
    ).toBeLessThanOrEqual(30); // Referenztoleranz ±30 s (flip-rotation.md §1.1)
  });
});
