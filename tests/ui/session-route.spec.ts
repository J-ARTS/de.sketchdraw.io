import { expect, test, type Page } from '@playwright/test';
// @ts-expect-error plain ESM relay without declarations
import { createRelayServer } from '../../relay/server.mjs';

/*
 * The route of a session (#300): directly between the devices, or through a relay. The pages here are browsers, which
 * have no direct route at all; the relay is the self-hosted one of this repository, which speaks the protocol of the
 * Cloudflare Worker and takes the same room addresses.
 */
let relay: ReturnType<typeof createRelayServer>;
let relayAddress = '', relayHost = '';
test.beforeAll(async () => {
  relay = createRelayServer();
  const address = await relay.listen(0, '127.0.0.1');
  relayHost = `127.0.0.1:${address.port}`;
  relayAddress = `ws://${relayHost}`;
});
test.afterAll(async () => { await relay.close(); });

const webLink = (link: string) => `/#${link.split('#')[1]}`;
const invitationOf = (link: string) => JSON.parse(Buffer.from(link.split('sketchdraw-hdht=')[1]!, 'base64url').toString('utf8')) as { d: string; r: string; h: string };
async function openPanel(page: Page) {
  await page.getByTestId('workspace-menu-button').click();
  await page.getByRole('menuitemcheckbox', { name: 'Zusammenarbeiten', exact: true }).click();
}
async function draw(page: Page, shape: 'Rechteck' | 'Ellipse', x = 280, y = 300) {
  await page.getByRole('button', { name: shape, exact: true }).click();
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 130, y + 80, { steps: 5 }); await page.mouse.up();
}
async function chooseRoute(page: Page, name: 'Direkt (P2P)' | 'Cloudflare-Relay' | 'Cloudflare TURN') {
  await page.getByTestId('hdht-session').getByRole('combobox', { name: 'Verbindungsweg', exact: true }).click();
  await page.getByRole('option', { name, exact: true }).click();
}

test('direct is the default; the relay route asks for an address and says what is wrong with it', async ({ page }) => {
  await page.goto('/'); await openPanel(page);
  const panel = page.getByTestId('hdht-session');
  const route = panel.getByRole('combobox', { name: 'Verbindungsweg', exact: true });
  await expect(route).toHaveText('Direkt (P2P)');
  await expect(panel.getByTestId('hdht-relay-address')).toHaveCount(0);
  await expect(panel.getByTestId('hdht-route-text')).toContainText('direkt oder über freiwillige Relay-Helfer');
  // With the route choice the form still fits the panel of the default window: "join" is reachable without scrolling.
  const fits = await panel.evaluate(section => {
    const body = section.closest('.body')!.getBoundingClientRect(), join = section.querySelector('[data-testid=hdht-join]')!.getBoundingClientRect();
    const [link, pin] = [...section.querySelectorAll('.join-row .sd-input')].map(input => input.getBoundingClientRect());
    return { joinVisible: join.top >= body.top && join.bottom <= body.bottom, sameRow: link!.top === pin!.top && link!.height === pin!.height && link!.right < pin!.left };
  });
  expect(fits).toEqual({ joinVisible: true, sameRow: true });

  await chooseRoute(page, 'Cloudflare-Relay');
  await expect(route).toHaveText('Cloudflare-Relay');
  await expect(panel.getByTestId('hdht-route-text')).toContainText('Der Relay sieht Netzwerkadressen, Zeitpunkte und Datenmengen, aber weder PIN noch Inhalt.');
  const address = panel.getByRole('textbox', { name: 'Relay-Adresse', exact: true });
  await expect(address).toBeVisible();
  await expect(address).toHaveAccessibleDescription('Gäste brauchen die Adresse nicht – sie steht im Session-Link.');
  // The relay the app ships with is filled in; nobody has to type an address. Both Cloudflare routes are a trial.
  await expect(address).toHaveValue('sketchdraw-relay.jeremy-teichman74.workers.dev');
  await expect(panel.getByTestId('hdht-route-trial')).toHaveText('Testbetrieb: Von den beiden Cloudflare-Wegen bleibt nach dem Vergleich nur einer.');
  // Text fields are as tall as the dropdowns of the form.
  const heights = await panel.evaluate(section => ({
    select: section.querySelector('[data-testid=hdht-route] .app-select')!.getBoundingClientRect().height,
    fields: ['#hdht-relay-address', '[data-testid=hdht-name]', '.join-row .sd-input', '.join-row .pin'].map(selector => section.querySelector(selector)!.getBoundingClientRect().height),
  }));
  expect(heights.fields).toEqual([heights.select, heights.select, heights.select, heights.select]);

  await address.fill('');
  await panel.getByTestId('hdht-start').click();
  const problem = panel.getByTestId('hdht-relay-address-error');
  await expect(problem).toHaveText('Trage die Adresse des Relays ein.');
  await expect(address).toHaveAttribute('aria-invalid', 'true');
  await expect(address).toHaveAccessibleDescription('Trage die Adresse des Relays ein.');
  await expect(panel.getByTestId('hdht-link')).toHaveCount(0);
  await address.fill('http://relay.example.org'); await panel.getByTestId('hdht-start').click();
  await expect(problem).toHaveText('Der Relay muss verschlüsselt erreichbar sein (wss:// oder https://).');
  await address.fill('wss://name:secret@relay.example.org'); await address.press('Enter');
  await expect(problem).toContainText('Das ist keine gültige Relay-Adresse.');
  await expect(panel.getByTestId('hdht-start')).toBeVisible();

  // The choice and the address stay on this device.
  await address.fill('relay.example.org'); await address.blur();
  await page.reload(); await openPanel(page);
  await expect(page.getByTestId('hdht-session').getByRole('combobox', { name: 'Verbindungsweg', exact: true })).toHaveText('Cloudflare-Relay');
  await expect(page.getByTestId('hdht-relay-address')).toHaveValue('relay.example.org');
  // An emptied field falls back to the relay of the app the next time.
  await page.getByTestId('hdht-relay-address').fill(''); await page.getByTestId('hdht-relay-address').blur();
  await page.reload(); await openPanel(page);
  await expect(page.getByTestId('hdht-relay-address')).toHaveValue('sketchdraw-relay.jeremy-teichman74.workers.dev');
  await chooseRoute(page, 'Direkt (P2P)');
  await expect(page.getByTestId('hdht-relay-address')).toHaveCount(0);
  await expect(page.getByTestId('hdht-route-trial')).toHaveCount(0);
  await page.reload(); await openPanel(page);
  await expect(page.getByTestId('hdht-session').getByRole('combobox', { name: 'Verbindungsweg', exact: true })).toHaveText('Direkt (P2P)');
});

