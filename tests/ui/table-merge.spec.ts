import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => { throw error; });
  await page.goto('/');
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
});

async function newTable(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Tabelle', exact: true }).click();
  await page.mouse.click(280, 230);
  const overlay = page.getByTestId('table-overlay');
  await expect(overlay.getByRole('gridcell')).toHaveCount(9);
  return overlay;
}
const cell = (overlay: Locator, row: number, column: number) => overlay.getByRole('button', { name: `Zelle ${row}, ${column}`, exact: true });
async function type(page: Page, overlay: Locator, row: number, column: number, text: string): Promise<void> {
  await cell(overlay, row, column).dblclick();
  await page.getByTestId('table-cell-editor').fill(text);
  await page.keyboard.press('ControlOrMeta+Enter');
}
const selected = (overlay: Locator) => overlay.locator('[role="gridcell"][aria-selected="true"]');

test('several cells are selected with Shift+click, by dragging and with Shift+arrow keys (#197)', async ({ page }) => {
  const overlay = await newTable(page);
  await cell(overlay, 1, 1).click();
  await expect(selected(overlay)).toHaveCount(1);
  await cell(overlay, 2, 2).click({ modifiers: ['Shift'] });
  await expect(selected(overlay)).toHaveCount(4);
  // A plain click starts over.
  await cell(overlay, 3, 3).click();
  await expect(selected(overlay)).toHaveCount(1);

  // Drag from the first cell of the second row to the last cell of the third row.
  const from = (await cell(overlay, 2, 1).boundingBox())!;
  const to = (await cell(overlay, 3, 3).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(selected(overlay)).toHaveCount(6);

  // Keyboard: arrows move the cell, Shift+arrows extend from where the selection started.
  await cell(overlay, 1, 1).click();
  await page.keyboard.press('ArrowRight');
  await expect(cell(overlay, 1, 2)).toBeFocused();
  await expect(selected(overlay)).toHaveCount(1);
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(selected(overlay)).toHaveCount(4);
  await expect(cell(overlay, 2, 3)).toBeFocused();
  // The table itself did not move under the arrow keys.
  await expect(overlay.getByRole('gridcell')).toHaveCount(9);
  // Formatting applies to the whole selection.
  await page.getByRole('toolbar', { name: 'Eigenschaften' }).getByRole('button', { name: 'Fett' }).click();
  await expect(overlay.locator('[role="gridcell"]').nth(1)).toHaveCSS('font-weight', '700');
  await expect(overlay.locator('[role="gridcell"]').nth(5)).toHaveCSS('font-weight', '700');
  await expect(overlay.locator('[role="gridcell"]').nth(0)).not.toHaveCSS('font-weight', '700');
});

test('selected cells are merged into one and can be split again without losing their content (#197)', async ({ page }) => {
  const overlay = await newTable(page);
  const toolbar = page.getByRole('toolbar', { name: 'Eigenschaften' });
  await type(page, overlay, 1, 1, 'Hello');
  await type(page, overlay, 1, 2, 'verdeckt');
  await expect(toolbar.getByRole('button', { name: 'Zellen verbinden' })).toHaveCount(0);

  await cell(overlay, 1, 1).click();
  await cell(overlay, 2, 3).click({ modifiers: ['Shift'] });
  await toolbar.getByRole('button', { name: 'Zellen verbinden' }).click();
  // Six cells became one: it spans three columns and two rows and shows the text of its top left cell.
  await expect(overlay.getByRole('gridcell')).toHaveCount(4);
  const merged = overlay.locator('[role="gridcell"]').first();
  await expect(merged).toHaveAttribute('aria-colspan', '3');
  await expect(merged).toHaveAttribute('aria-rowspan', '2');
  await expect(merged).toHaveText('Hello');
  const frame = (await overlay.boundingBox())!;
  const box = (await merged.boundingBox())!;
  expect(Math.abs(box.width - frame.width)).toBeLessThanOrEqual(3);
  expect(Math.abs(box.height - frame.height * 2 / 3)).toBeLessThanOrEqual(3);
  // The drawing on the canvas shows the same.
  await page.mouse.click(900, 620);
  const drawn = page.locator('.whiteboard-canvas [data-kind="table"] [data-merged="true"] rect');
  await expect(drawn).toHaveCount(1);
  expect(Math.abs((await drawn.boundingBox())!.width - frame.width)).toBeLessThanOrEqual(3);
  await expect(page.locator('.whiteboard-canvas [data-kind="table"]').getByTestId('table-surface')).toContainText('Hello');
  await expect(page.locator('.whiteboard-canvas [data-kind="table"]').getByTestId('table-surface')).not.toContainText('verdeckt');

  // Editing the merged cell edits its top left cell.
  await page.mouse.click(frame.x + 40, frame.y + 30);
  await type(page, overlay, 1, 1, 'Titel');
  await expect(merged).toHaveText('Titel');
  const axe = await new AxeBuilder({ page }).include('[data-testid="table-overlay"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations.map((violation) => `${violation.id}: ${violation.nodes[0]?.html.slice(0, 200)} | ${violation.nodes[0]?.failureSummary?.slice(0, 240)}`)).toEqual([]);

  // Split: all six cells are back, and the covered text was kept.
  await cell(overlay, 1, 1).click();
  await toolbar.getByRole('button', { name: 'Zellenverbindung aufheben' }).click();
  await expect(overlay.getByRole('gridcell')).toHaveCount(9);
  await expect(cell(overlay, 1, 2)).toHaveText('verdeckt');
  await expect(toolbar.getByRole('button', { name: 'Zellenverbindung aufheben' })).toHaveCount(0);

  // Undo brings the merge back, undo again the state before the split… each is one step.
  await page.getByTestId('whiteboard-canvas').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await page.mouse.click(frame.x + 40, frame.y + 30);
  await expect(overlay.getByRole('gridcell')).toHaveCount(4);
  // The same two actions are in the table structure menu.
  await toolbar.getByRole('button', { name: 'Tabellenstruktur' }).click();
  await expect(page.getByRole('group', { name: 'Zeilen und Spalten bearbeiten' }).getByRole('button', { name: 'Zellen verbinden' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await cell(overlay, 1, 1).click();
  await toolbar.getByRole('button', { name: 'Tabellenstruktur' }).click();
  await page.getByRole('group', { name: 'Zeilen und Spalten bearbeiten' }).getByRole('button', { name: 'Zellenverbindung aufheben' }).click();
  await expect(overlay.getByRole('gridcell')).toHaveCount(9);
});

test('the ER entity has one header row with the table name that stays whole and filled when a column is added (#197)', async ({ page }) => {
  await page.getByTestId('more-shapes').click();
  await page.getByTestId('open-diagram-library-er').click();
  const panel = page.getByTestId('shape-library-sidebar');
  await panel.getByRole('button', { name: 'Entität', exact: true }).click();
  await panel.getByRole('button', { name: 'Formen schließen' }).click();
  const overlay = page.getByTestId('table-overlay');
  await expect(overlay).toBeVisible();
  // Four rows of two columns, with the first row merged: seven cells.
  await expect(overlay.getByRole('gridcell')).toHaveCount(7);
  const header = overlay.locator('[role="gridcell"]').first();
  await expect(header).toHaveText('Entität');
  await expect(header).toHaveAttribute('aria-colspan', '2');
  const fill = await header.evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(fill).not.toBe('rgb(255, 255, 255)');

  await overlay.getByRole('button', { name: 'Spalte rechts hinzufügen' }).click();
  await expect(overlay.getByRole('gridcell')).toHaveCount(10);
  await expect(header).toHaveAttribute('aria-colspan', '3');
  const frame = (await overlay.boundingBox())!;
  expect(Math.abs((await header.boundingBox())!.width - frame.width)).toBeLessThanOrEqual(3);
  expect(await header.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(fill);
  // On the canvas the header band runs over the whole width too.
  await page.mouse.click(200, 300);
  const band = page.locator('.whiteboard-canvas [data-kind="table"] [data-merged="true"] rect');
  expect(Math.abs((await band.boundingBox())!.width - frame.width)).toBeLessThanOrEqual(3);
});
