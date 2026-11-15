import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => { throw error; });
  await page.goto('/');
});

async function insertTemplate(page: Page, name: string) {
  await page.getByTestId('more-shapes').click();
  await page.getByTestId('open-diagram-library-sequence').click();
  const panel = page.getByTestId('shape-library-sidebar');
  await panel.getByRole('button', { name, exact: true }).click();
  await panel.getByRole('button', { name: 'Formen schließen' }).click();
}
const EMPTY = { x: 720, y: 160 };
const canvasOf = (page: Page) => page.locator('.whiteboard-canvas');
const part = (page: Page, role: string) => canvasOf(page).locator(`[data-sequence-role="${role}"]`);
const head = (page: Page, name: string) => part(page, 'head').filter({ hasText: name });
const arrow = (page: Page, text: string) => part(page, 'message').filter({ hasText: text }).locator('path[marker-end]');
const centre = async (locator: Locator) => { const box = (await locator.boundingBox())!; return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; };
/** Clicks an empty spot first, so the next click selects instead of starting a text edit. */
async function select(page: Page, locator: Locator) {
  await page.mouse.click(EMPTY.x, EMPTY.y);
  const at = await centre(locator);
  await page.mouse.click(at.x, at.y);
}
/** The texts of the messages from top to bottom. */
async function order(page: Page): Promise<string[]> {
  const rows = await part(page, 'message').evaluateAll((nodes) => nodes.map((node) => ({ y: node.querySelector('path[marker-end]')!.getBoundingClientRect().y, text: [...node.querySelectorAll('[data-testid="connector-label"] tspan')].map((line) => line.textContent).join(' ') })));
  return rows.sort((a, b) => a.y - b.y).map((row) => row.text);
}

test('a sequence diagram grows where it is clicked: lifeline to the right, message, reply and self message below the selection (#199)', async ({ page }) => {
  await insertTemplate(page, 'Beispiel: Anfrage und Antwort');
  const toolbar = page.getByRole('toolbar', { name: 'Eigenschaften' });
  await expect(part(page, 'message')).toHaveCount(2);
  // The service is active from the request to its reply.
  await expect(part(page, 'activation')).toHaveCount(1);
  const active = (await part(page, 'activation').boundingBox())!;
  expect(Math.abs(active.y - (await centre(arrow(page, 'Anfrage'))).y)).toBeLessThanOrEqual(1);
  expect(Math.abs(active.y + active.height - (await centre(arrow(page, 'Antwort'))).y)).toBeLessThanOrEqual(1);
  // The text stands above its arrow.
  const label = (await part(page, 'message').filter({ hasText: 'Anfrage' }).getByTestId('connector-label').boundingBox())!;
  expect(label.y + label.height).toBeLessThanOrEqual((await centre(arrow(page, 'Anfrage'))).y);

  // A new lifeline stands right of the clicked one; the service moves over.
  const serviceBefore = (await head(page, 'Dienst').boundingBox())!.x;
  await select(page, head(page, 'Client'));
  await toolbar.getByRole('button', { name: 'Lebenslinie hinzufügen' }).click();
  await expect(head(page, 'Teilnehmer 3')).toBeVisible();
  const [client, added, service] = await Promise.all(['Client', 'Teilnehmer 3', 'Dienst'].map(async (name) => (await head(page, name).boundingBox())!.x));
  expect(added).toBe(serviceBefore);
  expect(client!).toBeLessThan(added!);
  expect(service!).toBeGreaterThan(added!);
  // The request still reaches the service.
  const request = (await arrow(page, 'Anfrage').boundingBox())!;
  expect(request.x + request.width).toBeGreaterThan(service!);

  // A message below the selected one, not at the end.
  await select(page, arrow(page, 'Anfrage'));
  await toolbar.getByRole('button', { name: 'Nachricht hinzufügen' }).click();
  await expect(part(page, 'message')).toHaveCount(3);
  expect(await order(page)).toEqual(['Anfrage', 'Nachricht', 'Antwort']);
  // The new message is selected: its reply follows directly below it and runs back.
  await toolbar.getByRole('button', { name: 'Antwort hinzufügen' }).click();
  await expect(part(page, 'message')).toHaveCount(4);
  expect(await order(page)).toEqual(['Anfrage', 'Nachricht', 'Antwort', 'Antwort']);
  await expect(part(page, 'activation')).toHaveCount(2);

  // A call to oneself is a loop with the text beside it.
  await select(page, arrow(page, 'Anfrage'));
  await toolbar.getByRole('button', { name: 'Sequenzdiagramm' }).click();
  await page.getByTestId('sequence-add-self').click();
  await expect(part(page, 'message')).toHaveCount(5);
  const loop = (await part(page, 'message').nth(4).locator('path[marker-end]').boundingBox())!;
  expect(loop.height).toBeGreaterThan(20);
  expect(loop.width).toBeLessThan(60);
  const beside = (await part(page, 'message').nth(4).getByTestId('connector-label').boundingBox())!;
  expect(beside.x).toBeGreaterThanOrEqual(loop.x + loop.width);

  // Numbers 1, 2, 3 … from top to bottom.
  await toolbar.getByRole('button', { name: 'Sequenzdiagramm' }).click();
  await page.getByTestId('sequence-numbers').click();
  await expect(canvasOf(page).getByTestId('sequence-number')).toHaveCount(5);
  const numbers = await canvasOf(page).getByTestId('sequence-number').evaluateAll((nodes) => nodes.map((node) => ({ y: node.getBoundingClientRect().y, text: node.textContent!.trim() })).sort((a, b) => a.y - b.y).map((entry) => entry.text));
  expect(numbers).toEqual(['1', '2', '3', '4', '5']);
  await page.keyboard.press('Escape');
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);

  // Each action is one undo step.
  await page.getByTestId('whiteboard-canvas').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(canvasOf(page).getByTestId('sequence-number')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(part(page, 'message')).toHaveCount(4);

  // Other selections do not show the actions.
  await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
  await page.mouse.move(150, 600); await page.mouse.down(); await page.mouse.move(260, 660, { steps: 4 }); await page.mouse.up();
  await expect(toolbar.getByRole('button', { name: 'Nachricht hinzufügen' })).toHaveCount(0);
});

