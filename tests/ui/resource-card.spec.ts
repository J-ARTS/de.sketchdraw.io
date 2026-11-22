import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
  await page.goto('/');
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
});

async function insertResourceCard(page: import('@playwright/test').Page) {
  await page.getByTestId('more-shapes').click();
  const sidebar = page.getByTestId('shape-library-sidebar');
  await sidebar.getByRole('searchbox', { name: 'Formen durchsuchen' }).fill('Ressourcenkarte');
  await sidebar.getByRole('button', { name: /Ressourcenkarte/ }).click();
  await sidebar.getByRole('button', { name: 'Formen schließen' }).click();
  const card = page.locator('[data-resource-icon-type]');
  await expect(card).toHaveCount(1);
  return card;
}

test('a resource card edits its icon, text and safe link bar as one accessible workflow', async ({ page }) => {
  const card = await insertResourceCard(page);
  const toolbar = page.getByRole('toolbar', { name: 'Eigenschaften' });
  const trigger = toolbar.getByRole('button', { name: 'Ressourcenkarte bearbeiten' });
  await trigger.click();
  const editor = page.getByTestId('resource-card-editor');
  await expect(editor.getByRole('textbox', { name: 'Name' })).toBeFocused();
  await editor.getByRole('textbox', { name: 'Name' }).fill('Azure Spring Apps');
  await editor.getByRole('textbox', { name: 'Beschreibung' }).fill('Spring App Hosting');
  await editor.getByRole('searchbox', { name: 'Icons durchsuchen' }).fill('Lambda');
  await editor.getByRole('button', { name: 'Icon AWS Lambda' }).click();

  await editor.getByRole('button', { name: 'Link hinzufügen' }).click();
  await editor.getByRole('textbox', { name: 'Link 1 Bezeichnung' }).fill('Documentation');
  await editor.getByRole('textbox', { name: 'Link 1 Adresse' }).fill('javascript:alert(1)');
  await editor.getByRole('button', { name: 'Speichern' }).click();
  await expect(editor.getByRole('alert')).toContainText('gültige HTTP- oder HTTPS-Adresse');
  await editor.getByRole('textbox', { name: 'Link 1 Adresse' }).fill('https://example.com/docs');
  await editor.getByRole('button', { name: 'Link hinzufügen' }).click();
  await editor.getByRole('textbox', { name: 'Link 2 Bezeichnung' }).fill('Pricing');
  await editor.getByRole('textbox', { name: 'Link 2 Adresse' }).fill('https://example.com/pricing');
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await editor.getByRole('button', { name: 'Speichern' }).click();

  await expect(card).toHaveAttribute('data-resource-icon-type', 'aws.compute.lambda');
  await expect(card.getByTestId('resource-card-content')).toContainText('Azure Spring Apps');
  await expect(card.getByTestId('resource-card-content')).toContainText('SPRING APP HOSTING');
  await expect(card.getByRole('link', { name: 'Documentation öffnen' })).toBeVisible();
  await expect(card.getByRole('link', { name: 'Pricing öffnen' })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);

  await page.evaluate(() => {
    (window as typeof window & { __resourceCardOpened?: string[] }).__resourceCardOpened = [];
    window.open = ((url?: string | URL) => {
      (window as typeof window & { __resourceCardOpened: string[] }).__resourceCardOpened.push(String(url));
      return null;
    }) as typeof window.open;
  });
  await card.getByRole('link', { name: 'Documentation öffnen' }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __resourceCardOpened?: string[] }).__resourceCardOpened)).toEqual(['https://example.com/docs']);

  await page.getByTestId('workspace-menu-button').click();
  await page.getByRole('menuitemcheckbox', { name: 'Code', exact: true }).click();
  const code = await page.getByTestId('diagram-code').inputValue();
  expect(code).toContain('Azure Spring Apps');
  expect(code).toContain('resource-card:link-order');
  expect(code).toContain('https://example.com/docs');
});

