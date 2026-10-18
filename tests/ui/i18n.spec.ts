import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { EN } from '../../src/renderer/i18n/en';

// Every German source text that differs from its English translation must not be displayed as such.
const TRANSLATED_PAIRS = Object.entries(EN).filter(([german, english]) => german !== english && german.length >= 5 && !english.includes(german));

// Unmistakable German words; each must not appear anywhere in the English interface.
const GERMAN = /[äöüÄÖÜß]|\b(?:und|oder|nicht|für|zum|zur|wird|werden|eine|einen|einem|einer|ist|sind|mit|ohne|auf|aus|nach|von|vom|noch|auch|kann|können|bitte|wurde|Datei|Ansicht|Zeichenfläche|Dokument|Fehler|Speichern|Öffnen|Schließen|Löschen|Abbrechen|Bearbeiten|Verbinden|Einstellungen|Werkzeug|Werkzeuge|Auswahl|Farbe|Seite|Seiten|Aufgabe|Aufgaben|Kommentar|Kommentare|Folie|Folien|Neu|Alle|Keine|Kein|Mehr|Weitere|Zurück|Weiter|Fertig|Heute|Hilfe|Sprache|Hinweis|Meldungen|Schrift|Größe|Breite|Höhe|Füllung|Linie|Pfeil|Rechteck|Raute|Dreieck|Kreis|Tabelle|Bild|Notiz|Verbindung)\b/;

async function germanLeaks(page: Page): Promise<string[]> {
  const strings: string[] = await page.evaluate(() => {
    const found = new Set<string>();
    const add = (value: string | null | undefined) => { const text = value?.replace(/\s+/g, ' ').trim(); if (text) found.add(text); };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || ['SCRIPT', 'STYLE', 'TEXTAREA'].includes(parent.tagName) || parent.closest('[data-user-content], .cm-content, .code-editor')) continue;
      add(node.textContent);
    }
    for (const element of document.body.querySelectorAll('*')) {
      for (const name of ['aria-label', 'title', 'placeholder', 'alt', 'aria-description']) add(element.getAttribute(name));
    }
    return [...found];
  });
  return strings.filter((text) => GERMAN.test(text) || TRANSLATED_PAIRS.some(([german]) => text.includes(german)));
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => { throw error; });
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('i18n-test-seeded')) {
      localStorage.setItem('sketchdraw.preferences.v1', JSON.stringify({ theme: 'light', canvasBackground: null, language: 'en' }));
      sessionStorage.setItem('i18n-test-seeded', '1');
    }
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
});

test('the idle English interface contains no German text', async ({ page }) => {
  await expect(page.getByRole('toolbar', { name: 'Tools' })).toBeVisible();
  expect(await germanLeaks(page)).toEqual([]);
});

test('menus, dialogs and side panels are fully English', async ({ page }) => {
  const leaks: Record<string, string[]> = {};
  const check = async (name: string) => { const found = await germanLeaks(page); if (found.length) leaks[name] = found; };

  await page.getByTestId('file-menu-button').click();
  await check('file menu');
  await page.keyboard.press('Escape');

  await page.getByTestId('workspace-menu-button').click();
  await check('workspace menu');
  const menu = page.getByRole('menu', { name: 'Workspace' });
  for (const id of ['objects', 'help', 'collaboration', 'catalog', 'code', 'slides', 'plugins', 'settings']) {
    const item = menu.locator(`[data-testid="workspace-menu-${id}"]`);
    if (!(await item.count())) continue;
    await item.click();
    await check(id);
    await page.keyboard.press('Escape');
    if (!(await menu.isVisible().catch(() => false))) await page.getByTestId('workspace-menu-button').click();
  }
  await page.keyboard.press('Escape');
  expect(leaks).toEqual({});
});

