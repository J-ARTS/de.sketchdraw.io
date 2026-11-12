import { execFile as execFileCallback } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { stopElectron } from './helpers/stop-electron';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const execFile = promisify(execFileCallback);

test('Git status refreshes a stale remote-tracking branch without changing the worktree (#175)', async ({}, testInfo) => {
  test.setTimeout(120_000);
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-git-status-product-')));
  let app: ElectronApplication | undefined;
  try {
    for (const dir of ['dist', 'dist-electron', 'dist-mcp']) await cp(path.join(projectRoot, dir), path.join(root, dir), { recursive: true });
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'sketchdraw-git-status-test', version: '0.0.0', main: 'entry.cjs' }));
    await writeFile(path.join(root, 'entry.cjs'), "const {app}=require('electron');const path=require('node:path');app.setPath('userData',path.join(__dirname,'profile'));app.setPath('sessionData',path.join(__dirname,'session'));require('./dist-electron/main.cjs');");
    const project = path.join(root, 'project'); const remote = path.join(root, 'remote.git'); const updater = path.join(root, 'updater');
    await mkdir(project);
    const documentPath = path.join(project, 'status.sketchdraw.json');
    const environment = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !/^(ELECTRON_RUN_AS_NODE|ELECTRON_DISABLE_SANDBOX|NODE_OPTIONS|NODE_PATH|SKETCHDRAW_.*)$/i.test(entry[0])));
    app = await electron.launch({ args: [root], env: environment, chromiumSandbox: true });
    const page = await app.firstWindow();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
    await app.evaluate(({ dialog }, destination) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination }); }, documentPath);
    await page.getByTestId('workspace-menu-button').click();
    await page.getByRole('menuitemcheckbox', { name: 'Plugin-Einstellungen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Plugins', exact: true });
    await dialog.getByRole('button', { name: 'Diagramm speichern', exact: true }).click();
    await expect.poll(() => readFile(documentPath, 'utf8').then(() => true).catch(() => false)).toBe(true);

    await execFile('git', ['init', '--bare', remote]);
    await execFile('git', ['init', '-b', 'main'], { cwd: project });
    await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: project });
    await execFile('git', ['config', 'user.name', 'Sketchdraw Test'], { cwd: project });
    await execFile('git', ['add', path.basename(documentPath)], { cwd: project });
    await execFile('git', ['commit', '-m', 'Initial diagram'], { cwd: project });
    await execFile('git', ['remote', 'add', 'origin', remote], { cwd: project });
    await execFile('git', ['push', '-u', 'origin', 'main'], { cwd: project });
    await execFile('git', ['clone', '--branch', 'main', remote, updater]);
    await execFile('git', ['config', 'user.email', 'remote@example.com'], { cwd: updater });
    await execFile('git', ['config', 'user.name', 'Remote Test'], { cwd: updater });
    await writeFile(path.join(updater, 'remote-change.txt'), 'remote-only commit\n');
    await execFile('git', ['add', 'remote-change.txt'], { cwd: updater });
    await execFile('git', ['commit', '-m', 'Remote change'], { cwd: updater });
    await execFile('git', ['push', 'origin', 'main'], { cwd: updater });
    expect((await execFile('git', ['rev-list', '--left-right', '--count', 'HEAD...origin/main'], { cwd: project })).stdout.trim()).toBe('0\t0');
    const worktreeBefore = (await execFile('git', ['status', '--porcelain=v1'], { cwd: project })).stdout;

    await dialog.getByRole('button', { name: /Git Versionierung/ }).click();
    await dialog.getByRole('checkbox', { name: 'Aktiv', exact: true }).check();
    await dialog.getByLabel('Remote', { exact: true }).fill('origin');
    await dialog.getByRole('checkbox', { name: /Automatisch committen/ }).uncheck();
    await dialog.getByRole('checkbox', { name: /Automatisch abrufen/ }).uncheck();
    await dialog.getByRole('checkbox', { name: /Automatisch pushen/ }).uncheck();
    await dialog.getByRole('button', { name: 'Git speichern', exact: true }).click();
    await expect(dialog).toContainText('Remote-Stand noch nicht aktualisiert');
    await expect(dialog.locator('.status-grid')).toContainText('↑ 0 · ↓ 0');

    await dialog.getByRole('button', { name: 'Status prüfen', exact: true }).click();
    await expect(dialog).toContainText('Repository liegt hinter dem Remote.');
    await expect(dialog.locator('.status-grid')).toContainText('↑ 0 · ↓ 1');
    expect((await execFile('git', ['status', '--porcelain=v1'], { cwd: project })).stdout).toBe(worktreeBefore);
    expect((await execFile('git', ['rev-list', '--left-right', '--count', 'HEAD...origin/main'], { cwd: project })).stdout.trim()).toBe('0\t1');
    expect(errors).toEqual([]);
    await testInfo.attach('git-remote-status-evidence', { body: JSON.stringify({ platform: process.platform, staleBefore: { ahead: 0, behind: 0 }, refreshedAfter: { ahead: 0, behind: 1 }, worktreeUnchanged: true }), contentType: 'application/json' });
  } finally {
    if (app) await stopElectron(app);
    await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
});

