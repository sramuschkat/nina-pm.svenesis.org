import { describe, expect, it } from 'vitest';
import { headerProblems, runSmoke } from '../src/smoke';

const HTML_HEADERS = {
  'content-type': 'text/html',
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'",
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'x-content-type-options': 'nosniff',
};
const API_HEADERS = {
  'content-security-policy': "default-src 'none'; sandbox; frame-ancestors 'none'; base-uri 'none'",
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'cross-origin-resource-policy': 'same-origin',
};
const EXECUTE_API = 'https://abc.execute-api.eu-central-1.amazonaws.com';

interface Hit {
  status: number;
  headers: Record<string, string>;
  body?: string;
}

/** Gefälschtes prod: CloudFront vor HTTP API und Web-Bucket; `overrides` je Pfad bzw. `http`/`direct`. */
function fakeFetch(overrides: Record<string, Hit> = {}) {
  return (url: string) => {
    const path = new URL(url).pathname;
    let hit: Hit;
    if (url.startsWith('http:')) {
      hit = overrides.http ?? {
        status: 301,
        headers: { location: url.replace('http:', 'https:') },
      };
    } else if (url.startsWith(EXECUTE_API)) {
      hit = overrides.direct ?? { status: 403, headers: {} };
    } else if (overrides[path]) {
      hit = overrides[path];
    } else if (path === '/api/health') {
      hit = {
        status: 200,
        headers: API_HEADERS,
        body: '{"status":"ok","engineVersion":"0.0.0","build":"x"}',
      };
    } else if (path === '/api/auth/discord/start') {
      hit = {
        status: 302,
        headers: {
          ...API_HEADERS,
          location:
            'https://discord.com/oauth2/authorize?client_id=1&state=s&code_challenge=c&code_challenge_method=S256&redirect_uri=https%3A%2F%2Fnina-pm.svenesis.org%2Fapi%2Fauth%2Fdiscord%2Fcallback',
          'set-cookie': '__Host-npm_oauth=x.y; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600',
        },
      };
    } else if (/^\/(api|catalog|downloads)\//.test(path)) {
      hit = { status: 404, headers: API_HEADERS };
    } else {
      hit = { status: 200, headers: HTML_HEADERS };
    }
    return Promise.resolve(
      new Response(hit.body ?? null, { status: hit.status, headers: hit.headers }),
    );
  };
}

const direct = { executeApiUrl: EXECUTE_API };
const failed = (results: { ok: boolean; name: string }[]) =>
  results.filter((r) => !r.ok).map((r) => r.name);

describe('headerProblems', () => {
  it('akzeptiert die Header nach iam.md §10', () => {
    expect(headerProblems('npm-html', new Headers(HTML_HEADERS))).toEqual([]);
    expect(headerProblems('npm-api-static', new Headers(API_HEADERS))).toEqual([]);
  });

  it("meldet 'unsafe-inline' in script-src", () => {
    const headers = new Headers({
      ...HTML_HEADERS,
      'content-security-policy':
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
    });
    expect(headerProblems('npm-html', headers)).toContain(
      "CSP: script-src enthält 'unsafe-inline'",
    );
  });

  it('meldet fehlende harte CSP und CORP auf /api', () => {
    const problems = headerProblems('npm-api-static', new Headers(HTML_HEADERS));
    expect(problems).toContain("CSP: default-src ist nicht 'none'");
    expect(problems).toContain('Cross-Origin-Resource-Policy fehlt');
  });
});

describe('runSmoke', () => {
  it('ist grün, wenn alles stimmt', async () => {
    const results = await runSmoke('https://nina-pm.svenesis.org', fakeFetch(), direct);
    expect(failed(results)).toEqual([]);
    expect(results).toHaveLength(10);
  });

  it('ist rot, wenn der Test-Login in prod antwortet oder der Discord-Redirect fehlt', async () => {
    const results = await runSmoke(
      'https://nina-pm.svenesis.org',
      fakeFetch({
        '/api/auth/test-login': { status: 200, headers: API_HEADERS },
        '/api/auth/discord/start': { status: 404, headers: API_HEADERS },
      }),
      direct,
    );
    expect(failed(results)).toEqual([
      'POST /api/auth/test-login → 404 (Test-Login nur lokal, TK 17)',
      'Anmeldung leitet zu Discord weiter (state, PKCE S256, __Host-npm_oauth)',
    ]);
  });

  it('ist rot, wenn / nicht 200 liefert oder HTTP nicht umleitet', async () => {
    const results = await runSmoke(
      'https://nina-pm.svenesis.org',
      fakeFetch({
        '/': { status: 403, headers: HTML_HEADERS },
        http: { status: 200, headers: {} },
      }),
      direct,
    );
    expect(failed(results)).toEqual([
      'GET / liefert die Seite mit npm-html',
      'HTTP wird auf HTTPS umgeleitet',
    ]);
  });

  it('ist rot, wenn /api/health nicht ok meldet', async () => {
    const results = await runSmoke(
      'https://nina-pm.svenesis.org',
      fakeFetch({ '/api/health': { status: 500, headers: API_HEADERS } }),
      direct,
    );
    expect(failed(results)).toEqual(['GET /api/health über CloudFront → 200 mit status ok']);
  });

  it('ist rot, wenn der Direktaufruf nicht 403 liefert', async () => {
    const results = await runSmoke(
      'https://nina-pm.svenesis.org',
      fakeFetch({ direct: { status: 200, headers: {} } }),
      direct,
    );
    expect(failed(results)).toEqual(['Direktaufruf der execute-api-Adresse → 403']);
  });

  it('ist rot, wenn die execute-api-Adresse fehlt', async () => {
    const results = await runSmoke('https://nina-pm.svenesis.org', fakeFetch());
    expect(failed(results)).toEqual(['Direktaufruf der execute-api-Adresse → 403']);
  });
});
