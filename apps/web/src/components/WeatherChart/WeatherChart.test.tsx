// @vitest-environment jsdom
/**
 * `WeatherChart` (components.md §2.5 und §4 Nr. 7, AP-23): der Baustein bewertet nicht – jede Zelle zeigt
 * den übergebenen Wert; Farbtests gegen die Stützwerte (Rampenenden, Ampelstops 0/0,45/0,65/0,85,
 * Windstufen, Tintenschwelle 0,55, Taugefahr 4/2 °C, Skala 0,92…0,12); Kennzeichen als Text; Grenzfälle
 * Polartag, abbrechende Vorhersage, `bestWindow == null`, `fair`, unbekannter `modelId`; Zustände,
 * Tastatur, kompakte Variante, axe.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import {
  daylightFade,
  dewRisk,
  helperScore,
  inkColour,
  modelName,
  ratingColour,
  SCALE_STEPS,
  scoreColour,
  weatherIconKey,
  windColour,
} from './model';
import { WeatherChart, type WeatherChartHour, type WeatherChartNight } from './index';

/** Zeichenfläche als Aufzeichnung: welche Texte der Baustein schreibt. */
let texts: string[] = [];
beforeEach(() => {
  texts = [];
  const ctx = new Proxy(
    {},
    {
      get(_, key) {
        if (key === 'fillText') return (s: string) => texts.push(s);
        if (key === 'measureText') return (s: string) => ({ width: s.length * 5 });
        if (key === 'createLinearGradient') return () => ({ addColorStop: () => undefined });
        return () => undefined;
      },
      set: () => true,
    },
  );
  HTMLCanvasElement.prototype.getContext = (() => ctx) as never;
});
afterEach(() => vi.restoreAllMocks());

const H = 3600;
// Starfront, Nacht 2026-09-24: Dunkelheit 01:05Z–10:05Z (20:05–05:05 CDT).
const T0 = Date.UTC(2026, 8, 24, 17) / 1000;
const iso = (u: number) => new Date(u * 1000).toISOString().replace('.000Z', 'Z');
const DARK_FROM = Date.UTC(2026, 8, 25, 1, 5) / 1000;
const DARK_TO = Date.UTC(2026, 8, 25, 10, 5) / 1000;

const hour = (i: number, over: Partial<WeatherChartHour> = {}): WeatherChartHour => ({
  tUtc: iso(T0 + i * H),
  cloudTotalPct: 20,
  cloudLowPct: 5,
  cloudMidPct: 10,
  cloudHighPct: 20,
  cloudEcmwfPct: 30,
  cloudCmp3Pct: 40,
  tempC: 18,
  dewPointC: 8,
  humidityPct: 55,
  wind10Kmh: 14,
  gust10Kmh: 25,
  windDir10Deg: 200,
  jetKmh: 90,
  shearKmh: 65.753,
  visibilityM: 24000,
  precipMm: 0,
  precipProbPct: 5,
  weatherCode: 1,
  aod: 0.14,
  dustUgM3: 12,
  pwvMm: 18,
  moonAltDeg: -20,
  modelId: 'hrrr',
  cloudSrc: null,
  nest: true,
  aerosolMissing: false,
  seeingIncomplete: false,
  cloudScore: 0.8,
  seeingScore: 0.506,
  transparencyScore: 0.7,
  overallScore: 0.564,
  ratingIndex: 2,
  ...over,
});

const night = (over: Partial<WeatherChartNight> = {}): WeatherChartNight => ({
  night: '2026-09-24',
  nightMean: 0.687,
  ratingIndex: 3,
  coveredSec: 32400,
  darknessSec: 32400,
  coverage: 1,
  bestWindow: {
    fromUtc: '2026-09-25T01:05:00Z',
    toUtc: '2026-09-25T04:00:00Z',
    sec: 10500,
    moonFreeSec: 7200,
    meanScore: 0.788,
    fair: false,
  },
  aerosolMissing: false,
  seeingIncomplete: false,
  ...over,
});

