import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
  await page.goto('/');
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
});

test('frames appear as ordered slides and can be presented with keyboard navigation', async ({ page }) => {
  await page.getByRole('button', { name: 'Frame', exact: true }).click();
  await page.mouse.move(260, 230); await page.mouse.down(); await page.mouse.move(740, 500); await page.mouse.up();

  const frame = page.locator('.whiteboard-canvas [data-kind="frame"]').first();
  const sidebar = page.getByTestId('frame-sidebar');
  await expect(frame).toBeVisible();
  await expect(frame.getByTestId('frame-label')).toContainText('Folie 1');
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByText('Folie 1', { exact: true })).toBeVisible();

  await sidebar.getByText('Folie 1', { exact: true }).dblclick();
  const name = sidebar.getByRole('textbox', { name: 'Folienname' });
  await name.fill('Einführung'); await name.press('Enter');
  await expect(frame.getByTestId('frame-label')).toContainText('Einführung');

  await sidebar.getByRole('button', { name: 'Präsentieren' }).click();
  const presenter = page.getByRole('dialog', { name: 'Presenter Mode' });
  await expect(presenter).toBeVisible();
  await expect(presenter.getByText('Einführung', { exact: true })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(presenter.getByText('1 / 1')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(presenter).toHaveCount(0);

  await sidebar.getByRole('button', { name: 'Folienleiste schließen' }).click();
  await expect(page.getByRole('button', { name: 'Folienleiste öffnen' })).toContainText('1');
});
