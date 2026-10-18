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

test('two complete app pages pair through the UI, share canvas edits, and retain an independent local copy on leave', async ({ browser }, testInfo) => {
  test.setTimeout(100000);
  const contexts = await Promise.all([browser.newContext({ viewport: { width: 1280, height: 900 } }), browser.newContext({ viewport: { width: 1280, height: 900 } })]);
  const [owner, guest] = await Promise.all(contexts.map(context => context.newPage()));
  const errors: string[] = []; const externalRequests: string[] = [];
  for (const page of [owner!, guest!]) {
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { const url = new URL(request.url()); if (url.origin !== 'http://127.0.0.1:5184') externalRequests.push(url.origin); });
  }
  const draw = async (page: typeof owner, tool: string, y: number) => {
    await page!.getByRole('button', { name: tool, exact: true }).click();
    await page!.mouse.move(380, y); await page!.mouse.down();
    await page!.mouse.move(540, y + 100, { steps: 8 }); await page!.mouse.up();
  };
  let failed = false, stage = 'open both application pages';
  try {
    for (const page of [owner!, guest!]) { await page.goto('/'); await expect(page.getByTestId('whiteboard-canvas')).toBeVisible(); }
    stage = 'draw the owner rectangle';
    await draw(owner, 'Rechteck', 220);
    await expect(owner!.locator('[data-kind=rectangle]')).toHaveCount(1);
    stage = 'open collaboration panels';
    for (const page of [owner!, guest!]) { await page.getByTestId('workspace-menu-button').click(); await page.getByRole('menuitemcheckbox', { name: 'Zusammenarbeiten', exact: true }).click(); }
    const ownerPanel = owner!.getByTestId('collaboration-panel'); const guestPanel = guest!.getByTestId('collaboration-panel');
    stage = 'start an editor session and obtain its share link';
    await ownerPanel.getByRole('combobox', { name: /Zugriff/ }).selectOption('editor');
    await ownerPanel.getByTestId('session-start').click();
    const sessionLink = ownerPanel.getByTestId('session-link');
    await expect(sessionLink).toHaveValue(/^https?:\/\/.+#sketchdraw-session=.{80,}/, { timeout: 25000 });
    stage = 'join the session through the current product UI';
    await guestPanel.getByRole('textbox', { name: 'Session-Link einfügen' }).fill(await sessionLink.inputValue());
    await guestPanel.getByRole('button', { name: 'Session beitreten', exact: true }).click();
    await expect(guestPanel.getByText(/^Verbunden ·/)).toBeVisible({ timeout: 40000 });
    await expect(ownerPanel.getByText(/^Verbunden ·/)).toBeVisible({ timeout: 40000 });
    stage = 'bootstrap the owner document on the guest';
    await expect(guest!.locator('[data-kind=rectangle]')).toHaveCount(1);
    await guestPanel.getByRole('button', { name: 'Zusammenarbeit schließen' }).click();
    stage = 'replicate a guest edit to the owner';
    await draw(guest, 'Ellipse', 450);
    const confirmedEllipse = '[data-render-state=document][data-kind=ellipse]';
    await expect(owner!.locator(confirmedEllipse)).toHaveCount(1);
    await expect(guest!.locator(confirmedEllipse)).toHaveCount(1);
    expect(await guest!.locator(confirmedEllipse).getAttribute('data-element-id'))
      .toBe(await owner!.locator(confirmedEllipse).getAttribute('data-element-id'));
    stage = 'leave the automatic session and retain the local document';
    await guest!.getByTestId('workspace-menu-button').click(); await guest!.getByRole('menuitemcheckbox', { name: 'Zusammenarbeiten', exact: true }).click();
    await guestPanel.getByTestId('session-stop').click();
    await expect(guestPanel.getByTestId('session-start')).toBeEnabled();
    await expect(guest!.locator('[data-kind=ellipse]')).toHaveCount(1);
    await expect(ownerPanel.getByText('Wartet auf Teilnehmende', { exact: true })).toBeVisible({ timeout: 15000 });
    await guestPanel.getByRole('button', { name: 'Zusammenarbeit schließen' }).click();
    stage = 'confirm the retained guest copy is independent';
    await draw(guest, 'Rechteck', 620);
    await expect(guest!.locator('[data-kind=rectangle]')).toHaveCount(2);
    await expect(owner!.locator('[data-kind=rectangle]')).toHaveCount(1);
    expect(errors).toEqual([]); expect(externalRequests).toEqual([]);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (failed) {
      const path = testInfo.outputPath('product-ui-observations.json');
      const ui = await Promise.all([owner!, guest!].map(async page => {
        if (page.isClosed()) return { closed: true };
        return {
          closed: false,
          url: page.url(),
          elements: await page.locator('[data-render-state]').evaluateAll(elements => elements.map(element => ({
            state: element.getAttribute('data-render-state'), kind: element.getAttribute('data-kind'), id: element.getAttribute('data-element-id'),
          }))).catch(error => [{ diagnosticError: String(error) }]),
          pendingNotice: await page.locator('.property-draft').allTextContents().catch(error => [String(error)]),
          gestureConflict: await page.locator('.gesture-conflict').allTextContents().catch(error => [String(error)]),
          notices: await page.locator('.notices').allTextContents().catch(error => [String(error)]),
          connection: await page.locator('.connection-state').allTextContents().catch(error => [String(error)]),
        };
      }));
      await writeFile(path, JSON.stringify({ stage, errors, externalRequests, ui }, null, 2));
      await testInfo.attach('product-ui-observations', { path, contentType: 'application/json' });
    }
    for (const context of contexts) await context.close();
  }
});
