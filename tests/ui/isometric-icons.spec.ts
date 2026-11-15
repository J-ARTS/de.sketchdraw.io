import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function openSettings(page: Page) {
  await page.getByTestId('workspace-menu-button').click();
  await page.getByRole('menu', { name: 'Arbeitsbereich' }).getByRole('menuitem', { name: 'Einstellungen' }).click();
  return page.getByRole('dialog', { name: 'Einstellungen' });
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => { throw error; });
  await page.goto('/');
});

test('the isometric library offers its symbols by category and places them as free-standing figures (#212)', async ({ page }) => {
  await page.getByTestId('more-shapes').click();
  const library = page.getByTestId('shape-library-sidebar');
  // The symbols are a library of their own; the short list of generic components stays short.
  await library.getByRole('button', { name: 'Architektur' }).click();
  await expect(library.getByRole('button', { name: 'Message Queue', exact: true })).toHaveCount(0);
  await library.getByTestId('open-isometric-library').click();
  await expect(library.getByRole('heading', { name: 'Isometrische Icons' })).toBeVisible();
  for (const category of ['Dienste und Daten', 'Rechnen und Netz', 'Clients und Umgebung']) await expect(library.getByRole('button', { name: new RegExp(category) })).toHaveAttribute('aria-expanded', 'true');
  expect(await library.locator('.component-tile').count()).toBeGreaterThanOrEqual(25);
  expect((await new AxeBuilder({ page }).include('[data-testid="shape-library-sidebar"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);

  // German and English words find a symbol.
  await library.getByRole('searchbox').fill('datenbank');
  await expect(library.locator('.component-tile')).toHaveCount(1);
  await library.getByRole('button', { name: 'Database', exact: true }).click();
  await library.getByRole('searchbox').fill('');

  const canvas = page.locator('.whiteboard-canvas');
  const element = canvas.locator('[data-kind="component"]');
  await expect(element).toHaveCount(1);
  // No card around it: the symbol fills the box and the label stands below.
  await expect(element.locator('[data-testid="cloud-component-surface"]')).toHaveCount(0);
  const symbol = await element.getByTestId('icon-figure').boundingBox();
  const label = await element.locator('text').boundingBox();
  await expect(element.locator('text')).toHaveText('Database');
  expect(Math.max(symbol!.width, symbol!.height)).toBeGreaterThan(85);
  expect(symbol!.y + symbol!.height).toBeLessThanOrEqual(label!.y + 1);
  expect(Math.abs(symbol!.x + symbol!.width / 2 - (label!.x + label!.width / 2))).toBeLessThan(2);

  // A long name wraps at the word, and dragging places a symbol where it is dropped.
  await library.getByRole('button', { name: 'Message Queue', exact: true }).dragTo(canvas, { targetPosition: { x: 260, y: 520 } });
  await expect(element).toHaveCount(2);
  await expect(element.last().locator('text')).toHaveText('Message Queue');
  await expect(element.last().locator('tspan')).toHaveCount(1);

  // The label is edited where it stands, and one undo removes a placed symbol.
  const box = await element.last().boundingBox();
  await page.mouse.dblclick(box!.x + box!.width / 2, box!.y + 40);
  const editor = page.getByTestId('canvas-text-editor');
  await expect(editor).toBeVisible();
  const editorBox = await editor.boundingBox();
  expect(editorBox!.y).toBeGreaterThan(box!.y + box!.height / 2);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Warteschlange');
  await page.keyboard.press('Escape');
  await expect(element.last().locator('text')).toHaveText('Warteschlange');
});

test('isometric symbols keep their colours and get a readable label in the dark theme (#212)', async ({ page }) => {
  await page.getByTestId('more-shapes').click();
  const library = page.getByTestId('shape-library-sidebar');
  await library.getByTestId('open-isometric-library').click();
  await library.getByRole('button', { name: 'App Server', exact: true }).click();
  await library.getByRole('button', { name: 'Instance', exact: true }).dragTo(page.locator('.whiteboard-canvas'), { targetPosition: { x: 260, y: 520 } });
  const element = page.locator('.whiteboard-canvas [data-kind="component"]');
  const lightness = (): Promise<number> => element.first().locator('text').evaluate((node) => {
    const [r, g, b] = getComputedStyle(node).fill.match(/\d+/g)!.map(Number);
    return (r! + g! + b!) / 3;
  });
  expect(await lightness()).toBeLessThan(110);

  const dialog = await openSettings(page);
  await dialog.getByRole('radio', { name: 'Dunkel' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await dialog.getByRole('button', { name: 'Fertig' }).click();
  expect(await lightness()).toBeGreaterThan(150);
  // The symbols are drawn in their own colours in both themes.
  await expect(element.first().locator('[data-testid="icon-figure"] polygon').first()).toHaveAttribute('fill', /^url\(#iso-server-stack-/);
  await expect(element.last().locator('[data-testid="icon-figure"] polygon').first()).toHaveAttribute('stroke', '#e8833a');
});
