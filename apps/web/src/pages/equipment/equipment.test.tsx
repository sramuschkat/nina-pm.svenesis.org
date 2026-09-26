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
import { FiltersPage, filterPassband } from './FiltersPage';
import { labelRows, readableOn, spectrumRange, spectrumRgb } from './FilterSpectrum';
import { contrastRatio } from '../../components/FilterChip';
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

describe('S-14 Filtersammlung: Sortierung per Spaltenkopf (AP-26a)', () => {
  const filter = (n: number, shortName: string, fullName: string, bandwidthNm: number | null) => ({
    id: ID(30 + n),
    shortName,
    fullName,
    brand: '',
    filterType: 'narrowband',
    telescopeId: null,
    size: null,
    shape: null,
    mountType: null,
    bandwidthNm,
    centerWavelengthNm: null,
    photometricBand: 'none',
    transmissionPct: null,
    thicknessMm: null,
    colorHex: '#CCCCCC',
    defaultOnNewProject: false,
    defaultExposureS: null,
    defaultMoonProfileId: null,
    notes: '',
    createdAt: AT,
    updatedAt: AT,
  });

  it('Klick auf „Bandbreite“ sortiert auf- und absteigend, leere Werte zuletzt', async () => {
    state.lists = {
      ...state.lists,
      filters: [
        filter(1, 'OIII', 'Sauerstoff', 7),
        filter(2, 'Ha', 'Wasserstoff', 3),
        filter(3, 'L', 'Luminanz', null),
      ],
    };
    wrap(<FiltersPage />);
    const table = await screen.findByRole('table', { name: 'Filtersammlung' });
    const head = within(table).getByRole('columnheader', { name: /Bandbreite/ });
    const order = () =>
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((r) => within(r).getAllByRole('cell')[1]?.textContent);
    expect(order()).toEqual(['Sauerstoff', 'Wasserstoff', 'Luminanz']);
    fireEvent.click(within(head).getByRole('button'));
    expect(order()).toEqual(['Wasserstoff', 'Sauerstoff', 'Luminanz']);
    fireEvent.click(within(head).getByRole('button'));
    expect(order()).toEqual(['Sauerstoff', 'Wasserstoff', 'Luminanz']);
    expect(head).toHaveAttribute('aria-sort', 'descending');
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

describe('Listen-/Detail-Muster (AP-26b)', () => {
  const second = { ...telescope, id: ID(13), name: 'RC 8', apertureMm: 203, focalLengthMm: 1624 };

  it('Auswahl links zeigt das Detail rechts (aria-current), Suche filtert die Liste', async () => {
    state.lists = { ...state.lists, telescopes: [telescope, second] };
    wrap(<TelescopesPage />);
    expect(await screen.findByRole('heading', { level: 2, name: 'GT81' })).toBeInTheDocument();
    const list = screen.getByRole('region', { name: 'Teleskope' });
    const first = within(list).getByRole('button', { name: /^GT81/ });
    expect(first).toHaveAttribute('aria-current', 'true');
    fireEvent.click(within(list).getByRole('button', { name: /^RC 8/ }));
    expect(screen.getByRole('heading', { level: 2, name: 'RC 8' })).toBeInTheDocument();
    expect(screen.getByLabelText('Öffnung (mm)')).toHaveValue(203);
    expect(within(list).getByRole('button', { name: /^RC 8/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(first).not.toHaveAttribute('aria-current');
    fireEvent.change(within(list).getByRole('searchbox', { name: 'Teleskope durchsuchen' }), {
      target: { value: 'rc' },
    });
    expect(within(list).queryByRole('button', { name: /^GT81/ })).not.toBeInTheDocument();
    expect(within(list).getByRole('button', { name: /^RC 8/ })).toBeInTheDocument();
  });

  it('ohne Auswahl Leerzustand; *Neu* rechts im Seitenkopf öffnet das leere Formular', async () => {
    state.lists = { ...state.lists, telescopes: [] };
    wrap(<TelescopesPage />);
    expect(
      await screen.findByText('Wähle links einen Eintrag oder lege einen neuen an.'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Öffnung (mm)')).not.toBeInTheDocument();
    const head = screen.getByRole('heading', { level: 1, name: 'Teleskope' }).parentElement;
    fireEvent.click(within(head as HTMLElement).getByRole('button', { name: 'Neu' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Neues Teleskop' })).toBeInTheDocument();
    expect(screen.getByLabelText('Öffnung (mm)')).toHaveValue(null);
    expect(screen.queryByText('Wähle links einen Eintrag oder lege einen neuen an.')).toBeNull();
    await expectNoSeriousA11y();
  });

  it('nach dem Löschen wieder Leerzustand', async () => {
    state.remove.mockResolvedValue(undefined);
    wrap(<TelescopesPage />);
    await screen.findByRole('heading', { level: 2, name: 'GT81' });
    fireEvent.click(screen.getByRole('button', { name: 'Löschen' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Löschen' }));
    expect(
      await screen.findByText('Wähle links einen Eintrag oder lege einen neuen an.'),
    ).toBeInTheDocument();
  });

  it('User ohne Auswahl: Leerzustand ohne Aufforderung zum Anlegen', async () => {
    state.me = me('user');
    state.lists = { ...state.lists, cameras: [] };
    wrap(<CamerasPage />);
    expect(await screen.findByText('Wähle links einen Eintrag.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Neu' })).not.toBeInTheDocument();
  });

  it('Filter: Kurzname in der Sammlung wählt den Filter rechts; Vorlagen ohne Auswahl leer', async () => {
    const ha = {
      id: ID(40),
      shortName: 'Ha',
      fullName: 'Wasserstoff',
      brand: '',
      filterType: 'narrowband',
      telescopeId: null,
      size: null,
      shape: null,
      mountType: null,
      bandwidthNm: 3,
      centerWavelengthNm: 656.3,
      photometricBand: 'none',
      transmissionPct: null,
      thicknessMm: null,
      colorHex: '#CC0000',
      defaultOnNewProject: false,
      defaultExposureS: null,
      defaultMoonProfileId: null,
      notes: '',
      createdAt: AT,
      updatedAt: AT,
    };
    const oiii = { ...ha, id: ID(41), shortName: 'OIII', fullName: 'Sauerstoff' };
    state.lists = { ...state.lists, filters: [ha, oiii] };
    wrap(<FiltersPage />);
    const table = await screen.findByRole('table', { name: 'Filtersammlung' });
    expect(screen.getByRole('heading', { level: 2, name: 'Ha' })).toBeInTheDocument();
    fireEvent.click(within(table).getByRole('button', { name: /OIII/ }));
    expect(screen.getByRole('heading', { level: 2, name: 'OIII' })).toBeInTheDocument();
    expect(screen.getByLabelText('Langname')).toHaveValue('Sauerstoff');
    expect(within(table).getByRole('button', { name: /OIII/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    const templates = screen.getByRole('region', { name: 'Belichtungsplan-Vorlagen' });
    expect(within(templates).getByText('Noch keine Vorlage angelegt.')).toBeInTheDocument();
    expect(
      within(templates).getByText('Wähle links einen Eintrag oder lege einen neuen an.'),
    ).toBeInTheDocument();
    fireEvent.click(within(templates).getByRole('button', { name: 'Neue Vorlage' }));
    expect(within(templates).getByRole('form', { name: 'Vorlage bearbeiten' })).toBeInTheDocument();
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

  it('Spektrum: Bereich 380–750 nm, von IR-Filtern erweitert; Spektralfarben; Beschriftungszeilen', () => {
    expect(spectrumRange([{ from: 654, to: 658 }])).toEqual({ from: 380, to: 750 });
    expect(spectrumRange([{ from: 685, to: 1000 }])).toEqual({ from: 380, to: 1000 });
    expect(spectrumRgb(700)).toEqual([255, 0, 0]);
    expect(spectrumRgb(300)).toEqual(spectrumRgb(380)); // UV: Randfarbe
    // OIII allein, Hα und SII überlappen → SII in die zweite Zeile (wie in Svens Vorlage)
    const rows = labelRows([
      { id: 'oiii', center: 300, width: 170 },
      { id: 'ha', center: 760, width: 170 },
      { id: 'sii', center: 800, width: 170 },
    ]);
    expect(Object.fromEntries(rows)).toEqual({ oiii: 0, ha: 0, sii: 1 });
  });

  it('Beschriftung in Filterfarbe mit mindestens 4,5:1 auf hellem und dunklem Grund', () => {
    for (const color of ['#ffeb3b', '#00bcd4', '#e53935', '#ffffff']) {
      expect(contrastRatio(readableOn(color, '#ffffff'), '#ffffff')).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(readableOn(color, '#1a2a3a'), '#1a2a3a')).toBeGreaterThanOrEqual(4.5);
    }
    expect(readableOn('#b3261e', '#ffffff')).toBe('#b3261e'); // genügt schon
  });

  it('NINA-Abgleich der Auslesemodi: ohne Meldung kein Hinweis', () => {
    expect(readoutMismatch({ ...camera, ninaReported: null } as never)).toBeNull();
    expect(
      readoutMismatch({ ...camera, ninaReported: { readoutModes: ['Default'] } } as never),
    ).toBeNull();
  });
});
