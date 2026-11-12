import { cp, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
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
function appLink(documentId: string): { link: string; fragment: string } {
  const payload = { v: 1, s: 'ab'.repeat(32), h: Buffer.alloc(32, 7).toString('base64url'), d: 'cd'.repeat(32), r: '', i: documentId, e: Date.now() + 60_000 };
  const fragment = `sketchdraw-hdht=${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  return { link: `sketchdraw://join#${fragment}`, fragment };
}

test('the built app opens a sketchdraw://join link in the collaboration panel and ignores everything else', async () => {
  test.setTimeout(45_000);
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-app-link-')));
  let app: ElectronApplication | undefined;
  try {
    // The exact built product; the launcher only isolates app data.
    for (const dir of ['dist', 'dist-electron', 'dist-mcp']) await cp(path.join(projectRoot, dir), path.join(root, dir), { recursive: true });
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'sketchdraw-app-link-test', version: '0.0.0', main: 'entry.cjs' }));
    await writeFile(path.join(root, 'entry.cjs'), "const {app}=require('electron');const path=require('node:path');app.setPath('userData',path.join(__dirname,'profile'));app.setPath('sessionData',path.join(__dirname,'session'));require('./dist-electron/main.cjs');");
    const launch = appLink('document:launch');
    // Windows and Linux hand the link to the process as an argument.
    app = await electron.launch({ args: [root, launch.link], env: cleanElectronEnv(), chromiumSandbox: true, timeout: 15_000 });
    const electronApp = app;
    const page = await electronApp.firstWindow();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
    const panel = page.getByTestId('collaboration-panel');
    const linkField = page.getByRole('textbox', { name: 'Link für PIN-Beitritt' });
    await expect(panel).toBeVisible();
    await expect(linkField).toHaveValue(launch.fragment);
    // The link never carries the PIN and never joins on its own.
    await expect(page.getByRole('textbox', { name: 'Sechsstellige PIN' })).toHaveValue('');
    await expect(page.getByTestId('hdht-status')).toHaveCount(0);
    // An unpackaged run must not take over the scheme of an installed app.
    expect(await electronApp.evaluate(({ app }) => ({ packaged: app.isPackaged, handler: app.isDefaultProtocolClient('sketchdraw') }))).toEqual({ packaged: false, handler: false });
    // The pending link is handed out once; a renderer cannot read it again.
    expect(await page.evaluate(() => new Promise<string[]>(resolve => {
      const seen: string[] = []; const off = window.sketchdraw!.onInviteLink!(link => seen.push(link));
      setTimeout(() => { off(); resolve(seen); }, 300);
    }))).toEqual([]);

    await page.getByRole('button', { name: 'Zusammenarbeit schließen' }).click();
    await expect(panel).toBeHidden();
    // macOS hands a link to the running app through open-url; forged values never reach the renderer.
    const emit = (url: string) => electronApp.evaluate(({ app }, value) => { app.emit('open-url', { preventDefault() {} }, value); }, url);
    const forged = appLink('document:forged');
    for (const url of [`https://example.org/#${forged.fragment}`, `sketchdraw://open#${forged.fragment}`, `sketchdraw://join#${forged.fragment}&pin=123456`, 'sketchdraw://join']) await emit(url);
    await page.waitForTimeout(300);
    await expect(panel).toBeHidden();
    const running = appLink('document:running');
    await emit(running.link);
    await expect(panel).toBeVisible();
    await expect(linkField).toHaveValue(running.fragment);
    expect(errors).toEqual([]);
  } finally {
    if (app) await stopElectron(app);
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
