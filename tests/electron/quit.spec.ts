import { cp, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

import { stopElectron } from './helpers/stop-electron';

/**
 * Quitting the built product with unsaved work (#218). `app.quit()` is what Cmd+Q and the Quit menu item call.
 * On macOS closing the last window does not quit, so a quit the user confirmed in the dialog for unsaved work only
 * ends the process when the main process continues it after the window has closed.
 */
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function cleanElectronEnv(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] =>
    typeof entry[1] === 'string' && !/^(ELECTRON_RUN_AS_NODE|ELECTRON_DISABLE_SANDBOX|NODE_OPTIONS|NODE_PATH|SKETCHDRAW_.*)$/i.test(entry[0]),
  ));
}
async function launch(): Promise<{ app: ElectronApplication; page: Page; root: string }> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-quit-')));
  for (const dir of ['dist', 'dist-electron', 'dist-mcp']) await cp(path.join(projectRoot, dir), path.join(root, dir), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'sketchdraw-quit-test', version: '0.0.0', main: 'entry.cjs' }));
  await writeFile(path.join(root, 'entry.cjs'), "const {app}=require('electron');const path=require('node:path');app.setPath('userData',path.join(__dirname,'profile'));app.setPath('sessionData',path.join(__dirname,'session'));require('./dist-electron/main.cjs');");
  const app = await electron.launch({ args: [root], env: cleanElectronEnv(), chromiumSandbox: true, timeout: 15_000 });
  const page = await app.firstWindow();
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
  return { app, page, root };
}
async function cleanup(app: ElectronApplication | undefined, root: string | undefined): Promise<void> {
  if (app) await stopElectron(app).catch(() => undefined);
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }).catch(() => undefined);
}
/** Resolves with how the process ended, or `null` when it is still running after the time given. */
function exited(app: ElectronApplication, milliseconds: number): Promise<{ code: number | null; signal: NodeJS.Signals | null } | null> {
  const child = app.process();
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), milliseconds);
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
}
async function drawRectangle(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
  await page.mouse.move(400, 300); await page.mouse.down(); await page.mouse.move(520, 380); await page.mouse.up();
  await expect(page.getByTestId('whiteboard-canvas').locator('[data-kind=rectangle]')).toHaveCount(1);
}
const servicesAnswer = (page: Page) => page.evaluate(async () => {
  const bridge = (window as unknown as { sketchdraw: { plugins: { getSettings(handle: null): Promise<{ available: boolean }> }; updates: { getStatus(): Promise<unknown> } } }).sketchdraw;
  const settings = await bridge.plugins.getSettings(null);
  await bridge.updates.getStatus();
  return settings.available;
});

test.describe('Built Electron product: quitting with unsaved work (#218)', () => {
  test('cancel keeps the app working; quitting again and confirming ends the process without a signal', async () => {
    test.setTimeout(60_000);
    let app: ElectronApplication | undefined; let root: string | undefined;
    try {
      const launched = await launch(); app = launched.app; root = launched.root;
      const page = launched.page; const electronApp = launched.app;
      await drawRectangle(page);

      // First attempt: the dialog for unsaved work appears and the user cancels.
      await electronApp.evaluate(({ app: electronMain }) => { electronMain.quit(); });
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('Änderungen behalten?');
      await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
      await expect(dialog).not.toBeVisible();
      expect(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
      // The services of the app were not taken down by the attempt: plugins and updates still answer.
      expect(await servicesAnswer(page)).toBe(true);
      // And the document can be worked on.
      await page.getByTestId('document-title').fill('Nach Abbruch weitergearbeitet'); await page.getByTestId('document-title').press('Tab');
      await expect(page.getByTestId('save-status')).toHaveText('Nicht gespeichert');
      expect(await exited(electronApp, 500)).toBeNull();

      // Second attempt: confirmed. The window closes, and the quit that was asked for is carried through.
      await electronApp.evaluate(({ app: electronMain }) => { electronMain.quit(); });
      await expect(dialog).toContainText('Änderungen behalten?');
      await dialog.getByRole('button', { name: 'Verwerfen', exact: true }).click({ noWaitAfter: true }).catch((error: unknown) => { if (!page.isClosed()) throw error; });
      expect(await exited(electronApp, 20_000), 'the process ends by itself after the confirmed quit').toEqual({ code: 0, signal: null });
    } finally { await cleanup(app, root); }
  });

  test('closing the window after a cancelled quit is only that: macOS keeps the app, the other platforms quit as always', async () => {
    test.setTimeout(60_000);
    let app: ElectronApplication | undefined; let root: string | undefined;
    try {
      const launched = await launch(); app = launched.app; root = launched.root;
      const page = launched.page; const electronApp = launched.app;
      await drawRectangle(page);
      await electronApp.evaluate(({ app: electronMain }) => { electronMain.quit(); });
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
      await expect(dialog).not.toBeVisible();

      // Now the red button, not Quit.
      await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
      await expect(dialog).toBeVisible();
      const closed = page.waitForEvent('close');
      await dialog.getByRole('button', { name: 'Verwerfen', exact: true }).click({ noWaitAfter: true }).catch((error: unknown) => { if (!page.isClosed()) throw error; });
      await closed;
      if (process.platform === 'darwin') {
        // The cancelled quit was forgotten: the app stays in the Dock without a window …
        expect(await exited(electronApp, 3_000)).toBeNull();
        // … and quits normally when asked.
        await electronApp.evaluate(({ app: electronMain }) => { electronMain.quit(); }).catch(() => undefined);
      }
      expect(await exited(electronApp, 20_000)).toEqual({ code: 0, signal: null });
    } finally { await cleanup(app, root); }
  });
});
