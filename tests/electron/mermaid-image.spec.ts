import { cp, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { stopElectron } from './helpers/stop-electron';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// #279: in the built desktop app Mermaid is loaded from the app's own files, under the content security policy of
// the app, and draws a diagram the app has no shapes for.
test('the desktop app draws a Mermaid class diagram as an image and changes it through its code', async () => {
  test.setTimeout(90_000);
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-mermaid-product-')));
  let app: ElectronApplication | undefined;
  try {
    for (const dir of ['dist', 'dist-electron', 'dist-mcp']) await cp(path.join(projectRoot, dir), path.join(root, dir), { recursive: true });
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'sketchdraw-mermaid-test', version: '0.0.0', main: 'entry.cjs' }));
    await writeFile(path.join(root, 'entry.cjs'), "const {app}=require('electron');const path=require('node:path');app.setPath('userData',path.join(__dirname,'profile'));app.setPath('sessionData',path.join(__dirname,'session'));require('./dist-electron/main.cjs');");
    const environment = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !/^(ELECTRON_RUN_AS_NODE|ELECTRON_DISABLE_SANDBOX|NODE_OPTIONS|NODE_PATH|SKETCHDRAW_.*)$/i.test(entry[0])));
    app = await electron.launch({ args: [root], env: environment, chromiumSandbox: true });
    const page = await app.firstWindow();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const blocked: string[] = []; page.on('console', message => { if (/Content Security Policy|Refused to/i.test(message.text())) blocked.push(message.text().slice(0, 200)); });
    await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();

    await page.getByTestId('file-menu-button').click(); await page.getByTestId('file-menu-interopImport').click();
    await page.getByRole('combobox', { name: 'Format', exact: true }).click();
    await page.getByRole('listbox', { name: 'Format', exact: true }).getByRole('option', { name: 'Mermaid', exact: true }).click();
    await page.getByLabel('Mermaid-Code einfügen').fill('classDiagram\n    Animal <|-- Duck\n    Animal : +int age');
    await page.getByRole('button', { name: 'Importvorschau erstellen', exact: true }).click();
    await expect(page.getByTestId('interop-mermaid-image')).toContainText('Von Mermaid gezeichnet', { timeout: 30_000 });
    await page.getByRole('button', { name: 'In die aktuelle Seite einfügen', exact: true }).click();
    const image = page.getByTestId('whiteboard-canvas').locator('[data-kind=image]');
    await expect(image).toHaveCount(1);
    const first = await image.locator('image').getAttribute('href');
    expect(first).toMatch(/^data:image\/png;base64,/);

    // The code of the image is changed and drawn again.
    await page.getByRole('toolbar', { name: 'Eigenschaften' }).getByRole('button', { name: 'Elementaktionen' }).click();
    await page.getByTestId('open-diagram-code').click();
    const editor = page.getByTestId('diagram-code-editor');
    await editor.fill('classDiagram\n    Animal <|-- Duck\n    Animal <|-- Fish\n    Animal : +int age');
    await page.getByTestId('diagram-code-redraw').click();
    await expect(page.getByTestId('diagram-code-status')).toHaveText('Code und Bild sind auf demselben Stand.', { timeout: 30_000 });
    expect(await image.locator('image').getAttribute('href')).not.toBe(first);
    expect(errors).toEqual([]);
    expect(blocked).toEqual([]);
  } finally {
    if (app) await stopElectron(app);
    // Windows releases the session files a moment after the app has stopped.
    await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
  }
});
