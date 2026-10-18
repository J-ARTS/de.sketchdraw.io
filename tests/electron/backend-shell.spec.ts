import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import type { DesktopBridge, SaveDocumentRequest } from '../../src/domain/types';
import { stopElectron } from './helpers/stop-electron';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const entryUrl = 'app://sketchdraw/index.html';

type FixtureWindow = Window & {
  sketchdraw: DesktopBridge;
  backendFixture: { closeRequests: string[]; menuCommands: string[] };
  backendMainWorldMarker?: string;
};

interface BackendShell {
  app: ElectronApplication;
  page: Page;
  root: string;
  preloadPath: string;
}

const saveRequest: SaveDocumentRequest = {
  mode: 'save',
  handleId: `hdl_${'0'.repeat(32)}`,
  expectedVersionToken: `sha256:${'0'.repeat(64)}`,
  suggestedName: 'backend-fixture.sketchdraw',
  text: JSON.stringify({
    schemaVersion: 1,
    id: 'document:backend-fixture',
    title: 'Backend fixture',
    elements: [],
    assets: {},
    componentSets: [],
    metadata: {},
  }),
};

function cleanElectronEnv(): Record<string, string> {
  const excluded = new Set([
    'ELECTRON_RUN_AS_NODE',
    'ELECTRON_DISABLE_SANDBOX',
    'SKETCHDRAW_DEV_SERVER_URL',
    'NODE_OPTIONS',
    'NODE_PATH',
  ]);
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' && !excluded.has(entry[0].toUpperCase()),
    ),
  );
}

