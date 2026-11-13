import { expect, test, type Page } from '@playwright/test';

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
  await expect(page.getByRole('region', { name: 'Meldungen' }).getByText('Die Zwischenablage enthält weder Sketchdraw-Elemente noch ein Bild.')).toBeVisible();

  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.mouse.click(620, 420);
  const editor = page.getByTestId('canvas-text-editor');
  await editor.fill('A');
  await page.evaluate(() => navigator.clipboard.writeText('B'));
  await editor.press('End');
  await editor.press('ControlOrMeta+v');
  await expect(editor).toHaveValue('AB');
});

/** A small opaque PNG, drawn in the page so the bytes are a real image. */
async function pngBytes(page: Page, width: number, height: number): Promise<number[]> {
  return page.evaluate(async ([w, h]) => {
    const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const context = canvas.getContext('2d')!; context.fillStyle = '#3355ff'; context.fillRect(0, 0, w!, h!);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, [width, height]);
}

/** Fires the paste event a browser sends for a copied file; `selector` picks the element that has focus. */
async function pasteFile(page: Page, file: { name: string; type: string; bytes: number[] }, selector = '[data-testid="whiteboard-canvas"]'): Promise<boolean> {
  return page.evaluate(([input, target]) => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array(input!.bytes)], input!.name, { type: input!.type }));
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    document.querySelector(target!)!.dispatchEvent(event);
    return event.defaultPrevented;
  }, [file, selector] as const);
}

test('Ctrl/Cmd+V inserts an image from the clipboard at the mouse, selected and undoable (#174)', async ({ page }) => {
  const canvas = page.getByTestId('whiteboard-canvas');
  // A screenshot or "copy image" puts a bitmap on the system clipboard.
  await page.evaluate(async (bytes) => {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(bytes)], { type: 'image/png' }) })]);
  }, await pngBytes(page, 320, 200));
  await canvas.focus();
  await page.mouse.move(700, 420);
  await page.keyboard.press('ControlOrMeta+v');
  const image = page.locator('[data-kind="image"]');
  await expect(image).toHaveCount(1);
  const box = (await image.boundingBox())!;
  expect(box.width).toBeCloseTo(320, 0);
  expect(box.height).toBeCloseTo(200, 0);
  expect(box.x + box.width / 2).toBeCloseTo(700, -1);
  expect(box.y + box.height / 2).toBeCloseTo(420, -1);
  // The pasted image is the selection: Delete removes exactly it, and both steps can be undone.
  await page.keyboard.press('Delete');
  await expect(image).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(image).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(image).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(image).toHaveCount(1);

  // Pasting again adds a second copy of the same clipboard image.
  await page.mouse.move(300, 560);
  await page.keyboard.press('ControlOrMeta+v');
  await expect(image).toHaveCount(2);
});

test('copy and paste need no clipboard permission, as in the desktop app (#174)', async ({ page, context }) => {
  await context.clearPermissions();
  const canvas = page.getByTestId('whiteboard-canvas');
  await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
  await page.mouse.move(300, 220); await page.mouse.down(); await page.mouse.move(500, 360); await page.mouse.up();
  await canvas.focus();
  await page.keyboard.press('ControlOrMeta+c');
  await expect(page.getByRole('region', { name: 'Meldungen' }).getByText('1 Element kopiert.')).toBeVisible();
  await page.mouse.move(820, 610);
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.locator('[data-kind="rectangle"]')).toHaveCount(2);

  // A copied image file arrives as a file of the paste event; JPEG is accepted as well.
  const jpeg = await page.evaluate(async () => {
    const source = Object.assign(document.createElement('canvas'), { width: 120, height: 80 });
    source.getContext('2d')!.fillRect(0, 0, 120, 80);
    const blob = await new Promise<Blob>(resolve => source.toBlob(value => resolve(value!), 'image/jpeg'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  expect(await pasteFile(page, { name: 'foto.jpg', type: 'image/jpeg', bytes: jpeg })).toBe(true);
  await expect(page.locator('[data-kind="image"]')).toHaveCount(1);
});

test('unsupported clipboard images are reported; text fields and dialogs keep their own paste (#174)', async ({ page }) => {
  const notices = page.getByRole('region', { name: 'Meldungen' });
  const png = await pngBytes(page, 40, 40);
  expect(await pasteFile(page, { name: 'animation.gif', type: 'image/gif', bytes: [71, 73, 70, 56, 57, 97] })).toBe(true);
  await expect(notices.getByText('Erlaubt sind PNG, JPEG und WebP.')).toBeVisible();
  await expect(page.locator('[data-kind="image"]')).toHaveCount(0);

  // The canvas text editor is a text field: the event is not taken over and no image element appears.
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.mouse.click(620, 420);
  await expect(page.getByTestId('canvas-text-editor')).toBeVisible();
  expect(await pasteFile(page, { name: 'image.png', type: 'image/png', bytes: png }, '[data-testid="canvas-text-editor"]')).toBe(false);
  await page.keyboard.press('Escape');

  // An open dialog sits above the canvas; pasting there must not change the drawing behind it.
  await page.getByTestId('workspace-menu-button').click();
  await page.getByRole('menuitem', { name: 'Einstellungen', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Einstellungen' })).toBeVisible();
  expect(await pasteFile(page, { name: 'image.png', type: 'image/png', bytes: png }, 'dialog[open] button')).toBe(false);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-kind="image"]')).toHaveCount(0);

  // Back on the canvas the same file is inserted.
  expect(await pasteFile(page, { name: 'image.png', type: 'image/png', bytes: png })).toBe(true);
  await expect(page.locator('[data-kind="image"]')).toHaveCount(1);
});

test('copy and paste work on an added page, whose ID is not the default one (#185)', async ({ page }) => {
  await page.getByTestId('page-switcher').click();
  await page.getByTestId('page-add').click();
  await expect(page.getByRole('button', { name: /^Seite 2/ })).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Ellipse', exact: true }).click();
  await page.mouse.move(300, 220); await page.mouse.down(); await page.mouse.move(460, 340, { steps: 6 }); await page.mouse.up();
  await expect(page.locator('[data-kind="ellipse"]')).toHaveCount(1);
  await page.getByTestId('whiteboard-canvas').focus();
  await page.keyboard.press('ControlOrMeta+c');
  await expect(page.getByRole('region', { name: 'Meldungen' }).getByText('1 Element kopiert.')).toBeVisible();
  await page.mouse.move(820, 610);
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.locator('[data-kind="ellipse"]')).toHaveCount(2);
  await expect(page.getByText('Die Zwischenablage enthält weder Sketchdraw-Elemente noch ein Bild.')).toHaveCount(0);
});
