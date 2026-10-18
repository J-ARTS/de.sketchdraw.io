import { test, expect, type Page } from '@playwright/test';

async function openCollaboration(page: Page) {
  await page.getByTestId('workspace-menu-button').click(); await page.getByRole('menuitemcheckbox', { name: 'Zusammenarbeiten', exact: true }).click();
}
/** The manual, server-free pairing lives in a collapsed section below the session controls. */
async function openManual(page: Page) {
  const details = page.getByTestId('manual-connection');
  if (!(await details.evaluate((element: HTMLDetailsElement) => element.open))) await details.getByText('Manuell ohne Server verbinden', { exact: true }).click();
}

test('manual pairing presents matching identities and requires explicit confirmation', async ({ page, context }) => {
  const guest = await context.newPage();
  for (const target of [page, guest]) {
    await target.goto('/');
    await openCollaboration(target); await openManual(target);
  }
  const ownerPanel = page.getByTestId('collaboration-panel');
  const guestPanel = guest.getByTestId('collaboration-panel');
  await ownerPanel.getByRole('button', { name: 'Einladung erstellen' }).click();
  const invitation = ownerPanel.getByRole('textbox', { name: 'Einladung zum Kopieren' });
  await expect(invitation).not.toHaveValue('');
  await guestPanel.getByRole('button', { name: 'Beitreten', exact: true }).click();
  await guestPanel.getByRole('textbox', { name: 'Einladung einfügen' }).fill(await invitation.inputValue());
  await guestPanel.getByRole('button', { name: 'Einladung prüfen' }).click();
  const answer = guestPanel.getByRole('textbox', { name: 'Antwort zum Kopieren' });
  await expect(answer).not.toHaveValue('');
  await ownerPanel.getByRole('textbox', { name: 'Antwort einfügen' }).fill(await answer.inputValue());
  await ownerPanel.getByRole('button', { name: 'Antwort prüfen' }).click();
  const comparison = await guestPanel.getByLabel('Vergleichscode', { exact: true }).textContent();
  await expect(ownerPanel.getByLabel('Vergleichscode', { exact: true })).toHaveText(comparison!);
  for (const panel of [ownerPanel, guestPanel]) {
    await expect(panel.getByRole('button', { name: 'Identität bestätigen' })).toBeDisabled();
    await panel.getByText('Vollständige Identitäten anzeigen', { exact: true }).click();
    await expect(panel.locator('.fingerprints dd')).toHaveCount(4);
    for (const value of await panel.locator('.fingerprints dd').allTextContents()) expect(value.length).toBeGreaterThan(40);
  }
  await guestPanel.getByRole('button', { name: 'Verbindungsaufbau abbrechen' }).click();
  await expect(guestPanel.getByRole('button', { name: 'Identität bestätigen' })).toHaveCount(0);
  await ownerPanel.getByRole('button', { name: 'Sitzung für alle beenden' }).click();
  await expect(ownerPanel.getByRole('button', { name: 'Einladung erstellen' })).toBeEnabled();
});

test('invalid invitation is rejected with a recoverable explanation', async ({ page }) => {
  await page.goto('/');
  await openCollaboration(page); await openManual(page);
  const panel = page.getByTestId('collaboration-panel');
  await panel.getByRole('button', { name: 'Beitreten', exact: true }).click();
  await panel.getByRole('textbox', { name: 'Einladung einfügen' }).fill('not a signed invitation');
  await panel.getByRole('button', { name: 'Einladung prüfen' }).click();
  await expect(panel.getByRole('alert')).toContainText('vollständig kopierten Text');
  await expect(panel.getByRole('button', { name: 'Einladung prüfen' })).toBeEnabled();
  await expect(panel.getByRole('button', { name: 'Identität bestätigen' })).toHaveCount(0);
});

test('one click starts a session with a shareable link and no mode choice', async ({ page }) => {
  await page.goto('/');
  await openCollaboration(page);
  const panel = page.getByTestId('collaboration-panel');
  await expect(panel.getByRole('button', { name: 'Automatic P2P' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Strict Direct' })).toHaveCount(0);
  await panel.getByTestId('session-start').click();
  const link = panel.getByTestId('session-link');
  await expect(link).toHaveValue(/^https?:\/\/.+#sketchdraw-session=.{80,}/);
  await expect(panel.getByRole('button', { name: 'Link kopieren' })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Session läuft' })).toBeVisible();
  await panel.getByText('Verwendete Endpunkte', { exact: true }).click();
  await expect(panel.locator('.automatic-endpoints')).toContainText('wss://');
  await panel.getByTestId('session-stop').click();
  await expect(panel.getByTestId('session-start')).toBeEnabled();
});

test('an invalid session link is rejected with an explanation', async ({ page }) => {
  await page.goto('/');
  await openCollaboration(page);
  const panel = page.getByTestId('collaboration-panel');
  await panel.getByRole('textbox', { name: 'Session-Link einfügen' }).fill('hallo welt');
  await panel.getByRole('button', { name: 'Session beitreten' }).click();
  await expect(panel.getByRole('alert')).toContainText('kein gültiger Session-Link');
});

test('opening a session link starts the app, removes the fragment and tries to join', async ({ page }) => {
  await page.goto('/#sketchdraw-session=' + encodeURIComponent('A'.repeat(120)));
  const panel = page.getByTestId('collaboration-panel');
  await expect(panel).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('');
  await expect(panel.getByRole('alert')).toBeVisible();
});
