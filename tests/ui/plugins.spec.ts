import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { ConfigureAtlassianPluginInput, ConfigureGitPluginInput, PluginSettingsSnapshot, SaveDocumentRequest, FileReference } from '../../src/domain';

type PluginTestState = {
  cancelSave: boolean;
  gitFailure: string;
  jiraFailure: string;
  holdGit: boolean;
  holdJira: boolean;
  calls: {
    contexts: Array<string | null | undefined>;
    saves: SaveDocumentRequest[];
    git: ConfigureGitPluginInput[];
    jira: ConfigureAtlassianPluginInput[];
    jiraTests: number;
    profiles: Array<{ action: 'select' | 'create' | 'rename' | 'delete'; id?: string; name?: string; copyFrom?: string }>;
  };
  settings: PluginSettingsSnapshot;
};
type TestWindow = Window & { __pluginTest: PluginTestState; __resolvePluginRequest: (plugin: 'git' | 'jira') => void };

/** The mock keeps plugin settings per editor profile and only exposes a project folder after a file was saved. */
async function desktop(page: Page, options: { cancelSave?: boolean; theme?: 'light' | 'dark' } = {}): Promise<void> {
  await page.addInitScript(({ cancelSave, theme }) => {
    localStorage.setItem('sketchdraw.preferences.v1', JSON.stringify({ theme, language: 'de', canvasBackground: null }));
    const defaults = (): PluginSettingsSnapshot => ({
      available: true,
      projectFolder: '',
      profiles: [{ id: 'default', name: 'Standard' }],
      activeProfileId: 'default',
      git: { installed: true, enabled: false, folderPath: '', autoCommit: true, autoPush: false, autoPull: true, remote: 'origin', remoteUrl: '', authMode: 'system', username: '', credentialStored: false, health: 'disabled', message: 'Git-Plugin ist deaktiviert.' },
      atlassian: { installed: true, enabled: false, siteUrl: '', email: '', confluenceSpaceKey: '', jiraProjectKey: '', jiraIssueType: 'Task', jqlFilter: '', credentialStored: false, health: 'disabled', message: 'Jira-Plugin ist deaktiviert.' },
    });
    const control: PluginTestState = {
      cancelSave,
      gitFailure: '',
      jiraFailure: '',
      holdGit: false,
      holdJira: false,
      calls: { contexts: [], saves: [], git: [], jira: [], jiraTests: 0, profiles: [] },
      settings: defaults(),
    };
    const folders = new Map<string, string>();
    const files = new Map<string, FileReference>();
    // The settings object of a profile stays the same object while the profile exists, like the real service keeps
    // one configuration per profile; `control.settings` always is the snapshot of the active profile.
    const configs = new Map<string, Pick<PluginSettingsSnapshot, 'git' | 'atlassian'>>([['default', { git: control.settings.git, atlassian: control.settings.atlassian }]]);
    let profiles: PluginSettingsSnapshot['profiles'] = [{ id: 'default', name: 'Standard' }];
    let activeProfileId = 'default'; let folder = ''; let profileCounter = 0;
    const compose = (): void => {
      const config = configs.get(activeProfileId)!;
      config.git.folderPath = folder;
      control.settings = { available: true, projectFolder: folder, profiles: profiles.map(profile => ({ ...profile })), activeProfileId, git: config.git, atlassian: config.atlassian };
    };
    const profileName = (value: string, exceptId?: string): string => {
      const name = String(value ?? '').trim();
      if (!name || name.length > 40) throw new Error('Profilname ist ungültig.');
      if (profiles.some(profile => profile.id !== exceptId && profile.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('Ein Profil mit diesem Namen existiert bereits.');
      return name;
    };
    const delayed: Record<'git' | 'jira', Array<() => void>> = { git: [], jira: [] };
    Object.defineProperty(window, '__resolvePluginRequest', { value: (plugin: 'git' | 'jira') => {
      const resolve = delayed[plugin].shift();
      if (!resolve) throw new Error(`No pending ${plugin} request.`);
      resolve();
    } });
    const snapshot = () => structuredClone(control.settings);
    Object.defineProperty(window, '__pluginTest', { value: control });
    Object.defineProperty(window, 'sketchdraw', { value: {
      platform: 'electron',
      openDocument: async () => ({ status: 'cancelled' }),
      saveDocument: async (request: SaveDocumentRequest) => {
        control.calls.saves.push(structuredClone(request));
        if (control.cancelSave) return { status: 'cancelled' };
        let file = request.mode === 'save' ? files.get(request.handleId) : undefined;
        if (!file) {
          const index = files.size + 1;
          file = { handleId: index === 1 ? 'architecture-file' : `architecture-file-${index}`, name: `Architecture-${index}.sketchdraw`, versionToken: `version-${index}` };
          files.set(file.handleId, file); folders.set(file.handleId, index === 1 ? '/Users/demo/architecture' : `/Users/demo/architecture-${index}`);
        }
        folder = folders.get(file.handleId)!; compose();
        return { status: 'saved', file: structuredClone(file) };
      },
      exportFile: async () => ({ status: 'cancelled' }), openExternal: async () => {},
      onCloseRequested: () => () => {}, respondToClose: async () => {}, onMenuCommand: () => () => {},
      plugins: {
        getSettings: async (handleId?: string | null) => {
          control.calls.contexts.push(handleId);
          if (handleId === null) folder = '';
          else if (handleId !== undefined) {
            const known = folders.get(handleId);
            if (known === undefined) throw new Error('Unbekanntes Dokument.');
            folder = known;
          }
          compose();
          return snapshot();
        },
        selectProfile: async (id: string) => {
          control.calls.profiles.push({ action: 'select', id });
          if (!configs.has(id)) throw new Error('Unbekanntes Profil.');
          activeProfileId = id; compose(); return snapshot();
        },
        createProfile: async (input: { name: string; copyFrom?: string }) => {
          control.calls.profiles.push({ action: 'create', name: input.name, ...(input.copyFrom === undefined ? {} : { copyFrom: input.copyFrom }) });
          if (profiles.length >= 12) throw new Error('Es sind höchstens zwölf Profile möglich.');
          const name = profileName(input.name); const source = input.copyFrom === undefined ? null : configs.get(input.copyFrom);
          if (source === undefined) throw new Error('Unbekanntes Profil.');
          const id = `profile-${++profileCounter}`; const fresh = defaults();
          configs.set(id, source ? structuredClone({ git: source.git, atlassian: source.atlassian }) : { git: fresh.git, atlassian: fresh.atlassian });
          profiles = [...profiles, { id, name }]; activeProfileId = id; compose(); return snapshot();
        },
        renameProfile: async (input: { id: string; name: string }) => {
          control.calls.profiles.push({ action: 'rename', id: input.id, name: input.name });
          const name = profileName(input.name, input.id);
          profiles = profiles.map(profile => profile.id === input.id ? { ...profile, name } : profile); compose(); return snapshot();
        },
        deleteProfile: async (id: string) => {
          control.calls.profiles.push({ action: 'delete', id });
          if (profiles.length <= 1) throw new Error('Das letzte Profil kann nicht gelöscht werden.');
          profiles = profiles.filter(profile => profile.id !== id); configs.delete(id);
          if (activeProfileId === id) activeProfileId = profiles[0]!.id;
          compose(); return snapshot();
        },
        installPlugin: async (id: 'git' | 'jira') => {
          (id === 'git' ? control.settings.git : control.settings.atlassian).installed = true;
          return snapshot();
        },
        uninstallPlugin: async (id: 'git' | 'jira') => {
          const settings = id === 'git' ? control.settings.git : control.settings.atlassian;
          settings.installed = false; settings.enabled = false;
          return snapshot();
        },
        configureGit: async (input: ConfigureGitPluginInput) => {
          control.calls.git.push(structuredClone(input));
          const project = configs.get(activeProfileId)!;
          if (control.holdGit) await new Promise<void>(resolve => delayed.git.push(resolve));
          if (control.gitFailure) throw new Error(control.gitFailure);
          const { accessToken, clearCredential, ...fields } = input;
          Object.assign(project.git, fields, {
            installed: true,
            credentialStored: clearCredential ? false : Boolean(accessToken || project.git.credentialStored),
            health: input.enabled ? 'ready' : 'disabled',
            message: input.enabled ? 'Git ist eingerichtet.' : 'Git-Plugin ist deaktiviert.',
          });
          return snapshot();
        },
        configureAtlassian: async (input: ConfigureAtlassianPluginInput) => {
          control.calls.jira.push(structuredClone(input));
          const project = configs.get(activeProfileId)!;
          if (control.holdJira) await new Promise<void>(resolve => delayed.jira.push(resolve));
          if (control.jiraFailure) throw new Error(control.jiraFailure);
          const { apiToken, clearCredential, ...fields } = input;
          Object.assign(project.atlassian, fields, {
            installed: true,
            credentialStored: clearCredential ? false : Boolean(apiToken || project.atlassian.credentialStored),
            health: input.enabled ? 'ready' : 'disabled',
            message: input.enabled ? 'Jira ist eingerichtet.' : 'Jira-Plugin ist deaktiviert.',
          });
          return snapshot();
        },
        testAtlassian: async () => { control.calls.jiraTests += 1; return { ok: true, message: 'Jira: verbunden' }; },
        gitStatus: async () => ({ ok: true, message: 'Repository ist synchron.', settings: snapshot().git }),
        gitSync: async () => ({ ok: true, message: 'Repository ist synchron.', settings: snapshot().git }),
        watchDocument: async () => ({ ok: true, message: 'watching' }),
        listConfluencePages: async () => [], getConfluencePage: async () => { throw new Error('not used'); }, updateConfluencePage: async () => { throw new Error('not used'); },
        createJiraIssue: async () => { throw new Error('not used'); }, listJiraIssues: async () => [], transitionJiraIssue: async () => { throw new Error('not used'); }, onEvent: () => () => {},
      },
    } });
  }, { cancelSave: options.cancelSave ?? false, theme: options.theme ?? 'light' });
  await start(page);
}

async function start(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
}

async function openPlugins(page: Page): Promise<Locator> {
  await page.getByTestId('workspace-menu-button').click();
  await page.getByRole('menuitemcheckbox', { name: 'Plugin-Einstellungen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Plugins', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function selectPlugin(dialog: Locator, name: 'Git' | 'Jira'): Promise<void> {
  await dialog.getByRole('complementary').getByRole('button', { name: new RegExp(`^${name}\\b`) }).click();
  await expect(dialog.getByRole('heading', { name: `${name}-Konfiguration` })).toBeVisible();
}

async function prepareProject(page: Page): Promise<Locator> {
  const dialog = await openPlugins(page);
  await dialog.getByRole('button', { name: 'Diagramm speichern', exact: true }).click();
  await expect(dialog.getByLabel('Projektordner', { exact: true })).toHaveValue('/Users/demo/architecture');
  await expect(dialog.getByRole('button', { name: 'Git speichern', exact: true })).toBeEnabled();
  return dialog;
}

async function fillJira(dialog: Locator): Promise<void> {
  await selectPlugin(dialog, 'Jira');
  await dialog.getByLabel('Atlassian-URL', { exact: true }).fill('https://example.atlassian.net');
  await dialog.getByLabel('Username oder E-Mail', { exact: true }).fill('demo@example.test');
  await dialog.getByLabel('API-Token', { exact: true }).fill('test-jira-token');
  await dialog.getByLabel('Jira-Projekt', { exact: true }).fill('ARCH');
  await dialog.getByLabel('JQL-Filter', { exact: true }).fill('project = ARCH AND assignee = currentUser()');
}

async function state(page: Page): Promise<PluginTestState> {
  return page.evaluate(() => structuredClone((window as unknown as TestWindow).__pluginTest));
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
});

test('bundled plugins start installed, are configurable in the profile right away, and saving the diagram gives Git its folder', async ({ page }) => {
  await desktop(page);
  const dialog = await openPlugins(page);
  await expect(dialog.getByRole('tab', { name: /Installiert/ })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('tab', { name: /Installiert/ })).toContainText('2');
  await expect(dialog.getByRole('button', { name: 'Installieren', exact: true })).toHaveCount(0);
  // Settings belong to the editor profile (#168): no saved diagram is needed to edit them.
  await expect(dialog.getByTestId('plugin-active-profile')).toContainText('Profil „Standard“');
  await expect(dialog.getByRole('button', { name: 'Git speichern', exact: true })).toBeEnabled();
  await expect(dialog.getByLabel('Remote-URL', { exact: true })).toBeEnabled();
  await expect(dialog.getByLabel('Projektordner', { exact: true })).toHaveValue('');
  // Git itself still needs the folder of a saved diagram.
  await expect(dialog.getByRole('button', { name: 'Status prüfen', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Jetzt synchronisieren', exact: true })).toBeDisabled();
  expect((await state(page)).calls.git).toEqual([]);
  expect((await state(page)).calls.jira).toEqual([]);
  await dialog.getByRole('button', { name: 'Diagramm speichern', exact: true }).click();
  await expect(dialog.getByLabel('Projektordner', { exact: true })).toHaveValue('/Users/demo/architecture');
  await expect(dialog.getByRole('button', { name: 'Git speichern', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('checkbox', { name: 'Aktiv', exact: true })).not.toBeChecked();
  await selectPlugin(dialog, 'Jira');
  await expect(dialog.getByRole('checkbox', { name: 'Aktiv', exact: true })).not.toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Jira speichern', exact: true })).toBeEnabled();
  const saved = await state(page);
  expect(saved.calls.saves).toHaveLength(1);
  expect(saved.calls.saves[0]?.mode).toBe('save-as');
  expect(saved.calls.contexts).toContain('architecture-file');
});

test('Git and Jira configurations persist independently and secrets are never refilled on reopen', async ({ page }) => {
  await desktop(page);
  const dialog = await prepareProject(page);
  await dialog.getByLabel('Remote', { exact: true }).fill('upstream');
  await dialog.getByLabel('Remote-URL', { exact: true }).fill('https://example.test/team/architecture.git');
  await dialog.getByRole('radio', { name: /Username und Token/ }).check();
  await dialog.getByLabel('Username', { exact: true }).fill('demo-git');
  await dialog.getByLabel('Access-Token', { exact: true }).fill('test-git-token');
  await dialog.getByRole('button', { name: 'Git speichern', exact: true }).click();
  await expect.poll(async () => (await state(page)).settings.git.remote).toBe('upstream');
  expect((await state(page)).calls.git[0]).toMatchObject({ remote: 'upstream', username: 'demo-git', authMode: 'token', accessToken: 'test-git-token' });
  await fillJira(dialog);
  await dialog.getByRole('button', { name: 'Jira speichern', exact: true }).click();
  await expect.poll(async () => (await state(page)).settings.atlassian.jiraProjectKey).toBe('ARCH');
  expect((await state(page)).calls.jira[0]).toMatchObject({ email: 'demo@example.test', apiToken: 'test-jira-token', jqlFilter: 'project = ARCH AND assignee = currentUser()' });
  await dialog.getByRole('button', { name: 'Plugin-Einstellungen schließen' }).click();
  await openPlugins(page);
  await selectPlugin(dialog, 'Git');
  await expect(dialog.getByLabel('Remote', { exact: true })).toHaveValue('upstream');
  await expect(dialog.getByLabel('Username', { exact: true })).toHaveValue('demo-git');
  await expect(dialog.getByLabel('Access-Token', { exact: true })).toHaveValue('');
  await selectPlugin(dialog, 'Jira');
  await expect(dialog.getByLabel('Username oder E-Mail', { exact: true })).toHaveValue('demo@example.test');
  await expect(dialog.getByLabel('JQL-Filter', { exact: true })).toHaveValue('project = ARCH AND assignee = currentUser()');
  await expect(dialog.getByLabel('API-Token', { exact: true })).toHaveValue('');
});

test('saving or testing another plugin preserves unfinished form drafts', async ({ page }) => {
  await desktop(page);
  const dialog = await prepareProject(page);
  await dialog.getByLabel('Remote-URL', { exact: true }).fill('https://example.test/unsaved-draft.git');
  await dialog.getByRole('radio', { name: /Username und Token/ }).check();
  await dialog.getByLabel('Username', { exact: true }).fill('unfinished-user');
  await dialog.getByLabel('Access-Token', { exact: true }).fill('unfinished-token');
  await fillJira(dialog);
  await dialog.getByRole('checkbox', { name: 'Aktiv', exact: true }).check();
  await dialog.getByRole('button', { name: 'Jira speichern', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Verbindung testen', exact: true })).toBeEnabled();
  await dialog.getByLabel('JQL-Filter', { exact: true }).fill('project = ARCH AND status = Open');
  await expect(dialog.getByRole('button', { name: 'Verbindung testen', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Jira-Board synchronisieren', exact: true })).toBeDisabled();
  expect((await state(page)).calls.jiraTests).toBe(0);
  await dialog.getByLabel('JQL-Filter', { exact: true }).fill('project = ARCH AND assignee = currentUser()');
  await dialog.getByRole('button', { name: 'Verbindung testen', exact: true }).click();
  await expect.poll(async () => (await state(page)).calls.jiraTests).toBe(1);
  await dialog.getByLabel('JQL-Filter', { exact: true }).fill('project = ARCH AND status = Open');
  await selectPlugin(dialog, 'Git');
  await expect(dialog.getByLabel('Remote-URL', { exact: true })).toHaveValue('https://example.test/unsaved-draft.git');
  await expect(dialog.getByLabel('Username', { exact: true })).toHaveValue('unfinished-user');
  await expect(dialog.getByLabel('Access-Token', { exact: true })).toHaveValue('unfinished-token');
  expect((await state(page)).calls.git).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Git speichern', exact: true }).click();
  await expect.poll(async () => (await state(page)).settings.git.username).toBe('unfinished-user');
  await selectPlugin(dialog, 'Jira');
  await expect(dialog.getByLabel('JQL-Filter', { exact: true })).toHaveValue('project = ARCH AND status = Open');
});

test('save errors are visible inside the dialog and preserve the draft for a successful retry', async ({ page }) => {
  await desktop(page);
  const dialog = await prepareProject(page);
  await dialog.getByLabel('Remote-URL', { exact: true }).fill('https://example.test/retry.git');
  await page.evaluate(() => { (window as unknown as TestWindow).__pluginTest.gitFailure = 'Testfehler: Projektkonfiguration konnte nicht gespeichert werden.'; });
  await dialog.getByRole('button', { name: 'Git speichern', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Projektkonfiguration konnte nicht gespeichert werden.');
  await expect(dialog.getByLabel('Remote-URL', { exact: true })).toHaveValue('https://example.test/retry.git');
  await expect(dialog.getByRole('button', { name: 'Git speichern', exact: true })).toBeEnabled();
  await page.evaluate(() => { (window as unknown as TestWindow).__pluginTest.gitFailure = ''; });
  await dialog.getByRole('button', { name: 'Git speichern', exact: true }).click();
  await expect.poll(async () => (await state(page)).settings.git.remoteUrl).toBe('https://example.test/retry.git');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
});

test('cancelling the document save leaves Git without a folder and allows retry', async ({ page }) => {
  await desktop(page, { cancelSave: true });
  const dialog = await openPlugins(page);
  await dialog.getByRole('button', { name: 'Diagramm speichern', exact: true }).click();
  await expect.poll(async () => (await state(page)).calls.saves.length).toBe(1);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('status').filter({ hasText: 'Speichern abgebrochen' })).toBeVisible();
  await expect(dialog.getByLabel('Projektordner', { exact: true })).toHaveValue('');
  await expect(dialog.getByRole('button', { name: 'Status prüfen', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Diagramm speichern', exact: true })).toBeEnabled();
  expect((await state(page)).settings.projectFolder).toBe('');
  expect((await state(page)).calls.git).toHaveLength(0);
  await page.evaluate(() => { (window as unknown as TestWindow).__pluginTest.cancelSave = false; });
  await dialog.getByRole('button', { name: 'Diagramm speichern', exact: true }).click();
  await expect(dialog.getByLabel('Projektordner', { exact: true })).toHaveValue('/Users/demo/architecture');
});

test('marketplace configuration and keyboard tabs lead to the installed form and return focus on Escape', async ({ page }) => {
  await desktop(page);
  const dialog = await prepareProject(page);
  const installed = dialog.getByRole('tab', { name: /Installiert/ });
  const marketplace = dialog.getByRole('tab', { name: 'Marketplace', exact: true });
  await installed.focus();
  await page.keyboard.press('Home');
  await expect(marketplace).toBeFocused();
  await expect(marketplace).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('heading', { name: 'Git', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Konfigurieren', exact: true }).click();
  await expect(installed).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('heading', { name: 'Git-Konfiguration' })).toBeVisible();
  await installed.focus(); await page.keyboard.press('ArrowRight');
  await expect(marketplace).toBeFocused();
  await page.keyboard.press('ArrowLeft'); await expect(installed).toBeFocused();
  await page.keyboard.press('Home'); await page.keyboard.press('End'); await expect(installed).toBeFocused();
  await dialog.getByRole('button', { name: 'Plugin-Einstellungen schließen' }).focus();
  for (let index = 0; index < 16; index += 1) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('workspace-menu-button')).toBeFocused();
});

test('disabled configuration fields do not trap reverse Tab navigation', async ({ page }) => {
  // Without the desktop app the whole configuration is disabled.
  await start(page);
  const dialog = await openPlugins(page);
  const installed = dialog.getByRole('tab', { name: /Installiert/ });
  const jira = dialog.getByRole('complementary').getByRole('button', { name: /^Jira\b/ });
  await installed.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(jira).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(installed).toBeFocused();
});

test('a request from the previous document neither blocks the next one nor clears its pending operation', async ({ page }) => {
  await desktop(page);
  let dialog = await prepareProject(page);
  await fillJira(dialog);
  await page.evaluate(() => { (window as unknown as TestWindow).__pluginTest.holdJira = true; });
  await dialog.getByRole('button', { name: 'Jira speichern', exact: true }).click();
  await expect.poll(async () => (await state(page)).calls.jira.length).toBe(1);
  await expect(dialog.getByRole('button', { name: 'Jira speichern', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Plugin-Einstellungen schließen' }).click();
  await page.getByTestId('file-menu-button').click();
  await page.getByTestId('file-menu-new').click();
  dialog = await openPlugins(page);
  await expect(dialog.getByRole('button', { name: 'Diagramm speichern', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Diagramm speichern', exact: true }).click();
  await selectPlugin(dialog, 'Git');
  await expect(dialog.getByLabel('Projektordner', { exact: true })).toHaveValue('/Users/demo/architecture-2');
  await dialog.getByLabel('Remote', { exact: true }).fill('project-b');
  await page.evaluate(() => { (window as unknown as TestWindow).__pluginTest.holdGit = true; });
  await dialog.getByRole('button', { name: 'Git speichern', exact: true }).click();
  await expect.poll(async () => (await state(page)).calls.git.length).toBe(1);
  await expect(dialog.getByRole('button', { name: 'Git speichern', exact: true })).toBeDisabled();
  await page.evaluate(() => (window as unknown as TestWindow).__resolvePluginRequest('jira'));
  await expect(dialog.getByLabel('Projektordner', { exact: true })).toHaveValue('/Users/demo/architecture-2');
  await expect(dialog.getByLabel('Remote', { exact: true })).toHaveValue('project-b');
  await expect(dialog.getByRole('button', { name: 'Git speichern', exact: true })).toBeDisabled();
  await expect(dialog.getByLabel('Remote', { exact: true })).toBeDisabled();
  await page.evaluate(() => (window as unknown as TestWindow).__resolvePluginRequest('git'));
  await expect(dialog.getByRole('button', { name: 'Git speichern', exact: true })).toBeEnabled();
  expect((await state(page)).settings.git.remote).toBe('project-b');
  // Both saves belong to the same profile, whichever document was open when they started.
  expect((await state(page)).settings.atlassian.email).toBe('demo@example.test');
});

test('the project save action reports an invalid code draft instead of a cancelled file dialog', async ({ page }) => {
  await desktop(page);
  await page.getByTestId('workspace-menu-button').click();
  await page.getByRole('menuitemcheckbox', { name: 'Code', exact: true }).click();
  const code = page.getByTestId('diagram-code');
  await code.fill('sketchdraw broken');
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Codefehler' })).toBeVisible();
  const dialog = await openPlugins(page);
  await dialog.getByRole('button', { name: 'Diagramm speichern', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText(/Code|Entwurf|ungültig/i);
  await expect(dialog).not.toContainText('Speichern abgebrochen');
  await expect(dialog.getByLabel('Projektordner', { exact: true })).toHaveValue('');
  expect((await state(page)).calls.saves).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Plugin-Einstellungen schließen' }).click();
  await expect(code).toHaveValue('sketchdraw broken');
});

for (const width of [360, 960, 1280]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`plugin configuration remains reachable at ${width}px in ${theme} theme`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 800 });
      await desktop(page, { theme });
      const dialog = await prepareProject(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await fillJira(dialog);
      const save = dialog.getByRole('button', { name: 'Jira speichern', exact: true });
      await save.scrollIntoViewIfNeeded();
      const rect = await dialog.boundingBox();
      expect(rect).not.toBeNull();
      expect(rect!.x).toBeGreaterThanOrEqual(0);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(width);
      expect(rect!.y).toBeGreaterThanOrEqual(0);
      expect(rect!.y + rect!.height).toBeLessThanOrEqual(800);
      expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      expect(await save.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return Boolean(hit && (element === hit || element.contains(hit)));
      })).toBe(true);
      expect((await new AxeBuilder({ page }).include('.plugin-dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
      const screenshot = testInfo.outputPath(`plugins-${width}-${theme}.png`);
      await page.screenshot({ path: screenshot });
      await testInfo.attach(`Plugins ${width}px ${theme}`, { path: screenshot, contentType: 'image/png' });
      if (width === 1280) {
        await dialog.getByRole('heading', { name: 'Jira', exact: true }).scrollIntoViewIfNeeded();
        const top = testInfo.outputPath(`plugins-${width}-${theme}-top.png`);
        await page.screenshot({ path: top });
        await testInfo.attach(`Plugin configuration ${theme}`, { path: top, contentType: 'image/png' });
        await dialog.getByRole('tab', { name: 'Marketplace', exact: true }).click();
        const overview = testInfo.outputPath(`plugins-marketplace-${theme}.png`);
        await page.screenshot({ path: overview });
        await testInfo.attach(`Marketplace overview ${theme}`, { path: overview, contentType: 'image/png' });
      }
    });
  }
}

for (const theme of ['light', 'dark'] as const) {
  test(`plugin tiles show the vendor logos on white in the ${theme} theme`, async ({ page }) => {
    await desktop(page, { theme });
    await start(page);
    const dialog = await openPlugins(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const tiles = dialog.locator('.plugin-list-item .plugin-logo');
    await expect(tiles).toHaveCount(2);
    for (const tile of await tiles.all()) {
      expect(await tile.evaluate(element => { const style = getComputedStyle(element); return [style.backgroundColor, style.backgroundImage]; })).toEqual(['rgb(255, 255, 255)', 'none']);
      // The logo replaces the letter, is decorative (the name stands next to it) and keeps its proportions.
      await expect(tile).toHaveText('');
      const image = tile.locator('img');
      await expect(image).toHaveAttribute('alt', '');
      expect(await image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0 && getComputedStyle(element).objectFit)).toBe('contain');
    }
    // List, detail header and overview use the same file.
    const sources = await dialog.locator('.plugin-logo img').evaluateAll(images => images.map(image => (image as HTMLImageElement).src));
    expect(new Set(sources).size).toBe(2);
    expect(sources.length).toBeGreaterThanOrEqual(3);
  });
}

test('browser shows the bundled plugins but explains why native configuration is unavailable', async ({ page }) => {
  await start(page);
  const dialog = await openPlugins(page);
  await expect(dialog.getByRole('tab', { name: /Installiert/ })).toContainText('2');
  await expect(dialog).toContainText('Desktop-App');
  await expect(dialog.getByRole('button', { name: 'Diagramm speichern', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Git speichern', exact: true })).toBeDisabled();
  await selectPlugin(dialog, 'Jira');
  await expect(dialog.getByRole('button', { name: 'Jira speichern', exact: true })).toBeDisabled();
  await expect(dialog.getByLabel('API-Token', { exact: true })).toBeDisabled();
  expect((await new AxeBuilder({ page }).include('.plugin-dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
});

async function closePlugins(dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: 'Plugin-Einstellungen schließen' }).click();
  await expect(dialog).toBeHidden();
}

/** The profile is chosen in the dropdown of the workspace menu (#169). */
async function switchProfile(page: Page, name: string): Promise<void> {
  await page.getByTestId('workspace-menu-button').click();
  const select = page.getByTestId('workspace-menu-profiles').getByRole('combobox', { name: 'Profil', exact: true });
  await select.click();
  await page.getByRole('listbox', { name: 'Profil', exact: true }).getByRole('option', { name, exact: true }).click();
  await expect(select).toHaveText(name);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Arbeitsbereich' })).toBeHidden();
}

/** Profiles are managed in their own dialog behind the pen next to that dropdown (#169). */
async function openProfiles(page: Page): Promise<Locator> {
  await page.getByTestId('workspace-menu-button').click();
  await page.getByTestId('workspace-menu-profiles-edit').click();
  const dialog = page.getByRole('dialog', { name: 'Profile', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function closeProfiles(dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: 'Fertig', exact: true }).click();
  await expect(dialog).toBeHidden();
}

test('profiles are created, copied, renamed, activated and deleted in their own dialog and keep their own plugin settings', async ({ page }) => {
  await desktop(page);
  // Configure Jira in the default profile – no saved diagram needed. The plugin dialog names the profile but no longer manages it.
  let plugins = await openPlugins(page);
  await expect(plugins.getByTestId('plugin-active-profile')).toContainText('Profil „Standard“');
  await expect(plugins.getByRole('combobox', { name: 'Profil', exact: true })).toHaveCount(0);
  await expect(plugins.getByRole('button', { name: 'Neues Profil', exact: true })).toHaveCount(0);
  await fillJira(plugins);
  await plugins.getByRole('checkbox', { name: 'Aktiv', exact: true }).check();
  await plugins.getByRole('button', { name: 'Jira speichern', exact: true }).click();
  await expect(plugins.locator('.plugin-feedback')).toHaveText(/gespeichert/i);
  await closePlugins(plugins);

  let profiles = await openProfiles(page);
  await expect(page.getByRole('menu', { name: 'Arbeitsbereich' })).toBeHidden();
  const rows = profiles.getByRole('listitem');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Standard');
  await expect(rows.first()).toContainText('Aktiv');
  await expect(rows.first()).toHaveAttribute('aria-current', 'true');
  // The only profile cannot be deleted.
  await expect(profiles.getByRole('button', { name: 'Profil „Standard“ löschen', exact: true })).toBeDisabled();

  // A new profile starts empty and becomes active.
  const create = profiles.getByRole('button', { name: 'Neues Profil', exact: true });
  await create.click();
  const name = profiles.getByRole('textbox', { name: 'Name des neuen Profils' });
  await expect(name).toBeFocused();
  await expect(profiles.getByRole('button', { name: 'Profil anlegen', exact: true })).toBeDisabled();
  await name.fill('Kunde A'); await page.keyboard.press('Enter');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('Kunde A');
  await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(rows.first()).not.toHaveAttribute('aria-current', 'true');
  await expect(profiles.getByRole('status')).toHaveText('Profil „Kunde A“ angelegt.');
  await expect(name).toBeHidden();
  await expect(create).toBeFocused();
  await closeProfiles(profiles);
  await expect(page.getByTestId('workspace-menu-button')).toBeFocused();

  plugins = await openPlugins(page);
  await expect(plugins.getByTestId('plugin-active-profile')).toContainText('Profil „Kunde A“');
  await selectPlugin(plugins, 'Jira');
  await expect(plugins.getByLabel('Jira-Projekt', { exact: true })).toHaveValue('');
  await expect(plugins.getByRole('checkbox', { name: 'Aktiv', exact: true })).not.toBeChecked();
  await plugins.getByLabel('Jira-Projekt', { exact: true }).fill('KUNDE');
  await plugins.getByRole('button', { name: 'Jira speichern', exact: true }).click();
  await expect(plugins.locator('.plugin-feedback')).toHaveText(/gespeichert/i);
  await closePlugins(plugins);

  // Switching in the menu brings each profile's own settings back; tokens are never refilled.
  await switchProfile(page, 'Standard');
  plugins = await openPlugins(page);
  await selectPlugin(plugins, 'Jira');
  await expect(plugins.getByLabel('Jira-Projekt', { exact: true })).toHaveValue('ARCH');
  await expect(plugins.getByRole('checkbox', { name: 'Aktiv', exact: true })).toBeChecked();
  await expect(plugins.getByLabel('API-Token', { exact: true })).toHaveValue('');
  await expect(plugins.getByLabel('API-Token', { exact: true })).toHaveAttribute('placeholder', /Gespeichert/);
  // An unsaved draft does not travel to another profile.
  await plugins.getByLabel('Jira-Projekt', { exact: true }).fill('DRAFT');
  await closePlugins(plugins);
  await switchProfile(page, 'Kunde A');
  plugins = await openPlugins(page);
  await selectPlugin(plugins, 'Jira');
  await expect(plugins.getByLabel('Jira-Projekt', { exact: true })).toHaveValue('KUNDE');
  await closePlugins(plugins);
  await switchProfile(page, 'Standard');

  // A copy takes the settings along, including the stored token, and becomes active.
  profiles = await openProfiles(page);
  await profiles.getByRole('button', { name: 'Profil „Standard“ kopieren', exact: true }).click();
  const copyName = profiles.getByRole('textbox', { name: 'Name der Kopie von „Standard“' });
  await expect(copyName).toBeFocused();
  await expect(copyName).toHaveValue('Standard (Kopie)');
  await profiles.getByRole('button', { name: 'Kopie anlegen', exact: true }).click();
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(2)).toContainText('Standard (Kopie)');
  await expect(rows.nth(2)).toHaveAttribute('aria-current', 'true');

  // A name that is taken is reported inside the dialog; Escape leaves the form, not the dialog.
  await profiles.getByRole('button', { name: 'Profil „Standard (Kopie)“ umbenennen', exact: true }).click();
  const rename = profiles.getByRole('textbox', { name: 'Neuer Name für „Standard (Kopie)“' });
  await expect(rename).toHaveValue('Standard (Kopie)');
  await rename.fill('kunde a'); await page.keyboard.press('Enter');
  await expect(profiles.getByRole('alert')).toContainText('Ein Profil mit diesem Namen existiert bereits.');
  await expect(rename).toBeVisible();
  await expect(rename).toBeFocused();
  await rename.fill('Kunde B'); await page.keyboard.press('Enter');
  await expect(rows.nth(2)).toContainText('Kunde B');
  await expect(profiles.getByRole('status')).toHaveText('Profil umbenannt.');
  const renameB = profiles.getByRole('button', { name: 'Profil „Kunde B“ umbenennen', exact: true });
  await expect(renameB).toBeFocused();
  await renameB.click();
  await expect(profiles.getByTestId('profile-form')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(profiles.getByTestId('profile-form')).toBeHidden();
  await expect(profiles).toBeVisible();
  await expect(renameB).toBeFocused();

  expect((await new AxeBuilder({ page }).include('.profile-dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);

  // Another profile is activated right here.
  await profiles.getByRole('button', { name: 'Profil „Kunde A“ aktivieren', exact: true }).click();
  await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(profiles.getByRole('status')).toHaveText('Profil „Kunde A“ ist aktiv.');
  await expect(profiles.getByRole('button', { name: 'Profil „Kunde A“ umbenennen', exact: true })).toBeFocused();
  await profiles.getByRole('button', { name: 'Profil „Kunde B“ aktivieren', exact: true }).click();
  await expect(rows.nth(2)).toHaveAttribute('aria-current', 'true');
  await closeProfiles(profiles);
  plugins = await openPlugins(page);
  await expect(plugins.getByTestId('plugin-active-profile')).toContainText('Profil „Kunde B“');
  await selectPlugin(plugins, 'Jira');
  await expect(plugins.getByLabel('Jira-Projekt', { exact: true })).toHaveValue('ARCH');
  await expect(plugins.getByLabel('API-Token', { exact: true })).toHaveAttribute('placeholder', /Gespeichert/);
  await closePlugins(plugins);

  // Deleting asks first; deleting the active profile moves on to the first remaining one.
  profiles = await openProfiles(page);
  const removeB = profiles.getByRole('button', { name: 'Profil „Kunde B“ löschen', exact: true });
  await removeB.click();
  await expect(profiles.getByRole('alert')).toContainText('Profil „Kunde B“ mit seinen Plugin-Einstellungen und Tokens löschen?');
  await expect(profiles.getByRole('button', { name: 'Profil löschen', exact: true })).toBeFocused();
  await profiles.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(rows).toHaveCount(3);
  await expect(removeB).toBeFocused();
  await removeB.click();
  await profiles.getByRole('button', { name: 'Profil löschen', exact: true }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toHaveAttribute('aria-current', 'true');
  await expect(profiles.getByRole('status')).toHaveText('Profil gelöscht.');
  await closeProfiles(profiles);
  plugins = await openPlugins(page);
  await expect(plugins.getByTestId('plugin-active-profile')).toContainText('Profil „Standard“');
  await selectPlugin(plugins, 'Jira');
  await expect(plugins.getByLabel('Jira-Projekt', { exact: true })).toHaveValue('ARCH');

  const calls = (await state(page)).calls.profiles;
  expect(calls.map(call => call.action)).toEqual(['create', 'select', 'select', 'select', 'create', 'rename', 'rename', 'select', 'select', 'delete']);
  expect(calls[4]).toMatchObject({ action: 'create', name: 'Standard (Kopie)', copyFrom: 'default' });
  expect((await state(page)).settings.profiles.map(profile => profile.name)).toEqual(['Standard', 'Kunde A']);
  // Nothing of this is part of the diagram.
  expect((await state(page)).calls.saves).toEqual([]);
});

for (const theme of ['light', 'dark'] as const) {
  test(`the workspace menu switches the profile in a dropdown above Zusammenarbeiten and opens the profile dialog (${theme})`, async ({ page }) => {
    await desktop(page, { theme });
    let profiles = await openProfiles(page);
    for (const name of ['Arbeit', 'Privat']) {
      await profiles.getByRole('button', { name: 'Neues Profil', exact: true }).click();
      await profiles.getByRole('textbox', { name: 'Name des neuen Profils' }).fill(name);
      await profiles.getByRole('button', { name: 'Profil anlegen', exact: true }).click();
      await expect(profiles.getByRole('listitem').filter({ hasText: name })).toHaveAttribute('aria-current', 'true');
    }
    expect((await new AxeBuilder({ page }).include('.profile-dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(profiles).toBeHidden();
    const trigger = page.getByTestId('workspace-menu-button');
    await expect(trigger).toBeFocused();

    await trigger.click();
    const menu = page.getByRole('menu', { name: 'Arbeitsbereich' });
    const row = page.getByTestId('workspace-menu-profiles');
    const select = row.getByRole('combobox', { name: 'Profil', exact: true });
    const edit = row.getByRole('button', { name: 'Profile verwalten', exact: true });
    const collaboration = menu.getByRole('menuitemcheckbox', { name: 'Zusammenarbeiten' });
    await expect(select).toHaveText('Privat');
    // Directly above "Zusammenarbeiten", which stays the first menu entry; the pen is as tall as the dropdown next to it.
    expect((await menu.locator('[role^="menuitem"]').first().textContent())?.trim()).toBe('Zusammenarbeiten');
    const selectBox = (await select.boundingBox())!; const editBox = (await edit.boundingBox())!; const firstBox = (await collaboration.boundingBox())!;
    expect(firstBox.y).toBeGreaterThan(selectBox.y + selectBox.height - 1);
    expect(firstBox.y - (selectBox.y + selectBox.height)).toBeLessThan(24);
    expect(Math.abs(editBox.y - selectBox.y)).toBeLessThan(1);
    expect(Math.abs(editBox.height - selectBox.height)).toBeLessThan(1);
    expect(editBox.x).toBeGreaterThan(selectBox.x + selectBox.width - 1);
    const colors = await select.evaluate(element => { const style = getComputedStyle(element); return { background: style.backgroundColor, color: style.color }; });
    const luminance = (value: string): number => { const [r, g, b] = value.match(/[\d.]+/g)!.map(Number) as [number, number, number]; return (r * 299 + g * 587 + b * 114) / 255000; };
    if (theme === 'light') expect(luminance(colors.background)).toBeGreaterThan(0.85); else expect(luminance(colors.background)).toBeLessThan(0.3);

    // Keyboard: the menu opens on its first entry; ArrowUp walks into the profile row, Tab walks back down.
    await expect(collaboration).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(edit).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(select).toBeFocused();
    await page.keyboard.press('Enter');
    const list = page.getByRole('listbox', { name: 'Profil', exact: true });
    await expect(list.getByRole('option')).toHaveText(['Standard', 'Arbeit', 'Privat']);
    // Escape closes the list only, not the menu around it.
    await page.keyboard.press('Escape');
    await expect(list).toBeHidden();
    await expect(menu).toBeVisible();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await expect(select).toHaveText('Arbeit');
    await expect(menu).toBeVisible();
    await expect(select).toBeFocused();
    await expect(page.getByRole('region', { name: 'Meldungen' })).toContainText('Profil „Arbeit“ ist aktiv.');
    expect((await state(page)).settings.activeProfileId).toBe((await state(page)).settings.profiles[1]!.id);
    await page.keyboard.press('Tab');
    await expect(edit).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(collaboration).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(edit).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(collaboration).toBeFocused();
    expect((await new AxeBuilder({ page }).include('.view-menu').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();

    // Pointer: pick in the dropdown, then the pen closes the menu and opens the dialog with the same profile marked.
    await trigger.click();
    await select.click();
    await list.getByRole('option', { name: 'Standard', exact: true }).click();
    await expect(select).toHaveText('Standard');
    await edit.click();
    await expect(menu).toBeHidden();
    profiles = page.getByRole('dialog', { name: 'Profile', exact: true });
    await expect(profiles.getByRole('listitem').filter({ hasText: 'Standard' })).toHaveAttribute('aria-current', 'true');
    await closeProfiles(profiles);
    // The plugin dialog follows the choice made in the menu.
    const plugins = await openPlugins(page);
    await expect(plugins.getByTestId('plugin-active-profile')).toContainText('Profil „Standard“');
  });
}

test('the browser preview has no profiles in the menu or the plugin dialog', async ({ page }) => {
  await start(page);
  await page.getByTestId('workspace-menu-button').click();
  const menu = page.getByRole('menu', { name: 'Arbeitsbereich' });
  await expect(page.getByTestId('workspace-menu-profiles')).toHaveCount(0);
  await expect(page.getByTestId('workspace-menu-profiles-edit')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Profil', exact: true })).toHaveCount(0);
  // Without the profile row the menu keeps its plain keyboard model: ArrowUp wraps, Tab closes.
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Zusammenarbeiten' })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(menu.getByRole('menuitem', { name: 'Einstellungen', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(menu).toBeHidden();
  await page.getByTestId('workspace-menu-button').click();
  await menu.getByRole('menuitemcheckbox', { name: 'Plugin-Einstellungen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Plugins', exact: true });
  await expect(dialog.getByTestId('plugin-active-profile')).toHaveCount(0);
});
