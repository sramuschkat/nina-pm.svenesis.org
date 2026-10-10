/**
 * Router und Provider (TK 11.2): Query, i18n, Theme/Dichte, Auth. Anmeldeseiten sind Textseiten, alle
 * Seiten nach der Anmeldung liegen im Rahmen (`Shell`).
 */
import type { Action } from '@nina-pm/shared';
import type { Density, Theme } from '@nina-pm/ui-tokens';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useCallback, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router';
import { api } from '../api/client';
import { ApiError, AuthProvider, useAuth, useCan } from '../auth';
import { ProblemMessage } from '../components/ProblemMessage';
import { Shell } from '../layout/Shell';
import { InvitationPage, LoginPage, NoAccessPage, SelectTenantPage } from '../pages/auth';
import { CATALOG_PATH } from '../pages/catalog/model';
import { HomePage } from '../pages/home/HomePage';
import { NotFoundPage, PrivacyPage, SourcesPage } from '../pages/other';
import { ADMIN_PATHS } from '../pages/admin/AdminLayout';
import { ChangeLogPage } from '../pages/admin/ChangeLogPage';
import { MembersPage } from '../pages/admin/MembersPage';
import { TenantSettingsPage } from '../pages/admin/TenantSettingsPage';
import { DiscordSettingsPage } from '../pages/admin/DiscordSettingsPage';
import { PersonalSettingsPage } from '../pages/me/PersonalSettingsPage';
import { SuperUsersPage } from '../pages/system/SuperUsersPage';
import { SystemAuditPage } from '../pages/system/SystemAuditPage';
import { SYSTEM_PATHS } from '../pages/system/SystemLayout';
import { SystemTenantsPage } from '../pages/system/SystemTenantsPage';
import { CamerasPage } from '../pages/equipment/CamerasPage';
import { FiltersPage } from '../pages/equipment/FiltersPage';
import { MoonProfilesPage } from '../pages/equipment/MoonProfilesPage';
import { RigsPage } from '../pages/equipment/RigsPage';
import { EQUIPMENT_PATHS } from '../pages/equipment/shared';
import { SitesPage } from '../pages/equipment/SitesPage';
import { TelescopesPage } from '../pages/equipment/TelescopesPage';
import { ProjectEditorPage } from '../pages/projects/ProjectEditorPage';
import { ProjectListPage } from '../pages/projects/ProjectListPage';
import { PROJECT_AREA } from '../pages/projects/ProjectsLayout';
import { QueuePage } from '../pages/projects/QueuePage';
import { DeliveryPage } from '../pages/nina/DeliveryPage';
import { SequencerHelpPage } from '../pages/nina/SequencerHelpPage';
import { InstancesPage } from '../pages/nina/InstancesPage';
import { TelemetryPage } from '../pages/nina/TelemetryPage';
import { NINA_PATHS, NinaLayout } from '../pages/nina/NinaLayout';
import { EVALUATION_PATHS } from '../pages/sessions/evaluation';
import { NightPage } from '../pages/sessions/NightPage';
import { NightsPage } from '../pages/sessions/NightsPage';
import { LegacyRedirect, SessionRedirect } from '../pages/sessions/redirects';
import { SiteStatsPage } from '../pages/sessions/SiteStatsPage';
import { SkyPage } from '../pages/sessions/SkyPage';
import { SimulatorPage } from '../pages/simulator/SimulatorPage';
import { ObjectBrowserPage } from '../pages/catalog/ObjectBrowserPage';
import { SkyMapPage } from '../pages/planning/SkyMapPage';
import { CalculatorPage } from '../pages/calculator/CalculatorPage';
import { ExoplanetsPage } from '../pages/exo/ExoplanetsPage';
import { WeatherPage } from '../pages/weather/WeatherPage';
import { AppearanceProvider } from './theme';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // 401 führt der fetch-Wrapper zur Anmeldeseite; Fachfehler nicht wiederholen.
        retry: (count, error) =>
          !(error instanceof ApiError && error.problem.status < 500) && count < 2,
        refetchOnWindowFocus: true,
      },
    },
  });
}

