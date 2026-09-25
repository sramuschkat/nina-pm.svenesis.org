/**
 * Smoke-Prüfung nach jedem prod-Deploy (TK 17, 18). Stand AP-02b: Platzhalterseite, SPA-Rewrite,
 * HTTPS-Umleitung, Header-Politiken aller Behaviors (iam.md §10), `/api/health` über CloudFront und
 * Direktaufruf der execute-api-Adresse → 403 (SV-16); seit AP-04a Test-Login → 404 und der
 * Auth-Redirect zu Discord. Seit AP-14c die **DB-Erreichbarkeit** über `GET /api/nina/v1/bootstrap` mit
 * dem Test-Rig-Token (SV-07, H-24); das Token erscheint nie in einer Meldung.
 */
export interface SmokeResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

function cspDirectives(csp: string): Map<string, string[]> {
  return new Map(
    csp
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((parts): parts is [string, ...string[]] => Boolean(parts[0]))
      .map(([name, ...values]) => [name, values]),
  );
}

/** Prüft die Header einer Antwort gegen `npm-html` bzw. `npm-api-static`; liefert Abweichungen. */
export function headerProblems(kind: 'npm-html' | 'npm-api-static', headers: Headers): string[] {
  const problems: string[] = [];
  const csp = headers.get('content-security-policy');
  if (!csp) {
    problems.push('Content-Security-Policy fehlt');
  } else {
    const d = cspDirectives(csp);
    if (kind === 'npm-html') {
      if (d.get('default-src')?.join(' ') !== "'self'")
        problems.push("CSP: default-src ist nicht 'self'");
      if (d.get('script-src')?.includes("'unsafe-inline'"))
        problems.push("CSP: script-src enthält 'unsafe-inline'");
      if (!d.get('style-src')?.includes("'unsafe-inline'"))
        problems.push("CSP: style-src ohne 'unsafe-inline'");
    } else {
      if (d.get('default-src')?.join(' ') !== "'none'")
        problems.push("CSP: default-src ist nicht 'none'");
      if (!d.has('sandbox')) problems.push('CSP: sandbox fehlt');
    }
  }
  if (!headers.get('strict-transport-security')?.includes('max-age=63072000'))
    problems.push('HSTS fehlt oder zu kurz');
  if (headers.get('x-content-type-options') !== 'nosniff')
    problems.push('X-Content-Type-Options fehlt');
  if (kind === 'npm-api-static' && headers.get('cross-origin-resource-policy') !== 'same-origin') {
    problems.push('Cross-Origin-Resource-Policy fehlt');
  }
  return problems;
}

export interface SmokeOptions {
  /** execute-api-Adresse der HTTP API (Ausgabe `ApiEndpoint` von NinaPm-Api). */
  readonly executeApiUrl?: string;
  /** Sync-Token der Test-Instanz (`TEST_RIG_TOKEN`, H-24) für die DB-Erreichbarkeit. */
  readonly testRigToken?: string;
}

export const DB_CHECK_NAME =
  'DB-Erreichbarkeit: GET /api/nina/v1/bootstrap mit Test-Rig-Token → 200';

