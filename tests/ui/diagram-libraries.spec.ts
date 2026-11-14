import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => { throw error; });
  await page.goto('/');
});

async function openLibrary(page: Page, id: 'er' | 'bpmn' | 'sequence') {
  const library = page.getByTestId('shape-library-sidebar');
  if (!(await library.count())) await page.getByTestId('more-shapes').click();
  await page.getByTestId(`open-diagram-library-${id}`).click();
  return library;
}

test('the ER library inserts entities as tables and relationships with crow\'s foot ends (#191)', async ({ page }) => {
  const library = await openLibrary(page, 'er');
  await expect(library.getByRole('heading', { name: 'ER-Diagramme' })).toBeVisible();
  for (const section of ['Tabellen', 'Beziehungen', 'Chen-Notation']) await expect(library.getByRole('heading', { name: section })).toBeVisible();
  // A library of templates has no tabs and no shape bar hint; the search is its own.
  await expect(library.getByRole('tablist')).toHaveCount(0);
  await expect(library.getByRole('searchbox', { name: 'Vorlagen durchsuchen' })).toBeVisible();
  expect((await new AxeBuilder({ page }).include('[data-testid="shape-library-sidebar"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);

  await library.getByRole('button', { name: 'Beispiel: Kunde und Bestellung' }).click();
  const canvas = page.locator('.whiteboard-canvas');
  await expect(canvas.locator('[data-kind="table"]')).toHaveCount(2);
  await expect(canvas.locator('[data-kind="connector"]')).toHaveCount(1);
  await expect(canvas.locator('[data-kind="table"]').last()).toContainText('Bestellung');
  // The library stays open for the next template, and the whole example is one undo step.
  await expect(library).toBeVisible();
  await library.getByRole('searchbox', { name: 'Vorlagen durchsuchen' }).fill('n:m');
  await expect(library.getByRole('button', { name: /^Beziehung/ })).toHaveCount(1);
  await library.getByRole('button', { name: 'Beziehung n:m' }).dragTo(page.getByTestId('whiteboard-canvas'), { targetPosition: { x: 300, y: 620 } });
  await expect(canvas.locator('[data-kind="connector"]')).toHaveCount(2);

  await page.getByTestId('whiteboard-canvas').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(canvas.locator('[data-kind]')).toHaveCount(0);
});

test('the BPMN library inserts events, tasks, gateways, lanes and a connected example (#191)', async ({ page }) => {
  const library = await openLibrary(page, 'bpmn');
  for (const section of ['Ereignisse', 'Aktivitäten', 'Gateways', 'Daten', 'Bahnen', 'Flüsse']) await expect(library.getByRole('heading', { name: section })).toBeVisible();
  const canvas = page.locator('.whiteboard-canvas');
  await library.getByRole('button', { name: 'Beispiel: einfacher Prozess' }).click();
  await expect(canvas.locator('[data-kind="ellipse"]')).toHaveCount(2);
  await expect(canvas.locator('[data-kind="rectangle"]')).toHaveCount(1);
  await expect(canvas.locator('[data-kind="diamond"]')).toHaveCount(1);
  await expect(canvas.locator('[data-kind="connector"]')).toHaveCount(3);

  await library.getByRole('button', { name: 'Pool mit zwei Bahnen' }).click();
  await expect(canvas.locator('[data-kind="container"]')).toHaveCount(3);
  // Everything is ordinary diagram content: it shows up in the diagram code.
  await library.getByRole('button', { name: 'Formen schließen' }).click();
  await page.getByTestId('workspace-menu-button').click();
  await page.getByRole('menuitemcheckbox', { name: 'Code', exact: true }).click();
  const code = await page.getByTestId('diagram-code').inputValue();
  expect(code).toContain('Aufgabe');
  expect(code).toContain('Bahn 2');
});

test('templates are found from the main search, and the libraries are English in English (#191)', async ({ page }) => {
  await page.getByTestId('more-shapes').click();
  const library = page.getByTestId('shape-library-sidebar');
  await library.getByRole('searchbox', { name: 'Formen durchsuchen' }).fill('gateway');
  const results = page.getByTestId('diagram-template-results');
  await expect(results.getByRole('button')).toHaveCount(3);
  await results.getByRole('button', { name: 'Exklusives Gateway' }).click();
  await expect(page.locator('.whiteboard-canvas [data-kind="diamond"]')).toHaveCount(1);

  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('sketchdraw.preferences.v1') ?? '{}');
    localStorage.setItem('sketchdraw.preferences.v1', JSON.stringify({ ...raw, version: raw.version ?? 1, language: 'en' }));
  });
  await page.reload();
  await page.getByTestId('more-shapes').click();
  await page.getByTestId('open-diagram-library-sequence').click();
  await expect(library.getByRole('heading', { name: 'Sequence diagrams' })).toBeVisible();
  await expect(library.getByRole('button', { name: 'Lifeline' })).toBeVisible();
  await library.getByRole('button', { name: 'Back to all shapes' }).click();
  await expect(page.getByTestId('open-diagram-library-er')).toContainText('ER diagrams');
});
