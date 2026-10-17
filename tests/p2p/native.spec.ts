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
  for (const page of pages) page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:5184/')) externalRequests.push(new URL(request.url()).origin); });
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
    page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:5184/')) externalRequests.push(new URL(request.url()).origin); });
  }
  const draw = async (page: typeof owner, tool: string, y: number) => {
    await page!.getByRole('button', { name: tool, exact: true }).click();
    await page!.mouse.move(380, y); await page!.mouse.down();
    await page!.mouse.move(540, y + 100, { steps: 8 }); await page!.mouse.up();
  };
  try {
    for (const page of [owner!, guest!]) { await page.goto('/'); await expect(page.getByTestId('whiteboard-canvas')).toBeVisible(); }
    await draw(owner, 'Rechteck', 220);
    await expect(owner!.locator('[data-kind=rectangle]')).toHaveCount(1);
    for (const page of [owner!, guest!]) await page.getByRole('button', { name: 'Zusammenarbeiten', exact: true }).click();
    const ownerPanel = owner!.getByTestId('collaboration-panel'); const guestPanel = guest!.getByTestId('collaboration-panel');
    await ownerPanel.getByRole('combobox', { name: 'Zugriff' }).selectOption('editor');
    await ownerPanel.getByRole('button', { name: 'Einladung erstellen', exact: true }).click();
    const invitation = ownerPanel.getByRole('textbox', { name: 'Einladung zum Kopieren' });
    await expect(invitation).not.toHaveValue('', { timeout: 25000 });
    await guestPanel.getByRole('button', { name: 'Beitreten', exact: true }).click();
    await guestPanel.getByRole('textbox', { name: 'Einladung einfügen' }).fill(await invitation.inputValue());
    await guestPanel.getByRole('button', { name: 'Einladung prüfen', exact: true }).click();
    const answer = guestPanel.getByRole('textbox', { name: 'Antwort zum Kopieren' });
    await expect(answer).not.toHaveValue('', { timeout: 25000 });
    await ownerPanel.getByRole('textbox', { name: 'Antwort einfügen' }).fill(await answer.inputValue());
    await ownerPanel.getByRole('button', { name: 'Antwort prüfen', exact: true }).click();
    const ownerCode = ownerPanel.getByLabel('Vergleichscode'); const guestCode = guestPanel.getByLabel('Vergleichscode');
    await expect(ownerCode).toHaveText(/^(?:[a-f0-9]{4}-){7}[a-f0-9]{4}$/);
    await expect(guestCode).toHaveText((await ownerCode.textContent())!);
    // A reviewed packet alone must not release the owner's drawing.
    await expect(guest!.locator('[data-element-id]')).toHaveCount(0);
    for (const panel of [ownerPanel, guestPanel]) await panel.getByRole('checkbox').check();
    await ownerPanel.getByRole('button', { name: 'Identität bestätigen', exact: true }).click();
    await guestPanel.getByRole('button', { name: 'Identität bestätigen', exact: true }).click();
    await expect(guestPanel.getByText(/^Verbunden ·/)).toBeVisible({ timeout: 40000 });
    await expect(ownerPanel.getByText(/^Verbunden ·/)).toBeVisible({ timeout: 40000 });
    await expect(guest!.locator('[data-kind=rectangle]')).toHaveCount(1);
    await guestPanel.getByRole('button', { name: 'Zusammenarbeit schließen' }).click();
    await draw(guest, 'Ellipse', 450);
    const confirmedEllipse = '[data-render-state=document][data-kind=ellipse]';
    await expect(owner!.locator(confirmedEllipse)).toHaveCount(1);
    await expect(guest!.locator(confirmedEllipse)).toHaveCount(1);
    // A reply can precede mirror installation. Clear that exact retained draft
    // only through the product's outcome query after the confirmed mirror exists.
    await expect.poll(async () => {
      const query = guest!.getByRole('button', { name: 'Ausgang prüfen', exact: true });
      if (await query.isVisible()) await query.click();
      return await guest!.locator('[data-render-state=draft]').count() === 0 && !await query.isVisible();
    }).toBe(true);
    expect(await guest!.locator(confirmedEllipse).getAttribute('data-element-id'))
      .toBe(await owner!.locator(confirmedEllipse).getAttribute('data-element-id'));
    await guest!.getByRole('button', { name: 'Zusammenarbeiten', exact: true }).click();
    await guestPanel.getByRole('button', { name: 'Sitzung verlassen und Kopie behalten' }).click();
    await expect(guest!.getByRole('dialog')).toBeVisible();
    await guest!.getByRole('dialog').getByRole('button', { name: 'Verwerfen', exact: true }).click();
    await expect(guest!.getByRole('dialog')).not.toBeVisible();
    await expect(guest!.locator('[data-kind=ellipse]')).toHaveCount(1);
    await expect(ownerPanel.getByRole('list', { name: 'Verbundene Personen' }).getByText('Verbindung unterbrochen')).toBeVisible();
    await guestPanel.getByRole('button', { name: 'Zusammenarbeit schließen' }).click();
    await draw(guest, 'Rechteck', 620);
    await expect(guest!.locator('[data-kind=rectangle]')).toHaveCount(2);
    await expect(owner!.locator('[data-kind=rectangle]')).toHaveCount(1);
    expect(errors).toEqual([]); expect(externalRequests).toEqual([]);
  } finally {
    const path = testInfo.outputPath('product-ui-observations.json');
    await writeFile(path, JSON.stringify({ errors, externalRequests }, null, 2));
    await testInfo.attach('product-ui-observations', { path, contentType: 'application/json' });
    for (const context of contexts) await context.close();
  }
});
