/** S-01 und Sitzung im Browser (AP-06a, TK 17): Test-Login → Mandantenauswahl → Startseite; Abmelden wirkt tabübergreifend. */
import { expect, test } from '@playwright/test';
import { testLogin } from './support';

test('anonym: Einstiegsseite mit „Mit Discord anmelden“ und Rücksprung', async ({ page }) => {
  await page.goto('/?next=/projekte');
  const button = page.getByRole('link', { name: 'Mit Discord anmelden' });
  await expect(button).toHaveAttribute('href', '/api/auth/discord/start?next=%2Fprojekte');
  await expect(page.getByRole('link', { name: 'Datenschutzerklärung' })).toHaveAttribute(
    'href',
    '/datenschutz',
  );
  await page.goto('/?anmeldung=fehler');
  await expect(page.getByRole('alert')).toBeVisible();
});

test('Test-Login (Super User) → Mandantenauswahl → System → Startseite', async ({ page }) => {
  await testLogin(page, 'superuser');
  await page.goto('/');
  await expect(page).toHaveURL(/\/mandant-waehlen$/);
  await expect(page.getByRole('heading', { name: 'Mandant wählen' })).toBeVisible();
  await page.getByRole('button', { name: /System/ }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: 'System-Kontext' })).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Hauptnavigation' }).getByText('System'),
  ).toBeVisible();
});

test('Test-Login (Owner) → Startseite im Mandanten, Rolle im Benutzermenü, Mandant wechseln', async ({
  page,
}) => {
  await testLogin(page, 'owner');
  await page.goto('/');
  await expect(page.getByText(/^Demo-Sternfreunde · /)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Benutzermenü' })).toContainText('(Owner)');
  // Administration nur für Admins (useCan member.manage).
  await expect(
    page.getByRole('navigation', { name: 'Hauptnavigation' }).getByText('Administration'),
  ).toBeVisible();
});

test('User sieht keine Administration', async ({ page }) => {
  await testLogin(page, 'user1');
  await page.goto('/');
  await expect(page.getByText(/^Demo-Sternfreunde · /)).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Hauptnavigation' }).getByText('Administration'),
  ).toHaveCount(0);
});

test('Abmelden in einem Tab wirkt im zweiten mit der nächsten Anfrage (TK 17)', async ({
  context,
}) => {
  const a = await context.newPage();
  await testLogin(a, 'owner');
  const b = await context.newPage();
  await a.goto('/');
  await b.goto('/');
  await expect(b.getByText(/^Demo-Sternfreunde · /)).toBeVisible();
  // Startseite „Heute“ (AP-73) lädt nach: erst wenn Tab B ruht, abmelden – sonst leitet eine noch laufende Abfrage
  // von B nach dem Abmelden selbst zur Anmeldung weiter und bricht das Neuladen ab (gewolltes 401-Verhalten).
  await b.waitForLoadState('networkidle');
  await a.getByRole('button', { name: 'Benutzermenü' }).click();
  await a.getByRole('menuitem', { name: 'Abmelden', exact: true }).click();
  await expect(a.getByRole('link', { name: 'Mit Discord anmelden' })).toBeVisible();
  // „Nächste Anfrage“ kann auch eine eigene Abfrage von B sein (Fokuswechsel, Nachladen der Startseite): Deren 401
  // leitet B selbst zur Anmeldung um und bricht ein gleichzeitiges Neuladen ab (CI #341: `Not attached to an active
  // page`, vorher `ERR_ABORTED`). Beides ist das gewollte Verhalten – entscheidend ist, dass B danach abgemeldet ist.
  await b.reload().catch((e: unknown) => {
    if (
      !/ERR_ABORTED|Not attached|frame was detached|interrupted by another navigation/.test(
        String(e),
      )
    )
      throw e;
  });
  await expect(b.getByRole('link', { name: 'Mit Discord anmelden' })).toBeVisible();
});

test('Überall abmelden nur über den ConfirmDialog; Abbrechen hat den Fokus', async ({ page }) => {
  await testLogin(page, 'owner');
  await page.goto('/');
  await page.getByRole('button', { name: 'Benutzermenü' }).click();
  await page.getByRole('menuitem', { name: 'Überall abmelden' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Überall abmelden?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Abbrechen' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(/^Demo-Sternfreunde · /)).toBeVisible();
  await page.getByRole('button', { name: 'Benutzermenü' }).click();
  await page.getByRole('menuitem', { name: 'Überall abmelden' }).click();
  await page.getByRole('button', { name: 'Sitzungen beenden' }).click();
  await expect(page.getByRole('link', { name: 'Mit Discord anmelden' })).toBeVisible();
});

test('Einladungslink ohne Token zeigt den Hinweis; Token wird aus der Adresszeile entfernt', async ({
  page,
}) => {
  await page.goto('/einladung');
  await expect(page.getByText('Der Einladungslink ist unvollständig')).toBeVisible();
  // Ein Einladungslink wird immer frisch geöffnet (neue Seite), nicht nur das Fragment gewechselt.
  await page.goto('/datenschutz');
  await page.goto(`/einladung#${'A'.repeat(43)}`);
  await expect(page.getByRole('alert')).toContainText('Einladung ungültig');
  expect(page.url()).not.toContain('#');
});
