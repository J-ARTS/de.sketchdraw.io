import { describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { createCrdtController } from '@/crdt';
import { createController, createDocument, createElement, readTicketCard, serializeDocument, TICKET_CARD_HEIGHT, TICKET_CARD_WIDTH, type DesktopBridge, type PluginBridge, type PluginExternalEvent, type SketchDocument } from '@/domain';
import { setLocale } from '@/renderer/i18n';
import { describeSelection } from '@/renderer/lib/describe';
import { createWhiteboardStore } from '@/renderer/state/whiteboard';

async function setup(document: SketchDocument = createDocument('Plugins'), open = true) {
  let pluginListener: ((event: PluginExternalEvent) => void) | undefined;
  const plugins: PluginBridge = {
    getSettings: vi.fn(async () => ({ available: true, projectFolder: '/project', profiles: [{ id: 'default', name: 'Standard' }, { id: 'work', name: 'Arbeit' }], activeProfileId: 'default', git: { installed: true, enabled: true, folderPath: '/project', autoCommit: true, autoPush: false, autoPull: true, remote: 'origin', remoteUrl: '', authMode: 'system' as const, username: '', credentialStored: false, health: 'ready' as const, message: 'Bereit' }, atlassian: { installed: true, enabled: true, siteUrl: 'https://example.atlassian.net', email: 'user@example.com', confluenceSpaceKey: 'DOC', jiraProjectKey: 'SK', jiraIssueType: 'Task', jqlFilter: '', credentialStored: true, health: 'ready' as const, message: 'Bereit' } })),
    selectProfile: vi.fn(), createProfile: vi.fn(), renameProfile: vi.fn(), deleteProfile: vi.fn(),
    afterDocumentSaved: vi.fn(async () => {}), installPlugin: vi.fn(), uninstallPlugin: vi.fn(), configureGit: vi.fn(), configureAtlassian: vi.fn(), testAtlassian: vi.fn(), gitStatus: vi.fn(), gitSync: vi.fn(), gitWorkbench: vi.fn(), gitDiff: vi.fn(), gitCommit: vi.fn(), gitPush: vi.fn(), gitUpdate: vi.fn(), gitLog: vi.fn(), gitDiscard: vi.fn(), gitRestoreDocument: vi.fn(), gitAutomation: vi.fn(), watchDocument: vi.fn(async () => ({ ok: true, message: 'watching' })),
    listConfluencePages: vi.fn(async () => []),
    getConfluencePage: vi.fn(async () => ({ id: '7', title: 'Live Architecture', version: 4, url: 'https://example.atlassian.net/wiki/pages/7', storageBody: '<h2>Architecture</h2><p>Editable page</p>' })),
    updateConfluencePage: vi.fn(async (input) => ({ id: input.pageId, title: input.title, version: input.version + 1, url: 'https://example.atlassian.net/wiki/pages/7', storageBody: input.storageBody })),
    createJiraIssue: vi.fn(async (input) => ({ id: '100', key: 'SK-1', title: input.title, description: input.description, status: 'todo' as const, remoteStatus: 'To Do', ...(input.assignee ? { assignee: input.assignee } : {}), ...(input.dueDate ? { dueDate: input.dueDate } : {}), url: 'https://example.atlassian.net/browse/SK-1', updatedAt: '2026-10-18T10:00:00.000Z' })),
    listJiraIssues: vi.fn(async () => [{ id: '101', key: 'SK-2', title: 'Remote task', description: 'From Jira', status: 'doing' as const, remoteStatus: 'In Progress', assignee: 'Mara Muster', dueDate: '2026-11-20', url: 'https://example.atlassian.net/browse/SK-2', updatedAt: '2026-10-18T10:00:00.000Z' }]),
    updateJiraIssue: vi.fn(async ({ key, assignee, dueDate }) => ({ id: '100', key, title: 'Review', description: 'Review', status: 'todo' as const, remoteStatus: 'To Do', ...(assignee ? { assignee } : {}), ...(dueDate ? { dueDate } : {}), url: `https://example.atlassian.net/browse/${key}`, updatedAt: '2026-10-18T10:01:00.000Z' })),
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

/** Azure Boards next to Jira (#284): the mock answers like the main process does. */
async function withAzure(options: { jira: boolean; readOnly?: boolean }) {
  const context = await setup();
  const { plugins, store } = context;
  const azureItem = (key: string, title: string, remoteStatus = 'New', status: 'todo' | 'doing' | 'review' | 'done' = 'todo') => ({ provider: 'azure-devops' as const, id: key, key, title, description: '', status, remoteStatus, url: `https://dev.azure.com/acme/Shop/_workitems/edit/${key}`, updatedAt: '2026-11-22T10:00:00.000Z' });
  const azure = {
    listAzureWorkItems: vi.fn(async () => [azureItem('7', 'Checkout absichern', 'Active', 'doing')]),
    createAzureWorkItem: vi.fn(async (input: { title: string }) => azureItem('20', input.title)),
    updateAzureWorkItem: vi.fn(async (input: { key: string; title?: string }) => azureItem(input.key, input.title ?? 'Checkout absichern', 'Active', 'doing')),
    transitionAzureWorkItem: vi.fn(async (input: { key: string; status: 'todo' | 'doing' | 'review' | 'done' }) => azureItem(input.key, 'Checkout absichern', input.status === 'done' ? 'Closed' : 'Active', input.status)),
  };
  Object.assign(plugins, azure);
  const base = vi.mocked(plugins.getSettings).getMockImplementation()!;
  vi.mocked(plugins.getSettings).mockImplementation(async (handle) => {
    const settings = await base(handle);
    return { ...settings, atlassian: { ...settings.atlassian, enabled: options.jira && settings.atlassian.enabled }, azureDevOps: { installed: true, enabled: handle !== null, variant: 'cloud' as const, organizationUrl: 'https://dev.azure.com/acme', project: 'Shop', workItemType: 'Task', wiqlFilter: '', apiVersion: '7.1', readOnly: options.readOnly ?? false, credentialStored: true, health: 'ready' as const, message: 'Bereit' } };
  });
  await store.refreshPluginSettings();
  return { ...context, azure };
}

describe('Azure Boards in the task board (#284)', () => {
  it('creates the ticket of a new task in Azure DevOps when Jira is off, and moves and edits it there', async () => {
    const { store, plugins, azure } = await withAzure({ jira: false });
    expect(store.state.ticketProviders).toEqual([{ id: 'azure-devops', name: 'Azure DevOps' }]);
    expect(await store.createTask({ title: 'Warenkorb' })).toBe(true);
    expect(azure.createAzureWorkItem).toHaveBeenCalledWith({ title: 'Warenkorb', description: '' });
    expect(plugins.createJiraIssue).not.toHaveBeenCalled();
    const task = store.state.document.tasks![0]!;
    expect(task.external).toMatchObject({ provider: 'azure-devops', key: '20', url: 'https://dev.azure.com/acme/Shop/_workitems/edit/20' });

    expect(await store.moveTask(task.id, 'done', 0)).toBe(true);
    expect(azure.transitionAzureWorkItem).toHaveBeenCalledWith({ key: '20', status: 'done' });
    expect(plugins.transitionJiraIssue).not.toHaveBeenCalled();
    expect(store.state.document.tasks![0]!.external?.remoteStatus).toBe('Closed');
    expect(await store.updateTask(task.id, { title: 'Warenkorb neu' })).toBe(true);
    expect(azure.updateAzureWorkItem).toHaveBeenCalledWith({ key: '20', title: 'Warenkorb neu' });
    expect(plugins.updateJiraIssue).not.toHaveBeenCalled();
    store.dispose();
  });

  it('reads the tickets of both systems; a Jira key and a work item number never share a task', async () => {
    const { store, azure } = await withAzure({ jira: true });
    expect(store.state.ticketProviders.map((provider) => provider.id)).toEqual(['jira', 'azure-devops']);
    expect(await store.syncTicketTasks({ announce: false })).toBe(true);
    const externals = store.state.document.tasks!.map((task) => `${task.external!.provider}:${task.external!.key}`);
    expect(externals).toEqual(['jira:SK-2', 'azure-devops:7']);
    // A second run changes the same two tasks.
    expect(await store.syncTicketTasks({ announce: false })).toBe(true);
    expect(store.state.document.tasks).toHaveLength(2);
    expect(azure.listAzureWorkItems).toHaveBeenCalledTimes(2);
    store.dispose();
  });

  it('with both switched on a new task goes to Jira, and a task without a ticket can be sent to either', async () => {
    const { store, plugins, azure } = await withAzure({ jira: true });
    vi.mocked(plugins.createJiraIssue).mockRejectedValueOnce(new Error('Jira ist nicht erreichbar.'));
    expect(await store.createTask({ title: 'Freigabe' })).toBe(true);
    expect(azure.createAzureWorkItem).not.toHaveBeenCalled();
    const task = store.state.document.tasks![0]!;
    expect(task.external).toBeUndefined();
    expect(await store.createTicketForTask(task.id, 'azure-devops')).toBe(true);
    expect(store.state.document.tasks![0]!.external).toMatchObject({ provider: 'azure-devops', key: '20' });
    // It has its ticket now; no second one in the other system.
    expect(await store.createTicketForTask(task.id, 'jira')).toBe(false);
    store.dispose();
  });

  it('a read-only connection reads and never writes', async () => {
    const { store, azure } = await withAzure({ jira: false, readOnly: true });
    expect(store.state.ticketProviders).toEqual([]);
    expect(await store.createTask({ title: 'Lokal' })).toBe(true);
    expect(azure.createAzureWorkItem).not.toHaveBeenCalled();
    expect(await store.syncTicketTasks({ announce: false })).toBe(true);
    const linked = store.state.document.tasks!.find((task) => task.external)!;
    expect(linked.external).toMatchObject({ provider: 'azure-devops', key: '7' });
    expect(await store.moveTask(linked.id, 'done', 0)).toBe(true);
    expect(azure.transitionAzureWorkItem).not.toHaveBeenCalled();
    store.dispose();
  });
});

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

  it('a ticket that could not be created is offered again, and a task gets one request at a time (#293)', async () => {
    const { store, plugins } = await setup();
    expect(store.state.jiraAvailable).toBe(true);
    vi.mocked(plugins.createJiraIssue).mockRejectedValueOnce(new Error('Jira ist nicht erreichbar.'));
    expect(await store.createTask({ title: 'Freigabe' })).toBe(true);
    const task = store.state.document.tasks![0]!;
    expect(task.external).toBeUndefined();
    expect(store.state.notices.at(-1)?.text).toContain('Ticket in Jira nicht angelegt: Jira ist nicht erreichbar.');
    expect(store.state.jiraCreatingTaskIds).toEqual([]);

    // The second attempt is held open: a further one for the same task is refused meanwhile.
    let release: (() => void) | undefined;
    const original = vi.mocked(plugins.createJiraIssue).getMockImplementation()!;
    vi.mocked(plugins.createJiraIssue).mockImplementationOnce(async (input) => { await new Promise<void>((resolve) => { release = resolve; }); return original(input); });
    const first = store.createTicketForTask(task.id);
    await vi.waitFor(() => expect(release).toBeDefined());
    expect(store.state.jiraCreatingTaskIds).toEqual([task.id]);
    expect(await store.createTicketForTask(task.id)).toBe(false);
    release!();
    expect(await first).toBe(true);
    expect(store.state.jiraCreatingTaskIds).toEqual([]);
    expect(plugins.createJiraIssue).toHaveBeenCalledTimes(2);
    expect(store.state.document.tasks).toHaveLength(1);
    expect(store.state.document.tasks![0]!.external?.key).toBe('SK-1');
    // A linked task gets no second ticket.
    expect(await store.createTicketForTask(task.id)).toBe(false);
    expect(plugins.createJiraIssue).toHaveBeenCalledTimes(2);
    store.dispose();
  });

  it('a card of another Jira site with the same key is neither overwritten nor written to (#286)', async () => {
    const document = createDocument('Zwei Sites');
    const foreign = { provider: 'jira' as const, remoteId: '9', key: 'SK-2', url: 'https://other.atlassian.net/browse/SK-2', remoteStatus: 'Done', updatedAt: '2026-10-01T10:00:00.000Z' };
    document.tasks = [{ id: 'task:other', title: 'Ticket der anderen Site', description: 'bleibt', status: 'done', rank: 0, createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z', external: foreign }];
    const { store, plugins } = await setup(document);
    expect(await store.syncTicketTasks({ announce: false })).toBe(true);
    const tasks = store.state.document.tasks!;
    // The card of the other site is as it was; the SK-2 of this site has a card of its own.
    expect(tasks.find((task) => task.id === 'task:other')).toMatchObject({ title: 'Ticket der anderen Site', description: 'bleibt', status: 'done', external: foreign });
    expect(tasks.filter((task) => task.external?.key === 'SK-2').map((task) => task.external!.url).sort()).toEqual(['https://example.atlassian.net/browse/SK-2', 'https://other.atlassian.net/browse/SK-2']);
    // Moving or editing it stays in the document: this site has no say over that ticket.
    expect(await store.moveTask('task:other', 'todo', 0)).toBe(true);
    expect(await store.updateTask('task:other', { title: 'Neu benannt' })).toBe(true);
    expect(plugins.transitionJiraIssue).not.toHaveBeenCalled();
    expect(plugins.updateJiraIssue).not.toHaveBeenCalled();
    expect(store.state.document.tasks!.find((task) => task.id === 'task:other')).toMatchObject({ title: 'Neu benannt', status: 'todo', external: foreign });
    // A second sync still leaves it alone.
    expect(await store.syncTicketTasks({ announce: false })).toBe(true);
    expect(store.state.document.tasks!.find((task) => task.id === 'task:other')).toMatchObject({ title: 'Neu benannt', external: foreign });
    expect(store.state.document.tasks).toHaveLength(2);
    store.dispose();
  });

  it('creates a Jira issue with the assignee and due date of a new Sketchdraw task', async () => {
    const { store, plugins } = await setup();
    expect(await store.createTask({ title: 'Release review', description: 'Check release', assignee: 'Mara Muster', dueDate: '2026-11-20' })).toBe(true);
    expect(plugins.createJiraIssue).toHaveBeenCalledWith({ title: 'Release review', description: 'Check release', assignee: 'Mara Muster', dueDate: '2026-11-20' });
    expect(store.state.document.tasks?.[0]).toMatchObject({ assignee: 'Mara Muster', dueDate: '2026-11-20', external: { key: 'SK-1' } });
    store.dispose();
  });

  it('embeds a Confluence page as a safe annotation and synchronizes Jira tasks', async () => {
    const { store } = await setup(); await store.refreshPluginSettings();
    expect(await store.insertConfluencePage('7')).toBe(true);
    const page = store.state.document.elements[0];
    expect(page).toMatchObject({ kind: 'annotation', label: 'Live Architecture', metadata: { 'sketchdraw.atlassian.pageId': '7', 'sketchdraw.atlassian.pageVersion': '4' } });
    expect(page?.text).toContain('Editable page');
    expect(await store.syncTicketTasks()).toBe(true);
    expect(store.state.document.tasks?.find((task) => task.external?.key === 'SK-2')).toMatchObject({ status: 'doing', assignee: 'Mara Muster', dueDate: '2026-11-20' });
    store.dispose();
  });

  it('keeps automatic Jira polling silent when a request fails', async () => {
    const { store, plugins } = await setup();
    vi.mocked(plugins.listJiraIssues).mockRejectedValueOnce(new Error('offline'));
    const noticeCount = store.state.notices.length;
    expect(await store.syncTicketTasks({ announce: false })).toBe(false);
    expect(store.state.notices).toHaveLength(noticeCount);
    expect(store.state.pluginBusy).toBe(false);
    store.dispose();
  });

  it('sends a changed title and description to Jira, so the next sync keeps them (#270)', async () => {
    const document = createDocument('Jira texts');
    document.tasks = [{
      id: 'task:jira', title: 'Review', description: 'Old text', status: 'todo', rank: 0,
      createdAt: '2026-10-18T09:00:00.000Z', updatedAt: '2026-10-18T09:00:00.000Z',
      external: { provider: 'jira', remoteId: '100', key: 'SK-1', url: 'https://example.atlassian.net/browse/SK-1', remoteStatus: 'To Do', updatedAt: '2026-10-18T09:00:00.000Z' },
    }];
    const { store, plugins } = await setup(document);
    // A stand-in for Jira: it keeps what it is sent and answers the next sync with it.
    const remote = { id: '100', key: 'SK-1', title: 'Review', description: 'Old text', status: 'todo' as const, remoteStatus: 'To Do', url: 'https://example.atlassian.net/browse/SK-1', updatedAt: '2026-10-18T10:00:00.000Z' };
    vi.mocked(plugins.updateJiraIssue).mockImplementation(async (input) => { if (input.title !== undefined) remote.title = input.title; if (input.description !== undefined) remote.description = input.description; return { ...remote }; });
    vi.mocked(plugins.listJiraIssues).mockImplementation(async () => [{ ...remote }]);

    expect(await store.updateTask('task:jira', { title: 'Review the API', description: 'First line\nSecond line' })).toBe(true);
    expect(plugins.updateJiraIssue).toHaveBeenCalledWith({ key: 'SK-1', title: 'Review the API', description: 'First line\nSecond line' });
    expect(await store.syncTicketTasks({ announce: false })).toBe(true);
    expect(store.state.document.tasks?.[0]).toMatchObject({ title: 'Review the API', description: 'First line\nSecond line' });

    // An unchanged text is not sent again: the description in Jira is replaced as plain text, so only a change may do that.
    vi.mocked(plugins.updateJiraIssue).mockClear();
    expect(await store.updateTask('task:jira', { title: 'Review the API', description: 'First line\nSecond line', type: 'bug' })).toBe(true);
    expect(plugins.updateJiraIssue).not.toHaveBeenCalled();
    store.dispose();
  });

  it('says so when Jira refuses a changed text', async () => {
    const document = createDocument('Jira refusal');
    document.tasks = [{
      id: 'task:jira', title: 'Review', description: '', status: 'todo', rank: 0,
      createdAt: '2026-10-18T09:00:00.000Z', updatedAt: '2026-10-18T09:00:00.000Z',
      external: { provider: 'jira', remoteId: '100', key: 'SK-1', url: 'https://example.atlassian.net/browse/SK-1', remoteStatus: 'To Do', updatedAt: '2026-10-18T09:00:00.000Z' },
    }];
    const { store, plugins } = await setup(document);
    vi.mocked(plugins.updateJiraIssue).mockRejectedValueOnce(new Error('Feld gesperrt.'));
    expect(await store.updateTask('task:jira', { title: 'Neuer Titel' })).toBe(true);
    expect(store.state.notices.at(-1)).toMatchObject({ kind: 'error', text: 'Jira hat die Änderung nicht übernommen: Feld gesperrt. Beim nächsten Abgleich gilt wieder der Stand aus Jira.' });
    store.dispose();
  });

  it('pushes changed assignee and due date from a linked Sketchdraw task to Jira', async () => {
    const document = createDocument('Jira fields');
    document.tasks = [{
      id: 'task:jira', title: 'Review', description: '', status: 'todo', rank: 0,
      createdAt: '2026-10-18T09:00:00.000Z', updatedAt: '2026-10-18T09:00:00.000Z',
      external: { provider: 'jira', remoteId: '100', key: 'SK-1', url: 'https://example.atlassian.net/browse/SK-1', remoteStatus: 'To Do', updatedAt: '2026-10-18T09:00:00.000Z' },
    }];
    const { store, plugins } = await setup(document);
    expect(await store.updateTask('task:jira', { assignee: 'Mara Muster', dueDate: '2026-11-20' })).toBe(true);
    expect(plugins.updateJiraIssue).toHaveBeenCalledWith({ key: 'SK-1', assignee: 'Mara Muster', dueDate: '2026-11-20' });
    expect(store.state.document.tasks?.[0]).toMatchObject({ assignee: 'Mara Muster', dueDate: '2026-11-20' });

    expect(await store.updateTask('task:jira', { assignee: null, dueDate: null })).toBe(true);
    expect(plugins.updateJiraIssue).toHaveBeenLastCalledWith({ key: 'SK-1', assignee: null, dueDate: null });
    expect(store.state.document.tasks?.[0]).not.toHaveProperty('assignee');
    expect(store.state.document.tasks?.[0]).not.toHaveProperty('dueDate');
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
    const pending = store.syncTicketTasks();
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

  it('answers the Git dialog with values or reasons and takes over the repository state (#216)', async () => {
    const { store, plugins } = await setup();
    const settings = { ...store.state.pluginSettings!.git, branch: 'main', ahead: 2, changedFiles: 1 };
    const workbench = { settings, changes: [{ path: 'board.sketchdraw.json', status: 'modified' as const, document: true }], documentPath: 'board.sketchdraw.json' };
    vi.mocked(plugins.gitWorkbench).mockResolvedValue(workbench);
    expect(await store.gitWorkbench()).toEqual({ ok: true, value: workbench });
    expect(plugins.gitWorkbench).toHaveBeenCalledWith('hdl_0123456789abcdef0123456789abcdef');
    expect(store.state.pluginSettings!.git).toMatchObject({ ahead: 2, changedFiles: 1 });

    // A step that the service refused comes back as its result; the message is in the language of the interface.
    vi.mocked(plugins.gitCommit).mockResolvedValue({ ok: false, message: 'Commit-Nachricht fehlt.', workbench });
    setLocale('en');
    expect(await store.gitCommit('', ['board.sketchdraw.json'], false)).toMatchObject({ ok: true, value: { ok: false, message: 'The commit message is missing.' } });
    setLocale('de');
    expect(plugins.gitCommit).toHaveBeenCalledWith({ handleId: 'hdl_0123456789abcdef0123456789abcdef', message: '', paths: ['board.sketchdraw.json'], push: false });

    // What the main process throws arrives wrapped by Electron; only its sentence is shown, and no notice is raised behind the dialog.
    const notices = store.state.notices.length;
    vi.mocked(plugins.gitLog).mockRejectedValue(new Error("Error invoking remote method 'sketchdraw:plugin-invoke': Error: Der Verlauf konnte nicht gelesen werden."));
    expect(await store.gitLog(true)).toEqual({ ok: false, message: 'Der Verlauf konnte nicht gelesen werden.' });
    expect(store.state.notices).toHaveLength(notices);

    vi.mocked(plugins.gitAutomation).mockResolvedValue({ ...settings, autoCommit: true, autoPush: true });
    expect(await store.setGitAutomation({ autoCommit: true, autoPush: true, autoPull: false })).toEqual({ ok: true, value: true });
    expect(store.state.pluginSettings!.git).toMatchObject({ autoCommit: true, autoPush: true });
    expect(vi.mocked(plugins.watchDocument).mock.calls.at(-1)).toEqual(['hdl_0123456789abcdef0123456789abcdef']);

    store.toggleGit(); expect(store.state.gitOpen).toBe(true); store.toggleGit(false); expect(store.state.gitOpen).toBe(false);
    store.dispose();
  });

  it('does not fetch or go back to an old state over unsaved changes, and needs a saved diagram (#216)', async () => {
    const { store, plugins } = await setup();
    await store.createTask({ title: 'Unsaved work' });
    expect(store.state.saveStatus).toBe('dirty');
    expect(await store.gitUpdate()).toEqual({ ok: false, message: 'Speichere das Diagramm, bevor du den Stand vom Remote holst.' });
    expect(await store.gitRestoreDocument('a'.repeat(40))).toEqual({ ok: false, message: 'Speichere das Diagramm, bevor du es auf einen alten Stand zurücksetzt.' });
    expect(plugins.gitUpdate).not.toHaveBeenCalled(); expect(plugins.gitRestoreDocument).not.toHaveBeenCalled();
    store.dispose();

    const unsaved = await setup(createDocument('New'), false);
    expect(await unsaved.store.gitWorkbench()).toEqual({ ok: false, message: 'Speichere das Dokument zuerst in einem Git-Repository.' });
    expect(unsaved.plugins.gitWorkbench).not.toHaveBeenCalled();
    unsaved.store.dispose();
  });

});

/** Ticket cards (#283): the mock reads, finds and changes single tickets like the main process does. */
async function withTickets(options: { azure?: boolean; readOnly?: boolean; document?: SketchDocument; open?: boolean } = {}) {
  const context = options.azure ? await withAzure({ jira: true, ...(options.readOnly ? { readOnly: true } : {}) }) : await setup(options.document, options.open ?? true);
  const { plugins } = context;
  const remote = new Map<string, Record<string, unknown>>([
    ['jira:SK-7', { id: '107', key: 'SK-7', title: 'Warenkorb sichern', description: 'Am Konto speichern.', status: 'doing', remoteStatus: 'In Progress', assignee: 'Mara Muster', labels: ['checkout'], components: ['Storefront'], estimate: '5', url: 'https://example.atlassian.net/browse/SK-7', updatedAt: '2026-11-22T08:00:00.000Z' }],
    ['azure-devops:4711', { provider: 'azure-devops', id: '4711', key: '4711', title: 'Checkout absichern', description: '', status: 'todo', remoteStatus: 'New', labels: ['security'], components: ['Shop\\Checkout'], estimate: '8', url: 'https://dev.azure.com/acme/Shop/_workitems/edit/4711', updatedAt: '2026-11-22T08:00:00.000Z' }],
  ]);
  const tickets = {
    getWorkItem: vi.fn(async ({ provider, key }: { provider: string; key: string }) => {
      const found = remote.get(`${provider}:${key}`);
      if (!found) throw new Error('Ungültiges Ticket.');
      return structuredClone(found);
    }),
    searchWorkItems: vi.fn(async ({ provider, query }: { provider: string; query: string }) => [...remote.entries()].filter(([id, value]) => id.startsWith(`${provider}:`) && String(value.title).toLowerCase().includes(query.toLowerCase())).map(([, value]) => ({ provider, ...structuredClone(value) }))),
    updateWorkItemFields: vi.fn(async ({ provider, key, assignee, estimate, ...rest }: Record<string, unknown>) => {
      const next: Record<string, unknown> = { ...remote.get(`${provider}:${key}`)!, ...rest, ...(assignee === null ? { assignee: undefined } : assignee !== undefined ? { assignee } : {}), ...(estimate === null ? { estimate: undefined } : estimate !== undefined ? { estimate } : {}) };
      if (rest.status === 'done') next.remoteStatus = 'Done';
      remote.set(`${provider}:${key}`, next);
      return structuredClone(next);
    }),
  };
  Object.assign(plugins, tickets);
  return { ...context, tickets, remote };
}
const cards = (store: Awaited<ReturnType<typeof setup>>['store']) => store.state.document.elements.flatMap((element) => { const data = readTicketCard(element); return data ? [{ id: element.id, element, data }] : []; });
const notices = (store: Awaited<ReturnType<typeof setup>>['store']) => store.state.notices.map((entry) => entry.text);

describe('ticket cards on the canvas (#283)', () => {
  it('puts a ticket on the canvas as a card that carries its seven fields', async () => {
    const { store, tickets } = await withTickets();
    expect(store.state.ticketReaders).toEqual([{ id: 'jira', name: 'Jira' }]);
    store.openTicketInsert({ x: 400, y: 300 });
    expect(await store.insertTicketCard('jira', 'SK-7')).toBe(true);
    expect(tickets.getWorkItem).toHaveBeenCalledWith({ provider: 'jira', key: 'SK-7' });
    const [card] = cards(store);
    expect(card!.data).toMatchObject({ provider: 'jira', key: 'SK-7', title: 'Warenkorb sichern', status: 'doing', remoteStatus: 'In Progress', description: 'Am Konto speichern.', assignee: 'Mara Muster', labels: ['checkout'], components: ['Storefront'], estimate: '5' });
    // Centred on the place it was asked for, selected, and a plain rectangle for every reader of the file.
    expect(card!.element).toMatchObject({ kind: 'rectangle', x: 400 - TICKET_CARD_WIDTH / 2, y: 300 - TICKET_CARD_HEIGHT / 2, width: TICKET_CARD_WIDTH, height: TICKET_CARD_HEIGHT, text: 'Warenkorb sichern' });
    expect(store.state.selection).toEqual([card!.id]);
    // A screen reader hears the ticket, not a rectangle with a text.
    expect(describeSelection([card!.element], store.state.document)).toMatch(/^Ticket SK-7: Warenkorb sichern, In Progress/);
    // A version without ticket cards writes the title of the rectangle in this colour instead of the pale frame colour.
    expect(card!.element.style).toMatchObject({ fill: '#ffffff', textColor: '#1e1e1e', textAlign: 'left' });
    expect(notices(store).some((message) => message.startsWith('Der Inhalt des Tickets steht jetzt im Dokument'))).toBe(true);
    store.undo();
    await vi.waitFor(() => expect(cards(store)).toEqual([]));
  });

  it('turns the pasted address of a ticket into its card, and leaves other addresses alone', async () => {
    const { store, tickets } = await withTickets({ azure: true });
    await store.pasteClipboardData({ text: 'https://dev.azure.com/acme/Shop/_workitems/edit/4711', image: null });
    expect(cards(store).map((card) => `${card.data.provider}:${card.data.key}`)).toEqual(['azure-devops:4711']);
    expect(cards(store)[0]!.data).toMatchObject({ labels: ['security'], components: ['Shop\\Checkout'], estimate: '8' });
    tickets.getWorkItem.mockClear();
    await store.pasteClipboardData({ text: 'https://dev.azure.com/other/Shop/_workitems/edit/1', image: null });
    expect(tickets.getWorkItem).not.toHaveBeenCalled();
    expect(cards(store)).toHaveLength(1);
  });

  it('says why a ticket could not be read and adds nothing', async () => {
    const { store } = await withTickets();
    expect(await store.insertTicketCard('jira', 'SK-404')).toBe(false);
    expect(cards(store)).toEqual([]);
    expect(notices(store).at(-1)).toContain('Das Ticket konnte nicht gelesen werden');
    expect(store.state.ticketBusy).toBe(false);
  });

  it('sends only the changed fields to the tracker and shows what the tracker answered', async () => {
    const { store, tickets } = await withTickets();
    await store.insertTicketCard('jira', 'SK-7');
    const id = cards(store)[0]!.id;
    expect(store.ticketCardAccess(id)).toBe('writable');
    expect(await store.saveTicketCard(id, { title: 'Warenkorb am Konto sichern', status: 'done', labels: ['checkout', 'q1'], assignee: null, estimate: '8' })).toBe(true);
    expect(tickets.updateWorkItemFields).toHaveBeenCalledWith({ provider: 'jira', key: 'SK-7', title: 'Warenkorb am Konto sichern', status: 'done', labels: ['checkout', 'q1'], assignee: null, estimate: '8' });
    expect(cards(store)[0]!.data).toMatchObject({ title: 'Warenkorb am Konto sichern', status: 'done', remoteStatus: 'Done', labels: ['checkout', 'q1'], assignee: '', estimate: '8', components: ['Storefront'], description: 'Am Konto speichern.' });
    // Nothing changed: nothing is sent.
    tickets.updateWorkItemFields.mockClear();
    expect(await store.saveTicketCard(id, {})).toBe(true);
    expect(tickets.updateWorkItemFields).not.toHaveBeenCalled();
  });

  it('keeps the card as it was when the tracker refuses the change', async () => {
    const { store, tickets } = await withTickets();
    await store.insertTicketCard('jira', 'SK-7');
    const id = cards(store)[0]!.id;
    tickets.updateWorkItemFields.mockRejectedValueOnce(new Error('Ein Jira-Label darf keine Leerzeichen enthalten.'));
    expect(await store.saveTicketCard(id, { labels: ['zwei worte'] })).toBe(false);
    expect(cards(store)[0]!.data.labels).toEqual(['checkout']);
    expect(notices(store).at(-1)).toContain('Jira hat die Änderung nicht übernommen');
    expect(store.state.ticketBusy).toBe(false);
  });

  it('reads a ticket again on request', async () => {
    const { store, remote } = await withTickets();
    await store.insertTicketCard('jira', 'SK-7');
    const id = cards(store)[0]!.id;
    remote.set('jira:SK-7', { ...remote.get('jira:SK-7')!, title: 'Im Tracker umbenannt', status: 'review', remoteStatus: 'In Review' });
    expect(await store.refreshTicketCard(id)).toBe(true);
    expect(cards(store)[0]!.data).toMatchObject({ title: 'Im Tracker umbenannt', status: 'review', remoteStatus: 'In Review' });
  });

  it('reads the cards of a document once when it is opened with the tracker connected', async () => {
    const stale = createElement('rectangle', { id: 'stale', x: 0, y: 0, width: TICKET_CARD_WIDTH, height: TICKET_CARD_HEIGHT, text: 'Stand von gestern', metadata: { 'ticket:provider': 'jira', 'ticket:key': 'SK-7', 'ticket:url': 'https://example.atlassian.net/browse/SK-7', 'ticket:status': 'todo' } });
    const document = { ...createDocument('Karten'), elements: [stale] };
    const { store, tickets, bridge } = await withTickets({ document, open: false });
    vi.mocked(bridge.openDocument).mockResolvedValue({ status: 'opened', text: serializeDocument(document), file: { handleId: 'hdl_0123456789abcdef0123456789abcdef', name: 'board.sketchdraw.json', versionToken: `sha256:${'1'.repeat(64)}` } });
    await store.openDocument(); await store.refreshPluginSettings();
    await vi.waitFor(() => expect(cards(store)[0]!.data).toMatchObject({ title: 'Warenkorb sichern', status: 'doing', labels: ['checkout'] }));
    // The same document and file are not read a second time by a later refresh of the settings.
    await store.refreshPluginSettings();
    expect(tickets.getWorkItem).toHaveBeenCalledTimes(1);
  });

  it('shows a card of another site without reading or writing it', async () => {
    // A card that came with the file from someone whose Jira is another site.
    const foreign = createElement('rectangle', { id: 'foreign', x: 0, y: 0, width: TICKET_CARD_WIDTH, height: TICKET_CARD_HEIGHT, text: 'Warenkorb sichern', metadata: { 'ticket:provider': 'jira', 'ticket:key': 'SK-7', 'ticket:url': 'https://other.atlassian.net/browse/SK-7', 'ticket:status': 'doing' } });
    const { store, tickets } = await withTickets({ document: { ...createDocument('Fremd'), elements: [foreign] } });
    const card = cards(store)[0]!;
    expect(store.ticketCardAccess(card.id)).toBe('offline');
    expect(await store.refreshTicketCard(card.id)).toBe(false);
    expect(await store.saveTicketCard(card.id, { title: 'Fremd' })).toBe(false);
    expect(tickets.getWorkItem).not.toHaveBeenCalled();
    expect(tickets.updateWorkItemFields).not.toHaveBeenCalled();
    expect(cards(store)[0]!.data.title).toBe('Warenkorb sichern');
  });

  it('reads but never changes a ticket while its tracker is set to read-only', async () => {
    const { store, tickets } = await withTickets({ azure: true, readOnly: true });
    expect(await store.insertTicketCard('azure-devops', '4711')).toBe(true);
    const id = cards(store)[0]!.id;
    expect(store.ticketCardAccess(id)).toBe('readonly');
    expect(await store.saveTicketCard(id, { title: 'Nicht erlaubt' })).toBe(false);
    expect(tickets.updateWorkItemFields).not.toHaveBeenCalled();
    expect(notices(store).at(-1)).toContain('Nur lesen');
  });

  it('opens the ticket dialog instead of the text editor for a card', async () => {
    const { store } = await withTickets();
    await store.insertTicketCard('jira', 'SK-7');
    const id = cards(store)[0]!.id;
    store.closeTicketDialog();
    store.startTextEdit(id);
    expect(store.state.textEdit).toBeNull();
    expect(store.state.ticketDialog).toEqual({ mode: 'edit', elementId: id });
  });

  it('places the ticket of a task as a card', async () => {
    const { store, remote } = await withTickets();
    remote.set('jira:SK-2', { id: '101', key: 'SK-2', title: 'Remote task', description: 'From Jira', status: 'doing', remoteStatus: 'In Progress', url: 'https://example.atlassian.net/browse/SK-2', updatedAt: '2026-11-22T08:00:00.000Z' });
    await store.syncTicketTasks();
    const task = store.state.document.tasks!.find((entry) => entry.external?.key === 'SK-2')!;
    expect(await store.insertTicketCardFromTask(task.id)).toBe(true);
    expect(cards(store)[0]!.data).toMatchObject({ key: 'SK-2', title: 'Remote task' });
  });

  it('finds tickets by text and offers nothing without a connected tracker', async () => {
    const { store } = await withTickets();
    expect((await store.searchTickets('jira', 'warenkorb'))!.map((entry) => entry.key)).toEqual(['SK-7']);
    expect(await store.searchTickets('azure-devops', 'checkout')).toBeNull();
  });
});
