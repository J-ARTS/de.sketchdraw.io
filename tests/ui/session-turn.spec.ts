import { expect, test, type Page } from '@playwright/test';
// @ts-expect-error plain ESM relay without declarations
import { createRelayServer } from '../../relay/server.mjs';

/*
 * POC(#303): the TURN route with real WebRTC. There is no TURN server here: the relay runs on this computer and hands
 * out no ICE servers, which is the one case where the route may connect directly. What this proves is the path the
 * session takes – signalling through the room, data over the WebRTC data channel, nothing of it through the relay.
 * Not proven here: Cloudflare's TURN servers and a company proxy.
 */
// Host candidates of this machine by address: headless test machines have no mDNS to resolve hidden ones.
test.use({ launchOptions: { args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--allow-loopback-in-peer-connection'] } });

const webLink = (link: string) => `/#${link.split('#')[1]}`;
async function openPanel(page: Page) {
  await page.getByTestId('workspace-menu-button').click();
  await page.getByRole('menuitemcheckbox', { name: 'Zusammenarbeiten', exact: true }).click();
}
async function draw(page: Page, shape: 'Rechteck' | 'Ellipse', x = 280, y = 300) {
  await page.getByRole('button', { name: shape, exact: true }).click();
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 130, y + 80, { steps: 5 }); await page.mouse.up();
}
async function startTurn(page: Page, address: string) {
  const panel = page.getByTestId('hdht-session');
  await panel.getByRole('combobox', { name: 'Verbindungsweg', exact: true }).click();
  await page.getByRole('option', { name: 'Cloudflare TURN', exact: true }).click();
  await panel.getByTestId('hdht-relay-address').fill(address);
  await panel.getByTestId('hdht-start').click();
  return panel;
}

test('a session over the TURN route: the room introduces two guests, the drawing travels over WebRTC data channels', async ({ page, browser }) => {
  const relay = createRelayServer({ iceServers: () => [] });
  const address = await relay.listen(0, '127.0.0.1');
  const relayHost = `127.0.0.1:${address.port}`;
  const contexts = await Promise.all([0, 1].map(() => browser.newContext()));
  try {
    await page.goto('/'); await draw(page, 'Rechteck'); await openPanel(page);
    await page.getByTestId('hdht-session').getByRole('combobox', { name: 'Zugriff für Eingeladene', exact: true }).click();
    await page.getByRole('option', { name: 'Gemeinsam bearbeiten', exact: true }).click();
    const panel = await startTurn(page, `ws://${relayHost}`);
    await expect(panel.getByTestId('hdht-route-text')).toHaveCount(0);
    const field = panel.getByTestId('hdht-link');
    await expect(field).toHaveValue(/^sketchdraw:\/\/join#sketchdraw-hdht=[A-Za-z0-9_-]+$/);
    const link = await field.inputValue(), pin = await panel.getByTestId('hdht-host-pin').inputValue();
    const invitation = JSON.parse(Buffer.from(link.split('sketchdraw-hdht=')[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
    expect(invitation).toMatchObject({ c: 'turn', d: '' });
    expect(String(invitation['r'])).toMatch(new RegExp(`^ws://${relayHost.replace(/\./g, '\\.')}/v1/[0-9a-f]{64}$`));
    await expect(panel.getByTestId('hdht-active-route')).toHaveText(`Verbindungsweg: Cloudflare TURN (vermittelt durch ${relayHost})`);

    const guests = await Promise.all(contexts.map(context => context.newPage()));
    for (const guest of guests) {
      await guest.goto(webLink(link));
      await expect(guest.getByTestId('hdht-link-relay')).toHaveText(`Dieser Link verbindet über Cloudflare TURN, vermittelt durch ${relayHost}. Beide sehen deine Netzwerkadresse, aber keinen Inhalt.`);
      await guest.getByRole('textbox', { name: 'Sechsstellige PIN' }).fill(pin); await guest.getByTestId('hdht-join').click();
      await guest.getByText('Zusammenarbeiten', { exact: true }).first().hover();
      await expect(guest.getByTestId('hdht-status')).toHaveText('Verbunden', { timeout: 20_000 });
      await expect(guest.getByTestId('hdht-session')).toContainText('Verschlüsselt über Cloudflare TURN');
      await expect(guest.locator('.whiteboard-canvas [data-kind=rectangle]')).toHaveCount(1);
    }
    await expect(panel.getByTestId('hdht-status')).toHaveText('Verbunden · 2 Personen');
    // Both guests have left the room again; only the host's registration is still at the relay.
    await expect.poll(() => relay.stats().connections).toBe(1);
    const forwarded = relay.stats().forwardedRecords;

    await draw(guests[1]!, 'Ellipse', 280, 450);
    await expect(page.locator('.whiteboard-canvas [data-kind=ellipse]')).toHaveCount(1);
    await expect(guests[0]!.locator('.whiteboard-canvas [data-kind=ellipse]')).toHaveCount(1);
    await draw(page, 'Rechteck', 500, 450);
    for (const guest of guests) await expect(guest.locator('.whiteboard-canvas [data-kind=rectangle]')).toHaveCount(2);
    // None of the drawing went through the relay.
    expect(relay.stats().forwardedRecords).toBe(forwarded);

    await page.getByTestId('hdht-stop').click();
    for (const guest of guests) await expect(guest.getByTestId('hdht-session').getByRole('alert')).toContainText('Gastgeber hat die Session beendet');
  } finally {
    await Promise.all(contexts.map(context => context.close()));
    await relay.close();
  }
});

test('a relay without a TURN key is named as the reason, and no link is handed out', async ({ page }) => {
  const relay = createRelayServer({ iceServers: () => { throw new Error('TURN_NOT_CONFIGURED'); } });
  const address = await relay.listen(0, '127.0.0.1');
  const relayHost = `127.0.0.1:${address.port}`;
  try {
    await page.goto('/'); await openPanel(page);
    await expect(page.getByTestId('hdht-route-trial')).toHaveCount(0);
    const panel = await startTurn(page, `ws://${relayHost}`);
    await expect(panel.getByTestId('hdht-relay-problem')).toHaveText(`Der Relay ${relayHost} hat keinen TURN-Schlüssel. Im Worker müssen TURN_KEY_ID und TURN_KEY_API_TOKEN gesetzt sein; die App fragt weiter nach.`);
    await expect(panel.getByTestId('hdht-link')).toHaveCount(0);
    await panel.getByTestId('hdht-stop').click();
    // Before the start the route explains itself and is marked as a trial.
    await expect(panel.getByTestId('hdht-route-text')).toContainText('Alle Geräte verbinden sich über Cloudflare TURN');
    await expect(panel.getByTestId('hdht-route-trial')).toHaveText('Testbetrieb: Von den beiden Cloudflare-Wegen bleibt nach dem Vergleich nur einer.');
    // A relay from before the TURN route (it closes the connection on the request) is told apart from an unreachable one.
    const old = createRelayServer();
    const oldAddress = await old.listen(0, '127.0.0.1');
    try {
      await startTurn(page, `ws://127.0.0.1:${oldAddress.port}`);
      await expect(panel.getByTestId('hdht-relay-problem')).toHaveText(`Der Relay 127.0.0.1:${oldAddress.port} kennt Cloudflare TURN noch nicht. Stelle den Worker mit dem aktuellen Stand neu bereit.`, { timeout: 15_000 });
      await panel.getByTestId('hdht-stop').click();
    } finally { await old.close(); }
  } finally { await relay.close(); }
});