/** Theme/Dichte aus `user_preference`, wenn ein Mandanten-Kontext besteht (TK 11.3). */
function Appearance({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const tenant = me?.context === 'tenant';
  const prefs = useQuery({
    queryKey: ['me', 'preferences', me?.tenant?.id],
    queryFn: () => api.preferences(),
    enabled: tenant,
    staleTime: Infinity,
  });
  const persist = useCallback(
    (key: 'ui.theme' | 'ui.density', value: string) => {
      if (tenant) void api.setPreference(key, value).catch(() => undefined);
    },
    [tenant],
  );
  return (
    <AppearanceProvider
      persist={tenant ? persist : undefined}
      serverTheme={prefs.data?.['ui.theme'] as Theme | undefined}
      serverDensity={prefs.data?.['ui.density'] as Density | undefined}
    >
      {children}
    </AppearanceProvider>
  );
}

/** `/`: anonym → Einstiegsseite; Kontext `select` → Mandantenauswahl bzw. Kein Zugang; sonst Rahmen. */
function Root() {
  const { me } = useAuth();
  if (me === undefined) return null;
  if (me === null) return <LoginPage />;
  if (me.context === 'select') {
    return me.memberships.length === 0 && !me.isSuperUser ? (
      <Navigate to="/kein-zugang" replace />
    ) : (
      <Navigate to="/mandant-waehlen" replace />
    );
  }
  return (
    <Shell>
      <Outlet />
    </Shell>
  );
}

/** Arbeitsseiten verlangen eine Sitzung mit Kontext (TK 11.4 `RequireAuth`, `RequireContext`). */
export function RequireContext({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const location = useLocation();
  if (me === undefined) return null;
  if (me === null)
    return (
      <Navigate to={`/?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
    );
  if (me.context === 'select') return <Navigate to="/mandant-waehlen" replace />;
  return <Shell>{children}</Shell>;
}

/**
 * Seiten mit Aktionsrecht (TK 11.4 `RequireContext`): ohne Recht der Hinweis `permission.denied` statt
 * der Seite – die API lehnt ohnehin ab (TK 5.5).
 */
function RequireAction({ action }: { action: Action }) {
  const allowed = useCan(action);
  const { me } = useAuth();
  if (allowed) return <Outlet />;
  // Admin/Owner ohne 2FA: Rechte ruhen (SV-03) – den Grund nennen statt „kein Zugriff“.
  return <ProblemMessage code={me?.mfaRequired ? 'auth.mfa_required' : 'permission.denied'} />;
}

// Nur im Test-Build: ohne VITE_GALLERY entfernt der Build den Import samt Chunk vollständig.
const Gallery =
  import.meta.env.VITE_GALLERY === '1' ? lazy(() => import('../gallery/Gallery')) : null;

function Providers() {
  return (
    <AuthProvider>
      <Appearance>
        <Outlet />
      </Appearance>
    </AuthProvider>
  );
}

export function createRouter() {
  return createBrowserRouter([
    {
      element: <Providers />,
      children: [
        {
          path: '/',
          element: <Root />,
          children: [
            { index: true, element: <HomePage /> },
            // AP-73: „Heute Nacht“ ist Teil der Startseite „Heute“; Rig, Nacht und Anker bleiben erhalten.
            { path: 'heute-nacht', element: <LegacyRedirect to="/" /> },
            // „Meine Objekte“ und „Entwürfe“ sind seit 30.09.2026 Ansichten der Projektliste.
            { path: 'meine-objekte', element: <Navigate to="/projekte?meine=1" replace /> },
            { path: 'projekte', element: <ProjectListPage /> },
            { path: 'projekte/neu', element: <ProjectEditorPage /> },
            {
              path: 'projekte/meine-objekte',
              element: <Navigate to="/projekte?meine=1" replace />,
            },
            {
              path: 'projekte/entwuerfe',
              element: <Navigate to="/projekte?status=draft,returned" replace />,
            },
            { path: 'projekte/warteschlange', element: <QueuePage /> },
            { path: 'projekte/:id', element: <ProjectEditorPage /> },
            {
              path: 'planung',
              element: <RequireAction action="catalog.read" />,
              children: [
                { index: true, element: <Navigate to={CATALOG_PATH} replace /> },
                { path: 'objekte', element: <ObjectBrowserPage /> },
                { path: 'sternkarte', element: <SkyMapPage /> },
                { path: 'exoplaneten', element: <ExoplanetsPage /> },
                { path: 'rechner', element: <CalculatorPage /> },
              ],
            },
            {
              path: 'wetter',
              element: <RequireAction action="project.read" />,
              children: [{ index: true, element: <WeatherPage /> }],
            },
            {
              path: 'rig-zustand',
              element: <RequireAction action="session.read" />,
              children: [{ index: true, element: <TelemetryPage /> }],
            },
            {
              path: 'nina',
              element: <NinaLayout />,
              children: [
                { index: true, element: <Navigate to={NINA_PATHS.simulator} replace /> },
                { path: 'simulator', element: <SimulatorPage /> },
                { path: 'ausgeliefert', element: <DeliveryPage /> },
                { path: 'hilfe', element: <SequencerHelpPage /> },
                {
                  path: 'instanzen',
                  element: <RequireAction action="nina.instance.manage" />,
                  children: [{ index: true, element: <InstancesPage /> }],
                },
              ],
            },
            {
              path: 'auswertung',
              element: <RequireAction action="session.read" />,
              children: [
                { index: true, element: <Navigate to={EVALUATION_PATHS.nights} replace /> },
                // AP-64/AP-77: Nächte | Standort-Statistik | Himmel (AP-69); alte Pfade leiten um (Suche bleibt erhalten).
                { path: 'naechte', element: <NightsPage /> },
                { path: 'naechte/:id', element: <SessionRedirect /> },
                { path: 'naechte/:rigId/:night', element: <NightPage /> },
                // „Auswertung → Projekte“ (S-63) entfällt seit AP-77: Fortschritt steht in der Projektliste.
                { path: 'projekte', element: <Navigate to={PROJECT_AREA.list} replace /> },
                { path: 'standort', element: <SiteStatsPage /> },
                // AP-69: Ganzhimmelkarte und Zeitachse je Rig (Entscheidung Sven 10.10.2026: in der Auswertung).
                { path: 'himmel', element: <SkyPage /> },
                { path: 'sessions', element: <LegacyRedirect to={EVALUATION_PATHS.nights} /> },
                {
                  path: 'sessions/:id',
                  element: <LegacyRedirect to={EVALUATION_PATHS.nights} withId />,
                },
                { path: 'projektbericht', element: <Navigate to={PROJECT_AREA.list} replace /> },
                { path: 'klarnacht', element: <LegacyRedirect to={EVALUATION_PATHS.site} /> },
                {
                  path: 'folgeplanung',
                  element: <LegacyRedirect to="/#naechste-naechte" />,
                },
              ],
            },
            { path: 'einstellungen', element: <PersonalSettingsPage /> },
            {
              path: 'ausruestung',
              element: <RequireAction action="equipment.read" />,
              children: [
                { index: true, element: <Navigate to={EQUIPMENT_PATHS.rigs} replace /> },
                { path: 'rigs', element: <RigsPage /> },
                { path: 'standorte', element: <SitesPage /> },
                { path: 'teleskope', element: <TelescopesPage /> },
                { path: 'kameras', element: <CamerasPage /> },
                { path: 'filter', element: <FiltersPage /> },
                { path: 'mondprofile', element: <MoonProfilesPage /> },
              ],
            },
            {
              path: 'verwaltung',
              element: <RequireAction action="member.manage" />,
              children: [
                { index: true, element: <Navigate to={ADMIN_PATHS.members} replace /> },
                { path: 'mitglieder', element: <MembersPage /> },
                {
                  element: <RequireAction action="tenant.settings" />,
                  children: [
                    { path: 'einstellungen', element: <TenantSettingsPage /> },
                    { path: 'discord', element: <DiscordSettingsPage /> },
                    { path: 'protokoll', element: <ChangeLogPage /> },
                  ],
                },
              ],
            },
            {
              path: 'system',
              element: <RequireAction action="system.manage" />,
              children: [
                { index: true, element: <Navigate to={SYSTEM_PATHS.tenants} replace /> },
                { path: 'mandanten', element: <SystemTenantsPage /> },
                { path: 'super-user', element: <SuperUsersPage /> },
                { path: 'audit', element: <SystemAuditPage /> },
              ],
            },
          ],
        },
        { path: '/mandant-waehlen', element: <SelectTenantPage /> },
        { path: '/kein-zugang', element: <NoAccessPage /> },
        { path: '/einladung', element: <InvitationPage /> },
        { path: '/datenschutz', element: <PrivacyPage /> },
        { path: '/quellen', element: <SourcesPage /> },
        ...(Gallery
          ? [
              {
                path: '/_bausteine',
                element: (
                  <Suspense fallback={null}>
                    <Gallery />
                  </Suspense>
                ),
              },
            ]
          : []),
        { path: '*', element: <NotFoundPage /> },
      ],
    },
  ]);
}

export function App({ queryClient = createQueryClient() }: { queryClient?: QueryClient }) {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={createRouter()} />
    </QueryClientProvider>
  );
}