test('drawing, selection properties, tasks and comments are English', async ({ page }) => {
  const leaks: Record<string, string[]> = {};
  const check = async (name: string) => { const found = await germanLeaks(page); if (found.length) leaks[name] = found; };

  await page.keyboard.press('r');
  const canvas = page.getByTestId('whiteboard-canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 500, box.y + 420, { steps: 6 });
  await page.mouse.up();
  await check('selected rectangle');
  await expect(page.getByTestId('save-status')).toContainText(/Unsaved changes|Not saved/);

  await page.keyboard.press('e');
  await page.mouse.move(box.x + 650, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 800, box.y + 400, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
  await page.keyboard.press('c');
  await check('connector tool');
  await page.keyboard.press('p');
  await check('pencil options');
  await page.keyboard.press('v');

  await page.keyboard.press('Escape');
  await page.keyboard.press('?');
  await check('keyboard help');
  await page.keyboard.press('Escape');
  expect(leaks).toEqual({});
});

test('every selection-toolbar popover, the task board and the dialogs are English', async ({ page }) => {
  const leaks: Record<string, string[]> = {};
  const check = async (name: string) => { const found = await germanLeaks(page); if (found.length) leaks[name] = found; };
  const canvas = page.getByTestId('whiteboard-canvas');
  const box = (await canvas.boundingBox())!;

  await page.keyboard.press('r');
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 520, box.y + 430, { steps: 6 });
  await page.mouse.up();
  const segments = page.getByTestId('properties-panel').locator('.segment');
  const count = await segments.count();
  expect(count).toBeGreaterThan(3);
  for (let index = 0; index < count; index += 1) {
    const segment = segments.nth(index);
    if (!(await segment.isVisible()) || (await segment.isDisabled())) continue;
    await segment.click();
    await check(`selection segment ${index}: ${(await segment.getAttribute('aria-label')) ?? ''}`);
    await page.keyboard.press('Escape');
  }
  await check('selection toolbar');

  await page.keyboard.press('Escape');
  await page.getByTestId('page-switcher').click();
  await check('page switcher');
  await page.keyboard.press('Escape');

  await page.keyboard.press('w');
  await check('web embed dialog');
  await page.keyboard.press('Escape');

  await page.getByTestId('file-menu-button').click();
  for (const id of ['interopImport', 'interopExport']) {
    const item = page.locator(`[data-testid="file-menu-${id}"]`);
    if (await item.count()) {
      await item.click();
      await check(id);
      await page.keyboard.press('Escape');
      if (!(await page.locator('[data-testid="file-menu-interopImport"]').isVisible().catch(() => false))) await page.getByTestId('file-menu-button').click();
    }
  }
  await page.keyboard.press('Escape');
  expect(leaks).toEqual({});
});

test('comments, tables, annotations, frames, presentation and the task dialog are English', async ({ page }) => {
  const leaks: Record<string, string[]> = {};
  const check = async (name: string) => { const found = await germanLeaks(page); if (found.length) leaks[name] = found; };
  const canvas = page.getByTestId('whiteboard-canvas');
  const box = (await canvas.boundingBox())!;
  const drag = async (x1: number, y1: number, x2: number, y2: number) => {
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.down();
    await page.mouse.move(box.x + x2, box.y + y2, { steps: 6 });
    await page.mouse.up();
  };

  await page.keyboard.press('f');
  await drag(200, 200, 420, 340);
  await check('frame');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+T');
  await drag(480, 200, 760, 340);
  await check('table');
  await page.keyboard.press('Escape');
  await page.keyboard.press('a');
  await drag(200, 420, 420, 520);
  await check('annotation');
  await page.keyboard.press('Escape');
  await page.keyboard.press('n');
  await drag(480, 420, 640, 540);
  await check('sticky note');
  await page.keyboard.press('Escape');

  await page.keyboard.press('k');
  await page.mouse.click(box.x + 900, box.y + 300);
  await check('comment composer');
  await page.keyboard.type('Hello');
  await page.keyboard.press('Enter');
  await check('comment thread');
  await page.keyboard.press('Escape');

  await page.keyboard.press('Alt+Shift+P');
  await check('presenter mode');
  await page.keyboard.press('Escape');

  await page.getByTestId('page-switcher').click();
  await page.getByTestId('task-board-entry').click();
  const board = page.getByTestId('task-board');
  await check('task board');
  await board.getByRole('button', { name: 'New task' }).click();
  const dialog = page.getByRole('dialog', { name: 'New task' });
  await dialog.getByRole('button', { name: 'Create task' }).click();
  await check('task dialog validation');
  await dialog.getByRole('textbox', { name: 'Title' }).fill('Prepare release');
  for (const button of await dialog.getByRole('button', { expanded: false }).all()) {
    if (!(await button.isVisible())) continue;
    await button.click();
    await check('task dialog popover');
    await page.keyboard.press('Escape');
    if (!(await dialog.isVisible().catch(() => false))) break;
  }
  expect(leaks).toEqual({});
});

test('notices, session errors and the resource card editor are English', async ({ page }) => {
  const leaks: Record<string, string[]> = {};
  const check = async (name: string) => { const found = await germanLeaks(page); if (found.length) leaks[name] = found; };
  const canvas = page.getByTestId('whiteboard-canvas');
  const box = (await canvas.boundingBox())!;

  await page.keyboard.press('r');
  await page.mouse.click(box.x + 300, box.y + 300);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+Shift+z');
  await page.keyboard.press('Delete');
  await check('notices');

  await page.getByTestId('workspace-menu-button').click();
  await page.getByTestId('workspace-menu-collaboration').click();
  const panel = page.getByRole('dialog').or(page.getByTestId('collaboration-panel')).first();
  const link = page.getByRole('textbox', { name: 'Paste session link' });
  if (await link.count()) {
    await link.fill('not a link');
    await page.getByRole('button', { name: 'Join session' }).click();
    await check('invalid session link');
  }
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByTestId('workspace-menu-button').click();
  await page.getByTestId('workspace-menu-catalog').click();
  const card = page.getByRole('button', { name: /Resource card/ }).first();
  if (await card.count()) {
    await card.click();
    await check('resource card inserted');
    await page.keyboard.press('Escape');
  }
  expect(leaks).toEqual({});
});

test('the English interface has no serious accessibility findings', async ({ page }) => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations).toEqual([]);
});
