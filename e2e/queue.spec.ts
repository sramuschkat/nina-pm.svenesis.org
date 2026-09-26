/**
 * AP-12c: S-33 Warteschlange gegen den lokalen Stack: User stimmt ab, Admin gibt frei, der
 * Freigabe-Verlauf zeigt den Endstand der Stimmen; axe hell/dunkel; 768/2400 px.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { WIDE, csrf, tableOverflow, testLogin } from './support';

async function submittedProject(page: Page, name: string): Promise<string> {
  const rigs = (await (await page.request.get('/api/web/v1/rigs')).json()) as {
    items: { id: string }[];
  };
  const filters = (await (await page.request.get('/api/web/v1/filters')).json()) as {
    items: { id: string; shortName: string }[];
  };
  const id = crypto.randomUUID();
  const res = await page.request.post('/api/web/v1/projects', {
    headers: csrf,
    data: { id, name, rigId: rigs.items[0]?.id, raDeg: 13.2, decDeg: 56.6 },
  });
  expect(res.status()).toBe(201);
  const panel = ((await res.json()) as { panels: { id: string }[] }).panels[0]?.id;
  await page.request.post(`/api/web/v1/projects/${id}/lines`, {
    headers: csrf,
    data: {
      id: crypto.randomUUID(),
      panelId: panel,
      filterId: filters.items.find((f) => f.shortName === 'Ha')?.id,
      exposureS: 300,
      plannedCount: 40,
      moonMode: 'none',
    },
  });
  const sub = await page.request.post(`/api/web/v1/projects/${id}/submit`, {
    headers: csrf,
    data: { requestComment: 'Gern bald' },
  });
  expect(sub.status()).toBe(200);
  return id;
}

test('S-33: User stimmt ab, Admin gibt frei, Verlauf zeigt die Stimmen', async ({ browser }) => {
  const submitter = await (await browser.newContext()).newPage();
  await testLogin(submitter, 'user1');
  const name = `E2E-Warteschlange ${String(Date.now())}`;
  const id = await submittedProject(submitter, name);

  const voter = await (await browser.newContext({ viewport: WIDE })).newPage();
  await testLogin(voter, 'user2');
  await voter.goto('/projekte/warteschlange');
  const row = voter.getByRole('row').filter({ hasText: name });
  await expect(row).toContainText('Ha 40 × 300 s');
  await expect(row.getByRole('button', { name: 'Entscheiden' })).toHaveCount(0);
  const vote = row.getByRole('button', { name: `Für „${name}“ stimmen` });
  await vote.click();
  await expect(vote).toHaveAttribute('aria-pressed', 'true');
  await expect(row).toContainText(/Uta|User|user2/i);

  // Einreicher kann nicht für das eigene Objekt stimmen.
  await submitter.goto('/projekte/warteschlange');
  await expect(
    submitter.getByRole('button', { name: `Eigenes Objekt „${name}“ – keine Stimme möglich` }),
  ).toBeDisabled();

  const admin = await (await browser.newContext()).newPage();
  await testLogin(admin, 'owner');
  await admin.goto('/projekte/warteschlange');
  await admin
    .getByRole('row')
    .filter({ hasText: name })
    .getByRole('button', { name: 'Entscheiden' })
    .click();
  const panel = admin.getByRole('region', { name: `Entscheidung: „${name}“` });
  await expect(panel).toContainText('Gern bald');
  await panel.getByLabel('Kommentar').fill('Passt gut in den Herbst');
  await panel.getByRole('button', { name: 'Freigeben' }).click();
  await expect(admin.getByRole('row').filter({ hasText: name })).toHaveCount(0);

  await admin.goto(`/projekte/${id}`);
  await admin.getByRole('tab', { name: 'Freigabe-Verlauf' }).click();
  const approved = admin.getByRole('row').filter({ hasText: 'Freigegeben · Stimmen: 1' });
  await expect(approved).toContainText('Passt gut in den Herbst');
  const history = (await (
    await admin.request.get(`/api/web/v1/projects/${id}/history`)
  ).json()) as {
    items: { action: string; detail: { votes?: { count: number } } }[];
  };
  expect(history.items.find((h) => h.action === 'approved')?.detail.votes?.count).toBe(1);
});

for (const theme of ['light', 'dark'] as const) {
  test(`S-33 a11y ${theme}`, async ({ page }) => {
    await page.addInitScript((t) => window.localStorage.setItem('npm.theme', t), theme);
    await testLogin(page, 'user1');
    await submittedProject(page, `E2E-a11y-Queue ${theme} ${String(Date.now())}`);
    await testLogin(page, 'owner');
    await page.goto('/projekte/warteschlange');
    await expect(page.getByRole('status').filter({ hasText: 'Wird geladen' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Entscheiden' }).first().click();
    const result = await new AxeBuilder({ page }).analyze();
    const serious = result.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      serious.map((v) => `${v.id} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`),
    ).toEqual([]);
  });
}

for (const width of [768, 1280, 2400]) {
  test(`S-33 bei ${String(width)} px ohne horizontales Scrollen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await testLogin(page, 'user1');
    await submittedProject(page, `E2E-Breite-Queue ${String(width)} ${String(Date.now())}`);
    await testLogin(page, 'owner');
    await page.goto('/projekte/warteschlange');
    await expect(page.getByRole('status').filter({ hasText: 'Wird geladen' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Entscheiden' }).first().click();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    expect(await tableOverflow(page)).toEqual([]);
  });
}
