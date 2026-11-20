import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const STORAGE_KEY = 'sketchdraw.custom-components.v1';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => { throw error; });
  await page.goto('/');
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.reload();
});

async function draw(page: Page, tool: string, x: number, y: number, width = 150, height = 90): Promise<void> {
  await page.getByRole('button', { name: tool, exact: true }).click();
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + width, y + height, { steps: 5 }); await page.mouse.up();
}
/** Two shapes on the canvas, both selected. */
async function selectTwoShapes(page: Page): Promise<void> {
  await draw(page, 'Rechteck', 220, 260);
  await draw(page, 'Ellipse', 460, 250, 120, 110);
  await page.getByTestId('whiteboard-canvas').focus();
  await page.keyboard.press('ControlOrMeta+a');
}
async function saveSelection(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Elementaktionen' }).click();
  await page.getByRole('button', { name: 'Als Komponente speichern' }).click();
}

test('the selection becomes an own component: saved from the more menu, named in place, kept across a restart', async ({ page }) => {
  await selectTwoShapes(page);
  await saveSelection(page);

  // The library opens on the own tab, and the suggested name is ready to be replaced.
  const library = page.getByTestId('shape-library-sidebar');
  await expect(library.getByRole('tab', { name: /^Eigene/ })).toHaveAttribute('aria-selected', 'true');
  const name = library.getByRole('textbox', { name: 'Name der Komponente' });
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('Komponente 1');
  await page.keyboard.type('Dienst mit Cache');
  await page.keyboard.press('Enter');
  await expect(library.getByRole('button', { name: '„Dienst mit Cache“ einfügen' })).toBeVisible();
  await expect(library.getByRole('button', { name: '„Dienst mit Cache“ umbenennen' })).toBeFocused();
  await expect(library.getByRole('tab', { name: 'Eigene 1' })).toBeVisible();
  // Naming did not touch the document.
  await expect(page.locator('.whiteboard-canvas [data-kind]')).toHaveCount(2);
  expect((await new AxeBuilder({ page }).include('[data-testid="shape-library-sidebar"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);

  await page.reload();
  await page.getByTestId('more-shapes').click();
  await expect(library.getByRole('tab', { name: 'Formen', exact: true })).toHaveAttribute('aria-selected', 'true');
  await library.getByRole('tab', { name: 'Eigene 1' }).click();
  await expect(library.getByRole('button', { name: '„Dienst mit Cache“ einfügen' })).toBeVisible();
});

test('an own component is inserted by click and by drag, each as one undo step', async ({ page }) => {
  await selectTwoShapes(page);
  await saveSelection(page);
  await page.keyboard.press('Enter');
  const library = page.getByTestId('shape-library-sidebar');
  const canvas = page.locator('.whiteboard-canvas');
  const tile = library.getByRole('button', { name: '„Komponente 1“ einfügen' });

  await tile.click();
  await expect(canvas.locator('[data-kind]')).toHaveCount(4);
  await expect(library).toBeVisible();

  await tile.dragTo(page.getByTestId('whiteboard-canvas'), { targetPosition: { x: 420, y: 620 } });
  await expect(canvas.locator('[data-kind]')).toHaveCount(6);

  await page.getByTestId('whiteboard-canvas').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(canvas.locator('[data-kind]')).toHaveCount(4);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(canvas.locator('[data-kind]')).toHaveCount(2);
});

test('own components are renamed and deleted in their tab, by mouse and keyboard', async ({ page }) => {
  await selectTwoShapes(page);
  await saveSelection(page);
  await page.keyboard.press('Enter');
  await saveSelection(page);
  await page.keyboard.type('Zweite');
  await page.keyboard.press('Enter');
  const library = page.getByTestId('shape-library-sidebar');
  await expect(library.getByRole('tab', { name: 'Eigene 2' })).toBeVisible();

  // Rename: Escape keeps the old name and does not close the library; Enter stores the new one.
  await library.getByRole('button', { name: '„Zweite“ umbenennen' }).click();
  const name = library.getByRole('textbox', { name: 'Name der Komponente' });
  await name.fill('Verworfen');
  await page.keyboard.press('Escape');
  await expect(library).toBeVisible();
  await expect(library.getByRole('button', { name: '„Zweite“ einfügen' })).toBeVisible();
  await library.getByRole('button', { name: '„Zweite“ umbenennen' }).press('Enter');
  await name.fill('Edge-Dienst');
  await page.keyboard.press('Enter');
  await expect(library.getByRole('button', { name: '„Edge-Dienst“ einfügen' })).toBeVisible();
  await expect(library.getByRole('status')).toHaveText('Umbenannt in „Edge-Dienst“.');

  // The search of this tab filters by name.
  await library.getByRole('searchbox', { name: 'Eigene Komponenten durchsuchen' }).fill('edge');
  await expect(library.getByRole('listitem')).toHaveCount(1);
  await library.getByRole('searchbox', { name: 'Eigene Komponenten durchsuchen' }).fill('gibt es nicht');
  await expect(library.getByText('Keine eigene Komponente gefunden.')).toBeVisible();
  await library.getByRole('searchbox', { name: 'Eigene Komponenten durchsuchen' }).fill('');

  // Delete asks first; cancelling keeps the component.
  await library.getByRole('button', { name: '„Edge-Dienst“ löschen' }).click();
  const confirm = library.getByRole('group', { name: '„Edge-Dienst“ löschen?' });
  await expect(confirm.getByRole('button', { name: 'Löschen' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(library).toBeVisible();
  await expect(library.getByRole('listitem')).toHaveCount(2);
  await library.getByRole('button', { name: '„Edge-Dienst“ löschen' }).click();
  await confirm.getByRole('button', { name: 'Löschen' }).click();
  await expect(library.getByRole('listitem')).toHaveCount(1);
  await expect(library.getByRole('status')).toHaveText('„Edge-Dienst“ wurde gelöscht.');
  await expect(library.getByRole('button', { name: '„Komponente 1“ einfügen' })).toBeFocused();

  await library.getByRole('button', { name: '„Komponente 1“ löschen' }).click();
  await library.getByRole('group', { name: '„Komponente 1“ löschen?' }).getByRole('button', { name: 'Löschen' }).click();
  await expect(page.getByTestId('custom-components-empty')).toBeVisible();
  await expect(library.getByRole('tab', { name: 'Eigene', exact: true })).toBeFocused();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).components.length, STORAGE_KEY)).toBe(0);
  // Deleting from the library leaves the document alone.
  await expect(page.locator('.whiteboard-canvas [data-kind]')).toHaveCount(2);
});

test('the two library tabs follow the tab pattern and keep the shapes reachable', async ({ page }) => {
  await page.getByTestId('more-shapes').click();
  const library = page.getByTestId('shape-library-sidebar');
  const shapes = library.getByRole('tab', { name: 'Formen', exact: true });
  const own = library.getByRole('tab', { name: 'Eigene', exact: true });
  await expect(shapes).toHaveAttribute('aria-selected', 'true');
  await shapes.focus();
  await page.keyboard.press('ArrowRight');
  await expect(own).toBeFocused();
  await expect(own).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('custom-components-empty')).toContainText('Als Komponente speichern');
  await expect(library.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'library-tab-custom');
  await page.keyboard.press('ArrowLeft');
  await expect(shapes).toHaveAttribute('aria-selected', 'true');
  await expect(library.getByRole('button', { name: 'Leiste anpassen' })).toBeVisible();

  // A provider library hides the tabs; going back shows them again.
  await library.getByRole('button', { name: /^AWS/ }).click();
  await expect(library.getByRole('tablist')).toHaveCount(0);
  await library.getByRole('button', { name: 'Zurück zu allen Formen' }).click();
  await expect(library.getByRole('tablist')).toBeVisible();
});

test('own components follow the dark theme and the English language', async ({ page }) => {
  await selectTwoShapes(page);
  await saveSelection(page);
  await page.keyboard.press('Enter');
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('sketchdraw.preferences.v1') ?? '{}');
    localStorage.setItem('sketchdraw.preferences.v1', JSON.stringify({ ...raw, version: raw.version ?? 1, theme: 'dark', language: 'en' }));
  });
  await page.reload();
  await page.getByTestId('more-shapes').click();
  const library = page.getByTestId('shape-library-sidebar');
  await library.getByRole('tab', { name: 'Mine 1' }).click();
  await expect(library.getByRole('button', { name: 'Insert “Komponente 1”' })).toBeVisible();
  // The preview draws with the theme's colours: the stroke is light on the dark canvas.
  const stroke = await library.locator('.custom-preview [data-kind="rectangle"] [stroke]:not([stroke="none"])').first().evaluate((node) => getComputedStyle(node).stroke);
  const [r, g, b] = stroke.match(/\d+/g)!.map(Number) as [number, number, number];
  expect(r + g + b).toBeGreaterThan(450);
});