test('a text with several lines makes room above its message, and the lifelines grow with it (#199)', async ({ page }) => {
  await insertTemplate(page, 'Beispiel: Anfrage und Antwort');
  const gap = async () => (await centre(arrow(page, 'Antwort'))).y - (await centre(arrow(page, 'Anfrage'))).y;
  const before = await gap();
  const line = part(page, 'line').first();
  const tall = (await line.boundingBox())!.height;
  await page.mouse.click(EMPTY.x, EMPTY.y);
  const reply = await centre(arrow(page, 'Antwort'));
  await page.mouse.dblclick(reply.x, reply.y);
  await expect(page.getByTestId('canvas-text-editor')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Antwort');
  for (const text of ['zweite Zeile', 'dritte Zeile', 'vierte Zeile']) { await page.keyboard.press('Enter'); await page.keyboard.type(text); }
  await page.keyboard.press('ControlOrMeta+Enter');
  const rows = part(page, 'message').filter({ hasText: 'Antwort' }).getByTestId('connector-label').locator('tspan');
  await expect(rows).toHaveText(['Antwort', 'zweite Zeile', 'dritte Zeile', 'vierte Zeile']);
  await expect.poll(gap).toBeGreaterThan(before + 30);
  // All four lines lie between the two arrows.
  const first = (await rows.first().boundingBox())!;
  const last = (await rows.last().boundingBox())!;
  expect(first.y).toBeGreaterThan((await centre(arrow(page, 'Anfrage'))).y);
  expect(last.y + last.height).toBeLessThanOrEqual((await centre(arrow(page, 'Antwort'))).y + 1);
  expect((await line.boundingBox())!.height).toBeGreaterThan(tall);
});

test('a lifeline moves as a whole by its head; messages stay attached and it can change places (#199)', async ({ page }) => {
  await insertTemplate(page, 'Beispiel: Anfrage und Antwort');
  const client = head(page, 'Client');
  const start = (await client.boundingBox())!;
  const line = part(page, 'line').first();
  const lineBefore = (await line.boundingBox())!;
  const requestBefore = (await arrow(page, 'Anfrage').boundingBox())!;

  // Drag the head to the left and a bit down: the lifeline moves sideways only.
  await page.mouse.click(EMPTY.x, EMPTY.y);
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 - 120, start.y + start.height / 2 + 60, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await client.boundingBox())!.x)).toBe(Math.round(start.x - 120));
  expect(Math.round((await client.boundingBox())!.y)).toBe(Math.round(start.y));
  // The dashed line came along, and the request is longer by the same amount.
  expect(Math.round((await line.boundingBox())!.x)).toBe(Math.round(lineBefore.x - 120));
  const request = (await arrow(page, 'Anfrage').boundingBox())!;
  expect(Math.round(request.x)).toBe(Math.round(requestBefore.x - 120));
  expect(Math.round(request.width)).toBe(Math.round(requestBefore.width + 120));

  // Dragged past the service, the two change places and the request points to the left.
  const from = (await client.boundingBox())!;
  const service = (await head(page, 'Dienst').boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(service.x + service.width + 60, from.y + from.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await client.boundingBox())!.x).toBeGreaterThan(service.x + service.width);
  const turned = await arrow(page, 'Anfrage').evaluate((node) => { const path = node as SVGPathElement; return path.getPointAtLength(0).x > path.getPointAtLength(path.getTotalLength()).x; });
  expect(turned).toBe(true);
  // One undo step per drag.
  await page.getByTestId('whiteboard-canvas').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => Math.round((await client.boundingBox())!.x)).toBe(Math.round(start.x - 120));
});

