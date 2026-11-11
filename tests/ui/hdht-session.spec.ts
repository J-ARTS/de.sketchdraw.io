import { expect, test, type Page } from '@playwright/test';
import { createDocument, createElement, serializeDocument, validateDocument } from '../../src/domain';
// @ts-expect-error plain ESM relay without declarations
import { createRelayServer } from '../../relay/server.mjs';

let relay: ReturnType<typeof createRelayServer>;
let relayUrl = '';
test.beforeAll(async () => {
  relay = createRelayServer();
  const address = await relay.listen(0, '127.0.0.1');
  relayUrl = `ws://127.0.0.1:${address.port}/`;
});
test.afterAll(async () => { await relay.close(); });

async function openPanel(page: Page) {
  await page.getByTestId('workspace-menu-button').click();
  await page.getByRole('menuitemcheckbox', { name: 'Zusammenarbeiten', exact: true }).click();
}
async function draw(page: Page, shape: 'Rechteck' | 'Ellipse', x = 280, y = 300) {
  await page.getByRole('button', { name: shape, exact: true }).click();
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 130, y + 80, { steps: 5 }); await page.mouse.up();
}
async function allowRelayLinkIfPending(page: Page) {
  const relayShare = page.getByTestId('hdht-share-relay'), link = page.getByTestId('hdht-link');
  await expect.poll(async () => await relayShare.isVisible() || await link.isVisible()).toBe(true);
  if (await relayShare.isVisible()) {
    await expect(link).toHaveCount(0);
    await expect(page.getByTestId('hdht-host-pin')).toHaveCount(0);
    await relayShare.click();
  }
}
async function hostSession(page: Page, role: 'editor' | 'viewer' = 'editor') {
  await page.goto('/'); await draw(page, 'Rechteck'); await openPanel(page);
  const panel = page.getByTestId('hdht-session');
  await panel.getByRole('combobox', { name: 'Zugriff für Eingeladene' }).selectOption(role);
  await panel.getByTestId('hdht-network').locator('summary').click();
  await panel.getByRole('textbox', { name: 'Optionales WSS-Gateway', exact: true }).fill(relayUrl);
  await panel.getByRole('textbox', { name: 'Adresse der Web-App für PIN-Links' }).fill('http://127.0.0.1:5173/');
  await panel.getByTestId('hdht-start').click();
  await allowRelayLinkIfPending(page);
  const link = panel.getByTestId('hdht-link');
  await expect(link).toHaveValue(/^http:\/\/127\.0\.0\.1:5173\/#sketchdraw-hdht=.+/);
  return { link: await link.inputValue(), pin: await panel.getByTestId('hdht-host-pin').inputValue() };
}

/** Native MCP IPC is faked; renderer registration/disposal, role guards and network transport are real. */
async function agentFixture(page: Page) {
  await page.addInitScript(() => {
    const state = { registered: 0, unregistered: 0, active: false, requestListeners: 0 };
    let control: ((message: unknown) => unknown) | undefined;
    Object.defineProperty(window, '__hdhtAgent', { value: state });
    Object.defineProperty(window, 'sketchdrawAgentAccess', { value: {
      isAvailable: true,
      async registerSession(session: Record<string, unknown>) {
        state.registered++; state.active = true;
        const descriptor = { ...session, webContentsGeneration: 1 };
        await control?.({ type: 'sync-session', controlId: `sync-${state.registered}`, ...descriptor });
        return descriptor;
      },
      async unregisterSession() { state.unregistered++; state.active = false; },
      onControl(listener: (message: unknown) => unknown) { control = listener; return () => { if (control === listener) control = undefined; }; },
      onRequest() { state.requestListeners++; return () => { state.requestListeners--; }; },
    } });
  });
}
const agentState = (page: Page) => page.evaluate(() => (window as unknown as { __hdhtAgent: { registered: number; unregistered: number; active: boolean; requestListeners: number } }).__hdhtAgent);

test('URL and separate PIN connect real browser clients; wrong PIN recovers, editor syncs, guest has no MCP', async ({ page, browser }) => {
  const invitation = await hostSession(page);
  expect(invitation.pin).toMatch(/^\d{6}$/); expect(invitation.link).not.toContain(invitation.pin);
  const context = await browser.newContext(); const guest = await context.newPage();
  try {
    await agentFixture(guest); await guest.goto(invitation.link);
    await expect(guest.getByTestId('collaboration-panel')).toBeVisible();
    expect(await guest.evaluate(() => window.location.hash)).toBe('');
    await expect(guest.getByTestId('hdht-join')).toBeVisible();
    const input = guest.getByRole('textbox', { name: 'Sechsstellige PIN' });
    await input.fill(invitation.pin === '000000' ? '000001' : '000000'); await guest.getByTestId('hdht-join').click();
    await expect(guest.getByTestId('hdht-session').getByRole('alert')).toContainText('PIN stimmt nicht');
    await input.fill(invitation.pin); await guest.getByTestId('hdht-join').click();
    await expect(guest.getByTestId('hdht-status')).toHaveText('Verbunden');
    await expect(guest.locator('.whiteboard-canvas [data-kind=rectangle]')).toHaveCount(1);
    await expect.poll(() => agentState(guest)).toEqual({ registered: 1, unregistered: 1, active: false, requestListeners: 0 });
    await draw(guest, 'Ellipse', 280, 450);
    await expect(page.locator('.whiteboard-canvas [data-kind=ellipse]')).toHaveCount(1);
    // Closing the sidebar only hides controls; it must not unmount and end the session.
    await guest.getByRole('button', { name: 'Zusammenarbeit schließen' }).click();
    await draw(page, 'Rechteck', 500, 450);
    await expect(guest.locator('.whiteboard-canvas [data-kind=rectangle]')).toHaveCount(2);
  } finally { await context.close(); }
});

test('viewer stays read-only without MCP after host ends, until explicit local-copy leave', async ({ page, browser }) => {
  const invitation = await hostSession(page, 'viewer');
  const context = await browser.newContext(); const guest = await context.newPage();
  try {
    await agentFixture(guest); await guest.goto(invitation.link);
    await guest.getByRole('textbox', { name: 'Sechsstellige PIN' }).fill(invitation.pin); await guest.getByTestId('hdht-join').click();
    await expect(guest.getByTestId('hdht-status')).toHaveText('Verbunden');
    await expect(guest.getByRole('button', { name: 'Rechteck', exact: true })).toBeDisabled();
    await page.getByTestId('hdht-stop').click();
    await expect(guest.getByTestId('hdht-session').getByRole('alert')).toContainText('Gastgeber hat deine Verbindung beendet');
    await expect(guest.getByRole('button', { name: 'Rechteck', exact: true })).toBeDisabled();
    expect((await agentState(guest)).active).toBe(false);
    await guest.getByTestId('hdht-stop').click();
    await expect.poll(() => agentState(guest)).toEqual({ registered: 2, unregistered: 1, active: true, requestListeners: 1 });
    await draw(guest, 'Ellipse', 280, 450);
    await expect(guest.locator('.whiteboard-canvas [data-kind=ellipse]')).toHaveCount(1);
  } finally { await context.close(); }
});

test('unsaved adoption can be cancelled without losing local work or local MCP', async ({ page, browser }) => {
  const invitation = await hostSession(page);
  const context = await browser.newContext(); const guest = await context.newPage();
  try {
    await agentFixture(guest); await guest.goto('/'); await draw(guest, 'Ellipse'); await openPanel(guest);
    await guest.getByRole('textbox', { name: 'Link für PIN-Beitritt' }).fill(invitation.link);
    await guest.getByRole('textbox', { name: 'Sechsstellige PIN' }).fill(invitation.pin); await guest.getByTestId('hdht-join').click();
    await guest.getByRole('button', { name: 'Abbrechen', exact: true }).click();
    await expect(guest.getByTestId('hdht-join')).toBeVisible();
    await expect(guest.locator('.whiteboard-canvas [data-kind=ellipse]')).toHaveCount(1);
    expect(await agentState(guest)).toEqual({ registered: 1, unregistered: 0, active: true, requestListeners: 1 });
    await guest.getByRole('textbox', { name: 'Sechsstellige PIN' }).fill(invitation.pin); await guest.getByTestId('hdht-join').click();
    await guest.getByRole('button', { name: 'Verwerfen', exact: true }).click();
    await expect(guest.getByTestId('hdht-status')).toHaveText('Verbunden');
    await expect(guest.locator('.whiteboard-canvas [data-kind=ellipse]')).toHaveCount(0);
    expect((await agentState(guest)).active).toBe(false);
  } finally { await context.close(); }
});

test('native startup may remain pending while WSS connects; helper is opt-in and survives document changes', async ({ page, browser }) => {
  await page.addInitScript(() => {
    const state = { starts: 0, stops: 0, running: false };
    const status = () => ({ running: state.running, announced: state.running, connections: 0, sessions: 0, guests: 0, forwardedRecords: 0 });
    Object.defineProperty(window, '__helperFixture', { value: state });
    Object.defineProperty(window, 'sketchdraw', { value: {
      platform: 'electron', openDocument: async () => ({ status: 'cancelled' }), saveDocument: async () => ({ status: 'cancelled' }), exportFile: async () => ({ status: 'cancelled' }), openExternal: async () => {}, onCloseRequested: () => () => {}, respondToClose: async () => {}, onMenuCommand: () => () => {},
      helper: { start: async () => { state.starts++; state.running = true; return status(); }, stop: async () => { state.stops++; state.running = false; }, status: async () => status() },
      direct: { hostStart: () => new Promise(() => {}), hostStop: async () => {}, connect: async () => {}, close: async () => {}, send: async () => {}, discover: async () => [], onEvent: () => () => {} },
    } });
  });
  const invitation = await hostSession(page);
  const helperToggle = page.getByTestId('hdht-helper'); await expect(helperToggle).not.toBeChecked();
  expect(await page.evaluate(() => (window as unknown as { __helperFixture: { starts: number } }).__helperFixture.starts)).toBe(0);
  const context = await browser.newContext(); const guest = await context.newPage();
  try {
    await guest.goto(invitation.link); await guest.getByRole('textbox', { name: 'Sechsstellige PIN' }).fill(invitation.pin); await guest.getByTestId('hdht-join').click();
    await expect(guest.getByTestId('hdht-status')).toHaveText('Verbunden');
    await helperToggle.check(); await expect(helperToggle).toBeChecked();
    await page.getByRole('button', { name: 'Zusammenarbeit schließen' }).click();
    expect(await page.evaluate(() => (window as unknown as { __helperFixture: { stops: number } }).__helperFixture.stops)).toBe(0);
    await openPanel(page); await expect(helperToggle).toBeChecked();
    await page.getByTestId('file-menu-button').click(); await page.getByTestId('file-menu-new').click(); await page.getByRole('button', { name: 'Verwerfen', exact: true }).click();
    await expect(page.getByTestId('hdht-start')).toBeVisible();
    await expect(helperToggle).toBeChecked();
    expect(await page.evaluate(() => (window as unknown as { __helperFixture: { stops: number } }).__helperFixture.stops)).toBe(0);
    await page.getByTestId('hdht-start').click(); await allowRelayLinkIfPending(page); await expect(page.getByTestId('hdht-link')).toBeVisible();
    await page.getByTestId('hdht-stop').click(); await expect(helperToggle).toBeChecked();
    expect(await page.evaluate(() => (window as unknown as { __helperFixture: { stops: number } }).__helperFixture.stops)).toBe(0);
    await helperToggle.uncheck();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __helperFixture: { stops: number } }).__helperFixture.stops)).toBe(1);
  } finally { await context.close(); }
});

