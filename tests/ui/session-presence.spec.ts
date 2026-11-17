import { expect, test, type Browser, type Page } from '@playwright/test';
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

/** Browser pages have no native HyperDHT; the tests point the renderer at a local relay through its development override. */
const webLink = (link: string) => `/#${link.split('#')[1]}`;
async function openPanel(page: Page) {
  await page.getByTestId('workspace-menu-button').click();
  await page.getByRole('menuitemcheckbox', { name: 'Zusammenarbeiten', exact: true }).click();
}
async function hostSession(page: Page, name: string, role: 'editor' | 'viewer' = 'editor') {
  await page.goto('/'); await openPanel(page);
  const panel = page.getByTestId('hdht-session');
  if (name) { await panel.getByTestId('hdht-name').fill(name); await panel.getByTestId('hdht-name').press('Tab'); }
  await panel.getByRole('combobox', { name: 'Zugriff für Eingeladene', exact: true }).click();
  await page.getByRole('option', { name: role === 'editor' ? 'Gemeinsam bearbeiten' : 'Nur ansehen', exact: true }).click();
  await page.evaluate(url => localStorage.setItem('sketchdraw.hdht-relay-url.v1', url), relayUrl);
  await panel.getByTestId('hdht-start').click();
  await expect(panel.getByTestId('hdht-link')).toHaveValue(/^sketchdraw:\/\/join#/);
  return { link: await panel.getByTestId('hdht-link').inputValue(), pin: await panel.getByTestId('hdht-host-pin').inputValue() };
}
async function joinSession(browser: Browser, invitation: { link: string; pin: string }, name: string) {
  const context = await browser.newContext(); const guest = await context.newPage();
  await guest.goto(webLink(invitation.link));
  const panel = guest.getByTestId('hdht-session');
  if (name) { await panel.getByTestId('hdht-name').fill(name); await panel.getByTestId('hdht-name').press('Tab'); }
  await guest.getByRole('textbox', { name: 'Sechsstellige PIN' }).fill(invitation.pin); await guest.getByTestId('hdht-join').click();
  await expect(guest.getByTestId('hdht-status')).toHaveText('Verbunden');
  return { context, guest };
}
const people = (page: Page) => page.getByTestId('participant');
const pointers = (page: Page) => page.getByTestId('remote-cursor');
const notices = (page: Page) => page.getByRole('region', { name: 'Meldungen' });
async function tip(page: Page) {
  const box = await pointers(page).locator('.arrow').boundingBox();
  return { x: Math.round(box!.x), y: Math.round(box!.y) };
}

test('the host sees who joined, both see the pointer of the other, and a removed guest is told', async ({ page, browser }) => {
  const invitation = await hostSession(page, 'Jeremy Teichmann');
  await expect(people(page)).toHaveCount(1);
  await expect(people(page).first()).toContainText('Jeremy Teichmann');
  await expect(people(page).first()).toContainText('Du');
  const { context, guest } = await joinSession(browser, invitation, 'Anna Lena');
  try {
    // Listed for the host, with a notice for when the panel is closed, and listed for the guest.
    await expect(people(page)).toHaveCount(2);
    await expect(people(page).nth(1)).toContainText('Anna Lena');
    await expect(people(page).nth(1)).toContainText('Bearbeitet mit');
    await expect(people(page).nth(1).locator('.app-avatar')).toHaveText('AL');
    await expect(notices(page)).toContainText('Anna Lena ist der Session beigetreten.');
    await expect(people(guest)).toHaveCount(2);
    await expect(people(guest).first()).toContainText('Jeremy Teichmann');
    await expect(people(guest).first()).toContainText('Gastgeber');
    await expect(people(guest).nth(1)).toContainText('Du');
    await expect(guest.getByTestId('participant-remove')).toHaveCount(0);
    await expect(notices(guest)).not.toContainText('beigetreten');

    // The pointer of the guest appears on the host's canvas at the same place of the drawing, with the guest's initials.
    await expect(pointers(page)).toHaveCount(0);
    await guest.mouse.move(300, 420, { steps: 4 });
    await expect(pointers(page)).toHaveCount(1);
    await expect(pointers(page).locator('text')).toHaveText('AL');
    await expect.poll(() => tip(page)).toEqual({ x: 299, y: 419 });
    const colour = await people(page).nth(1).locator('.app-avatar').evaluate(node => getComputedStyle(node).backgroundColor);
    expect(await pointers(page).locator('.arrow').evaluate(node => getComputedStyle(node).fill)).toBe(colour);
    // … and follows the drawing when the host scrolls it.
    await page.mouse.move(600, 500); await page.mouse.wheel(0, 120);
    await expect.poll(async () => (await tip(page)).y).toBeLessThan(380);
    await expect(pointers(page)).toHaveAttribute('data-x', '300');

    // The host's pointer appears for the guest; the own pointer is never drawn.
    await expect(pointers(guest)).toHaveCount(1);
    await expect(pointers(guest).locator('text')).toHaveText('JT');
    // Leaving the canvas takes the pointer away.
    await guest.getByTestId('collaboration-panel').hover();
    await expect(pointers(page)).toHaveCount(0);

    // Removing asks once, then the guest loses access and is told so, also outside the panel.
    await people(page).nth(1).getByTestId('participant-remove').click();
    await expect(people(page).nth(1)).toContainText('Anna Lena verliert sofort den Zugriff');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('participant-remove-confirm')).toHaveCount(0);
    await expect(people(page).nth(1).getByTestId('participant-remove')).toBeFocused();
    await people(page).nth(1).getByTestId('participant-remove').click();
    await page.getByTestId('participant-remove-confirm').click();
    await expect(people(page)).toHaveCount(1);
    await expect(page.getByTestId('hdht-session')).toContainText('Anna Lena wurde entfernt.');
    await expect(guest.getByTestId('hdht-session').getByRole('alert')).toHaveText('Der Gastgeber hat dich aus der Session entfernt.');
    await expect(notices(guest)).toContainText('Der Gastgeber hat dich aus der Session entfernt.');
    await expect(people(guest)).toHaveCount(0);
    await expect(pointers(guest)).toHaveCount(0);
    await expect(guest.getByRole('button', { name: 'Rechteck', exact: true })).toBeDisabled();
    // The session itself goes on.
    await expect(page.getByRole('heading', { name: 'Session läuft' })).toBeVisible();
  } finally { await context.close(); }
});

