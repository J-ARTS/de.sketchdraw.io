import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
  await page.goto('/');
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
});

test('a table supports cell editing, formatting, navigation and row or column controls', async ({ page }) => {
  await page.getByRole('button', { name: 'Tabelle', exact: true }).click();
  await page.mouse.click(280, 230);

  const table = page.locator('.whiteboard-canvas [data-kind="table"]').first();
  const overlay = page.getByTestId('table-overlay');
  const toolbar = page.getByRole('toolbar', { name: 'Eigenschaften' });
  await expect(table.getByTestId('table-surface')).toBeVisible();
  await expect(overlay).toBeVisible();
  await expect(overlay.getByRole('gridcell')).toHaveCount(9);
  await expect(toolbar.getByRole('button', { name: 'Fett' })).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Durchgestrichen' })).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Aufzählung' })).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Tabellenstruktur' })).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Schriftfarbe' })).toBeVisible();
  await expect(overlay.getByRole('gridcell').first()).toHaveCSS('border-top-style', 'solid');
  await expect(overlay.getByRole('gridcell').first()).not.toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');

  const addColumnBox = (await overlay.getByRole('button', { name: 'Spalte rechts hinzufügen' }).boundingBox())!;
  const addRowBox = (await overlay.getByRole('button', { name: 'Zeile unten hinzufügen' }).boundingBox())!;
  expect(addColumnBox.width).toBeCloseTo(addRowBox.height, 0);
  await expect(overlay.getByRole('group', { name: 'Spalten einfügen' }).getByRole('button')).toHaveCount(2);

  const firstCell = overlay.getByRole('button', { name: 'Zelle 1, 1' });
  await firstCell.dblclick();
  const editor = page.getByTestId('table-cell-editor');
  await editor.fill('Architecture');
  await editor.press('Tab');
  await expect(editor).toBeFocused();
  await editor.fill('Owner');
  await editor.press('ControlOrMeta+Enter');
  await expect(overlay.getByRole('button', { name: 'Zelle 1, 1' })).toContainText('Architecture');
  await expect(overlay.getByRole('button', { name: 'Zelle 1, 2' })).toContainText('Owner');

  await overlay.getByRole('button', { name: 'Zelle 1, 1' }).click();
  await toolbar.getByRole('button', { name: 'Fett' }).click();
  await expect(overlay.getByRole('gridcell').first()).toHaveCSS('font-weight', '700');
  await toolbar.getByRole('button', { name: 'Schriftfarbe' }).click();
  await page.getByRole('group', { name: 'Schriftfarbe' }).getByRole('button', { name: 'Schrift Rot' }).click();
  await expect(overlay.getByRole('gridcell').first()).toHaveCSS('color', 'rgb(229, 83, 58)');
  await page.keyboard.press('Escape');

  const beforeMove = (await overlay.boundingBox())!;
  const moveHandle = overlay.getByRole('button', { name: 'Tabelle verschieben' });
  const moveBox = (await moveHandle.boundingBox())!;
  await page.mouse.move(moveBox.x + moveBox.width / 2, moveBox.y + moveBox.height / 2);
  await page.mouse.down(); await page.mouse.move(moveBox.x + moveBox.width / 2 + 36, moveBox.y + moveBox.height / 2 + 24); await page.mouse.up();
  await expect.poll(async () => (await overlay.boundingBox())?.x).toBeGreaterThan(beforeMove.x + 25);

  const beforeResize = (await overlay.boundingBox())!;
  const resizeHandle = overlay.getByRole('button', { name: 'Tabelle an Ecke se skalieren' });
  const resizeBox = (await resizeHandle.boundingBox())!;
  await page.mouse.move(resizeBox.x + 7, resizeBox.y + 7); await page.mouse.down(); await page.mouse.move(resizeBox.x + 47, resizeBox.y + 31); await page.mouse.up();
  await expect.poll(async () => (await overlay.boundingBox())?.width).toBeGreaterThan(beforeResize.width + 25);

  await overlay.getByRole('button', { name: 'Spalte zwischen 1 und 2 hinzufügen' }).click();
  await expect(overlay.getByRole('gridcell')).toHaveCount(12);
  await overlay.getByRole('button', { name: 'Spalte rechts hinzufügen' }).click();
  await expect(overlay.getByRole('gridcell')).toHaveCount(15);
  await overlay.getByRole('button', { name: 'Zeile unten hinzufügen' }).click();
  await expect(overlay.getByRole('gridcell')).toHaveCount(20);

  await toolbar.getByRole('button', { name: 'Tabellenstruktur' }).click();
  await expect(page.getByRole('group', { name: 'Zeilen und Spalten bearbeiten' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zeile oberhalb einfügen' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Spalte löschen' })).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(accessibility.violations).toEqual([]);
});

test('Shift+T activates the table tool', async ({ page }) => {
  await page.getByTestId('whiteboard-canvas').press('Shift+T');
  await page.mouse.click(300, 220);
  await expect(page.locator('.whiteboard-canvas [data-kind="table"]')).toHaveCount(1);
});

test('Delete and Backspace remove selected table rows or columns before the table element', async ({ page }) => {
  await page.getByRole('button', { name: 'Tabelle', exact: true }).click();
  await page.mouse.click(280, 230);

  const table = page.locator('.whiteboard-canvas [data-kind="table"]');
  const overlay = page.getByTestId('table-overlay');
  await expect(overlay.getByRole('gridcell')).toHaveCount(9);

  await overlay.getByRole('button', { name: 'Zeile 2 auswählen' }).click();
  await page.keyboard.press('Delete');
  await expect(table).toHaveCount(1);
  await expect(overlay.getByRole('gridcell')).toHaveCount(6);

  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(overlay.getByRole('gridcell')).toHaveCount(9);

  await overlay.getByRole('button', { name: 'Spalte 2 auswählen' }).click();
  await page.keyboard.press('Backspace');
  await expect(table).toHaveCount(1);
  await expect(overlay.getByRole('gridcell')).toHaveCount(6);

  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(overlay.getByRole('gridcell')).toHaveCount(9);

  await overlay.getByRole('button', { name: 'Zelle 1, 1' }).click();
  await page.getByTestId('whiteboard-canvas').focus();
  await page.keyboard.press('Delete');
  await expect(table).toHaveCount(0);
});
