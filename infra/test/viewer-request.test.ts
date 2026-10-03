import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// CloudFront Function nina-pm-viewer-request (TK 4.3): SPA-Rewrite, API/Katalog/Downloads unverändert.
const source = readFileSync(new URL('../edge/nina-pm-viewer-request.js', import.meta.url), 'utf8');

const handler = new Function(`${source}\nreturn handler;`)() as (event: {
  request: { uri: string };
}) => {
  uri: string;
};

describe('nina-pm-viewer-request', () => {
  it.each([
    ['/', '/index.html'],
    ['/projects', '/index.html'],
    ['/projects/42/edit', '/index.html'],
    ['/index.html', '/index.html'],
    ['/assets/abc/app.js', '/assets/abc/app.js'],
    ['/favicon.ico', '/favicon.ico'],
    ['/nina-plugin-logo.png', '/nina-plugin-logo.png'],
    ['/api/health', '/api/health'],
    ['/api/web/v1/projects', '/api/web/v1/projects'],
    ['/catalog/img/m31', '/catalog/img/m31'],
    ['/downloads/nina-sequences/1.0.0/night', '/downloads/nina-sequences/1.0.0/night'],
  ])('%s → %s', (uri, expected) => {
    expect(handler({ request: { uri } }).uri).toBe(expected);
  });
});
