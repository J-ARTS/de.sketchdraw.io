import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => { throw error; });
  await page.goto('/');
});

test('the Lucide library lists its icons by category, finds them by search word and places them as figures (#227)', async ({ page }) => {
  await page.getByTestId('more-shapes').click();
  const library = page.getByTestId('shape-library-sidebar');
  const row = library.getByTestId('open-lucide-library');
  await expect(row).toContainText('Lucide Icons');
  await expect(row).toContainText(/\d{4} Symbole/);
  await row.click();
  await expect(library.getByRole('heading', { name: 'Lucide Icons' })).toBeVisible();
  // Categories of Lucide; the first one is open, the others open on demand.
  const category = (name: string) => library.locator('.category-toggle').filter({ hasText: name });
  await expect(category('Accessibility')).toHaveAttribute('aria-expanded', 'true');
  await expect(category('Arrows')).toHaveAttribute('aria-expanded', 'false');
  expect(await library.locator('.category-toggle').count()).toBeGreaterThan(30);
  await category('Arrows').click();
  await expect(library.getByRole('button', { name: 'Chevron Down', exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).include('[data-testid="shape-library-sidebar"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);

  // A search word of Lucide ("pulse" for the activity icon) and a name both find icons.
  await library.getByRole('searchbox').fill('pulse');
  await expect(library.getByRole('button', { name: 'Activity', exact: true })).toBeVisible();
  await library.getByRole('searchbox').fill('chevron-down');
  await expect(library.getByRole('button', { name: 'Chevron Down', exact: true })).toBeVisible();
  await library.getByRole('searchbox').fill('zzzz');
  await expect(library).toContainText('Keine passenden Symbole gefunden.');
  // A word that matches very many icons is cut off with a note.
  await library.getByRole('searchbox').fill('a');
  await expect(library.locator('.component-tile')).toHaveCount(300);
  await expect(library).toContainText('Die ersten 300 Treffer werden gezeigt.');

  await library.getByRole('searchbox').fill('database');
  await library.getByRole('button', { name: 'Database', exact: true }).click();
  const figure = page.locator('.whiteboard-canvas [data-kind="component"]').first();
  await expect(figure.getByTestId('icon-figure')).toBeVisible();
  await expect(figure).toContainText('Database');
  // No card around the icon, and the lines take the colour of the element.
  await expect(figure.getByTestId('icon-figure-surface')).toHaveAttribute('fill', 'transparent');
  const colour = await figure.getByTestId('icon-figure').locator('path').first().evaluate((node) => getComputedStyle(node).stroke);
  expect(colour).toBe('rgb(30, 41, 59)');

  // The document carries the category of the icon it uses, nothing else of the library.
  const download = page.waitForEvent('download');
  await page.getByTestId('file-menu-button').click(); await page.getByTestId('file-menu-save').click();
  const saved = JSON.parse(await readFile((await (await download).path())!, 'utf8')) as { componentSets: { id: string; components: unknown[] }[]; elements: { componentType?: string }[] };
  expect(saved.elements[0]!.componentType).toBe('generic.lucide.database');
  expect(saved.componentSets.map((set) => set.id)).toEqual(['sketchdraw.lucide.devices']);
});

test('a Lucide icon stays readable in the dark theme and is found by the general search', async ({ page }) => {
  await page.getByTestId('more-shapes').click();
  const library = page.getByTestId('shape-library-sidebar');
  // The search across everything finds Lucide icons too and says where they come from.
  await library.getByRole('searchbox').fill('rocket');
  const tile = library.locator('.component-tile').filter({ hasText: 'LUCIDE' }).first();
  await expect(tile).toContainText('Rocket');
  await tile.click();
  const figure = page.locator('.whiteboard-canvas [data-kind="component"]').first();
  await expect(figure.getByTestId('icon-figure')).toBeVisible();
  const stroke = () => figure.getByTestId('icon-figure').locator('path').first().evaluate((node) => getComputedStyle(node).stroke);
  const light = await stroke();
  await page.getByTestId('workspace-menu-button').click();
  await page.getByRole('menuitem', { name: 'Einstellungen', exact: true }).click();
  await page.getByRole('radio', { name: 'Dunkel' }).click();
  await page.getByRole('button', { name: 'Fertig', exact: true }).click();
  await expect.poll(stroke).not.toBe(light);
  // Light lines on the dark canvas.
  const [r, g, b] = (await stroke()).match(/\d+/g)!.map(Number);
  expect(r! + g! + b!).toBeGreaterThan(450);
});
