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

test('pencil and eraser open a responsive accessible options bar with real drawing behavior', async ({ page }) => {
  await page.getByRole('button', { name: 'Freihand', exact: true }).click();
  const main = page.getByTestId('main-toolbar'); const options = page.getByTestId('pencil-options');
  await expect(options).toBeVisible(); await expect(options.locator('img')).toHaveCount(0);
  const mainBox = await main.boundingBox(); const optionsBox = await options.boundingBox();
  expect(optionsBox!.y).toBeGreaterThanOrEqual(mainBox!.y + mainBox!.height);
  const choiceRow = page.getByTestId('pencil-choice-row'); const controlsRow = page.getByTestId('pencil-controls-row');
  const choiceBox = await choiceRow.boundingBox(); const controlsBox = await controlsRow.boundingBox();
  expect(controlsBox!.y).toBeGreaterThanOrEqual(choiceBox!.y + choiceBox!.height);
  expect(await options.evaluate((element) => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight)).toBe(true);

  const fine = options.getByRole('button', { name: 'Fein, 2 Pixel', exact: true });
  const pencil = options.getByRole('button', { name: 'Stift, 4 Pixel', exact: true });
  const pencilSize = options.getByRole('slider', { name: 'Pinselgröße' });
  const pencilOpacity = options.getByRole('slider', { name: 'Stift-Deckkraft' });
  await expect(pencilSize).toHaveAttribute('min', '1'); await expect(pencilSize).toHaveAttribute('max', '500'); await expect(pencilSize).toHaveValue('2');
  await expect(pencilOpacity).toHaveAttribute('min', '0'); await expect(pencilOpacity).toHaveAttribute('max', '100'); await expect(pencilOpacity).toHaveValue('100');
  await fine.focus(); await page.keyboard.press('ArrowRight'); await expect(pencil).toBeFocused();
  await options.getByRole('button', { name: 'Marker, 10 Pixel', exact: true }).click();
  await expect(pencilSize).toHaveValue('10'); await expect(pencilOpacity).toHaveValue('55');
  await pencilSize.focus(); await page.keyboard.press('End'); await expect(pencilSize).toHaveValue('500');
  await pencilSize.evaluate((element) => { const input = element as HTMLInputElement; input.value = '24'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(pencilSize).toHaveValue('24'); await expect(options).toContainText('24 px');
  await pencilOpacity.focus(); await page.keyboard.press('Home'); await expect(pencilOpacity).toHaveValue('0');
  await pencilOpacity.evaluate((element) => { const input = element as HTMLInputElement; input.value = '35'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(pencilOpacity).toHaveValue('35'); await expect(options).toContainText('35 %');
  await options.getByRole('button', { name: 'Stiftfarbe Rot', exact: true }).click();
  await page.mouse.move(650, 300);
  const pencilCursor = page.getByTestId('pencil-cursor'); await expect(pencilCursor).toBeVisible(); await expect(pencilCursor).toHaveAttribute('data-size', '24'); await expect(pencilCursor).toHaveAttribute('data-opacity', '35');
  await expect(pencilCursor.locator('circle')).toHaveAttribute('r', '12'); await expect(pencilCursor.locator('circle')).toHaveAttribute('opacity', '0.35');
  await expect(page.getByTestId('whiteboard-canvas')).toHaveCSS('cursor', 'none');
  await page.mouse.move(650, 300); await page.mouse.down(); await page.mouse.move(760, 360, { steps: 12 }); await page.mouse.up();
  const path = page.locator('[data-kind=path]'); const pathStyle = path.locator('g').first();
  await expect(path).toHaveAttribute('opacity', '0.35');
  await expect(pathStyle).toHaveAttribute('stroke', '#e5533a'); await expect(pathStyle).toHaveAttribute('stroke-width', '24');

  await draw(page, 'Rechteck', [350, 300], [450, 380]);
  await page.getByRole('button', { name: 'Radierer', exact: true }).click();
  await expect(pencilCursor).toHaveCount(0);
  const eraserOptions = page.getByTestId('eraser-options'); await expect(eraserOptions).toBeVisible(); await expect(options).toHaveCount(0);
  const radius = eraserOptions.getByRole('slider', { name: 'Radierer-Radius' });
  await expect(radius).toHaveAttribute('min', '1'); await expect(radius).toHaveAttribute('max', '500'); await expect(radius).toHaveValue('18');
  await radius.focus(); await page.keyboard.press('ArrowRight'); await expect(radius).toHaveValue('19'); await expect(eraserOptions).toContainText('19 px');
  await radius.evaluate((element) => { const input = element as HTMLInputElement; input.value = '1'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(radius).toHaveValue('1'); await expect(eraserOptions).toContainText('1 px');
  await page.mouse.move(470, 340);
  const cursor = page.getByTestId('eraser-cursor'); await expect(cursor).toBeVisible(); await expect(cursor).toHaveAttribute('data-radius', '1');
  await expect(page.getByTestId('whiteboard-canvas')).toHaveCSS('cursor', 'none');
  await page.mouse.click(470, 340); await expect(page.locator('[data-kind=rectangle]')).toHaveCount(1);
  await radius.evaluate((element) => { const input = element as HTMLInputElement; input.value = '32'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(radius).toHaveValue('32'); await expect(eraserOptions).toContainText('32 px');
  await page.mouse.move(470, 340); await expect(cursor).toHaveAttribute('data-radius', '32');
  await page.mouse.click(470, 340); await expect(page.locator('[data-kind=rectangle]')).toHaveCount(0);
  await expect(path).toHaveCount(1);
  await radius.evaluate((element) => { const input = element as HTMLInputElement; input.value = '500'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(radius).toHaveValue('500'); await expect(eraserOptions).toContainText('500 px');
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Auswahl', exact: true }).click(); await expect(cursor).toHaveCount(0); await expect(pencilCursor).toHaveCount(0);
  await page.setViewportSize({ width: 480, height: 720 });
  await page.getByRole('button', { name: 'Freihand', exact: true }).click(); await expect(options).toBeVisible();
  const compact = await options.boundingBox(); expect(compact!.x).toBeGreaterThanOrEqual(0); expect(compact!.x + compact!.width).toBeLessThanOrEqual(480);
  expect(await options.evaluate((element) => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight)).toBe(true);
  for (const control of [
    options.getByRole('button', { name: 'Marker, 10 Pixel', exact: true }),
    options.getByRole('button', { name: 'Eigene Stiftfarbe wählen', exact: true }),
    pencilSize,
    pencilOpacity,
  ]) {
    const box = await control.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(compact!.x);
    expect(box!.x + box!.width).toBeLessThanOrEqual(compact!.x + compact!.width);
  }
});

test('laser pointer draws only a stable fading overlay and supports its shortcut', async ({ page }) => {
  const laser = page.getByRole('button', { name: 'Laserpointer', exact: true });
  await expect(laser).toHaveAttribute('title', /Umschalt\+k/i);
  await laser.click(); await expect(laser).toHaveAttribute('aria-pressed', 'true');

  await page.mouse.move(420, 260); await page.mouse.down();
  await page.mouse.move(650, 360, { steps: 24 });
  const layer = page.getByTestId('laser-pointer-layer');
  const head = page.getByTestId('laser-pointer-head');
  await expect(layer).toBeVisible(); await expect(head).toBeVisible();
  expect(await layer.locator('line.laser-core').count()).toBeGreaterThan(3);
  const headBefore = { cx: await head.getAttribute('cx'), cy: await head.getAttribute('cy') };
  await page.mouse.wheel(0, 120);
  await expect(head).toHaveAttribute('cx', headBefore.cx!);
  await expect(head).toHaveAttribute('cy', headBefore.cy!);
  await page.mouse.up();
  await expect(page.getByTestId('laser-pointer-head')).toHaveCount(0);
  await expect(layer).toHaveCount(0, { timeout: 2_000 });
  await expect(page.locator('[data-element-id]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Rückgängig', exact: true })).toBeDisabled();

  await page.getByRole('button', { name: 'Auswahl', exact: true }).click();
  await page.getByTestId('whiteboard-canvas').focus(); await page.keyboard.press('Shift+K');
  await expect(laser).toHaveAttribute('aria-pressed', 'true');
});

test('reduced motion keeps the laser to a live point and removes it on release', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.reload();
  await page.getByRole('button', { name: 'Laserpointer', exact: true }).click();
  await page.mouse.move(460, 280); await page.mouse.down(); await page.mouse.move(560, 320, { steps: 6 });
  const layer = page.getByTestId('laser-pointer-layer');
  await expect(layer).toBeVisible(); await expect(layer.locator('line')).toHaveCount(0);
  await page.mouse.up(); await expect(layer).toHaveCount(0);
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
  const image = page.locator('[data-kind=image]');
  await expect(image).toHaveCount(1);
  await expect(image.locator(':scope > g > image')).toHaveCount(1);
  await expect(image.locator(':scope > text')).toHaveCount(0);
  await expect(image.locator(':scope > title')).toContainText('pixel.png');
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