test('document change invalidates a host start while WebCrypto is pending', async ({ page }) => {
  await page.addInitScript(() => {
    const generateKey = crypto.subtle.generateKey.bind(crypto.subtle);
    let release = () => {}, finish = () => {};
    const state = { pending: false, finished: new Promise<void>(resolve => { finish = resolve; }), release: () => release() };
    Object.defineProperty(window, '__keyFixture', { value: state });
    crypto.subtle.generateKey = (async (algorithm: AlgorithmIdentifier, extractable: boolean, usages: KeyUsage[]) => {
      if (!state.pending && typeof algorithm === 'object' && algorithm.name === 'Ed25519') {
        state.pending = true;
        await new Promise<void>(resolve => { release = resolve; });
        const result = await generateKey(algorithm, extractable, usages);
        finish(); return result;
      }
      return generateKey(algorithm, extractable, usages);
    }) as typeof crypto.subtle.generateKey;
  });
  await page.goto('/'); await draw(page, 'Rechteck'); await openPanel(page);
  await page.getByTestId('hdht-network').locator('summary').click();
  await page.getByRole('textbox', { name: 'Optionales WSS-Gateway', exact: true }).fill(relayUrl);
  await page.getByRole('textbox', { name: 'Adresse der Web-App für PIN-Links' }).fill('http://127.0.0.1:5173/');
  await page.getByTestId('hdht-start').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __keyFixture: { pending: boolean } }).__keyFixture.pending)).toBe(true);
  await page.getByTestId('file-menu-button').click(); await page.getByTestId('file-menu-new').click();
  await page.getByRole('button', { name: 'Verwerfen', exact: true }).click();
  await expect(page.getByTestId('hdht-start')).toBeEnabled();
  await page.evaluate(async () => {
    const fixture = (window as unknown as { __keyFixture: { release: () => void; finished: Promise<void> } }).__keyFixture;
    fixture.release(); await fixture.finished;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  });
  await expect(page.getByTestId('hdht-start')).toBeEnabled();
  await expect(page.getByTestId('hdht-link')).toHaveCount(0);
  await expect(page.locator('.whiteboard-canvas [data-kind=rectangle]')).toHaveCount(0);
  await page.getByTestId('hdht-start').click();
  await allowRelayLinkIfPending(page);
  await expect(page.getByTestId('hdht-link')).toBeVisible();
});

