import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Page UI (#35) against the single-page fallback; multi-page flows follow once #34 lands.
const pending = 'Mehrere Seiten sind verfügbar, sobald das Dokumentformat v2 umgesetzt ist.';

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

test('context menu opens from the more button, right click and keyboard and explains pending actions', async ({ page }) => {
  await openPages(page);
  await page.getByRole('button', { name: 'Aktionen für Seite 1' }).click();
  const menu = page.getByRole('menu', { name: 'Seitenaktionen' });
  await expect(menu.getByRole('menuitem')).toHaveText(['Inhalt kopieren', 'Umbenennen', 'Duplizieren', 'Nach oben', 'Nach unten', 'Seite löschen']);
  await expect(menu.getByRole('menuitem', { name: 'Inhalt kopieren' })).toBeFocused();
  await expect(menu.getByRole('menuitem', { name: 'Seite löschen' })).toHaveAttribute('aria-disabled', 'true');
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.keyboard.press('ArrowDown'); await expect(menu.getByRole('menuitem', { name: 'Umbenennen' })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Aktionen für Seite 1' })).toBeFocused();

  await page.getByRole('button', { name: /^Seite 1/ }).press('Shift+F10'); await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Seite 1/ }).click({ button: 'right' });
  await expect(menu).toBeVisible();
  // aria-disabled entries stay focusable and explain why they are unavailable.
  await menu.getByRole('menuitem', { name: 'Duplizieren' }).press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Meldungen' })).toContainText(pending);
});

test('double click on a page name and page creation explain the missing multi-page schema', async ({ page }) => {
  await openPages(page);
  await page.getByRole('button', { name: /^Seite 1/ }).dblclick();
  await expect(page.getByRole('textbox', { name: 'Seitenname' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Meldungen' })).toContainText(pending);
  await expect(page.getByTestId('page-add')).toHaveAttribute('aria-disabled', 'true');
  await page.getByTestId('page-add').press('Enter');
  await expect(page.getByRole('list', { name: 'Seitenliste' }).getByRole('listitem')).toHaveCount(1);
});

test('copying a page puts its content on the clipboard as sketchdraw.page', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
  await page.mouse.move(350, 220); await page.mouse.down(); await page.mouse.move(550, 360, { steps: 8 }); await page.mouse.up();
  await expect(page.locator('[data-kind=rectangle]')).toHaveCount(1);
  await openPages(page);
  await expect(page.getByRole('button', { name: /^Seite 1/ })).toContainText('1 Elemente');
  await page.getByRole('button', { name: 'Aktionen für Seite 1' }).click();
  await page.getByRole('menuitem', { name: 'Inhalt kopieren' }).click();
  await expect(page.getByRole('region', { name: 'Meldungen' })).toContainText('Inhalt von „Seite 1“ kopiert.');
  const payload = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(payload).toMatchObject({ format: 'sketchdraw.page', version: 1, name: 'Seite 1', assets: {} });
  expect(payload.elements).toHaveLength(1); expect(payload.elements[0].kind).toBe('rectangle');
});
