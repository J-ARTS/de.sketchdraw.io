import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

// #279: Mermaid draws every kind of diagram the app has no shapes for; it comes as an image that carries its code.
const DIR = 'tests/fixtures/mermaid-examples/all';
const EXAMPLES = readdirSync(DIR).filter((name) => name.endsWith('.mmd')).sort().map((name) => ({ name, code: readFileSync(`${DIR}/${name}`, 'utf8') }));
const CLASS = 'classDiagram\n    Animal <|-- Duck\n    Animal : +int age\n    class Duck{\n      +String beakColor\n      +swim()\n    }';

async function menu(page: Page, kind: 'import' | 'export') {
  await page.getByTestId('file-menu-button').click(); await page.getByTestId(kind === 'import' ? 'file-menu-interopImport' : 'file-menu-interopExport').click();
}
async function select(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('listbox', { name: label, exact: true }).getByRole('option', { name: option, exact: true }).click();
}
test.beforeEach(async ({ page }) => { page.on('pageerror', (error) => { throw error; }); await page.goto('/'); await expect(page.getByTestId('whiteboard-canvas')).toBeVisible(); });

test('every example of mermaid.js.org that is not a flowchart or a sequence diagram is drawn as an image, under the content security policy of the app', async ({ page }) => {
  test.setTimeout(180_000);
  const others = EXAMPLES.filter((example) => !/^(flowchart|sequence)-/.test(example.name));
  expect(others).toHaveLength(74);
  const blocked: string[] = [];
  page.on('console', (message) => { if (/Content Security Policy|Refused to/i.test(message.text())) blocked.push(message.text().slice(0, 200)); });
  // The app's own function, loaded as the app loads it, in the page of the app.
  const results = await page.evaluate(async (list) => {
    const module = await import(/* @vite-ignore */ '/src/renderer/lib/mermaid-render.ts' as string) as { renderMermaidImage: (code: string) => Promise<{ dataUrl: string; width: number; height: number }> };
    const out: Array<{ name: string; ok: boolean; detail: string }> = [];
    for (const { name, code } of list) {
      try {
        const drawn = await module.renderMermaidImage(code);
        // A picture, not an empty sheet: it has a size and more bytes than a blank PNG of that size.
        out.push({ name, ok: drawn.dataUrl.startsWith('data:image/png;base64,') && drawn.width > 20 && drawn.height > 20 && drawn.dataUrl.length > 2000, detail: `${Math.round(drawn.width)}x${Math.round(drawn.height)} ${drawn.dataUrl.length}` });
      } catch (error) { out.push({ name, ok: false, detail: (error as Error).message.slice(0, 200) }); }
    }
    return out;
  }, others);
  expect(results.filter((entry) => !entry.ok)).toEqual([]);
  expect(results).toHaveLength(74);
  expect(blocked).toEqual([]);

  // ELK is not shipped (EPL-2.0 or GPL-3.0): Mermaid's own layout draws everything above, and code that asks for
  // ELK says so instead of being drawn.
  const elk = await page.evaluate(async () => {
    const module = await import(/* @vite-ignore */ '/src/renderer/lib/mermaid-render.ts' as string) as { renderMermaidImage: (code: string) => Promise<unknown> };
    return module.renderMermaidImage('---\nconfig:\n  layout: elk\n---\nclassDiagram\n    Animal <|-- Duck').then(() => 'drawn', (error: Error) => error.message);
  });
  expect(elk).toBe('The ELK layout is not part of Sketchdraw. Remove "layout: elk" from the code.');
});

