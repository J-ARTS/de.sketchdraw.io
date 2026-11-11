import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { stopElectron } from './helpers/stop-electron';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('bundled plugins configure through the real desktop bridge and stay with their document folder', async ({}, testInfo) => {
  test.setTimeout(90_000);
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-plugins-product-')));
  let app: ElectronApplication | undefined;
  try {
    for (const dir of ['dist', 'dist-electron', 'dist-mcp']) await cp(path.join(projectRoot, dir), path.join(root, dir), { recursive: true });
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'sketchdraw-plugins-test', version: '0.0.0', main: 'entry.cjs' }));
    await writeFile(path.join(root, 'entry.cjs'), "const {app}=require('electron');const path=require('node:path');app.setPath('userData',path.join(__dirname,'profile'));app.setPath('sessionData',path.join(__dirname,'session'));require('./dist-electron/main.cjs');");
    const folderA = path.join(root, 'project-a'); const folderB = path.join(root, 'project-b');
    await mkdir(folderA); await mkdir(folderB);
    app = await electron.launch({ args: [root], env: Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !/^(ELECTRON_RUN_AS_NODE|ELECTRON_DISABLE_SANDBOX|NODE_OPTIONS|NODE_PATH|SKETCHDRAW_.*)$/i.test(entry[0]))), chromiumSandbox: true });
    const desktop = app; const page = await desktop.firstWindow();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
    const openPlugins = async () => {
      await page.getByTestId('workspace-menu-button').click();
      await page.getByRole('menuitemcheckbox', { name: 'Plugin-Einstellungen' }).click();
      return page.getByRole('dialog', { name: 'Plugins', exact: true });
    };
    const chooseSavePath = async (filePath: string) => desktop.evaluate(({ dialog }, destination) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination }); }, filePath);
    let dialog = await openPlugins();
    await expect(dialog.getByRole('tab', { name: /Installiert.*2/ })).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.getByRole('button', { name: 'Git speichern', exact: true })).toBeDisabled();
    await chooseSavePath(path.join(folderA, 'first.sketchdraw.json'));
    await dialog.getByRole('button', { name: 'Diagramm speichern', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Git speichern', exact: true })).toBeEnabled();
    await expect(dialog).toContainText(folderA);
    await dialog.getByLabel('Remote', { exact: true }).fill('team');
    await dialog.getByRole('button', { name: 'Git speichern', exact: true }).click();
    await expect.poll(async () => JSON.parse(await readFile(path.join(folderA, '.sketchdraw-plugins.json'), 'utf8').catch(() => '{}'))?.git?.remote).toBe('team');
    await dialog.getByRole('button', { name: /Jira Aufgaben/ }).click();
    await dialog.getByLabel('Atlassian-URL', { exact: true }).fill('http://example.atlassian.net');
    await dialog.getByRole('button', { name: 'Jira speichern', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Atlassian benötigt eine HTTPS-URL');
    await expect(dialog.getByLabel('Atlassian-URL', { exact: true })).toHaveValue('http://example.atlassian.net');
    await dialog.getByLabel('Atlassian-URL', { exact: true }).fill('https://example.atlassian.net');
    await dialog.getByLabel('Username oder E-Mail', { exact: true }).fill('test@example.invalid');
    await dialog.getByLabel('Jira-Projekt', { exact: true }).fill('ARCH');
    await dialog.getByLabel('JQL-Filter', { exact: true }).fill('project = ARCH');
    await dialog.getByRole('button', { name: 'Jira speichern', exact: true }).click();
    await expect.poll(async () => JSON.parse(await readFile(path.join(folderA, '.sketchdraw-plugins.json'), 'utf8').catch(() => '{}'))?.atlassian?.jqlFilter).toBe('project = ARCH');
    const configurationA = JSON.parse(await readFile(path.join(folderA, '.sketchdraw-plugins.json'), 'utf8').catch(() => '{}'));
    expect(configurationA.git).toMatchObject({ installed: true, enabled: false, remote: 'team' });
    expect(configurationA.atlassian).toMatchObject({ installed: true, enabled: false, jiraProjectKey: 'ARCH' });
    await dialog.getByRole('button', { name: 'Plugin-Einstellungen schließen' }).click();

    // A sibling document intentionally reuses the same folder configuration.
    await chooseSavePath(path.join(folderA, 'sibling.sketchdraw.json'));
    await desktop.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('file-save-as')!.click());
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved');
    dialog = await openPlugins();
    await dialog.getByRole('button', { name: /Jira Aufgaben/ }).click();
    await expect(dialog.getByLabel('JQL-Filter', { exact: true })).toHaveValue('project = ARCH');
    await dialog.getByRole('button', { name: 'Plugin-Einstellungen schließen' }).click();

    // Saving into a different folder must immediately show fresh, disabled integrations.
    await chooseSavePath(path.join(folderB, 'different.sketchdraw.json'));
    await desktop.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('file-save-as')!.click());
    await expect.poll(async () => readFile(path.join(folderB, 'different.sketchdraw.json'), 'utf8').then(() => true).catch(() => false)).toBe(true);
    dialog = await openPlugins();
    await expect(dialog).toContainText(folderB);
    await dialog.getByRole('button', { name: /Jira Aufgaben/ }).click();
    await expect(dialog.getByLabel('JQL-Filter', { exact: true })).toHaveValue('');
    await expect(dialog.getByLabel('Username oder E-Mail', { exact: true })).toHaveValue('');
    expect(JSON.parse(await readFile(path.join(folderA, '.sketchdraw-plugins.json'), 'utf8').catch(() => '{}'))).toEqual(configurationA);
    await dialog.getByRole('button', { name: 'Plugin-Einstellungen schließen' }).click();
    await page.getByTestId('file-menu-button').click(); await page.getByTestId('file-menu-new').click();
    dialog = await openPlugins();
    await expect(dialog.getByRole('button', { name: 'Diagramm speichern', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: /Jira Aufgaben/ }).click();
    await expect(dialog.getByRole('button', { name: 'Jira speichern', exact: true })).toBeDisabled();
    expect(errors).toEqual([]);
    await testInfo.attach('native-plugin-evidence', { body: JSON.stringify({ platform: process.platform, realBuiltRendererPreloadMainAndPersistence: true, nativeFileDialogResultStubbed: true, folderReuse: true, folderIsolation: true, realGitInitialization: true, jiraNetwork: 'not contacted; disabled configuration persistence tested' }), contentType: 'application/json' });
  } finally {
    if (app) await stopElectron(app);
    await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
});
