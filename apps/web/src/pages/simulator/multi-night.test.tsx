// @vitest-environment jsdom
/**
 * AP-32a, Neugestaltung 10.10.2026: S-40 Bereich *Mehrnacht* (Job starten, Status verfolgen, Kacheln, Säulen je Nacht mit
 * Wetter in Worten, Projekt × Nacht mit Fortschritt und Filtern, fertige Projekte in einer Zeile) und S-33
 * Auswirkungsvorschau (Anteil des Objekts, andere Projekte ohne → mit); axe.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { ImpactResult, MultiSimResult } from '../../api/client';
import { ImpactPanel } from '../projects/ImpactPanel';
import { MultiNightPanel } from './MultiNightPanel';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const state = vi.hoisted(() => ({
  multi: vi.fn(),
  impact: vi.fn(),
  jobStatus: 'running' as string,
  result: null as unknown,
  weather: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  equipmentApi: { weather: (...a: unknown[]) => state.weather(...a) as Promise<unknown> },
  simulationApi: { multi: (...a: unknown[]) => state.multi(...a) as Promise<unknown> },
  approvalApi: { impact: (...a: unknown[]) => state.impact(...a) as Promise<unknown> },
  jobsApi: {
    get: (id: string) =>
      Promise.resolve({
        id,
        kind: 'multi_sim',
        status: state.jobStatus,
        attempts: 1,
        errorCode: state.jobStatus === 'failed' ? 'engine.input_invalid' : null,
        createdAt: '2026-09-26T18:00:00Z',
        startedAt: null,
        finishedAt: null,
        hasResult: state.jobStatus === 'done',
      }),
    result: () => Promise.resolve(state.result),
  },
}));

const multi: MultiSimResult = {
  kind: 'multi_sim',
  rigId: ID(1),
  rigName: 'Rig A',
  siteTimeZone: 'America/Chicago',
  nightFrom: '2026-09-26',
  nightCount: 2,
  weather: true,
  computedAt: '2026-09-26T18:00:00Z',
  nights: [
    {
      night: '2026-09-26',
      darkHours: 8,
      weight: 0.5,
      ratingIndex: 2,
      hasForecast: true,
      exposureHours: 3.2,
      projects: [{ projectId: ID(10), frames: 20, hours: 3.4 }],
    },
    {
      night: '2026-09-27',
      darkHours: 8,
      weight: 1,
      ratingIndex: null,
      hasForecast: false,
      exposureHours: 6.1,
      projects: [{ projectId: ID(10), frames: 40, hours: 6.5 }],
    },
  ],
  projects: [
    {
      projectId: ID(10),
      name: 'NGC 281',
      approvalStatus: 'approved',
      needFrames: 60,
      simulatedFrames: 60,
      hours: 9.9,
      nightsUsed: 2,
      completesNight: '2026-09-27',
      sharePct: 100,
      filters: [{ filter: 'Ha', need: 60, simulated: 60 }],
    },
    {
      projectId: ID(11),
      name: 'IC 1795',
      approvalStatus: 'approved',
      needFrames: 0,
      simulatedFrames: 0,
      hours: 0,
      nightsUsed: 0,
      completesNight: null,
      sharePct: 0,
      filters: [],
    },
  ],
};

const impact: ImpactResult = {
  kind: 'impact',
  queueItemId: ID(20),
  projectId: ID(20),
  projectName: 'IC 1805',
  rigId: ID(1),
  rigName: 'Rig A',
  nightFrom: '2026-09-26',
  nightCount: 14,
  computedAt: '2026-09-26T18:00:00Z',
  target: {
    ...multi.projects[0],
    projectId: ID(20),
    name: 'IC 1805',
    sharePct: 35,
    hours: 12.5,
    nightsUsed: 4,
  } as ImpactResult['target'],
  shifts: [
    {
      projectId: ID(10),
      name: 'NGC 281',
      hoursWithout: 9.9,
      hoursWith: 7.5,
      framesWithout: 60,
      framesWith: 48,
      completesWithout: '2026-09-27',
      completesWith: null,
    },
  ],
  hoursWithout: 9.9,
  hoursWith: 20,
};

const wrap = (ui: React.ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );

/** Vorhersage des Standorts: erste Nacht „Mittel 50 %“, zweite ohne Vorhersage. */
const forecast = {
  siteId: ID(600),
  timeZone: 'America/Chicago',
  status: 'ready',
  hours: [],
  nights: [
    {
      night: '2026-09-26',
      darkFromUtc: '2026-09-27T01:05:00Z',
      darkToUtc: '2026-09-27T10:05:00Z',
      nightMean: 0.5,
      ratingIndex: 2,
      coveredSec: 0,
      darknessSec: 32400,
      coverage: 0,
      moonlessSec: 0,
      bestWindow: null,
      aerosolMissing: false,
      seeingIncomplete: false,
      moonIllumPct: 40,
      moonEvents: [],
    },
  ],
  nightWindows: [],
  darkWindows: [],
};

beforeEach(() => {
  state.weather.mockReset();
  state.weather.mockResolvedValue(forecast);
  state.multi.mockReset();
  state.impact.mockReset();
  state.jobStatus = 'running';
  state.result = null;
});

