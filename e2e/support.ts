import type { Page } from '@playwright/test';

export const csrf = { 'X-NPM-Request': '1' };

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
