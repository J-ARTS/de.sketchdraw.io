import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function openSettings(page: Page) {
  await page.getByTestId('workspace-menu-button').click();
  await page.getByRole('menu', { name: 'Arbeitsbereich' }).getByRole('menuitem', { name: 'Einstellungen' }).click();
  return page.getByRole('dialog', { name: 'Einstellungen' });
}
const canvasColor = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
  await page.goto('/');
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
});

test('the canvas background is chosen in the settings, follows the theme and persists', async ({ page }) => {
  const initial = await canvasColor(page);
  const dialog = await openSettings(page);
  await expect(dialog).toBeVisible();
  const group = dialog.getByRole('radiogroup', { name: 'Canvas-Hintergrund' });
  await expect(group.getByRole('radio', { name: 'Standard' })).toHaveAttribute('aria-checked', 'true');

  await group.getByRole('radio', { name: 'Hellgelb' }).click();
  await expect(group.getByRole('radio', { name: 'Hellgelb' })).toHaveAttribute('aria-checked', 'true');
  const yellow = await canvasColor(page);
  expect(yellow).not.toBe(initial);
  expect(yellow).toBe('rgb(255, 251, 230)');

  // The preset has a tuned dark variant.
  await dialog.getByRole('radio', { name: 'Dunkel' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await canvasColor(page)).toBe('rgb(33, 30, 15)');

  // A custom color wins; the dialog stays keyboard operable and accessible.
  await group.getByRole('radio', { name: 'Eigene Farbe' }).click();
  await expect(dialog.getByRole('textbox').first()).toBeVisible();
  expect((await new AxeBuilder({ page }).include('[data-testid=settings-dialog]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);

  await group.getByRole('radio', { name: 'Hellblau' }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('workspace-menu-button')).toBeFocused();

  // Persisted preferences survive a reload (theme and background).
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await canvasColor(page)).toBe('rgb(17, 26, 38)');
  const again = await openSettings(page);
  await again.getByRole('radio', { name: 'Standard' }).click();
  expect(await canvasColor(page)).not.toBe('rgb(17, 26, 38)');
});

test('the language sits in the user menu; unavailable translations are listed but disabled', async ({ page }) => {
  await page.getByTestId('workspace-menu-button').click();
  const menu = page.getByRole('menu', { name: 'Arbeitsbereich' });
  const languages = menu.getByRole('group', { name: 'Sprache' });
  await expect(languages.getByRole('menuitemradio', { name: 'Deutsch' })).toHaveAttribute('aria-checked', 'true');
  const english = languages.getByRole('menuitemradio', { name: /English/ });
  await expect(english).toHaveAttribute('aria-disabled', 'true');
  await english.click({ force: true });
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(languages.getByRole('menuitemradio', { name: 'Deutsch' })).toHaveAttribute('aria-checked', 'true');
});
