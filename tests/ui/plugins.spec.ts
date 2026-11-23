import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { ConfigureAtlassianPluginInput, ConfigureAzureDevOpsPluginInput, ConfigureGitPluginInput, PluginSettingsSnapshot, SaveDocumentRequest, FileReference } from '../../src/domain';

type PluginTestState = {
  cancelSave: boolean;
  gitFailure: string;
  jiraFailure: string;
  holdGit: boolean;
  holdJira: boolean;
  /** Keeps every Jira ticket creation open until the test lets it through. */
  holdJiraCreate: boolean;
  jiraCreateFailure: string;
  calls: {
    contexts: Array<string | null | undefined>;
    saves: SaveDocumentRequest[];
    git: ConfigureGitPluginInput[];
    jira: ConfigureAtlassianPluginInput[];
    jiraTests: number;
    jiraSyncs: number;
    jiraCreates: string[];
    azure: ConfigureAzureDevOpsPluginInput[];
    azureCreates: string[];
    azureTransitions: Array<{ key: string; status: string }>;
    ticketReads: string[];
    wikiLinks: Array<{ diagramPageId: string; wikiPage: string | null }>;
    wikiPublications: Array<{ diagramPageId: string; bytes: number }>;
    ticketUpdates: Array<Record<string, unknown>>;
    profiles: Array<{ action: 'select' | 'create' | 'rename' | 'delete'; id?: string; name?: string; copyFrom?: string }>;
  };
  settings: PluginSettingsSnapshot;
};
type TestWindow = Window & { __pluginTest: PluginTestState; __resolvePluginRequest: (plugin: 'git' | 'jira' | 'jiraCreate') => void };

