import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  page.on('pageerror', error => { throw error; });
  await page.goto('/');
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
});

test('Ctrl/Cmd+C and Ctrl/Cmd+V paste the selection at the mouse and preserve native text paste', async ({ page }) => {
  const canvas = page.getByTestId('whiteboard-canvas');
  await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
  await page.mouse.move(300, 220); await page.mouse.down(); await page.mouse.move(500, 360); await page.mouse.up();
  await expect(page.locator('[data-kind="rectangle"]')).toHaveCount(1);
  await canvas.focus();
  await page.keyboard.press('ControlOrMeta+c');
  await expect(page.getByRole('region', { name: 'Meldungen' }).getByText('1 Element kopiert.')).toBeVisible();

  await page.mouse.move(820, 610);
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.locator('[data-kind="rectangle"]')).toHaveCount(2);
  const pasted = page.locator('[data-kind="rectangle"]').nth(1);
  const box = (await pasted.boundingBox())!;
  expect(box.x + box.width / 2).toBeCloseTo(820, -1);
  expect(box.y + box.height / 2).toBeCloseTo(610, -1);

  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('[data-kind="rectangle"]')).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.locator('[data-kind="rectangle"]')).toHaveCount(2);

  await page.evaluate(() => navigator.clipboard.writeText('kein Sketchdraw-Inhalt'));
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.locator('[data-kind="rectangle"]')).toHaveCount(2);
  await expect(page.getByRole('region', { name: 'Meldungen' }).getByText('Die Zwischenablage enthält keine Sketchdraw-Elemente.')).toBeVisible();

  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.mouse.click(620, 420);
  const editor = page.getByTestId('canvas-text-editor');
  await editor.fill('A');
  await page.evaluate(() => navigator.clipboard.writeText('B'));
  await editor.press('End');
  await editor.press('ControlOrMeta+v');
  await expect(editor).toHaveValue('AB');
});
