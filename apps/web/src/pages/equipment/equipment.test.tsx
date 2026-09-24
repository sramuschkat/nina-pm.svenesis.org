// @vitest-environment jsdom
/**
 * S-11…S-15 (AP-09b): Formularvalidierung mit den Schemas aus `packages/shared`, Rechteanzeige
 * (User liest nur), Löschsperre mit Verwenderliste, mitgelieferte Mondprofile gesperrt, axe.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { Me } from '../../api/client';
import { ApiError, AuthProvider } from '../../auth';
import { CamerasPage, readoutMismatch } from './CamerasPage';
import { filterPassband } from './FiltersPage';
import { MoonProfilesPage, requiredSeparation } from './MoonProfilesPage';
import { longitudeSuspicious } from './SitesPage';
import { TelescopesPage } from './TelescopesPage';

const state = vi.hoisted(() => ({
  me: null as unknown,
  lists: {} as Record<string, unknown[]>,
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  api: {
    me: () => Promise.resolve(state.me),
  },
  equipmentApi: {
    list: (kind: string) => Promise.resolve({ items: state.lists[kind] ?? [] }),
    create: (...args: unknown[]) => state.create(...args) as Promise<unknown>,
    update: (...args: unknown[]) => state.update(...args) as Promise<unknown>,
    remove: (...args: unknown[]) => state.remove(...args) as Promise<unknown>,
  },
}));

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AT = '2026-09-24T10:00:00Z';

function me(role: 'owner' | 'admin' | 'user'): Me {
  return {
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
  };
}

const telescope = {
  id: ID(10),
  name: 'GT81',
  brand: '',
  model: '',
  opticalDesign: 'apochromatic_refractor',
  apertureMm: 81,
  focalLengthMm: 478,
  reducerFactor: 0.8,
  obstructionPct: 0,
  imageCircleMm: null,
  backfocusMm: null,
  weightKg: null,
  notes: '',
  createdAt: AT,
  updatedAt: AT,
};

const camera = {
  id: ID(11),
  name: 'Ares-M Pro',
  brand: '',
  model: '',
  sensorName: 'IMX533',
  widthPx: 3008,
  heightPx: 3008,
  pixelSizeUm: 3.76,
  bitDepth: 14,
  isCooled: true,
  coolingSetpointC: -10,
  coolingToleranceC: 1,
  isColor: false,
  readNoiseE: 1,
  fullWellE: 50000,
  gainEPerAdu: 1,
  quantumEfficiencyPct: 80,
  darkCurrentES20c: 0.005,
  defaultGain: null,
  defaultOffset: null,
  defaultBinning: 1,
  defaultReadoutMode: 'Default',
  supportedBinning: [1, 2],
  gainModes: [],
  readoutModes: ['Default'],
  ninaReported: { readoutModes: ['Default', 'High Gain'] },
  notes: '',
  createdAt: AT,
  updatedAt: AT,
};

const builtIn = {
  id: ID(20),
  name: 'moonProfile.strict',
  description: '',
  separationDeg: 90,
  widthDays: 8,
  relaxScale: 0,
  moonMinAltDeg: -15,
  moonMaxAltDeg: 5,
  maxIlluminationPct: 30,
  moonMustBeDown: false,
  isBuiltIn: true,
  createdAt: AT,
};

function wrap(children: ReactNode) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <AuthProvider>{children}</AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.me = me('owner');
  state.lists = { telescopes: [telescope], cameras: [camera], 'moon-profiles': [builtIn] };
  state.create.mockReset();
  state.update.mockReset();
  state.remove.mockReset();
});

describe('S-13 Kameras', () => {
  it('berechnete Werte, NINA-Hinweis und Speichern einer neuen Kamera mit Client-UUID; axe', async () => {
    wrap(<CamerasPage />);
    expect(await screen.findByRole('heading', { name: 'Ares-M Pro' })).toBeInTheDocument();
    expect(screen.getByText('11,31 × 11,31 mm')).toBeInTheDocument();
    expect(screen.getByText('NINA meldet abweichende Auslesemodi')).toBeInTheDocument();
    expect(
      screen.getByText('Von NINA gemeldet, hier nicht gepflegt: High Gain'),
    ).toBeInTheDocument();
    await expectNoSeriousA11y();

    fireEvent.click(screen.getByRole('button', { name: 'Neu' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'ASI2600MM' } });
    fireEvent.change(screen.getByLabelText('Breite (px)'), { target: { value: '6248' } });
    fireEvent.change(screen.getByLabelText('Höhe (px)'), { target: { value: '4176' } });
    fireEvent.change(screen.getByLabelText('Pixelgröße (µm)'), { target: { value: '3.76' } });
    state.create.mockResolvedValue({
      ...camera,
      id: ID(12),
      name: 'ASI2600MM',
      ninaReported: null,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(state.create).toHaveBeenCalledTimes(1));
    const [kind, body] = state.create.mock.calls[0] as [string, Record<string, unknown>];
    expect(kind).toBe('cameras');
    expect(body).toMatchObject({
      name: 'ASI2600MM',
      widthPx: 6248,
      pixelSizeUm: 3.76,
      defaultGain: null,
      supportedBinning: [1, 2],
    });
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('Pflichtfelder fehlen → Feldfehler, kein API-Aufruf', async () => {
    wrap(<CamerasPage />);
    await screen.findByRole('heading', { name: 'Ares-M Pro' });
    fireEvent.click(screen.getByRole('button', { name: 'Neu' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ohne Sensor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findAllByText('Ungültiger Wert')).not.toHaveLength(0);
    expect(screen.getByLabelText('Breite (px)')).toHaveAttribute('aria-invalid', 'true');
    expect(state.create).not.toHaveBeenCalled();
  });
});

describe('S-15 Mondprofile', () => {
  it('mitgeliefert: gesperrt, ohne Speichern/Löschen, aber klonbar', async () => {
    wrap(<MoonProfilesPage />);
    expect(await screen.findByRole('heading', { name: 'Streng' })).toBeInTheDocument();
    expect(screen.getByLabelText('Abstand bei Vollmond (°)')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Löschen' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Klonen' }));
    expect(screen.getByLabelText('Name')).toHaveValue('Kopie von Streng');
    expect(screen.getByLabelText('Abstand bei Vollmond (°)')).toBeEnabled();
    expect(screen.getByLabelText('Abstand bei Vollmond (°)')).toHaveValue(90);
  });

  it('minAlt ≥ maxAlt → Hinweis am Feld, kein Speichern', async () => {
    wrap(<MoonProfilesPage />);
    await screen.findByRole('heading', { name: 'Streng' });
    fireEvent.click(screen.getByRole('button', { name: 'Neu' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Eigen' } });
    fireEvent.change(screen.getByLabelText('Min-Höhe Mond (°)'), { target: { value: '10' } });
    expect(screen.getByText('Min-Höhe muss unter der Max-Höhe liegen.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Min-Höhe Mond (°)')).toHaveAttribute('aria-invalid', 'true'),
    );
    expect(state.create).not.toHaveBeenCalled();
  });

  it('geforderter Abstand nach moon.md §1 (Vollmond, halbe Breite, unter maxAlt)', () => {
    const strict = { A: 90, W: 8, relax: 0, minAlt: -15, maxAlt: 5 };
    expect(requiredSeparation(strict, 0, 5)).toBe(90);
    expect(requiredSeparation(strict, 8, 30)).toBe(45);
    const moderate = { A: 60, W: 5, relax: 2, minAlt: -15, maxAlt: 5 };
    // Mondhöhe 0°: f = 0,75, Ae = 60 − 2·5 = 50, We = 3,75
    expect(requiredSeparation(moderate, 0, 0)).toBe(50);
    expect(requiredSeparation(moderate, 3.75, 0)).toBe(25);
  });
});

describe('Rechte und Löschsperre', () => {
  it('User: Hinweis „Nur lesend“, kein Neu/Speichern/Löschen, Felder gesperrt', async () => {
    state.me = me('user');
    wrap(<TelescopesPage />);
    expect(await screen.findByRole('heading', { name: 'GT81' })).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('Nur lesend');
    expect(screen.queryByRole('button', { name: 'Neu' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Öffnung (mm)')).toBeDisabled();
    await expectNoSeriousA11y();
  });

  it('Löschen in Verwendung: ConfirmDialog, dann Verwenderliste statt Löschen', async () => {
    state.remove.mockRejectedValue(
      new ApiError({
        status: 409,
        code: 'resource.in_use',
        errors: [
          { path: 'rig', message: 'Starfront – GT81' },
          { path: 'exposureTemplate', message: 'LRGB' },
        ],
      }),
    );
    wrap(<TelescopesPage />);
    await screen.findByRole('heading', { name: 'GT81' });
    fireEvent.click(screen.getByRole('button', { name: 'Löschen' }));
    const dialog = await screen.findByRole('alertdialog', { name: '„GT81“ löschen?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Löschen' }));
    const notice = await screen.findByRole('alert');
    expect(notice).toHaveTextContent('„GT81“ wird noch verwendet');
    expect(within(notice).getByText('Rig: Starfront – GT81')).toBeInTheDocument();
    expect(within(notice).getByText('Belichtungsvorlage: LRGB')).toBeInTheDocument();
    expect(state.remove).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('Hilfsfunktionen', () => {
  it('Länge falsch signiert: Starfront mit +99° in America/Chicago', () => {
    expect(longitudeSuspicious(-99.38, 'America/Chicago')).toBe(false);
    expect(longitudeSuspicious(99.38, 'America/Chicago')).toBe(true);
    expect(longitudeSuspicious(9.73, 'Europe/Berlin')).toBe(false);
  });

  it('Durchlassbereich aus Zentralwellenlänge ± Bandbreite/2; ohne Angaben keiner', () => {
    expect(filterPassband({ centerWavelengthNm: 656.3, bandwidthNm: 3 })).toEqual({
      from: 654.8,
      to: 657.8,
    });
    expect(filterPassband({ centerWavelengthNm: null, bandwidthNm: 100 })).toBeNull();
  });

  it('NINA-Abgleich der Auslesemodi: ohne Meldung kein Hinweis', () => {
    expect(readoutMismatch({ ...camera, ninaReported: null } as never)).toBeNull();
    expect(
      readoutMismatch({ ...camera, ninaReported: { readoutModes: ['Default'] } } as never),
    ).toBeNull();
  });
});
