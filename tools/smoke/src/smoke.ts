/**
 * Smoke-Prüfung nach jedem prod-Deploy (TK 17, 18). Stand AP-02a: Platzhalterseite, SPA-Rewrite,
 * HTTPS-Umleitung und die Header-Politiken aller Behaviors (iam.md §10). Folgepakete ergänzen
 * /api/health mit 200 (AP-02b), DB-Erreichbarkeit über den Bootstrap (AP-17) und den Auth-Redirect.
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

export async function runSmoke(baseUrl: string, fetchImpl: Fetch = fetch): Promise<SmokeResult[]> {
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
  await check('HTTP wird auf HTTPS umgeleitet', async () => {
    const res = await fetchImpl(`${base.replace(/^https:/, 'http:')}/`, { redirect: 'manual' });
    const location = res.headers.get('location') ?? '';
    return res.status >= 300 && res.status < 400 && location.startsWith('https://')
      ? []
      : [`Status ${res.status}, Location ${location || '–'}`];
  });
  return results;
}
