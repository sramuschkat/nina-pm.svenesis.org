/**
 * Router und Provider (TK 11.2): Query, i18n, Theme/Dichte, Auth. Anmeldeseiten sind Textseiten, alle
 * Seiten nach der Anmeldung liegen im Rahmen (`Shell`).
 */
import type { Density, Theme } from '@nina-pm/ui-tokens';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useCallback, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router';
import { api } from '../api/client';
import { ApiError, AuthProvider, useAuth } from '../auth';
import { Shell } from '../layout/Shell';
import { InvitationPage, LoginPage, NoAccessPage, SelectTenantPage } from '../pages/auth';
import { HomePage, NotFoundPage, PrivacyPage, SourcesPage } from '../pages/other';
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
        { path: '/', element: <Root />, children: [{ index: true, element: <HomePage /> }] },
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