export async function runSmoke(
  baseUrl: string,
  fetchImpl: Fetch = fetch,
  options: SmokeOptions = {},
): Promise<SmokeResult[]> {
  const base = baseUrl.replace(/\/$/, '');
  const results: SmokeResult[] = [];
  const check = async (name: string, fn: () => Promise<string[]>) => {
    try {
      const problems = await fn();
      results.push({ name, ok: problems.length === 0, detail: problems.join('; ') || 'ok' });
    } catch (error) {
      results.push({
        name,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };

  await check('GET / liefert die Seite mit npm-html', async () => {
    const res = await fetchImpl(`${base}/`);
    const problems = res.status === 200 ? [] : [`Status ${res.status}`];
    if (!res.headers.get('content-type')?.includes('text/html')) problems.push('kein text/html');
    return [...problems, ...headerProblems('npm-html', res.headers)];
  });
  await check('SPA-Route wird auf index.html umgeschrieben', async () => {
    const res = await fetchImpl(`${base}/smoke/spa-route`);
    return res.status === 200 ? [] : [`Status ${res.status}`];
  });
  for (const path of ['/api/smoke', '/catalog/smoke', '/downloads/smoke']) {
    await check(`${path} trägt npm-api-static`, async () => {
      const res = await fetchImpl(`${base}${path}`);
      return headerProblems('npm-api-static', res.headers);
    });
  }
  await check('GET /api/health über CloudFront → 200 mit status ok', async () => {
    const res = await fetchImpl(`${base}/api/health`);
    if (res.status !== 200) return [`Status ${res.status}`];
    const body = (await res.json()) as { status?: unknown; engineVersion?: unknown };
    const problems = body.status === 'ok' ? [] : [`status ${String(body.status)}`];
    if (typeof body.engineVersion !== 'string') problems.push('engineVersion fehlt');
    return [...problems, ...headerProblems('npm-api-static', res.headers)];
  });
  await check('POST /api/auth/test-login → 404 (Test-Login nur lokal, TK 17)', async () => {
    // Mit CSRF-Header, damit nicht die CSRF-Prüfung (403) eine vorhandene Route verdeckt.
    const res = await fetchImpl(`${base}/api/auth/test-login`, {
      method: 'POST',
      headers: { 'X-NPM-Request': '1', 'content-type': 'application/json' },
      body: '{"identityFixture":"owner"}',
    });
    return res.status === 404 ? [] : [`Status ${res.status}`];
  });
  await check(
    'Anmeldung leitet zu Discord weiter (state, PKCE S256, __Host-npm_oauth)',
    async () => {
      const res = await fetchImpl(`${base}/api/auth/discord/start?next=/`, { redirect: 'manual' });
      if (res.status !== 302) return [`Status ${res.status}`];
      const location = new URL(res.headers.get('location') ?? 'about:blank');
      const problems: string[] = [];
      if (`${location.origin}${location.pathname}` !== 'https://discord.com/oauth2/authorize')
        problems.push(`Ziel ${location.origin}${location.pathname}`);
      if (location.searchParams.get('code_challenge_method') !== 'S256')
        problems.push('ohne PKCE S256');
      if (location.searchParams.get('redirect_uri') !== `${base}/api/auth/discord/callback`)
        problems.push('redirect_uri weicht ab');
      if (!location.searchParams.get('client_id')) problems.push('client_id fehlt');
      if (!(res.headers.get('set-cookie') ?? '').includes('__Host-npm_oauth='))
        problems.push('Cookie __Host-npm_oauth fehlt');
      return problems;
    },
  );
  if (options.executeApiUrl) {
    const direct = options.executeApiUrl.replace(/\/$/, '');
    await check('Direktaufruf der execute-api-Adresse → 403', async () => {
      const res = await fetchImpl(`${direct}/api/health`);
      return res.status === 403 ? [] : [`Status ${res.status}`];
    });
  } else {
    results.push({
      name: 'Direktaufruf der execute-api-Adresse → 403',
      ok: false,
      detail: 'execute-api-Adresse unbekannt',
    });
  }
  if (options.testRigToken) {
    const token = options.testRigToken;
    await check(DB_CHECK_NAME, async () => {
      const res = await fetchImpl(`${base}/api/nina/v1/bootstrap`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (res.status !== 200) {
        const body = (await res.json().catch(() => ({}))) as { code?: unknown };
        return [`Status ${res.status}${typeof body.code === 'string' ? ` (${body.code})` : ''}`];
      }
      const body = (await res.json()) as { apiVersion?: unknown; rig?: { id?: unknown } };
      const problems = body.apiVersion === '1' ? [] : ['apiVersion fehlt'];
      if (typeof body.rig?.id !== 'string') problems.push('Rig fehlt');
      return [...problems, ...headerProblems('npm-api-static', res.headers)];
    });
  }
  await check('HTTP wird auf HTTPS umgeleitet', async () => {
    const res = await fetchImpl(`${base.replace(/^https:/, 'http:')}/`, { redirect: 'manual' });
    const location = res.headers.get('location') ?? '';
    return res.status >= 300 && res.status < 400 && location.startsWith('https://')
      ? []
      : [`Status ${res.status}, Location ${location || '–'}`];
  });
  return results;
}
