import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { createDocument, createElement } from '../../src/domain';
import { prepareMermaidExport } from '../../src/interop/mermaid';

async function menu(page: Page, kind: 'import' | 'export') {
  await page.getByTestId('file-menu-button').click(); await page.getByTestId(kind === 'import' ? 'file-menu-interopImport' : 'file-menu-interopExport').click();
}
async function select(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('listbox', { name: label, exact: true }).getByRole('option', { name: option, exact: true }).click();
}
async function rectangle(page: Page) {
  await page.getByRole('button', { name: 'Rechteck', exact: true }).click(); await page.mouse.move(340, 210); await page.mouse.down(); await page.mouse.move(520, 320); await page.mouse.up();
  await expect(page.getByTestId('whiteboard-canvas').locator('[data-kind=rectangle]')).toHaveCount(1);
}
async function file(page: Page, name: string, contents: string) {
  await page.getByTestId('interop-file').setInputFiles({ name, mimeType: name.endsWith('.svg') ? 'image/svg+xml' : /\.(mmd|mermaid)$/i.test(name) ? 'text/plain' : 'application/xml', buffer: Buffer.from(contents) });
}
function cell(id: string, label: string) { return `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="${id}" value="${label}" style="shape=rectangle;fillColor=#ffffff;strokeColor=#000000;" vertex="1" parent="1"><mxGeometry x="50" y="50" width="120" height="70" as="geometry"/></mxCell></root></mxGraphModel>`; }
test.beforeEach(async ({ page }) => { page.on('pageerror', error => { throw error; }); await page.goto('/'); });

