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
