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
async function workspaceView(page: Page, name: string) {
  await page.getByTestId('workspace-menu-button').click(); await page.getByRole('menuitemcheckbox', { name, exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
  await page.goto('/'); await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
});

test('draw, resize, undo/redo and zoom with the real domain', async ({ page }) => {
  await draw(page, 'Rechteck');
  await expect(page.locator('[data-kind="rectangle"]')).toHaveCount(1);
  // Geometry is edited on the canvas; the selection toolbar no longer shows coordinates (#40).
  const box = page.locator('[data-kind=rectangle] > g > rect');
  await expect(box).toHaveAttribute('width', '200');
  const se = await page.locator('[data-handle=se]').boundingBox();
  await page.mouse.move(se!.x + 5, se!.y + 5); await page.mouse.down(); await page.mouse.move(610, 400); await page.mouse.up();
  await expect(box).toHaveAttribute('width', '260');
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(box).toHaveAttribute('width', '200');
  await page.getByRole('button', { name: 'Wiederholen', exact: true }).click();
  await expect(box).toHaveAttribute('width', '260');
  await page.getByRole('button', { name: 'Vergrößern', exact: true }).click(); await expect(page.getByRole('button', { name: 'Zoom auf 100 Prozent' })).toHaveText('120 %');
  await page.screenshot({ path: 'test-results/whiteboard-properties.png' });
});

test('eraser sits beside the pencil and removes a drag path in one undo step', async ({ page }) => {
  const pencil = page.getByRole('button', { name: 'Freihand', exact: true });
  const eraser = page.getByRole('button', { name: 'Radierer', exact: true });
  const pencilBox = await pencil.boundingBox(); const eraserBox = await eraser.boundingBox();
  expect(eraserBox!.x).toBeGreaterThan(pencilBox!.x);
  expect(eraserBox!.x - (pencilBox!.x + pencilBox!.width)).toBeLessThan(12);
  await expect(eraser).toHaveAttribute('title', /Umschalt\+e/i);

  await draw(page, 'Freihand', [350, 200], [350, 280]);
  await draw(page, 'Freihand', [550, 200], [550, 280]);
  await expect(page.locator('[data-kind=path]')).toHaveCount(2);
  await eraser.click(); await expect(eraser).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(330, 240); await page.mouse.down();
  await page.mouse.move(570, 240, { steps: 24 }); await page.mouse.up();
  await expect(page.locator('[data-kind=path]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(page.locator('[data-kind=path]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Wiederholen', exact: true }).click();
  await expect(page.locator('[data-kind=path]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Auswahl', exact: true }).click();
  await page.getByTestId('whiteboard-canvas').focus(); await page.keyboard.press('Shift+E');
  await expect(eraser).toHaveAttribute('aria-pressed', 'true');
});

test('all primitive shapes, freehand, connection, text and image render', async ({ page }) => {
  await draw(page, 'Rechteck', [300, 180], [440, 270]);
  await draw(page, 'Ellipse', [520, 180], [660, 270]);
  await draw(page, 'Raute', [740, 180], [880, 270]);
  await draw(page, 'Container', [300, 400], [560, 600]);
  await draw(page, 'Freihand', [640, 400], [760, 460]);
  await draw(page, 'Verbindung', [440, 225], [520, 225]);
  await page.getByRole('button', { name: 'Text', exact: true }).click(); await page.mouse.click(620, 540);
  await page.getByTestId('canvas-text-editor').fill('Menschen & Agenten'); await page.getByTestId('canvas-text-editor').press('ControlOrMeta+Enter');
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
  await workspaceView(page, 'Bibliothek');
  await page.getByRole('searchbox', { name: 'Formen durchsuchen' }).fill('EC2');
  await page.getByTestId('shape-library-sidebar').getByRole('button', { name: /Amazon EC2/ }).click(); await expect(page.locator('[data-kind=component]')).toHaveCount(1);
  await workspaceView(page, 'Code');
  const code = page.getByTestId('diagram-code'); const original = await code.inputValue(); expect(original).toContain('sketchdraw 1');
  await code.fill(original.replace('Unbenannt', 'Cloud Workspace'));
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click(); await expect(page.getByTestId('document-title')).toHaveValue('Cloud Workspace');
  await code.fill('sketchdraw broken'); await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Codefehler' })).toBeVisible(); await expect(code).toHaveValue('sketchdraw broken');
  await page.getByRole('button', { name: 'Codeansicht schließen' }).click(); await workspaceView(page, 'Code'); await expect(code).toHaveValue('sketchdraw broken');
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
  await workspaceView(page, 'Code'); await expect(page.getByTestId('diagram-code')).toBeVisible();
  await page.screenshot({ path: 'test-results/whiteboard-compact.png' });
});

test('document card, workspace menu and minimap follow the workspace chrome design', async ({ page }) => {
  await expect(page.getByTestId('save-status')).toBeVisible();
  const trigger = page.getByTestId('workspace-menu-button');
  await trigger.click(); await expect(page.getByRole('menu', { name: 'Arbeitsbereich' })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape'); await expect(page.getByRole('menu', { name: 'Arbeitsbereich' })).toHaveCount(0); await expect(trigger).toBeFocused();
  await workspaceView(page, 'Bibliothek'); await trigger.click();
  await expect(page.getByRole('menuitemcheckbox', { name: 'Bibliothek', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('minimap')).toHaveCount(0);
  await page.getByRole('menuitemcheckbox', { name: 'Bibliothek', exact: true }).click();
  await page.getByTestId('file-menu-button').click(); await expect(page.getByTestId('file-menu-new')).toBeFocused();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape'); await expect(page.getByTestId('file-menu-button')).toBeFocused();
  await expect(page.getByText('Dein Dokument bleibt bei dir')).toHaveCount(0);
  await draw(page, 'Rechteck');
  const minimap = page.getByTestId('minimap'); await expect(minimap.locator('rect.shape')).toHaveCount(1);
  const before = await page.locator('[data-kind=rectangle]').boundingBox();
  const map = await minimap.locator('svg.map').boundingBox(); await page.mouse.click(map!.x + 12, map!.y + 12);
  const after = await page.locator('[data-kind=rectangle]').boundingBox();
  expect(Math.abs(after!.x - before!.x) + Math.abs(after!.y - before!.y)).toBeGreaterThan(20);
});