test('bundled plugins configure through the real desktop bridge and stay with the editor profile, not the document folder', async ({}, testInfo) => {
  test.setTimeout(120_000);
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-plugins-product-')));
  let app: ElectronApplication | undefined;
  try {
    for (const dir of ['dist', 'dist-electron', 'dist-mcp']) await cp(path.join(projectRoot, dir), path.join(root, dir), { recursive: true });
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'sketchdraw-plugins-test', version: '0.0.0', main: 'entry.cjs' }));
    await writeFile(path.join(root, 'entry.cjs'), "const {app}=require('electron');const path=require('node:path');app.setPath('userData',path.join(__dirname,'profile'));app.setPath('sessionData',path.join(__dirname,'session'));require('./dist-electron/main.cjs');");
    const folderA = path.join(root, 'project-a'); const folderB = path.join(root, 'project-b');
    await mkdir(folderA); await mkdir(folderB);
    const storePath = path.join(root, 'profile', 'plugins.json');
    const store = async () => JSON.parse(await readFile(storePath, 'utf8').catch(() => '{}')) as { version?: number; activeProfileId?: string; profiles?: Array<{ id: string; name: string; git: Record<string, unknown>; atlassian: Record<string, unknown> }> };
    const exists = (file: string) => readFile(file).then(() => true).catch(() => false);
    const environment = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !/^(ELECTRON_RUN_AS_NODE|ELECTRON_DISABLE_SANDBOX|NODE_OPTIONS|NODE_PATH|SKETCHDRAW_.*)$/i.test(entry[0])));
    app = await electron.launch({ args: [root], env: environment, chromiumSandbox: true });
    let desktop = app; let page = await desktop.firstWindow();
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
    await expect(dialog.getByTestId('plugin-active-profile')).toContainText('Profil „Standard“');

    // The profile is configured before any diagram is saved.
    await expect(dialog.getByRole('button', { name: 'Git speichern', exact: true })).toBeEnabled();
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
    await expect.poll(async () => (await store()).profiles?.[0]?.atlassian?.jqlFilter).toBe('project = ARCH');
    expect(await store()).toMatchObject({ version: 3, activeProfileId: 'default', profiles: [{ id: 'default', name: 'Standard', atlassian: { installed: true, enabled: false, jiraProjectKey: 'ARCH' } }] });

    // Saving the diagram gives Git its folder; a disabled Git plugin is stored without touching that folder.
    await chooseSavePath(path.join(folderA, 'first.sketchdraw.json'));
    await dialog.getByRole('button', { name: 'Diagramm speichern', exact: true }).click();
    await expect(dialog).toContainText(folderA);
    await dialog.getByRole('button', { name: /Git Versionierung/ }).click();
    await dialog.getByLabel('Remote', { exact: true }).fill('team');
    await dialog.getByRole('button', { name: 'Git speichern', exact: true }).click();
    await expect.poll(async () => (await store()).profiles?.[0]?.git?.remote).toBe('team');
    expect(await exists(path.join(folderA, '.sketchdraw-plugins.json'))).toBe(false);
    expect(await exists(path.join(folderA, '.git', 'HEAD'))).toBe(false);

    // A second profile is created in the profile dialog behind the pen of the workspace menu; it starts empty and keeps its own settings.
    await dialog.getByRole('button', { name: 'Plugin-Einstellungen schließen' }).click();
    await page.getByTestId('workspace-menu-button').click();
    await page.getByTestId('workspace-menu-profiles-edit').click();
    const manager = page.getByRole('dialog', { name: 'Profile', exact: true });
    await manager.getByRole('button', { name: 'Neues Profil', exact: true }).click();
    await manager.getByRole('textbox', { name: 'Name des neuen Profils' }).fill('Kunde');
    await page.keyboard.press('Enter');
    await expect(manager.getByRole('listitem').filter({ hasText: 'Kunde' })).toHaveAttribute('aria-current', 'true');
    await manager.getByRole('button', { name: 'Fertig', exact: true }).click();
    dialog = await openPlugins();
    await expect(dialog.getByTestId('plugin-active-profile')).toContainText('Profil „Kunde“');
    await dialog.getByRole('button', { name: /Jira Aufgaben/ }).click();
    await expect(dialog.getByLabel('JQL-Filter', { exact: true })).toHaveValue('');
    await expect(dialog.getByLabel('Username oder E-Mail', { exact: true })).toHaveValue('');
    await dialog.getByLabel('Jira-Projekt', { exact: true }).fill('KUNDE');
    await dialog.getByRole('button', { name: 'Jira speichern', exact: true }).click();
    await expect.poll(async () => (await store()).profiles?.[1]?.atlassian?.jiraProjectKey).toBe('KUNDE');
    const saved = await store();
    expect(saved.activeProfileId).toBe(saved.profiles![1]!.id);
    expect(saved.profiles!.map(profile => profile.name)).toEqual(['Standard', 'Kunde']);
    expect(saved.profiles![0]!.atlassian).toMatchObject({ jiraProjectKey: 'ARCH', jqlFilter: 'project = ARCH' });
    await dialog.getByRole('button', { name: 'Plugin-Einstellungen schließen' }).click();

    // The active profile applies in every folder: a save into another folder changes nothing about it.
    await chooseSavePath(path.join(folderB, 'different.sketchdraw.json'));
    await desktop.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('file-save-as')!.click());
    await expect.poll(() => exists(path.join(folderB, 'different.sketchdraw.json'))).toBe(true);
    dialog = await openPlugins();
    await expect(dialog).toContainText(folderB);
    await expect(dialog.getByTestId('plugin-active-profile')).toContainText('Profil „Kunde“');
    await dialog.getByRole('button', { name: /Jira Aufgaben/ }).click();
    await expect(dialog.getByLabel('Jira-Projekt', { exact: true })).toHaveValue('KUNDE');
    await dialog.getByRole('button', { name: 'Plugin-Einstellungen schließen' }).click();
    expect(await exists(path.join(folderB, '.sketchdraw-plugins.json'))).toBe(false);

    // The dropdown of the workspace menu switches the profile above "Zusammenarbeiten".
    await page.getByTestId('workspace-menu-button').click();
    const profileSelect = page.getByTestId('workspace-menu-profiles').getByRole('combobox', { name: 'Profil', exact: true });
    await expect(profileSelect).toHaveText('Kunde');
    await profileSelect.click();
    const profileOptions = page.getByRole('listbox', { name: 'Profil', exact: true }).getByRole('option');
    await expect(profileOptions).toHaveText(['Standard', 'Kunde']);
    await profileOptions.filter({ hasText: 'Standard' }).click();
    await expect(profileSelect).toHaveText('Standard');
    await expect.poll(async () => (await store()).activeProfileId).toBe('default');
    await page.keyboard.press('Escape');
    dialog = await openPlugins();
    await dialog.getByRole('button', { name: /Jira Aufgaben/ }).click();
    await expect(dialog.getByLabel('JQL-Filter', { exact: true })).toHaveValue('project = ARCH');
    await dialog.getByRole('button', { name: 'Plugin-Einstellungen schließen' }).click();

    // A new, unsaved diagram keeps the profile editable; only Git's document actions wait for a folder.
    await page.getByTestId('file-menu-button').click(); await page.getByTestId('file-menu-new').click();
    dialog = await openPlugins();
    await expect(dialog.getByRole('button', { name: 'Diagramm speichern', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: /Git Versionierung/ }).click();
    await expect(dialog.getByRole('button', { name: 'Status prüfen', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: /Jira Aufgaben/ }).click();
    await expect(dialog.getByRole('button', { name: 'Jira speichern', exact: true })).toBeEnabled();
    await expect(dialog.getByLabel('Jira-Projekt', { exact: true })).toHaveValue('ARCH');
    expect(errors).toEqual([]);

    // Profiles and the active one survive a restart of the app.
    await stopElectron(app); app = undefined;
    app = await electron.launch({ args: [root], env: environment, chromiumSandbox: true });
    desktop = app; page = await desktop.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
    await page.getByTestId('workspace-menu-button').click();
    const restored = page.getByTestId('workspace-menu-profiles').getByRole('combobox', { name: 'Profil', exact: true });
    await expect(restored).toHaveText('Standard');
    await restored.click();
    await expect(page.getByRole('listbox', { name: 'Profil', exact: true }).getByRole('option')).toHaveText(['Standard', 'Kunde']);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
    await testInfo.attach('native-plugin-evidence', { body: JSON.stringify({ platform: process.platform, realBuiltRendererPreloadMainAndPersistence: true, nativeFileDialogResultStubbed: true, profileStoreInUserData: true, profilesIndependentOfFolder: true, profileSwitchInMenuDropdown: true, profileManagementInOwnDialog: true, profilesSurviveRestart: true, noConfigurationInProjectFolder: true, jiraNetwork: 'not contacted; disabled configuration persistence tested' }), contentType: 'application/json' });
  } finally {
    if (app) await stopElectron(app);
    await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
});