test('repeated stop waits for one cleanup before another session can start', async ({ page }) => {
  await page.addInitScript(() => {
    let release = () => {};
    const state = { stops: 0, release: () => release() };
    Object.defineProperty(window, '__stopFixture', { value: state });
    Object.defineProperty(window, 'sketchdraw', { value: {
      platform: 'electron', openDocument: async () => ({ status: 'cancelled' }), saveDocument: async () => ({ status: 'cancelled' }), exportFile: async () => ({ status: 'cancelled' }), openExternal: async () => {}, onCloseRequested: () => () => {}, respondToClose: async () => {}, onMenuCommand: () => () => {},
      direct: {
        hostStart: () => new Promise(() => {}),
        hostStop: async () => { if (++state.stops === 1) await new Promise<void>(resolve => { release = resolve; }); },
        connect: async () => {}, close: async () => {}, send: async () => {}, discover: async () => [], onEvent: () => () => {},
      },
    } });
  });
  const first = await hostSession(page);
  await page.getByTestId('hdht-stop').click();
  await expect(page.getByTestId('hdht-stop')).toBeDisabled();
  // Also exercise re-entrant callers beyond the disabled native button.
  await page.getByTestId('hdht-stop').dispatchEvent('click');
  expect(await page.evaluate(() => (window as unknown as { __stopFixture: { stops: number } }).__stopFixture.stops)).toBe(1);
  await expect(page.getByTestId('hdht-start')).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { __stopFixture: { release: () => void } }).__stopFixture.release());
  await expect(page.getByTestId('hdht-start')).toBeEnabled();
  await page.getByTestId('hdht-start').click();
  await allowRelayLinkIfPending(page);
  await expect(page.getByTestId('hdht-link')).toBeVisible();
  await expect(page.getByTestId('hdht-link')).not.toHaveValue(first.link);
  await expect(page.getByTestId('hdht-stop')).toBeEnabled();
});