test('a session through the relay: the link carries the room, three guests join with the PIN and everyone draws together', async ({ page, browser }) => {
  await page.goto('/'); await draw(page, 'Rechteck'); await openPanel(page);
  const panel = page.getByTestId('hdht-session');
  await panel.getByRole('combobox', { name: 'Zugriff für Eingeladene', exact: true }).click();
  await page.getByRole('option', { name: 'Gemeinsam bearbeiten', exact: true }).click();
  await chooseRoute(page, 'Cloudflare-Relay');
  await panel.getByTestId('hdht-relay-address').fill(relayAddress);
  await panel.getByTestId('hdht-start').click();
  const link = await (async () => { const field = panel.getByTestId('hdht-link'); await expect(field).toHaveValue(/^sketchdraw:\/\/join#sketchdraw-hdht=[A-Za-z0-9_-]+$/); return field.inputValue(); })();
  const pin = await panel.getByTestId('hdht-host-pin').inputValue();
  // The relay route waits for nothing else: no "direct connection is being prepared", no helper of this device.
  await expect(panel.getByTestId('hdht-share-relay')).toHaveCount(0);
  await expect(panel.getByTestId('hdht-active-route')).toHaveText(`Verbindungsweg: Cloudflare-Relay (${relayHost})`);
  const invitation = invitationOf(link);
  expect(invitation.d).toBe('');
  expect(invitation.r).toMatch(new RegExp(`^ws://${relayHost.replace(/\./g, '\\.')}/v1/[0-9a-f]{64}$`));
  expect(link).not.toContain(pin);

  const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext()));
  try {
    const guests = await Promise.all(contexts.map(context => context.newPage()));
    for (const guest of guests) {
      await guest.goto(webLink(link));
      await expect(guest.getByTestId('hdht-link-relay')).toHaveText(`Dieser Link verbindet über den Relay ${relayHost}. Der Relay sieht deine Netzwerkadresse, aber keinen Inhalt.`);
      await guest.getByRole('textbox', { name: 'Sechsstellige PIN' }).fill(pin); await guest.getByTestId('hdht-join').click();
      await expect(guest.getByTestId('hdht-status')).toHaveText('Verbunden');
      await expect(guest.getByTestId('hdht-session')).toContainText(`Verschlüsselt über den Relay ${relayHost}`);
      await expect(guest.locator('.whiteboard-canvas [data-kind=rectangle]')).toHaveCount(1);
    }
    await expect(panel.getByTestId('hdht-status')).toHaveText('Verbunden · 3 Personen');
    expect(relay.stats()).toMatchObject({ connections: 4, topics: 1 });

    await draw(guests[2]!, 'Ellipse', 280, 450);
    await expect(page.locator('.whiteboard-canvas [data-kind=ellipse]')).toHaveCount(1);
    for (const guest of guests) await expect(guest.locator('.whiteboard-canvas [data-kind=ellipse]')).toHaveCount(1);
    await draw(page, 'Rechteck', 500, 450);
    for (const guest of guests) await expect(guest.locator('.whiteboard-canvas [data-kind=rectangle]')).toHaveCount(2);

    await page.getByTestId('hdht-stop').click();
    for (const guest of guests) await expect(guest.getByTestId('hdht-session').getByRole('alert')).toContainText('Gastgeber hat die Session beendet');
    await expect.poll(() => relay.stats().connections).toBe(0);
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test('a relay that does not answer is named while the app keeps trying, and a guest hears that the session is not there', async ({ page, browser }) => {
  const dead = createRelayServer();
  const address = await dead.listen(0, '127.0.0.1');
  const deadHost = `127.0.0.1:${address.port}`;
  await dead.close();
  await page.goto('/'); await openPanel(page);
  const panel = page.getByTestId('hdht-session');
  await chooseRoute(page, 'Cloudflare-Relay');
  await panel.getByTestId('hdht-relay-address').fill(`ws://${deadHost}`);
  await panel.getByTestId('hdht-start').click();
  await expect(panel.getByTestId('hdht-relay-problem')).toHaveText(`Der Relay ${deadHost} ist nicht erreichbar. Die App versucht es weiter – prüfe die Adresse und deine Internetverbindung.`);
  await expect(panel.getByTestId('hdht-link')).toHaveCount(0);
  await panel.getByTestId('hdht-stop').click();
  await expect(panel.getByTestId('hdht-start')).toBeVisible();

  // A link whose session has ended: the relay answers, the host is not there.
  await panel.getByTestId('hdht-relay-address').fill(relayAddress);
  await panel.getByTestId('hdht-start').click();
  const field = panel.getByTestId('hdht-link');
  await expect(field).toHaveValue(/sketchdraw-hdht=/);
  const link = await field.inputValue(), pin = await panel.getByTestId('hdht-host-pin').inputValue();
  await panel.getByTestId('hdht-stop').click();
  await expect(panel.getByTestId('hdht-start')).toBeVisible();
  const context = await browser.newContext(); const guest = await context.newPage();
  try {
    await guest.goto(webLink(link));
    await guest.getByRole('textbox', { name: 'Sechsstellige PIN' }).fill(pin); await guest.getByTestId('hdht-join').click();
    await expect(guest.getByTestId('hdht-session').getByRole('alert')).toHaveText(`Keine Verbindung über den Relay ${relayHost}. Prüfe, ob die Session noch läuft und ob dein Netzwerk WebSocket-Verbindungen zulässt.`, { timeout: 30_000 });
  } finally { await context.close(); }
});

test('the route choice speaks English and follows the dark theme', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('sketchdraw.preferences.v1') ?? '{}');
    localStorage.setItem('sketchdraw.preferences.v1', JSON.stringify({ ...raw, version: raw.version ?? 1, theme: 'dark', language: 'en' }));
    localStorage.setItem('sketchdraw.session-route.v1', 'cloud');
  });
  await page.reload();
  await page.getByTestId('workspace-menu-button').click();
  await page.getByRole('menuitemcheckbox', { name: 'Collaborate', exact: true }).click();
  const panel = page.getByTestId('hdht-session');
  await expect(panel.getByRole('combobox', { name: 'Connection route', exact: true })).toHaveText('Cloudflare relay');
  await expect(panel.getByRole('textbox', { name: 'Relay address', exact: true })).toBeVisible();
  await expect(panel.getByTestId('hdht-route-text')).toContainText('the relay sees network addresses, times and amounts of data, but neither the PIN nor any content.');
  await expect(panel.getByTestId('hdht-route-trial')).toHaveText('Trial: after the comparison only one of the two Cloudflare routes remains.');
  await panel.getByRole('textbox', { name: 'Relay address', exact: true }).fill('');
  await panel.getByTestId('hdht-start').click();
  await expect(panel.getByTestId('hdht-relay-address-error')).toHaveText('Enter the address of the relay.');
  await panel.getByRole('combobox', { name: 'Connection route', exact: true }).click();
  await expect(page.getByRole('option', { name: 'Direct (P2P)', exact: true })).toBeVisible();
  const colors = await panel.getByTestId('hdht-relay-address').evaluate(element => { const style = getComputedStyle(element); return { background: style.backgroundColor, color: style.color }; });
  const luminance = (value: string) => { const [r, g, b] = value.match(/\d+(\.\d+)?/g)!.map(Number); return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!; };
  expect(luminance(colors.background)).toBeLessThan(90);
  expect(luminance(colors.color)).toBeGreaterThan(160);
});
