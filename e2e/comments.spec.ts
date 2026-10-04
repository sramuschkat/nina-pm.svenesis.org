/**
 * FA-PRJ-17: Kommentare am Projekt gegen den lokalen Stack – Reiter *Kommentare* im Editor, Emoji aus der
 * Auswahl, Reaktion umschalten, Antwort eingerückt unter dem Strang, Sprechblase mit Zahl in der Projektliste;
 * axe auf dem Reiter.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { csrf, testLogin, WIDE } from './support';

test('Kommentar mit Emoji, Reaktion, Antwort; Anzahl in der Projektliste', async ({ page }) => {
  await page.setViewportSize(WIDE);
  await testLogin(page, 'owner');
  const name = `E2E-Kommentare ${String(Date.now())}`;
  const created = await page.request.post('/api/web/v1/projects', {
    data: { id: crypto.randomUUID(), name },
    headers: csrf,
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };

  await page.goto(`/projekte/${id}`);
  await page.getByRole('tab', { name: 'Kommentare' }).click();
  await expect(page.getByText('Noch keine Kommentare.')).toBeVisible();

  const field = page.getByLabel('Neuer Kommentar (Markdown, Emoji erlaubt)');
  await field.fill('Framing passt ');
  await page.getByRole('button', { name: 'Emoji einfügen' }).first().click();
  await page
    .getByRole('group', { name: 'Emoji einfügen' })
    .getByRole('button', { name: '🔭' })
    .click();
  await expect(field).toHaveValue('Framing passt 🔭');
  await page.getByRole('button', { name: 'Kommentieren' }).click();
  await expect(page.getByText('Framing passt 🔭')).toBeVisible();
  await expect(field).toHaveValue('');

  // Reaktion setzen und wieder entfernen.
  await page.getByRole('button', { name: 'Reaktion hinzufügen' }).click();
  await page
    .getByRole('group', { name: 'Reaktion hinzufügen' })
    .getByRole('button', { name: '🎉' })
    .click();
  const party = page.getByRole('button', { name: 'Reaktion 🎉: 1' });
  await expect(party).toHaveAttribute('aria-pressed', 'true');

  // Antwort eingerückt unter dem Strang.
  await page.getByRole('button', { name: 'Antworten' }).click();
  await page.getByLabel(/^Antwort an /).fill('Danke!');
  await page.getByRole('button', { name: 'Antwort senden' }).click();
  const replies = page.getByRole('list', { name: /^Antworten auf den Kommentar von / });
  await expect(replies.getByText('Danke!')).toBeVisible();

  const results = await new AxeBuilder({ page }).include('main').analyze();
  expect(
    results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
  ).toEqual([]);

  await party.click();
  await expect(page.getByRole('button', { name: /^Reaktion 🎉/ })).toHaveCount(0);

  // Projektliste: Sprechblase mit Zahl neben dem Namen.
  await page.goto('/projekte');
  const row = page.getByRole('row', { name: new RegExp(name) });
  await expect(row.getByRole('img', { name: 'Kommentare: 2' })).toBeVisible();
});