test('resource cards resize, copy at the pointer and restore editor focus on Escape', async ({ page }) => {
  const card = await insertResourceCard(page);
  const trigger = page.getByRole('toolbar', { name: 'Eigenschaften' }).getByRole('button', { name: 'Ressourcenkarte bearbeiten' });
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('resource-card-editor')).toHaveCount(0);
  await expect(trigger).toBeFocused();

  const handle = await page.locator('[data-handle=se]').boundingBox();
  await page.mouse.move(handle!.x + 5, handle!.y + 5); await page.mouse.down(); await page.mouse.move(handle!.x + 85, handle!.y + 45); await page.mouse.up();
  const resized = await card.boundingBox();
  expect(resized!.width).toBeGreaterThan(360);

  await page.keyboard.press('ControlOrMeta+c');
  await page.mouse.move(760, 540);
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.locator('[data-resource-icon-type]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(page.locator('[data-resource-icon-type]')).toHaveCount(1);
});

test('the name and description of a selected card are edited by clicking the text (#189)', async ({ page }) => {
  const card = await insertResourceCard(page);
  const title = card.getByTestId('resource-card-title');
  const description = card.getByTestId('resource-card-description');
  const editor = page.getByTestId('canvas-text-editor');
  const clickLine = async (line: typeof title) => { const box = (await line.boundingBox())!; await page.mouse.click(box.x + 12, box.y + box.height / 2); };

  // The inserted card is selected: a click on its name edits the name in place.
  const titleBox = (await title.boundingBox())!;
  await clickLine(title);
  await expect(editor).toBeFocused();
  await expect(editor).toHaveAccessibleName('Name der Ressourcenkarte');
  await expect(editor).toHaveValue('Ressourcenkarte');
  const editorBox = (await editor.boundingBox())!;
  expect(Math.abs(editorBox.x - titleBox.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(editorBox.y + editorBox.height / 2 - (titleBox.y + titleBox.height / 2))).toBeLessThanOrEqual(2);
  // Only the edited line is hidden; the rest of the card stays.
  await expect(title).toHaveCount(0);
  await expect(description).toBeVisible();
  await page.keyboard.type('Bestellservice');
  await page.keyboard.press('Enter');
  await expect(editor).toHaveCount(0);
  await expect(title).toHaveText('Bestellservice');

  await clickLine(description);
  await expect(editor).toHaveAccessibleName('Beschreibung der Ressourcenkarte');
  await page.keyboard.type('nimmt Bestellungen an');
  // A click beside the card takes the text over, like for every other text.
  await page.mouse.click(200, 650);
  await expect(editor).toHaveCount(0);
  await expect(description).toHaveText('NIMMT BESTELLUNGEN AN');

  // Each edit is one undo step.
  await page.getByTestId('whiteboard-canvas').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(description).toHaveText('BESCHREIBUNG');
  await expect(title).toHaveText('Bestellservice');

  // Unselected, the first click only selects; a double click edits at once.
  await page.mouse.click(200, 650);
  const box = (await title.boundingBox())!;
  await page.mouse.click(box.x + 12, box.y + box.height / 2);
  await expect(editor).toHaveCount(0);
  await page.mouse.click(200, 650);
  await page.mouse.dblclick(box.x + 12, box.y + box.height / 2);
  await expect(editor).toHaveValue('Bestellservice');
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
});

test('resource card text is black by default and takes the text colour of the selection bar (#189)', async ({ page }) => {
  const card = await insertResourceCard(page);
  const title = card.getByTestId('resource-card-title');
  const description = card.getByTestId('resource-card-description');
  // Black, not the frame colour, and the description is not faded.
  await expect(title).toHaveAttribute('fill', '#1e1e1e');
  await expect(description).toHaveAttribute('fill', '#1e1e1e');
  expect(await description.getAttribute('fill-opacity')).toBeNull();
  expect(await card.getByTestId('resource-card-surface').evaluate((node) => getComputedStyle(node).stroke)).not.toBe('rgb(30, 30, 30)');

  const toolbar = page.getByRole('toolbar', { name: 'Eigenschaften' });
  await toolbar.getByRole('button', { name: 'Schriftfarbe' }).click();
  await page.getByRole('group', { name: 'Schriftfarbe' }).getByRole('button', { name: 'Schrift Rot' }).click();
  const red = await title.getAttribute('fill');
  expect(red).not.toBe('#1e1e1e');
  await expect(description).toHaveAttribute('fill', red!);
  // The frame keeps its colour.
  expect(await card.getByTestId('resource-card-surface').evaluate((node) => getComputedStyle(node).stroke)).not.toBe(await title.evaluate((node) => getComputedStyle(node).fill));
});

test('the resource card dialog is modal, follows the layout of the design and returns the focus (#190)', async ({ page }) => {
  await insertResourceCard(page);
  const trigger = page.getByRole('toolbar', { name: 'Eigenschaften' }).getByRole('button', { name: 'Ressourcenkarte bearbeiten' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Ressourcenkarte' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription('Inhalt und Verweise bearbeiten');
  expect(await dialog.evaluate((node) => (node as HTMLDialogElement).matches(':modal'))).toBe(true);
  await expect(dialog.getByRole('textbox', { name: 'Name' })).toBeFocused();

  // Header, the two text fields, the icon section and the links follow each other from top to bottom; the footer stays in view.
  const top = async (locator: import('@playwright/test').Locator) => (await locator.boundingBox())!.y;
  const order = [
    await top(dialog.getByRole('heading', { name: 'Ressourcenkarte' })),
    await top(dialog.getByRole('textbox', { name: 'Name' })),
    await top(dialog.getByRole('textbox', { name: 'Beschreibung' })),
    await top(dialog.getByRole('heading', { name: 'Icon' })),
    await top(dialog.getByRole('searchbox', { name: 'Icons durchsuchen' })),
    await top(dialog.getByRole('group', { name: 'Icon auswählen' })),
    await top(dialog.getByRole('heading', { name: 'Links' })),
  ];
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  await expect(dialog.getByRole('button', { name: 'Abbrechen' })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: 'Änderungen speichern' })).toBeInViewport();
  // Six tiles per row; the chosen one is marked.
  const tiles = dialog.getByRole('group', { name: 'Icon auswählen' }).getByRole('button');
  const firstRowY = (await tiles.nth(0).boundingBox())!.y;
  expect((await tiles.nth(5).boundingBox())!.y).toBe(firstRowY);
  expect((await tiles.nth(6).boundingBox())!.y).toBeGreaterThan(firstRowY);
  await expect(tiles.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(tiles.nth(0)).toHaveAccessibleName('Icon Service');
  await expect(tiles.nth(1)).toHaveAttribute('aria-pressed', 'false');

  // Typing in the dialog never reaches the workspace shortcuts, and Tab stays inside.
  await dialog.getByRole('textbox', { name: 'Name' }).fill('r');
  await expect(page.locator('.whiteboard-canvas [data-kind]')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Änderungen speichern' }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Dialog schließen' })).toBeFocused();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);

  await dialog.getByRole('button', { name: 'Dialog schließen' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  // Nothing was saved.
  await expect(page.getByTestId('resource-card-title')).toHaveText('Ressourcenkarte');
});

test('an icon from a provider library is saved with its set, and links are reordered by their grip (#190)', async ({ page }) => {
  const card = await insertResourceCard(page);
  await page.getByRole('toolbar', { name: 'Eigenschaften' }).getByRole('button', { name: 'Ressourcenkarte bearbeiten' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ressourcenkarte' });

  await dialog.getByRole('combobox', { name: 'Icon-Bibliothek' }).click();
  await page.getByRole('option', { name: 'Azure' }).click();
  await dialog.getByRole('searchbox', { name: 'Icons durchsuchen' }).fill('Bot Services');
  const icon = dialog.getByRole('button', { name: 'Icon Bot Services', exact: true });
  await icon.click();
  await expect(icon).toHaveAttribute('aria-pressed', 'true');

  for (const [index, label] of ['Docs', 'Blog', 'Preise'].entries()) {
    await dialog.getByRole('button', { name: 'Link hinzufügen' }).click();
    await expect(dialog.getByRole('textbox', { name: `Link ${index + 1} Bezeichnung` })).toBeFocused();
    await dialog.getByRole('textbox', { name: `Link ${index + 1} Bezeichnung` }).fill(label);
    await dialog.getByRole('textbox', { name: `Link ${index + 1} Adresse` }).fill(`https://example.com/${label.toLowerCase()}`);
  }
  // The grip moves its row with the arrow keys and keeps the focus.
  await dialog.getByRole('button', { name: 'Link 3 verschieben' }).press('ArrowUp');
  await expect(dialog.getByRole('button', { name: 'Link 2 verschieben' })).toBeFocused();
  await expect(dialog.getByRole('textbox', { name: 'Link 2 Bezeichnung' })).toHaveValue('Preise');
  await expect(dialog.getByRole('status')).toHaveText('Link an Position 2 von 3 verschoben.');
  await dialog.getByRole('button', { name: 'Link 2 verschieben' }).press('ArrowUp');
  await expect(dialog.getByRole('textbox', { name: 'Link 1 Bezeichnung' })).toHaveValue('Preise');
  await dialog.getByRole('button', { name: 'Link 3 entfernen' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Link 3 Bezeichnung' })).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Änderungen speichern' }).click();
  await expect(dialog).toHaveCount(0);
  const type = await card.getAttribute('data-resource-icon-type');
  expect(type).toMatch(/^azure\./);
  // The icon is drawn: its set came into the document with the same change.
  await expect(card.locator('svg svg').first()).toBeVisible();
  const links = card.getByRole('link');
  await expect(links).toHaveCount(2);
  await expect(links.nth(0)).toHaveAccessibleName('Preise öffnen');
  await expect(links.nth(1)).toHaveAccessibleName('Docs öffnen');

  // One undo step takes the whole dialog back.
  await page.getByTestId('whiteboard-canvas').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(card).toHaveAttribute('data-resource-icon-type', 'generic.service');
  await expect(card.getByRole('link')).toHaveCount(0);
});

test('the resource card dialog fits a small window, the dark theme and English (#190)', async ({ page }) => {
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('sketchdraw.preferences.v1') ?? '{}');
    localStorage.setItem('sketchdraw.preferences.v1', JSON.stringify({ ...raw, version: raw.version ?? 1, theme: 'dark', language: 'en' }));
  });
  await page.setViewportSize({ width: 420, height: 640 });
  await page.reload();
  await page.getByTestId('more-shapes').click();
  const sidebar = page.getByTestId('shape-library-sidebar');
  await sidebar.getByRole('searchbox').fill('Resource card');
  await sidebar.getByRole('button', { name: /Ressourcenkarte/ }).click();
  await sidebar.getByRole('button', { name: 'Close shapes' }).click();
  await page.getByRole('button', { name: 'Edit resource card' }).click();
  const dialog = page.getByRole('dialog', { name: 'Resource card' });
  await expect(dialog).toBeVisible();
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(420);
  expect(box.y + box.height).toBeLessThanOrEqual(640);
  await expect(dialog.getByRole('button', { name: 'Save changes' })).toBeInViewport();
  await dialog.getByRole('button', { name: 'Add link' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Link 1 address' })).toBeVisible();
  // Dark panel, light text.
  const colours = await dialog.evaluate((node) => { const style = getComputedStyle(node); return { background: style.backgroundColor, text: style.color }; });
  const sum = (value: string) => value.match(/\d+/g)!.slice(0, 3).map(Number).reduce((a, b) => a + b, 0);
  expect(sum(colours.background)).toBeLessThan(200);
  expect(sum(colours.text)).toBeGreaterThan(500);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
});

test('name and description take several lines and the card grows and shrinks with them (#254)', async ({ page }) => {
  const card = await insertResourceCard(page);
  const surface = card.getByTestId('resource-card-surface');
  const title = card.getByTestId('resource-card-title');
  const description = card.getByTestId('resource-card-description');
  const footer = card.getByTestId('resource-card-footer');
  const height = async () => Number(await surface.getAttribute('height'));
  const start = await height();
  const editor = page.getByTestId('canvas-text-editor');

  // Shift+Enter starts a new line in the description; the card grows while it is typed.
  const descriptionBox = (await description.boundingBox())!;
  await page.mouse.click(descriptionBox.x + 6, descriptionBox.y + descriptionBox.height / 2);
  await expect(editor).toHaveAttribute('data-field', 'description');
  await editor.fill('');
  await page.keyboard.type('Entry point for all traffic');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('open for the internet');
  await expect(editor).toHaveValue('Entry point for all traffic\nopen for the internet');
  await expect.poll(height).toBeGreaterThan(start + 15);
  // The field covers both lines and stays inside the card, above the footer.
  const field = (await editor.boundingBox())!;
  const bar = (await footer.boundingBox())!;
  expect(field.height).toBeGreaterThan(30);
  expect(field.y + field.height).toBeLessThanOrEqual(bar.y + 1);
  await page.keyboard.press('Alt+Enter');
  await page.keyboard.type('to consume the service');
  await page.keyboard.press('Enter');
  await expect(editor).toHaveCount(0);

  // Three lines are drawn one below the other, and the card is two lines taller than before.
  await expect(description.locator('tspan')).toHaveText(['ENTRY POINT FOR ALL TRAFFIC', 'OPEN FOR THE INTERNET', 'TO CONSUME THE SERVICE']);
  const rows = await description.locator('tspan').evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute('y'))));
  expect(rows[1]! - rows[0]!).toBeCloseTo(18.2, 1);
  expect(rows[2]! - rows[1]!).toBeCloseTo(18.2, 1);
  expect(await height()).toBeCloseTo(start + 36.4, 1);
  const last = (await description.locator('tspan').last().boundingBox())!;
  expect(last.y + last.height).toBeLessThanOrEqual((await footer.boundingBox())!.y + 1);

  // The name takes a second line as well and pushes the description down.
  const before = rows[0]!;
  const titleBox = (await title.boundingBox())!;
  await page.mouse.click(titleBox.x + 6, titleBox.y + titleBox.height / 2);
  await expect(editor).toHaveAttribute('data-field', 'title');
  await editor.press('End');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('OpenAI');
  await page.keyboard.press('Enter');
  await expect(title.locator('tspan')).toHaveCount(2);
  await expect(title.locator('tspan').last()).toHaveText('OpenAI');
  expect(await height()).toBeCloseTo(start + 36.4 + 25, 1);
  const moved = Number(await description.locator('tspan').first().getAttribute('y'));
  expect(moved - before).toBeCloseTo(25, 1);

  // One line again: the card goes back to the height it had.
  const again = (await description.boundingBox())!;
  await page.mouse.click(again.x + 6, again.y + 6);
  await editor.fill('Entry point');
  await page.keyboard.press('Enter');
  await expect(description.locator('tspan')).toHaveText(['ENTRY POINT']);
  expect(await height()).toBeCloseTo(start + 25, 1);
  // Undo brings the three lines and their height back in one step.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(description.locator('tspan')).toHaveCount(3);
  expect(await height()).toBeCloseTo(start + 36.4 + 25, 1);
});