for (const theme of ['light', 'dark'] as const) {
  test(`a class diagram is imported as an image, changed through its code and exported as that code (${theme})`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.evaluate((value) => localStorage.setItem('sketchdraw.preferences.v1', JSON.stringify({ theme: value, language: 'de', canvasBackground: null })), theme);
    await page.reload(); await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
    await menu(page, 'import'); await select(page, 'Format', 'Mermaid');
    const panel = page.getByTestId('interop-panel');
    await expect(panel).toContainText('Jede andere Diagrammart zeichnet Mermaid selbst');
    await page.getByLabel('Mermaid-Code einfügen').fill(CLASS);
    await page.getByRole('button', { name: 'Importvorschau erstellen', exact: true }).click();
    await expect(page.getByTestId('interop-mermaid-image')).toContainText('Von Mermaid gezeichnet', { timeout: 30_000 });
    await expect(panel).toContainText('classDiagram');
    expect((await new AxeBuilder({ page }).include('[data-testid="interop-panel"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    await page.getByRole('button', { name: 'In die aktuelle Seite einfügen', exact: true }).click();

    // On the canvas it is one image, selected; its code is one click away.
    const image = page.getByTestId('whiteboard-canvas').locator('[data-kind=image]');
    await expect(image).toHaveCount(1);
    const first = await image.locator('image').getAttribute('href');
    expect(first).toMatch(/^data:image\/png;base64,/);
    await page.getByRole('toolbar', { name: 'Eigenschaften' }).getByRole('button', { name: 'Elementaktionen' }).click();
    await page.getByTestId('open-diagram-code').click();
    const code = page.getByTestId('diagram-code-panel');
    await expect(code).toHaveAttribute('data-kind', 'mermaid');
    await expect(code.getByRole('heading', { name: 'Diagramm als Mermaid-Code' })).toBeVisible();
    const editor = code.getByTestId('diagram-code-editor');
    await expect(editor).toHaveValue(CLASS);
    await expect(code.getByTestId('diagram-code-status')).toHaveText('Code und Bild sind auf demselben Stand.');
    await expect(code.getByTestId('diagram-code-redraw')).toBeDisabled();

    // A mistake in the code leaves the image as it is and says what Mermaid said.
    await editor.fill(`${CLASS}\n    Animal <|-- `);
    await expect(code.getByTestId('diagram-code-status')).toHaveText('Geändert. „Neu zeichnen“ übernimmt den Code in das Bild.');
    await expect(image.locator('image')).toHaveAttribute('href', first!);
    await code.getByTestId('diagram-code-redraw').click();
    await expect(code.getByTestId('diagram-code-status')).toContainText('Mermaid kann diesen Code nicht lesen', { timeout: 30_000 });
    await expect(code.getByTestId('diagram-code-status')).toContainText('Das Bild ist unverändert.');
    await expect(image.locator('image')).toHaveAttribute('href', first!);

    // Correct code is drawn again: another picture in the same element.
    await editor.fill(`${CLASS}\n    Animal <|-- Fish`);
    await editor.press('ControlOrMeta+Enter');
    await expect(code.getByTestId('diagram-code-status')).toHaveText('Code und Bild sind auf demselben Stand.', { timeout: 30_000 });
    await expect(image).toHaveCount(1);
    expect(await image.locator('image').getAttribute('href')).not.toBe(first);
    expect((await new AxeBuilder({ page }).include('[data-testid="diagram-code-panel"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    if (process.env.TICKET_SHOTS) await page.screenshot({ path: `/tmp/shots/mermaid-image-${theme}.png` });
    await code.getByRole('button', { name: 'Mermaid-Code schließen' }).click();

    // The Mermaid export of the image is its code; the file comes back as the whole document.
    await menu(page, 'export'); await select(page, 'Format', 'Mermaid');
    await expect(panel).toContainText('Exportiert wird der Code, den das von Mermaid gezeichnete Bild trägt.');
    await page.getByRole('button', { name: 'Exportvorschau erstellen', exact: true }).click();
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Datei exportieren', exact: true }).click();
    const exported = await readFile((await (await downloadEvent).path())!, 'utf8');
    expect(exported.startsWith(`${CLASS}\n    Animal <|-- Fish\n`)).toBe(true);
    expect(exported).toContain('%% sketchdraw-mermaid-v1 ');
  });
}
