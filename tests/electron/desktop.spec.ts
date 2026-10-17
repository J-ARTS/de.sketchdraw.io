import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

import { stopElectron } from './helpers/stop-electron';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function cleanElectronEnv(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] =>
    typeof entry[1] === 'string' && !/^(ELECTRON_RUN_AS_NODE|ELECTRON_DISABLE_SANDBOX|NODE_OPTIONS|NODE_PATH|SKETCHDRAW_.*)$/i.test(entry[0]),
  ));
}
test.describe('Built Electron product: sandbox, IPC, menu and dirty close', () => {
  test('native save cancellation and the real dirty dialog preserve the canvas; forged close is rejected', async ({}, testInfo) => {
    test.setTimeout(45_000);
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-desktop-product-')));
    let app: ElectronApplication | undefined;
    let failure: unknown;
    try {
      // Relocate exact built product files because Main resolves assets relative to __dirname.
      // The launcher only isolates app data; no renderer fixture or product logic is substituted.
      for (const dir of ['dist', 'dist-electron', 'dist-mcp']) await cp(path.join(projectRoot, dir), path.join(root, dir), { recursive: true });
      await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'sketchdraw-desktop-product-test', version: '0.0.0', main: 'entry.cjs' }));
      await writeFile(path.join(root, 'entry.cjs'), "const {app}=require('electron');const path=require('node:path');app.setPath('userData',path.join(__dirname,'profile'));app.setPath('sessionData',path.join(__dirname,'session'));require('./dist-electron/main.cjs');");
      app = await electron.launch({ args: [root], env: cleanElectronEnv(), chromiumSandbox: true, timeout: 15_000 });
      const electronApp = app;
      const page = await electronApp.firstWindow();
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
      expect(page.url()).toBe('app://sketchdraw/index.html');

      await test.step('real product sandbox, isolation and bridge input validation', async () => {
        const metadata = await electronApp.evaluate(({ app, BrowserWindow }) => {
          const win = BrowserWindow.getAllWindows()[0]!;
          return {
            appPath: app.getAppPath(), userData: app.getPath('userData'), sessionData: app.getPath('sessionData'),
            minimum: win.getMinimumSize(), bounds: win.getBounds(),
            sandboxed: app.getAppMetrics().find(metric => metric.pid === win.webContents.getOSProcessId())?.sandboxed,
          };
        });
        expect(metadata).toMatchObject({ appPath: root, userData: path.join(root, 'profile'), sessionData: path.join(root, 'session'), minimum: [960, 640] });
        expect(metadata.bounds.width).toBeGreaterThanOrEqual(960); expect(metadata.bounds.height).toBeGreaterThanOrEqual(640);
        if (process.platform === 'darwin' || process.platform === 'win32') expect(metadata.sandboxed).toBe(true);

        // Unlike page.evaluate, executeJavaScript(..., false) does not manufacture user activation.
        // Assert the precondition before any user interaction and never intentionally open an external URL.
        expect(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.executeJavaScript(`(async()=>{
          const until=performance.now()+10000;
          while(navigator.userActivation.isActive && performance.now()<until) await new Promise(resolve=>setTimeout(resolve,100));
          if(navigator.userActivation.isActive) return {inactive:false};
          const rejected=[];
          for(const url of ['javascript:alert(1)','https://example.invalid/']) {
            try { await window.sketchdraw.openExternal(url); rejected.push(false); } catch { rejected.push(true); }
          }
          return {inactive:true,rejected};
        })()`, false))).toEqual({ inactive: true, rejected: [true, true] });
        const surface = await page.evaluate(async () => {
          const globals = window as unknown as Record<string, unknown>;
          globals.desktopMainWorldMarker = true;
          return { globals: ['require', 'process', 'Buffer', 'ipcRenderer'].filter(key => typeof globals[key] !== 'undefined'), platform: window.sketchdraw?.platform, frozen: Object.isFrozen(window.sketchdraw), keys: Object.keys(window.sketchdraw!).sort(), popupBlocked: window.open('https://example.invalid/', '_blank') === null,
            invalidHandle: await window.sketchdraw!.saveDocument({ mode: 'save', handleId: '/etc/passwd', expectedVersionToken: `sha256:${'0'.repeat(64)}`, text: '{}', suggestedName: 'test.sketchdraw.json' }) };
        });
        expect(surface.globals).toEqual([]); expect(surface.platform).toBe('electron'); expect(surface.frozen).toBe(true); expect(surface.popupBlocked).toBe(true);
        expect(surface.keys).toEqual(['exportFile', 'onCloseRequested', 'onMenuCommand', 'openDocument', 'openExternal', 'platform', 'respondToClose', 'saveDocument']);
        expect(surface.invalidHandle).toMatchObject({ status: 'error', code: 'INVALID_HANDLE' });
        expect(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: 'typeof window.desktopMainWorldMarker' }]))).toBe('undefined');
      });

      await test.step('real Save menu reaches persistence and controlled native Cancel keeps a dirty drawing', async () => {
        await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
        await page.mouse.move(340, 240); await page.mouse.down(); await page.mouse.move(540, 360); await page.mouse.up();
        await expect(page.getByTestId('whiteboard-canvas').locator('[data-kind=rectangle]')).toHaveCount(1);
        await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'unsaved-new');

        // Shell-era regression: Save now has a real renderer consumer. Stub only the OS dialog result,
        // retaining actual Menu -> preload -> renderer -> IPC -> persistence -> cancellation behavior.
        await electronApp.evaluate(({ dialog }) => {
          const state = globalThis as unknown as { desktopSaveDialogCalls: number };
          state.desktopSaveDialogCalls = 0;
          dialog.showSaveDialog = async () => { state.desktopSaveDialogCalls++; return { canceled: true, filePath: '' }; };
        });
        await electronApp.evaluate(({ Menu }) => {
          const item = Menu.getApplicationMenu()?.getMenuItemById('file-save');
          if (!item) throw new Error('Product Save menu item is missing.'); item.click();
        });
        await expect.poll(() => electronApp.evaluate(() => (globalThis as unknown as { desktopSaveDialogCalls: number }).desktopSaveDialogCalls)).toBe(1);
        await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'unsaved-new');
        await expect(page.getByTestId('whiteboard-canvas').locator('[data-kind=rectangle]')).toHaveCount(1);
      });

      await test.step('real UI cancels dirty close, forged ID cannot bypass it, confirmed discard closes', async () => {
        // Observe request IDs without replacing or answering the product's own listener.
        await page.evaluate(() => {
          const state = window as unknown as { desktopCloseIds: string[] }; state.desktopCloseIds = [];
          window.sketchdraw!.onCloseRequested(id => state.desktopCloseIds.push(id));
        });
        await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible(); await expect(dialog).toContainText('Änderungen behalten?');
        const firstId = await page.evaluate(() => (window as unknown as { desktopCloseIds: string[] }).desktopCloseIds[0]!);
        expect(firstId).toMatch(/^close_[0-9a-f]{32}$/);
        expect(await page.evaluate(async () => { try { await window.sketchdraw!.respondToClose(`close_${'0'.repeat(32)}`, 'close'); return false; } catch { return true; } })).toBe(true);
        expect(page.isClosed()).toBe(false); await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
        await expect(dialog).not.toBeVisible(); expect(page.isClosed()).toBe(false);
        await expect(page.getByTestId('whiteboard-canvas').locator('[data-kind=rectangle]')).toHaveCount(1);
        // A real UI write after cancellation verifies that the lifecycle barrier was released.
        await page.getByTestId('document-title').fill('Nach Abbruch weiterbearbeitet'); await page.getByTestId('document-title').press('Tab');
        await expect(page.getByTestId('save-status')).toHaveText('Nicht gespeichert');
        expect(await page.evaluate(async id => { try { await window.sketchdraw!.respondToClose(id, 'close'); return false; } catch { return true; } }, firstId)).toBe(true);
        await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
        await expect(dialog).toBeVisible();
        const secondId = await page.evaluate(() => (window as unknown as { desktopCloseIds: string[] }).desktopCloseIds.at(-1)!); expect(secondId).not.toBe(firstId);
        const closed = page.waitForEvent('close');
        await dialog.getByRole('button', { name: 'Verwerfen', exact: true }).click({ noWaitAfter: true }).catch(error => { if (!page.isClosed()) throw error; });
        await closed; expect(page.isClosed()).toBe(true);
      });
      expect(errors).toEqual([]);
      const hashes = Object.fromEntries(await Promise.all(['dist-electron/main.cjs', 'dist-electron/preload.cjs', 'dist/index.html'].map(async file => [file, createHash('sha256').update(await readFile(path.join(root, file))).digest('hex')])));
      await testInfo.attach('desktop-product-evidence', { body: JSON.stringify({ scope: 'Actual unmodified built product with OS Save dialog cancellation stub only; unpackaged, current platform.', platform: process.platform, hashes, actualDirtyCanvas: true, nativeSaveCancelled: true, dirtyCloseCancelledViaUI: true, forgedAndStaleCloseRejected: true, discardClosedWindow: true }, null, 2), contentType: 'application/json' });
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      try {
        if (app) {
          const result = await stopElectron(app);
          await testInfo.attach('owned-process-cleanup', { body: JSON.stringify(result), contentType: 'application/json' });
        }
        await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
      } catch (cleanupError) {
        if (!failure) throw cleanupError;
        console.warn('Owned test cleanup also failed; preserving the original test error.');
      }
    }
  });
});