test('a guest whose connection drops is listed as interrupted; ending the session tells everyone', async ({ page, browser }) => {
  const invitation = await hostSession(page, '', 'viewer');
  await expect(people(page).first()).toContainText('Gastgeber');
  const anna = await joinSession(browser, invitation, 'Anna');
  const ben = await joinSession(browser, invitation, '');
  try {
    await expect(people(page)).toHaveCount(3);
    await expect(people(page).nth(1)).toContainText('Sieht zu');
    await expect(people(page).nth(1).getByTestId('participant-remove')).toHaveAccessibleName('Anna aus der Session entfernen');
    // Without a name a guest gets a neutral, numbered label.
    await expect(people(page).nth(2)).toContainText('Gast 2');
    await expect(people(page).nth(2).locator('.app-avatar')).toHaveText('G2');
    // Viewers point as well.
    await ben.guest.mouse.move(320, 380, { steps: 3 });
    await expect(pointers(page)).toHaveCount(1);
    await expect(pointers(anna.guest)).toHaveCount(1);

    // The window disappears without a goodbye: host and the other guest keep the entry as interrupted.
    await ben.context.close();
    await expect(people(page).nth(2)).toHaveAttribute('data-state', 'reconnecting');
    await expect(people(page).nth(2)).toContainText('Verbindung unterbrochen');
    await expect(people(anna.guest).nth(2)).toContainText('Verbindung unterbrochen');
    await expect(pointers(page)).toHaveCount(0);
    await expect(pointers(anna.guest)).toHaveCount(0);
    // An interrupted entry can be removed as well.
    await people(page).nth(2).getByTestId('participant-remove').click();
    await page.getByTestId('participant-remove-confirm').click();
    await expect(people(page)).toHaveCount(2);
    await expect(people(anna.guest)).toHaveCount(2);

    await page.getByTestId('hdht-stop').click();
    await expect(anna.guest.getByTestId('hdht-session').getByRole('alert')).toHaveText('Der Gastgeber hat die Session beendet.');
    await expect(notices(anna.guest)).toContainText('Der Gastgeber hat die Session beendet.');
    await expect(people(anna.guest)).toHaveCount(0);
    await expect(people(page)).toHaveCount(0);
  } finally { await anna.context.close(); await ben.context.close().catch(() => undefined); }
});

test('a guest can rename itself and leaves the list at once when it leaves on purpose', async ({ page, browser }) => {
  const invitation = await hostSession(page, 'Jeremy');
  const { context, guest } = await joinSession(browser, invitation, '');
  try {
    await expect(people(page).nth(1)).toContainText('Gast 1');
    const name = guest.getByTestId('hdht-session').getByTestId('hdht-name');
    await name.fill('  Chiara   Rossi '); await name.press('Enter');
    await expect(name).toHaveValue('Chiara Rossi');
    await expect(people(page).nth(1)).toContainText('Chiara Rossi');
    await expect(people(page).nth(1).locator('.app-avatar')).toHaveText('CR');
    // The name is remembered on this device for the next session.
    expect(await guest.evaluate(() => localStorage.getItem('sketchdraw.display-name.v1'))).toBe('Chiara Rossi');
    await guest.getByTestId('hdht-stop').click();
    await expect(people(page)).toHaveCount(1);
    await expect(page.getByTestId('participant-list')).not.toContainText('Verbindung unterbrochen');
  } finally { await context.close(); }
});
