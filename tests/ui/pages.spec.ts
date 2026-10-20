import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function expectNoNotice(page: Page) {
  await expect(page.getByRole('button', { name: 'Meldung schließen' })).toHaveCount(0);
}

async function openPages(page: Page) {
  await page.getByTestId('page-switcher').click();
  await expect(page.getByRole('dialog', { name: 'Seiten' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
  await page.goto('/'); await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
});

test('page switcher shows the active page and the page list is keyboard reachable', async ({ page }) => {
  const trigger = page.getByTestId('page-switcher');
  await expect(trigger).toHaveAccessibleName('Seiten (1), aktuelle Seite: Seite 1');
  await openPages(page);
  const row = page.getByRole('button', { name: /^Seite 1/ });
  await expect(row).toHaveAttribute('aria-current', 'page'); await expect(row).toBeFocused();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Seiten' })).toHaveCount(0); await expect(trigger).toBeFocused();
});

test('context menu opens from the more button, right click and keyboard', async ({ page }) => {
  await openPages(page);
  await page.getByRole('button', { name: 'Aktionen für Seite 1' }).click();
  const menu = page.getByRole('menu', { name: 'Seitenaktionen' });
  await expect(menu.getByRole('menuitem')).toHaveText(['Inhalt kopieren', 'Umbenennen', 'Duplizieren', 'Nach oben', 'Nach unten', 'Seite löschen']);
  await expect(menu.getByRole('menuitem', { name: 'Inhalt kopieren' })).toBeFocused();
  await expect(menu.getByRole('menuitem', { name: 'Seite löschen' })).toHaveAttribute('aria-disabled', 'true');
  await expect(menu.getByRole('menuitem', { name: 'Umbenennen' })).not.toHaveAttribute('aria-disabled', 'true');
  await expect(menu.getByRole('menuitem', { name: 'Duplizieren' })).not.toHaveAttribute('aria-disabled', 'true');
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.keyboard.press('ArrowDown'); await expect(menu.getByRole('menuitem', { name: 'Umbenennen' })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Aktionen für Seite 1' })).toBeFocused();

  await page.getByRole('button', { name: /^Seite 1/ }).press('Shift+F10'); await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Seite 1/ }).click({ button: 'right' });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
});

test('double click and Enter rename the page in place without a technical hint', async ({ page }) => {
  await openPages(page);
  await page.getByRole('button', { name: /^Seite 1/ }).dblclick();
  const field = page.getByRole('textbox', { name: 'Seitenname' });
  await expect(field).toBeVisible();
  await expect(field).toHaveValue('Seite 1');
  await field.fill('Architektur');
  await field.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Seitenname' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Architektur/ })).toBeVisible();
  await expect(page.getByTestId('page-switcher')).toHaveAccessibleName('Seiten (1), aktuelle Seite: Architektur');
  // Renaming is a content edit, not a structural one: still a single page, no technical toast.
  await expect(page.getByRole('list', { name: 'Seitenliste' }).getByRole('listitem')).toHaveCount(1);
  await expectNoNotice(page);
});

test('F2 opens the rename field and Escape discards the draft', async ({ page }) => {
  await openPages(page);
  await page.getByRole('button', { name: /^Seite 1/ }).press('F2');
  const field = page.getByRole('textbox', { name: 'Seitenname' });
  await expect(field).toBeVisible();
  await field.fill('Verworfen');
  await field.press('Escape');
  await expect(page.getByRole('textbox', { name: 'Seitenname' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Seite 1/ })).toBeFocused();
  // An empty name is rejected too, leaving the original intact.
  await page.getByRole('button', { name: /^Seite 1/ }).press('F2');
  await page.getByRole('textbox', { name: 'Seitenname' }).fill('   ');
  await page.getByRole('textbox', { name: 'Seitenname' }).press('Enter');
  await expect(page.getByRole('button', { name: /^Seite 1/ })).toBeVisible();
  await expectNoNotice(page);
});

test('the plus button creates a persistent page and switching keeps page contents separate', async ({ page }) => {
  await openPages(page);
  const add = page.getByTestId('page-add');
  await expect(add).toHaveAttribute('title', 'Neue Seite');
  await add.click();
  await expect(page.getByRole('list', { name: 'Seitenliste' }).getByRole('listitem')).toHaveCount(2);
  await expect(page.getByRole('button', { name: /^Seite 2/ })).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
  await page.mouse.move(350, 220); await page.mouse.down(); await page.mouse.move(550, 360, { steps: 8 }); await page.mouse.up();
  await expect(page.locator('[data-kind=rectangle]')).toHaveCount(1);
  await openPages(page);
  await page.getByRole('button', { name: /^Seite 1/ }).click();
  await expect(page.locator('[data-kind=rectangle]')).toHaveCount(0);
  await page.getByRole('button', { name: /^Seite 2/ }).click();
  await expect(page.locator('[data-kind=rectangle]')).toHaveCount(1);
  await expectNoNotice(page);
});

test('copying a page puts its content on the clipboard as sketchdraw.page', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
  await page.mouse.move(350, 220); await page.mouse.down(); await page.mouse.move(550, 360, { steps: 8 }); await page.mouse.up();
  await expect(page.locator('[data-kind=rectangle]')).toHaveCount(1);
  await openPages(page);
  // The row shows the page name only; the element count is no longer surfaced.
  await expect(page.getByRole('button', { name: /^Seite 1/ })).not.toContainText('Elemente');
  await page.getByRole('button', { name: 'Aktionen für Seite 1' }).click();
  await page.getByRole('menuitem', { name: 'Inhalt kopieren' }).click();
  await expect(page.getByRole('region', { name: 'Meldungen' })).toContainText('Inhalt von „Seite 1“ kopiert.');
  const payload = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(payload).toMatchObject({ format: 'sketchdraw.page', version: 1, name: 'Seite 1', assets: {} });
  expect(payload.elements).toHaveLength(1); expect(payload.elements[0].kind).toBe('rectangle');
});

