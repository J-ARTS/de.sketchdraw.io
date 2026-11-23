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
  // A notice under the pointer stays until the pointer leaves it, and "Session beigetreten" appears close to the join
  // button. The pointer rests on the panel title instead, off the canvas, so the test does not depend on that distance.
  await guest.getByText('Zusammenarbeiten', { exact: true }).first().hover();
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
    // Listed for the host and for the guest. With the list in view nothing is announced on top of it.
    await expect(people(page)).toHaveCount(2);
    await expect(people(page).nth(1)).toContainText('Anna Lena');
    await expect(people(page).nth(1)).toContainText('Bearbeitet mit');
    await expect(people(page).nth(1).locator('.app-avatar')).toHaveText('AL');
    await expect(notices(page)).not.toContainText('beigetreten');
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
    await expect(notices(guest)).not.toContainText('entfernt');
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
  // With the panel closed, the host is told over the canvas that someone joined.
  await expect(people(page)).toHaveCount(2);
  await page.getByRole('button', { name: 'Zusammenarbeit schließen' }).click();
  const ben = await joinSession(browser, invitation, '');
  try {
    await expect(notices(page)).toContainText('Gast 2 ist der Session beigetreten.');
    await expect(notices(page)).not.toContainText('Anna');
    await openPanel(page);
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

    // A guest that works with the panel closed is told over the canvas, and the message stays until it is closed.
    await anna.guest.getByRole('button', { name: 'Zusammenarbeit schließen' }).click();
    await page.getByTestId('hdht-stop').click();
    await expect(notices(anna.guest)).toContainText('Der Gastgeber hat die Session beendet.');
    await anna.guest.waitForTimeout(3500);
    await expect(notices(anna.guest)).toContainText('Der Gastgeber hat die Session beendet.');
    await openPanel(anna.guest);
    await expect(anna.guest.getByTestId('hdht-session').getByRole('alert')).toHaveText('Der Gastgeber hat die Session beendet.');
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

test('a guest that was removed while its panel is closed is told over the canvas', async ({ page, browser }) => {
  const invitation = await hostSession(page, 'Jeremy');
  const { context, guest } = await joinSession(browser, invitation, 'Anna');
  try {
    await guest.getByRole('button', { name: 'Zusammenarbeit schließen' }).click();
    await people(page).nth(1).getByTestId('participant-remove').click();
    await page.getByTestId('participant-remove-confirm').click();
    await expect(notices(guest)).toContainText('Der Gastgeber hat dich aus der Session entfernt.');
    await expect(guest.getByRole('button', { name: 'Rechteck', exact: true })).toBeDisabled();
  } finally { await context.close(); }
});

// --- Session button of the bar: follow a person, end the session (#223) -------------
const sessionButton = (page: Page) => page.getByTestId('session-button');
const following = (page: Page) => page.getByTestId('follow-indicator');
const zoomLabel = (page: Page) => page.locator('.zoom-value');
async function followFromBar(page: Page, name: string) {
  await sessionButton(page).click();
  await page.getByTestId('session-menu').getByRole('menuitemcheckbox', { name: `${name} folgen`, exact: true }).click();
  await expect(page.getByTestId('session-menu')).toHaveCount(0);
}

test('the bar shows the running session; following shows what the person sees until the user navigates', async ({ page, browser }) => {
  await page.goto('/');
  await expect(sessionButton(page)).toHaveCount(0);
  const invitation = await hostSession(page, 'Jeremy');
  await expect(sessionButton(page)).toHaveAccessibleName('Session, 1 Person verbunden');
  await expect(page.getByTestId('session-count')).toHaveText('1');
  const { context, guest } = await joinSession(browser, invitation, 'Anna');
  try {
    await expect(page.getByTestId('session-count')).toHaveText('2');
    await expect(sessionButton(guest)).toHaveAccessibleName('Session, 2 Personen verbunden');
    await page.getByRole('button', { name: 'Zusammenarbeit schließen' }).click();
    await guest.getByRole('button', { name: 'Zusammenarbeit schließen' }).click();

    // The guest scrolls and points at a place; without following the host sees that place where it is in its own view.
    await guest.mouse.move(400, 300); await guest.mouse.wheel(0, 200);
    await guest.mouse.move(401, 300); await guest.mouse.move(400, 300);
    await expect.poll(async () => (await tip(page)).y).toBeGreaterThan(480);

    // The menu lists both; the own row and nothing else is unavailable.
    await sessionButton(page).click();
    const menu = page.getByTestId('session-menu');
    await expect(menu.getByTestId('session-person')).toHaveCount(2);
    await expect(menu.getByRole('menuitemcheckbox', { name: 'Jeremy, das bist du' })).toHaveAttribute('aria-disabled', 'true');
    await expect(menu.getByRole('menuitem', { name: 'Link und PIN anzeigen' })).toBeVisible();
    // Keyboard: the first entry that can be chosen has the focus, Escape gives it back to the button.
    await expect(menu.getByRole('menuitemcheckbox', { name: 'Anna folgen' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(sessionButton(page)).toBeFocused();

    // Following aligns the host's canvas with the guest's: the pointer is now where the guest has it.
    await followFromBar(page, 'Anna');
    await expect(following(page)).toContainText('Du folgst Anna');
    await expect(sessionButton(page)).toHaveAccessibleName('Session: du folgst Anna');
    await expect.poll(async () => (await tip(page)).y).toBe(299);
    // … and stays there while the guest scrolls and zooms.
    await guest.mouse.wheel(150, -80);
    await guest.mouse.move(401, 300); await guest.mouse.move(400, 300);
    await expect.poll(() => tip(page)).toEqual({ x: 399, y: 299 });
    await guest.keyboard.down('Control'); await guest.mouse.wheel(0, -300); await guest.keyboard.up('Control');
    await expect(zoomLabel(guest)).not.toHaveText('100 %');
    await expect.poll(async () => await zoomLabel(page).textContent()).toBe(await zoomLabel(guest).textContent());
    // The guest opens a second page; the host goes there too.
    await guest.getByTestId('page-switcher').click(); await guest.getByTestId('page-add').click();
    await expect(guest.getByTestId('page-switcher')).toHaveAccessibleName(/^Seiten \(2\)/);
    await expect(page.getByTestId('page-switcher')).toContainText('Seite 2');
    await expect(following(page)).toBeVisible();

    // The first own navigation ends following.
    await page.mouse.move(500, 400); await page.mouse.wheel(0, 60);
    await expect(following(page)).toHaveCount(0);
    await expect(sessionButton(page)).toHaveAccessibleName('Session, 2 Personen verbunden');
    // So do Escape and the button of the bar at the bottom.
    await followFromBar(page, 'Anna');
    await expect(following(page)).toBeVisible();
    await page.getByTestId('whiteboard-canvas').focus(); await page.keyboard.press('Escape');
    await expect(following(page)).toHaveCount(0);
    await followFromBar(page, 'Anna');
    await page.getByTestId('follow-stop').click();
    await expect(following(page)).toHaveCount(0);
    // Choosing the followed person again ends it as well.
    await followFromBar(page, 'Anna');
    await sessionButton(page).click();
    await expect(page.getByRole('menuitemcheckbox', { name: 'Anna folgen' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('menuitemcheckbox', { name: 'Anna folgen' }).click();
    await expect(following(page)).toHaveCount(0);

    // A guest can follow the host; when the followed person is gone, following ends with a message.
    await followFromBar(guest, 'Jeremy');
    await expect(following(guest)).toContainText('Du folgst Jeremy');

    // The host ends the session from the bar, after being asked because someone else is in it.
    await sessionButton(page).click();
    await page.getByTestId('session-end').click();
    await expect(page.getByTestId('session-end-question')).toHaveText('Die Session endet auch für 1 weitere Person.');
    await page.getByRole('menuitem', { name: 'Weiterlaufen lassen' }).click();
    await expect(page.getByTestId('session-end')).toBeFocused();
    await page.getByTestId('session-end').click();
    await page.getByTestId('session-end-confirm').click();
    await expect(sessionButton(page)).toHaveCount(0);
    await expect(notices(guest)).toContainText('Der Gastgeber hat die Session beendet.');
    await expect(following(guest)).toHaveCount(0);
    // The guest still has a copy to keep and leaves from its bar.
    await sessionButton(guest).click();
    await guest.getByRole('menuitem', { name: 'Session verlassen' }).click();
    await expect(sessionButton(guest)).toHaveCount(0);
    await openPanel(guest);
    await expect(guest.getByTestId('hdht-join')).toBeVisible();
  } finally { await context.close(); }
});

test('a host that is alone ends the session from the bar at once; the button fits a narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await hostSession(page, 'Jeremy');
  await page.getByRole('button', { name: 'Zusammenarbeit schließen' }).click();
  await sessionButton(page).click();
  const menu = page.getByTestId('session-menu');
  await expect(menu).toContainText('Noch ist niemand beigetreten.');
  const box = (await menu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(360);
  // Every control of the top bars stays inside the window.
  for (const control of [sessionButton(page), page.getByTestId('workspace-menu-button'), page.getByTestId('file-menu-button')]) {
    const area = (await control.boundingBox())!;
    expect(area.x).toBeGreaterThanOrEqual(0);
    expect(area.x + area.width).toBeLessThanOrEqual(360);
  }
  await menu.getByRole('menuitem', { name: 'Link und PIN anzeigen' }).click();
  await expect(page.getByTestId('hdht-link')).toBeVisible();
  await page.getByRole('button', { name: 'Zusammenarbeit schließen' }).click();
  await sessionButton(page).click();
  await page.getByTestId('session-end').click();
  await expect(sessionButton(page)).toHaveCount(0);
  await openPanel(page);
  await expect(page.getByTestId('hdht-start')).toBeVisible();
});
