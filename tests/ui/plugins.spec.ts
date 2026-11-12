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
  };
  settings: PluginSettingsSnapshot;
};
type TestWindow = Window & { __pluginTest: PluginTestState; __resolvePluginRequest: (plugin: 'git' | 'jira') => void };

/** The mock keeps actual per-project settings and only exposes a folder after a file was saved. */
async function desktop(page: Page, options: { cancelSave?: boolean; theme?: 'light' | 'dark' } = {}): Promise<void> {
  await page.addInitScript(({ cancelSave, theme }) => {
    localStorage.setItem('sketchdraw.preferences.v1', JSON.stringify({ theme, language: 'de', canvasBackground: null }));
    const defaults = (): PluginSettingsSnapshot => ({
      available: true,
      projectFolder: '',
      git: { installed: true, enabled: false, folderPath: '', autoCommit: true, autoPush: false, autoPull: true, remote: 'origin', remoteUrl: '', authMode: 'system', username: '', credentialStored: false, health: 'disabled', message: 'Git-Plugin ist deaktiviert.' },
      atlassian: { installed: true, enabled: false, siteUrl: '', email: '', confluenceSpaceKey: '', jiraProjectKey: '', jiraIssueType: 'Task', jqlFilter: '', credentialStored: false, health: 'disabled', message: 'Jira-Plugin ist deaktiviert.' },
    });
    const control: PluginTestState = {
      cancelSave,
      gitFailure: '',
      jiraFailure: '',
      holdGit: false,
      holdJira: false,
      calls: { contexts: [], saves: [], git: [], jira: [], jiraTests: 0 },
      settings: defaults(),
    };
    const projects = new Map<string, PluginSettingsSnapshot>();
    const files = new Map<string, FileReference>();
    const delayed: Record<'git' | 'jira', Array<() => void>> = { git: [], jira: [] };
    Object.defineProperty(window, '__resolvePluginRequest', { value: (plugin: 'git' | 'jira') => {
      const resolve = delayed[plugin].shift();
      if (!resolve) throw new Error(`No pending ${plugin} request.`);
      resolve();
    } });
    const snapshot = () => structuredClone(control.settings);
    const assertProject = () => {
      if (!control.settings.projectFolder) throw new Error('Öffne oder speichere zuerst ein Diagramm.');
    };
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
          const project = defaults();
          project.projectFolder = index === 1 ? '/Users/demo/architecture' : `/Users/demo/architecture-${index}`;
          project.git.folderPath = project.projectFolder;
          files.set(file.handleId, file); projects.set(file.handleId, project);
        }
        control.settings = projects.get(file.handleId)!;
        return { status: 'saved', file: structuredClone(file) };
      },
      exportFile: async () => ({ status: 'cancelled' }), openExternal: async () => {},
      onCloseRequested: () => () => {}, respondToClose: async () => {}, onMenuCommand: () => () => {},
      plugins: {
        getSettings: async (handleId?: string | null) => {
          control.calls.contexts.push(handleId);
          if (handleId === null) control.settings = defaults();
          else if (handleId !== undefined) {
            const project = projects.get(handleId);
            if (!project) throw new Error('Unbekanntes Dokument.');
            control.settings = project;
          }
          return snapshot();
        },
        installPlugin: async (id: 'git' | 'jira') => {
          assertProject();
          (id === 'git' ? control.settings.git : control.settings.atlassian).installed = true;
          return snapshot();
        },
        uninstallPlugin: async (id: 'git' | 'jira') => {
          assertProject();
          const settings = id === 'git' ? control.settings.git : control.settings.atlassian;
          settings.installed = false; settings.enabled = false;
          return snapshot();
        },
        configureGit: async (input: ConfigureGitPluginInput) => {
          assertProject(); control.calls.git.push(structuredClone(input));
          const project = control.settings;
          if (control.holdGit) await new Promise<void>(resolve => delayed.git.push(resolve));
          if (control.gitFailure) throw new Error(control.gitFailure);
          const { accessToken, clearCredential, ...fields } = input;
          Object.assign(project.git, fields, {
            installed: true,
            credentialStored: clearCredential ? false : Boolean(accessToken || project.git.credentialStored),
            health: input.enabled ? 'ready' : 'disabled',
            message: input.enabled ? 'Git ist eingerichtet.' : 'Git-Plugin ist deaktiviert.',
          });
          return structuredClone(project);
        },
        configureAtlassian: async (input: ConfigureAtlassianPluginInput) => {
          assertProject(); control.calls.jira.push(structuredClone(input));
          const project = control.settings;
          if (control.holdJira) await new Promise<void>(resolve => delayed.jira.push(resolve));
          if (control.jiraFailure) throw new Error(control.jiraFailure);
          const { apiToken, clearCredential, ...fields } = input;
          Object.assign(project.atlassian, fields, {
            installed: true,
            credentialStored: clearCredential ? false : Boolean(apiToken || project.atlassian.credentialStored),
            health: input.enabled ? 'ready' : 'disabled',
            message: input.enabled ? 'Jira ist eingerichtet.' : 'Jira-Plugin ist deaktiviert.',
          });
          return structuredClone(project);
        },
        testAtlassian: async () => { assertProject(); control.calls.jiraTests += 1; return { ok: true, message: 'Jira: verbunden' }; },
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

test('bundled plugins start installed and saving the diagram unlocks project configuration', async ({ page }) => {
  await desktop(page);
  const dialog = await openPlugins(page);
  await expect(dialog.getByRole('tab', { name: /Installiert/ })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('tab', { name: /Installiert/ })).toContainText('2');
  await expect(dialog.getByRole('button', { name: 'Installieren', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Git speichern', exact: true })).toBeDisabled();
  await expect(dialog.getByLabel('Remote-URL', { exact: true })).toBeDisabled();
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

test('cancelling the document save keeps configuration safely unavailable and allows retry', async ({ page }) => {
  await desktop(page, { cancelSave: true });
  const dialog = await openPlugins(page);
  await dialog.getByRole('button', { name: 'Diagramm speichern', exact: true }).click();
  await expect.poll(async () => (await state(page)).calls.saves.length).toBe(1);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Git speichern', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Diagramm speichern', exact: true })).toBeEnabled();
  expect((await state(page)).settings.projectFolder).toBe('');
  expect((await state(page)).calls.git).toHaveLength(0);
  await page.evaluate(() => { (window as unknown as TestWindow).__pluginTest.cancelSave = false; });
  await dialog.getByRole('button', { name: 'Diagramm speichern', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Git speichern', exact: true })).toBeEnabled();
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

test('disabled project fields do not trap reverse Tab navigation', async ({ page }) => {
  await desktop(page);
  const dialog = await openPlugins(page);
  const installed = dialog.getByRole('tab', { name: /Installiert/ });
  const jira = dialog.getByRole('complementary').getByRole('button', { name: /^Jira\b/ });
  await installed.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(jira).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(installed).toBeFocused();
});

test('an old project request neither blocks a new project nor clears its pending operation', async ({ page }) => {
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
  expect((await state(page)).settings.atlassian.email).toBe('');
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
  await expect(dialog.getByRole('button', { name: 'Git speichern', exact: true })).toBeDisabled();
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
  test(`plugin tiles stay white in the ${theme} theme and fall back to a letter while no official logo file is present`, async ({ page }) => {
    await desktop(page, { theme });
    await start(page);
    const dialog = await openPlugins(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const tiles = dialog.locator('.plugin-list-item .plugin-logo');
    await expect(tiles).toHaveText(['G', 'J']);
    for (const tile of await tiles.all()) {
      expect(await tile.evaluate(element => { const style = getComputedStyle(element); return [style.backgroundColor, style.backgroundImage, style.color]; })).toEqual(['rgb(255, 255, 255)', 'none', 'rgb(31, 35, 48)']);
    }
    // The repository ships no vendor artwork (#165); a dropped-in file would replace the letter.
    await expect(dialog.locator('.plugin-logo img')).toHaveCount(0);
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