test('the own library is exported to a file and imported again from the more menu (#244)', async ({ page }) => {
  await page.getByTestId('more-shapes').click();
  const library = page.getByTestId('shape-library-sidebar');
  await library.getByRole('tab', { name: /^Eigene/ }).click();
  const more = library.getByRole('button', { name: 'Eigene Komponenten importieren oder exportieren' });

  // An empty library offers the import; there is nothing to export yet.
  await more.click();
  const menu = library.getByRole('menu', { name: 'Eigene Komponenten importieren oder exportieren' });
  await expect(menu.getByRole('menuitem', { name: 'Komponenten importieren…' })).toBeFocused();
  await expect(menu.getByRole('menuitem', { name: 'Komponenten exportieren…' })).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();
  await expect(more).toHaveAttribute('aria-expanded', 'false');

  await selectTwoShapes(page);
  await saveSelection(page);
  await page.keyboard.type('Dienst mit Cache');
  await page.keyboard.press('Enter');
  await expect(library.getByTestId('custom-components-summary')).toHaveText('1 Komponente');

  // Export hands the library over as a download in the browser.
  await more.click();
  const [download] = await Promise.all([page.waitForEvent('download'), menu.getByRole('menuitem', { name: 'Komponenten exportieren…' }).click()]);
  expect(download.suggestedFilename()).toBe('Eigene Komponenten.sketchdraw-components.json');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const exported = Buffer.concat(chunks).toString('utf8');
  expect(JSON.parse(exported)).toMatchObject({ format: 'sketchdraw.custom-components', version: 1, components: [{ name: 'Dienst mit Cache' }] });
  await expect(more).toBeFocused();

  // The same file again adds nothing.
  const pick = async (name: string, contents: string): Promise<void> => {
    await more.click();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), menu.getByRole('menuitem', { name: 'Komponenten importieren…' }).click()]);
    await chooser.setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(contents, 'utf8') });
  };
  await pick('bibliothek.json', exported);
  await expect(page.getByText('Keine neue Komponente importiert. 1 ist schon in der Bibliothek.').first()).toBeVisible();
  await expect(library.locator('.custom-tile')).toHaveCount(1);

  // After deleting it, the file brings the component back, and it can be inserted.
  await library.getByRole('button', { name: '„Dienst mit Cache“ löschen' }).click();
  await library.getByRole('button', { name: 'Löschen', exact: true }).click();
  await expect(library.getByTestId('custom-components-empty')).toBeVisible();
  await pick('bibliothek.json', exported);
  await expect(page.getByText('1 Komponente importiert.').first()).toBeVisible();
  await expect(library.getByRole('tab', { name: 'Eigene 1' })).toBeVisible();
  const before = await page.locator('.whiteboard-canvas [data-kind]').count();
  await library.getByRole('button', { name: '„Dienst mit Cache“ einfügen' }).click();
  await expect(page.locator('.whiteboard-canvas [data-kind]')).toHaveCount(before + 2);

  // Another JSON file is refused with a reason, and the library stays as it is.
  await pick('anderes.json', JSON.stringify({ hello: 'world' }));
  await expect(page.getByText('Die Datei enthält keine Sketchdraw-Komponenten.').first()).toBeVisible();
  await expect(library.locator('.custom-tile')).toHaveCount(1);

  await more.click();
  const results = await new AxeBuilder({ page }).include('[data-testid="shape-library-sidebar"]').analyze();
  expect(results.violations).toEqual([]);
});
