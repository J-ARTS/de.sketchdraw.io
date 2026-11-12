import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron } from '@playwright/test';
import type { PairingReview, PairingText, CollaborationStatus } from '../../src/collaboration';
import type { DocumentSession } from '../../src/domain';
import type { WriteOutcome } from '../../src/session';
interface Harness {
  init(): Promise<void>; offer(): Promise<PairingText>;
  accept(text: string): Promise<{ answer: PairingText; review: PairingReview }>; answer(text: string): Promise<PairingReview>;
  confirmOwner(code: string): Promise<void>; confirmGuest(id: string, code: string): Promise<void>;
  status(): CollaborationStatus; snapshot(): DocumentSession; rename(title: string): Promise<WriteOutcome>;
  close(): Promise<void>; diagnostics(): Promise<unknown>;
}
declare global { interface Window { p2p: Harness } }

test('two native Chromium contexts exchange confirmed edits with no configured ICE services', async ({ browser }, testInfo) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map(context => context.newPage())); const [owner, guest] = pages;
  const externalRequests: string[] = [];
  for (const page of pages) page.on('request', request => { const url = new URL(request.url()); if (url.origin !== 'http://127.0.0.1:5184') externalRequests.push(url.origin); });
  try {
    for (const page of pages) { await page.goto('/tests/p2p/fixture.html'); await page.waitForFunction(() => !!window.p2p); }
    await owner!.evaluate(() => window.p2p.init());
    const invitation = await owner!.evaluate(() => window.p2p.offer());
    const pairing = await guest!.evaluate(text => window.p2p.accept(text), invitation.text);
    const review = await owner!.evaluate(text => window.p2p.answer(text), pairing.answer.text);
    expect(review.comparisonCode).toBe(pairing.review.comparisonCode);
    await Promise.all([owner!.evaluate(({id, code}) => window.p2p.confirmGuest(id, code), {id: invitation.invitationId, code: review.comparisonCode}),
      guest!.evaluate(code => window.p2p.confirmOwner(code), review.comparisonCode)]);
    await guest!.waitForFunction(() => window.p2p.status()?.state === 'ready');
    expect(await guest!.evaluate(() => window.p2p.rename('Native guest edit'))).toMatchObject({ status: 'committed', revision: 1 });
    await owner!.waitForFunction(() => window.p2p.snapshot().revision === 1);
    expect(await owner!.evaluate(() => window.p2p.rename('Native owner edit'))).toMatchObject({ status: 'committed', revision: 2 });
    await guest!.waitForFunction(() => window.p2p.snapshot().revision === 2);
    expect(await guest!.evaluate(() => window.p2p.snapshot())).toEqual(await owner!.evaluate(() => window.p2p.snapshot()));
    expect(externalRequests).toEqual([]);
  } finally {
    for (const [index, page] of pages.entries()) {
      const diagnosticPath = testInfo.outputPath(`native-peer-${index}.json`);
      await writeFile(diagnosticPath, JSON.stringify(await page.evaluate(() => window.p2p?.diagnostics()).catch(error => ({ error: String(error) })), null, 2));
      await testInfo.attach(`native-peer-${index}-diagnostics`, { contentType: 'application/json', path: diagnosticPath });
      await page.evaluate(() => window.p2p?.close()).catch(() => undefined);
    }
    for (const context of contexts) await context.close();
  }
});


test('two sandboxed Electron windows retain permission denials and exercise native WebRTC', async ({}, testInfo) => {
  const app = await _electron.launch({ chromiumSandbox: true, args: [fileURLToPath(new URL('./electron-main.cjs', import.meta.url))] });
  try {
    await expect.poll(() => app.windows().length).toBe(2);
    const isolation = await app.evaluate(({ app, BrowserWindow }) => ({
      noSandbox: app.commandLine.hasSwitch('no-sandbox'),
      windows: BrowserWindow.getAllWindows().map(window => {
        // Electron exposes this runtime inspection method but omits it from its public typings.
        const contents = window.webContents as unknown as {
          getLastWebPreferences(): { sandbox?: boolean; contextIsolation?: boolean; nodeIntegration?: boolean };
        };
        const preferences = contents.getLastWebPreferences();
        return { sandbox: preferences.sandbox, contextIsolation: preferences.contextIsolation, nodeIntegration: preferences.nodeIntegration };
      }),
    }));
    expect(isolation).toEqual({ noSandbox: false, windows: [
      { sandbox: true, contextIsolation: true, nodeIntegration: false },
      { sandbox: true, contextIsolation: true, nodeIntegration: false },
    ] });
    const [owner, guest] = app.windows();
    for (const page of [owner!, guest!]) await page.waitForFunction(() => !!window.p2p);
    await owner!.evaluate(() => window.p2p.init()); const invitation = await owner!.evaluate(() => window.p2p.offer());
    const pairing = await guest!.evaluate(text => window.p2p.accept(text), invitation.text);
    const review = await owner!.evaluate(text => window.p2p.answer(text), pairing.answer.text);
    expect(review.comparisonCode).toBe(pairing.review.comparisonCode);
    await Promise.all([owner!.evaluate(({id, code}) => window.p2p.confirmGuest(id, code), {id: invitation.invitationId, code: review.comparisonCode}),
      guest!.evaluate(code => window.p2p.confirmOwner(code), review.comparisonCode)]);
    await guest!.waitForFunction(() => window.p2p.status()?.state === 'ready');
    expect(await guest!.evaluate(() => window.p2p.rename('Electron guest edit'))).toMatchObject({ status: 'committed', revision: 1 });
    await owner!.waitForFunction(() => window.p2p.snapshot().revision === 1);
  } finally {
    for (const [index,page] of app.windows().entries()) {
      const path = testInfo.outputPath(`electron-peer-${index}.json`);
      await writeFile(path, JSON.stringify(await page.evaluate(() => window.p2p?.diagnostics()).catch(error=>({error:String(error)})),null,2));
      await testInfo.attach(`electron-peer-${index}`,{path,contentType:'application/json'});
    }
    const permissions = await app.evaluate(() => (globalThis as unknown as { permissionEvents: unknown[] }).permissionEvents);
    const path = testInfo.outputPath('electron-permission-events.json'); await writeFile(path,JSON.stringify(permissions,null,2));
    await testInfo.attach('electron-permission-events',{path,contentType:'application/json'});
    await app.close();
  }
});
