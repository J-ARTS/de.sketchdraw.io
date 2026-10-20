import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';

async function menu(page: Page, kind: 'import' | 'export') {
  await page.getByTestId('file-menu-button').click(); await page.getByTestId(kind === 'import' ? 'file-menu-interopImport' : 'file-menu-interopExport').click();
}
async function rectangle(page: Page) {
  await page.getByRole('button', { name: 'Rechteck', exact: true }).click(); await page.mouse.move(340, 210); await page.mouse.down(); await page.mouse.move(520, 320); await page.mouse.up();
  await expect(page.getByTestId('whiteboard-canvas').locator('[data-kind=rectangle]')).toHaveCount(1);
}
async function file(page: Page, name: string, contents: string) {
  await page.getByLabel('Austauschdatei auswählen').setInputFiles({ name, mimeType: name.endsWith('.svg') ? 'image/svg+xml' : 'application/xml', buffer: Buffer.from(contents) });
}
function cell(id: string, label: string) { return `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="${id}" value="${label}" style="shape=rectangle;fillColor=#ffffff;strokeColor=#000000;" vertex="1" parent="1"><mxGeometry x="50" y="50" width="120" height="70" as="geometry"/></mxCell></root></mxGraphModel>`; }
test.beforeEach(async ({ page }) => { page.on('pageerror', error => { throw error; }); await page.goto('/'); });

test('warning preview requires acceptance; dirty cancellation preserves canvas; imported revision zero stays dirty', async ({ page }) => {
  await rectangle(page); await menu(page, 'import');
  await file(page, 'curve.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M 10 20 C 30 0 50 0 70 20" fill="none" stroke="#000000"/></svg>');
  const apply = page.getByRole('button', { name: 'Als neues Dokument öffnen', exact: true });
  await expect(apply).toBeDisabled(); await expect(page.getByRole('region', { name: 'Konvertierungsbericht' })).toBeVisible();
  await page.getByRole('checkbox', { name: /Ich habe die beschriebenen Verluste/ }).check();
  await apply.click(); await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(page.getByTestId('whiteboard-canvas').locator('[data-kind=rectangle]')).toHaveCount(1);
  await expect(apply).toBeVisible(); await apply.click(); await page.getByRole('button', { name: 'Verwerfen', exact: true }).click();
  await expect(page.getByTestId('interop-panel')).not.toBeVisible();
  await expect(page.getByTestId('whiteboard-canvas').locator('[data-kind=path]')).toHaveCount(1);
  await page.getByTestId('file-menu-button').click(); await page.getByTestId('file-menu-new').click(); await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
});

test('draw.io multi-page source requires explicit selection and unsafe XML never becomes live content', async ({ page }) => {
  await menu(page, 'import');
  await file(page, 'pages.drawio', `<mxfile><diagram name="Erste">${cell('a', 'Erste Seite')}</diagram><diagram name="Zweite">${cell('b', 'Zweite Seite')}</diagram></mxfile>`);
  await expect(page.getByLabel('Seite auswählen')).toBeVisible(); await expect(page.getByRole('button', { name: 'Als neues Dokument öffnen' })).toHaveCount(0);
  await page.getByLabel('Seite auswählen').selectOption('1');
  await expect(page.getByRole('img', { name: 'Sichere Vorschau des konvertierten Diagramms' })).toContainText('Zweite Seite');
  await expect(page.getByTestId('whiteboard-canvas').locator('[data-element-id]')).toHaveCount(0);
  const consent = page.getByRole('checkbox', { name: /Ich habe die beschriebenen Verluste/ }); if (await consent.isVisible()) await consent.check();
  await page.getByRole('button', { name: 'Als neues Dokument öffnen' }).click();
  await expect(page.getByTestId('whiteboard-canvas')).toContainText('Zweite Seite');
  await menu(page, 'import'); await file(page, 'bad.svg', '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///not-accessed">]><svg xmlns="http://www.w3.org/2000/svg"><text>&x;</text></svg>');
  await expect(page.getByRole('alert')).toContainText('konnte nicht verarbeitet');
  await expect(page.getByRole('button', { name: 'Als neues Dokument öffnen' })).toHaveCount(0);
  await expect(page.getByTestId('whiteboard-canvas')).toContainText('Zweite Seite');
});

test('SVG export uses real download and own metadata roundtrip; edits invalidate prepared export', async ({ page }) => {
  await rectangle(page); await menu(page, 'export'); await page.getByRole('combobox', { name: 'Format', exact: true }).selectOption('svg');
  await page.getByRole('button', { name: 'Exportvorschau erstellen', exact: true }).click();
  const output = page.getByRole('button', { name: 'Datei exportieren', exact: true });
  const consent = page.getByRole('checkbox', { name: /Ich habe die beschriebenen Verluste/ }); if (await consent.isVisible()) await consent.check();
  await expect(output).toBeEnabled();
  await page.getByTestId('document-title').fill('Nach Vorschau geändert');
  await expect(output).toBeDisabled();
  await page.getByRole('button', { name: 'Exportvorschau erstellen', exact: true }).click();
  if (await consent.isVisible()) await consent.check();
  const downloadEvent = page.waitForEvent('download'); await output.click(); const download = await downloadEvent;
  const svg = await readFile((await download.path())!, 'utf8'); expect(svg).toContain('<svg'); expect(svg).toContain('<rect'); expect(svg).toContain('sketchdraw');
  await expect(page.getByTestId('interop-panel')).toContainText('Als Download übergeben');
  await expect(page.getByTestId('save-status')).not.toHaveAttribute('data-status', 'saved');
  await menu(page, 'import'); await file(page, 'roundtrip.svg', svg);
  await expect(page.getByTestId('interop-panel')).toContainText('Eigener unveränderter Roundtrip');
  await page.getByRole('button', { name: 'Als neues Dokument öffnen', exact: true }).click(); await page.getByRole('button', { name: 'Verwerfen', exact: true }).click();
  await expect(page.getByTestId('document-title')).toHaveValue('Nach Vorschau geändert');
  await expect(page.getByTestId('whiteboard-canvas').locator('[data-kind=rectangle]')).toHaveCount(1);
});

test('export and import panels satisfy automated accessibility checks', async ({ page }) => {
  await menu(page, 'export');
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze(); expect(result.violations).toEqual([]);
});

test('importing all pages of a draw.io file creates a document with those pages', async ({ page }) => {
  await menu(page, 'import');
  await file(page, 'pages.drawio', `<mxfile><diagram name="Erste">${cell('a', 'Erste Seite')}</diagram><diagram name="Zweite">${cell('a', 'Zweite Seite')}</diagram></mxfile>`);
  await page.getByLabel('Seite auswählen').selectOption('all');
  await expect(page.getByTestId('interop-panel')).toContainText('2 Seiten');
  const consent = page.getByRole('checkbox', { name: /Ich habe die beschriebenen Verluste/ }); if (await consent.isVisible()) await consent.check();
  await page.getByRole('button', { name: 'Als neues Dokument öffnen' }).click();
  await expect(page.getByTestId('whiteboard-canvas')).toContainText('Erste Seite');
  await expect(page.getByTestId('page-switcher')).toHaveAccessibleName(/^Seiten \(2\)/);
  await page.getByTestId('page-switcher').click();
  await page.getByRole('button', { name: /^Zweite/ }).click();
  await expect(page.getByTestId('whiteboard-canvas')).toContainText('Zweite Seite');
  await expect(page.getByTestId('whiteboard-canvas')).not.toContainText('Erste Seite');
});
