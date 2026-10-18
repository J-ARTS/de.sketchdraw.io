import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('sketchdraw.shape-toolbar.v1'));
  await page.reload();
});

test('Weitere Formen opens a searchable sidebar and activates every catalog shape', async ({ page }) => {
  await page.getByTestId('more-shapes').click();
  const sidebar = page.getByTestId('shape-library-sidebar');
  await expect(sidebar).toBeVisible();
  await expect(page.getByTestId('shape-catalog')).toHaveCount(0);
  const search = sidebar.getByRole('searchbox', { name: 'Formen durchsuchen' });
  await expect(search).toBeFocused();
  await search.fill('sechseck');
  await sidebar.getByRole('button', { name: 'Sechseck' }).click();
  await expect(sidebar).toHaveCount(0);
  await page.mouse.move(320, 260); await page.mouse.down(); await page.mouse.move(480, 360); await page.mouse.up();
  await expect(page.locator('.whiteboard-canvas [data-shape-variant=hexagon]')).toHaveCount(1);
});

test('the sidebar searches and inserts official AWS and Kubernetes components', async ({ page }) => {
  await page.getByTestId('more-shapes').click();
  const sidebar = page.getByTestId('shape-library-sidebar');
  const search = sidebar.getByRole('searchbox', { name: 'Formen durchsuchen' });
  await search.fill('Lambda');
  await sidebar.getByRole('button', { name: /AWS Lambda/ }).click();
  await expect(page.locator('[data-kind=component]')).toHaveCount(1);

  await search.fill('');
  await sidebar.getByRole('button', { name: /^Kubernetes 8 Symbole/ }).click();
  await expect(sidebar.getByRole('heading', { name: 'Kubernetes' })).toBeVisible();
  await expect(sidebar.getByRole('button', { name: /Pod/ })).toBeVisible();
  await sidebar.getByRole('button', { name: /Pod/ }).click();
  await expect(page.locator('[data-kind=component]')).toHaveCount(2);
});

test('the shared shape bar state supports drag, keyboard removal, reset and persistence', async ({ page }) => {
  await page.getByTestId('more-shapes').click();
  const sidebar = page.getByTestId('shape-library-sidebar');
  await sidebar.getByRole('button', { name: 'Leiste anpassen' }).click();
  const search = sidebar.getByRole('searchbox', { name: 'Formen durchsuchen' });
  await search.fill('sechseck');
  await sidebar.getByRole('button', { name: /Sechseck/ }).dragTo(page.getByTestId('shape-favorites'));
  const toolbar = page.getByRole('toolbar', { name: 'Werkzeuge' });
  const hexagon = toolbar.getByRole('button', { name: /Sechseck/ });
  await expect(hexagon).toBeVisible();

  const rectangle = toolbar.getByRole('button', { name: /^Rechteck/ });
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
  await sidebar.getByRole('button', { name: 'Standard wiederherstellen' }).click();
  await expect(page.getByTestId('shape-favorites').locator('[data-shape]')).toHaveCount(7);

  await page.locator('[data-testid=shape-favorites] [data-shape=cylinder]').evaluate((source) => {
    const dataTransfer = new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, clientX: 600, clientY: 30, dataTransfer }));
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, clientX: 0, clientY: 500, dataTransfer }));
  });
  await expect(page.locator('[data-testid=shape-favorites] [data-shape=cylinder]')).toHaveCount(0);
  await sidebar.getByRole('button', { name: 'Standard wiederherstellen' }).click();

  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.reload();
  await expect(page.getByTestId('shape-favorites').locator('[data-shape]')).toHaveCount(7);
});

test('Escape closes the non-modal sidebar, clears edit mode and restores focus', async ({ page }) => {
  const opener = page.getByTestId('more-shapes');
  await opener.click();
  const sidebar = page.getByTestId('shape-library-sidebar');
  await sidebar.getByRole('button', { name: 'Leiste anpassen' }).click();
  await page.keyboard.press('Escape');
  await expect(sidebar).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(page.getByRole('toolbar', { name: 'Werkzeuge' })).not.toHaveClass(/editing/);
});

test('a long press opens the same edit mode and compact screens keep the sidebar reachable', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 720 });
  const rectangle = page.getByRole('button', { name: 'Rechteck', exact: true });
  const box = (await rectangle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(550);
  await page.mouse.up();
  const sidebar = page.getByTestId('shape-library-sidebar');
  await expect(sidebar.getByRole('button', { name: 'Fertig' })).toBeVisible();
  const sidebarBox = (await sidebar.boundingBox())!;
  expect(sidebarBox.x).toBeGreaterThanOrEqual(0);
  expect(sidebarBox.x + sidebarBox.width).toBeLessThanOrEqual(480);
});