test('the dialog keeps the lines of name and description (#254)', async ({ page }) => {
  const card = await insertResourceCard(page);
  await page.getByRole('toolbar', { name: 'Eigenschaften' }).getByRole('button', { name: 'Ressourcenkarte bearbeiten' }).click();
  const editor = page.getByTestId('resource-card-editor');
  await editor.getByRole('textbox', { name: 'Name' }).fill('Azure\nOpenAI');
  await editor.getByRole('textbox', { name: 'Beschreibung' }).fill('Entry point\nfor the mesh');
  await editor.getByRole('button', { name: 'Speichern' }).click();
  await expect(editor).toHaveCount(0);
  await expect(card.getByTestId('resource-card-title').locator('tspan')).toHaveText(['Azure', 'OpenAI']);
  await expect(card.getByTestId('resource-card-description').locator('tspan')).toHaveText(['ENTRY POINT', 'FOR THE MESH']);
  // Opened again, the fields show the lines as they were entered.
  await page.getByRole('toolbar', { name: 'Eigenschaften' }).getByRole('button', { name: 'Ressourcenkarte bearbeiten' }).click();
  await expect(editor.getByRole('textbox', { name: 'Name' })).toHaveValue('Azure\nOpenAI');
  await expect(editor.getByRole('textbox', { name: 'Beschreibung' })).toHaveValue('Entry point\nfor the mesh');
});

