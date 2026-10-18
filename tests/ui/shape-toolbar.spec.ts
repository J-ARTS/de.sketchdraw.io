import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('sketchdraw.shape-toolbar.v1'));
  await page.reload();
});

test('more shapes activates every catalog form and draws the selected variant', async ({ page }) => {
  await page.getByTestId('more-shapes').click();
  const catalog = page.getByTestId('shape-catalog');
  await expect(catalog).toBeVisible();
  await catalog.getByRole('searchbox', { name: 'Form suchen' }).fill('sechseck');
  await catalog.getByRole('button', { name: 'Sechseck' }).click();
  await page.mouse.move(320, 260); await page.mouse.down(); await page.mouse.move(480, 360); await page.mouse.up();
  await expect(page.locator('.whiteboard-canvas [data-shape-variant=hexagon]')).toHaveCount(1);
});

test('the shape bar supports editing, drag reorder, keyboard removal and persistence', async ({ page }) => {
  await page.getByTestId('more-shapes').click();
  const catalog = page.getByTestId('shape-catalog');
  await catalog.getByRole('button', { name: 'Leiste anpassen' }).click();
  await catalog.getByRole('button', { name: 'Sechseck' }).dragTo(page.getByTestId('shape-favorites'));
  const hexagon = page.getByRole('toolbar', { name: 'Werkzeuge' }).getByRole('button', { name: /Sechseck/ });
  await expect(hexagon).toBeVisible();

  const rectangle = page.getByRole('toolbar', { name: 'Werkzeuge' }).getByRole('button', { name: /^Rechteck/ });
  await rectangle.evaluate((target) => {
    const source = document.querySelector<HTMLElement>('[data-testid=shape-favorites] [data-shape=hexagon]')!;
    const dataTransfer = new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
  });
  await expect(page.locator('[data-testid=shape-favorites] [data-shape]').first()).toHaveAttribute('data-shape', 'hexagon');

  await hexagon.focus();
  await page.keyboard.press('Delete');
  await expect(hexagon).toHaveCount(0);
  await catalog.getByRole('button', { name: 'Standard wiederherstellen' }).click();
  await expect(page.getByTestId('shape-favorites').locator('[data-shape]')).toHaveCount(7);

  await page.locator('[data-testid=shape-favorites] [data-shape=cylinder]').evaluate((source) => {
    const dataTransfer = new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, clientX: 600, clientY: 30, dataTransfer }));
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, clientX: 0, clientY: 500, dataTransfer }));
  });
  await expect(page.locator('[data-testid=shape-favorites] [data-shape=cylinder]')).toHaveCount(0);
  await catalog.getByRole('button', { name: 'Standard wiederherstellen' }).click();

  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.reload();
  await expect(page.getByTestId('shape-favorites').locator('[data-shape]')).toHaveCount(7);
});

test('a long press on a favorite opens the same edit mode', async ({ page }) => {
  const rectangle = page.getByRole('button', { name: 'Rechteck', exact: true });
  const box = (await rectangle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(550);
  await page.mouse.up();
  await expect(page.getByTestId('shape-catalog').getByRole('button', { name: 'Fertig' })).toBeVisible();
});