async function bounded<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Electron backend fixture operation timed out.')), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const test = base.extend<{ backend: BackendShell }>({
  backend: [async ({}, use, testInfo) => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-backend-shell-')));
    let app: ElectronApplication | undefined;
    let primaryFailure = false;
    try {
      await Promise.all(
        ['dist', 'dist-electron', 'user-data', 'session-data'].map((dir) =>
          mkdir(path.join(root, dir), { mode: 0o700 }),
        ),
      );
      const hashes: Record<string, string> = {};
      // Main resolves dist relative to __dirname. Relocate the exact build artifacts;
      // do not replace protocol, IPC, preload, security, or close-handshake implementation.
      for (const filename of ['main.cjs', 'preload.cjs']) {
        const source = path.join(projectRoot, 'dist-electron', filename);
        const destination = path.join(root, 'dist-electron', filename);
        const original = await readFile(source);
        await copyFile(source, destination);
        expect(await readFile(destination), `${filename} must be the unmodified build`).toEqual(original);
        hashes[filename] = createHash('sha256').update(original).digest('hex');
      }
      await writeFile(path.join(root, 'package.json'), JSON.stringify({
        name: 'sketchdraw-backend-shell-fixture',
        version: '0.0.0',
        main: 'fixture-main.cjs',
      }));
      await writeFile(path.join(root, 'fixture-main.cjs'), `
const { app } = require('electron');
const path = require('node:path');
app.setPath('userData', path.join(__dirname, 'user-data'));
app.setPath('sessionData', path.join(__dirname, 'session-data'));
require('./dist-electron/main.cjs');
`);
      await writeFile(path.join(root, 'dist', 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Backend shell fixture</title>
<script src="/fixture.js" defer></script></head><body>
<h1>Backend shell test fixture — not the product UI</h1>
<a id="leave-app" href="https://example.invalid/">Attempt external navigation</a>
</body></html>`);
      await writeFile(path.join(root, 'dist', 'fixture.js'), `
window.backendFixture = { closeRequests: [], menuCommands: [] };
window.sketchdraw.onCloseRequested(id => window.backendFixture.closeRequests.push(id));
window.sketchdraw.onMenuCommand(command => window.backendFixture.menuCommands.push(command));
document.documentElement.dataset.fixtureReady = 'true';
`);
      app = await electron.launch({ args: [root], env: cleanElectronEnv(), chromiumSandbox: true, timeout: 15_000 });
      const page = await app.firstWindow();
      await expect(page.locator('html')).toHaveAttribute('data-fixture-ready', 'true');
      await testInfo.attach('backend-shell-artifacts', {
        body: JSON.stringify({
          scope: 'Unmodified Electron backend build with a minimal fixture, not the product renderer or packaged app.',
          hashes,
          platform: process.platform,
          versions: await app.evaluate(() => process.versions),
        }, null, 2),
        contentType: 'application/json',
      });
      await use({ app, page, root, preloadPath: path.join(root, 'dist-electron', 'preload.cjs') });
    } catch (error) {
      primaryFailure = true;
      throw error;
    } finally {
      try {
        if (app) {
          const stopped = await stopElectron(app);
          await testInfo.attach('backend-shell-cleanup', {
            body: JSON.stringify(stopped, null, 2), contentType: 'application/json',
          });
        }
        // A failed stop retains the directory as evidence; never race a live
        // Chromium process for its profile or replace its error with EBUSY.
        await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch (cleanupError) {
        await testInfo.attach('backend-shell-cleanup-failure', {
          body: `${String(cleanupError)}\nRetained fixture: ${root}`, contentType: 'text/plain',
        });
        if (!primaryFailure && testInfo.status === 'passed') throw cleanupError;
        console.warn(`Backend cleanup also failed; preserving the original test error. See backend-shell-cleanup-failure.`);
      }
    }
  }, { timeout: 20_000 }],
});

base('cleanup stops a stuck owned process before closing automation', async ({}, testInfo) => {
  // A real owned process exercises the signal fallback. On Windows its real
  // descendant also proves /T behavior, without involving another user's app.
  const child = spawn(process.execPath, ['-e', `
    const { spawn } = require('node:child_process');
    process.on('SIGTERM', () => {});
    const descendant = process.platform === 'win32'
      ? spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
      : undefined;
    process.send({ descendantPid: descendant?.pid });
    setInterval(() => {}, 1000);
  `], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  let contextClosed = false;
  const driver = {
    process: () => child,
    evaluate: async () => { throw new Error('Deliberately unavailable test automation.'); },
    close: async () => {
      expect(child.exitCode !== null || child.signalCode !== null, 'close waits for OS exit').toBe(true);
      contextClosed = true;
    },
  } as unknown as ElectronApplication;
  try {
    const ready = await bounded(new Promise<{ descendantPid?: number }>((resolve, reject) => {
      child.once('message', (value) => resolve(value as { descendantPid?: number }));
      child.once('error', reject);
    }), 5_000);
    const stopped = await stopElectron(driver);
    expect(contextClosed).toBe(true);
    expect(stopped.pid).toBe(child.pid);
    expect(stopped.exitCode !== null || stopped.signalCode !== null).toBe(true);
    if (process.platform === 'win32') {
      expect(stopped.steps).toEqual(['taskkill-owned-tree', 'automation-closed']);
      expect(ready.descendantPid).toBeGreaterThan(1);
      await expect.poll(() => {
        try { process.kill(ready.descendantPid!, 0); return false; }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
          throw error;
        }
      }, { timeout: 3_000 }).toBe(true);
    } else {
      expect(stopped.steps).toEqual(['app-exit-request', 'SIGTERM', 'SIGKILL', 'automation-closed']);
    }
    // Repeated cleanup must not signal an exited/reused PID.
    expect((await stopElectron(driver)).steps).toEqual(['already-exited', 'automation-closed']);
    await testInfo.attach('owned-process-cleanup', {
      body: JSON.stringify({ ...stopped, descendantPid: ready.descendantPid }, null, 2),
      contentType: 'application/json',
    });
  } finally {
    if (child.exitCode === null && child.signalCode === null) await stopElectron(driver);
  }
});

test.describe('Built Electron backend with a minimal renderer fixture', () => {
  test('loads app:// with the real sandboxed preload and rejects unsafe bridge inputs', async ({ backend }) => {
    const { app, page, root } = backend;
    expect(page.url()).toBe(entryUrl);
    await expect(page.getByRole('heading')).toHaveText('Backend shell test fixture — not the product UI');
    const metadata = await app.evaluate(({ app, BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]!;
      const metric = app.getAppMetrics().find((item) => item.pid === win.webContents.getOSProcessId());
      return {
        appPath: app.getAppPath(),
        userData: app.getPath('userData'),
        isPackaged: app.isPackaged,
        sandboxDisabled: app.commandLine.hasSwitch('no-sandbox'),
        setuidSandboxDisabled: app.commandLine.hasSwitch('disable-setuid-sandbox'),
        rendererSandboxed: metric?.sandboxed,
      };
    });
    expect(metadata).toMatchObject({
      appPath: root,
      userData: path.join(root, 'user-data'),
      isPackaged: false,
      sandboxDisabled: false,
      setuidSandboxDisabled: false,
    });
    // Electron exposes this OS sandbox metric on macOS/Windows, not Linux.
    if (process.platform === 'darwin' || process.platform === 'win32') {
      expect(metadata.rendererSandboxed).toBe(true);
    }
    // Schedule this once: only renderer timers observe activation until it expires.
    // Re-entering through automation on every poll can renew the state we test.
    // A failed precondition never calls the external opener.
    const externalChecks = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.executeJavaScript(`(async () => {
        const deadline = performance.now() + 10000;
        while (navigator.userActivation.isActive && performance.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        const activeBeforeCalls = [];
        const errors = [];
        for (const url of ['javascript:alert(1)', 'https://example.invalid/']) {
          activeBeforeCalls.push(navigator.userActivation.isActive);
          if (navigator.userActivation.isActive) return { inactive: false, activeBeforeCalls, errors };
          try { await window.sketchdraw.openExternal(url); errors.push(null); }
          catch (error) { errors.push(String(error)); }
        }
        return { inactive: true, activeBeforeCalls, errors };
      })()`, false),
    );
    expect(externalChecks).toEqual({
      inactive: true,
      activeBeforeCalls: [false, false],
      errors: [
        expect.stringContaining('Unsupported external URL protocol'),
        expect.stringContaining('External links can only be opened directly from a human UI interaction.'),
      ],
    });
    await page.evaluate(() => {
      (window as unknown as FixtureWindow).backendMainWorldMarker = 'main-world-only';
    });
    // World 999 is Electron's preload context. Main-world data must remain isolated.
    expect(await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.executeJavaScriptInIsolatedWorld(999, [{
        code: 'typeof window.backendMainWorldMarker',
      }]),
    )).toBe('undefined');
    const surface = await page.evaluate(async () => {
      const w = window as unknown as FixtureWindow;
      const globals = window as unknown as Record<string, unknown>;
      const response = await fetch('/index.html');
      return {
        platform: w.sketchdraw.platform,
        frozen: Object.isFrozen(w.sketchdraw),
        exposedNodeGlobals: ['require', 'process', 'Buffer', 'ipcRenderer']
          .filter((key) => typeof globals[key] !== 'undefined'),
        keys: Object.keys(w.sketchdraw).sort(),
        status: response.status,
        csp: response.headers.get('content-security-policy'),
      };
    });
    expect(surface.platform).toBe('electron');
    expect(surface.frozen).toBe(true);
    expect(surface.exposedNodeGlobals).toEqual([]);
    expect(surface.keys).toEqual([
      'exportFile', 'onCloseRequested', 'onMenuCommand', 'openDocument',
      'openExternal', 'platform', 'plugins', 'respondToClose', 'saveDocument',
    ]);
    expect(surface.status).toBe(200);
    expect(surface.csp).toContain("script-src 'self'");
    expect(surface.csp).toContain("object-src 'none'");

    // A syntactically valid unknown handle reaches the real Main persistence handler without a dialog/write.
    expect(await page.evaluate((request) =>
      (window as unknown as FixtureWindow).sketchdraw.saveDocument(request), saveRequest,
    )).toMatchObject({ status: 'error', code: 'UNKNOWN_HANDLE' });
    expect(await page.evaluate((request) =>
      (window as unknown as FixtureWindow).sketchdraw.saveDocument({ ...request, handleId: '/etc/passwd' }), saveRequest,
    )).toMatchObject({ status: 'error', code: 'INVALID_HANDLE' });
  });

  test('blocks popups/navigation and rejects another real WebContents even at the same app origin', async ({ backend }) => {
    const { app, page, preloadPath } = backend;
    expect(await page.evaluate(() => window.open('https://example.invalid/', '_blank'))).toBeNull();
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);

    const navigation = app.evaluate(({ BrowserWindow }) => new Promise<{ url: string; prevented: boolean }>((resolve) => {
      BrowserWindow.getAllWindows()[0]!.webContents.once('will-navigate', (event, url) => {
        resolve({ url, prevented: event.defaultPrevented });
      });
    }));
    await page.locator('#leave-app').click({ noWaitAfter: true });
    expect(await bounded(navigation, 3_000)).toEqual({
      url: 'https://example.invalid/', prevented: true,
    });
    expect(page.url()).toBe(entryUrl);

    const otherPagePromise = app.waitForEvent('window');
    const otherWindowId = await app.evaluate(async ({ BrowserWindow }, preload) => {
      const win = new BrowserWindow({
        show: false,
        webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      await win.loadURL('app://sketchdraw/index.html');
      return win.id;
    }, preloadPath);
    const otherPage = await otherPagePromise;
    try {
      await expect(otherPage.locator('html')).toHaveAttribute('data-fixture-ready', 'true');
      expect(await otherPage.evaluate((request) =>
        (window as unknown as FixtureWindow).sketchdraw.saveDocument(request), saveRequest,
      )).toMatchObject({ status: 'error', code: 'UNAUTHORIZED_SENDER' });
    } finally {
      await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), otherWindowId);
    }
  });

  test('routes menu commands and requires the current close request before actually closing', async ({ backend }) => {
    const { app, page } = backend;
    await app.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById('file-save');
      if (!item) throw new Error('Product save menu item is missing.');
      item.click();
    });
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as FixtureWindow).backendFixture.menuCommands,
    )).toEqual(['save']);

    const requestClose = async (count: number): Promise<string> => {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
      await expect.poll(() => page.evaluate(() =>
        (window as unknown as FixtureWindow).backendFixture.closeRequests.length,
      )).toBe(count);
      return page.evaluate(() => (window as unknown as FixtureWindow).backendFixture.closeRequests.at(-1)!);
    };
    const first = await requestClose(1);
    expect(first).toMatch(/^close_[0-9a-f]{32}$/);
    expect(page.isClosed()).toBe(false);
    const second = await requestClose(2);
    expect(second).not.toBe(first);
    expect(await page.evaluate(async (staleId) => {
      try {
        await (window as unknown as FixtureWindow).sketchdraw.respondToClose(staleId, 'close');
        return false;
      } catch {
        return true;
      }
    }, first)).toBe(true);
    expect(page.isClosed()).toBe(false);

    await page.evaluate((id) => (window as unknown as FixtureWindow).sketchdraw.respondToClose(id, 'cancel'), second);
    expect(page.isClosed()).toBe(false);
    const third = await requestClose(3);
    expect(third).not.toBe(second);
    const closed = page.waitForEvent('close');
    await page.evaluate((id) => {
      // The Main handler closes the renderer before its invoke reply can necessarily arrive.
      void (window as unknown as FixtureWindow).sketchdraw.respondToClose(id, 'close').catch(() => {});
    }, third).catch((error: unknown) => {
      if (!page.isClosed()) throw error;
    });
    await closed;
    expect(page.isClosed()).toBe(true);
  });
});