test('the library has the fragments loop, alt, opt, par, critical, break and a highlight; dropped on a diagram they frame its messages (#199)', async ({ page }) => {
  // On their own: a frame with its operator, its condition and, where it has one, a second section.
  await insertTemplate(page, 'Alternative (alt)');
  const fragment = part(page, 'fragment');
  await expect(fragment.getByTestId('sequence-fragment-operator')).toHaveText('alt');
  await expect(fragment.getByTestId('sequence-fragment-condition')).toHaveText('[Bedingung]');
  await expect(part(page, 'divider').getByTestId('sequence-section-condition')).toHaveText('[sonst]');
  await page.getByTestId('whiteboard-canvas').focus();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await expect(fragment).toHaveCount(0);

  await page.getByTestId('more-shapes').click();
  await page.getByTestId('open-diagram-library-sequence').click();
  const panel = page.getByTestId('shape-library-sidebar');
  for (const name of ['Schleife (loop)', 'Alternative (alt)', 'Optional (opt)', 'Parallel (par)', 'Kritischer Bereich (critical)', 'Abbruch (break)', 'Hervorhebung (rect)', 'Notiz', 'Akteur']) await expect(panel.getByRole('button', { name, exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Formen schließen' }).click();

  // Dropped at the centre of a diagram, the loop frames the messages it covers.
  await insertTemplate(page, 'Beispiel: Anfrage und Antwort');
  await page.mouse.click(EMPTY.x, EMPTY.y);
  await insertTemplate(page, 'Schleife (loop)');
  await page.mouse.click(EMPTY.x, EMPTY.y);
  await expect(fragment.getByTestId('sequence-fragment-operator')).toHaveText('loop');
  const frame = (await fragment.locator('rect').first().boundingBox())!;
  const inside = await order(page);
  expect(inside.length).toBe(2);
  const framed = [] as string[];
  for (const text of inside) { const at = await centre(arrow(page, text)); if (at.y > frame.y && at.y < frame.y + frame.height) framed.push(text); }
  expect(framed.length).toBeGreaterThan(0);
  // What is framed stays clickable: a click on a framed arrow selects the message, not the frame.
  await select(page, arrow(page, framed[0]!));
  await expect(page.getByRole('toolbar', { name: 'Eigenschaften' }).getByRole('button', { name: 'Antwort hinzufügen' })).toBeVisible();
  await expect(page.getByTestId('connector-label-handle')).toBeVisible();
  // A message added with the frame selected lands inside it.
  await page.mouse.click(EMPTY.x, EMPTY.y);
  await page.mouse.click(frame.x + 12, frame.y + 10);
  await page.getByRole('toolbar', { name: 'Eigenschaften' }).getByRole('button', { name: 'Nachricht hinzufügen' }).click();
  await expect(part(page, 'message')).toHaveCount(3);
  const grown = (await fragment.locator('rect').first().boundingBox())!;
  const added = await centre(part(page, 'message').nth(2).locator('path[marker-end]'));
  expect(added.y).toBeGreaterThan(grown.y);
  expect(added.y).toBeLessThan(grown.y + grown.height);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
});

test('an actor is a lifeline with a stick figure, and a new diagram starts from a single lifeline (#199)', async ({ page }) => {
  await insertTemplate(page, 'Akteur');
  await expect(canvasOf(page).getByTestId('sequence-actor')).toBeVisible();
  await expect(canvasOf(page).getByTestId('sequence-actor-name')).toHaveText('Akteur');
  // The first message brings a second lifeline.
  await select(page, canvasOf(page).getByTestId('sequence-actor-name'));
  await page.getByRole('toolbar', { name: 'Eigenschaften' }).getByRole('button', { name: 'Nachricht hinzufügen' }).click();
  await expect(part(page, 'lifeline')).toHaveCount(2);
  await expect(part(page, 'message')).toHaveCount(1);
  await expect(head(page, 'Teilnehmer 2')).toBeVisible();
});
