// @vitest-environment jsdom
/**
 * AP-26f: Diagrammbereich des Projekt-Editors – Wetter-Reiter als Nachtkacheln (Bewertung, Mond); ein Klick
 * auf eine Nacht zeigt sie im Nacht-Reiter. Kein Bereich mit eigener Höhenbegrenzung.
 */
import { DEFAULT_CONDITIONS } from '@nina-pm/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { SiteView } from '../../api/client';
import { emptyDraft } from './model';
import { ChartArea } from './ProjectTabs';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const weatherNight = (night: string, ratingIndex: number | null, nightMean: number | null) => ({
  night,
  darkFromUtc: `${night}T20:00:00Z`,
  darkToUtc: `${night}T03:00:00Z`,
  nightMean,
  ratingIndex,
  coveredSec: 0,
  darknessSec: 0,
  coverage: 1,
  moonlessSec: 0,
  bestWindow: null,
  aerosolMissing: false,
  seeingIncomplete: false,
  moonIllumPct: 97.6,
  moonEvents: [],
});

vi.mock('../../api/client', () => ({
  equipmentApi: {
    nights: () =>
      Promise.resolve({
        currentNight: '2026-09-26',
        nights: ['2026-09-26', '2026-09-27', '2026-09-28'].map((night) => ({ night })),
        timeZoneTransitions: [
          { atUtc: '2026-03-29T01:00:00Z', utcOffsetMinutes: 120 },
          { atUtc: '2026-10-25T01:00:00Z', utcOffsetMinutes: 60 },
        ],
      }),
    weather: () =>
      Promise.resolve({
        siteId: ID(600),
        status: 'ready',
        nights: [
          weatherNight('2026-09-26', 1, 0.2),
          weatherNight('2026-09-27', 3, 0.8),
          weatherNight('2026-09-28', null, null),
        ],
      }),
  },
  projectsApi: {},
}));

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

const site = {
  id: ID(600),
  name: 'Demo-Sternwarte',
  timeZone: 'Europe/Berlin',
  latitudeDeg: 50.1,
  longitudeDeg: 8.7,
} as SiteView;

const renderArea = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <ChartArea
          draft={{ ...emptyDraft(DEFAULT_CONDITIONS), raDeg: 315.0, decDeg: 44.3 }}
          site={site}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('Diagrammbereich des Editors (AP-26f)', () => {
  it('Wetter als Nachtkacheln; Klick zeigt die Nacht im Nacht-Reiter; axe', async () => {
    renderArea();
    fireEvent.click(screen.getByRole('tab', { name: 'Wetter' }));
    const good = await screen.findByRole('button', {
      name: 'Nacht 27./28.09.: Gut – im Nachtdiagramm zeigen',
    });
    expect(good).toHaveTextContent('Gut 80 %');
    expect(good).toHaveTextContent('Mond 98 %');
    expect(
      screen.getByRole('button', {
        name: 'Nacht 28./29.09.: keine Daten – im Nachtdiagramm zeigen',
      }),
    ).toBeInTheDocument();
    await expectNoSeriousA11y();
    fireEvent.click(good);
    expect(screen.getByRole('tab', { name: 'Nachtdiagramm' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const region = screen.getByRole('region', { name: 'Diagramme' });
    expect(within(region).getByText('Nacht 27./28.09.')).toBeInTheDocument();
  });
});
