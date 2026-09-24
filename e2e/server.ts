/**
 * Prod-naher Stack für Playwright (AP-06a, iam.md §10): liefert die **gebaute** SPA mit genau den Headern
 * der Response-Headers-Policy `npm-html` (Wortlaut aus infra/lib/headers.ts) und leitet `/api/*` an den
 * lokalen Node-Adapter der API weiter – wie CloudFront in prod (gleicher Origin).
 * Einzige Abweichung: `upgrade-insecure-requests` entfällt, weil der Test über http://localhost läuft.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HSTS_MAX_AGE_SECONDS, HTML_CSP, PERMISSIONS_POLICY } from '../infra/lib/headers';

const PORT = Number(process.env.PORT ?? 4173);
const API_PORT = Number(process.env.API_PORT ?? 8787);
const DIST = fileURLToPath(
  new URL(`../apps/web/${process.env.WEB_DIST ?? 'dist-e2e'}/`, import.meta.url),
);

export const TEST_CSP = HTML_CSP.split('; ')
  .filter((d) => d !== 'upgrade-insecure-requests')
  .join('; ');

const HTML_HEADERS: Record<string, string> = {
  'content-security-policy': TEST_CSP,
  'strict-transport-security': `max-age=${HSTS_MAX_AGE_SECONDS}; includeSubDomains`,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': PERMISSIONS_POLICY,
  'cross-origin-opener-policy': 'same-origin',
};

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
  '.json': 'application/json',
};

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const upstream = request(
      {
        host: '127.0.0.1',
        port: API_PORT,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on('error', () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
    return;
  }
  // Wie die CloudFront Function: Pfade ohne Dateiendung sind Client-Routen der SPA (TK 4.3).
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, rel);
  if (!extname(rel) || !existsSync(file) || statSync(file).isDirectory())
    file = join(DIST, 'index.html');
  res.writeHead(existsSync(file) ? 200 : 404, {
    ...HTML_HEADERS,
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
  });
  if (existsSync(file)) createReadStream(file).pipe(res);
  else res.end();
}).listen(PORT, () => {
  console.log(`e2e-Server auf http://localhost:${PORT} (SPA ${DIST}, API :${API_PORT})`);
});