const hours = Array.from({ length: 24 }, (_, i) => hour(i));
const base = {
  hours,
  nights: [night()],
  nightWindows: [
    { night: '2026-09-24', startUtc: '2026-09-24T23:00:00Z', endUtc: '2026-09-25T12:10:00Z' },
  ],
  darkWindows: [{ night: '2026-09-24', startUtc: iso(DARK_FROM), endUtc: iso(DARK_TO) }],
  sunAltDeg: hours.map((_, i) => (i < 7 || i > 18 ? 20 : -30)),
  nowUtc: '2026-09-24T20:00:00Z',
  days: 1,
  timeZone: 'America/Chicago',
  cmp3: 'nbm' as const,
  region: 'other' as const,
};

describe('WeatherChart', () => {
  it('bereit: Satz zum besten Fenster, Skala in Worten, Textalternative; axe', async () => {
    render(<WeatherChart {...base} />);
    expect(screen.getByText(/2,9 h gut am Stück/)).toHaveTextContent('davon 2,0 h mondfrei');
    expect(screen.getByText(/Nacht-Ø Gut 69 %/)).toBeInTheDocument();
    for (const name of ['Ausgezeichnet', 'Gut', 'Mittel', 'Schlecht', 'Sehr schlecht'])
      expect(within(screen.getByLabelText('Skala:')).getByText(name)).toBeInTheDocument();
    expect(screen.getByText(/geht aber in keine Bewertung ein/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Standortzeit \(CDT\)/ })).toBeInTheDocument();
    await expectNoSeriousA11y();
  });

  it('bewertet nicht: jede Zelle zeigt den übergebenen Wert', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(2400);
    render(<WeatherChart {...base} />);
    const rows = screen.getAllByRole('row');
    const first = rows[1] as HTMLElement;
    expect(first).toHaveTextContent('12:00 CDT');
    expect(first).toHaveTextContent('HRRR');
    expect(first).toHaveTextContent('56 % Mittel'); // overallScore 0,564 → 56 %, ratingIndex 2
    expect(first).toHaveTextContent('80 % Gut'); // cloudScore 0,8
    expect(first).toHaveTextContent('51 % Mittel'); // seeingScore 0,506
    expect(first).toHaveTextContent('70 % Gut'); // transparencyScore 0,7
    expect(first).toHaveTextContent('14/25 km/h');
    // Nachtdetail: die Zellen tragen die Messwerte, nicht eine eigene Rechnung.
    expect(texts).toContain('56'); // Gesamt in %
    expect(texts).toContain('20'); // Bedeckung
    expect(texts).toContain('0,14'); // AOD
    expect(texts).toContain('18'); // Wasserdampf mm
    expect(texts).toContain('24'); // Sicht km
    expect(texts).toContain('14/25');
    expect(texts).toContain('10,0°'); // Taupunktabstand
  });

  it('Kennzeichen als Text (Stunde und Nacht)', () => {
    render(
      <WeatherChart
        {...base}
        hours={hours.map((h, i) =>
          i === 10
            ? { ...h, aerosolMissing: true, transparencyScore: null, aod: null }
            : i === 11
              ? { ...h, seeingIncomplete: true }
              : h,
        )}
        nights={[night({ aerosolMissing: true, seeingIncomplete: true, coverage: 0.846 })]}
      />,
    );
    const table = screen.getAllByRole('table')[0] as HTMLElement;
    expect(within(table).getAllByText('ohne Aerosol – Bewertung optimistisch')).toHaveLength(1);
    expect(within(table).getAllByText('Seeing unvollständig')).toHaveLength(1);
    const nightsTable = screen.getAllByRole('table')[1] as HTMLElement;
    expect(nightsTable).toHaveTextContent(
      'ohne Aerosol – Bewertung optimistisch · Seeing unvollständig · Nacht unvollständig (85 %)',
    );
    expect(
      screen.getByText(/Nacht unvollständig \(85 %\)/, { selector: 'span' }),
    ).toBeInTheDocument();
  });

  it('Mindestbreite 360 px: Zellen nur als Farbe, keine gedrängten Zahlen', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(200);
    render(<WeatherChart {...base} />);
    expect(texts).not.toContain('0,14');
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('56 % Mittel');
  });

  it('unbekannter modelId → roher Wert, kein Absturz', () => {
    render(<WeatherChart {...base} hours={hours.map((h) => ({ ...h, modelId: 'icon_x9' }))} />);
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('icon_x9');
  });

  it('Polartag: keine Dunkelheit, kein Nacht-Ø', () => {
    render(<WeatherChart {...base} darkWindows={[]} nights={[]} />);
    expect(screen.getByText('Do., 24.09.: keine astronomische Dunkelheit.')).toBeInTheDocument();
    expect(texts).toContain('keine Dunkelheit');
  });

  it('bestWindow == null: nur das Nacht-Ø, kein Fenster', () => {
    render(<WeatherChart {...base} nights={[night({ bestWindow: null })]} />);
    expect(
      screen.getByText(/Nacht-Ø Gut 69 % – kein zusammenhängendes Fenster/),
    ).toBeInTheDocument();
  });

  it('fair: „bestenfalls mittel“', () => {
    const w = night().bestWindow;
    render(<WeatherChart {...base} nights={[night({ bestWindow: w && { ...w, fair: true } })]} />);
    expect(screen.getByText(/bestenfalls mittel – 2,9 h am Stück/)).toBeInTheDocument();
  });

  it('Vorhersage endet mitten im Zeitraum: Rest „keine Daten“, nicht 0', () => {
    render(<WeatherChart {...base} days={7} />);
    expect(texts).toContain('keine Daten');
  });

  it('Tastatur: → tastet stundenweise ab (aria-live), Enter wählt die Nacht', () => {
    const onSelectNight = vi.fn();
    render(<WeatherChart {...base} onSelectNight={onSelectNight} />);
    const chart = screen.getByRole('img', { name: /Astro-Wetter/ });
    chart.focus();
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(screen.getByText(/^16:00 CDT · HRRR · Gesamt 56 % Mittel/)).toBeInTheDocument();
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    fireEvent.keyDown(chart, { key: 'Enter' });
    expect(onSelectNight).toHaveBeenCalledWith('2026-09-24');
  });

  it('Zustände: laden, leer mit letztem Abruf, Fehler mit gedämpftem letztem Stand', () => {
    const { rerender } = render(<WeatherChart {...base} state="loading" />);
    expect(screen.getByRole('status', { name: 'Wird geladen …' })).toBeInTheDocument();
    rerender(<WeatherChart {...base} hours={[]} fetchedAtUtc="2026-09-24T18:00:00Z" />);
    expect(screen.getByText('Vorhersage nicht verfügbar.')).toBeInTheDocument();
    expect(screen.getByText('Letzter Abruf 13:00 CDT')).toBeInTheDocument();
    const onRetry = vi.fn();
    rerender(<WeatherChart {...base} state="error" onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('angezeigt wird der letzte Stand');
    fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(onRetry).toHaveBeenCalled();
    expect(screen.getAllByRole('row').length).toBeGreaterThan(1);
  });

  it('kompakt: nur das Farbband, kein Nachtdetail, keine Skala', () => {
    render(<WeatherChart {...base} compact />);
    expect(screen.queryByRole('region', { name: /Nacht im Detail/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Skala:')).not.toBeInTheDocument();
    expect(texts).toContain('Gut 69 %');
  });

  it('nur Nachtdetail (Heute Nacht): keine Wochenübersicht, keine Skala, Detail mit ← →', () => {
    render(<WeatherChart {...base} detailOnly />);
    expect(screen.getByRole('region', { name: /Nacht im Detail/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('Skala:')).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Astro-Wetter|Wetter der Woche|Wetter/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Nächste Nacht' })).toBeInTheDocument();
  });

  it('Nachtdetail: vorige/nächste Nacht', () => {
    const onSelectNight = vi.fn();
    render(
      <WeatherChart
        {...base}
        nightWindows={[
          ...base.nightWindows,
          { night: '2026-09-25', startUtc: '2026-09-25T23:00:00Z', endUtc: '2026-09-26T12:10:00Z' },
        ]}
        onSelectNight={onSelectNight}
      />,
    );
    expect(screen.getByRole('button', { name: 'Vorige Nacht' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Nächste Nacht' }));
    expect(onSelectNight).toHaveBeenCalledWith('2026-09-25');
  });
});

describe('Anzeigeregeln (components.md §2.5)', () => {
  it('Teilbewertungs-Rampe und „keine Daten“', () => {
    expect(scoreColour(0)).toBe('rgb(198, 208, 220)');
    expect(scoreColour(1)).toBe('rgb(30, 88, 190)');
    expect(scoreColour(0.5)).toBe('rgb(114, 148, 205)');
    expect(scoreColour(null)).toBe('#262c34');
  });
  it('Tintenschwelle 0,55', () => {
    expect(inkColour(0.55)).toBe('#1b2633');
    expect(inkColour(0.56)).toBe('#ffffff');
    expect(inkColour(null)).toBe('#1b2633');
  });
  it('Ampel an 0 / 0,45 / 0,65 / 0,85 / 1; 0,25 ohne Stop; Einblendung nach Sonnenhöhe', () => {
    expect(ratingColour(0, 1)).toBe('rgb(216, 67, 59)');
    expect(ratingColour(0.45, 1)).toBe('rgb(224, 123, 43)');
    expect(ratingColour(0.65, 1)).toBe('rgb(217, 181, 43)');
    expect(ratingColour(0.85, 1)).toBe('rgb(63, 174, 76)');
    expect(ratingColour(1, 1)).toBe('rgb(63, 174, 76)');
    // Zwischen 0 und 0,45 durchlaufend: 0,25 liegt bei 5/9 der Strecke.
    expect(ratingColour(0.25, 1)).toBe('rgb(220, 98, 50)');
    expect(ratingColour(0.9, 0)).toBe('rgb(31, 37, 46)');
    expect(ratingColour(null, 1)).toBe('rgb(31, 37, 46)');
    expect(daylightFade(-12)).toBe(0);
    expect(daylightFade(-15)).toBe(0.5);
    expect(daylightFade(-18)).toBe(1);
    expect(daylightFade(-40)).toBe(1);
  });
  it('Windstufen 10 / 20 / 30 / 40 km/h', () => {
    expect(windColour(10)).toBe('#3fae4c');
    expect(windColour(10.1)).toBe('#8fbf2f');
    expect(windColour(20)).toBe('#8fbf2f');
    expect(windColour(30)).toBe('#d9b52b');
    expect(windColour(40)).toBe('#e07b2b');
    expect(windColour(40.1)).toBe('#d8433b');
    expect(windColour(null)).toBe('#262c34');
  });
  it('Taugefahr 4 °C / 2 °C', () => {
    expect(dewRisk(10, 5.9)).toBeNull();
    expect(dewRisk(10, 6)).toBe('warn');
    expect(dewRisk(10, 8)).toBe('danger');
    expect(dewRisk(null, 8)).toBeNull();
  });
  it('Skala in Worten: Stützwerte 0,92 / 0,75 / 0,55 / 0,35 / 0,12', () => {
    expect(SCALE_STEPS).toEqual([
      [0.92, 4],
      [0.75, 3],
      [0.55, 2],
      [0.35, 1],
      [0.12, 0],
    ]);
  });
  it('Hilfsbewertungen nur für die Zellfarbe', () => {
    expect(helperScore.pwv(10)).toBe(1);
    expect(helperScore.pwv(50)).toBe(0);
    expect(helperScore.dust(50)).toBe(0.5);
    expect(helperScore.visibility(20_000)).toBe(1);
    expect(helperScore.visibility(1000)).toBe(0);
    expect(helperScore.precipProb(95)).toBeCloseTo(0.05, 12);
  });
  it('Modellkürzel lang/kurz, unbekannt roh; Symbole nach WMO-Code', () => {
    expect(modelName('global')).toBe('ICON global');
    expect(modelName('global', true)).toBe('IG');
    expect(modelName('dini', true)).toBe('HA');
    expect(modelName('nam')).toBe('nam');
    expect(weatherIconKey(0, true)).toBe('clearNight');
    expect(weatherIconKey(2, false)).toBe('partlyDay');
    expect(weatherIconKey(45, false)).toBe('fog');
    expect(weatherIconKey(61, false)).toBe('rain');
    expect(weatherIconKey(73, false)).toBe('snow');
    expect(weatherIconKey(96, false)).toBe('thunder');
    expect(weatherIconKey(null, false)).toBeNull();
  });
});
