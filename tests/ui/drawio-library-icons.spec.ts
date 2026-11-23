import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/** A file rebuilt by hand in the shape draw.io writes it: icons are named by their library, not carried along (#280). */
const FILE = readFileSync('tests/fixtures/interop/external/drawio-library-icons.drawio', 'utf8');

async function importFile(page: Page, language: 'de' | 'en' = 'de'): Promise<void> {
  await page.addInitScript((value) => { localStorage.setItem('sketchdraw.preferences.v1', JSON.stringify({ theme: 'light', language: value, canvasBackground: null })); }, language);
  page.on('pageerror', (error) => { throw error; });
  await page.goto('/');
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
  await page.getByTestId('file-menu-button').click();
  await page.getByTestId('file-menu-interopImport').click();
  await page.getByTestId('interop-file').setInputFiles({ name: 'plattform.drawio', mimeType: 'application/xml', buffer: Buffer.from(FILE) });
}

test('icons of draw.io libraries arrive as icons of the app with their text; the summary names those it does not have (#280)', async ({ page }, testInfo) => {
  await importFile(page);
  const summary = page.getByTestId('interop-library-icons');
  await expect(summary).toHaveText('5 Icons aus draw.io-Bibliotheken sind jetzt Icons der App. 2 Icons gibt es in der App nicht; sie bleiben beschriftete Kästen.');
  await expect(summary).toHaveAttribute('role', 'status');
  // The preview already shows what will be opened.
  const preview = page.getByRole('img', { name: 'Sichere Vorschau des konvertierten Diagramms' });
  await expect(preview.locator('[data-kind=component]')).toHaveCount(5);

  await page.getByRole('button', { name: 'Als neues Dokument öffnen', exact: true }).click();
  const canvas = page.getByTestId('whiteboard-canvas');
  const icons = canvas.locator('[data-kind=component]');
  await expect(icons).toHaveCount(5);
  for (const text of ['Rohdaten', 'Azure OpenAI', 'API', 'Shop', 'Cloud Controller Manager']) await expect(icons.filter({ hasText: text })).toHaveCount(1);
  // Each icon is drawn: it holds the picture of the library, not an empty box.
  for (const text of ['Rohdaten', 'API']) expect(await icons.filter({ hasText: text }).locator('svg, image, path').count(), text).toBeGreaterThan(0);
  // The icons the app does not have, the picture from a web address and the plain box are boxes with their text.
  const boxes = canvas.locator('[data-kind=rectangle]');
  for (const text of ['Neuer Dienst', 'Laptop', 'Logo', 'Notiz']) await expect(boxes.filter({ hasText: text })).toHaveCount(1);
  await expect(canvas.locator('[data-kind=connector]')).toHaveCount(2);
  if (process.env['SKETCHDRAW_SHOTS']) await page.screenshot({ path: `${process.env['SKETCHDRAW_SHOTS']}/drawio-library-icons.png` });
  testInfo.annotations.push({ type: 'import', description: 'drawio-library-icons.drawio' });
});

test('the summary of library icons follows the language, and a file without them shows none (#280)', async ({ page }) => {
  await importFile(page, 'en');
  await expect(page.getByTestId('interop-library-icons')).toHaveText('5 icons of draw.io libraries are now icons of the app. 2 icons are not in the app; they stay labelled boxes.');
  // The same file without its library icons: no summary line.
  const plain = FILE.replace(/<mxCell id="(?:blob|openai|api|ccm|deploy|unknown-azure|clipart)"[\s\S]*?<\/mxCell>\s*/g, '').replace(/<mxCell id="edge-\d"[\s\S]*?<\/mxCell>\s*/g, '');
  await page.getByTestId('interop-file').setInputFiles({ name: 'ohne.drawio', mimeType: 'application/xml', buffer: Buffer.from(plain) });
  await expect(page.getByRole('button', { name: 'Open as new document', exact: true })).toBeEnabled();
  await expect(page.getByTestId('interop-library-icons')).toHaveCount(0);
  await expect(page.getByTestId('interop-library-icons-loading')).toHaveCount(0);
});