test('a copied page can be pasted as a new page and rejects foreign clipboard text', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
  await page.mouse.move(350, 220); await page.mouse.down(); await page.mouse.move(550, 360, { steps: 8 }); await page.mouse.up();
  await openPages(page);
  await page.getByRole('button', { name: 'Aktionen für Seite 1' }).click();
  await page.getByRole('menuitem', { name: 'Inhalt kopieren' }).click();
  await page.getByTestId('page-paste').click();
  await expect(page.getByTestId('page-switcher')).toHaveAccessibleName(/^Seiten \(2\)/);
  await expect(page.locator('[data-kind=rectangle]')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Meldungen' })).toContainText('eingefügt');
  await page.evaluate(() => navigator.clipboard.writeText('kein Seiteninhalt'));
  await page.getByTestId('page-paste').click();
  await expect(page.getByRole('region', { name: 'Meldungen' })).toContainText('keinen Seiteninhalt');
  await expect(page.getByTestId('page-switcher')).toHaveAccessibleName(/^Seiten \(2\)/);
});

async function ensurePages(page: Page) {
  if (!(await page.getByRole('dialog', { name: 'Seiten' }).isVisible())) await openPages(page);
}

test('pages can be duplicated, reordered by menu, keyboard and drag and drop, and deleted with undo', async ({ page }) => {
  await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
  await page.mouse.move(350, 220); await page.mouse.down(); await page.mouse.move(550, 360, { steps: 8 }); await page.mouse.up();
  const names = () => page.getByRole('list', { name: 'Seitenliste' }).locator('.page-name').allTextContents();

  // Duplicate: the copy is a new page with its own copy of the content.
  await ensurePages(page);
  await page.getByRole('button', { name: 'Aktionen für Seite 1', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Duplizieren' }).click();
  await expect.poll(names).toEqual(['Seite 1', 'Seite 1 Kopie']);
  await expect(page.getByTestId('page-switcher')).toHaveAccessibleName(/aktuelle Seite: Seite 1 Kopie$/);
  await expect(page.locator('[data-kind=rectangle]')).toHaveCount(1);
  const copyElementId = await page.locator('[data-kind=rectangle]').first().getAttribute('data-element-id');
  await ensurePages(page);
  await page.getByRole('button', { name: /^Seite 1$/ }).click();
  expect(await page.locator('[data-kind=rectangle]').first().getAttribute('data-element-id')).not.toBe(copyElementId);

  // Reorder through the menu, the keyboard and drag and drop.
  await ensurePages(page);
  await page.getByRole('button', { name: 'Aktionen für Seite 1', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Nach unten' }).click();
  await expect.poll(names).toEqual(['Seite 1 Kopie', 'Seite 1']);
  await page.getByRole('button', { name: /^Seite 1$/ }).focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect.poll(names).toEqual(['Seite 1', 'Seite 1 Kopie']);
  const rows = page.getByRole('list', { name: 'Seitenliste' }).locator('.page-row');
  await rows.nth(0).dragTo(rows.nth(1), { targetPosition: { x: 40, y: 30 } });
  await expect.poll(names).toEqual(['Seite 1 Kopie', 'Seite 1']);

  // Deleting a page removes its content; Undo brings page and content back in place.
  await page.getByRole('button', { name: 'Aktionen für Seite 1 Kopie', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Seite löschen' }).click();
  await expect.poll(names).toEqual(['Seite 1']);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await ensurePages(page);
  await expect.poll(names).toEqual(['Seite 1 Kopie', 'Seite 1']);
  await page.getByRole('button', { name: /^Seite 1 Kopie$/ }).click();
  await expect(page.locator('[data-kind=rectangle]')).toHaveCount(1);
});
