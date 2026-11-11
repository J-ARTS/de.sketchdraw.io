import { createRequire } from 'node:module';
import { cp, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { stopElectron } from './helpers/stop-electron';

const require = createRequire(import.meta.url);
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// Invitations, PINs and the local MCP runtime capability must not be captured in artifacts.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test('built Electron peers use real native IPC and isolated HyperDHT for URL/PIN, Yjs and opt-in helpers', async ({}, testInfo) => {
  test.setTimeout(90_000);
  const net = await require('hyperdht/testnet')(3);
  const roots: string[] = [], apps: ElectronApplication[] = [], errors: string[] = [];
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => typeof value === 'string' && !/^(ELECTRON_RUN_AS_NODE|ELECTRON_DISABLE_SANDBOX|NODE_OPTIONS|NODE_PATH|SKETCHDRAW_.*)$/i.test(key))) as Record<string, string>;
  async function launch() {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-native-acceptance-'))); roots.push(root);
    for (const dir of ['dist', 'dist-electron', 'dist-mcp']) await cp(path.join(project, dir), path.join(root, dir), { recursive: true });
    await symlink(path.join(project, 'node_modules'), path.join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'sketchdraw-native-acceptance', version: '0.0.0', main: 'entry.cjs' }));
    // Only network bootstraps and app storage are fixtures. Main/preload/renderer and the native implementation are
    // the exact built product. Real HyperDHT sockets are restricted to the owned loopback test network.
    await writeFile(path.join(root, 'entry.cjs'), `const {app}=require('electron');const path=require('node:path');
app.setPath('userData',path.join(__dirname,'profile'));app.setPath('sessionData',path.join(__dirname,'session'));
const entry=require.resolve('hyperdht');const DHT=require(entry);require.cache[entry].exports=class LocalDHT extends DHT { constructor(options={}) { super({...options, bootstrap:${JSON.stringify(net.bootstrap)},host:'127.0.0.1'}); } };
require('./dist-electron/main.cjs');`);
    const runtime = path.join(root, 'agent-runtime', 'active-v1.json');
    const app = await electron.launch({ args: [root], env: { ...env, SKETCHDRAW_MCP_RUNTIME_FILE: runtime }, chromiumSandbox: true, timeout: 20_000 }); apps.push(app);
    const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
    const hasLocalAgent = async () => { try { await readFile(runtime); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } };
    await expect.poll(hasLocalAgent).toBe(true);
    return { app, page, hasLocalAgent };
  }
  async function openPanel(page: Page) {
    await page.getByTestId('workspace-menu-button').click();
    await page.getByRole('menuitemcheckbox', { name: 'Zusammenarbeiten', exact: true }).click();
  }
  async function draw(page: Page, shape: string, y: number) {
    await page.getByRole('button', { name: shape, exact: true }).click();
    await page.mouse.move(300, y); await page.mouse.down(); await page.mouse.move(440, y + 80, { steps: 5 }); await page.mouse.up();
  }
  try {
    const owner = await launch(), guest = await launch();
    await draw(owner.page, 'Rechteck', 300); await openPanel(owner.page);
    const panel = owner.page.getByTestId('hdht-session');
    await panel.getByRole('combobox', { name: 'Zugriff für Eingeladene' }).selectOption('editor');
    await panel.getByTestId('hdht-network').locator('summary').click();
    const helper = panel.getByTestId('hdht-helper'); await expect(helper).not.toBeChecked();
    await helper.check(); await expect(helper).toBeChecked();
    expect(await owner.page.evaluate(() => window.sketchdraw!.helper!.status())).toMatchObject({ running: true, announced: true });
    await panel.getByTestId('hdht-start').click();
    await expect(panel.getByTestId('hdht-link')).toBeVisible({ timeout: 20_000 });
    // The invitation can initially describe only helper discovery. Wait for the actual native listen result.
    await expect.poll(async () => {
      const link = await panel.getByTestId('hdht-link').inputValue();
      const payload = link.split('sketchdraw-hdht=')[1]!;
      return JSON.parse(Buffer.from(payload, 'base64url').toString()).d;
    }).toMatch(/^[a-f0-9]{64}$/);
    const link = await panel.getByTestId('hdht-link').inputValue(), pin = await panel.getByTestId('hdht-host-pin').inputValue();
    await openPanel(guest.page);
    await guest.page.getByRole('textbox', { name: 'Link für PIN-Beitritt' }).fill(link);
    await guest.page.getByRole('textbox', { name: 'Sechsstellige PIN' }).fill(pin);
    await guest.page.getByTestId('hdht-join').click();
    await expect(guest.page.getByTestId('hdht-status')).toHaveText('Verbunden', { timeout: 20_000 });
    await expect(guest.page.getByTestId('hdht-session')).toContainText('Direktverbindung');
    await expect(guest.page.locator('.whiteboard-canvas [data-kind=rectangle]')).toHaveCount(1);
    await expect.poll(guest.hasLocalAgent).toBe(false);
    await draw(guest.page, 'Ellipse', 460);
    await expect(owner.page.locator('.whiteboard-canvas [data-kind=ellipse]')).toHaveCount(1);
    // Actual native IPC validates arguments and rejects them before opening sockets.
    expect(await guest.page.evaluate(() => window.sketchdraw!.direct!.connect('invalid', 'invalid').then(() => false, () => true))).toBe(true);
    await panel.getByTestId('hdht-stop').click();
    await expect(guest.page.getByTestId('hdht-session').getByRole('alert')).toContainText('Gastgeber hat deine Verbindung beendet');
    await expect(guest.page.getByRole('button', { name: 'Rechteck', exact: true })).toBeDisabled();
    expect(await guest.hasLocalAgent()).toBe(false);
    await expect(helper).toBeChecked();
    await guest.page.getByTestId('hdht-stop').click();
    await expect.poll(guest.hasLocalAgent).toBe(true);
    await helper.uncheck();
    await expect.poll(() => owner.page.evaluate(() => window.sketchdraw!.helper!.status())).toMatchObject({ running: false, connections: 0, sessions: 0 });
    expect(errors).toEqual([]);
    await testInfo.attach('native-session-evidence', { body: JSON.stringify({ platform: process.platform, builtProduct: true, isolatedLoopbackDht: true, realNativeIpc: true, directUrlPin: true, editorSync: true, guestMcpRevoked: true, disconnectedGuestReadOnly: true, explicitCopyRestoresMcp: true, helperOptIn: true, noPublicNatClaim: true }), contentType: 'application/json' });
  } finally {
    for (const app of apps.reverse()) await stopElectron(app);
    await net.destroy();
    for (const root of roots) await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
