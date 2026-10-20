import { expect, test, type Page } from '@playwright/test';

async function rectangle(page: Page, x: number, y: number) {
  await page.keyboard.press('r');
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 90, y + 60, { steps: 4 }); await page.mouse.up();
  await page.keyboard.press('Escape');
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => { throw error; });
  await page.goto('/');
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
});

test('the order of the objects changes by drag and drop and by keyboard, one undo step each', async ({ page }) => {
  await rectangle(page, 300, 300); await rectangle(page, 450, 300); await rectangle(page, 600, 300);
  await page.getByTestId('objects-toggle').click();
  const rows = page.getByTestId('object-list').locator('li');
  await expect(rows).toHaveCount(3);
  const ids = () => rows.evaluateAll((items) => items.map((item) => item.getAttribute('data-object-id')));
  const canvasOrder = () => page.locator('.whiteboard-canvas [data-kind=rectangle]').evaluateAll((items) => items.map((item) => item.getAttribute('data-element-id')));
  const [first, second, third] = (await ids()) as string[];

  // Drag the first object below the last one: it becomes the front-most element.
  await rows.nth(0).dragTo(rows.nth(2), { targetPosition: { x: 20, y: 30 } });
  await expect.poll(ids).toEqual([second, third, first]);
  await expect.poll(canvasOrder).toEqual([second, third, first]);

  // Alt+Up moves the focused object one position towards the back.
  await rows.nth(2).getByRole('button').focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect.poll(ids).toEqual([second, first, third]);
  await expect(rows.nth(1).getByRole('button')).toBeFocused();

  // Each change is one undo step.
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect.poll(ids).toEqual([second, third, first]);
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect.poll(ids).toEqual([first, second, third]);
});
