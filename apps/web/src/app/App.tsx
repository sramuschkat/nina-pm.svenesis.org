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
import { HomePage, NotFoundPage, PrivacyPage, SourcesPage } from '../pages/other';
import { ADMIN_PATHS } from '../pages/admin/AdminLayout';
import { ChangeLogPage } from '../pages/admin/ChangeLogPage';
import { MembersPage } from '../pages/admin/MembersPage';
import { TenantSettingsPage } from '../pages/admin/TenantSettingsPage';
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
import { MyObjectsPage } from '../pages/projects/MyObjectsPage';
import { DraftsPage } from '../pages/projects/DraftsPage';
import { QueuePage } from '../pages/projects/QueuePage';
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
            { path: 'meine-objekte', element: <Navigate to="/projekte/meine-objekte" replace /> },
            { path: 'projekte', element: <ProjectListPage /> },
            { path: 'projekte/neu', element: <ProjectEditorPage /> },
            { path: 'projekte/meine-objekte', element: <MyObjectsPage /> },
            { path: 'projekte/entwuerfe', element: <DraftsPage /> },
            { path: 'projekte/warteschlange', element: <QueuePage /> },
            { path: 'projekte/:id', element: <ProjectEditorPage /> },
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
