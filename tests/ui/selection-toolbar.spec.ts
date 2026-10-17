import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// #37: properties live in a floating toolbar above the selection.
async function drawRectangle(page: Page, from = [350, 300], to = [550, 420]) {
  await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
  await page.mouse.move(from[0]!, from[1]!); await page.mouse.down(); await page.mouse.move(to[0]!, to[1]!, { steps: 8 }); await page.mouse.up();
  await expect(page.locator('.whiteboard-canvas [data-kind=rectangle]')).toHaveCount(1);
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
  await page.goto('/'); await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
});

test('the toolbar floats centered above the selection and edits style through popovers', async ({ page }) => {
  await expect(page.getByRole('toolbar', { name: 'Eigenschaften' })).toHaveCount(0);
  await drawRectangle(page);
  const bar = page.getByRole('toolbar', { name: 'Eigenschaften' });
  const box = (await bar.boundingBox())!;
  expect(box.y + box.height).toBeLessThan(300);
  expect(Math.abs(box.x + box.width / 2 - 450)).toBeLessThan(4);

  await bar.getByRole('button', { name: 'Farbe' }).click();
  const color = page.getByRole('group', { name: 'Farbe', exact: true });
  await expect(color).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await color.getByRole('button', { name: 'Füllung Hellrot' }).click();
  await expect(color.getByRole('button', { name: 'Füllung Hellrot' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(color).toHaveCount(0); await expect(bar.getByRole('button', { name: 'Farbe' })).toBeFocused();

  await bar.getByRole('button', { name: /^Schriftgröße/ }).click();
  await page.getByRole('button', { name: /^Groß/ }).click();
  await expect(bar.getByRole('button', { name: 'Schriftgröße: Groß' })).toBeVisible();

  await bar.getByRole('button', { name: 'Weitere Eigenschaften' }).click();
  await page.getByRole('button', { name: 'Löschen', exact: true }).click();
  await expect(page.locator('.whiteboard-canvas [data-kind=rectangle]')).toHaveCount(0);
  await expect(bar).toHaveCount(0);
});

test('the toolbar hides while editing text and stays inside a compact viewport', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 720 });
  await drawRectangle(page, [180, 330], [300, 420]);
  const bar = page.getByRole('toolbar', { name: 'Eigenschaften' });
  const box = (await bar.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(480);
  await bar.getByRole('button', { name: 'Text bearbeiten' }).click();
  await expect(page.getByTestId('canvas-text-editor')).toBeVisible();
  await expect(bar).toHaveCount(0);
});
