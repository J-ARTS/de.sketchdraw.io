import { cp, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import WebSocket from 'ws';
import { bootstrapRoomDocument } from '../../src/collaboration/crdt';
import { parseHdhtInvitation } from '../../src/collaboration/hdht/invitation';
import { createHdhtGuestTransport } from '../../src/collaboration/hdht/session';
// @ts-expect-error plain ESM relay without declarations
import { createRelayServer } from '../../relay/server.mjs';
import { stopElectron } from './helpers/stop-electron';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// #300: the built desktop app hosts a session through a relay only. Its content security policy lets the WebSocket
// through, the helper of this device stays off, and guests outside the app reach the drawing through the relay.
test('the desktop app hosts a session through the relay; two guests receive the drawing and no helper runs', async () => {
  test.setTimeout(90_000);
  const relay = createRelayServer();
  const address = await relay.listen(0, '127.0.0.1');
  const relayHost = `127.0.0.1:${address.port}`;
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-route-product-')));
  let app: ElectronApplication | undefined;
  const guests: Array<{ close(): Promise<void> }> = [];
  try {
    for (const dir of ['dist', 'dist-electron', 'dist-mcp']) await cp(path.join(projectRoot, dir), path.join(root, dir), { recursive: true });
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'sketchdraw-route-test', version: '0.0.0', main: 'entry.cjs' }));
    await writeFile(path.join(root, 'entry.cjs'), "const {app}=require('electron');const path=require('node:path');app.setPath('userData',path.join(__dirname,'profile'));app.setPath('sessionData',path.join(__dirname,'session'));require('./dist-electron/main.cjs');");
    const environment = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !/^(ELECTRON_RUN_AS_NODE|ELECTRON_DISABLE_SANDBOX|NODE_OPTIONS|NODE_PATH|SKETCHDRAW_.*)$/i.test(entry[0])));
    app = await electron.launch({ args: [root], env: environment, chromiumSandbox: true });
    const page = await app.firstWindow();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const blocked: string[] = []; page.on('console', message => { if (/Content Security Policy|Refused to/i.test(message.text())) blocked.push(message.text().slice(0, 200)); });
    await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();

    await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
    await page.mouse.move(280, 300); await page.mouse.down(); await page.mouse.move(410, 380, { steps: 5 }); await page.mouse.up();
    await page.getByTestId('workspace-menu-button').click();
    await page.getByRole('menuitemcheckbox', { name: 'Zusammenarbeiten', exact: true }).click();
    const panel = page.getByTestId('hdht-session');
    await expect(panel.getByRole('combobox', { name: 'Verbindungsweg', exact: true })).toHaveText('Direkt (P2P)');
    await panel.getByRole('combobox', { name: 'Verbindungsweg', exact: true }).click();
    await page.getByRole('option', { name: 'Cloudflare-Relay', exact: true }).click();
    await panel.getByTestId('hdht-relay-address').fill(`ws://${relayHost}`);
    await panel.getByTestId('hdht-start').click();

    const field = panel.getByTestId('hdht-link');
    await expect(field).toHaveValue(/^sketchdraw:\/\/join#sketchdraw-hdht=[A-Za-z0-9_-]+$/);
    await expect(panel.getByTestId('hdht-active-route')).toHaveText(`Verbindungsweg: Cloudflare-Relay (${relayHost})`);
    await expect(panel.getByTestId('hdht-share-relay')).toHaveCount(0);
    const invitation = parseHdhtInvitation(await field.inputValue());
    const pin = await panel.getByTestId('hdht-host-pin').inputValue();
    expect(invitation.directKey).toBe('');
    expect(invitation.relayUrl).toMatch(new RegExp(`^ws://${relayHost.replace(/\./g, '\\.')}/v1/[0-9a-f]{64}$`));
    // Nothing but the relay runs for this session: the helper of this device was never started.
    const helper = await page.evaluate(() => (window as unknown as { sketchdraw: { helper: { status(): Promise<{ running: boolean; announced: boolean }> } } }).sketchdraw.helper.status());
    expect(helper).toMatchObject({ running: false, announced: false });
    expect(relay.stats()).toMatchObject({ connections: 1, topics: 1 });

    for (let index = 0; index < 2; index++) {
      const transport = createHdhtGuestTransport({ invitation, pin, relayFactory: (url, protocols) => new WebSocket(url, protocols) as never });
      guests.push({ close: () => transport.close() });
      const remote = await bootstrapRoomDocument(transport, { documentId: invitation.documentId, timeoutMs: 20_000 });
      guests.push({ close: async () => remote.destroy() });
      expect(transport.getStatus()).toMatchObject({ state: 'ready', route: 'relay', grantedRole: 'viewer' });
      const elements = remote.getSnapshot().document.elements;
      expect(elements.map(element => element.kind)).toEqual(['rectangle']);
    }
    await expect(panel.getByTestId('hdht-status')).toHaveText('Verbunden · 2 Personen');
    expect(relay.stats()).toMatchObject({ connections: 3, topics: 1 });

    await panel.getByTestId('hdht-stop').click();
    await expect(panel.getByTestId('hdht-start')).toBeVisible();
    await expect.poll(() => relay.stats().connections).toBe(0);
    expect(errors).toEqual([]);
    expect(blocked).toEqual([]);
  } finally {
    for (const guest of guests.reverse()) await guest.close().catch(() => undefined);
    if (app) await stopElectron(app);
    await relay.close();
    // Windows releases the session files a moment after the app has stopped.
    await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
  }
});
