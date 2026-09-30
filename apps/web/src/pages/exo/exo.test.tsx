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

  it('Himmelsposition: Mitte in der Bildmitte, Osten links, außerhalb 30° unsichtbar', () => {
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
    expect(p(unit(100, 60))).toBeNull();
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
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('S-22 Seite', () => {
  it('Rig, laufende Nacht, Trefferzahl, Standard nach Transitmitte; Projekt gesperrt', async () => {
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
    // *Projekt* (FA-EXO-15) folgt im zweiten Teil: je Zeile sichtbar, aber gesperrt.
    for (const b of screen.getAllByRole('button', { name: 'Projekt', hidden: true }))
      expect(b).toBeDisabled();
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