/** The mock keeps plugin settings per editor profile and only exposes a project folder after a file was saved. */
async function desktop(page: Page, options: { cancelSave?: boolean; theme?: 'light' | 'dark'; configurationIssue?: PluginSettingsSnapshot['configurationIssue'] } = {}): Promise<void> {
  await page.addInitScript(({ cancelSave, theme, configurationIssue }) => {
    localStorage.setItem('sketchdraw.preferences.v1', JSON.stringify({ theme, language: 'de', canvasBackground: null }));
    const defaults = (): PluginSettingsSnapshot => ({
      available: true,
      projectFolder: '',
      profiles: [{ id: 'default', name: 'Standard' }],
      activeProfileId: 'default',
      ...(configurationIssue ? { configurationIssue } : {}),
      git: { installed: true, enabled: false, folderPath: '', autoCommit: true, autoPush: false, autoPull: true, remote: 'origin', remoteUrl: '', authMode: 'system', username: '', credentialStored: false, health: 'disabled', message: 'Git-Plugin ist deaktiviert.' },
      atlassian: { installed: true, enabled: false, siteUrl: '', email: '', confluenceSpaceKey: '', jiraProjectKey: '', jiraIssueType: 'Task', jqlFilter: '', credentialStored: false, health: 'disabled', message: 'Jira-Plugin ist deaktiviert.' },
    });
    const control: PluginTestState = {
      cancelSave,
      gitFailure: '',
      jiraFailure: '',
      holdGit: false,
      holdJira: false,
      holdJiraCreate: false,
      jiraCreateFailure: '',
      calls: { contexts: [], saves: [], git: [], jira: [], jiraTests: 0, jiraSyncs: 0, jiraCreates: [], azure: [], azureCreates: [], azureTransitions: [], ticketReads: [], ticketUpdates: [], wikiLinks: [], wikiPublications: [], profiles: [] },
      settings: defaults(),
    };
    // Azure DevOps is not installed at first; the mock keeps one configuration for all profiles.
    const azure: NonNullable<PluginSettingsSnapshot['azureDevOps']> = { installed: false, enabled: false, variant: 'cloud', organizationUrl: '', project: '', workItemType: 'Task', wiqlFilter: '', apiVersion: '7.1', readOnly: false, credentialStored: false, health: 'disabled', message: 'Azure-DevOps-Plugin ist nicht installiert.' };
    control.settings.azureDevOps = azure;
    const ticketStore = new Map<string, Record<string, unknown>>([
      ['jira:ARCH-12', { id: '112', key: 'ARCH-12', title: 'Warenkorb übersteht den Gerätewechsel', description: 'Der Warenkorb wird am Konto gespeichert.', status: 'doing', remoteStatus: 'In Progress', assignee: 'Mara Lind', labels: ['checkout', 'q1'], components: ['Storefront'], estimate: '5', url: 'https://example.atlassian.net/browse/ARCH-12', updatedAt: '2026-11-22T08:00:00.000Z' }],
      ['jira:ARCH-13', { id: '113', key: 'ARCH-13', title: 'Warenkorb leeren nach Bestellung', description: '', status: 'todo', remoteStatus: 'To Do', url: 'https://example.atlassian.net/browse/ARCH-13', updatedAt: '2026-11-22T08:00:00.000Z' }],
      ['azure-devops:4711', { provider: 'azure-devops', id: '4711', key: '4711', title: 'Checkout absichern', description: 'Aus Azure Boards', status: 'doing', remoteStatus: 'Active', assignee: 'Jonas Reuter', labels: ['security'], components: ['Shop\\Checkout'], estimate: '8', url: 'https://dev.azure.com/acme/Shop/_workitems/edit/4711', updatedAt: '2026-11-22T08:00:00.000Z' }],
    ]);
    const workItem = (key: string, title: string, description: string, remoteStatus: string, status: 'todo' | 'doing' | 'review' | 'done') => ({ provider: 'azure-devops' as const, id: key, key, title, description, status, remoteStatus, url: `https://dev.azure.com/acme/Shop/_workitems/edit/${key}`, updatedAt: '2026-11-22T10:00:00.000Z' });
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
      control.settings = { available: true, projectFolder: folder, profiles: profiles.map(profile => ({ ...profile })), activeProfileId, ...(configurationIssue ? { configurationIssue } : {}), git: config.git, atlassian: config.atlassian, azureDevOps: azure };
    };
    const profileName = (value: string, exceptId?: string): string => {
      const name = String(value ?? '').trim();
      if (!name || name.length > 40) throw new Error('Profilname ist ungültig.');
      if (profiles.some(profile => profile.id !== exceptId && profile.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('Ein Profil mit diesem Namen existiert bereits.');
      return name;
    };
    const delayed: Record<'git' | 'jira' | 'jiraCreate', Array<() => void>> = { git: [], jira: [], jiraCreate: [] };
    Object.defineProperty(window, '__resolvePluginRequest', { value: (plugin: 'git' | 'jira' | 'jiraCreate') => {
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
        installPlugin: async (id: 'git' | 'jira' | 'azure-devops') => {
          if (id === 'azure-devops') { azure.installed = true; azure.message = 'Azure-DevOps-Plugin ist deaktiviert.'; return snapshot(); }
          (id === 'git' ? control.settings.git : control.settings.atlassian).installed = true;
          return snapshot();
        },
        uninstallPlugin: async (id: 'git' | 'jira' | 'azure-devops') => {
          if (id === 'azure-devops') { Object.assign(azure, { installed: false, enabled: false, organizationUrl: '', project: '', credentialStored: false, health: 'disabled', message: 'Azure-DevOps-Plugin ist nicht installiert.' }); return snapshot(); }
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
        configureAzureDevOps: async (input: ConfigureAzureDevOpsPluginInput) => {
          control.calls.azure.push(structuredClone(input));
          if (input.enabled && (!input.organizationUrl || !input.project || !(input.accessToken || azure.credentialStored))) throw new Error('Für Azure DevOps werden Organisation, Projekt und ein Personal Access Token benötigt.');
          const { accessToken, clearCredential, ...fields } = input;
          Object.assign(azure, fields, { apiVersion: input.apiVersion || (input.variant === 'server' ? '6.0' : '7.1'), credentialStored: clearCredential ? false : Boolean(accessToken || azure.credentialStored), health: input.enabled ? 'attention' : 'disabled', message: input.enabled ? 'Azure DevOps ist eingerichtet. Verbindung testen, um den Zugriff zu prüfen.' : 'Azure-DevOps-Plugin ist deaktiviert.' });
          return snapshot();
        },
        testAzureDevOps: async () => { Object.assign(azure, { health: 'ready', message: `Azure DevOps: verbunden mit Projekt „${azure.project}“` }); return { ok: true, message: azure.message }; },
        // The wiki of Azure DevOps (#284): pages are found by path, a link is kept with the settings, a publication is recorded.
        listAzureWikiPages: async (query: string) => ['/Architektur', '/Architektur/Übersicht', '/Betrieb'].filter((path) => path.toLowerCase().includes(query.toLowerCase())).map((path) => ({ provider: 'azure-devops' as const, id: `wiki-1\n${path}`, title: path.split('/').pop()!, detail: `Shop.wiki${path}`, url: `https://dev.azure.com/acme/Shop/_wiki/wikis/wiki-1?pagePath=${encodeURIComponent(path)}` })),
        setAzureWikiLiveLink: async (input: { diagramPageId: string; documentId: string; wikiPage: string | null }) => {
          control.calls.wikiLinks.push({ diagramPageId: input.diagramPageId, wikiPage: input.wikiPage });
          const others = (azure.wikiPageLinks ?? []).filter((link) => link.diagramPageId !== input.diagramPageId);
          const links = input.wikiPage === null ? others : [...others, { provider: 'azure-devops' as const, diagramPageId: input.diagramPageId, pageId: input.wikiPage, pageTitle: `Shop.wiki${input.wikiPage.split('\n')[1]}`, pageUrl: 'https://dev.azure.com/acme/Shop/_wiki/wikis/wiki-1', siteUrl: azure.organizationUrl, documentId: input.documentId, usable: true }];
          if (links.length) azure.wikiPageLinks = links; else delete azure.wikiPageLinks;
          return snapshot();
        },
        publishAzureWikiLive: async (input: { diagramPageId: string; images: Array<{ png: Uint8Array }> }) => {
          control.calls.wikiPublications.push({ diagramPageId: input.diagramPageId, bytes: input.images[0]!.png.byteLength });
          return { status: 'synced' as const, message: 'Diagramm im Wiki aktualisiert.', uploaded: 1, bodyUpdated: true, syncedAt: new Date().toISOString() };
        },
        listAzureWorkItems: async () => [workItem('7', 'Checkout absichern', 'Aus Azure Boards', 'Active', 'doing')],
        createAzureWorkItem: async (input: { title: string; description: string }) => { control.calls.azureCreates.push(input.title); return workItem(String(19 + control.calls.azureCreates.length), input.title, input.description, 'New', 'todo'); },
        updateAzureWorkItem: async (input: { key: string; title?: string }) => workItem(input.key, input.title ?? 'Checkout absichern', '', 'Active', 'doing'),
        transitionAzureWorkItem: async (input: { key: string; status: 'todo' | 'doing' | 'review' | 'done' }) => { control.calls.azureTransitions.push(input); return workItem(input.key, 'Checkout absichern', 'Aus Azure Boards', input.status === 'done' ? 'Closed' : 'Active', input.status); },
        createJiraIssue: async (input: { title: string; description: string }) => {
          control.calls.jiraCreates.push(input.title);
          const number = control.calls.jiraCreates.length;
          if (control.holdJiraCreate) await new Promise<void>(resolve => delayed.jiraCreate.push(resolve));
          if (control.jiraCreateFailure) throw new Error(control.jiraCreateFailure);
          return { id: String(100 + number), key: `SK-${number}`, title: input.title, description: input.description, status: 'todo' as const, remoteStatus: 'To Do', url: `https://example.atlassian.net/browse/SK-${number}`, updatedAt: '2026-11-22T10:00:00.000Z' };
        },
        // Ticket cards (#283): single tickets of both trackers, read, found and changed like in the main process.
        getWorkItem: async ({ provider, key }: { provider: string; key: string }) => {
          control.calls.ticketReads.push(`${provider}:${key}`);
          const found = ticketStore.get(`${provider}:${key}`);
          if (!found) throw new Error('Ungültiges Ticket.');
          return structuredClone(found);
        },
        searchWorkItems: async ({ provider, query }: { provider: string; query: string }) => [...ticketStore.entries()].filter(([id, value]) => id.startsWith(`${provider}:`) && `${String(value.key)} ${String(value.title)}`.toLowerCase().includes(query.toLowerCase())).map(([, value]) => ({ provider, ...structuredClone(value) })),
        updateWorkItemFields: async (input: Record<string, unknown>) => {
          control.calls.ticketUpdates.push(structuredClone(input));
          const { provider, key, assignee, estimate, ...rest } = input;
          if (Array.isArray(rest.labels) && rest.labels.some((label: string) => /\s/.test(label))) throw new Error('Ein Jira-Label darf keine Leerzeichen enthalten.');
          const next: Record<string, unknown> = { ...ticketStore.get(`${String(provider)}:${String(key)}`)!, ...rest };
          if (assignee === null) delete next.assignee; else if (assignee !== undefined) next.assignee = assignee;
          if (estimate === null) delete next.estimate; else if (estimate !== undefined) next.estimate = estimate;
          if (rest.status) next.remoteStatus = ({ todo: 'To Do', doing: 'In Progress', review: 'In Review', done: 'Done' } as Record<string, string>)[String(rest.status)];
          ticketStore.set(`${String(provider)}:${String(key)}`, next);
          return structuredClone(next);
        },
        listJiraIssues: async () => { control.calls.jiraSyncs += 1; return []; }, updateJiraIssue: async () => { throw new Error('not used'); }, transitionJiraIssue: async () => { throw new Error('not used'); }, onEvent: () => () => {},
      },
    } });
  }, { cancelSave: options.cancelSave ?? false, theme: options.theme ?? 'light', configurationIssue: options.configurationIssue });
  await start(page);
}

async function start(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
}

async function openPlugins(page: Page): Promise<Locator> {
  await page.getByTestId('workspace-menu-button').click();
  await page.getByRole('menuitemcheckbox', { name: 'Plugins', exact: true }).click();
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

for (const theme of ['light', 'dark'] as const) {
  test(`damaged profile storage explains recovery and disables mutations in both dialogs (${theme}, #161)`, async ({ page }) => {
    const message = 'Die Plugin-Konfiguration hat eine nicht unterstützte Version. Die Datei bleibt unverändert. Beende die App, sichere die Datei und starte danach neu.';
    await desktop(page, { theme, configurationIssue: { source: 'profiles', kind: 'unsupported-version', blocksChanges: true, message } });
    const plugins = await openPlugins(page);
    await expect(plugins.getByRole('alert')).toHaveText(message);
    await expect(plugins.getByRole('button', { name: 'Git speichern', exact: true })).toBeDisabled();
    await expect(plugins.getByRole('button', { name: 'Deinstallieren', exact: true })).toBeDisabled();
    await selectPlugin(plugins, 'Jira');
    await expect(plugins.getByRole('button', { name: 'Jira speichern', exact: true })).toBeDisabled();
    await expect(plugins.getByLabel('API-Token', { exact: true })).toBeDisabled();
    await closePlugins(plugins);
    const profiles = await openProfiles(page);
    await expect(profiles.getByRole('alert')).toHaveText(message);
    await expect(profiles.getByRole('button', { name: 'Neues Profil', exact: true })).toBeDisabled();
    await expect(profiles.getByRole('button', { name: 'Profil „Standard“ umbenennen', exact: true })).toBeDisabled();
    await expect(profiles.getByRole('button', { name: 'Profil „Standard“ kopieren', exact: true })).toBeDisabled();
    await closeProfiles(profiles);
    const calls = (await state(page)).calls;
    expect(calls.git).toEqual([]); expect(calls.jira).toEqual([]); expect(calls.profiles).toEqual([]);
  });
}

test('a legacy configuration warning preserves access to independent editor profiles (#161)', async ({ page }) => {
  const message = 'Die alte Ordner-Konfiguration wurde nicht übernommen. Die Datei bleibt unverändert. Die Editor-Profile können weiter verwendet werden.';
  await desktop(page, { configurationIssue: { source: 'legacy', kind: 'invalid-json', blocksChanges: false, message } });
  const plugins = await openPlugins(page);
  await expect(plugins.getByRole('alert')).toHaveText(message);
  await expect(plugins.getByRole('button', { name: 'Git speichern', exact: true })).toBeEnabled();
  await closePlugins(plugins);
  const profiles = await openProfiles(page);
  await expect(profiles.getByRole('button', { name: 'Neues Profil', exact: true })).toBeEnabled();
});

test('bundled plugins start installed, are configurable in the profile right away, and saving the diagram gives Git its folder', async ({ page }) => {
  await desktop(page);
  const dialog = await openPlugins(page);
  await expect(dialog.getByRole('tab', { name: /Installiert/ })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('tab', { name: /Installiert/ })).toContainText('3');
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

test('Jira synchronizes automatically and exposes no manual sync button', async ({ page }) => {
  await desktop(page);
  const dialog = await prepareProject(page);
  await fillJira(dialog);
  await dialog.getByRole('checkbox', { name: 'Aktiv', exact: true }).check();
  await dialog.getByRole('button', { name: 'Jira speichern', exact: true }).click();
  await expect(dialog.getByText('Jira-Aufgaben werden alle fünf Sekunden automatisch synchronisiert.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Jira-Board synchronisieren', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Plugin-Einstellungen schließen' }).click();

  await page.getByTestId('workspace-menu-button').click();
  await page.getByTestId('workspace-menu-tasks').click();
  const board = page.getByTestId('task-board');
  await expect(board).toBeVisible();
  await expect(board.getByRole('button', { name: 'Jira synchronisieren', exact: true })).toHaveCount(0);
  await expect.poll(async () => (await state(page)).calls.jiraSyncs, { timeout: 7_000 }).toBeGreaterThan(0);
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
  await expect(dialog.getByRole('button', { name: 'Jira-Board synchronisieren', exact: true })).toHaveCount(0);
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
  const last = dialog.getByRole('complementary').getByRole('button', { name: /^Confluence\b/ });
  await installed.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
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
    // Git and Jira have a vendor file; Confluence has none yet and shows its letter (#282).
    await expect(tiles).toHaveCount(3);
    await expect(tiles.nth(2)).toHaveText('C');
    for (const tile of (await tiles.all()).slice(0, 2)) {
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
  await expect(dialog.getByRole('tab', { name: /Installiert/ })).toContainText('3');
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
  // The last entry of the menu is the support link (#241).
  await expect(menu.getByTestId('workspace-menu-support')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(menu).toBeHidden();
  await page.getByTestId('workspace-menu-button').click();
  await menu.getByRole('menuitemcheckbox', { name: 'Plugins', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Plugins', exact: true });
  await expect(dialog.getByTestId('plugin-active-profile')).toHaveCount(0);
});

test('Jira and Confluence are two plugins: each has its own switch and fields and saves only for itself (#282)', async ({ page }) => {
  await desktop(page);
  const dialog = await prepareProject(page);
  await fillJira(dialog);
  await dialog.getByRole('button', { name: 'Jira speichern', exact: true }).click();
  await expect.poll(async () => (await state(page)).calls.jira.length).toBe(1);
  expect((await state(page)).calls.jira[0]).toMatchObject({ plugin: 'jira', jiraProjectKey: 'ARCH' });
  // The Jira card no longer asks for the Confluence space.
  await expect(dialog.getByLabel('Confluence-Space (optional)', { exact: true })).toHaveCount(0);

  await dialog.getByRole('complementary').getByRole('button', { name: /^Confluence\b/ }).click();
  await expect(dialog.getByRole('heading', { name: 'Confluence-Konfiguration', exact: true })).toBeVisible();
  // The connection is shared: address and user are already there; only the space belongs to Confluence.
  await expect(dialog.getByLabel('Atlassian-URL', { exact: true })).toHaveValue('https://example.atlassian.net');
  await expect(dialog.getByLabel('Jira-Projekt', { exact: true })).toHaveCount(0);
  await dialog.getByLabel('Confluence-Space (optional)', { exact: true }).fill('DOC');
  await dialog.getByRole('button', { name: 'Confluence speichern', exact: true }).click();
  await expect.poll(async () => (await state(page)).calls.jira.length).toBe(2);
  expect((await state(page)).calls.jira[1]).toMatchObject({ plugin: 'confluence', confluenceSpaceKey: 'DOC', siteUrl: 'https://example.atlassian.net' });
  expect((await new AxeBuilder({ page }).include('.plugin-dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
});

test('a task form that is being saved ignores a second submit; a ticket that failed can be created again (#293)', async ({ page }) => {
  await desktop(page);
  const dialog = await prepareProject(page);
  await fillJira(dialog);
  await dialog.getByRole('checkbox', { name: 'Aktiv', exact: true }).check();
  await dialog.getByRole('button', { name: 'Jira speichern', exact: true }).click();
  await expect(dialog.getByText('Jira-Aufgaben werden alle fünf Sekunden automatisch synchronisiert.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Plugin-Einstellungen schließen' }).click();
  await page.getByTestId('workspace-menu-button').click();
  await page.getByTestId('workspace-menu-tasks').click();
  const board = page.getByTestId('task-board');

  // Jira takes its time: Enter and a second click while the first request is on its way create nothing more.
  await page.evaluate(() => { (window as unknown as TestWindow).__pluginTest.holdJiraCreate = true; });
  await board.getByRole('button', { name: 'Neue Aufgabe' }).click();
  const form = page.getByRole('dialog', { name: 'Neue Aufgabe' });
  const title = form.getByRole('textbox', { name: 'Titel' });
  await title.fill('Freigabe prüfen');
  await title.press('Enter');
  const submit = form.getByTestId('task-submit');
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveText('Wird gespeichert …');
  await expect(submit).toHaveAttribute('aria-busy', 'true');
  await title.press('Enter');
  await submit.click({ force: true });
  await expect.poll(async () => (await state(page)).calls.jiraCreates).toEqual(['Freigabe prüfen']);
  await page.evaluate(() => (window as unknown as TestWindow).__resolvePluginRequest('jiraCreate'));
  await expect(form).toHaveCount(0);
  await expect(board.locator('.task-card')).toHaveCount(1);
  await expect(board.locator('.task-card')).toContainText('SK-1');
  expect((await state(page)).calls.jiraCreates).toEqual(['Freigabe prüfen']);

  // Jira refuses: the card stays local and offers the ticket again, once.
  await page.evaluate(() => { const control = (window as unknown as TestWindow).__pluginTest; control.holdJiraCreate = false; control.jiraCreateFailure = 'Jira ist nicht erreichbar.'; });
  await board.getByRole('button', { name: 'Neue Aufgabe' }).click();
  await page.getByRole('dialog', { name: 'Neue Aufgabe' }).getByRole('textbox', { name: 'Titel' }).fill('Zweite Aufgabe');
  await page.getByRole('dialog', { name: 'Neue Aufgabe' }).getByTestId('task-submit').click();
  await expect(page.getByRole('region', { name: 'Meldungen' }).getByText('Lokale Aufgabe erstellt; Ticket in Jira nicht angelegt: Jira ist nicht erreichbar. In der Aufgabe lässt es sich erneut anlegen.')).toBeVisible();
  await expect(board.locator('.task-card')).toHaveCount(2);
  await page.evaluate(() => { const control = (window as unknown as TestWindow).__pluginTest; control.jiraCreateFailure = ''; control.holdJiraCreate = true; });
  await board.locator('.card-open').filter({ hasText: 'Zweite Aufgabe' }).click();
  const edit = page.getByRole('dialog', { name: 'Aufgabe bearbeiten' });
  const again = edit.getByTestId('task-create-in-jira');
  await expect(again).toHaveText('In Jira anlegen');
  await again.click();
  await expect(again).toBeDisabled();
  await expect(again).toHaveText('Ticket wird angelegt …');
  await again.click({ force: true });
  await expect.poll(async () => (await state(page)).calls.jiraCreates).toEqual(['Freigabe prüfen', 'Zweite Aufgabe', 'Zweite Aufgabe']);
  await page.evaluate(() => (window as unknown as TestWindow).__resolvePluginRequest('jiraCreate'));
  await expect(again).toHaveCount(0);
  await expect(edit.locator('.external-badge')).toContainText('SK-3');
  await expect(board.locator('.task-card')).toHaveCount(2);
  // A task that has its ticket offers no second one.
  expect((await state(page)).calls.jiraCreates).toHaveLength(3);
});

test('Azure DevOps is installed from the marketplace, set up for cloud or server, and feeds the task board (#284)', async ({ page }) => {
  await desktop(page);
  const dialog = await prepareProject(page);
  // Not installed: it is offered in the marketplace only.
  await expect(dialog.getByRole('complementary').getByRole('button', { name: /^Azure DevOps\b/ })).toHaveCount(0);
  await dialog.getByRole('tab', { name: /Marketplace/ }).click();
  await dialog.getByRole('complementary').getByRole('button', { name: /^Azure DevOps\b/ }).click();
  await expect(dialog.getByText('Work Items per WIQL-Abfrage laden')).toBeVisible();
  await dialog.getByRole('button', { name: 'Installieren', exact: true }).click();
  const config = dialog.getByTestId('azure-devops-config');
  await expect(config.getByRole('heading', { name: 'Azure-DevOps-Konfiguration' })).toBeVisible();

  // The server variant asks for the address of the collection and proposes the version servers know.
  await config.getByRole('radio', { name: /Azure DevOps Server/ }).check();
  await expect(config.getByLabel('Adresse der Sammlung', { exact: true })).toBeVisible();
  await expect(config.getByLabel('API-Version', { exact: true })).toHaveValue('6.0');
  await config.getByRole('radio', { name: /Azure DevOps Services/ }).check();
  await expect(config.getByLabel('API-Version', { exact: true })).toHaveValue('7.1');

  // Switched on without a token: the reason is shown and the draft stays.
  await config.getByLabel('Organisation', { exact: true }).fill('https://dev.azure.com/acme');
  await config.getByLabel('Projekt', { exact: true }).fill('Shop');
  await config.getByRole('checkbox', { name: 'Aktiv', exact: true }).check();
  await config.getByTestId('azure-devops-save').click();
  await expect(dialog.getByText('Für Azure DevOps werden Organisation, Projekt und ein Personal Access Token benötigt.')).toBeVisible();
  await expect(config.getByLabel('Projekt', { exact: true })).toHaveValue('Shop');
  await expect(config.getByTestId('azure-devops-test')).toBeDisabled();

  await config.getByLabel('Personal Access Token', { exact: true }).fill('pat-secret');
  await config.getByTestId('azure-devops-save').click();
  await expect(dialog.getByText('Azure-DevOps-Plugin gespeichert.')).toBeVisible();
  // The token is never shown again.
  await expect(config.getByLabel('Personal Access Token', { exact: true })).toHaveValue('');
  await expect(config.getByLabel('Personal Access Token', { exact: true })).toHaveAttribute('placeholder', 'Gespeichert – leer lassen zum Behalten');
  expect((await state(page)).calls.azure.at(-1)).toMatchObject({ enabled: true, variant: 'cloud', organizationUrl: 'https://dev.azure.com/acme', project: 'Shop', apiVersion: '7.1', readOnly: false, accessToken: 'pat-secret' });
  await config.getByTestId('azure-devops-test').click();
  await expect(dialog.getByText('Azure DevOps: verbunden mit Projekt „Shop“').first()).toBeVisible();
  expect((await new AxeBuilder({ page }).include('.plugin-dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await dialog.getByRole('button', { name: 'Plugin-Einstellungen schließen' }).click();

  // The task board reads the work items and creates new tasks as work items.
  await page.getByTestId('workspace-menu-button').click();
  await page.getByTestId('workspace-menu-tasks').click();
  const board = page.getByTestId('task-board');
  await expect(board.locator('.task-card', { hasText: 'Checkout absichern' })).toContainText('7', { timeout: 8_000 });
  await board.getByRole('button', { name: 'Neue Aufgabe' }).click();
  await page.getByRole('dialog', { name: 'Neue Aufgabe' }).getByRole('textbox', { name: 'Titel' }).fill('Warenkorb');
  await page.getByRole('dialog', { name: 'Neue Aufgabe' }).getByTestId('task-submit').click();
  await expect(page.getByRole('region', { name: 'Meldungen' }).getByText('Ticket 20 in Azure DevOps erstellt.')).toBeVisible();
  expect((await state(page)).calls.azureCreates).toEqual(['Warenkorb']);
  expect((await state(page)).calls.jiraCreates).toEqual([]);
  await board.locator('.card-open').filter({ hasText: 'Warenkorb' }).click();
  const edit = page.getByRole('dialog', { name: 'Aufgabe bearbeiten' });
  await expect(edit.locator('.external-badge')).toContainText('20');
  await expect(edit.getByRole('button', { name: 'In Azure DevOps öffnen' })).toBeVisible();
});


test('the form of a Jira task sends title and description; the next sync keeps them and a refusal is said (#270)', async ({ page }) => {
  test.setTimeout(90_000);
  await desktop(page);
  // A stand-in for Jira: it keeps what it is sent and answers every sync with it.
  await page.evaluate(() => {
    const control = (window as unknown as TestWindow).__pluginTest;
    const remote = { id: '100', key: 'ARCH-7', title: 'Schnittstelle prüfen', description: 'Text aus Jira', status: 'todo' as const, remoteStatus: 'To Do', url: 'https://example.atlassian.net/browse/ARCH-7', updatedAt: '2026-11-22T10:00:00.000Z' };
    const jira = { updates: [] as Array<Record<string, unknown>>, failure: '' };
    Object.assign(window, { __jiraForm: jira });
    const plugins = (window as unknown as { sketchdraw: { plugins: Record<string, unknown> } }).sketchdraw.plugins;
    plugins['listJiraIssues'] = async () => { control.calls.jiraSyncs += 1; return [{ ...remote }]; };
    plugins['updateJiraIssue'] = async (input: { key: string; title?: string; description?: string }) => {
      jira.updates.push(input);
      if (jira.failure) throw new Error(jira.failure);
      if (input.title !== undefined) remote.title = input.title;
      if (input.description !== undefined) remote.description = input.description;
      remote.updatedAt = new Date().toISOString();
      return { ...remote };
    };
  });
  const jira = () => page.evaluate(() => (window as unknown as { __jiraForm: { updates: Array<Record<string, unknown>>; failure: string } }).__jiraForm);
  /** Two more answers from Jira: one sync may already be on its way when the count is read. */
  const afterNextSync = async () => {
    const seen = (await state(page)).calls.jiraSyncs;
    await expect.poll(async () => (await state(page)).calls.jiraSyncs, { timeout: 20_000 }).toBeGreaterThanOrEqual(seen + 2);
  };

  const dialog = await prepareProject(page);
  await fillJira(dialog);
  await dialog.getByRole('checkbox', { name: 'Aktiv', exact: true }).check();
  await dialog.getByRole('button', { name: 'Jira speichern', exact: true }).click();
  await expect(dialog.getByText('Jira-Aufgaben werden alle fünf Sekunden automatisch synchronisiert.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Plugin-Einstellungen schließen' }).click();
  await page.getByTestId('workspace-menu-button').click();
  await page.getByTestId('workspace-menu-tasks').click();
  const board = page.getByTestId('task-board');
  const card = board.locator('.task-card');
  await expect(card).toHaveCount(1, { timeout: 15_000 });
  await expect(card).toContainText('ARCH-7');

  // The form says what saving does to the text in Jira, and the note belongs to the description field.
  await board.locator('.card-open').filter({ hasText: 'Schnittstelle prüfen' }).click();
  let form = page.getByRole('dialog', { name: 'Aufgabe bearbeiten' });
  await expect(form.locator('.external-badge')).toContainText('ARCH-7');
  const note = form.getByText('Titel und Beschreibung werden beim Speichern nach Jira übertragen. Die Beschreibung ersetzt dort den bisherigen Text als einfachen Text.');
  await expect(note).toBeVisible();
  await expect(form.getByRole('textbox', { name: 'Beschreibung' })).toHaveAttribute('aria-describedby', (await note.getAttribute('id'))!);
  await expect(form.getByRole('textbox', { name: 'Beschreibung' })).toHaveValue('Text aus Jira');

  await form.getByRole('textbox', { name: 'Titel' }).fill('Schnittstelle abnehmen');
  await form.getByRole('textbox', { name: 'Beschreibung' }).fill('Erste Zeile\nZweite Zeile');
  await form.getByTestId('task-submit').click();
  await expect(form).toHaveCount(0);
  await expect.poll(async () => (await jira()).updates).toEqual([{ key: 'ARCH-7', title: 'Schnittstelle abnehmen', description: 'Erste Zeile\nZweite Zeile' }]);

  // The next answers from Jira carry the saved texts; nothing falls back.
  await afterNextSync();
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Schnittstelle abnehmen');
  await board.locator('.card-open').filter({ hasText: 'Schnittstelle abnehmen' }).click();
  form = page.getByRole('dialog', { name: 'Aufgabe bearbeiten' });
  await expect(form.getByRole('textbox', { name: 'Titel' })).toHaveValue('Schnittstelle abnehmen');
  await expect(form.getByRole('textbox', { name: 'Beschreibung' })).toHaveValue('Erste Zeile\nZweite Zeile');

  // Saving without a change of the texts sends neither of them again.
  await form.getByTestId('task-submit').click();
  await expect(form).toHaveCount(0);
  expect((await jira()).updates).toHaveLength(1);

  // Jira refuses: the message says so and says what happens next, and the next sync shows the text of Jira again.
  await page.evaluate(() => { (window as unknown as { __jiraForm: { failure: string } }).__jiraForm.failure = 'Feld gesperrt.'; });
  await board.locator('.card-open').filter({ hasText: 'Schnittstelle abnehmen' }).click();
  form = page.getByRole('dialog', { name: 'Aufgabe bearbeiten' });
  await form.getByRole('textbox', { name: 'Titel' }).fill('Gesperrter Titel');
  await form.getByTestId('task-submit').click();
  await expect(page.getByRole('region', { name: 'Meldungen' }).getByText('Jira hat die Änderung nicht übernommen: Feld gesperrt. Beim nächsten Abgleich gilt wieder der Stand aus Jira.')).toBeVisible();
  await afterNextSync();
  await expect(card).toContainText('Schnittstelle abnehmen');
  await expect(card).not.toContainText('Gesperrter Titel');
});

async function connectJira(page: Page): Promise<void> {
  const dialog = await prepareProject(page);
  await fillJira(dialog);
  await dialog.getByRole('checkbox', { name: 'Aktiv', exact: true }).check();
  await dialog.getByRole('button', { name: 'Jira speichern', exact: true }).click();
  await expect(dialog.getByText('Jira-Aufgaben werden alle fünf Sekunden automatisch synchronisiert.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Plugin-Einstellungen schließen' }).click();
}

/** The drawing of a card lets the pointer through to its rectangle, so the double click goes to the place, not to the drawing. */
async function openCard(page: Page, card: Locator): Promise<void> {
  const box = (await card.boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
}

for (const theme of ['light', 'dark'] as const) {
  test(`a ticket is found, placed as a card and edited from the canvas (${theme}, #283)`, async ({ page }) => {
    test.setTimeout(90_000);
    await desktop(page, { theme });
    await connectJira(page);

    // Find the ticket by part of its title and put it on the canvas.
    await page.getByTestId('workspace-menu-button').click();
    await page.getByRole('menuitem', { name: 'Ticket-Karte einfügen …' }).click();
    const dialog = page.getByTestId('ticket-dialog');
    await expect(dialog.getByRole('heading', { name: 'Ticket als Karte einfügen' })).toBeVisible();
    await expect(dialog.getByTestId('ticket-query')).toBeFocused();
    await dialog.getByTestId('ticket-query').fill('nichts davon');
    await dialog.getByTestId('ticket-query').press('Enter');
    await expect(dialog.getByTestId('ticket-no-results')).toBeVisible();
    await dialog.getByTestId('ticket-query').fill('Warenkorb');
    await dialog.getByTestId('ticket-search').click();
    await expect(dialog.getByTestId('ticket-results').getByRole('listitem')).toHaveCount(2);
    expect((await new AxeBuilder({ page }).include('.ticket-dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    await dialog.getByRole('button', { name: 'ARCH-12 einfügen' }).click();
    await expect(dialog).toBeHidden();

    const card = page.getByTestId('ticket-card');
    await expect(card).toHaveCount(1);
    await expect(card.getByTestId('ticket-card-key')).toContainText('ARCH-12');
    await expect(card.getByTestId('ticket-card-status')).toContainText('In Progress');
    await expect(card.getByTestId('ticket-card-title')).toContainText('Warenkorb übersteht');
    await expect(card.getByTestId('ticket-card-meta')).toContainText('Mara Lind');
    await expect(card.getByTestId('ticket-card-meta')).toContainText('5');
    await expect(card.getByTestId('ticket-card-labels')).toContainText('checkout');
    await expect(card.getByTestId('ticket-card-labels')).toContainText('Storefront');
    await expect(page.getByRole('region', { name: 'Meldungen' }).getByText(/Der Inhalt des Tickets steht jetzt im Dokument/)).toBeVisible();

    // A double click opens the ticket, not the text of the rectangle.
    await openCard(page, card);
    await expect(dialog.getByRole('heading', { name: 'Ticket ARCH-12' })).toBeVisible();
    await expect(dialog.getByLabel('Titel', { exact: true })).toHaveValue('Warenkorb übersteht den Gerätewechsel');
    await expect(dialog.getByLabel('Beschreibung', { exact: true })).toHaveValue('Der Warenkorb wird am Konto gespeichert.');
    await expect(dialog.getByLabel('Zugewiesen an', { exact: true })).toHaveValue('Mara Lind');
    await expect(dialog.getByLabel('Labels', { exact: true })).toHaveValue('checkout, q1');
    await expect(dialog.getByLabel('Komponenten', { exact: true })).toHaveValue('Storefront');
    await expect(dialog.getByLabel('Schätzung', { exact: true })).toHaveValue('5');
    expect((await new AxeBuilder({ page }).include('.ticket-dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    if (process.env.TICKET_SHOTS) await page.screenshot({ path: `/tmp/shots/ticket-edit-${theme}.png` });

    // The tracker refuses a label with a space: the dialog stays open with what was typed.
    await dialog.getByLabel('Labels', { exact: true }).fill('checkout, zwei worte');
    await dialog.getByTestId('ticket-save').click();
    await expect(page.getByRole('region', { name: 'Meldungen' }).getByText('Jira hat die Änderung nicht übernommen: Ein Jira-Label darf keine Leerzeichen enthalten.')).toBeVisible();
    await expect(dialog.getByLabel('Labels', { exact: true })).toHaveValue('checkout, zwei worte');

    // Only what changed is sent; the card shows what the tracker answered.
    await dialog.getByLabel('Labels', { exact: true }).fill('checkout, q2');
    await dialog.getByLabel('Titel', { exact: true }).fill('Warenkorb am Konto');
    await dialog.getByLabel('Zugewiesen an', { exact: true }).fill('');
    await dialog.getByLabel('Schätzung', { exact: true }).fill('8');
    await dialog.getByRole('combobox', { name: 'Status' }).click();
    await page.getByRole('option', { name: 'Erledigt' }).click();
    await dialog.getByTestId('ticket-save').click();
    await expect(dialog).toBeHidden();
    expect((await state(page)).calls.ticketUpdates.at(-1)).toEqual({ provider: 'jira', key: 'ARCH-12', title: 'Warenkorb am Konto', status: 'done', assignee: null, labels: ['checkout', 'q2'], estimate: '8' });
    await expect(card.getByTestId('ticket-card-title')).toContainText('Warenkorb am Konto');
    await expect(card.getByTestId('ticket-card-status')).toContainText('Done');
    await expect(card.getByTestId('ticket-card-meta')).toContainText('Niemand zugewiesen');
    await expect(card.getByTestId('ticket-card-labels')).toContainText('q2');
    if (process.env.TICKET_SHOTS) await page.screenshot({ path: `/tmp/shots/ticket-card-${theme}.png` });
  });
}

test('a pasted ticket address becomes a card; a card without its tracker stays readable (#283)', async ({ page }) => {
  test.setTimeout(90_000);
  await desktop(page);
  await connectJira(page);
  await page.getByTestId('whiteboard-canvas').click({ position: { x: 500, y: 380 } });
  await page.evaluate(() => {
    const data = new DataTransfer(); data.setData('text/plain', 'https://example.atlassian.net/browse/ARCH-13');
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  const card = page.getByTestId('ticket-card');
  await expect(card.getByTestId('ticket-card-key')).toContainText('ARCH-13');
  await expect(card.getByTestId('ticket-card-meta')).toContainText('Niemand zugewiesen');
  expect((await state(page)).calls.ticketReads).toEqual(['jira:ARCH-13']);

  // Jira is switched off: the card keeps its content, the dialog says why nothing can be changed.
  const plugins = await openPlugins(page);
  await selectPlugin(plugins, 'Jira');
  await plugins.getByRole('checkbox', { name: 'Aktiv', exact: true }).uncheck();
  await plugins.getByRole('button', { name: 'Jira speichern', exact: true }).click();
  await plugins.getByRole('button', { name: 'Plugin-Einstellungen schließen' }).click();
  await expect(card.getByTestId('ticket-card-title')).toContainText('Warenkorb leeren');
  await openCard(page, card);
  const dialog = page.getByTestId('ticket-dialog');
  await expect(dialog.getByTestId('ticket-offline')).toBeVisible();
  await expect(dialog.getByLabel('Titel', { exact: true })).toBeDisabled();
  await expect(dialog.getByTestId('ticket-save')).toHaveCount(0);
  await expect(dialog.getByTestId('ticket-refresh')).toBeDisabled();
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByTestId('workspace-menu-button').click();
  await expect(page.getByRole('menuitem', { name: 'Ticket-Karte einfügen …' })).toHaveCount(0);
});

for (const theme of ['light', 'dark'] as const) {
  test(`a page of the diagram is linked to a page of the Azure DevOps wiki and published there (${theme}, #284)`, async ({ page }) => {
    test.setTimeout(90_000);
    await desktop(page, { theme });
    const plugins = await prepareProject(page);
    await plugins.getByRole('tab', { name: /Marketplace/ }).click();
    await plugins.getByRole('complementary').getByRole('button', { name: /^Azure DevOps\b/ }).click();
    await expect(plugins.getByText('Seiten des Diagramms als Bild auf Seiten des Wikis zeigen und aktuell halten')).toBeVisible();
    await plugins.getByRole('button', { name: 'Installieren', exact: true }).click();
    const config = plugins.getByTestId('azure-devops-config');
    await expect(config.getByText(/„Wiki: Lesen und Schreiben“/)).toBeVisible();
    await config.getByLabel('Organisation', { exact: true }).fill('https://dev.azure.com/acme');
    await config.getByLabel('Projekt', { exact: true }).fill('Shop');
    await config.getByLabel('Personal Access Token', { exact: true }).fill('pat-secret');
    await config.getByRole('checkbox', { name: 'Aktiv', exact: true }).check();
    await config.getByTestId('azure-devops-save').click();
    await expect(plugins.getByText('Azure-DevOps-Plugin gespeichert.')).toBeVisible();
    await plugins.getByRole('button', { name: 'Plugin-Einstellungen schließen' }).click();

    // Something to show, then the menu of the page: with Azure DevOps alone the entry names its wiki.
    await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
    await page.mouse.move(420, 300); await page.mouse.down(); await page.mouse.move(620, 400, { steps: 8 }); await page.mouse.up();
    await page.getByTestId('page-switcher').click();
    const panel = page.getByRole('dialog', { name: 'Seiten', exact: true });
    await panel.getByRole('button', { name: 'Aktionen für Seite 1', exact: true }).click();
    await page.getByTestId('page-menu').getByRole('menuitem', { name: 'Seite des Azure-DevOps-Wikis verknüpfen…', exact: true }).click();
    const dialog = page.getByTestId('confluence-page-link-dialog');
    await expect(dialog.getByRole('heading', { name: 'Wiki-Seite für „Seite 1“' })).toBeVisible();
    await expect(dialog.getByText(/gewählten Seite des Azure-DevOps-Wikis/)).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Wiki-Seite wählen' })).toBeVisible();
    // One wiki is on: there is nothing to choose between.
    await expect(dialog.getByTestId('page-link-wiki')).toHaveCount(0);
    await dialog.getByRole('searchbox', { name: 'Wiki-Seiten suchen' }).fill('gibt es nicht');
    await dialog.getByRole('button', { name: 'Suchen', exact: true }).click();
    await expect(dialog.getByText('Keine Wiki-Seite gefunden.')).toBeVisible();
    await dialog.getByRole('searchbox', { name: 'Wiki-Seiten suchen' }).fill('archi');
    await dialog.getByRole('searchbox', { name: 'Wiki-Seiten suchen' }).press('Enter');
    const results = dialog.getByTestId('confluence-page-link-results').getByRole('listitem');
    await expect(results).toHaveCount(2);
    await expect(results.nth(1)).toContainText('Übersicht'); await expect(results.nth(1)).toContainText('Shop.wiki/Architektur/Übersicht');
    await dialog.getByRole('button', { name: '„Seite 1“ mit „Übersicht“ verknüpfen' }).click();

    // Linked: the card names the page and the organization, and the page is published without a further step.
    const card = dialog.getByTestId('confluence-link-card');
    await expect(card.getByTestId('confluence-link-target')).toHaveText('Shop.wiki/Architektur/Übersicht');
    await expect(card).toContainText('https://dev.azure.com/acme');
    await expect(card.getByTestId('confluence-link-status')).toHaveText('Diagramm im Wiki aktualisiert.', { timeout: 15_000 });
    await expect(card.getByRole('button', { name: /Im Wiki öffnen/ })).toBeVisible();
    await expect(card.getByTestId('confluence-link-sync-now')).toBeFocused();
    expect((await state(page)).calls.wikiLinks).toEqual([{ diagramPageId: expect.any(String), wikiPage: 'wiki-1\n/Architektur/Übersicht' }]);
    const first = (await state(page)).calls.wikiPublications;
    expect(first).toHaveLength(1); expect(first[0]!.bytes).toBeGreaterThan(100);
    expect((await new AxeBuilder({ page }).include('.page-link-dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    if (process.env.TICKET_SHOTS) await page.screenshot({ path: `/tmp/shots/wiki-link-${theme}.png` });
    await dialog.getByRole('button', { name: 'Dialog schließen' }).click();

    // The page shows its link in the list, and its menu entry now leads to the link.
    await page.getByTestId('page-switcher').click();
    await expect(panel.locator('[data-testid^="page-confluence-"]')).toHaveCount(1);
    await expect(panel.getByText('Mit Wiki-Seite „Shop.wiki/Architektur/Übersicht“ verknüpft')).toHaveCount(1);
    await page.keyboard.press('Escape');

    // A change of the page follows by itself.
    await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
    await page.mouse.move(700, 300); await page.mouse.down(); await page.mouse.move(800, 380, { steps: 8 }); await page.mouse.up();
    await expect.poll(async () => (await state(page)).calls.wikiPublications.length, { timeout: 15_000 }).toBe(2);

    // Removing the link leaves the wiki alone and takes the mark from the page.
    await page.getByTestId('page-switcher').click();
    await panel.getByRole('button', { name: 'Aktionen für Seite 1', exact: true }).click();
    await page.getByTestId('page-menu').getByRole('menuitem', { name: 'Wiki-Verknüpfung…', exact: true }).click();
    await dialog.getByTestId('confluence-link-unlink').click();
    await expect(dialog.getByTestId('confluence-page-link-feedback')).toHaveText('Verknüpfung gelöst. Das Bild auf der Wiki-Seite bleibt, bis du es dort entfernst.');
    await expect(dialog.getByTestId('confluence-link-card')).toHaveCount(0);
    expect((await state(page)).calls.wikiLinks.at(-1)).toEqual({ diagramPageId: expect.any(String), wikiPage: null });
  });
}