test('session end flushes before native sockets stop so guests receive the terminal reason', async ({ page, browser }) => {
  await page.addInitScript(() => {
    let release = () => {};
    const state = { stops: 0, armed: false, encrypting: false, release: () => release() };
    Object.defineProperty(window, '__flushFixture', { value: state });
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    crypto.subtle.encrypt = async (algorithm, key, data) => {
      if (state.armed) {
        state.armed = false; state.encrypting = true;
        await new Promise<void>(resolve => { release = resolve; });
      }
      return encrypt(algorithm, key, data);
    };
    Object.defineProperty(window, 'sketchdraw', { value: {
      platform: 'electron', openDocument: async () => ({ status: 'cancelled' }), saveDocument: async () => ({ status: 'cancelled' }), exportFile: async () => ({ status: 'cancelled' }), openExternal: async () => {}, onCloseRequested: () => () => {}, respondToClose: async () => {}, onMenuCommand: () => () => {},
      direct: {
        hostStart: () => new Promise(() => {}), hostStop: async () => { state.stops++; },
        connect: async () => {}, close: async () => {}, send: async () => {}, discover: async () => [], onEvent: () => () => {},
      },
    } });
  });
  const invitation = await hostSession(page);
  const context = await browser.newContext(); const guest = await context.newPage();
  try {
    await guest.goto(invitation.link);
    await guest.getByRole('textbox', { name: 'Sechsstellige PIN' }).fill(invitation.pin); await guest.getByTestId('hdht-join').click();
    await expect(guest.getByTestId('hdht-status')).toHaveText('Verbunden');
    await page.evaluate(() => { (window as unknown as { __flushFixture: { armed: boolean } }).__flushFixture.armed = true; });
    await page.getByTestId('hdht-stop').click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __flushFixture: { encrypting: boolean } }).__flushFixture.encrypting)).toBe(true);
    expect(await page.evaluate(() => (window as unknown as { __flushFixture: { stops: number } }).__flushFixture.stops)).toBe(0);
    await page.evaluate(() => (window as unknown as { __flushFixture: { release: () => void } }).__flushFixture.release());
    await expect(guest.getByTestId('hdht-session').getByRole('alert')).toContainText('Gastgeber hat deine Verbindung beendet');
    await expect(page.getByTestId('hdht-start')).toBeEnabled();
    expect(await page.evaluate(() => (window as unknown as { __flushFixture: { stops: number } }).__flushFixture.stops)).toBe(1);
  } finally { await context.close(); }
});

