// @vitest-environment jsdom
/**
 * Nachtdiagramm (components.md §2.3, AP-10): Zustände, Tastaturpfad mit aria-live, Textalternative,
 * Grenzfälle (Zeitumstellung 25 h, nur eine Zone stellt um, Kürzel-Rückfall CDT, mehr als 12 Reihen),
 * axe; dazu der Engine-Adapter für NGC 281.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import { nightChartFromEngine } from '../../lib/night-chart-data';
import { SKY_STOPS } from '@nina-pm/ui-tokens';
import {
  bestTime,
  cropWindow,
  filterBarLabel,
  hourBands,
  hourTicks,
  luminance,
  maskIntervals,
  moonAlpha,
  skyColor,
  sunAltFromTwilight,
  twilightCrossings,
} from './model';
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

  it('Transit (S-22): Lichtkurve als Legendeneintrag, ohne Transit keiner; axe', async () => {
    const { unmount } = render(
      <NightChart
        window={{ startUtc: START, endUtc: END }}
        series={[series('hat', 'HAT-P-17b')]}
        timeZone="America/Chicago"
        transit={{
          windowStartUtc: START + 3 * H,
          windowEndUtc: START + 9 * H,
          ingressUtc: START + 4 * H,
          midUtc: START + 6 * H,
          egressUtc: START + 8 * H,
          flux: [
            { atUtc: START + 4 * H, rel: 0 },
            { atUtc: START + 4.3 * H, rel: -0.0186 },
            { atUtc: START + 7.7 * H, rel: -0.0186 },
            { atUtc: START + 8 * H, rel: 0 },
          ],
          depthLabel: '−20,4 mmag',
          depthPctLabel: '−1,86 %',
        }}
      />,
    );
    expect(screen.getByText('Relative Helligkeit')).toBeInTheDocument();
    await expectNoSeriousA11y();
    unmount();
    render(
      <NightChart
        window={{ startUtc: START, endUtc: END }}
        series={[series('hat', 'HAT-P-17b')]}
        timeZone="America/Chicago"
      />,
    );
    expect(screen.queryByText('Relative Helligkeit')).toBeNull();
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
    const live = document.getElementById(chart.getAttribute('aria-describedby') ?? '');
    expect(live).toHaveTextContent(/^19:00 CDT – NGC 281/);
    fireEvent.keyDown(chart, { key: 'Enter' });
    expect(selected).toEqual([START]);
    expect(screen.getByText('Mond (42 % beleuchtet)')).toBeInTheDocument();
  });

  it('zeichnet nach dem Wechsel aus dem Ladezustand (Breite erst mit Zeichenfläche messbar)', () => {
    const calls: string[] = [];
    const ctx = new Proxy(
      {},
      {
        get: (_t, key) => () => {
          calls.push(String(key));
        },
        set: () => true,
      },
    );
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
    const { rerender } = render(
      <NightChart window={null} state="loading" timeZone="America/Chicago" />,
    );
    rerender(
      <NightChart
        window={{ startUtc: START, endUtc: END }}
        series={[series('a', 'NGC 281')]}
        timeZone="America/Chicago"
      />,
    );
    expect(calls).toContain('fillRect');
    spy.mockRestore();
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

describe('Legende mit Ebenen und Stundenstreifen (Entscheidung 24.09.2026)', () => {
  const twilight = {
    civil: { startUtc: START + H, endUtc: END - H },
    nautical: { startUtc: START + 1.5 * H, endUtc: END - 1.5 * H },
    astronomical: { startUtc: START + 2 * H, endUtc: END - 2 * H },
  };

  it('Checkboxen je Ebene, Stundensummen je Streifen, Tabelle mit Zeiträumen', async () => {
    render(
      <NightChart
        window={{ startUtc: START, endUtc: END }}
        twilight={twilight}
        series={[series('ngc281', 'NGC 281')]}
        moon={{
          points: [
            { atUtc: START, altDeg: 40 },
            { atUtc: START + 4 * H, altDeg: 0 },
            { atUtc: END, altDeg: -40 },
          ],
          illuminationPct: 45,
        }}
        recommended={[{ fromUtc: START + 3 * H, toUtc: START + 8 * H }]}
        minAltDeg={30}
        timeZone="America/Chicago"
      />,
    );
    const legend = screen.getByRole('group', { name: 'Legende' });
    const boxes = within(legend).getAllByRole('checkbox');
    // NGC 281, Mond, Mindesthöhe, fünf Streifen
    expect(boxes).toHaveLength(8);
    expect(boxes.every((b) => (b as HTMLInputElement).checked)).toBe(true);
    const dark = within(legend).getByRole('checkbox', { name: /Astronomisch dunkel/ });
    expect(dark.closest('label')).toHaveTextContent('Astronomisch dunkel9,0 h');
    expect(
      within(legend)
        .getByRole('checkbox', { name: /Empfohlene Belichtungszeit/ })
        .closest('label'),
    ).toHaveTextContent('5,0 h');
    fireEvent.click(dark);
    expect(dark).not.toBeChecked();
    fireEvent.click(within(legend).getByRole('checkbox', { name: /^Mond \(45/ }));
    expect(within(legend).getByRole('checkbox', { name: /Mond \(45/ })).not.toBeChecked();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Empfohlene Belichtungszeit').nextSibling).toHaveTextContent(
      '5,0 h · 22:00 CDT – 03:00 CDT',
    );
    await expectNoSeriousA11y();
  });

  it('legend="top": Legende als Zeile vor dem Diagramm, weiter als benannte Gruppe bedienbar; axe', async () => {
    render(
      <NightChart
        window={{ startUtc: START, endUtc: END }}
        twilight={twilight}
        series={[series('ngc281', 'NGC 281')]}
        minAltDeg={30}
        timeZone="America/Chicago"
        legend="top"
      />,
    );
    const legend = screen.getByRole('group', { name: 'Legende' });
    const chart = screen.getByRole('img', { name: /Standortzeit/ });
    // Legende steht im Dokument vor dem Diagramm (Lesereihenfolge = Anzeige).
    expect(legend.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const target = within(legend).getByRole('checkbox', { name: 'NGC 281' });
    fireEvent.click(target);
    expect(target).not.toBeChecked();
    expect(within(legend).getByRole('checkbox', { name: /Astronomisch dunkel/ })).toBeChecked();
    await expectNoSeriousA11y();
  });

  it('legend="side": Legende steht hinter dem Diagramm (rechts); Standard ist oben', () => {
    const { unmount } = render(
      <NightChart
        window={{ startUtc: START, endUtc: END }}
        series={[series('ngc281', 'NGC 281')]}
        timeZone="America/Chicago"
        legend="side"
      />,
    );
    const legend = screen.getByRole('group', { name: 'Legende' });
    const chart = screen.getByRole('img', { name: /Standortzeit/ });
    expect(legend.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    unmount();
    render(
      <NightChart
        window={{ startUtc: START, endUtc: END }}
        series={[series('ngc281', 'NGC 281')]}
        timeZone="America/Chicago"
      />,
    );
    expect(
      screen
        .getByRole('group', { name: 'Legende' })
        .compareDocumentPosition(screen.getByRole('img', { name: /Standortzeit/ })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe('Himmel und Stundenstreifen (model)', () => {
  it('skyColor: Stützstellen exakt, dazwischen linear, außerhalb die Randfarbe', () => {
    expect(skyColor(10, SKY_STOPS)).toBe('rgb(166, 140, 69)');
    expect(skyColor(-18, SKY_STOPS)).toBe('rgb(14, 24, 36)');
    expect(skyColor(-40, SKY_STOPS)).toBe('rgb(14, 24, 36)');
    // Mitte zwischen −12° (31, 51, 80) und −18° (14, 24, 36) – Werte des Beobachtungsplaners (AP-26e)
    expect(skyColor(-15, SKY_STOPS)).toBe('rgb(23, 38, 58)');
  });

  it('sunAltFromTwilight und twilightCrossings: Stufen und B/N/A-Wechsel im Fenster', () => {
    const win = { fromUtc: START, toUtc: END };
    const tw = {
      civil: { startUtc: START + H, endUtc: END - H },
      nautical: { startUtc: START + 2 * H, endUtc: END - 2 * H },
      astronomical: { startUtc: null, endUtc: null },
    };
    expect(sunAltFromTwilight(tw, START + 0.5 * H, win)).toBe(0);
    expect(sunAltFromTwilight(tw, START + 1.5 * H, win)).toBe(-6);
    expect(sunAltFromTwilight(tw, START + 6 * H, win)).toBe(-12);
    expect(twilightCrossings(tw, win).map((c) => c.kind)).toEqual([
      'civil',
      'nautical',
      'nautical',
      'civil',
    ]);
    // Polarnacht: ganz dunkel, keine Wechsel
    const polar = { ...tw, astronomical: { startUtc: null, endUtc: null, allNight: true } };
    expect(sunAltFromTwilight(polar, START, win)).toBe(-18);
  });

  it('hourBands: dunkel, über Mindesthöhe, davon mit/ohne Mond; empfohlen aus der Engine', () => {
    const win = { fromUtc: START, toUtc: START + 4 * H };
    const bands = hourBands({
      window: win,
      sun: [
        { atUtc: START, altDeg: -10 },
        { atUtc: START + H, altDeg: -20 },
        { atUtc: START + 4 * H, altDeg: -20 },
      ],
      target: [
        { atUtc: START, altDeg: 50 },
        { atUtc: START + 3 * H, altDeg: 50 },
        { atUtc: START + 3 * H + 1, altDeg: 10 },
        { atUtc: START + 4 * H, altDeg: 10 },
      ],
      moon: [
        { atUtc: START, altDeg: 10 },
        { atUtc: START + 2 * H, altDeg: 10 },
        { atUtc: START + 2 * H + 1, altDeg: -5 },
        { atUtc: START + 4 * H, altDeg: -5 },
      ],
      minAltDeg: 30,
      recommended: [{ fromUtc: START + H, toUtc: START + 2 * H }],
    });
    const total = Object.fromEntries(bands.map((b) => [b.key, b.totalSec / 60]));
    // Sonne ≤ −18° ab 00:48Z (linear −10 → −20 in 1 h), auf 5-min-Mitten gerastert: ab 00:50Z
    expect(total).toEqual({ recommended: 60, moonless: 60, moonlit: 70, above: 130, dark: 190 });
    expect(bands.find((b) => b.key === 'moonlit')?.intervals).toEqual([
      { fromUtc: START + 50 * 60, toUtc: START + 2 * H },
    ]);
  });

  it('maskIntervals fasst benachbarte Slots zusammen', () => {
    expect(maskIntervals([0, 300, 600, 900, 1200], [true, true, false, true])).toEqual([
      { fromUtc: 0, toUtc: 600 },
      { fromUtc: 900, toUtc: 1200 },
    ]);
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
    // Himmel aus der Sonnenkurve, empfohlene Zeit = Dämmerung + Mindesthöhe (ohne Mondprofil)
    expect(props.sun).toHaveLength(157);
    expect(props.recommended?.length).toBeGreaterThan(0);
  });
});

describe('Stil des Beobachtungsplaners (AP-26e)', () => {
  /** Mittag bis Mittag in Chicago, 17./18.09.2026 (12:00 CDT = 17:00Z). */
  const NOON = Date.UTC(2026, 8, 17, 17) / 1000;
  const at = (d: number, h: number, m = 0) => Date.UTC(2026, 8, d, h, m) / 1000;
  const sun = [
    { atUtc: NOON, altDeg: 60 },
    { atUtc: at(18, 0, 30), altDeg: 0 },
    { atUtc: at(18, 1, 30), altDeg: -12 },
    { atUtc: at(18, 6), altDeg: -50 },
    { atUtc: at(18, 11), altDeg: -12 },
    { atUtc: at(18, 12), altDeg: 0 },
    { atUtc: NOON + 24 * H, altDeg: 60 },
  ];

  it('cropWindow: 1 h vor Sonnenuntergang bis 1 h nach Sonnenaufgang auf volle Standortstunden', () => {
    const win = { fromUtc: NOON, toUtc: NOON + 24 * H };
    // Untergang (−0,833°) 19:34 CDT → 18:00 CDT; Aufgang 06:55 CDT → 08:00 CDT
    expect(cropWindow(win, sun, 'America/Chicago')).toEqual({
      fromUtc: at(17, 23),
      toUtc: at(18, 13),
    });
    // ohne Sonnenkurve bzw. ohne Untergang (Polartag) das ganze Fenster
    expect(cropWindow(win, undefined, 'America/Chicago')).toEqual(win);
    expect(
      cropWindow(
        win,
        sun.map((p) => ({ ...p, altDeg: 10 })),
        'America/Chicago',
      ),
    ).toEqual(win);
  });

  it('bestTime: höchster Stand in astronomischer Dunkelheit, sonst im Fenster', () => {
    const s = series('a', 'A');
    const win = { fromUtc: START, toUtc: END };
    const span = (from: number, to: number) => ({ startUtc: from, endUtc: to });
    const tw = (from: number, to: number) => ({
      civil: span(START, END),
      nautical: span(START, END),
      astronomical: span(from, to),
    });
    expect(bestTime(s.points, tw(START + 2 * H, END - 2 * H), win)?.atUtc).toBe(START + 6 * H);
    // Kulmination außerhalb der Dunkelheit: der höchste Punkt in ihr
    expect(bestTime(s.points, tw(END - 4 * H, END - 2 * H), win)?.atUtc).toBe(END - 4 * H);
    expect(bestTime(s.points, undefined, win)?.altDeg).toBe(65);
  });

  it('Hilfen: Filterbeschriftung „R ×10“, Helligkeit, Deckkraft des Mondes', () => {
    const bar = { fromUtc: 0, toUtc: 1, color: '#c0392b', label: 'R' };
    expect(filterBarLabel({ ...bar, count: 10 })).toBe('R ×10');
    expect(filterBarLabel(bar)).toBe('R');
    expect(luminance('#ffffff')).toBeCloseTo(1);
    expect(luminance('#000')).toBe(0);
    expect(luminance('rgb(255, 0, 0)')).toBeCloseTo(0.2126);
    expect(luminance('var(--npm-x)')).toBeNull();
    expect(moonAlpha(100)).toBeCloseTo(0.58);
    expect(moonAlpha(0)).toBeCloseTo(0.18);
  });

  it('zweite Zeitzone: eigene Zeile nur, wenn sie abweicht; null schaltet sie ab', () => {
    const props = {
      window: { startUtc: START, endUtc: END },
      series: [series('a', 'NGC 281')],
      timeZone: 'America/Chicago',
      bands: false,
      height: 200,
    };
    const height = (el: HTMLElement) => el.style.height;
    const { rerender } = render(<NightChart {...props} secondaryTimeZone="Europe/Berlin" />);
    expect(height(screen.getByRole('img'))).toBe('214px');
    rerender(<NightChart {...props} secondaryTimeZone="America/Chicago" />);
    expect(height(screen.getByRole('img'))).toBe('200px');
    rerender(<NightChart {...props} secondaryTimeZone={null} />);
    expect(height(screen.getByRole('img'))).toBe('200px');
  });

  it('Kennwerte neben dem Diagramm und Uhrzeit per Klick (gesteuert)', async () => {
    const moved: number[] = [];
    render(
      <NightChart
        window={{ startUtc: START, endUtc: END }}
        series={[series('a', 'NGC 281')]}
        moon={{ points: [{ atUtc: START, altDeg: 10 }], illuminationPct: 100 }}
        minAltDeg={30}
        timeZone="America/Chicago"
        secondaryTimeZone={null}
        cursorUtc={START + 6 * H}
        onCursorChange={(v) => moved.push(v)}
        facts
      />,
    );
    const facts = screen.getByText('Höchster Stand').closest('dl') as HTMLElement;
    expect(within(facts).getByText('Höhe um 01:00').nextSibling).toHaveTextContent('65°');
    expect(within(facts).getByText('Höchster Stand').nextSibling).toHaveTextContent('65° um 01:00');
    expect(within(facts).getByText('100 % beleuchtet')).toBeInTheDocument();
    // Zeichenfläche 320 px, Diagramm 34…280 px: Mitte = halbe Nacht
    const chart = screen.getByRole('img');
    fireEvent.pointerDown(chart, { clientX: 34 + 123, pointerId: 1 });
    expect(moved).toEqual([START + 6.5 * H]);
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(moved[1]).toBe(START + 6 * H + 300);
    await expectNoSeriousA11y();
  });

  it('Plangrafik: Blöcke als Flächen, Filterleiste „R ×10“, keine Stundenstreifen', () => {
    const texts: string[] = [];
    const ctx = new Proxy(
      {},
      {
        get: (_t, key) =>
          key === 'measureText'
            ? (text: string) => ({ width: text.length * 6 })
            : key === 'fillText'
              ? (text: string) => texts.push(text)
              : () => undefined,
        set: () => true,
      },
    );
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
    render(
      <NightChart
        window={{ startUtc: START, endUtc: END }}
        series={[series('a', 'M 31'), series('b', 'M 33', START + 8 * H)]}
        blocks={[
          {
            id: 'b1',
            fromUtc: START + 2 * H,
            toUtc: START + 5 * H,
            label: 'M 31',
            kind: 'regular',
          },
          {
            id: 'b2',
            fromUtc: START + 5 * H,
            toUtc: START + 9 * H,
            label: 'M 33',
            kind: 'regular',
          },
        ]}
        filterBars={[
          { fromUtc: START + 2 * H, toUtc: START + 5 * H, color: '#c0392b', label: 'R', count: 10 },
        ]}
        minAltDeg={30}
        timeZone="America/Chicago"
        variant="plan"
        cursorUtc={START + 3 * H}
        onCursorChange={() => undefined}
      />,
    );
    expect(texts).toContain('R ×10');
    expect(texts).toContain('M 33');
    expect(texts.some((x) => x.startsWith('Uhrzeit 22:00'))).toBe(true);
    const legend = screen.getByRole('group', { name: 'Legende' });
    expect(within(legend).queryByRole('checkbox', { name: /Astronomisch dunkel/ })).toBeNull();
    expect(within(legend).getByRole('checkbox', { name: 'M 33' })).toBeChecked();
    spy.mockRestore();
  });
});
