// @vitest-environment jsdom
/**
 * AP-21: S-20 Sternkarte – Werkzeugleiste (Rig, Ausrüstung, Bildfeld mit Rotation, Mosaik, Aktionen),
 * Rotation ohne Rotator (gesperrt für User, Warnung bei Abweichung, Anheften nur mit `equipment.write`),
 * *Neues Projekt* und *Ins Projekt übernehmen*, Reiter der Seitenleiste, Zeitsprünge in der URL; axe.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { Me } from '../../api/client';
import { AuthProvider } from '../../auth';
import { SkyMapPage } from './SkyMapPage';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const state = vi.hoisted(() => ({
  me: null as unknown,
  rig: null as unknown,
  project: null as unknown,
  updateRig: vi.fn(),
  patch: vi.fn(),
  searchItems: [] as unknown[],
}));

vi.mock('../../api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../api/client')>();
  return {
    dsoSearchParams: real.dsoSearchParams,
    api: { me: () => Promise.resolve(state.me) },
    equipmentApi: {
      list: (kind: string) =>
        Promise.resolve({
          items:
            kind === 'rigs'
              ? [state.rig]
              : kind === 'sites'
                ? [
                    {
                      id: ID(600),
                      name: 'Texas',
                      latitudeDeg: 31.5,
                      longitudeDeg: -99.4,
                      timeZone: 'America/Chicago',
                    },
                  ]
                : kind === 'telescopes'
                  ? [
                      {
                        id: ID(601),
                        name: 'Refraktor 80/480',
                        focalLengthMm: 480,
                        reducerFactor: 1,
                      },
                    ]
                  : kind === 'cameras'
                    ? [{ id: ID(602), name: 'Mono 26MP' }]
                    : [],
        }),
      nights: () => Promise.reject(new Error('offline')),
      updateRig: (...a: unknown[]) => state.updateRig(...a) as Promise<unknown>,
    },
    projectsApi: {
      list: () => Promise.resolve({ items: [] }),
      get: () => Promise.resolve(state.project),
      applyMosaic: (...a: unknown[]) => state.patch(...a) as Promise<unknown>,
    },
    catalogApi: {
      region: () => Promise.resolve({ items: [], total: 0 }),
      search: () =>
        Promise.resolve({
          items: state.searchItems,
          total: 0,
          night: null,
          catalog: { version: 'v', fetchedAt: '2026-09-25' },
        }),
    },
  };
});

const me = (role: 'owner' | 'user'): Me => ({
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
  member: {
    id: ID(92),
    displayName: 'Uta',
    role,
    effectiveRole: role === 'user' ? 'user' : 'admin',
  },
  isSuperUser: false,
  mfaRequired: false,
  memberships: [{ tenantKey: 'demo', tenantName: 'Demo', role }],
});

const rig = (over: Record<string, unknown> = {}) => ({
  id: ID(500),
  name: 'Rig A',
  siteId: ID(600),
  telescopeId: ID(601),
  cameraId: ID(602),
  showInPlanning: true,
  ninaDeliveryEnabled: true,
  defaultTemplateId: null,
  defaultRotationDeg: 12,
  hasRotator: false,
  rotationToleranceDeg: 5,
  skipOnRotationMismatch: false,
  sessionReportDiscord: false,
  notes: '',
  settingsVersion: 3,
  derived: { scaleArcsecPx: 1.62, fovWidthDeg: 2.8, fovHeightDeg: 1.9 },
  ...over,
});

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

const renderPage = (
  path = '/planung/sternkarte?ra=83.82&dec=-5.39&fra=83.82&fdec=-5.39&t=1797368400',
) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <Routes>
            <Route
              path="/planung/sternkarte"
              element={
                <>
                  <SkyMapPage />
                  <Where />
                </>
              }
            />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const where = () =>
  new URLSearchParams(screen.getByTestId('where').textContent?.split('?')[1] ?? '');

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  globalThis.ResizeObserver ??= class {
    observe = () => undefined;
    unobserve = () => undefined;
    disconnect = () => undefined;
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  state.me = me('user');
  state.rig = rig();
  state.project = null;
  state.updateRig.mockReset();
  state.patch.mockReset();
});

describe('S-20 Sternkarte', () => {
  it('Karte zuerst (AP-26f/26i): Werkzeugleiste, Objekt unter der Karte, Seitenbereich einklappbar; Karte als Bild', async () => {
    renderPage();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sternkarte' }),
    ).toBeInTheDocument();
    const toolbar = screen.getByRole('toolbar', { name: 'Sternkarte' });
    expect(within(toolbar).getByRole('combobox', { name: 'Katalogsuche' })).toBeInTheDocument();
    // Kontextleiste wie im Objektbrowser: Rig, Nacht mit Mondkalender, Heute Nacht, Uhrzeit, Jetzt.
    const context = screen.getByRole('region', { name: 'Rig und Nacht' });
    expect(within(context).getByLabelText('Uhrzeit')).toBeInTheDocument();
    expect(within(context).getByRole('button', { name: 'Jetzt' })).toBeInTheDocument();
    expect(within(toolbar).queryByLabelText('Uhrzeit')).toBeNull();
    // AP-26i: Objekt, Bildfeldmitte und Nachtdiagramm unter der Karte; rechts nur Bildfeld & Ebenen.
    const below = screen.getByRole('region', { name: 'Gewähltes Objekt und Nacht' });
    expect(
      within(below).getByRole('heading', { level: 2, name: 'Mitte des Bildfelds' }),
    ).toBeVisible();
    const side = screen.getByRole('complementary', { name: 'Bildfeld, Mosaik und Ebenen' });
    expect(
      within(side)
        .getAllByRole('tab')
        .map((x) => x.textContent),
    ).toEqual(['Bildfeld & Mosaik', 'Ebenen']);
    for (const name of ['Ausrüstung', 'Bildfeld', 'Mosaik'])
      expect(within(side).getByRole('heading', { level: 2, name })).toBeInTheDocument();
    // Einklappen: der Seitenbereich nimmt keine Breite mehr, der Knopf holt ihn zurück.
    fireEvent.click(within(side).getByRole('button', { name: 'Seitenbereich einklappen' }));
    expect(within(side).queryByRole('tab')).toBeNull();
    fireEvent.click(
      within(side).getByRole('button', { name: 'Bildfeld, Mosaik und Ebenen einblenden' }),
    );
    expect(within(side).getAllByRole('tab')).toHaveLength(2);
    expect(await screen.findByText('Refraktor 80/480')).toBeInTheDocument();
    expect(screen.getByText('2,8° × 1,9°')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Sternkarte mit Bildfeld des Rigs' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sternkarte' })).toHaveAttribute(
      'href',
      '/planung/sternkarte',
    );
    await expectNoSeriousA11y();
  });

  it('Seitengerüst (AP-26d): genau ein h1, keine Brotkrumen, Planungsreiter unter dem Titel', async () => {
    renderPage();
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Sternkarte' });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole('navigation', { name: /Brotkrumen|›/ })).not.toBeInTheDocument();
    const tabs = screen.getByRole('navigation', { name: 'Planungsbereiche' });
    // Reiter folgen dem Titel im Dokument (unter dem Titel).
    expect(h1.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('ohne Rotator: für User gesperrt auf den Kamerawinkel, kein Anheften', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: 'Bildfeld & Mosaik' }));
    const slider = await screen.findByRole('slider', { name: 'Rotation (°)' });
    await waitFor(() => expect(slider).toBeDisabled());
    expect(
      screen.getByText('Ohne Rotator gilt der Kamerawinkel des Rigs (12,0°).'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Als Rig-Standard anheften' }),
    ).not.toBeInTheDocument();
  });

  it('Admin: Abweichung vom Kamerawinkel wird gewarnt und lässt sich anheften', async () => {
    state.me = me('owner');
    state.updateRig.mockResolvedValue(rig({ defaultRotationDeg: 40 }));
    renderPage('/planung/sternkarte?ra=83.82&dec=-5.39&fra=83.82&fdec=-5.39&rot=40&t=1797368400');
    fireEvent.click(await screen.findByRole('tab', { name: 'Bildfeld & Mosaik' }));
    expect(
      await screen.findByText(/Weicht vom Kamerawinkel des Rigs \(12,0°\) ab/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Als Rig-Standard anheften' }));
    await waitFor(() =>
      expect(state.updateRig).toHaveBeenCalledWith(
        ID(500),
        expect.objectContaining({ defaultRotationDeg: 40, hasRotator: false, name: 'Rig A' }),
        3,
      ),
    );
  });

  it('Neues Projekt übernimmt Koordinaten, Rotation und Rig (FA-FRM-12)', async () => {
    state.rig = rig({ hasRotator: true });
    renderPage('/planung/sternkarte?ra=83.82&dec=-5.39&fra=83.5&fdec=-5.2&rot=33&t=1797368400');
    const link = await screen.findByRole('link', { name: 'Neues Projekt' });
    const q = new URLSearchParams(link.getAttribute('href')?.split('?')[1]);
    expect(Object.fromEntries(q)).toEqual({ ra: '83.5', dec: '-5.2', rot: '33', rig: ID(500) });
  });

  it('Neues Projekt übernimmt das in der Katalogsuche gewählte Objekt (Katalogverknüpfung)', async () => {
    state.rig = rig({ hasRotator: true });
    state.searchItems = [
      {
        id: ID(700),
        primaryId: 'NGC 1976',
        displayName: 'M 42',
        names: ['M 42', 'Orion Nebula'],
        catalogs: ['NGC', 'M'],
        objectType: 'Cl+N',
        group: 'emission_nebula',
        constellation: 'Ori',
        raDeg: 83.82,
        decDeg: -5.39,
        magV: 4,
        magB: null,
        magBandUsed: 'V',
        surfBrMagArcsec2: null,
        sizeMajorArcmin: 85,
        sizeMinorArcmin: 60,
        positionAngleDeg: null,
        source: 'openngc',
        filterHint: 'narrowband',
        night: null,
      },
    ];
    renderPage('/planung/sternkarte?ra=10&dec=40&fra=10&fdec=40&t=1797368400');
    const box = await screen.findByRole('combobox', { name: 'Katalogsuche' });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'm42' } });
    await screen.findByRole('option', { name: /M 42/ });
    fireEvent.keyDown(box, { key: 'Enter' });
    const link = await screen.findByRole('link', { name: 'Neues Projekt mit M 42' });
    // Das gewählte Objekt steht unter der Karte (AP-26i).
    expect(screen.getByRole('heading', { level: 2, name: 'M 42' })).toBeVisible();
    await waitFor(() =>
      expect(new URLSearchParams(link.getAttribute('href')?.split('?')[1]).get('objekt')).toBe(
        'NGC 1976',
      ),
    );
    state.searchItems = [];
  });

  it('Ins Projekt übernehmen setzt das Mosaik mit If-Match (AP-22)', async () => {
    state.rig = rig({ hasRotator: true });
    state.project = {
      id: ID(10),
      name: 'Orion',
      createdBy: ID(92),
      approvalStatus: 'draft',
      version: 7,
      mosaic: { cols: 1, rows: 1, overlapPct: 20 },
      panels: [{ id: ID(11), lines: [] }],
    };
    state.patch.mockResolvedValue({ ...(state.project as object), version: 8 });
    renderPage(
      `/planung/sternkarte?ra=83.82&dec=-5.39&fra=83.5&fdec=-5.2&rot=33&h=2&v=2&ueberlappung=15&projekt=${ID(10)}`,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Ins Projekt übernehmen' }));
    await waitFor(() =>
      expect(state.patch).toHaveBeenCalledWith(
        ID(10),
        {
          raDeg: 83.5,
          decDeg: -5.2,
          rotationDeg: 33,
          cols: 2,
          rows: 2,
          overlapPct: 15,
          copyPlan: true,
        },
        7,
      ),
    );
    expect(
      await screen.findByText('Mosaik, Koordinaten und Rotation ins Projekt übernommen.'),
    ).toBeInTheDocument();
  });

  it('weniger Panels: Bestätigungsdialog nennt wegfallende Panels mit Aufnahmen', async () => {
    state.rig = rig({ hasRotator: true });
    state.project = {
      id: ID(10),
      name: 'Cygnus',
      createdBy: ID(92),
      approvalStatus: 'draft',
      version: 7,
      mosaic: { cols: 2, rows: 1, overlapPct: 20 },
      panels: [
        { id: ID(11), lines: [] },
        { id: ID(12), lines: [{ hasCaptures: true }] },
      ],
    };
    state.patch.mockResolvedValue({ id: ID(10), version: 8 });
    renderPage(`/planung/sternkarte?ra=300&dec=40&fra=300&fdec=40&h=1&v=1&projekt=${ID(10)}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Ins Projekt übernehmen' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('1 Panels fallen weg; 1 davon haben Aufnahmen');
    expect(state.patch).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ins Projekt übernehmen' }));
    await waitFor(() => expect(state.patch).toHaveBeenCalledTimes(1));
  });

  it('Reiter Ebenen: Himmelsfotos, Kataloge, Overlays; Foto-Wahl in der URL', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: 'Ebenen' }));
    const aside = screen.getByRole('complementary', { name: 'Bildfeld, Mosaik und Ebenen' });
    expect(within(aside).getByRole('radio', { name: 'DSS2 Farbe' })).toBeVisible();
    expect(within(aside).queryByRole('checkbox', { name: 'Äquatorial' })).toBeNull();
    fireEvent.click(within(aside).getByRole('tab', { name: 'Overlays' }));
    expect(within(aside).getByRole('checkbox', { name: 'Äquatorial' })).toBeChecked();
    fireEvent.click(within(aside).getByRole('tab', { name: 'Himmelsfotos' }));
    fireEvent.click(
      within(aside).getByRole('radio', { name: 'Pan-STARRS DR1 (nördlich von −30°)' }),
    );
    expect(where().get('foto')).toBe('panstarrs');
    await expectNoSeriousA11y();
  });

  it('Zeitsteuerung: +1 h und Jetzt', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '+1 h' }));
    expect(where().get('t')).toBe(String(1797368400 + 3600));
    expect(screen.getByLabelText('Uhrzeit')).toHaveValue('16:00');
    fireEvent.click(screen.getByRole('button', { name: 'Jetzt' }));
    expect(where().get('t')).toBeNull();
  });
});