test('a valid diagram above 4 MiB synchronizes fully and remains editable', async ({ page, browser }) => {
  test.setTimeout(60_000);
  const document = createDocument('Large local diagram');
  document.elements = Array.from({ length: 100 }, (_, i) => createElement('text', { id: `large:${i}`, text: 'Architecture diagrams and notes. '.repeat(1500).slice(0, 45_000), x: i * 200, y: 100, width: 180, height: 80 }));
  validateDocument(document);
  await page.addInitScript(text => {
    const state = { starts: 0 };
    Object.defineProperty(window, '__largeFixture', { value: state });
    Object.defineProperty(window, 'sketchdraw', { value: {
      platform: 'electron',
      openDocument: async () => ({ status: 'opened', text, file: { handleId: 'large-test', name: 'large.sketchdraw.json', versionToken: 'v1' } }),
      saveDocument: async () => ({ status: 'cancelled' }), exportFile: async () => ({ status: 'cancelled' }), openExternal: async () => {}, onCloseRequested: () => () => {}, respondToClose: async () => {}, onMenuCommand: () => () => {},
      direct: {
        hostStart: () => { state.starts++; return new Promise(() => {}); }, hostStop: async () => {},
        connect: async () => {}, close: async () => {}, send: async () => {}, discover: async () => [], onEvent: () => () => {},
      },
    } });
  }, serializeDocument(document));
  await page.goto('/'); await page.getByTestId('file-menu-button').click(); await page.getByTestId('file-menu-open').click();
  await expect(page.getByTestId('document-title')).toHaveValue('Large local diagram');
  await openPanel(page);
  await page.getByRole('combobox', { name: 'Zugriff für Eingeladene' }).selectOption('editor');
  await page.getByTestId('hdht-network').locator('summary').click();
  await page.getByRole('textbox', { name: 'Optionales WSS-Gateway', exact: true }).fill(relayUrl);
  await page.getByRole('textbox', { name: 'Adresse der Web-App für PIN-Links' }).fill('http://127.0.0.1:5173/');
  await page.getByTestId('hdht-start').click(); await allowRelayLinkIfPending(page);
  const link = await page.getByTestId('hdht-link').inputValue(), pin = await page.getByTestId('hdht-host-pin').inputValue();
  const context = await browser.newContext(); const guest = await context.newPage();
  try {
    await guest.goto(link); await guest.getByRole('textbox', { name: 'Sechsstellige PIN' }).fill(pin); await guest.getByTestId('hdht-join').click();
    await expect(guest.getByTestId('hdht-status')).toHaveText('Verbunden', { timeout: 20_000 });
    await expect(guest.getByTestId('document-title')).toHaveValue('Large local diagram');
    await expect(guest.locator('.whiteboard-canvas [data-kind=text]')).toHaveCount(100);
    await draw(guest, 'Ellipse', 280, 450);
    await expect(page.locator('.whiteboard-canvas [data-kind=ellipse]')).toHaveCount(1);
    await expect(guest.getByTestId('hdht-session').getByRole('alert')).toHaveCount(0);
  } finally { await context.close(); }
});

