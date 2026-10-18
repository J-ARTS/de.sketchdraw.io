import { describe, expect, it, vi } from 'vitest';
import { createController, createDocument, serializeDocument, type DesktopBridge, type PluginBridge, type PluginExternalEvent, type SketchDocument } from '@/domain';
import { createWhiteboardStore } from '@/renderer/state/whiteboard';

function setup(document: SketchDocument = createDocument('Plugins')) {
  let pluginListener: ((event: PluginExternalEvent) => void) | undefined;
  const plugins: PluginBridge = {
    getSettings: vi.fn(async () => ({ available: true, git: { enabled: true, autoCommit: true, autoPush: false, autoPull: true, remote: 'origin', health: 'ready' as const, message: 'Bereit' }, atlassian: { enabled: true, siteUrl: 'https://example.atlassian.net', email: 'user@example.com', confluenceSpaceKey: 'DOC', jiraProjectKey: 'SK', jiraIssueType: 'Task', credentialStored: true, health: 'ready' as const, message: 'Bereit' } })),
    configureGit: vi.fn(), configureAtlassian: vi.fn(), testAtlassian: vi.fn(), gitStatus: vi.fn(), gitSync: vi.fn(), watchDocument: vi.fn(async () => ({ ok: true, message: 'watching' })),
    listConfluencePages: vi.fn(async () => []),
    getConfluencePage: vi.fn(async () => ({ id: '7', title: 'Live Architecture', version: 4, url: 'https://example.atlassian.net/wiki/pages/7', storageBody: '<h2>Architecture</h2><p>Editable page</p>' })),
    updateConfluencePage: vi.fn(async (input) => ({ id: input.pageId, title: input.title, version: input.version + 1, url: 'https://example.atlassian.net/wiki/pages/7', storageBody: input.storageBody })),
    createJiraIssue: vi.fn(async () => ({ id: '100', key: 'SK-1', title: 'Review', description: 'Review', status: 'todo' as const, remoteStatus: 'To Do', url: 'https://example.atlassian.net/browse/SK-1', updatedAt: '2026-10-18T10:00:00.000Z' })),
    listJiraIssues: vi.fn(async () => [{ id: '101', key: 'SK-2', title: 'Remote task', description: 'From Jira', status: 'doing' as const, remoteStatus: 'In Progress', url: 'https://example.atlassian.net/browse/SK-2', updatedAt: '2026-10-18T10:00:00.000Z' }]),
    transitionJiraIssue: vi.fn(async ({ key, status }) => ({ id: '100', key, title: 'Review', description: 'Review', status, remoteStatus: status === 'done' ? 'Done' : 'In Progress', url: `https://example.atlassian.net/browse/${key}`, updatedAt: '2026-10-18T10:01:00.000Z' })),
    onEvent: (listener) => { pluginListener = listener; return () => { pluginListener = undefined; }; },
  };
  const bridge: DesktopBridge = { platform: 'electron', plugins, openDocument: vi.fn(async () => ({ status: 'cancelled' as const })), saveDocument: vi.fn(async () => ({ status: 'cancelled' as const })), exportFile: vi.fn(async () => ({ status: 'cancelled' as const })), openExternal: vi.fn(async () => {}), onCloseRequested: () => () => {}, respondToClose: vi.fn(async () => {}), onMenuCommand: () => () => {} };
  const store = createWhiteboardStore({ bridge, controller: createController(document) });
  return { store, plugins, bridge, emit: (event: PluginExternalEvent) => pluginListener?.(event) };
}

describe('plugin store integration', () => {
  it('creates a Jira issue from a comment and keeps the safe reference in the task', async () => {
    const document = createDocument('Comments');
    document.commentThreads = [{ id: 'thread:1', target: { anchor: { x: .5, y: .5 }, fallback: { x: 10, y: 10 } }, messages: [{ id: 'message:1', authorId: 'user:1', authorName: 'User', body: 'Review API', createdAt: '2026-10-18T10:00:00.000Z' }], resolved: false, createdAt: '2026-10-18T10:00:00.000Z', updatedAt: '2026-10-18T10:00:00.000Z' }];
    const { store, plugins } = setup(document); await store.refreshPluginSettings();
    expect(await store.createTaskFromComment('thread:1')).toBe(true);
    expect(plugins.createJiraIssue).toHaveBeenCalledWith({ title: 'Review API', description: 'Review API' });
    expect(store.state.document.tasks?.[0]?.external?.key).toBe('SK-1');
    store.dispose();
  });

  it('embeds a Confluence page as a safe annotation and synchronizes Jira tasks', async () => {
    const { store } = setup(); await store.refreshPluginSettings();
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
    const { store, bridge, emit } = setup(current);
    vi.mocked(bridge.openDocument).mockResolvedValue({ status: 'opened', text: serializeDocument(current), file: { handleId: 'hdl_0123456789abcdef0123456789abcdef', name: 'board.sketchdraw.json', versionToken: `sha256:${'1'.repeat(64)}` } });
    await store.openDocument(); store.updateTitleDraft('Local draft');
    emit({ type: 'document-changed', text: serializeDocument(external), file: { handleId: 'hdl_0123456789abcdef0123456789abcdef', name: 'board.sketchdraw.json', versionToken: `sha256:${'2'.repeat(64)}` } });
    expect(store.state.title).toBe('Current');
    expect(store.state.pendingExternalDocument).toBe(true);
    store.dispose();
  });
});
