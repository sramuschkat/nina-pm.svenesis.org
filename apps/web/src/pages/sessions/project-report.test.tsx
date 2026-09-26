// @vitest-environment jsdom
/**
 * AP-34: S-63 Projektbericht – Filter (Zeitraum, Status, Rig, Typ) gehen in die Abfrage, Übersicht, aufklappbarer
 * Projektabschnitt mit Filtern, Verlauf, Sessions, Bedingungen und Kanalbalance, CSV-Export, Drucken; axe.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { Me, ProjectReport } from '../../api/client';
import { AuthProvider } from '../../auth';
import { ProjectReportPage } from './ProjectReportPage';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const state = vi.hoisted(() => ({
  me: null as unknown,
  calls: [] as unknown[],
  report: null as unknown,
}));

vi.mock('../../api/client', () => ({
  api: { me: () => Promise.resolve(state.me) },
  equipmentApi: {
    list: (kind: string) =>
      Promise.resolve({
        items:
          kind === 'rigs'
            ? [{ id: ID(1), name: 'Rig A' }]
            : kind === 'filters'
              ? [
                  { id: ID(5), shortName: 'OIII', colorHex: '#00897b' },
                  { id: ID(6), shortName: 'L', colorHex: '#9e9e9e' },
                ]
              : [],
      }),
  },
  reportsApi: {
    projects: (q: unknown) => {
      state.calls.push(q);
      return Promise.resolve(state.report);
    },
  },
}));

const me = (): Me => ({
  identity: {
    id: ID(90),
    discordUserId: '1',
    username: 'u',
    globalName: 'Uta',
    avatarHash: null,
    mfa: true,
  },
  context: 'tenant',
  tenant: { id: ID(91), key: 'demo', name: 'Demo', timeZone: 'Europe/Berlin' },
  member: { id: ID(92), displayName: 'Uta', role: 'user', effectiveRole: 'user' },
  isSuperUser: false,
  mfaRequired: false,
  memberships: [{ tenantKey: 'demo', tenantName: 'Demo', role: 'user' }],
});

const report = (): ProjectReport => ({
  from: '2026-09-01',
  to: '2026-09-26',
  generatedAt: '2026-09-26T18:00:00Z',
  totals: { projects: 1, periodAccepted: 24, periodIntegrationS: 7200 },
  projects: [
    {
      projectId: ID(10),
      name: 'NGC 7000',
      projectType: 'deep_sky',
      targetName: 'NGC 7000',
      rigId: ID(1),
      rigName: 'Rig A',
      approvalStatus: 'approved',
      status: 'active',
      percentDone: 55,
      filters: [
        {
          filter: 'OIII',
          planned: 40,
          accepted: 36,
          remaining: 4,
          integrationS: 10800,
          percentDone: 90,
        },
        {
          filter: 'L',
          planned: 40,
          accepted: 8,
          remaining: 32,
          integrationS: 2400,
          percentDone: 20,
        },
      ],
      periodAccepted: 24,
      periodIntegrationS: 7200,
      nights: [
        {
          night: '2026-09-12',
          filters: [
            {
              filter: 'OIII',
              acquired: 18,
              rejected: 2,
              accepted: 16,
              integrationS: 4800,
              cumulativeS: 10800,
            },
            {
              filter: 'L',
              acquired: 8,
              rejected: 0,
              accepted: 8,
              integrationS: 2400,
              cumulativeS: 2400,
            },
          ],
        },
      ],
      sessions: [
        {
          sessionId: ID(20),
          night: '2026-09-12',
          rigName: 'Rig A',
          status: 'completed',
          filters: [
            { filter: 'OIII', frames: 18 },
            { filter: 'L', frames: 8 },
          ],
          frames: 26,
          rejectedPct: 7.7,
          weatherRatingIndex: 3,
        },
      ],
      conditions: {
        minAltitudeDeg: 30,
        minTimeOnTargetH: 1,
        twilight: 'astronomical',
        moonAvoidanceEnabled: true,
        moonSeparationDeg: 60,
      },
      channelBalance: {
        behind: [{ filter: 'L', percentDone: 20 }],
        ahead: [{ filter: 'OIII', percentDone: 90 }],
      },
    },
  ],
});

const wrap = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <AuthProvider>
          <ProjectReportPage />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  state.me = me();
  state.calls = [];
  state.report = report();
});

describe('S-63 Projektbericht', () => {
  it('Übersicht und aufklappbarer Projektabschnitt; Filter gehen in die Abfrage; axe', async () => {
    wrap();
    const overview = await screen.findByRole('table', { name: 'Übersicht' });
    const row = within(overview).getByRole('row', { name: /NGC 7000/ });
    expect(row.textContent).toContain('55 %');
    expect(row.textContent).toContain('2 h');
    expect(screen.getByText(/1 Projekte · 24 akzeptierte Frames/)).toBeTruthy();
    // Projektabschnitt: Filter, Kanalbalance, Sessions, Bedingungen.
    expect(screen.getByRole('table', { name: 'Filter von NGC 7000' })).toBeTruthy();
    expect(screen.getByText(/Kanalbalance: OIII 90 % – dagegen L 20 %/)).toBeTruthy();
    const sessions = screen.getByRole('table', { name: 'Sessions von NGC 7000' });
    expect(within(sessions).getByRole('link', { name: '12./13.09.' })).toBeTruthy();
    expect(within(sessions).getByText('7,7 %')).toBeTruthy();
    expect(within(sessions).getByText('Gut')).toBeTruthy();
    expect(
      screen.getByRole('img', { name: /1 Nächte mit Aufnahmen, kumuliert 3,7 h/ }),
    ).toBeTruthy();
    expect(screen.getByText('an (Mindestabstand 60°)')).toBeTruthy();
    await expectNoSeriousA11y();

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'active' } });
    fireEvent.change(screen.getByLabelText('Objekttyp'), { target: { value: 'deep_sky' } });
    fireEvent.change(screen.getByLabelText('Zeitraum'), { target: { value: 'all' } });
    await waitFor(() =>
      expect(state.calls.at(-1)).toEqual({ status: 'active', rigId: '', type: 'deep_sky' }),
    );
  });

  it('CSV exportieren und Drucken (alle Abschnitte aufgeklappt)', async () => {
    const names: string[] = [];
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => {
      blobs.push(b);
      return 'blob:x';
    });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    wrap();
    await screen.findByRole('table', { name: 'Übersicht' });
    fireEvent.click(screen.getByRole('button', { name: 'CSV exportieren' }));
    expect(names).toEqual(['projektbericht-2026-09-01-2026-09-26.csv']);
    // Snapshot der CSV (Summen je Filter, Verlauf je Nacht; BOM und CRLF für Excel).
    const bytes = new Uint8Array(await (blobs[0] as Blob).arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes).split('\r\n')).toMatchInlineSnapshot(`
      [
        "section;project;rig;status;filter;night;planned;accepted;remaining;acquired;rejected;integrationH;cumulativeH",
        "total;NGC 7000;Rig A;active;OIII;;40;36;4;;;3;",
        "total;NGC 7000;Rig A;active;L;;40;8;32;;;0.67;",
        "night;NGC 7000;Rig A;active;OIII;2026-09-12;;16;;18;2;1.33;3",
        "night;NGC 7000;Rig A;active;L;2026-09-12;;8;;8;0;0.67;0.67",
        "",
      ]
    `);
    fireEvent.click(screen.getByRole('button', { name: 'Drucken' }));
    expect(print).toHaveBeenCalled();
    expect([...document.querySelectorAll('details')].every((d) => d.open)).toBe(true);
    click.mockRestore();
    print.mockRestore();
  });
});