test('the section "Cards" offers the card with a dashed frame and a bar of links in the frame colour (#257)', async ({ page }) => {
  await page.getByTestId('more-shapes').click();
  const sidebar = page.getByTestId('shape-library-sidebar');
  await sidebar.getByRole('button', { name: 'Cards', exact: true }).click();
  await expect(sidebar.getByTestId('resource-card-tile-solid')).toBeVisible();
  await sidebar.getByTestId('resource-card-tile-dashed').click();
  await sidebar.getByRole('button', { name: 'Formen schließen' }).click();
  const card = page.locator('[data-resource-icon-type]');
  await expect(card).toHaveCount(1);
  const surface = card.getByTestId('resource-card-surface');
  const footer = card.getByTestId('resource-card-footer');

  // A dashed frame, and a bar set in from it, filled with the colour of the frame.
  const frame = await surface.evaluate((node) => { const style = getComputedStyle(node); return { dash: style.strokeDasharray, stroke: style.stroke }; });
  expect(frame.dash).not.toBe('none');
  expect(frame.stroke).toBe('rgb(159, 184, 189)');
  expect(await footer.evaluate((node) => node.tagName.toLowerCase())).toBe('rect');
  expect(await footer.evaluate((node) => getComputedStyle(node).fill)).toBe(frame.stroke);
  expect(await footer.evaluate((node) => getComputedStyle(node).strokeDasharray === 'none' || getComputedStyle(node).stroke === 'none')).toBe(true);
  const outer = (await surface.boundingBox())!;
  const bar = (await footer.boundingBox())!;
  expect(bar.x - outer.x).toBeGreaterThanOrEqual(8);
  expect(outer.x + outer.width - (bar.x + bar.width)).toBeGreaterThanOrEqual(8);
  expect(outer.y + outer.height - (bar.y + bar.height)).toBeGreaterThanOrEqual(8);
  // The description is written as typed, not in capitals.
  await expect(card.getByTestId('resource-card-description')).toHaveText('Beschreibung');

  // Links stand in the bar, left-aligned, in the colour of the card's text.
  const toolbar = page.getByRole('toolbar', { name: 'Eigenschaften' });
  await toolbar.getByRole('button', { name: 'Ressourcenkarte bearbeiten' }).click();
  const editor = page.getByTestId('resource-card-editor');
  await expect(editor.getByRole('combobox', { name: 'Darstellung' })).toContainText('Gestrichelt mit Link-Leiste');
  await editor.getByRole('textbox', { name: 'Beschreibung' }).fill('Entry point for all mesh traffic\nand open for the internet');
  await editor.getByRole('button', { name: 'Link hinzufügen' }).click();
  await editor.getByRole('textbox', { name: 'Link 1 Bezeichnung' }).fill('LLM');
  await editor.getByRole('textbox', { name: 'Link 1 Adresse' }).fill('https://example.com/llm');
  await editor.getByRole('button', { name: 'Speichern' }).click();
  await expect(editor).toHaveCount(0);
  const link = card.getByTestId('resource-card-link-0');
  await expect(link).toHaveText('LLM');
  const label = (await link.locator('text').boundingBox())!;
  const barNow = (await footer.boundingBox())!;
  expect(label.x - barNow.x).toBeLessThan(24);
  expect(label.y).toBeGreaterThanOrEqual(barNow.y);
  expect(label.y + label.height).toBeLessThanOrEqual(barNow.y + barNow.height);
  expect(await link.locator('text').evaluate((node) => getComputedStyle(node).fill)).toBe(await card.getByTestId('resource-card-title').evaluate((node) => getComputedStyle(node).fill));
  await expect(card.getByTestId('resource-card-description').locator('tspan')).toHaveText(['Entry point for all mesh traffic', 'and open for the internet']);
  await page.screenshot({ path: '/tmp/shots/card-dashed.png', clip: { x: Math.max(0, outer.x - 30), y: Math.max(0, outer.y - 30), width: outer.width + 60, height: outer.height + 90 } });

  // The dialog switches an existing card to the classic look and back.
  await toolbar.getByRole('button', { name: 'Ressourcenkarte bearbeiten' }).click();
  await editor.getByRole('combobox', { name: 'Darstellung' }).click();
  await page.getByRole('option', { name: 'Standard', exact: true }).click();
  await editor.getByRole('button', { name: 'Speichern' }).click();
  await expect(editor).toHaveCount(0);
  expect(await footer.evaluate((node) => node.tagName.toLowerCase())).toBe('path');
  expect(await surface.evaluate((node) => getComputedStyle(node).strokeDasharray)).toBe('none');
  await expect(card.getByTestId('resource-card-description').locator('tspan').first()).toHaveText('ENTRY POINT FOR ALL MESH TRAFFIC');
  expect((await new AxeBuilder({ page }).include('[data-testid="whiteboard-canvas"]').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
});
