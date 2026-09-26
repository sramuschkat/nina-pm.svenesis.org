import type { Page } from '@playwright/test';

export const csrf = { 'X-NPM-Request': '1' };

/** Breites Fenster für Inhaltsprüfungen: `DataTable` blendet dann keine Spalte aus (AP-26a). */
export const WIDE = { width: 2400, height: 1000 };

/** Test-Login (nur lokaler Node-Adapter, TK 17) mit einer Identität aus docs/seed/seed-demo.json. */
export async function testLogin(page: Page, identityFixture: string): Promise<void> {
  const res = await page.request.post('/api/auth/test-login', {
    data: { identityFixture },
    headers: csrf,
  });
  if (!res.ok()) throw new Error(`Test-Login ${identityFixture}: ${res.status()}`);
}

/** Sammelt CSP-Verstöße der Seite (Konsole und securitypolicyviolation). */
export function collectCspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy|Refused to/i.test(msg.text())) violations.push(msg.text());
  });
  return violations;
}

/**
 * AP-26a: Keine Datentabelle ist breiter als ihr Container (Spalten ausblenden statt horizontal
 * scrollen). Liefert je überlaufender Tabelle ihren Namen und den Überstand in px.
 */
export async function tableOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('table')]
      .filter((t) => t.offsetParent !== null && t.parentElement)
      .map((t) => ({
        name: t.getAttribute('aria-label') ?? t.id,
        over: t.scrollWidth - (t.parentElement?.clientWidth ?? 0),
      }))
      .filter((x) => x.over > 1)
      .map((x) => `${x.name}: ${String(x.over)} px`),
  );
}
