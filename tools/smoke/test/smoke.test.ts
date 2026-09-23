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

function fakeFetch(
  overrides: Record<string, { status: number; headers: Record<string, string> }> = {},
) {
  return (url: string) => {
    const path = new URL(url).pathname;
    const isHttp = url.startsWith('http:');
    const hit =
      overrides[isHttp ? 'http' : path] ??
      (isHttp
        ? { status: 301, headers: { location: url.replace('http:', 'https:') } }
        : /^\/(api|catalog|downloads)\//.test(path)
          ? { status: 404, headers: API_HEADERS }
          : { status: 200, headers: HTML_HEADERS });
    return Promise.resolve(new Response(null, { status: hit.status, headers: hit.headers }));
  };
}

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
    const results = await runSmoke('https://nina-pm.svenesis.org', fakeFetch());
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(results).toHaveLength(6);
  });

  it('ist rot, wenn / nicht 200 liefert oder HTTP nicht umleitet', async () => {
    const results = await runSmoke(
      'https://nina-pm.svenesis.org',
      fakeFetch({
        '/': { status: 403, headers: HTML_HEADERS },
        http: { status: 200, headers: {} },
      }),
    );
    expect(results.filter((r) => !r.ok).map((r) => r.name)).toEqual([
      'GET / liefert die Seite mit npm-html',
      'HTTP wird auf HTTPS umgeleitet',
    ]);
  });
});
