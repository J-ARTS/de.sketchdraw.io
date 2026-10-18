import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
  await page.goto('/');
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
});

test('plugin settings expose Git and Atlassian while explaining the desktop boundary', async ({ page }) => {
  await page.getByTestId('workspace-menu-button').click();
  await page.getByRole('menuitemcheckbox', { name: 'Plugin-Einstellungen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Plugins' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Git');
  await expect(dialog).toContainText('Atlassian');
  await expect(dialog).toContainText('Electron-Desktop-App');
  await expect(dialog.getByRole('button', { name: 'Speichern' }).first()).toBeDisabled();
  await expect(dialog.getByLabel('API-Token')).toHaveAttribute('type', 'password');
  expect((await new AxeBuilder({ page }).include('.plugin-panel').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await dialog.getByRole('button', { name: 'Plugin-Einstellungen schließen' }).click();
  await expect(dialog).toHaveCount(0);
});
