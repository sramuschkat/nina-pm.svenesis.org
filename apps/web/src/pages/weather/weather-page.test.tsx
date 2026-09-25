// @vitest-environment jsdom
/**
 * S-50 Wettervorhersage (AP-23, FK 14.3): Standort-/Rig-Auswahl über die URL, Kopf mit Koordinaten,
 * Zeitzone, Standort- und eigener Zeit; Grafik, Nachttabelle (Bewertung, Abdeckung, dunkel, mondlos,
 * bestes Fenster, Mond, Kennzeichen) mit Sprung ins Nachtdetail; noch kein Abruf; meteoblue nur als Link;
 * axe.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import { meteoblueHref } from './model';
import { WeatherPage } from './WeatherPage';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const state = vi.hoisted(() => ({ weather: vi.fn(), list: vi.fn() }));

vi.mock('../../api/client', () => ({
  equipmentApi: {
    list: (...a: unknown[]) => state.list(...a) as Promise<unknown>,
    weather: (...a: unknown[]) => state.weather(...a) as Promise<unknown>,
  },
}));

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

const SITES = [
  {
    id: ID(1),
    name: 'Starfront',
    latitudeDeg: 31.5471,
    longitudeDeg: -99.3823,
    timeZone: 'America/Chicago',
  },
  {
    id: ID(2),
    name: 'Hannover',
    latitudeDeg: 52.37,
    longitudeDeg: 9.73,
    timeZone: 'Europe/Berlin',
  },
];
const RIGS = [{ id: ID(10), name: 'Rig Hannover', siteId: ID(2) }];

const hour = (t: string) => ({
  tUtc: t,
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
  wind250Kmh: 90,
  windDir250Deg: 270,
  wind500Kmh: 60,
  windDir500Deg: 260,
  wind700Kmh: 40,
  windDir700Deg: 250,
  wind850Kmh: 30,
  windDir850Deg: 240,
  surfacePressureHPa: 990,
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
  sunAltDeg: -30,
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
});

const view = (siteId: string) => ({
  siteId,
  latitudeDeg: 31.5471,
  longitudeDeg: -99.3823,
  timeZone: 'America/Chicago',
  status: 'ready',
  fetchedAtUtc: '2026-09-24T18:00:00Z',
  expiresAtUtc: '2026-09-24T19:00:00Z',
  modelSet: 'hrrr+gem+gfs+ecmwf+nbm+cams',
  region: 'other',
  cmp3: 'nbm',
  days: 7,
  hours: ['2026-09-25T01:00:00Z', '2026-09-25T02:00:00Z'].map(hour),
  nights: [
    {
      night: '2026-09-24',
      darkFromUtc: '2026-09-25T01:05:00Z',
      darkToUtc: '2026-09-25T10:05:00Z',
      nightMean: 0.564,
      ratingIndex: 2,
      coveredSec: 6900,
      darknessSec: 32400,
      coverage: 0.213,
      moonlessSec: 6900,
      bestWindow: {
        fromUtc: '2026-09-25T01:05:00Z',
        toUtc: '2026-09-25T03:00:00Z',
        sec: 6900,
        moonFreeSec: 6900,
        meanScore: 0.564,
        fair: true,
      },
      aerosolMissing: true,
      seeingIncomplete: false,
      moonIllumPct: 62.4,
      moonEvents: [{ type: 'set', atUtc: '2026-09-25T06:12:00Z' }],
    },
  ],
  nightWindows: [
    { night: '2026-09-24', startUtc: '2026-09-24T23:00:00Z', endUtc: '2026-09-25T12:10:00Z' },
  ],
  darkWindows: [
    { night: '2026-09-24', startUtc: '2026-09-25T01:05:00Z', endUtc: '2026-09-25T10:05:00Z' },
  ],
  tzdataVersion: '2026a',
  timeZoneTransitions: [],
});

function Where() {
  return <span data-testid="where">{useLocation().search}</span>;
}

const renderPage = (url = '/wetter') =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route
            path="/wetter"
            element={
              <>
                <WeatherPage />
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  state.list
    .mockReset()
    .mockImplementation((kind: string) =>
      Promise.resolve({ items: kind === 'sites' ? SITES : RIGS }),
    );
  state.weather.mockReset().mockImplementation((id: string) => Promise.resolve(view(id)));
});

describe('Wettervorhersage S-50', () => {
  it('erster Standort, Kopf, Grafik, Nachttabelle; axe', async () => {
    renderPage();
    expect(
      await screen.findByText(/Stand 13:00 CDT · Modelle hrrr\+gem\+gfs\+ecmwf\+nbm\+cams/),
    ).toBeInTheDocument();
    expect(state.weather).toHaveBeenCalledWith(ID(1));
    expect(screen.getByText('America/Chicago')).toBeInTheDocument();
    const nights = screen.getAllByRole('region', { name: 'Nächte' }).at(-1) as HTMLElement;
    const row = within(nights).getAllByRole('row')[1] as HTMLElement;
    expect(row).toHaveTextContent('Mittel 56 %');
    expect(row).toHaveTextContent('21 %');
    expect(row).toHaveTextContent('9,0 h');
    expect(row).toHaveTextContent('1,9 h');
    expect(row).toHaveTextContent(
      '20:05–22:00 CDT1,9 h, davon 1,9 h mondfrei · bestenfalls mittel',
    );
    expect(row).toHaveTextContent('62 % beleuchtetunter 01:12 CDT');
    expect(row).toHaveTextContent(
      'ohne Aerosol – Bewertung optimistisch · Nacht unvollständig (21 %)',
    );
    await expectNoSeriousA11y();
  });

  it('Rig-Auswahl wählt dessen Standort (URL)', async () => {
    renderPage();
    await screen.findByText(/Stand 13:00 CDT/);
    fireEvent.change(screen.getByLabelText('Standort oder Rig'), {
      target: { value: `rig:${ID(10)}` },
    });
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`standort=${ID(2)}`));
    await waitFor(() => expect(state.weather).toHaveBeenCalledWith(ID(2)));
  });

  it('Nacht in der Tabelle öffnet das Nachtdetail', async () => {
    renderPage(`/wetter?standort=${ID(1)}`);
    const button = await screen.findByRole('button', {
      name: /Nacht Do\., 24\.09\. im Detail zeigen|im Detail zeigen/,
    });
    fireEvent.click(button);
    expect(screen.getByRole('region', { name: /Nacht im Detail/ })).toBeInTheDocument();
  });

  it('noch kein Abruf: Hinweis statt Grafik', async () => {
    state.weather.mockResolvedValue({
      ...view(ID(1)),
      status: 'pending',
      hours: [],
      nights: [],
      fetchedAtUtc: null,
    });
    renderPage();
    expect(await screen.findByText(/liegt noch keine Vorhersage vor/)).toBeInTheDocument();
  });

  it('meteoblue nur als externer Link mit Koordinaten', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: 'Wetterkarte bei meteoblue öffnen' });
    expect(link).toHaveAttribute(
      'href',
      'https://www.meteoblue.com/de/wetter/maps/31.547N-99.382E',
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(meteoblueHref(-33.5, 18.4, 'en')).toBe(
      'https://www.meteoblue.com/en/weather/maps/-33.500N18.400E',
    );
  });
});
