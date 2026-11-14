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
  expect(code).toContain('Antrag prüfen');
  expect(code).toContain('Bahn 2');
});

test('templates are found from the main search, and the libraries are English in English (#191)', async ({ page }) => {
  await page.getByTestId('more-shapes').click();
  const library = page.getByTestId('shape-library-sidebar');
  await library.getByRole('searchbox', { name: 'Formen durchsuchen' }).fill('gateway');
  const results = page.getByTestId('diagram-template-results');
  await expect(results.getByRole('button')).toHaveCount(4);
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

test('a sequence diagram grows by click: new messages and new lifelines from the selection bar (#192)', async ({ page }) => {
  const library = await openLibrary(page, 'sequence');
  await library.getByRole('button', { name: 'Beispiel: Anfrage und Antwort' }).click();
  await library.getByRole('button', { name: 'Formen schließen' }).click();
  const canvas = page.locator('.whiteboard-canvas');
  const toolbar = page.getByRole('toolbar', { name: 'Eigenschaften' });
  await expect(canvas.locator('[data-kind="connector"]')).toHaveCount(2);

  // Select the lifeline "Client" by its box.
  const head = canvas.locator('[data-kind="rectangle"]').filter({ hasText: 'Client' });
  const box = (await head.boundingBox())!;
  await page.mouse.click(200, 700);
  await page.mouse.click(box.x + 8, box.y + 8);
  const addMessage = toolbar.getByRole('button', { name: 'Nachricht hinzufügen' });
  const addLifeline = toolbar.getByRole('button', { name: 'Lebenslinie hinzufügen' });
  await expect(addMessage).toBeVisible();

  await addMessage.click();
  await expect(canvas.locator('[data-kind="connector"]')).toHaveCount(3);
  // The new message is selected, and the bar keeps offering the next one.
  await addMessage.click();
  await expect(canvas.locator('[data-kind="connector"]')).toHaveCount(4);
  const messages = await canvas.locator('[data-kind="connector"]').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect()).map((rect) => Math.round(rect.y + rect.height / 2)).sort((a, b) => a - b));
  // Four messages, evenly spaced from top to bottom.
  expect(new Set(messages).size).toBe(4);
  expect(messages[3]! - messages[2]!).toBe(messages[1]! - messages[0]!);

  await addLifeline.click();
  await expect(canvas.locator('[data-kind="rectangle"]')).toHaveCount(3);
  await expect(canvas.locator('[data-kind="rectangle"]').filter({ hasText: 'Teilnehmer 3' })).toBeVisible();
  // The new lifeline is selected: the next message starts there and runs to its neighbour.
  await addMessage.click();
  await expect(canvas.locator('[data-kind="connector"]')).toHaveCount(5);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);

  // Each click is one undo step.
  await page.getByTestId('whiteboard-canvas').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(canvas.locator('[data-kind="connector"]')).toHaveCount(4);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(canvas.locator('[data-kind="rectangle"]')).toHaveCount(2);

  // Other selections do not show the two actions.
  await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
  await page.mouse.move(150, 650); await page.mouse.down(); await page.mouse.move(260, 720, { steps: 4 }); await page.mouse.up();
  await expect(toolbar.getByRole('button', { name: 'Nachricht hinzufügen' })).toHaveCount(0);
});

test('ER relationships react like the curved arrow: they bend with their tables and have control points (#194)', async ({ page }) => {
  const library = await openLibrary(page, 'er');
  await library.getByRole('button', { name: 'Beispiel: Kunde und Bestellung' }).click();
  await library.getByRole('button', { name: 'Formen schließen' }).click();
  const canvas = page.locator('.whiteboard-canvas');
  const relationship = canvas.locator('[data-kind="connector"] path[marker-end]').first();
  const before = (await relationship.getAttribute('d'))!;
  // A curve, not a line: the path is a cubic Bézier.
  expect(before).toMatch(/C/);

  // Move the right table down: the relationship stays docked and bends into an S.
  await page.mouse.click(640, 220);
  const table = canvas.locator('[data-kind="table"]').last();
  const box = (await table.boundingBox())!;
  await page.mouse.move(box.x + box.width - 6, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 6, box.y + box.height / 2 + 160, { steps: 8 });
  await page.mouse.up();
  const after = (await relationship.getAttribute('d'))!;
  expect(after).not.toBe(before);
  expect(after).toMatch(/C/);
  const line = (await canvas.locator('[data-kind="connector"]').first().boundingBox())!;
  expect(line.height).toBeGreaterThan(100);

  // Selected, it shows the two control points of a curved connector.
  await page.mouse.click(line.x + line.width / 2, line.y + line.height / 2);
  await expect(page.getByTestId('connector-control-handle-1')).toBeVisible();
  await expect(page.getByTestId('connector-control-handle-2')).toBeVisible();
  await expect(page.getByRole('toolbar', { name: 'Eigenschaften' }).getByRole('button', { name: 'Linienform: Gebogen' })).toBeVisible();
});
