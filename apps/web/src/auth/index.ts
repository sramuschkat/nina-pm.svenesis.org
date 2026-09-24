/**
 * Anmelde-Hilfen für das Frontend (TK 5.3, 11.4) – ohne Oberfläche (die folgt mit AP-06a).
 * - Jede nicht-GET-Anfrage trägt `X-NPM-Request: 1` (CSRF, SV-04).
 * - `401 auth.unauthenticated` → Anmeldeseite `/` mit `next` = aktueller Pfad; **keine**
 *   Token-Erneuerung, keine Wiederholung, keine tabübergreifende Abstimmung.
 */
import { CSRF_HEADER, CSRF_HEADER_VALUE, safeNext } from '@nina-pm/shared';

export interface Problem {
  readonly status: number;
  readonly code: string;
  readonly title?: string;
  readonly requestId?: string;
  readonly errors?: readonly { path: string; message: string }[];
}

export class ApiError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.code);
    this.name = 'ApiError';
  }
}

export interface AuthNavigation {
  /** Aktueller Pfad inkl. Query (z. B. `location.pathname + location.search`). */
  currentPath(): string;
  /** Wechselt die Seite (z. B. `location.assign`). */
  go(url: string): void;
}

const browserNavigation: AuthNavigation = {
  currentPath: () => `${window.location.pathname}${window.location.search}`,
  go: (url) => window.location.assign(url),
};

/** Anmeldeseite mit Rücksprung (nur relative Pfade, TK 5.2). */
export function loginUrl(next: string): string {
  const safe = safeNext(next);
  return safe === '/' ? '/' : `/?next=${encodeURIComponent(safe)}`;
}

/** Start der Discord-Anmeldung als Top-Level-Navigation (kein fetch). */
export function discordLoginUrl(next: string, tenantKey?: string): string {
  const q = new URLSearchParams({ next: safeNext(next) });
  if (tenantKey) q.set('mandant', tenantKey);
  return `/api/auth/discord/start?${q.toString()}`;
}

async function toProblem(res: Response): Promise<Problem> {
  try {
    const body = (await res.json()) as Partial<Problem>;
    if (typeof body.code === 'string') return { ...body, status: res.status, code: body.code };
  } catch {
    // kein JSON
  }
  return { status: res.status, code: res.status === 429 ? 'auth.rate_limited' : 'internal.error' };
}

export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  readonly json?: unknown;
}

export function createApiFetch(
  fetchImpl: typeof fetch = fetch,
  navigation: AuthNavigation = browserNavigation,
) {
  return async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
    const { json, headers, ...init } = options;
    const method = (init.method ?? 'GET').toUpperCase();
    const h = new Headers(headers);
    h.set('accept', 'application/json');
    if (method !== 'GET' && method !== 'HEAD') h.set(CSRF_HEADER, CSRF_HEADER_VALUE);
    if (json !== undefined) h.set('content-type', 'application/json');
    const res = await fetchImpl(path, {
      ...init,
      method,
      headers: h,
      credentials: 'same-origin',
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    });
    if (res.status === 204) return undefined as T;
    if (res.ok) return (await res.json()) as T;
    const problem = await toProblem(res);
    if (problem.status === 401 && problem.code === 'auth.unauthenticated') {
      navigation.go(loginUrl(navigation.currentPath()));
    }
    throw new ApiError(problem);
  };
}

export const apiFetch = createApiFetch();
