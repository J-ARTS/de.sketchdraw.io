import { expect, test, type Page } from '@playwright/test';

async function rectangle(page: Page, from: [number, number], to: [number, number]) {
  await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
  await page.mouse.move(from[0], from[1]); await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 4 }); await page.mouse.up();
}
const boxes = (page: Page) => page.locator('.whiteboard-canvas [data-kind=rectangle]');
async function boxOf(page: Page, index: number) {
  const box = (await boxes(page).nth(index).boundingBox())!;
  return { x: Math.round(box.x), y: Math.round(box.y), right: Math.round(box.x + box.width), bottom: Math.round(box.y + box.height) };
}
const alignLines = (page: Page) => page.getByTestId('guide-align');
const gapMarks = (page: Page) => page.getByTestId('guide-gap');

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => { throw error; });
  await page.goto('/');
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('a moved box snaps into line with the nearest box; the lines show while it is dragged', async ({ page }) => {
  await rectangle(page, [300, 200], [420, 270]);
  await rectangle(page, [600, 420], [720, 490]);
  await page.keyboard.press('Escape');
  await expect(alignLines(page)).toHaveCount(0);
  const origin = await boxOf(page, 1);

  // Drag the second box to just beside the first one's left edge: three pixels off.
  await page.mouse.move(660, 455); await page.mouse.down();
  await page.mouse.move(500, 440, { steps: 4 });
  await expect(alignLines(page)).toHaveCount(0);
  await page.mouse.move(363, 452, { steps: 4 });
  // Same width: left and right edge are in line, shown as two vertical lines that span both boxes.
  await expect(alignLines(page)).toHaveCount(2);
  const first = await boxOf(page, 0);
  expect((await boxOf(page, 1)).x).toBe(first.x);
  const line = (await alignLines(page).first().boundingBox())!;
  expect(Math.round(line.x)).toBe(first.x + 1);
  expect(line.y).toBeLessThan(first.y);
  expect(line.y + line.height).toBeGreaterThan((await boxOf(page, 1)).bottom);
  // In the violet of the interface (#230).
  expect(await alignLines(page).first().evaluate((node) => getComputedStyle(node).stroke)).toBe('rgb(107, 76, 230)');
  // The lines are decoration: nothing for assistive technology, nothing that takes the pointer.
  await expect(page.getByTestId('smart-guides')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.getByTestId('smart-guides')).toHaveAttribute('pointer-events', 'none');

  await page.mouse.up();
  await expect(alignLines(page)).toHaveCount(0);
  expect((await boxOf(page, 1)).x).toBe(first.x);
  // Undo takes the box back where it was.
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  expect(await boxOf(page, 1)).toEqual(origin);
});

test('equal distances are found and labelled, in a row and between two neighbours', async ({ page }) => {
  await rectangle(page, [200, 200], [300, 260]);
  await rectangle(page, [360, 200], [460, 260]);
  await rectangle(page, [700, 420], [800, 480]);
  await page.keyboard.press('Escape');

  // Continue the row: 60 between the first two, so the third belongs 60 after the second.
  await page.mouse.move(750, 450); await page.mouse.down();
  await page.mouse.move(573, 233, { steps: 6 });
  await expect(gapMarks(page)).toHaveCount(2);
  await expect(gapMarks(page).first()).toHaveAttribute('data-size', '60');
  await expect(gapMarks(page).first().locator('text')).toHaveText('60');
  // It is in line with the row as well.
  await expect(alignLines(page)).toHaveCount(2);
  await page.mouse.up();
  await expect(gapMarks(page)).toHaveCount(0);
  const [a, b, c] = [await boxOf(page, 0), await boxOf(page, 1), await boxOf(page, 2)];
  expect(c.x - b.right).toBe(b.x - a.right);
  expect(c.y).toBe(a.y);

  // Between two neighbours: move the middle box away and back to roughly the middle; it centres itself.
  await page.mouse.move(410, 230); await page.mouse.down();
  await page.mouse.move(410, 500, { steps: 4 });
  await page.mouse.move(413, 232, { steps: 6 });
  await expect(gapMarks(page)).toHaveCount(2);
  await page.mouse.up();
  const [left, middle, right] = [await boxOf(page, 0), await boxOf(page, 1), await boxOf(page, 2)];
  expect(middle.x - left.right).toBe(right.x - middle.right);
});

test('the modifier key moves freely and the setting switches the guides off for good', async ({ page }) => {
  await rectangle(page, [300, 200], [420, 270]);
  await rectangle(page, [600, 420], [720, 490]);
  await page.keyboard.press('Escape');

  await page.mouse.move(660, 455); await page.mouse.down();
  await page.mouse.move(363, 452, { steps: 4 });
  await expect(alignLines(page)).toHaveCount(2);
  // Held while dragging: the box goes exactly where the pointer is and the lines go.
  await page.keyboard.down('Control');
  await page.mouse.move(364, 452);
  await expect(alignLines(page)).toHaveCount(0);
  expect((await boxOf(page, 1)).x).toBe((await boxOf(page, 0)).x + 4);
  await page.keyboard.up('Control');
  await page.mouse.move(363, 452);
  await expect(alignLines(page)).toHaveCount(2);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(alignLines(page)).toHaveCount(0);

  await page.getByTestId('workspace-menu-button').click();
  await page.getByRole('menuitem', { name: 'Einstellungen', exact: true }).click();
  const toggle = page.getByTestId('smart-guides-switch');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(toggle).toContainText('Hilfslinien beim Verschieben');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('button', { name: 'Fertig', exact: true }).click();

  await page.mouse.move(660, 455); await page.mouse.down();
  await page.mouse.move(363, 452, { steps: 4 });
  await expect(alignLines(page)).toHaveCount(0);
  expect((await boxOf(page, 1)).x).toBe((await boxOf(page, 0)).x + 3);
  await page.mouse.up();
  // The choice is remembered.
  await page.reload();
  await page.getByTestId('workspace-menu-button').click();
  await page.getByRole('menuitem', { name: 'Einstellungen', exact: true }).click();
  await expect(page.getByTestId('smart-guides-switch')).toHaveAttribute('aria-checked', 'false');
});
