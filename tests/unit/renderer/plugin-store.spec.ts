import { describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { createCrdtController } from '@/crdt';
import { createController, createDocument, serializeDocument, type DesktopBridge, type PluginBridge, type PluginExternalEvent, type SketchDocument } from '@/domain';
import { createWhiteboardStore } from '@/renderer/state/whiteboard';

async function setup(document: SketchDocument = createDocument('Plugins'), open = true) {
  let pluginListener: ((event: PluginExternalEvent) => void) | undefined;
  const plugins: PluginBridge = {
    getSettings: vi.fn(async () => ({ available: true, projectFolder: '/project', profiles: [{ id: 'default', name: 'Standard' }, { id: 'work', name: 'Arbeit' }], activeProfileId: 'default', git: { installed: true, enabled: true, folderPath: '/project', autoCommit: true, autoPush: false, autoPull: true, remote: 'origin', remoteUrl: '', authMode: 'system' as const, username: '', credentialStored: false, health: 'ready' as const, message: 'Bereit' }, atlassian: { installed: true, enabled: true, siteUrl: 'https://example.atlassian.net', email: 'user@example.com', confluenceSpaceKey: 'DOC', jiraProjectKey: 'SK', jiraIssueType: 'Task', jqlFilter: '', credentialStored: true, health: 'ready' as const, message: 'Bereit' } })),
    selectProfile: vi.fn(), createProfile: vi.fn(), renameProfile: vi.fn(), deleteProfile: vi.fn(),
    afterDocumentSaved: vi.fn(async () => {}), installPlugin: vi.fn(), uninstallPlugin: vi.fn(), configureGit: vi.fn(), configureAtlassian: vi.fn(), testAtlassian: vi.fn(), gitStatus: vi.fn(), gitSync: vi.fn(), watchDocument: vi.fn(async () => ({ ok: true, message: 'watching' })),
    listConfluencePages: vi.fn(async () => []),
    getConfluencePage: vi.fn(async () => ({ id: '7', title: 'Live Architecture', version: 4, url: 'https://example.atlassian.net/wiki/pages/7', storageBody: '<h2>Architecture</h2><p>Editable page</p>' })),
    updateConfluencePage: vi.fn(async (input) => ({ id: input.pageId, title: input.title, version: input.version + 1, url: 'https://example.atlassian.net/wiki/pages/7', storageBody: input.storageBody })),
    createJiraIssue: vi.fn(async () => ({ id: '100', key: 'SK-1', title: 'Review', description: 'Review', status: 'todo' as const, remoteStatus: 'To Do', url: 'https://example.atlassian.net/browse/SK-1', updatedAt: '2026-10-18T10:00:00.000Z' })),
    listJiraIssues: vi.fn(async () => [{ id: '101', key: 'SK-2', title: 'Remote task', description: 'From Jira', status: 'doing' as const, remoteStatus: 'In Progress', url: 'https://example.atlassian.net/browse/SK-2', updatedAt: '2026-10-18T10:00:00.000Z' }]),
    transitionJiraIssue: vi.fn(async ({ key, status }) => ({ id: '100', key, title: 'Review', description: 'Review', status, remoteStatus: status === 'done' ? 'Done' : 'In Progress', url: `https://example.atlassian.net/browse/${key}`, updatedAt: '2026-10-18T10:01:00.000Z' })),
    onEvent: (listener) => { pluginListener = listener; return () => { pluginListener = undefined; }; },
  };
  const bridge: DesktopBridge = { platform: 'electron', plugins, openDocument: vi.fn(async () => ({ status: 'cancelled' as const })), saveDocument: vi.fn(async () => ({ status: 'cancelled' as const })), exportFile: vi.fn(async () => ({ status: 'cancelled' as const })), openExternal: vi.fn(async () => {}), onCloseRequested: () => () => {}, respondToClose: vi.fn(async () => {}), onMenuCommand: () => () => {} };
  const configured = await plugins.getSettings();
  vi.mocked(plugins.getSettings).mockImplementation(async handle => handle === null ? { ...structuredClone(configured), projectFolder: '', git: { ...configured.git, enabled: false, folderPath: '', username: '', credentialStored: false }, atlassian: { ...configured.atlassian, enabled: false, email: '', credentialStored: false } } : structuredClone(configured));
  const store = createWhiteboardStore({ bridge, controller: createController(document) });
  if (open) {
    vi.mocked(bridge.openDocument).mockResolvedValue({ status: 'opened', text: serializeDocument(document), file: { handleId: 'hdl_0123456789abcdef0123456789abcdef', name: 'board.sketchdraw.json', versionToken: `sha256:${'1'.repeat(64)}` } });
    await store.openDocument(); await store.refreshPluginSettings();
  }
  return { store, plugins, bridge, emit: (event: PluginExternalEvent) => pluginListener?.(event) };
}

/** Reactive state cannot be structured-cloned; snapshots are plain JSON. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('plugin store integration', () => {
  it('creates a Jira issue from a comment and keeps the safe reference in the task', async () => {
    const document = createDocument('Comments');
    document.commentThreads = [{ id: 'thread:1', target: { anchor: { x: .5, y: .5 }, fallback: { x: 10, y: 10 } }, messages: [{ id: 'message:1', authorId: 'user:1', authorName: 'User', body: 'Review API', createdAt: '2026-10-18T10:00:00.000Z' }], resolved: false, createdAt: '2026-10-18T10:00:00.000Z', updatedAt: '2026-10-18T10:00:00.000Z' }];
    const { store, plugins } = await setup(document); await store.refreshPluginSettings();
    expect(await store.createTaskFromComment('thread:1')).toBe(true);
    expect(plugins.createJiraIssue).toHaveBeenCalledWith({ title: 'Review API', description: 'Review API' });
    expect(store.state.document.tasks?.[0]?.external?.key).toBe('SK-1');
    store.dispose();
  });

  it('embeds a Confluence page as a safe annotation and synchronizes Jira tasks', async () => {
    const { store } = await setup(); await store.refreshPluginSettings();
    expect(await store.insertConfluencePage('7')).toBe(true);
    const page = store.state.document.elements[0];
    expect(page).toMatchObject({ kind: 'annotation', label: 'Live Architecture', metadata: { 'sketchdraw.atlassian.pageId': '7', 'sketchdraw.atlassian.pageVersion': '4' } });
    expect(page?.text).toContain('Editable page');
    expect(await store.syncJiraTasks()).toBe(true);
    expect(store.state.document.tasks?.find((task) => task.external?.key === 'SK-2')?.status).toBe('doing');
    store.dispose();
  });

  it('does not overwrite dirty local state when an external Git update arrives', async () => {
    const current = createDocument('Current'); const external = createDocument('External');
    const { store, bridge, emit } = await setup(current);
    vi.mocked(bridge.openDocument).mockResolvedValue({ status: 'opened', text: serializeDocument(current), file: { handleId: 'hdl_0123456789abcdef0123456789abcdef', name: 'board.sketchdraw.json', versionToken: `sha256:${'1'.repeat(64)}` } });
    await store.openDocument(); store.updateTitleDraft('Local draft');
    emit({ type: 'document-changed', text: serializeDocument(external), file: { handleId: 'hdl_0123456789abcdef0123456789abcdef', name: 'board.sketchdraw.json', versionToken: `sha256:${'2'.repeat(64)}` } });
    expect(store.state.title).toBe('Current');
    expect(store.state.pendingExternalDocument).toBe(true);
    store.dispose();
  });

  it('releases the old project for a new document and never sends its tasks to the previous Jira project', async () => {
    const { store, plugins } = await setup();
    store.state.confluencePages = [{ id: 'old', title: 'Old project page', version: 1, url: 'https://example.test/old' }];
    expect(store.state.pluginSettings?.atlassian.enabled).toBe(true);
    await store.newDocument(); await store.refreshPluginSettings();
    expect(plugins.getSettings).toHaveBeenLastCalledWith(null);
    expect(store.state.pluginSettings?.projectFolder).toBe(''); expect(store.state.confluencePages).toEqual([]);
    expect(await store.createTask({ title: 'Local only' })).toBe(true);
    expect(plugins.createJiraIssue).not.toHaveBeenCalled();
    store.dispose();
  });

  it('ignores an old settings response after a document switch', async () => {
    const { store, plugins } = await setup();
    const old = structuredClone(await plugins.getSettings('old'));
    let release!: (value: typeof old) => void;
    vi.mocked(plugins.getSettings).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = store.refreshPluginSettings();
    await store.newDocument(); await store.refreshPluginSettings();
    release(old); await pending;
    expect(store.state.pluginSettings?.projectFolder).toBe(''); expect(store.state.pluginSettings?.atlassian.enabled).toBe(false);
    store.dispose();
  });

  it('refreshes the active project after the first save and save-as', async () => {
    const { store, plugins, bridge } = await setup(createDocument('New project'), false);
    await store.refreshPluginSettings();
    expect(store.state.pluginSettings?.projectFolder).toBe('');
    const first = { handleId: 'hdl_0123456789abcdef0123456789abcdef', name: 'first.sketchdraw.json', versionToken: `sha256:${'1'.repeat(64)}` };
    vi.mocked(bridge.saveDocument).mockResolvedValue({ status: 'saved', file: first });
    await store.save();
    expect(plugins.getSettings).toHaveBeenLastCalledWith(first.handleId);
    expect(plugins.afterDocumentSaved).toHaveBeenCalledWith(first.handleId);
    expect(store.state.pluginSettings?.projectFolder).toBe('/project');
    const second = { ...first, handleId: 'hdl_abcdef0123456789abcdef0123456789', name: 'second.sketchdraw.json' };
    const settings = structuredClone(await plugins.getSettings(first.handleId)); settings.projectFolder = '/second'; settings.git.folderPath = '/second';
    vi.mocked(plugins.getSettings).mockResolvedValue(settings); vi.mocked(bridge.saveDocument).mockResolvedValue({ status: 'saved', file: second });
    await store.saveAs();
    expect(plugins.getSettings).toHaveBeenLastCalledWith(second.handleId); expect(store.state.pluginSettings?.projectFolder).toBe('/second');
    store.dispose();
  });

  it('ignores a delayed configuration result after leaving its project', async () => {
    const { store, plugins } = await setup(); const previous = structuredClone(await plugins.getSettings('previous'));
    let release!: (value: typeof previous) => void;
    vi.mocked(plugins.configureAtlassian).mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const pending = store.configureAtlassianPlugin({ enabled: true, siteUrl: 'https://example.atlassian.net', email: 'user@example.com', apiToken: 'token', confluenceSpaceKey: '', jiraProjectKey: 'OLD', jiraIssueType: 'Task', jqlFilter: '' });
    expect(store.state.pluginBusy).toBe(true);
    await store.newDocument(); await store.refreshPluginSettings();
    release(previous); expect(await pending).toBe(false);
    expect(store.state.pluginSettings?.projectFolder).toBe(''); expect(store.state.pluginBusy).toBe(false);
    store.dispose();
  });

  it('ignores in-flight Jira results when another local document is opened', async () => {
    const { store, plugins, bridge } = await setup();
    let release!: (value: Awaited<ReturnType<PluginBridge['listJiraIssues']>>) => void;
    vi.mocked(plugins.listJiraIssues).mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const pending = store.syncJiraTasks();
    const next = createDocument('Other project');
    vi.mocked(bridge.openDocument).mockResolvedValue({ status: 'opened', text: serializeDocument(next), file: { handleId: 'hdl_abcdef0123456789abcdef0123456789', name: 'next.sketchdraw.json', versionToken: `sha256:${'2'.repeat(64)}` } });
    await store.openDocument();
    release([{ id: 'old', key: 'OLD-1', title: 'Old project ticket', description: '', status: 'todo', remoteStatus: 'To Do', url: 'https://example.test/OLD-1', updatedAt: '2026-11-11T10:00:00.000Z' }]);
    expect(await pending).toBe(false); expect(store.state.document.tasks ?? []).toEqual([]);
    store.dispose();
  });


  it('restores the existing project when opening is cancelled or the selected file is invalid', async () => {
    const { store, plugins, bridge } = await setup();
    const handle = store.state.file.handle!.handleId;
    vi.mocked(bridge.openDocument).mockResolvedValueOnce({ status: 'cancelled' });
    await store.openDocument();
    expect(plugins.getSettings).toHaveBeenLastCalledWith(handle); expect(store.state.pluginSettings?.projectFolder).toBe('/project');
    vi.mocked(bridge.openDocument).mockResolvedValueOnce({ status: 'opened', text: 'invalid JSON', file: { handleId: 'hdl_abcdef0123456789abcdef0123456789', name: 'invalid.sketchdraw.json', versionToken: `sha256:${'2'.repeat(64)}` } });
    await store.openDocument();
    expect(plugins.getSettings).toHaveBeenLastCalledWith(handle); expect(store.state.pluginSettings?.projectFolder).toBe('/project');
    expect(store.state.file.handle?.handleId).toBe(handle);
    store.dispose();
  });


  it('sends cloneable plain configuration DTOs across the Electron boundary', async () => {
    const { store, plugins } = await setup(); const settings = structuredClone(await plugins.getSettings('current'));
    vi.mocked(plugins.configureGit).mockImplementation(async input => { expect(() => structuredClone(input)).not.toThrow(); return settings; });
    vi.mocked(plugins.configureAtlassian).mockImplementation(async input => { expect(() => structuredClone(input)).not.toThrow(); return settings; });
    const git = reactive({ enabled: true, autoCommit: false, autoPush: false, autoPull: false, remote: 'origin', remoteUrl: 'https://example.test/repo.git', authMode: 'token' as const, username: 'alice', accessToken: 'secret' });
    const jira = reactive({ enabled: true, siteUrl: 'https://example.atlassian.net', email: 'alice@example.com', apiToken: 'secret', confluenceSpaceKey: '', jiraProjectKey: 'SK', jiraIssueType: 'Task', jqlFilter: '' });
    expect(await store.configureGitPlugin(git)).toBe(true); expect(await store.configureAtlassianPlugin(jira)).toBe(true);
    expect(plugins.configureGit).toHaveBeenCalledWith(expect.objectContaining({ username: 'alice', accessToken: 'secret' }));
    expect(plugins.configureAtlassian).toHaveBeenCalledWith(expect.objectContaining({ jiraProjectKey: 'SK', apiToken: 'secret' }));
    store.dispose();
  });


  it('keeps a room guest outside the local plugin project even after saving a copy without an access callback', async () => {
    const { store, plugins, bridge } = await setup();
    expect(await store.adoptRoomDocument(createCrdtController(createDocument('Remote')), { role: 'editor' })).toBe(true);
    await store.refreshPluginSettings();
    vi.mocked(bridge.saveDocument).mockResolvedValue({ status: 'saved', file: { handleId: 'hdl_abcdef0123456789abcdef0123456789', name: 'copy.sketchdraw.json', versionToken: `sha256:${'2'.repeat(64)}` } });
    await store.saveAs();
    expect(store.state.file.handle).not.toBeNull(); expect(plugins.getSettings).toHaveBeenLastCalledWith(null);
    expect(store.state.pluginSettings?.projectFolder).toBe(''); expect(plugins.afterDocumentSaved).not.toHaveBeenCalled();
    expect(await store.createTask({ title: 'Room task' })).toBe(true); expect(plugins.createJiraIssue).not.toHaveBeenCalled();
    store.dispose();
  });

  it('clears the local project when the existing document becomes a room guest', async () => {
    const { store, plugins } = await setup();
    store.enterRoomGuest('editor'); await store.refreshPluginSettings();
    expect(plugins.getSettings).toHaveBeenLastCalledWith(null); expect(store.state.pluginSettings?.projectFolder).toBe('');
    store.leaveRoomGuest(); await store.refreshPluginSettings();
    expect(plugins.getSettings).toHaveBeenLastCalledWith(store.state.file.handle!.handleId); expect(store.state.pluginSettings?.projectFolder).toBe('/project');
    store.dispose();
  });


  it('switches, creates, copies, renames and deletes editor profiles without touching the document', async () => {
    const { store, plugins } = await setup();
    const base = plain(store.state.pluginSettings!);
    const revision = store.state.revision; const serialized = serializeDocument(store.state.document);
    const work = { ...plain(base), activeProfileId: 'work', atlassian: { ...base.atlassian, jiraProjectKey: 'WORK' } };
    vi.mocked(plugins.selectProfile).mockResolvedValue(work);
    expect(await store.selectPluginProfile('work')).toBe(true);
    expect(plugins.selectProfile).toHaveBeenCalledWith('work');
    expect(store.state.pluginSettings).toMatchObject({ activeProfileId: 'work', atlassian: { jiraProjectKey: 'WORK' } });
    expect(store.state.notices.at(-1)).toMatchObject({ kind: 'info', text: 'Profil „Arbeit“ ist aktiv.' });
    // The Git watcher of the open document follows the new profile.
    expect(plugins.watchDocument).toHaveBeenLastCalledWith('hdl_0123456789abcdef0123456789abcdef');
    // Selecting the active profile again asks nothing.
    expect(await store.selectPluginProfile('work')).toBe(true);
    expect(plugins.selectProfile).toHaveBeenCalledTimes(1);

    const created = { ...plain(work), profiles: [...work.profiles, { id: 'p3', name: 'Privat' }], activeProfileId: 'p3' };
    vi.mocked(plugins.createProfile).mockResolvedValue(created);
    expect(await store.createPluginProfile('Privat')).toBe(true);
    expect(plugins.createProfile).toHaveBeenLastCalledWith({ name: 'Privat' });
    expect(await store.createPluginProfile('Privat 2', 'work')).toBe(true);
    expect(plugins.createProfile).toHaveBeenLastCalledWith({ name: 'Privat 2', copyFrom: 'work' });
    expect(store.state.notices.at(-1)?.text).toBe('Profil „Privat“ kopiert.');

    vi.mocked(plugins.renameProfile).mockResolvedValue({ ...created, profiles: created.profiles.map((profile) => profile.id === 'p3' ? { ...profile, name: 'Zuhause' } : profile) });
    expect(await store.renamePluginProfile('p3', 'Zuhause')).toBe(true);
    expect(plugins.renameProfile).toHaveBeenCalledWith({ id: 'p3', name: 'Zuhause' });
    expect(store.state.pluginSettings?.profiles.at(-1)).toEqual({ id: 'p3', name: 'Zuhause' });

    vi.mocked(plugins.deleteProfile).mockRejectedValue(new Error('Das letzte Profil kann nicht gelöscht werden.'));
    expect(await store.deletePluginProfile('p3')).toBe(false);
    expect(store.state.notices.at(-1)).toMatchObject({ kind: 'error', text: 'Das letzte Profil kann nicht gelöscht werden.' });
    expect(store.state.pluginBusy).toBe(false);
    vi.mocked(plugins.deleteProfile).mockResolvedValue(work);
    expect(await store.deletePluginProfile('p3')).toBe(true);
    expect(store.state.pluginSettings).toMatchObject({ activeProfileId: 'work', profiles: [{ id: 'default' }, { id: 'work' }] });

    // Profiles are editor state: the diagram is neither changed nor does it mention them.
    expect(store.state.revision).toBe(revision);
    expect(serializeDocument(store.state.document)).toBe(serialized);
    expect(serialized).not.toMatch(/profile|Standard|Arbeit/i);
    store.dispose();
  });

  it('configures the active profile without a saved diagram but sends no task to Jira from it', async () => {
    const { store, plugins } = await setup(createDocument('Unsaved'), false);
    await store.refreshPluginSettings();
    expect(store.state.pluginSettings).toMatchObject({ available: true, projectFolder: '' });
    const saved = { ...plain(store.state.pluginSettings!), atlassian: { ...store.state.pluginSettings!.atlassian, enabled: true, jiraProjectKey: 'NEW' } };
    vi.mocked(plugins.configureAtlassian).mockResolvedValue(saved);
    expect(await store.configureAtlassianPlugin({ enabled: true, siteUrl: 'https://example.atlassian.net', email: 'a@example.com', apiToken: 'secret', confluenceSpaceKey: '', jiraProjectKey: 'NEW', jiraIssueType: 'Task', jqlFilter: '' })).toBe(true);
    expect(plugins.configureAtlassian).toHaveBeenCalledTimes(1);
    expect(store.state.pluginSettings?.atlassian).toMatchObject({ enabled: true, jiraProjectKey: 'NEW' });
    vi.mocked(plugins.selectProfile).mockResolvedValue({ ...saved, activeProfileId: 'work' });
    expect(await store.selectPluginProfile('work')).toBe(true);
    expect(plugins.watchDocument).not.toHaveBeenCalled();
    expect(await store.createTask({ title: 'Local only', description: '' })).toBe(true);
    expect(plugins.createJiraIssue).not.toHaveBeenCalled();
    store.dispose();
  });

  it('refreshes the active profile after a late switch without applying the previous document context', async () => {
    const { store, plugins } = await setup();
    let release!: (value: Awaited<ReturnType<PluginBridge['selectProfile']>>) => void;
    vi.mocked(plugins.selectProfile).mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const pending = store.selectPluginProfile('work');
    await store.newDocument();
    expect(store.state.pluginSettings?.activeProfileId).toBe('default');
    const changed = { ...structuredClone(await plugins.getSettings(null)), activeProfileId: 'work' };
    vi.mocked(plugins.getSettings).mockResolvedValue(changed);
    release({ ...changed, projectFolder: '/old-project' });
    expect(await pending).toBe(false);
    await vi.waitFor(() => expect(store.state.pluginSettings?.activeProfileId).toBe('work'));
    expect(plugins.getSettings).toHaveBeenLastCalledWith(null);
    expect(store.state.pluginSettings?.projectFolder).toBe('');
    expect(store.state.notices.some((entry) => entry.text.includes('ist aktiv'))).toBe(false);
    store.dispose();
  });

});
