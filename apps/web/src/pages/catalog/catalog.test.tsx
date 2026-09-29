// @vitest-environment jsdom
/**
 * AP-20: S-21 Objektbrowser (Filter ↔ URL, Anfrage an `/web/v1/dso`, Helligkeit mit Band, Anzeigegruppe
 * mit OpenNGC-Code, Nachtwerte in Standortzeit, Liste/Galerie, *Projekt anlegen*, Seiten, Leer/Fehler),
 * Katalogsuche im Editor (Combobox, Tastatur) und S-82 Kataloge (Stand, *Neu importieren*); axe.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { CatalogStatus, DsoList, DsoSearch, DsoView, Me } from '../../api/client';
import { AuthProvider } from '../../auth';
import { applyCatalogPick, emptyDraft } from '../projects/model';
import { DEFAULT_CONDITIONS } from '@nina-pm/shared';
import { CatalogPanel } from '../system/CatalogPanel';
import { CatalogSearch } from './CatalogSearch';
import {
  aliasesOf,
  effectiveSort,
  filtersFromParams,
  fovArcmin,
  paramsFromFilters,
  searchFromFilters,
} from './model';
import { ObjectBrowserPage } from './ObjectBrowserPage';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const state = vi.hoisted(() => ({
  me: null as unknown,
  rigs: [] as unknown[],
  searches: [] as unknown[],
  result: null as unknown,
  fail: false,
  status: null as unknown,
  refresh: vi.fn(),
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
              ? state.rigs
              : kind === 'sites'
                ? [
                    {
                      id: ID(600),
                      name: 'Texas',
                      timeZone: 'America/Chicago',
                      latitudeDeg: 31.5471,
                      longitudeDeg: -99.3823,
                    },
                  ]
                : [],
        }),
      nights: () =>
        Promise.resolve({
          currentNight: '2026-10-20',
          timeZoneTransitions: [
            { atUtc: '2026-03-08T08:00:00Z', utcOffsetMinutes: -300 },
            { atUtc: '2026-11-01T07:00:00Z', utcOffsetMinutes: -360 },
          ],
        }),
    },
    catalogApi: {
      search: (s: DsoSearch) => {
        state.searches.push(s);
        return state.fail
          ? Promise.reject(new Error('kaputt'))
          : Promise.resolve(
              typeof state.result === 'function'
                ? (state.result as (x: DsoSearch) => DsoList)(s)
                : state.result,
            );
      },
      status: () => Promise.resolve(state.status),
      refresh: (catalog?: string) =>
        (catalog === undefined ? state.refresh() : state.refresh(catalog)) as Promise<unknown>,
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

const m31 = (over: Partial<DsoView> = {}): DsoView => ({
  id: ID(1),
  primaryId: 'NGC 224',
  displayName: 'M 31',
  names: ['M 31', 'PGC 2557', 'UGC 454', 'Andromeda Galaxy'],
  catalogs: ['NGC', 'M', 'PGC', 'UGC'],
  objectType: 'G',
  group: 'galaxy',
  constellation: 'And',
  raDeg: 10.684791666666666,
  decDeg: 41.26905555555555,
  magV: 3.44,
  magB: 4.29,
  magBandUsed: 'V',
  surfBrMagArcsec2: 23.63,
  sizeMajorArcmin: 177.83,
  sizeMinorArcmin: 69.66,
  positionAngleDeg: 35,
  source: 'openngc:NGC.csv v20260501 (abgerufen 2026-09-25)',
  filterHint: 'broadband',
  night: null,
  ...over,
});

const list = (items: DsoView[], over: Partial<DsoList> = {}): DsoList => ({
  items,
  total: items.length,
  night: null,
  catalog: { version: 'v20260501', fetchedAt: '2026-09-25' },
  ...over,
});

const rig = {
  id: ID(500),
  name: 'Rig A',
  siteId: ID(600),
  telescopeId: ID(601),
  cameraId: ID(602),
  showInPlanning: true,
  derived: { scaleArcsecPx: 1.2, fovWidthDeg: 2.5, fovHeightDeg: 1.7 },
};

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

const renderPage = (path = '/planung/objekte?reiter=alle') =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <Routes>
            <Route
              path="/planung/objekte"
              element={
                <>
                  <ObjectBrowserPage />
                  <Where />
                </>
              }
            />
            <Route path="/projekte/neu" element={<Where />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  state.me = me('user');
  state.rigs = [];
  state.searches = [];
  state.fail = false;
  state.result = list([m31()]);
  state.refresh.mockReset();
});

describe('Modell S-21', () => {
  it('Filter ↔ URL-Parameter (nur abweichende Werte)', () => {
    const f = filtersFromParams(
      new URLSearchParams('q=m31&typ=galaxy&katalog=M&mag=9&bildfeld=1&sort=usable&seite=3'),
    );
    expect(f).toMatchObject({ q: 'm31', group: 'galaxy', catalog: 'M', magMax: '9', fits: true });
    expect(f).toMatchObject({ sort: 'usable', page: 3, view: 'list' });
    expect(paramsFromFilters(f).toString()).toBe(
      'q=m31&typ=galaxy&katalog=M&mag=9&bildfeld=1&sort=usable&seite=3',
    );
    expect(filtersFromParams(new URLSearchParams('typ=quasar&sort=x'))).toMatchObject({
      group: '',
      sort: '',
    });
  });

  it('Anfrage: Nachtwerte nur mit Standort, Bildfeld aus der kleineren Kante', () => {
    const f = filtersFromParams(
      new URLSearchParams('reiter=alle&sort=usable&stunden=3&bildfeld=1&mag=9,5'),
    );
    expect(searchFromFilters(f, { siteId: null, night: null, fovArcmin: null })).toEqual({
      sort: 'name',
      limit: 50,
      offset: 0,
      magMax: 9.5,
    });
    expect(
      searchFromFilters(f, {
        siteId: ID(600),
        night: '2026-10-20',
        fovArcmin: fovArcmin([2.5, 1.7]),
      }),
    ).toEqual({
      sort: 'usable',
      limit: 50,
      offset: 0,
      rigFovArcmin: 102,
      magMax: 9.5,
      fitsFovArcmin: 102,
      siteId: ID(600),
      night: '2026-10-20',
      minAltDeg: 30,
      minUsableHours: 3,
    });
  });

  it('Eine Tabelle: mit Rig standardmäßig nach Bewertung, nur Bildkandidaten als Filter (FA-FRM-13)', () => {
    const f = filtersFromParams(new URLSearchParams());
    expect(f).toMatchObject({ sort: '', candidates: false });
    const ctx = { siteId: ID(600), night: '2026-10-20', fovArcmin: 114.04 };
    expect(searchFromFilters(f, ctx)).toMatchObject({ sort: 'score', rigFovArcmin: 114 });
    expect(searchFromFilters(f, ctx)).not.toHaveProperty('candidates');
    // Andere Sortierung: Bewertung bleibt als Spalte (rigFovArcmin).
    expect(searchFromFilters({ ...f, sort: 'mag' }, ctx)).toMatchObject({
      sort: 'mag',
      rigFovArcmin: 114,
    });
    const c = filtersFromParams(new URLSearchParams('kandidaten=1'));
    expect(c.candidates).toBe(true);
    expect(paramsFromFilters(c).toString()).toBe('kandidaten=1');
    expect(searchFromFilters(c, ctx)).toMatchObject({ sort: 'score', candidates: 'true' });
    // Ohne Rig keine Bewertung – Standard nach Name.
    expect(searchFromFilters(f, { siteId: null, night: null, fovArcmin: null })).toMatchObject({
      sort: 'name',
    });
    expect(effectiveSort('score', { withNight: true, rated: false })).toBe('name');
    expect(effectiveSort('usable', { withNight: false, rated: false })).toBe('name');
  });

  it('Aliase ohne Anzeigenamen, Trivialnamen getrennt', () => {
    expect(aliasesOf(m31())).toEqual({
      designations: ['NGC 224', 'PGC 2557', 'UGC 454'],
      common: ['Andromeda Galaxy'],
    });
  });

  it('Katalogobjekt füllt die Zielfelder des Entwurfs', () => {
    const d = applyCatalogPick(emptyDraft(DEFAULT_CONDITIONS), {
      ...m31(),
      typeLabel: 'Galaxie',
    });
    expect(d).toMatchObject({
      name: 'M 31 – Andromeda Galaxy',
      targetName: 'M 31',
      targetType: 'Galaxie',
      dsoObjectId: ID(1),
      dsoPrimaryId: 'NGC 224',
      catalogNames: 'NGC 224, PGC 2557, UGC 454',
      raDeg: 10.684791666666666,
      decDeg: 41.26905555555555,
    });
    const named = applyCatalogPick(
      { ...emptyDraft(DEFAULT_CONDITIONS), name: 'Mein Projekt' },
      { ...m31(), typeLabel: 'Galaxie' },
    );
    expect(named.name).toBe('Mein Projekt');
  });
});

describe('S-21 Objektbrowser', () => {
  it('zeigt Objekt, Aliase, Typ mit Code, Helligkeit mit Band und die Quelle', async () => {
    renderPage();
    const row = (await screen.findByText('M 31')).closest('tr') as HTMLElement;
    expect(row).toHaveTextContent('Andromeda Galaxy');
    expect(row).toHaveTextContent('NGC 224, PGC 2557, UGC 454');
    expect(within(row).getByTitle('OpenNGC-Typ G')).toHaveTextContent('Galaxie');
    expect(within(row).getByTitle('Band V (OpenNGC)')).toHaveTextContent('3,4 V');
    expect(row).toHaveTextContent('177,8′ × 69,7′');
    expect(within(row).getByRole('img', { name: 'Vorschaubild M 31' })).toHaveAttribute(
      'src',
      '/catalog/img/ngc/ngc224.jpg',
    );
    expect(screen.getByText(/OpenNGC v20260501 \(CC BY-SA 4\.0\)/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '1 Treffer' })).toBeInTheDocument();
    // Ohne Rig keine Nachtspalten und keine Nachtsortierung.
    expect(screen.queryByRole('columnheader', { name: 'Nutzbar' })).not.toBeInTheDocument();
    // Sortierung über die Spaltenköpfe (AP-26a), die Auswahlliste gibt es nur noch in der Galerie.
    expect(screen.queryByLabelText('Sortierung')).not.toBeInTheDocument();
    const mag = screen.getByRole('columnheader', { name: /Helligkeit/ });
    expect(mag).toHaveAttribute('aria-sort', 'none');
    await expectNoSeriousA11y();
    fireEvent.click(within(mag).getByRole('button'));
    await waitFor(() => expect(state.searches.at(-1)).toMatchObject({ sort: 'mag' }));
    expect(state.searches.at(-1)).not.toHaveProperty('dir');
    fireEvent.click(
      within(screen.getByRole('columnheader', { name: /Helligkeit/ })).getByRole('button'),
    );
    await waitFor(() => expect(state.searches.at(-1)).toMatchObject({ sort: 'mag', dir: 'desc' }));
  });

  it('Filter gehen in die URL und in die Anfrage; Suche nach kurzer Pause', async () => {
    renderPage();
    await screen.findByText('M 31');
    fireEvent.change(screen.getByLabelText('Objekttyp'), { target: { value: 'galaxy' } });
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('typ=galaxy'));
    fireEvent.change(screen.getByLabelText('Suche'), { target: { value: 'andromeda' } });
    await waitFor(() =>
      expect(state.searches.at(-1)).toMatchObject({ q: 'andromeda', group: 'galaxy' }),
    );
    // Übrige Filter unter „Weitere Filter“ (FilterBar, AP-26c).
    fireEvent.click(screen.getByRole('button', { name: 'Weitere Filter' }));
    fireEvent.change(screen.getByLabelText(/Helligkeit bis/), { target: { value: '8' } });
    fireEvent.blur(screen.getByLabelText(/Helligkeit bis/));
    await waitFor(() => expect(state.searches.at(-1)).toMatchObject({ magMax: 8 }));
  });

  it('Weitere Filter: Chip je aktivem Filter, × entfernt ihn aus URL und Anfrage; Zurücksetzen', async () => {
    renderPage('/planung/objekte?sternbild=And&mag=8&ansicht=galerie');
    await screen.findByText('M 31');
    const more = screen.getByRole('button', { name: 'Weitere Filter' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    const chips = screen.getByRole('list', { name: 'Aktive Filter' });
    expect(chips).toHaveTextContent('Sternbild: Andromeda (And)');
    expect(chips).toHaveTextContent('Helligkeit bis: 8 mag');
    await expectNoSeriousA11y();
    fireEvent.click(screen.getByRole('button', { name: 'Filter Helligkeit bis: 8 mag entfernen' }));
    await waitFor(() => expect(screen.getByTestId('where')).not.toHaveTextContent('mag='));
    await waitFor(() => expect(state.searches.at(-1)).not.toHaveProperty('magMax'));
    expect(screen.getByTestId('where')).toHaveTextContent('sternbild=And');
    // Neuer Filter im Bereich → neuer Chip; „Alle zurücksetzen“ behält die Ansicht.
    fireEvent.click(more);
    fireEvent.change(screen.getByLabelText(/Größe ab/), { target: { value: '10' } });
    fireEvent.blur(screen.getByLabelText(/Größe ab/));
    expect(await screen.findByText('Größe ab: 10′')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Alle zurücksetzen' }));
    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Aktive Filter' })).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId('where')).toHaveTextContent('/planung/objekte?ansicht=galerie');
  });

  it('mit Rig: Nacht, Nachtwerte in Standortzeit, Mond, nutzbare Stunden, Bildfeld', async () => {
    state.rigs = [rig];
    state.result = list(
      [
        m31({
          night: {
            visibility: 'normal',
            usableHours: 7.5,
            peakAltDeg: 80.2,
            peakUtc: '2026-10-21T04:15:00Z',
            moonSepDeg: 95,
            score: null,
          },
        }),
        m31({
          id: ID(2),
          primaryId: 'NGC 104',
          displayName: 'NGC 104',
          names: ['C 106', '47 Tucanae'],
          night: {
            visibility: 'never',
            usableHours: 0,
            peakAltDeg: null,
            peakUtc: null,
            moonSepDeg: null,
            score: null,
          },
        }),
      ],
      {
        night: {
          night: '2026-10-20',
          timeZone: 'America/Chicago',
          darkStartUtc: '2026-10-21T00:40:00Z',
          darkEndUtc: '2026-10-21T11:20:00Z',
          moonIllumPct: 62,
        },
      },
    );
    renderPage();
    const row = (await screen.findByText('M 31')).closest('tr') as HTMLElement;
    expect(row).toHaveTextContent('23:15 CDT · 80°');
    expect(row).toHaveTextContent('95° Abstand');
    expect(row).toHaveTextContent('7,5 h');
    expect((screen.getByText('NGC 104').closest('tr') as HTMLElement).textContent).toContain(
      'nie über 30°',
    );
    expect(screen.getByText('Dunkel 19:40 CDT–06:20 CDT · Mond 62 % beleuchtet')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Nacht ab dem Abend des Di., 20.10.2026' }),
    ).toHaveAttribute('aria-expanded', 'false');
    // „Mond und Dunkelheit“: Kopf mit Phase, Beleuchtung und Mondalter; Streifen mit Zeiten in Standortzeit.
    expect(await screen.findByRole('button', { name: 'Mond und Dunkelheit' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText(/% beleuchtet · \d+,\d Tage nach Neumond/)).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /Mond und Dunkelheit der Nacht 20\.\/21\.10\.:/ }),
    ).toHaveAccessibleName(/astronomisch dunkel.*Zeiten in CDT/);
    expect(state.searches.at(-1)).toMatchObject({
      siteId: ID(600),
      night: '2026-10-20',
      minAltDeg: 30,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Weitere Filter' }));
    expect(screen.getByLabelText(/Mindesthöhe/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Passt ins Bildfeld \(102′\)/));
    await waitFor(() => expect(state.searches.at(-1)).toMatchObject({ fitsFovArcmin: 102 }));
    fireEvent.click(screen.getByRole('button', { name: 'Nächste Nacht' }));
    await waitFor(() => expect(state.searches.at(-1)).toMatchObject({ night: '2026-10-21' }));
    await expectNoSeriousA11y();
  });

  it('Mondkalender: Monat mit Phasen, Vierteln und bester Nacht; Tag anklicken wählt die Nacht', async () => {
    state.rigs = [rig];
    state.result = list([m31()], {
      night: {
        night: '2026-10-20',
        timeZone: 'America/Chicago',
        darkStartUtc: '2026-10-21T00:40:00Z',
        darkEndUtc: '2026-10-21T11:20:00Z',
        moonIllumPct: 62,
      },
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^Nacht ab dem Abend des/ }));
    const dialog = await screen.findByRole('dialog', { name: /Mondkalender Oktober 2026/ });
    // Oktober 2026: Neumond 10.10. 10:50 CDT → Nacht 09./10.10., Vollmond 25.10. 23:12 CDT → Nacht 25./26.10.
    expect(
      within(dialog).getByRole('button', { name: /Nacht 09\.\/10\.10\.: .* Neumond/ }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: /Nacht 25\.\/26\.10\.: .* Vollmond/ }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: /Nacht 20\.\/21\.10\.:.*Heute/ }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      within(dialog).getAllByRole('button', { name: /eine der drei besten Nächte/ }),
    ).toHaveLength(3);
    expect(within(dialog).getByText(/Neumond .* etwa .*·.*Vollmond .* etwa/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /Nacht 12\.\/13\.10\./ }));
    await waitFor(() => expect(state.searches.at(-1)).toMatchObject({ night: '2026-10-12' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await expectNoSeriousA11y();
  });

  it('Eine Tabelle: Bewertung und Filterempfehlung je Zeile, Standard nach Bewertung, jede Spalte sortierbar', async () => {
    state.rigs = [rig];
    state.result = list([
      m31({
        filterHint: 'broadband',
        night: {
          visibility: 'normal',
          usableHours: 7.5,
          peakAltDeg: 80.2,
          peakUtc: '2026-10-21T04:15:00Z',
          moonSepDeg: 95,
          score: 0.84,
        },
      }),
    ]);
    renderPage();
    const row = (await screen.findByText('M 31')).closest('tr') as HTMLElement;
    expect(row).toHaveTextContent('84 %');
    expect(row).toHaveTextContent('Breitband (LRGB)');
    // Keine Reiter mehr: eine Tabelle, mit Rig nach Bewertung sortiert (FA-FRM-13).
    expect(screen.queryByRole('tab', { name: 'Beste der Nacht' })).not.toBeInTheDocument();
    expect(state.searches.at(-1)).toMatchObject({
      sort: 'score',
      rigFovArcmin: expect.any(Number),
    });
    expect(state.searches.at(-1)).not.toHaveProperty('candidates');
    expect(screen.getByRole('columnheader', { name: /Bewertung/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    // Andere Spalte sortieren: Bewertung bleibt als Spalte.
    fireEvent.click(
      within(screen.getByRole('columnheader', { name: /Helligkeit/ })).getByRole('button'),
    );
    await waitFor(() => expect(state.searches.at(-1)).toMatchObject({ sort: 'mag' }));
    expect(screen.getByTestId('where')).toHaveTextContent('sort=mag');
    // Nur Bildkandidaten als Filter.
    fireEvent.click(screen.getByRole('button', { name: 'Weitere Filter' }));
    fireEvent.click(screen.getByLabelText('Nur Bildkandidaten (Beste der Nacht)'));
    await waitFor(() => expect(state.searches.at(-1)).toMatchObject({ candidates: 'true' }));
    await expectNoSeriousA11y();
  });

  it('Sternkarte öffnet die Karte mit Objekt, Rig und passendem Sichtfeld', async () => {
    state.rigs = [rig];
    renderPage();
    await screen.findByText('M 31');
    const href =
      screen.getByRole('link', { name: 'M 31 in der Sternkarte' }).getAttribute('href') ?? '';
    expect(href).toMatch(/^\/planung\/sternkarte\?/);
    const q = new URLSearchParams(href.split('?')[1]);
    expect(q.get('objekt')).toBe('NGC 224');
    expect(q.get('rig')).toBe(ID(500));
  });

  it('Projekt anlegen führt in den Editor mit Objekt und Rig', async () => {
    state.rigs = [rig];
    renderPage();
    const link = await screen.findByRole('link', { name: 'Projekt anlegen für M 31' });
    fireEvent.click(link);
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(
        `/projekte/neu?objekt=NGC+224&rig=${ID(500)}`,
      ),
    );
  });

  it('Kopf und Zeilenaktionen (AP-26d/26j): ein h1 ohne Brotkrumen, Reiter darunter; Sternkarte als Symbolknopf, Saison als Reiter in der Zeile', async () => {
    state.rigs = [rig];
    renderPage();
    const row = (await screen.findByText('M 31')).closest('tr') as HTMLElement;
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Objektbrowser' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /Brotkrumen|›/ })).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Planungsbereiche' })).toBeInTheDocument();
    // Rig und Nacht in der Kontextleiste, nicht im Reiterinhalt.
    const context = screen.getByRole('region', { name: 'Rig und Nacht' });
    expect(within(context).getByRole('button', { name: 'Heute Nacht' })).toBeInTheDocument();
    // Eine Zeile: Sternkarte als Symbolknopf (nur zugänglicher Name) und *Projekt*; das Saisondiagramm
    // steht seit AP-26j als Reiter neben dem Höhendiagramm in der aufgeklappten Zeile.
    expect(within(row).queryByRole('button', { name: 'Saison von M 31' })).toBeNull();
    const map = within(row).getByRole('link', { name: 'M 31 in der Sternkarte' });
    expect(map).toHaveTextContent('');
    expect(map.getAttribute('href')).toMatch(/^\/planung\/sternkarte\?/);
    expect(within(row).getByRole('link', { name: 'Projekt anlegen für M 31' })).toHaveTextContent(
      'Projekt',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Weitere Angaben zu M 31' }));
    const charts = await screen.findByRole('tablist', { name: 'Diagramme zu M 31' });
    expect(within(charts).getByRole('tab', { name: 'Höhendiagramm' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    fireEvent.click(within(charts).getByRole('tab', { name: 'Saisondiagramm' }));
    expect(within(charts).getByRole('tab', { name: 'Saisondiagramm' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expectNoSeriousA11y();
  });

  it('aufgeklappte Zeile zeigt das Nachtdiagramm des Objekts am Rig-Standort (AP-26e)', async () => {
    state.rigs = [rig];
    renderPage();
    await screen.findByText('M 31');
    const toggle = await screen.findByRole('button', { name: 'Weitere Angaben zu M 31' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(
      await screen.findByRole('img', { name: /Nachtdiagramm, Zeiten in Standortzeit \(C[DS]T\)/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Höhe von M 31 in der gewählten Nacht/)).toBeInTheDocument();
    expect(screen.getByText('Höchster Stand')).toBeInTheDocument();
    await expectNoSeriousA11y();
  });

  it('Wikipedia-Link je Objekt: Artikel aus dem Website-Auszug (Tabelle und Galerie, FA-FRM-14)', async () => {
    renderPage();
    await screen.findByText('M 31');
    const row = screen.getByRole('link', { name: 'M 31 in der Sternkarte' }).closest('tr');
    // Der Website-Auszug (Wikipedia-Titel) lädt nachträglich – unter CI-Last länger als 1 s.
    const link = await within(row as HTMLElement).findByRole(
      'link',
      { name: 'Wikipedia-Artikel zu M 31' },
      { timeout: 5000 },
    );
    expect(link).toHaveAttribute('href', 'https://de.wikipedia.org/wiki/Andromedagalaxie');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    cleanup();
    renderPage('/planung/objekte?reiter=alle&ansicht=galerie');
    const card = await screen.findByRole(
      'link',
      { name: 'Wikipedia-Artikel zu M 31' },
      { timeout: 5000 },
    );
    expect(card).toHaveTextContent('Wikipedia');
    expect(card).toHaveAttribute('href', 'https://de.wikipedia.org/wiki/Andromedagalaxie');
  });

  it('Galerie: 320 px, bei Fehler 128 px, sonst leeres Feld', async () => {
    renderPage('/planung/objekte?reiter=alle&ansicht=galerie');
    const img = await screen.findByRole('img', { name: 'Vorschaubild M 31' });
    expect(img).toHaveAttribute('src', '/catalog/img/ngc-l/ngc224.jpg');
    fireEvent.error(img);
    expect(screen.getByRole('img', { name: 'Vorschaubild M 31' })).toHaveAttribute(
      'src',
      '/catalog/img/ngc/ngc224.jpg',
    );
    fireEvent.error(screen.getByRole('img', { name: 'Vorschaubild M 31' }));
    expect(screen.queryByRole('img', { name: 'Vorschaubild M 31' })).not.toBeInTheDocument();
    await expectNoSeriousA11y();
  });

  it('Seiten: Gesamtzahl, weiter und zurück', async () => {
    state.result = (s: DsoSearch) => list([m31({ id: ID(10 + (s.offset ?? 0)) })], { total: 120 });
    renderPage();
    expect(await screen.findByText('Seite 1 von 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Nächste Seite' }));
    await waitFor(() => expect(state.searches.at(-1)).toMatchObject({ offset: 50 }));
    expect(await screen.findByText('Seite 2 von 3')).toBeInTheDocument();
  });

  it('leer und Fehler', async () => {
    state.result = list([]);
    const { unmount } = renderPage();
    expect(await screen.findByText('Keine Objekte für diese Filter.')).toBeInTheDocument();
    unmount();
    state.fail = true;
    renderPage();
    expect(await screen.findByRole('button', { name: 'Erneut versuchen' })).toBeInTheDocument();
  });
});

describe('Katalogsuche im Editor', () => {
  const renderSearch = (onPick = vi.fn()) => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <CatalogSearch onPick={onPick} linkedName="M 31" onUnlink={() => undefined} />
      </QueryClientProvider>,
    );
    return onPick;
  };

  it('Autovervollständigung mit Tastatur: ↓, Enter übernimmt', async () => {
    state.result = list([
      m31(),
      m31({ id: ID(2), primaryId: 'NGC 221', displayName: 'M 32', names: ['M 32'] }),
    ]);
    const onPick = renderSearch();
    const box = screen.getByRole('combobox', { name: 'Katalogsuche' });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'm3' } });
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(2);
    expect(state.searches.at(-1)).toEqual({ q: 'm3', limit: 8 });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(box).toHaveAttribute('aria-activedescendant', options[1]?.id);
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'M 32' }));
    expect(screen.getByText('Verknüpft mit M 31 aus dem Objektkatalog.')).toBeInTheDocument();
    await expectNoSeriousA11y();
  });

  it('kein Treffer', async () => {
    state.result = list([]);
    renderSearch();
    const box = screen.getByRole('combobox', { name: 'Katalogsuche' });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'xyz' } });
    expect(await screen.findByText('Kein Objekt gefunden.')).toBeInTheDocument();
  });
});

describe('S-82 Kataloge', () => {
  const status = (over: Partial<CatalogStatus['dso']> = {}): CatalogStatus => ({
    dso: {
      version: 'v20260501',
      fetchedAt: '2026-09-25',
      ngcCsvRows: 13969,
      addendumCsvRows: 64,
      expectedRows: 13632,
      sharplessRows: 265,
      warnings: 118,
      rows: 13632,
      lastImportAt: '2026-09-25T10:00:00Z',
      sources: ['openngc:NGC.csv v20260501'],
      lastJob: {
        id: ID(70),
        status: 'done',
        error: null,
        createdAt: '2026-09-25T09:59:00Z',
        finishedAt: '2026-09-25T10:00:00Z',
      },
      ...over,
    },
    exo: [
      { catalog: 'exoclock', rows: 776, unknownTimeSystem: 0, lastImportAt: null, lastJob: null },
      { catalog: 'nasa', rows: 702, unknownTimeSystem: 24, lastImportAt: null, lastJob: null },
      { catalog: 'toi', rows: 1800, unknownTimeSystem: 0, lastImportAt: null, lastJob: null },
    ],
  });
  const renderPanel = () =>
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <CatalogPanel />
      </QueryClientProvider>,
    );

  it('zeigt Version, Quellzeilen, Zeilen und letzten Job; Neu importieren', async () => {
    state.status = status();
    state.refresh.mockResolvedValue({ jobId: ID(71) });
    renderPanel();
    expect(await screen.findByText('v20260501')).toBeInTheDocument();
    expect(screen.getByText('13.969 aus NGC.csv + 64 aus addendum.csv')).toBeInTheDocument();
    expect(screen.getByText('entspricht der Katalogdatei')).toBeInTheDocument();
    expect(screen.getByText('fertig')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Neu importieren' }));
    expect(await screen.findByText(/Import gestartet/)).toBeInTheDocument();
    expect(state.refresh).toHaveBeenCalledTimes(1);
    await expectNoSeriousA11y();
  });

  it('noch nicht importiert bzw. abweichende Zeilenzahl', async () => {
    state.status = status({ rows: 0, lastImportAt: null, lastJob: null });
    const { unmount } = renderPanel();
    expect(await screen.findByText('noch nicht importiert')).toBeInTheDocument();
    unmount();
    state.status = status({ rows: 13000 });
    renderPanel();
    expect(await screen.findByText('weicht von der Katalogdatei ab')).toBeInTheDocument();
  });

  it('Exoplaneten-Kataloge: Planeten, unsicheres Zeitsystem, Fehler, Neu laden je Katalog (AP-40)', async () => {
    const s = status();
    state.status = {
      ...s,
      exo: s.exo.map((e) =>
        e.catalog === 'toi'
          ? {
              ...e,
              lastJob: {
                id: ID(72),
                status: 'failed' as const,
                error: 'catalog.source_failed',
                createdAt: '2026-09-27T04:30:00Z',
                finishedAt: '2026-09-27T04:31:00Z',
              },
            }
          : e,
      ),
    };
    state.refresh.mockResolvedValue({ jobId: ID(73) });
    renderPanel();
    expect(
      await screen.findByRole('heading', { name: 'Exoplaneten-Kataloge' }),
    ).toBeInTheDocument();
    const nasa = screen.getByRole('row', { name: /NASA Exoplanet Archive/ });
    expect(nasa).toHaveTextContent('702');
    expect(nasa).toHaveTextContent('24');
    expect(screen.getByRole('row', { name: /TESS TOI/ })).toHaveTextContent('fehlgeschlagen');
    fireEvent.click(screen.getByRole('button', { name: 'NASA Exoplanet Archive neu laden' }));
    await waitFor(() => expect(state.refresh).toHaveBeenCalledWith('nasa'));
    await expectNoSeriousA11y();
  });
});
