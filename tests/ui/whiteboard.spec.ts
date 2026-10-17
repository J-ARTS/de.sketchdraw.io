import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';

async function draw(page: Page, tool: string, from = [350, 220], to = [550, 360]) {
  await page.getByRole('button', { name: tool, exact: true }).click();
  await page.mouse.move(from[0]!, from[1]!); await page.mouse.down();
  await page.mouse.move(to[0]!, to[1]!, { steps: 8 }); await page.mouse.up();
  await expect(page.locator('[data-element-id]').last()).toBeAttached();
}
async function menu(page: Page, item: string) {
  await page.getByTestId('file-menu-button').click(); await page.getByTestId(`file-menu-${item}`).click();
}
test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
  await page.goto('/'); await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
});

test('draw, resize, rotate, undo/redo and zoom with the real domain', async ({ page }) => {
  await draw(page, 'Rechteck');
  await expect(page.locator('[data-kind="rectangle"]')).toHaveCount(1);
  await expect(page.getByRole('spinbutton', { name: 'Breite', exact: true })).toHaveValue('200');
  const se = await page.locator('[data-handle=se]').boundingBox();
  await page.mouse.move(se!.x + 5, se!.y + 5); await page.mouse.down(); await page.mouse.move(610, 400); await page.mouse.up();
  await expect(page.getByRole('spinbutton', { name: 'Breite', exact: true })).toHaveValue('260');
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Breite', exact: true })).toHaveValue('200');
  await page.getByRole('button', { name: 'Wiederholen', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Breite', exact: true })).toHaveValue('260');
  await page.getByRole('spinbutton', { name: 'Winkel', exact: true }).fill('30'); await page.keyboard.press('Tab');
  await expect(page.locator('[data-kind=rectangle]')).toHaveAttribute('transform', /rotate\(30 /);
  await page.getByRole('button', { name: 'Vergrößern', exact: true }).click(); await expect(page.getByRole('button', { name: 'Zoom auf 100 Prozent' })).toHaveText('120 %');
  await page.screenshot({ path: 'test-results/whiteboard-properties.png' });
});

test('all primitive shapes, freehand, connection, text and image render', async ({ page }) => {
  await draw(page, 'Rechteck', [300, 180], [440, 270]);
  await draw(page, 'Ellipse', [520, 180], [660, 270]);
  await draw(page, 'Raute', [740, 180], [880, 270]);
  await draw(page, 'Container', [300, 400], [560, 600]);
  await draw(page, 'Freihand', [640, 400], [760, 460]);
  await draw(page, 'Verbindung', [440, 225], [520, 225]);
  await page.getByRole('button', { name: 'Text', exact: true }).click(); await page.mouse.click(620, 540);
  await page.getByTestId('canvas-text-editor').fill('Menschen & Agenten'); await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(page.locator('[data-kind=text]')).toContainText('Menschen & Agenten');
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Bild', exact: true }).click();
  await (await chooser).setFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS9sAAAAASUVORK5CYII=', 'base64') });
  await expect(page.locator('[data-kind=image]')).toHaveCount(1);
  for (const kind of ['rectangle', 'ellipse', 'diamond', 'container', 'path', 'connector', 'text', 'image']) await expect(page.locator(`[data-kind=${kind}]`)).toHaveCount(1);
});

test('real download roundtrip and dirty document cancellation retain the drawing', async ({ page }) => {
  await draw(page, 'Rechteck');
  await menu(page, 'new'); await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click(); await expect(page.locator('[data-kind=rectangle]')).toHaveCount(1);
  const downloadEvent = page.waitForEvent('download'); await menu(page, 'save');
  const download = await downloadEvent; const contents = await readFile((await download.path())!, 'utf8');
  const saved = JSON.parse(contents); expect(saved.elements).toHaveLength(1);
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'handed-off');
  await menu(page, 'new'); await expect(page.locator('[data-element-id]')).toHaveCount(0);
  const chooser = page.waitForEvent('filechooser'); await menu(page, 'open'); await (await chooser).setFiles({ name: 'again.sketchdraw.json', mimeType: 'application/json', buffer: Buffer.from(contents) });
  await expect(page.locator('[data-kind=rectangle]')).toHaveCount(1);
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved');
});

test('catalog inserts a real component and code updates preserve invalid drafts', async ({ page }) => {
  await page.getByRole('button', { name: 'Bibliothek', exact: true }).click();
  await page.getByLabel('Komponenten suchen').fill('server');
  await page.locator('.catalog-item').first().click(); await expect(page.locator('[data-kind=component]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Code', exact: true }).click();
  const code = page.getByTestId('diagram-code'); const original = await code.inputValue(); expect(original).toContain('sketchdraw 1');
  await code.fill(original.replace('Unbenannt', 'Cloud Workspace'));
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click(); await expect(page.getByTestId('document-title')).toHaveValue('Cloud Workspace');
  await code.fill('sketchdraw broken'); await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Codefehler' })).toBeVisible(); await expect(code).toHaveValue('sketchdraw broken');
  await page.getByRole('button', { name: 'Codeansicht schließen' }).click(); await page.getByRole('button', { name: 'Code', exact: true }).click(); await expect(code).toHaveValue('sketchdraw broken');
  await page.screenshot({ path: 'test-results/whiteboard-code.png' });
});

test('text focus protects native undo and keyboard navigation reaches help', async ({ page }) => {
  await draw(page, 'Rechteck');
  await page.getByRole('button', { name: 'Text bearbeiten', exact: true }).click();
  const editor = page.getByTestId('canvas-text-editor'); await editor.pressSequentially('Hallo');
  await editor.press('ControlOrMeta+z'); await expect(page.locator('[data-kind=rectangle]')).toHaveCount(1);
  await editor.fill('Beschriftung'); await editor.press('Escape'); await expect(editor).not.toBeVisible();
  await page.getByTestId('whiteboard-canvas').focus(); await page.keyboard.press('?'); await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByTestId('theme-toggle').click(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('keyboard and screen reader structure has no serious automated accessibility findings', async ({ page }) => {
  let results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations).toEqual([]);
  await draw(page, 'Rechteck');
  results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations).toEqual([]);
});

test('compact browser layout retains reachable file, tools and code controls', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 720 });
  await page.getByTestId('file-menu-button').click(); await expect(page.getByTestId('file-menu-save')).toBeVisible(); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
  await page.mouse.move(280, 240); await page.mouse.down(); await page.mouse.move(420, 330); await page.mouse.up();
  await expect(page.locator('[data-kind=rectangle]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Code', exact: true }).click(); await expect(page.getByTestId('diagram-code')).toBeVisible();
  await page.screenshot({ path: 'test-results/whiteboard-compact.png' });
});