describe('S-40 Mehrnacht', () => {
  it('startet den Job, zeigt Kacheln, Säulen je Nacht in Worten und Projekt × Nacht; axe', async () => {
    state.multi.mockResolvedValue({ jobId: ID(99) });
    wrap(
      <MultiNightPanel
        rigId={ID(1)}
        nightFrom="2026-09-26"
        withDrafts
        site={{ id: ID(600), name: 'Starfront' }}
      />,
    );
    expect(screen.getByText(/Plant die nächsten Nächte im Voraus/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Zeitraum'), { target: { value: '14' } });
    fireEvent.click(screen.getByLabelText('Wetter einrechnen'));
    // Kein Wetterband mehr; bei 14 Nächten der Hinweis zur Reichweite der Vorhersage.
    expect(screen.queryByText('Wetter am Standort Starfront')).toBeNull();
    expect(
      screen.getByText('Die Vorhersage reicht 7 Nächte; die übrigen Nächte zählen voll.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mehrnacht berechnen' }));
    await waitFor(() =>
      expect(state.multi).toHaveBeenCalledWith({
        rigId: ID(1),
        nightFrom: '2026-09-26',
        nights: 14,
        weather: true,
        includeOwnDrafts: true,
      }),
    );
    expect(await screen.findByText('Wird berechnet …')).toBeTruthy();
    state.jobStatus = 'done';
    state.result = multi;
    const nights = await screen.findByRole(
      'list',
      { name: 'Nächte im Zeitraum' },
      { timeout: 4000 },
    );
    // Kacheln: 3,2 + 6,1 = 9,3 h erwartet von 6,4 + 6,1 = 12,5 h möglich; 0 gute Nächte, eine ohne Vorhersage.
    const tiles = screen.getByRole('group', { name: 'Kurzfassung' });
    expect(within(tiles).getByText('9,3 h')).toBeTruthy();
    expect(within(tiles).getByText('von 12,5 h, wenn alle 2 Nächte klar wären')).toBeTruthy();
    expect(within(tiles).getByText('keine – ohne Vorhersage: 1')).toBeTruthy();
    expect(within(tiles).getByText('NGC 281 am So 27./28.09. · schon fertig: 1')).toBeTruthy();
    const items = within(nights).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(await within(items[0] as HTMLElement).findByText('Mittel · 50 %')).toBeTruthy();
    expect(
      within(items[0] as HTMLElement).getByText('zählt zu 50 % · 6,4 h, wenn klar'),
    ).toBeTruthy();
    expect(items[0]).toHaveAccessibleName(
      'Sa 26./27.09.: 3,2 h erwartet, 6,4 h möglich bei klarer Nacht, 8 h dunkel, Wetter Mittel · 50 %',
    );
    expect(within(items[1] as HTMLElement).getByText('ohne Vorhersage – zählt voll')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Zur Wettervorhersage' })).toBeTruthy();
    // Projekt × Nacht: Stunden je Nacht, Fortschritt, fertig; Projekte ohne Bedarf in einer Zeile.
    const table = screen.getByRole('table', { name: /Projekte über den Zeitraum/ });
    const row = within(table).getByRole('row', { name: /NGC 281/ });
    expect(row.textContent).toContain('3,2');
    expect(row.textContent).toContain('6,1');
    expect(row.textContent).toContain('60 von 60 Frames · 100 %');
    expect(row.textContent).toContain('fertig So 27./28.09.');
    expect(screen.getByText('Schon fertig: IC 1795')).toBeTruthy();
    // Aufklappen: Filter mit Bedarf, erwartet und danach offen.
    fireEvent.click(within(row).getByRole('button', { name: /NGC 281/ }));
    const filters = screen.getByRole('table', { name: 'Filter von NGC 281' });
    expect(within(filters).getByRole('row', { name: /Ha/ }).textContent).toContain('6060');
    await expectNoSeriousA11y();
  });

  it('ohne Wetter: mögliche Belichtung, Nächte zählen voll', async () => {
    state.multi.mockResolvedValue({ jobId: ID(97) });
    state.jobStatus = 'done';
    state.result = { ...multi, weather: false };
    wrap(<MultiNightPanel rigId={ID(1)} nightFrom="2026-09-26" withDrafts={false} site={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mehrnacht berechnen' }));
    const tiles = await screen.findByRole('group', { name: 'Kurzfassung' }, { timeout: 4000 });
    expect(within(tiles).getByText('Mögliche Belichtung')).toBeTruthy();
    expect(
      within(tiles).getByText('Wetter nicht eingerechnet – alle Nächte zählen voll'),
    ).toBeTruthy();
    expect(screen.getAllByText('8 h dunkel')).toHaveLength(2);
    expect(screen.queryByRole('link', { name: 'Zur Wettervorhersage' })).toBeNull();
  });

  it('fehlgeschlagener Job zeigt die Fehlermeldung', async () => {
    state.multi.mockResolvedValue({ jobId: ID(98) });
    state.jobStatus = 'failed';
    wrap(<MultiNightPanel rigId={ID(1)} nightFrom="2026-09-26" withDrafts={false} site={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mehrnacht berechnen' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

describe('S-33 Auswirkungsvorschau', () => {
  it('Anteil des Objekts und andere Projekte ohne → mit; axe', async () => {
    state.impact.mockResolvedValue({ jobId: ID(97) });
    state.jobStatus = 'done';
    state.result = impact;
    wrap(<ImpactPanel id={ID(20)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Auswirkung berechnen' }));
    await waitFor(() => expect(state.impact).toHaveBeenCalledWith('project', ID(20)));
    expect(
      await screen.findByText(
        'Anteil des Objekts: 35 % · 12,5 h in 4 Nächten · fertig am 27./28.09.',
      ),
    ).toBeTruthy();
    const row = within(screen.getByRole('table', { name: 'Andere Projekte am Rig' })).getByRole(
      'row',
      { name: /NGC 281/ },
    );
    expect(row.textContent).toContain('9,9 → 7,5');
    expect(row.textContent).toContain('27./28.09. → –');
    expect(screen.getByRole('button', { name: 'Neu berechnen' })).toBeTruthy();
    await expectNoSeriousA11y();
  });
});