for (const failingSide of ['host', 'guest'] as const) test(`a transient ${failingSide} socket send failure reconnects and converges without losing guest guards`, async ({ page, browser }) => {
  const context = await browser.newContext(); const guest = await context.newPage();
  const failingPage = failingSide === 'host' ? page : guest;
  await failingPage.addInitScript(() => {
    const state = { armed: false, failures: 0 };
    Object.defineProperty(window, '__sendFailure', { value: state });
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function(data) {
      if (state.armed) { state.armed = false; state.failures++; throw new Error('CONTROLLED_SEND_FAILURE'); }
      send.call(this, data);
    };
  });
  try {
    await agentFixture(guest);
    const invitation = await hostSession(page);
    await guest.goto(invitation.link);
    await guest.getByRole('textbox', { name: 'Sechsstellige PIN' }).fill(invitation.pin); await guest.getByTestId('hdht-join').click();
    await expect(guest.getByTestId('hdht-status')).toHaveText('Verbunden');
    await guest.evaluate(() => {
      const state = { interrupted: false, writableWhileDisconnected: false };
      Object.defineProperty(window, '__recoveryFixture', { value: state });
      new MutationObserver(() => {
        const status = document.querySelector('[data-testid="hdht-status"]')?.textContent ?? '';
        if (/unterbrochen|Gegenstelle wird gesucht|PIN wird geprüft/.test(status)) {
          state.interrupted = true;
          if (!document.querySelector<HTMLButtonElement>('button[data-tool="rectangle"]')?.disabled) state.writableWhileDisconnected = true;
        }
      }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled'] });
    });
    await failingPage.evaluate(() => { (window as unknown as { __sendFailure: { armed: boolean } }).__sendFailure.armed = true; });
    await draw(failingPage, 'Ellipse', 280, 450);
    await expect.poll(() => failingPage.evaluate(() => (window as unknown as { __sendFailure: { failures: number } }).__sendFailure.failures)).toBe(1);
    await expect(page.locator('.whiteboard-canvas [data-kind=ellipse]')).toHaveCount(1);
    await expect(guest.locator('.whiteboard-canvas [data-kind=ellipse]')).toHaveCount(1);
    await expect(guest.getByTestId('hdht-status')).toHaveText('Verbunden');
    await expect(page.getByTestId('hdht-status')).toContainText('Verbunden · 1 Person');
    expect(await guest.evaluate(() => (window as unknown as { __recoveryFixture: { interrupted: boolean; writableWhileDisconnected: boolean } }).__recoveryFixture)).toEqual({ interrupted: true, writableWhileDisconnected: false });
    expect(await agentState(guest)).toEqual({ registered: 1, unregistered: 1, active: false, requestListeners: 0 });
    await expect(guest.getByRole('button', { name: 'Rechteck', exact: true })).toBeEnabled();
    // Verify a fresh edit in the other direction after the lost update has converged.
    await draw(failingSide === 'host' ? guest : page, 'Rechteck', 480, 450);
    await expect(page.locator('.whiteboard-canvas [data-kind=rectangle]')).toHaveCount(2);
    await expect(guest.locator('.whiteboard-canvas [data-kind=rectangle]')).toHaveCount(2);
    await expect(page.getByTestId('hdht-session').getByRole('alert')).toHaveCount(0);
    await expect(guest.getByTestId('hdht-session').getByRole('alert')).toHaveCount(0);
  } finally { await context.close(); }
});
