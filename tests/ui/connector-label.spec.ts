import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => { throw error; });
  await page.goto('/');
});

async function insertTemplate(page: Page, library: 'bpmn' | 'sequence' | 'er', name: string) {
  await page.getByTestId('more-shapes').click();
  await page.getByTestId(`open-diagram-library-${library}`).click();
  const panel = page.getByTestId('shape-library-sidebar');
  await panel.getByRole('button', { name, exact: true }).click();
  await panel.getByRole('button', { name: 'Formen schließen' }).click();
}
const centreX = async (locator: import('@playwright/test').Locator) => { const box = (await locator.boundingBox())!; return box.x + box.width / 2; };

test('the text of an arrow slides along the arrow by its grip and by the slider of the selection bar (#195)', async ({ page }) => {
  await insertTemplate(page, 'sequence', 'Nachricht');
  const canvas = page.locator('.whiteboard-canvas');
  const arrow = canvas.locator('[data-kind="connector"]');
  const label = canvas.getByTestId('connector-label');
  const line = (await arrow.locator('path[marker-end]').boundingBox())!;
  // In the middle to begin with.
  expect(Math.abs(await centreX(label) - (line.x + line.width / 2))).toBeLessThanOrEqual(2);

  // Drag the grip below the text towards the end of the arrow.
  const grip = page.getByTestId('connector-label-handle');
  await expect(grip).toBeVisible();
  const gripBox = (await grip.boundingBox())!;
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(line.x + line.width * 0.8, gripBox.y + gripBox.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Math.abs(await centreX(label) - (line.x + line.width * 0.8))).toBeLessThanOrEqual(3);
  // The arrow itself did not move.
  expect((await arrow.locator('path[marker-end]').boundingBox())!.x).toBe(line.x);

  // The slider is the keyboard way: Home puts the text at the start.
  const toolbar = page.getByRole('toolbar', { name: 'Eigenschaften' });
  await toolbar.getByRole('button', { name: 'Textposition' }).click();
  const slider = page.getByRole('slider', { name: 'Textposition' });
  expect(Math.abs(Number(await slider.inputValue()) - 80)).toBeLessThanOrEqual(2);
  await slider.focus();
  await page.keyboard.press('Home');
  await expect.poll(async () => Math.abs(await centreX(label) - line.x)).toBeLessThanOrEqual(3);
  await page.keyboard.press('Escape');

  // Each move is one undo step.
  await page.getByTestId('whiteboard-canvas').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => Math.abs(await centreX(label) - (line.x + line.width * 0.8))).toBeLessThanOrEqual(3);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => Math.abs(await centreX(label) - (line.x + line.width / 2))).toBeLessThanOrEqual(3);
});

test('a double click on an arrow without text adds the text where it was clicked (#195)', async ({ page }) => {
  await insertTemplate(page, 'bpmn', 'Sequenzfluss');
  const canvas = page.locator('.whiteboard-canvas');
  const line = (await canvas.locator('[data-kind="connector"] path[marker-end]').boundingBox())!;
  const at = line.x + line.width * 0.25;
  await page.mouse.click(200, 300);
  await page.mouse.dblclick(at, line.y + line.height / 2);
  const editor = page.getByTestId('canvas-text-editor');
  await expect(editor).toBeFocused();
  const editorBox = (await editor.boundingBox())!;
  expect(Math.abs(editorBox.x + editorBox.width / 2 - at)).toBeLessThanOrEqual(6);
  await page.keyboard.type('ja');
  await page.keyboard.press('ControlOrMeta+Enter');
  const label = canvas.getByTestId('connector-label');
  await expect(label).toHaveText('ja');
  expect(Math.abs(await centreX(label) - at)).toBeLessThanOrEqual(6);
  // Without text there is no grip and no slider; with text both are there.
  await expect(page.getByTestId('connector-label-handle')).toBeVisible();
  await expect(page.getByRole('toolbar', { name: 'Eigenschaften' }).getByRole('button', { name: 'Textposition' })).toBeVisible();
});

test('the text stays on a curved arrow when its element moves (#195)', async ({ page }) => {
  await insertTemplate(page, 'er', 'Beispiel: Kunde und Bestellung');
  const canvas = page.locator('.whiteboard-canvas');
  const relationship = canvas.locator('[data-kind="connector"]');
  // Give the relationship a text.
  const line = (await relationship.locator('path[marker-end]').boundingBox())!;
  await page.mouse.click(640, 220);
  await page.mouse.dblclick(line.x + line.width / 2, line.y + line.height / 2);
  await page.keyboard.type('bestellt');
  await page.keyboard.press('ControlOrMeta+Enter');
  await page.mouse.click(640, 220);
  // Move the right table down; the relationship becomes an S-curve.
  const table = canvas.locator('[data-kind="table"]').last();
  const box = (await table.boundingBox())!;
  await page.mouse.move(box.x + box.width - 6, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 6, box.y + box.height / 2 + 160, { steps: 8 });
  await page.mouse.up();
  const curve = (await relationship.locator('path[marker-end]').boundingBox())!;
  expect(curve.height).toBeGreaterThan(100);
  const label = (await canvas.getByTestId('connector-label').boundingBox())!;
  // In the middle of the S, not at the height of the old straight line.
  expect(Math.abs(label.y + label.height / 2 - (curve.y + curve.height / 2))).toBeLessThanOrEqual(6);
  expect(Math.abs(label.x + label.width / 2 - (curve.x + curve.width / 2))).toBeLessThanOrEqual(6);
});
