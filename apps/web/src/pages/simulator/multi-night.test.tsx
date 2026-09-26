// @vitest-environment jsdom
/**
 * AP-32a: S-40 Bereich *Mehrnacht* (Job starten, Status verfolgen, Streifen je Nacht mit Gewicht, Tabelle je
 * Projekt) und S-33 Auswirkungsvorschau (Anteil des Objekts, andere Projekte ohne → mit); axe.
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
}));

vi.mock('../../api/client', () => ({
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

beforeEach(() => {
  state.multi.mockReset();
  state.impact.mockReset();
  state.jobStatus = 'running';
  state.result = null;
});

describe('S-40 Mehrnacht', () => {
  it('startet den Job mit den Einstellungen, zeigt Status und dann Nächte und Projekte; axe', async () => {
    state.multi.mockResolvedValue({ jobId: ID(99) });
    wrap(<MultiNightPanel rigId={ID(1)} nightFrom="2026-09-26" withDrafts />);
    fireEvent.change(screen.getByLabelText('Zeitraum'), { target: { value: '14' } });
    fireEvent.click(screen.getByLabelText('Mit Wetter gewichten'));
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
    const strip = await screen.findByRole(
      'list',
      { name: 'Belichtete Stunden je Nacht' },
      { timeout: 4000 },
    );
    const items = within(strip).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0] as HTMLElement).getByText('Gewicht 0,5')).toBeTruthy();
    expect(within(items[1] as HTMLElement).getByText('ohne Vorhersage')).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Projekte über den Zeitraum' });
    const row = within(table).getByRole('row', { name: /NGC 281/ });
    expect(row.textContent).toContain('27./28.09.');
    expect(row.textContent).toContain('9,9 h');
    await expectNoSeriousA11y();
  });

  it('fehlgeschlagener Job zeigt die Fehlermeldung', async () => {
    state.multi.mockResolvedValue({ jobId: ID(98) });
    state.jobStatus = 'failed';
    wrap(<MultiNightPanel rigId={ID(1)} nightFrom="2026-09-26" withDrafts={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mehrnacht berechnen' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

describe('S-33 Auswirkungsvorschau', () => {
  it('Anteil des Objekts und andere Projekte ohne → mit; axe', async () => {
    state.impact.mockResolvedValue({ jobId: ID(97) });
    state.jobStatus = 'done';
    state.result = impact;
    wrap(<ImpactPanel projectId={ID(20)} />);
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
