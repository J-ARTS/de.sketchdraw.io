import { cp, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { stopElectron } from './helpers/stop-electron';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// #174: the desktop app denies every permission request, so copy and paste must work through clipboard events alone.
test('the desktop app pastes a clipboard image and copies elements without clipboard permission', async ({}, testInfo) => {
  test.setTimeout(60_000);
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-clipboard-product-')));
  let app: ElectronApplication | undefined;
  try {
    for (const dir of ['dist', 'dist-electron', 'dist-mcp']) await cp(path.join(projectRoot, dir), path.join(root, dir), { recursive: true });
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'sketchdraw-clipboard-test', version: '0.0.0', main: 'entry.cjs' }));
    await writeFile(path.join(root, 'entry.cjs'), "const {app}=require('electron');const path=require('node:path');app.setPath('userData',path.join(__dirname,'profile'));app.setPath('sessionData',path.join(__dirname,'session'));require('./dist-electron/main.cjs');");
    const environment = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !/^(ELECTRON_RUN_AS_NODE|ELECTRON_DISABLE_SANDBOX|NODE_OPTIONS|NODE_PATH|SKETCHDRAW_.*)$/i.test(entry[0])));
    app = await electron.launch({ args: [root], env: environment, chromiumSandbox: true });
    const desktop = app;
    const page = await desktop.firstWindow();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const canvas = page.getByTestId('whiteboard-canvas');
    await expect(canvas).toBeVisible();
    // Precondition of the whole test: the permission-bound clipboard API is not available here.
    expect(await page.evaluate(() => navigator.clipboard.readText().then(() => 'allowed', () => 'denied'))).toBe('denied');

    // A bitmap on the system clipboard, as a screenshot tool leaves it.
    await desktop.evaluate(async ({ clipboard, ClipboardItem, nativeImage }) => {
      const size = { width: 64, height: 40 };
      const png = nativeImage.createFromBitmap(Buffer.alloc(size.width * size.height * 4, 0xcc), size).toPNG();
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })]);
    });
    const box = (await canvas.boundingBox())!;
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await canvas.focus();
    await page.mouse.move(at.x, at.y);
    await page.keyboard.press('ControlOrMeta+v');
    const image = page.locator('[data-kind="image"]');
    await expect(image).toHaveCount(1);
    const pasted = (await image.boundingBox())!;
    expect(pasted.x + pasted.width / 2).toBeCloseTo(at.x, -1);
    expect(pasted.y + pasted.height / 2).toBeCloseTo(at.y, -1);

    // "Bearbeiten → Einfügen" of the native menu takes the same route.
    await page.mouse.move(at.x - 200, at.y - 120);
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.paste());
    await expect(image).toHaveCount(2);

    // Elements: the copy reaches the system clipboard (not only an internal buffer) and comes back on paste.
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
    await page.mouse.move(at.x + 120, at.y + 80); await page.mouse.down(); await page.mouse.move(at.x + 260, at.y + 170, { steps: 4 }); await page.mouse.up();
    const rectangles = page.locator('[data-kind="rectangle"]');
    await expect(rectangles).toHaveCount(1);
    await canvas.focus();
    await page.keyboard.press('ControlOrMeta+c');
    await expect(page.getByRole('region', { name: 'Meldungen' }).getByText('1 Element kopiert.')).toBeVisible();
    expect(JSON.parse(await desktop.evaluate(({ clipboard }) => clipboard.readText()))).toMatchObject({ format: 'sketchdraw.elements', version: 1 });
    await page.mouse.move(at.x - 220, at.y + 140);
    await page.keyboard.press('ControlOrMeta+v');
    await expect(rectangles).toHaveCount(2);
    await expect(image).toHaveCount(2);
    expect(errors).toEqual([]);

    await testInfo.attach('desktop-clipboard-evidence', { contentType: 'application/json', body: Buffer.from(JSON.stringify({ clipboardApi: 'denied', imagePasteByKey: true, imagePasteByMenuRole: true, elementCopyOnSystemClipboard: true })) });
  } finally {
    if (app) await stopElectron(app);
    await rm(root, { recursive: true, force: true });
  }
});