test('a preview with approximations opens without a confirmation box; dirty cancellation preserves canvas; imported revision zero stays dirty', async ({ page }) => {
  await rectangle(page); await menu(page, 'import');
  await file(page, 'curve.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M 10 20 C 30 0 50 0 70 20" fill="none" stroke="#000000"/></svg>');
  const apply = page.getByRole('button', { name: 'Als neues Dokument öffnen', exact: true });
  // No list of notes and nothing to tick before the import (#276); the summary names the kind of conversion.
  await expect(page.getByTestId('interop-panel')).toContainText('Mit Annäherungen konvertiert');
  await expect(page.getByTestId('interop-panel').getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByTestId('interop-panel').getByRole('region')).toHaveCount(0);
  await expect(apply).toBeEnabled();
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
  const sourcePage = page.getByRole('combobox', { name: 'Seite auswählen', exact: true });
  await expect(sourcePage).toHaveText('Bitte eine der 2 Seiten auswählen');
  await expect(page.getByRole('button', { name: 'Als neues Dokument öffnen' })).toHaveCount(0);
  await sourcePage.click();
  await expect(page.getByRole('option', { name: 'Bitte eine der 2 Seiten auswählen', exact: true })).toHaveAttribute('aria-disabled', 'true');
  await page.getByRole('option', { name: '1 · Erste', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Sichere Vorschau des konvertierten Diagramms' })).toContainText('Erste Seite');
  await select(page, 'Seite auswählen', '2 · Zweite');
  await expect(page.getByRole('img', { name: 'Sichere Vorschau des konvertierten Diagramms' })).toContainText('Zweite Seite');
  await expect(page.getByTestId('whiteboard-canvas').locator('[data-element-id]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Als neues Dokument öffnen' }).click();
  await expect(page.getByTestId('whiteboard-canvas')).toContainText('Zweite Seite');
  await menu(page, 'import'); await file(page, 'bad.svg', '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///not-accessed">]><svg xmlns="http://www.w3.org/2000/svg"><text>&x;</text></svg>');
  await expect(page.getByRole('alert')).toContainText('konnte nicht verarbeitet');
  await expect(page.getByRole('button', { name: 'Als neues Dokument öffnen' })).toHaveCount(0);
  await expect(page.getByTestId('whiteboard-canvas')).toContainText('Zweite Seite');
});

test('SVG export uses real download and own metadata roundtrip; edits invalidate prepared export', async ({ page }) => {
  await rectangle(page); await menu(page, 'export'); await select(page, 'Format', 'SVG');
  await page.getByRole('button', { name: 'Exportvorschau erstellen', exact: true }).click();
  const output = page.getByRole('button', { name: 'Datei exportieren', exact: true });
  await expect(output).toBeEnabled();
  await page.getByTestId('document-title').fill('Nach Vorschau geändert');
  await expect(output).toBeDisabled();
  await page.getByRole('button', { name: 'Exportvorschau erstellen', exact: true }).click();
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
  await menu(page, 'import');
  await select(page, 'Format', 'Mermaid');
  const mermaid = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze(); expect(mermaid.violations).toEqual([]);
});

test('importing all pages of a draw.io file creates a document with those pages', async ({ page }) => {
  await menu(page, 'import');
  await file(page, 'pages.drawio', `<mxfile><diagram name="Erste">${cell('a', 'Erste Seite')}</diagram><diagram name="Zweite">${cell('a', 'Zweite Seite')}</diagram></mxfile>`);
  await select(page, 'Seite auswählen', 'Alle 2 Seiten importieren');
  await expect(page.getByTestId('interop-panel')).toContainText('2 Seiten');
  await page.getByRole('button', { name: 'Als neues Dokument öffnen' }).click();
  await expect(page.getByTestId('whiteboard-canvas')).toContainText('Erste Seite');
  await expect(page.getByTestId('page-switcher')).toHaveAccessibleName(/^Seiten \(2\)/);
  await page.getByTestId('page-switcher').click();
  await page.getByRole('button', { name: /^Zweite/ }).click();
  await expect(page.getByTestId('whiteboard-canvas')).toContainText('Zweite Seite');
  await expect(page.getByTestId('whiteboard-canvas')).not.toContainText('Erste Seite');
});

for (const extension of ['mmd', 'mermaid']) {
  test(`Mermaid .${extension} files are detected and only applied after preview`, async ({ page }) => {
    await menu(page, 'import');
    await file(page, `flow.${extension}`, 'flowchart LR\n  A[Browser] --> B[Server]');
    await expect(page.getByRole('combobox', { name: 'Format', exact: true })).toHaveText('Mermaid');
    await expect(page.getByLabel('Mermaid-Code einfügen')).toHaveValue('flowchart LR\n  A[Browser] --> B[Server]');
    const preview = page.getByRole('img', { name: 'Sichere Vorschau des konvertierten Diagramms' });
    await expect(preview).toContainText('Browser'); await expect(preview).toContainText('Server');
    await expect(page.getByTestId('whiteboard-canvas').locator('[data-element-id]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Als neues Dokument öffnen', exact: true }).click();
    await expect(page.getByTestId('interop-panel')).not.toBeVisible();
    await expect(page.getByTestId('whiteboard-canvas')).toContainText('Browser');
    await expect(page.getByTestId('whiteboard-canvas')).toContainText('Server');
    await expect(page.getByTestId('whiteboard-canvas').locator('[data-kind=connector]')).toHaveCount(1);
  });
}

test('pasted Mermaid requires explicit preview; edits and unsupported diagrams cannot replace the canvas', async ({ page }) => {
  await rectangle(page); await menu(page, 'import');
  await select(page, 'Format', 'Mermaid');
  const source = page.getByLabel('Mermaid-Code einfügen');
  const preview = page.getByRole('button', { name: 'Importvorschau erstellen', exact: true });
  const apply = page.getByRole('button', { name: 'Als neues Dokument öffnen', exact: true });
  await source.fill('```mermaid\nflowchart TD\n A[Quelle] --> B[Ziel]\n```');
  await expect(apply).toHaveCount(0);
  await preview.click(); await expect(apply).toBeEnabled();
  await apply.click(); await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(page.getByTestId('whiteboard-canvas').locator('[data-kind=rectangle]')).toHaveCount(1);
  await expect(apply).toBeVisible();
  await source.fill('pie title Anteile\n "A": 40\n "B": 60');
  await expect(apply).toHaveCount(0);
  await preview.click();
  await expect(page.getByRole('alert')).toContainText('Dieser Mermaid-Diagrammtyp wird nicht unterstützt');
  await expect(page.getByRole('alert')).toContainText('Dein Dokument bleibt erhalten');
  await expect(apply).toHaveCount(0);
  await expect(page.getByTestId('whiteboard-canvas').locator('[data-kind=rectangle]')).toHaveCount(1);
  await source.fill('flowchart LR\n A[Neu] --> B[Ziel]');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(apply).toHaveCount(0);
  await preview.click();
  await expect(page.getByRole('img', { name: 'Sichere Vorschau des konvertierten Diagramms' })).toContainText('Neu');
});

test('Mermaid exports a real .mmd download and roundtrips the embedded document', async ({ page }) => {
  await rectangle(page); await page.getByTestId('document-title').fill('Mermaid Roundtrip');
  await menu(page, 'export'); await select(page, 'Format', 'Mermaid');
  await page.getByRole('button', { name: 'Exportvorschau erstellen', exact: true }).click();
  await expect(page.getByTestId('interop-panel')).toContainText('Mermaid vorbereitet');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Datei exportieren', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('Mermaid Roundtrip.mmd');
  const mermaid = await readFile((await download.path())!, 'utf8');
  expect(mermaid).toMatch(/^flowchart\s/m); expect(mermaid).toContain('sketchdraw');
  await expect(page.getByTestId('save-status')).not.toHaveAttribute('data-status', 'saved');
  await menu(page, 'import'); await file(page, 'roundtrip.mmd', mermaid);
  await expect(page.getByTestId('interop-panel')).toContainText('Eigener unveränderter Roundtrip');
  await page.getByRole('button', { name: 'Als neues Dokument öffnen', exact: true }).click();
  await page.getByRole('button', { name: 'Verwerfen', exact: true }).click();
  await expect(page.getByTestId('document-title')).toHaveValue('Mermaid Roundtrip');
  await expect(page.getByTestId('whiteboard-canvas').locator('[data-kind=rectangle]')).toHaveCount(1);
});

test('Mermaid defaults to the active page and exports the explicitly selected page', async ({ page }) => {
  await menu(page, 'import');
  await file(page, 'pages.drawio', `<mxfile><diagram name="Erste">${cell('a', 'Erste Seite')}</diagram><diagram name="Zweite">${cell('b', 'Zweite Seite')}</diagram></mxfile>`);
  await select(page, 'Seite auswählen', 'Alle 2 Seiten importieren');
  await page.getByRole('button', { name: 'Als neues Dokument öffnen', exact: true }).click();
  await page.getByTestId('page-switcher').click(); await page.getByRole('button', { name: /^Zweite/ }).click();
  await menu(page, 'export'); await select(page, 'Format', 'Mermaid');
  const selectedPage = page.getByRole('combobox', { name: 'Seite für den Mermaid-Export', exact: true });
  await expect(selectedPage).toHaveText('Zweite');
  await page.getByRole('checkbox', { name: 'Vollständiges Sketchdraw-Modell einbetten' }).uncheck();
  for (const label of ['Zweite', 'Erste']) {
    await select(page, 'Seite für den Mermaid-Export', label);
    await expect(page.getByRole('button', { name: 'Datei exportieren', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Exportvorschau erstellen', exact: true }).click();
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Datei exportieren', exact: true }).click();
    const mermaid = await readFile((await (await downloadEvent).path())!, 'utf8');
    expect(mermaid).toContain(`${label} Seite`);
    expect(mermaid).not.toContain(`${label === 'Erste' ? 'Zweite' : 'Erste'} Seite`);
  }
});

test('a Mermaid roundtrip previews its exported second page and reports the restored pages', async ({ page }) => {
  await menu(page, 'import');
  await file(page, 'pages.drawio', `<mxfile><diagram name="Erste">${cell('a', 'Erste Seite')}</diagram><diagram name="Zweite">${cell('b', 'Zweite Seite')}</diagram></mxfile>`);
  await select(page, 'Seite auswählen', 'Alle 2 Seiten importieren');
  await page.getByRole('button', { name: 'Als neues Dokument öffnen', exact: true }).click();
  await menu(page, 'export'); await select(page, 'Format', 'Mermaid');
  await select(page, 'Seite für den Mermaid-Export', 'Zweite');
  await page.getByRole('button', { name: 'Exportvorschau erstellen', exact: true }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Datei exportieren', exact: true }).click();
  const mermaid = await readFile((await (await downloadEvent).path())!, 'utf8');
  await menu(page, 'import'); await file(page, 'second-page.mmd', mermaid);
  const preview = page.getByRole('img', { name: 'Sichere Vorschau des konvertierten Diagramms' });
  await expect(preview).toContainText('Zweite Seite'); await expect(preview).not.toContainText('Erste Seite');
  await expect(page.getByTestId('interop-panel')).toContainText('Eigener unveränderter Roundtrip');
  await expect(page.getByTestId('interop-panel')).toContainText('2 Seiten');
  await expect(page.getByTestId('whiteboard-canvas')).toContainText('Erste Seite');
  await page.getByRole('button', { name: 'Als neues Dokument öffnen', exact: true }).click();
  await page.getByRole('button', { name: 'Verwerfen', exact: true }).click();
  await expect(page.getByTestId('page-switcher')).toHaveAccessibleName(/^Seiten \(2\)/);
  await page.getByTestId('page-switcher').click(); await page.getByRole('button', { name: /^Zweite/ }).click();
  await expect(page.getByTestId('whiteboard-canvas')).toContainText('Zweite Seite');
});

test('a multi-MiB Mermaid roundtrip keeps its image without putting the file in a textarea', async ({ page }) => {
  // A real decodable PNG with deterministic noisy pixels keeps the embedded file large.
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 800;
    const context = canvas.getContext('2d')!; const pixels = context.createImageData(800, 800);
    let seed = 42;
    for (let i = 0; i < pixels.data.length; i += 4) {
      for (let channel = 0; channel < 3; channel++) {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        pixels.data[i + channel] = seed & 255;
      }
      pixels.data[i + 3] = 255;
    }
    context.putImageData(pixels, 0, 0); return canvas.toDataURL('image/png');
  });
  const diagram = createDocument('Large Mermaid image');
  diagram.assets['image:large'] = { id: 'image:large', name: 'large.png', mimeType: 'image/png', dataUrl };
  diagram.elements.push(createElement('image', { id: 'large-image', assetId: 'image:large', width: 320, height: 320 }));
  const mermaid = prepareMermaidExport(diagram).contents;
  expect(Buffer.byteLength(mermaid)).toBeGreaterThan(3 * 1024 * 1024);
  await menu(page, 'import'); await file(page, 'large-image.mmd', mermaid);
  const panel = page.getByTestId('interop-panel');
  await expect(panel).toContainText('large-image.mmd');
  await expect(panel).toContainText('Die vollständige Datei bleibt für Vorschau und Import erhalten');
  await expect(panel).toContainText('Eigener unveränderter Roundtrip');
  await expect(page.getByLabel('Mermaid-Code einfügen')).toHaveCount(0);
  const previewImage = panel.locator('svg.preview [data-kind=image] image');
  await expect(previewImage).toHaveCount(1);
  expect(await previewImage.evaluate((image, expected) => image.getAttribute('href') === expected, dataUrl)).toBe(true);
  await page.getByRole('button', { name: 'Als neues Dokument öffnen', exact: true }).click();
  await expect(page.getByTestId('document-title')).toHaveValue('Large Mermaid image');
  const image = page.getByTestId('whiteboard-canvas').locator('[data-kind=image] image');
  await expect(image).toHaveCount(1);
  expect(await image.evaluate((node, expected) => node.getAttribute('href') === expected, dataUrl)).toBe(true);
  // Starting a new text input is explicit and only discards the import preview.
  await menu(page, 'import'); await file(page, 'large-image.mmd', mermaid);
  await page.getByRole('button', { name: 'Eigenen Mermaid-Code eingeben', exact: true }).click();
  await expect(page.getByLabel('Mermaid-Code einfügen')).toHaveValue('');
  await expect(page.getByLabel('Mermaid-Code einfügen')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Als neues Dokument öffnen', exact: true })).toHaveCount(0);
  await expect(image).toHaveCount(1);
});

test('changing format during a pending export snapshot discards the old preview', async ({ page }) => {
  await rectangle(page); await menu(page, 'export');
  await select(page, 'Format', 'SVG');
  // Hold the next real document commit so prepareDocumentSnapshot awaits a draft.
  await page.evaluate(() => {
    const original = crypto.subtle.digest.bind(crypto.subtle);
    const gate = { held: false, release: async () => {} };
    let finishDigest!: () => void;
    const digestFinished = new Promise<void>(resolve => { finishDigest = resolve; });
    (window as unknown as { exportGate: typeof gate }).exportGate = gate;
    crypto.subtle.digest = async (algorithm, data) => {
      crypto.subtle.digest = original;
      gate.held = true;
      await new Promise<void>(resolve => {
        gate.release = async () => {
          resolve(); await digestFinished;
          // Let the commit and its Vue updates finish before asserting invalidation.
          await new Promise<void>(painted => requestAnimationFrame(() => painted()));
        };
      });
      try { return await original(algorithm, data); } finally { finishDigest(); }
    };
  });
  await page.getByTestId('document-title').fill('Pending export');
  await page.getByRole('button', { name: 'Exportvorschau erstellen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { exportGate: { held: boolean } }).exportGate.held)).toBe(true);
  await expect(page.getByTestId('interop-panel')).toContainText('Wird geprüft');
  await select(page, 'Format', 'Mermaid');
  await page.evaluate(() => (window as unknown as { exportGate: { release: () => Promise<void> } }).exportGate.release());
  await expect(page.getByTestId('document-title')).toHaveValue('Pending export');
  await expect(page.getByRole('button', { name: 'Datei exportieren', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('interop-panel')).not.toContainText('SVG vorbereitet');
  await page.getByRole('button', { name: 'Exportvorschau erstellen', exact: true }).click();
  await expect(page.getByTestId('interop-panel')).toContainText('Mermaid vorbereitet');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Datei exportieren', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/\.mmd$/);
  expect(await readFile((await download.path())!, 'utf8')).toMatch(/^flowchart\s/m);
});

test('a Mermaid sequence diagram is imported into the current page as an editable sequence diagram (#248)', async ({ page }) => {
  await rectangle(page); await menu(page, 'import');
  await select(page, 'Format', 'Mermaid');
  const panel = page.getByTestId('interop-panel');
  await expect(panel).toContainText('Importiert werden Flowcharts (flowchart, graph) und Sequenzdiagramme (sequenceDiagram).');
  const source = page.getByLabel('Mermaid-Code einfügen');
  const preview = page.getByRole('button', { name: 'Importvorschau erstellen', exact: true });
  const insert = page.getByRole('button', { name: 'In die aktuelle Seite einfügen', exact: true });

  // Code with an error names its line and changes nothing.
  await source.fill('sequenceDiagram\n    Note irgendwo: Text\n    Client->>Dienst: Anfrage');
  await preview.click();
  await expect(page.getByRole('alert')).toContainText('Der Code des Sequenzdiagramms hat Fehler');
  await expect(panel.getByRole('region', { name: 'Grund des Fehlers' })).toContainText('Zeile 2');
  await expect(insert).toHaveCount(0);

  await source.fill('```mermaid\nsequenceDiagram\n    actor Kunde\n    participant Dienst\n    Kunde->>Dienst: Bestellen\n    Dienst-->>Kunde: Bestätigung\n```');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await preview.click();
  await expect(page.getByRole('img', { name: 'Sichere Vorschau des konvertierten Diagramms' })).toContainText('Bestellen');
  await expect(page.getByRole('button', { name: 'Als neues Dokument öffnen', exact: true })).toBeEnabled();
  expect((await new AxeBuilder({ page }).include('[data-testid="interop-panel"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);

  // Inserted, the diagram stands beside what was there, selected, and the panel is closed.
  await insert.click();
  await expect(panel).toHaveCount(0);
  const canvas = page.getByTestId('whiteboard-canvas');
  await expect(canvas.locator('[data-kind=rectangle]').first()).toBeVisible();
  await expect(canvas.locator('[data-sequence-role="lifeline"]')).toHaveCount(2);
  await expect(canvas.locator('[data-sequence-role="message"]')).toHaveCount(2);
  await expect(canvas.getByTestId('sequence-actor')).toBeVisible();

  // It is a sequence diagram of the app: its code is available, and one undo takes the import back.
  await page.getByRole('toolbar', { name: 'Eigenschaften' }).getByRole('button', { name: 'Elementaktionen' }).click();
  await page.getByRole('button', { name: 'Mermaid-Code anzeigen' }).click();
  await expect(page.getByTestId('diagram-code-editor')).toHaveValue(/actor Kunde\n {4}participant Dienst\n {4}Kunde->>Dienst: Bestellen\n {4}Dienst-->>Kunde: Bestätigung/);
  await page.getByRole('button', { name: 'Mermaid-Code schließen' }).click();
  await canvas.focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(canvas.locator('[data-sequence-role="lifeline"]')).toHaveCount(0);
  await expect(canvas.locator('[data-kind=rectangle]')).toHaveCount(1);
});

test('a Mermaid file with a sequence diagram can be opened as a new document (#248)', async ({ page }) => {
  await menu(page, 'import');
  await file(page, 'ablauf.mmd', 'sequenceDiagram\n    Client->>Dienst: Anfrage\n    Dienst-->>Client: Antwort\n');
  await expect(page.getByRole('img', { name: 'Sichere Vorschau des konvertierten Diagramms' })).toContainText('Anfrage');
  await page.getByRole('button', { name: 'Als neues Dokument öffnen', exact: true }).click();
  await expect(page.getByTestId('whiteboard-canvas').locator('[data-sequence-role="lifeline"]')).toHaveCount(2);
});

test('a sequence diagram is exported as Mermaid sequenceDiagram; with other shapes on the page the diagram is chosen (#261)', async ({ page }) => {
  const code = 'sequenceDiagram\n    participant Client\n    participant Dienst\n    Client->>Dienst: Anfrage\n    Dienst-->>Client: Antwort\n';
  await menu(page, 'import'); await select(page, 'Format', 'Mermaid');
  await page.getByLabel('Mermaid-Code einfügen').fill(code);
  await page.getByRole('button', { name: 'Importvorschau erstellen', exact: true }).click();
  await page.getByRole('button', { name: 'In die aktuelle Seite einfügen', exact: true }).click();
  await expect(page.getByTestId('interop-panel')).toHaveCount(0);
  await page.keyboard.press('Escape');

  const exportOnce = async (embed: boolean) => {
    await page.getByRole('checkbox', { name: 'Vollständiges Sketchdraw-Modell einbetten' }).setChecked(embed);
    await page.getByRole('button', { name: 'Exportvorschau erstellen', exact: true }).click();
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Datei exportieren', exact: true }).click();
    return readFile((await (await downloadEvent).path())!, 'utf8');
  };

  // Only the sequence diagram is on the page: there is nothing to choose, and the file is the code of the diagram.
  await menu(page, 'export'); await select(page, 'Format', 'Mermaid');
  const panel = page.getByTestId('interop-panel');
  await expect(panel).toContainText('Exportiert wird das Sequenzdiagramm als Mermaid-Code (sequenceDiagram).');
  await expect(panel.getByRole('combobox', { name: 'Diagramm', exact: true })).toHaveCount(0);
  expect(await exportOnce(false)).toBe(code);
  await panel.getByRole('button', { name: 'Austauschansicht schließen' }).click();

  // With a shape next to it the page holds two diagrams for Mermaid; the sequence diagram stays the default.
  await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
  await page.mouse.move(980, 620); await page.mouse.down(); await page.mouse.move(1120, 700); await page.mouse.up();
  await page.keyboard.press('Escape');
  await menu(page, 'export'); await select(page, 'Format', 'Mermaid');
  const target = panel.getByRole('combobox', { name: 'Diagramm', exact: true });
  await expect(target).toHaveText('Sequenzdiagramm: Client, Dienst');
  const withDocument = await exportOnce(true);
  expect(withDocument.startsWith(code)).toBe(true);
  expect(withDocument).toContain('%% sketchdraw-mermaid-v1 0 ');

  await select(page, 'Diagramm', 'Flowchart aus den übrigen Formen');
  await expect(panel).toContainText('Exportiert wird ein Flowchart aus Formen, Texten, Komponenten und den Pfeilen dazwischen.');
  const flowchart = await exportOnce(false);
  expect(flowchart).toBe('flowchart LR\n  n0[" "]\n');
  expect((await new AxeBuilder({ page }).include('[data-testid=interop-panel]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
});

test('the import file is chosen with a button of the app, in the language of the app (#278)', async ({ page }) => {
  await menu(page, 'import');
  const panel = page.getByTestId('interop-panel');
  const choose = panel.getByRole('button', { name: 'Datei auswählen', exact: true });
  await expect(choose).toBeVisible();
  await expect(choose).toHaveAccessibleDescription('SVG-, draw.io- oder Mermaid-Datei auswählen');
  await expect(panel.getByTestId('interop-file-name')).toHaveText('Keine Datei ausgewählt');
  // The field of the operating system is not shown; the button opens its dialog.
  await expect(panel.getByTestId('interop-file')).toHaveCSS('position', 'absolute');
  const chooser = page.waitForEvent('filechooser');
  await choose.click();
  await (await chooser).setFiles({ name: 'karte.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="10" y="10" width="50" height="30" fill="#ffffff" stroke="#000000"/></svg>') });
  await expect(panel.getByTestId('interop-file-name')).toHaveText('karte.svg');
  await expect(panel.getByRole('button', { name: 'Als neues Dokument öffnen', exact: true })).toBeEnabled();
  await panel.screenshot({ path: 'test-results/interop-file-button.png' });

  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('sketchdraw.preferences.v1') ?? '{}');
    localStorage.setItem('sketchdraw.preferences.v1', JSON.stringify({ ...raw, version: raw.version ?? 1, language: 'en' }));
  });
  await page.reload();
  await page.getByTestId('file-menu-button').click(); await page.getByTestId('file-menu-interopImport').click();
  await expect(page.getByTestId('interop-panel').getByRole('button', { name: 'Choose file', exact: true })).toBeVisible();
  await expect(page.getByTestId('interop-file-name')).toHaveText('No file chosen');
});
