// @vitest-environment jsdom
/**
 * S-22 Exoplaneten (AP-42): Filter (FA-EXO-05), Recherche-Links (FA-EXO-09), Lichtkurve und Himmelsposition,
 * Seite mit Tabelle, Auswahl, Zeitleiste und gespeicherten Filtern; A11y ohne ernste Verstöße.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { ExoTransitList, ExoTransitView, Me } from '../../api/client';
import { AuthProvider } from '../../auth';
import { ExoplanetsPage } from './ExoplanetsPage';
import { ExoTransitTab } from './ExoTransitTab';
import { ExposureCard } from './ExposureCard';
import {
  applyExoFilters,
  flatFraction,
  transitFlux,
  EXO_SEARCH_DEFAULTS,
  paramsFromUrl,
  researchLinks,
  urlFromParams,
} from './model';
import { projector } from './SkyPosition';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const state = vi.hoisted(() => ({
  me: null as unknown,
  prefs: {} as Record<string, unknown>,
  list: null as unknown,
  queries: [] as unknown[],
  saved: vi.fn(),
  created: [] as unknown[],
  exoProject: null as unknown,
  refreshed: 0,
  locked: [] as number[],
  unlocked: [] as string[],
  patched: [] as unknown[],
  observation: null as unknown,
}));

vi.mock('../planning/skymap/sky-data', () => ({
  unit: (ra: number, dec: number) => {
    const r = (d: number) => (d * Math.PI) / 180;
    return [
      Math.cos(r(dec)) * Math.cos(r(ra)),
      Math.cos(r(dec)) * Math.sin(r(ra)),
      Math.sin(r(dec)),
    ];
  },
  loadBrightSky: () =>
    Promise.resolve({
      stars: { count: 0, vec: new Float64Array(0), mag: new Float32Array(0) },
      lines: [],
      bounds: [],
      labels: [],
      milkyWay: { w: 0, h: 0, step: 0, cells: new Uint8Array(0) },
    }),
}));

vi.mock('../../api/client', () => ({
  api: {
    me: () => Promise.resolve(state.me),
    preferences: () => Promise.resolve(state.prefs),
    setPreference: (key: string, value: unknown) => {
      state.saved(key, value);
      return Promise.resolve(undefined);
    },
  },
  equipmentApi: {
    list: (kind: string) =>
      Promise.resolve({
        items:
          kind === 'rigs'
            ? [
                {
                  id: ID(500),
                  name: 'Starfront GT81',
                  siteId: ID(600),
                  telescopeId: ID(601),
                  cameraId: ID(602),
                  showInPlanning: true,
                  derived: { scaleArcsecPx: 1.62, fovWidthDeg: 1.6, fovHeightDeg: 1.6 },
                },
              ]
            : kind === 'sites'
              ? [
                  {
                    id: ID(600),
                    name: 'Starfront',
                    timeZone: 'America/Chicago',
                    latitudeDeg: 31.5471,
                    longitudeDeg: -99.3823,
                  },
                ]
              : [],
      }),
    weather: () =>
      Promise.resolve({
        nights: [{ night: '2026-10-10', ratingIndex: 3, nightMean: 80 }],
        hours: [],
      }),
    nights: () =>
      Promise.resolve({
        currentNight: '2026-10-10',
        timeZoneTransitions: [
          { atUtc: '2026-03-08T08:00:00Z', utcOffsetMinutes: -300 },
          { atUtc: '2026-11-01T07:00:00Z', utcOffsetMinutes: -360 },
        ],
      }),
  },
  exoApi: {
    transits: (q: unknown) => {
      state.queries.push(q);
      return Promise.resolve(state.list);
    },
    createProject: (body: unknown) => {
      state.created.push(body);
      return Promise.resolve({
        projectId: '00000000-0000-4000-8000-000000000800',
        created: true,
      });
    },
    project: () => Promise.resolve(state.exoProject),
    lock: (_id: string, epoch: number) => {
      state.locked.push(epoch);
      const d = state.exoProject as { upcoming: Record<string, unknown>[] };
      state.exoProject = {
        ...d,
        observations: [state.observation],
        openCount: 1,
        upcoming: d.upcoming.map((u) => ({ ...u, observationId: ID(830) })),
      };
      return Promise.resolve(state.exoProject);
    },
    unlock: (_id: string, observationId: string) => {
      state.unlocked.push(observationId);
      const d = state.exoProject as Record<string, unknown>;
      state.exoProject = {
        ...d,
        observations: [{ ...(state.observation as object), status: 'cancelled' }],
        openCount: 0,
      };
      return Promise.resolve(state.exoProject);
    },
    patch: (_id: string, body: Record<string, unknown>) => {
      state.patched.push(body);
      state.exoProject = { ...(state.exoProject as object), ...body };
      return Promise.resolve(state.exoProject);
    },
    refreshEphemeris: () => {
      state.refreshed += 1;
      const d = state.exoProject as { ephemeris: unknown; catalogUpdate: unknown };
      state.exoProject = { ...d, catalogUpdate: null, history: [d.ephemeris] };
      return Promise.resolve(state.exoProject);
    },
  },
}));

const me: Me = {
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
  member: { id: ID(92), displayName: 'Uta', role: 'owner', effectiveRole: 'admin' },
  isSuperUser: false,
  mfaRequired: false,
  memberships: [{ tenantKey: 'demo', tenantName: 'Demo', role: 'owner' }],
};

function transit(over: Partial<ExoTransitView> & { tc?: string } = {}): ExoTransitView {
  const tc = over.tc ?? '2026-10-11T06:45:26Z';
  const at = (min: number) =>
    new Date(Date.parse(tc) + min * 60_000).toISOString().replace('.000Z', 'Z');
  const base: ExoTransitView = {
    key: `exoclock:HAT-P-17b:${tc}`,
    planet: 'HAT-P-17b',
    star: 'HAT-P-17',
    catalog: 'exoclock',
    alsoIn: ['nasa'],
    disposition: null,
    priority: 'medium',
    ticId: '266593143',
    raDeg: 324.536,
    decDeg: 30.489,
    sizeClass: 'gas_giant',
    radiusRe: 11.77,
    distancePc: 92.4,
    teffK: 5246,
    spectralClass: 'G',
    mag: 10.38,
    magBand: 'V',
    depthMmag: 20.37,
    depthEstimated: false,
    durationH: 4.04,
    durationEstimated: false,
    periodD: 10.33853486,
    rpOverRs: 0.1238,
    aOverRs: 22.6,
    inclinationDeg: 89.2,
    ocMin: 1,
    timeSystemSource: 'bjd_tdb',
    t0BjdTdb: 2457168.694753,
    fetchedAt: '2026-09-30T03:00:00Z',
    transit: {
      n: 180,
      tcBjdTdb: 2461324.8,
      tcUtc: tc,
      ingressUtc: at(-121),
      egressUtc: at(121),
      windowStartUtc: at(-246),
      windowEndUtc: at(246),
      sigmaS: 60,
      bufferS: 300,
      baselineBeforeMin: 120,
      baselineAfterMin: 120,
      ocAppliedMin: null,
      timeSystemUncertain: false,
      ephemerisAge: 'ok',
      observable: true,
      usableFraction: 0.61,
      fullyObservable: false,
      startDark: true,
      endDark: false,
      startAboveMinAlt: true,
      endAboveMinAlt: true,
      baselineInTwilight: false,
      meridianUtc: '2026-10-11T01:30:00Z',
      meridianInWindow: false,
      meridianNearTransit: false,
      altAtIngressDeg: 58,
      altAtCenterDeg: 41.7,
      altAtEgressDeg: 22,
      moonSepDeg: 80,
      moonIllumPct: 2,
    },
    aperture: { requiredMm: 127, estimated: false, fit: 'insufficient' },
    filter: {
      band: 'Rc',
      choice: { filterId: ID(700), shortName: 'RED', match: 'substitute' },
    },
    exposure: {
      status: 'ok',
      exposureS: 30,
      fwhmArcsec: 5.5,
      peakPct: 50,
      framesInWindow: 596,
      precisionMmag: 6.1,
      transitSnr: 12.7,
      filterShortName: 'RED',
      filterConfirmed: true,
      gain: 100,
      defocus: true,
      limitedBy: 'defocus',
      inFocus: {
        exposureS: 7.5,
        fwhmArcsec: 3,
        peakPct: 48,
        framesInWindow: 1400,
        precisionMmag: 11.2,
        transitSnr: 11.4,
      },
      skyMagArcsec2: 20.7,
      bortle: 2,
      airmass: 1.5,
    },
    myProjects: 0,
  };
  const rest: Partial<ExoTransitView> & { tc?: string } = { ...over };
  delete rest.tc;
  return { ...base, ...rest, transit: { ...base.transit, ...(over.transit ?? {}) } };
}

const wasp = transit({
  key: 'exoclock:WASP-12b:1',
  planet: 'WASP-12b',
  star: 'WASP-12',
  alsoIn: [],
  priority: 'high',
  mag: 11.6,
  depthMmag: 17.8,
  tc: '2026-10-11T02:33:00Z',
  exposure: { status: 'missing', missing: ['camera_noise', 'camera_saturation'] },
});
const faint = transit({
  key: 'toi:TOI-7711.01:1',
  planet: 'TOI-7711.01',
  star: 'TIC 1309019',
  catalog: 'toi',
  alsoIn: [],
  disposition: 'CP',
  priority: null,
  mag: 13.8,
  depthMmag: 2.5,
  tc: '2026-10-11T04:00:00Z',
});
const unobservable = transit({
  key: 'exoclock:TrES-3b:1',
  planet: 'TrES-3b',
  tc: '2026-10-10T17:16:00Z',
  transit: {
    ...transit().transit,
    observable: false,
    meridianInWindow: true,
    meridianNearTransit: true,
  },
});

const list = (items: ExoTransitView[]): ExoTransitList => ({
  rig: { id: ID(500), name: 'Starfront GT81', apertureMm: 81 },
  site: {
    id: ID(600),
    name: 'Starfront',
    timeZone: 'America/Chicago',
    latDeg: 31.5471,
    lonDeg: -99.3823,
  },
  night: '2026-10-10',
  currentNight: '2026-10-10',
  nightStartUtc: '2026-10-10T23:00:00Z',
  nightEndUtc: '2026-10-11T12:30:00Z',
  minAltDeg: 30,
  twilight: 'nautical',
  catalogs: [
    { catalog: 'exoclock', rows: 776, fetchedAt: '2026-09-30T03:00:00Z' },
    { catalog: 'nasa', rows: 702, fetchedAt: '2026-09-27T04:30:00Z' },
    { catalog: 'toi', rows: 0, fetchedAt: null },
  ],
  items,
});

beforeEach(() => {
  state.me = me;
  state.prefs = {};
  state.list = list([transit(), wasp, faint, unobservable]);
  state.queries = [];
  state.saved.mockReset();
});

describe('Filter der Transitsuche (FA-EXO-05)', () => {
  const all = [transit(), wasp, faint, unobservable];
  it('Vorgaben: beobachtbar, ≤ 14 mag, ≥ 3 mmag', () => {
    expect(applyExoFilters(all, EXO_SEARCH_DEFAULTS).map((x) => x.planet)).toEqual([
      'HAT-P-17b',
      'WASP-12b',
    ]);
  });
  it('Priorität „High und höher“ lässt Planeten ohne ExoClock-Priorität weg', () => {
    const s = { ...EXO_SEARCH_DEFAULTS, priority: 'high' as const, minDepthMmag: 0 };
    expect(applyExoFilters(all, s).map((x) => x.planet)).toEqual(['WASP-12b']);
  });
  it('Start/Ende dunkel, Flip ausblenden, alle anzeigen', () => {
    const off = { ...EXO_SEARCH_DEFAULTS, observableOnly: false, minDepthMmag: 0 };
    expect(applyExoFilters(all, off)).toHaveLength(4);
    expect(applyExoFilters(all, { ...off, hideFlip: true }).map((x) => x.planet)).not.toContain(
      'TrES-3b',
    );
    expect(applyExoFilters(all, { ...off, startEndDark: true })).toHaveLength(0);
    // Flip nur in der Baseline (im Fenster, nicht im Transit): bleibt sichtbar und wird nur markiert
    const baselineFlip = transit({
      key: 'x:baseline-flip:1',
      planet: 'Baseline-Flip',
      transit: { ...transit().transit, meridianInWindow: true, meridianNearTransit: false },
    });
    expect(applyExoFilters([baselineFlip], { ...off, hideFlip: true })).toHaveLength(1);
  });
});

describe('Recherche-Links, URL, Lichtkurve, Himmelsposition', () => {
  it('ExoClock + NASA + SIMBAD; TOI mit ExoFOP über die TIC', () => {
    expect(researchLinks(transit()).map((l) => l.name)).toEqual(['NASA', 'ExoClock', 'SIMBAD']);
    const toi = researchLinks({ ...faint, ticId: '1309019' });
    expect(toi[0]).toEqual({
      name: 'ExoFOP',
      href: 'https://exofop.ipac.caltech.edu/tess/target.php?id=1309019',
    });
  });

  it('URL: Rig, Nacht und Auswahl hin und zurück', () => {
    const u = { rig: ID(1), night: '2026-10-10' };
    expect(urlFromParams(paramsFromUrl(u))).toEqual(u);
    expect(urlFromParams(new URLSearchParams('night=kaputt')).night).toBe('');
  });

  it('flacher Boden bei HAT-P-17 b, fast streifend bei TrES-3 b, V-Form bei b > 1 − k, Trapez ohne Geometrie', () => {
    expect(flatFraction(0.1238, 22.6, 89.2)).toBeGreaterThan(0.7);
    // TrES-3 b (ExoClock): b = 0,835 < 1 − k = 0,837 → nur 7 % flacher Boden
    expect(flatFraction(0.163, 6.0, 82.0)).toBeCloseTo(0.071, 3);
    expect(flatFraction(0.16, 6.0, 81.0)).toBe(0);
    expect(flatFraction(null, null, null)).toBe(0.8);
  });

  it('Lichtkurve: 0 außerhalb, Boden = Tiefe als Anteil, Stützpunkte an den Kontakten', () => {
    const f = transitFlux(transit());
    expect(f[0]).toEqual({ atUtc: Date.parse(transit().transit.ingressUtc) / 1000, rel: 0 });
    expect(f.at(-1)?.rel).toBe(0);
    expect(Math.min(...f.map((p) => p.rel))).toBeCloseTo(-(1 - 10 ** (-20.37 / 2500)), 9);
    // streifend: V-Form mit drei Punkten
    expect(transitFlux(transit({ rpOverRs: 0.16, aOverRs: 6, inclinationDeg: 81 }))).toHaveLength(
      3,
    );
  });

  it('Himmelsposition: Mitte in der Bildmitte, Osten links; 30° bis zur Kante, über 42° unsichtbar', () => {
    const p = projector(100, 20);
    const unit = (ra: number, dec: number) => {
      const r = (d: number) => (d * Math.PI) / 180;
      return [
        Math.cos(r(dec)) * Math.cos(r(ra)),
        Math.cos(r(dec)) * Math.sin(r(ra)),
        Math.sin(r(dec)),
      ] as const;
    };
    const mid = p(unit(100, 20));
    expect(mid?.[0]).toBeCloseTo(120, 9);
    expect(mid?.[1]).toBeCloseTo(120, 9);
    const east = p(unit(110, 20));
    expect(east?.[0]).toBeLessThan(120);
    // 30° nördlich liegt auf der oberen Kante, 40° außerhalb des Quadrats (abgeschnitten), 46° gar nicht.
    expect(p(unit(100, 50))?.[1]).toBeCloseTo(0, 6);
    expect(p(unit(100, 60))?.[1]).toBeLessThan(0);
    expect(p(unit(100, 66))).toBeNull();
  });
});

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

const renderPage = (path = '/planung/exoplaneten') =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <Routes>
            <Route
              path="/planung/exoplaneten"
              element={
                <>
                  <ExoplanetsPage />
                  <Where />
                </>
              }
            />
            <Route path="/projekte/:id" element={<Where />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('Belichtungskarte (transit.md §6)', () => {
  it('Filter eines unbestätigten Platzes: Empfehlung vorläufig mit Hinweis', () => {
    const base = transit().exposure;
    if (base.status !== 'ok') throw new Error('Fixture');
    render(
      <ExposureCard
        exposure={{ ...base, filterConfirmed: false, defocus: false, inFocus: null }}
        star="HAT-P-17"
      />,
    );
    expect(
      screen.getByText(/Vorläufig: RED ist im Filterrad noch nicht bestätigt/),
    ).toBeInTheDocument();
    expect(screen.getByText('30 s')).toBeInTheDocument();
  });
});

const ephemeris = {
  id: ID(810),
  t0BjdTdb: 2457168.694753,
  t0SigmaD: 0.000052,
  periodD: 10.33853486,
  periodSigmaD: 4e-7,
  durationH: 4.04,
  durationEstimated: false,
  timeSystemSource: 'bjd_tdb',
  ocMin: 1,
  depthMmag: 20.37,
  rpOverRs: 0.1238,
  source: 'exoclock',
  sourceDate: '2026-09-30',
  active: true,
  createdAt: '2026-09-30T10:00:00Z',
};
const exoDetail = () => ({
  projectId: ID(800),
  planet: 'HAT-P-17b',
  star: 'HAT-P-17',
  catalog: 'exoclock',
  baselineBeforeMin: 60,
  baselineAfterMin: 60,
  bufferSigma: 1,
  ephemeris,
  history: [],
  catalogUpdate: {
    catalog: 'exoclock',
    t0BjdTdb: 2457168.696142,
    t0SigmaD: 0.00005,
    periodD: 10.33853486,
    periodSigmaD: 4e-7,
    fetchedAt: '2026-10-01T03:00:00Z',
    periodDeltaS: 0,
    nextMidUtc: '2026-10-11T06:47:26Z',
    nextMidShiftMin: 2,
  },
  others: [{ projectId: ID(820), name: 'HAT-P-17b', createdByName: 'Bea', rigName: 'Rig B' }],
  rig: { id: ID(500), name: 'Starfront GT81', apertureMm: 81 },
  site: {
    id: ID(600),
    name: 'Starfront',
    timeZone: 'America/Chicago',
    latDeg: 31.5471,
    lonDeg: -99.3823,
  },
  minAltDeg: 30,
  twilight: 'nautical',
  fromNight: '2026-09-30',
  nights: 60,
  upcoming: [
    {
      night: '2026-10-10',
      item: transit(),
      deadlineUtc: '2026-10-11T02:23:26Z',
      conflict: null,
      observationId: null,
    },
  ],
  observations: [] as unknown[],
  allowAutofocus: false,
  allowRecenter: true,
  defocusHint: null,
  lockMode: 'wish',
  lockBlockedReason: null,
  openCount: 0,
  maxOpen: 3,
  suggestedEpoch: 180,
});

const observation = {
  id: ID(830),
  status: 'requested',
  epoch: 180,
  night: '2026-10-10',
  ingressUtc: '2026-10-11T04:44:26Z',
  midUtc: '2026-10-11T06:45:26Z',
  egressUtc: '2026-10-11T08:46:26Z',
  windowStartUtc: '2026-10-11T02:39:26Z',
  windowEndUtc: '2099-10-11T10:51:26Z',
  baselineBeforeMin: 60,
  baselineAfterMin: 60,
  bufferMin: 5,
  confirmDeadlineUtc: '2026-10-11T02:21:26Z',
  lockedAt: null,
  lockedByName: null,
  plannedCount: 350,
  acquiredCount: 0,
  sessionId: null,
  primaryObservationId: null,
  createdAt: '2026-09-30T10:00:00Z',
};

const renderTab = (canUpdate = true) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <ExoTransitTab projectId={ID(800)} canUpdate={canUpdate} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('Reiter Exoplanet-Transit (FA-EXO-15…17)', () => {
  beforeEach(() => {
    state.exoProject = exoDetail();
    state.observation = observation;
    state.refreshed = 0;
    state.locked = [];
    state.unlocked = [];
    state.patched = [];
  });

  it('Wünschen, Beobachtung mit Frist, Aufheben mit Bestätigung, Einstellungen (AP-43)', async () => {
    renderTab();
    const obs = await screen.findByRole('region', { name: 'Beobachtungen' });
    expect(
      within(obs).getByText('Noch keine Transits gewünscht oder festgelegt.'),
    ).toBeInTheDocument();
    const up = screen.getByRole('region', { name: 'Kommende beobachtbare Transits' });
    expect(within(up).getByText('Vorschlag: nächster beobachtbarer Transit')).toBeInTheDocument();
    expect(await within(up).findByText('Gut')).toBeInTheDocument();
    fireEvent.click(
      within(up).getByRole('button', { name: 'Wünschen: Transit der Nacht 10./11.10.' }),
    );
    await waitFor(() => expect(state.locked).toEqual([180]));
    expect(await within(obs).findByText('Gewünscht')).toBeInTheDocument();
    fireEvent.click(
      within(obs).getByRole('button', { name: 'Transit der Nacht 10./11.10. aufheben' }),
    );
    const dialog = await screen.findByRole('alertdialog', { name: 'Transit aufheben?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Aufheben' }));
    await waitFor(() => expect(state.unlocked).toEqual([ID(830)]));
    fireEvent.click(screen.getByText('Transit-Einstellungen'));
    fireEvent.change(screen.getByLabelText('Baseline vor Ingress (min)'), {
      target: { value: '30' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Einstellungen speichern' }));
    await waitFor(() => expect(state.patched[0]).toMatchObject({ baselineBeforeMin: 30 }));
    await expectNoSeriousA11y();
  });

  it('Belegung verhindert Festlegen; nach der Freigabe ohne festgelegten Transit nicht planbar', async () => {
    const d = exoDetail();
    state.exoProject = {
      ...d,
      lockMode: 'request',
      upcoming: d.upcoming.map((u) => ({
        ...u,
        conflict: {
          kind: 'overlap',
          projectId: ID(840),
          projectName: 'WASP-12b',
          createdByName: 'Bea',
          windowStartUtc: '2026-10-11T02:00:00Z',
          windowEndUtc: '2026-10-11T08:00:00Z',
        },
      })),
    };
    renderTab();
    const up = await screen.findByRole('region', { name: 'Kommende beobachtbare Transits' });
    expect(within(up).getByText('Belegt: WASP-12b (Bea)')).toBeInTheDocument();
    expect(
      within(up).getByRole('button', { name: 'Zur Bestätigung: Transit der Nacht 10./11.10.' }),
    ).toBeDisabled();
    expect(
      screen.getByText('Ohne festgelegten Transit ist das Projekt nicht planbar.'),
    ).toBeInTheDocument();
  });

  it('Ephemeride, Angebot mit Übernahme, Historie, fremde Projekte, kommende Transits', async () => {
    renderTab();
    const eph = await screen.findByRole('region', { name: 'Ephemeride' });
    expect(eph).toHaveTextContent('P = 10,3385349 ± 0,00000040 d');
    expect(eph).toHaveTextContent('Quelle ExoClock');
    expect(within(eph).getByRole('status')).toHaveTextContent(
      'nächste Mitte 11.10.2026 01:47 CDT (+2,0 min gegenüber der gespeicherten Ephemeride)',
    );
    expect(within(eph).getByRole('link', { name: 'HAT-P-17b' })).toHaveAttribute(
      'href',
      `/projekte/${ID(820)}`,
    );
    expect(eph).toHaveTextContent('(von Bea, Rig B)');
    fireEvent.click(within(eph).getByRole('button', { name: 'Ephemeride übernehmen' }));
    await waitFor(() => expect(state.refreshed).toBe(1));
    expect(await within(eph).findByText('Frühere Ephemeriden (1)')).toBeInTheDocument();
    expect(within(eph).queryByRole('status')).toBeNull();

    const up = screen.getByRole('region', { name: 'Kommende beobachtbare Transits' });
    expect(up).toHaveTextContent(
      '60 Nächte · Starfront GT81 · Mindesthöhe 30° · Nautische Dämmerung',
    );
    expect(within(up).getAllByRole('row')).toHaveLength(2);
    expect(up).toHaveTextContent('10./11.10.');
    await expectNoSeriousA11y();
  });

  it('ohne Recht kein Übernehmen, ohne Rig keine Vorhersage', async () => {
    state.exoProject = { ...exoDetail(), rig: null, site: null, upcoming: [] };
    renderTab(false);
    await screen.findByRole('region', { name: 'Ephemeride' });
    expect(screen.queryByRole('button', { name: 'Ephemeride übernehmen' })).toBeNull();
    expect(
      screen.getByText('Übernehmen kann der Ersteller im Entwurf bzw. ein Admin.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Ohne Rig keine Vorhersage – bitte ein Rig wählen.'),
    ).toBeInTheDocument();
  });
});

describe('S-22 Seite', () => {
  it('Rig, laufende Nacht, Trefferzahl, Standard nach Transitmitte', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: '2 Transits' })).toBeInTheDocument();
    expect(state.queries[0]).toMatchObject({
      rigId: ID(500),
      night: '2026-10-10',
      catalogs: ['exoclock'],
      minAltDeg: 30,
    });
    const table = screen.getByRole('table', { name: 'Exoplaneten' });
    const rows = within(table).getAllByRole('row').slice(1);
    // WASP-12 b (02:33Z) vor HAT-P-17 b (06:45Z)
    expect(rows[0]).toHaveTextContent('WASP-12b');
    expect(screen.getByText(/Katalogstand: ExoClock/)).toBeInTheDocument();
  });

  it('Projekt (FA-EXO-15): legt mit Suchfilter und Belichtung an und öffnet den Editor', async () => {
    state.created = [];
    renderPage();
    await screen.findByRole('heading', { name: '2 Transits' });
    fireEvent.click(
      screen.getByRole('button', { name: 'Exoplaneten-Projekt für HAT-P-17b anlegen bzw. öffnen' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(
        '/projekte/00000000-0000-4000-8000-000000000800',
      ),
    );
    expect(state.created[0]).toMatchObject({
      rigId: ID(500),
      catalog: 'exoclock',
      planet: 'HAT-P-17b',
      twilight: 'nautical',
      minAltDeg: 30,
      exposureS: 30,
    });
  });

  it('Zeile aufklappen: Zeitleiste, Sternfeld, Himmelsposition, Zieldetails inline', async () => {
    renderPage();
    await screen.findByRole('heading', { name: '2 Transits' });
    fireEvent.click(screen.getByRole('button', { name: 'Weitere Angaben zu HAT-P-17b' }));
    const timeline = await screen.findByRole('region', {
      name: 'HAT-P-17b – Nacht und Transit',
    });
    expect(timeline).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Sternfeld (DSS2) – HAT-P-17' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Himmelsposition – HAT-P-17' })).toBeInTheDocument();
    expect(screen.getByText(/RED als Ersatzfilter/)).toBeInTheDocument();
    expect(screen.getByText('(TIC 266593143)')).toBeInTheDocument();
    // Erklärung je Größe als Hilfe-Tooltip (FA-EXO-13): bei Fokus sichtbar, Escape schließt
    const help = screen.getByRole('button', { name: 'Erklärung: Tiefe' });
    expect(help).toHaveAccessibleDescription(/Helligkeitsabfall während des Transits/);
    fireEvent.focus(help);
    expect(screen.getByRole('tooltip')).toHaveTextContent(/Helligkeitsabfall/);
    fireEvent.keyDown(help, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    // Belichtung (FA-EXO-14a): Empfehlung mit Defokus und Variante im Fokus
    const exposure = screen.getByRole('region', { name: 'Belichtung – HAT-P-17' });
    expect(within(exposure).getByText('Belichtung · RED · Gain 100')).toBeInTheDocument();
    expect(within(exposure).getByText('30 s')).toBeInTheDocument();
    expect(within(exposure).getByText('Leicht defokussieren auf ≈ 5,5″ FWHM')).toBeInTheDocument();
    expect(within(exposure).getByText('≈ 12,7 σ (gut)')).toBeInTheDocument();
    expect(within(exposure).getByText('Ohne Defokus (im Fokus, 3″)')).toBeInTheDocument();
    expect(within(exposure).queryByText(/Vorläufig/)).toBeNull();
    expect(
      within(exposure).getByText('7,5 s · ≈ 1.400 Aufnahmen · 11,2 mmag · Transit ≈ 11,4 σ'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'In Framing öffnen' })).toHaveAttribute(
      'href',
      expect.stringContaining('/planung/sternkarte'),
    );
  });

  it('gespeicherte Filter gelten; Änderung wird je Benutzer gespeichert', async () => {
    state.prefs = {
      'exo.search': { ...EXO_SEARCH_DEFAULTS, observableOnly: false, minDepthMmag: 0 },
    };
    renderPage();
    expect(await screen.findByRole('heading', { name: '4 Transits' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'NASA' }));
    await waitFor(() => expect(state.saved).toHaveBeenCalled(), { timeout: 2000 });
    expect(state.saved.mock.calls.at(-1)?.[0]).toBe('exo.search');
    expect((state.saved.mock.calls.at(-1)?.[1] as { catalogs: string[] }).catalogs).toEqual([
      'exoclock',
      'nasa',
    ]);
    await waitFor(() =>
      expect(state.queries.at(-1)).toMatchObject({ catalogs: ['exoclock', 'nasa'] }),
    );
  });

  it('leer und barrierefrei', async () => {
    state.list = list([]);
    renderPage('/planung/exoplaneten?night=2026-10-12');
    expect(
      await screen.findByText('Keine Transits für diese Nacht und diese Filter.'),
    ).toBeInTheDocument();
    await expectNoSeriousA11y();
  });

  it('mit aufgeklappter Zeile barrierefrei', async () => {
    renderPage();
    await screen.findByRole('heading', { name: '2 Transits' });
    fireEvent.click(screen.getByRole('button', { name: 'Weitere Angaben zu WASP-12b' }));
    await screen.findByRole('region', { name: 'WASP-12b – Nacht und Transit' });
    expect(
      screen.getByText(
        'Keine Empfehlung – es fehlen: Ausleserauschen der Kamera, Full Well oder e⁻/ADU der Kamera.',
      ),
    ).toBeInTheDocument();
    await expectNoSeriousA11y();
  });
});
