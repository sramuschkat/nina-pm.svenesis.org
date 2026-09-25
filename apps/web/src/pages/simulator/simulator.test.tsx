// @vitest-environment jsdom
/**
 * S-40 Nacht-Simulator (AP-13f): Daten aus der API → Plan im (hier Inline-)Worker, Zielkarten,
 * Protokoll, Hash = Node-Lauf, Nachtwechsel über die Nacht-Tabelle, Speichern, Rechte je Rolle; axe.
 */
import { planNight, type PlanInput } from '@nina-pm/engine';
import { buildPlanInput } from '@nina-pm/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  moonProfiles,
  nights,
  projects,
  rig,
  STARFRONT,
} from '../../../../../packages/shared/test/fixtures/plan';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { Me } from '../../api/client';
import { AuthProvider } from '../../auth';
import { SimulatorPage } from './SimulatorPage';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const state = vi.hoisted(() => ({
  me: null as unknown,
  nightsFrom: [] as (string | undefined)[],
  save: vi.fn((body: unknown) =>
    Promise.resolve({ id: 'x', createdAt: '2026-09-17T18:00:00Z', body }),
  ),
  patchLine: vi.fn(() => Promise.resolve({})),
}));

vi.mock('../../api/client', async () => {
  const f = await import('../../../../../packages/shared/test/fixtures/plan');
  const site = {
    id: f.rig.siteId,
    name: 'Starfront',
    timeZone: 'America/Chicago',
    ...f.STARFRONT,
  };
  const approvedActive = f.projects.filter(
    (p) => p.approvalStatus === 'approved' && p.status === 'active',
  );
  return {
    api: { me: () => Promise.resolve(state.me) },
    equipmentApi: {
      list: (kind: string) =>
        Promise.resolve({
          items:
            kind === 'rigs'
              ? [
                  {
                    ...f.rig,
                    derived: { scaleArcsecPx: 1, fovWidthDeg: 1, fovHeightDeg: 1, effFocalMm: 500 },
                  },
                ]
              : kind === 'sites'
                ? [site]
                : kind === 'telescopes'
                  ? [{ id: f.rig.telescopeId, name: 'GT81' }]
                  : kind === 'cameras'
                    ? [{ id: f.rig.cameraId, name: 'Ares-M' }]
                    : kind === 'filters'
                      ? [
                          { id: f.FILTER_HA, shortName: 'Ha', colorHex: '#d32f2f' },
                          { id: f.FILTER_OIII, shortName: 'OIII', colorHex: '#00e5ff' },
                          { id: f.FILTER_L, shortName: 'L', colorHex: '#ffffff' },
                        ]
                      : kind === 'moon-profiles'
                        ? f.moonProfiles.map((p) => ({ ...p, name: `Profil ${p.id.slice(-2)}` }))
                        : [],
        }),
      nights: (_site: string, _count: number, from?: string) => {
        state.nightsFrom.push(from);
        return Promise.resolve({ ...f.nights, currentNight: '2026-09-17' });
      },
    },
    projectsApi: {
      list: (q: string) =>
        Promise.resolve({ items: q.includes('approvalStatus=approved') ? approvedActive : [] }),
      get: (id: string) => Promise.resolve(f.projects.find((p) => p.id === id)),
      patchLine: state.patchLine,
    },
    simulationApi: { save: state.save },
    ninaApi: { instances: () => Promise.resolve({ items: [] }) },
  };
});

const me = (role: 'owner' | 'user'): Me => ({
  identity: {
    id: ID(1),
    discordUserId: '1',
    username: 'u',
    globalName: 'Uta',
    avatarHash: null,
    mfa: true,
  },
  context: 'tenant',
  tenant: { id: ID(2), key: 'demo', name: 'Demo', timeZone: 'Europe/Berlin' },
  member: {
    id: ID(3),
    displayName: 'Uta',
    role,
    effectiveRole: role === 'user' ? 'user' : 'admin',
  },
  isSuperUser: false,
  mfaRequired: false,
  memberships: [{ tenantKey: 'demo', tenantName: 'Demo', role }],
});

function renderPage(role: 'owner' | 'user' = 'owner', path = '/nina/simulator') {
  state.me = me(role);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <SimulatorPage />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.nightsFrom = [];
  state.save.mockClear();
  state.patchLine.mockClear();
});

const nodeHash = () =>
  planNight(
    buildPlanInput(rig, projects, moonProfiles, nights, {
      night: '2026-09-17',
      site: STARFRONT,
    }) as PlanInput,
  ).outputHash;

describe('S-40 Nacht-Simulator', () => {
  it('rechnet die Nacht: Zielkarten, Protokoll, Plan-Hash = Node-Lauf (FA-SIM-05)', async () => {
    renderPage();
    const hash = await screen.findByText(/^Plan-Hash sha256:/, {}, { timeout: 5000 });
    expect(hash.textContent).toBe(`Plan-Hash ${nodeHash()}`);
    expect(screen.getByRole('heading', { level: 1, name: 'Nacht-Simulator' })).toBeInTheDocument();
    const card = screen
      .getAllByRole('article')
      .find((a) => a.getAttribute('aria-label') !== 'Nicht zugeteilt');
    expect(card).toBeDefined();
    expect(within(card as HTMLElement).getByText('Zeitfenster')).toBeInTheDocument();
    expect(screen.getAllByRole('row').length).toBeGreaterThan(3);
    expect(screen.getAllByText(/CDT/).length).toBeGreaterThan(0);
    // Übernahmestatus (FA-SIM-09, AP-14c) rechts über Schritt 1.
    expect(screen.getByText('Noch keine NINA-Instanz verbunden.')).toBeInTheDocument();
    await expectNoSeriousA11y();
    // Worker-Rechnung (bis 5 s) plus axe: unter Volllast des Gesamtlaufs mehr als die 5 s Standard.
  }, 20_000);

  it('Nachtwechsel lädt die Nacht-Tabelle ab der gewählten Nacht; Speichern schickt den Plan', async () => {
    renderPage();
    await screen.findByText(/^Plan-Hash/, {}, { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: 'Vorige Nacht' }));
    await waitFor(() => expect(state.nightsFrom).toContain('2026-09-16'));
    await screen.findByText(/Nacht 16\.\/17\.09\./, {}, { timeout: 5000 });
    await screen.findByText(/^Plan-Hash/, {}, { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: 'Plan speichern' }));
    await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
    const body = state.save.mock.calls[0]?.[0] as {
      rigId: string;
      night: string;
      plan: { night: string };
    };
    expect([body.rigId, body.night, body.plan.night]).toEqual([rig.id, '2026-09-16', '2026-09-16']);
  });

  it('Admin schaltet Zeilen an/aus; User sieht keinen Schalter', async () => {
    const { unmount } = renderPage('owner');
    await screen.findByText(/^Plan-Hash/, {}, { timeout: 5000 });
    const toggle = screen.getAllByRole('checkbox', { name: /aktiv$/ })[0] as HTMLInputElement;
    fireEvent.click(toggle);
    await waitFor(() => expect(state.patchLine).toHaveBeenCalledOnce());
    unmount();
    renderPage('user');
    await screen.findByText(/^Plan-Hash/, {}, { timeout: 5000 });
    expect(screen.queryAllByRole('checkbox', { name: /aktiv$/ })).toHaveLength(0);
  });

  it('Zeitschieber beantwortet „Was macht das Rig um …?“ in Standortzeit', async () => {
    renderPage();
    await screen.findByText(/^Plan-Hash/, {}, { timeout: 5000 });
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, {
      target: { value: String(Date.parse('2026-09-18T08:00:00Z') / 1000) },
    });
    expect(screen.getByText(/Was macht das Rig um 03:00 CDT\?/)).toBeInTheDocument();
  });
});
