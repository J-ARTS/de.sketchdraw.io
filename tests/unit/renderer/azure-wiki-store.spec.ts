import { afterEach, describe, expect, it, vi } from 'vitest';
import { builtInComponentSets } from '@/catalog';
import {
  createController, createDocument, serializeDocument,
  type ConfluenceLivePublishInput, type ConfluenceLivePublishResult, type DesktopBridge, type PluginBridge, type PluginSettingsSnapshot, type SketchDocument, type WikiPageLiveLink, type WikiPageSummary,
} from '@/domain';
import { confluenceLiveStatusText } from '@/renderer/lib/confluence-live-text';
import { createWhiteboardStore } from '@/renderer/state/whiteboard';
import type { WhiteboardStore } from '@/renderer/state/contract';

// #281, #284: the interface reaches Confluence and the wiki of Azure DevOps through one access. A page of the
// diagram that is linked to the Azure DevOps wiki is published there, with the conditions of that plugin.
const HANDLE = 'hdl_0123456789abcdef0123456789abcdef';
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ORGANIZATION = 'https://dev.azure.com/acme';
const WIKI_PAGE = 'wiki-1\n/Architektur/Übersicht';
const stores: WhiteboardStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.dispose(); vi.restoreAllMocks(); });
const firstPage = (store: WhiteboardStore) => store.state.document.pages[0]!.id;
const live = (store: WhiteboardStore) => store.state.confluencePageLive[firstPage(store)] ?? { state: 'off' as const, message: '' };

async function setup(options: { linked?: boolean; confluence?: boolean; azure?: Partial<NonNullable<PluginSettingsSnapshot['azureDevOps']>> } = {}) {
  const document: SketchDocument = createDocument('Shop');
  const remote = {
    azure: { installed: true, enabled: true, variant: 'cloud' as const, organizationUrl: ORGANIZATION, project: 'Shop', workItemType: 'Task', wiqlFilter: '', apiVersion: '7.1', readOnly: false, credentialStored: true, health: 'ready' as const, message: 'Bereit', ...options.azure },
    links: (options.linked ? [{ provider: 'azure-devops', diagramPageId: document.pages[0]!.id, pageId: WIKI_PAGE, pageTitle: 'Shop.wiki/Architektur/Übersicht', pageUrl: `${ORGANIZATION}/Shop/_wiki/wikis/wiki-1?pagePath=%2FArchitektur`, siteUrl: ORGANIZATION, documentId: document.id, usable: true }] : []) as WikiPageLiveLink[],
  };
  const snapshot = (handle: string | null | undefined): PluginSettingsSnapshot => ({
    available: true, projectFolder: handle === null ? '' : '/project', profiles: [{ id: 'default', name: 'Standard' }], activeProfileId: 'default',
    git: { installed: true, enabled: false, folderPath: '', autoCommit: true, autoPush: false, autoPull: true, remote: 'origin', remoteUrl: '', authMode: 'system', username: '', credentialStored: false, health: 'disabled', message: '' },
    atlassian: { installed: true, enabled: Boolean(options.confluence), siteUrl: 'https://example.atlassian.net', email: 'user@example.com', confluenceSpaceKey: 'DOC', jiraProjectKey: 'SK', jiraIssueType: 'Task', jqlFilter: '', credentialStored: true, health: 'ready', message: 'Bereit' },
    azureDevOps: { ...remote.azure, ...(remote.links.length && handle !== null ? { wikiPageLinks: remote.links.map((link) => ({ ...link })) } : {}) },
  });
  const published: ConfluenceLivePublishInput[] = [];
  const answer = { next: null as ConfluenceLivePublishResult | null };
  const pages: WikiPageSummary[] = [{ provider: 'azure-devops', id: WIKI_PAGE, title: 'Übersicht', detail: 'Shop.wiki/Architektur/Übersicht', url: `${ORGANIZATION}/Shop/_wiki/wikis/wiki-1?pagePath=%2FArchitektur%2F%C3%9Cbersicht` }];
  const plugins = {
    getSettings: vi.fn(async (handle?: string | null) => snapshot(handle)),
    selectProfile: vi.fn(), createProfile: vi.fn(), renameProfile: vi.fn(), deleteProfile: vi.fn(), afterDocumentSaved: vi.fn(async () => {}), installPlugin: vi.fn(), uninstallPlugin: vi.fn(), configureGit: vi.fn(), configureAtlassian: vi.fn(), testAtlassian: vi.fn(),
    gitStatus: vi.fn(), gitSync: vi.fn(), gitWorkbench: vi.fn(), gitDiff: vi.fn(), gitCommit: vi.fn(), gitPush: vi.fn(), gitPull: vi.fn(), gitBranches: vi.fn(), gitCheckout: vi.fn(), gitCreateBranch: vi.fn(), gitMerge: vi.fn(), watchDocument: vi.fn(async () => {}),
    listConfluencePages: vi.fn(async () => [{ id: '7', title: 'Architektur', version: 4, url: 'https://example.atlassian.net/wiki/pages/7' }]), getConfluencePage: vi.fn(), updateConfluencePage: vi.fn(),
    setConfluenceLiveLink: vi.fn(async () => snapshot(HANDLE)), publishConfluenceLive: vi.fn(async (): Promise<ConfluenceLivePublishResult> => ({ status: 'synced', message: '', uploaded: 0, bodyUpdated: false })),
    listAzureWikiPages: vi.fn(async (query: string) => pages.filter((page) => page.detail.toLowerCase().includes(query.toLowerCase()))),
    setAzureWikiLiveLink: vi.fn(async ({ diagramPageId, wikiPage, documentId }: { diagramPageId: string; wikiPage: string | null; documentId: string }) => {
      remote.links = remote.links.filter((link) => link.diagramPageId !== diagramPageId);
      if (wikiPage !== null) remote.links.push({ provider: 'azure-devops', diagramPageId, pageId: wikiPage, pageTitle: `Shop.wiki${wikiPage.split('\n')[1]}`, pageUrl: `${ORGANIZATION}/x`, siteUrl: ORGANIZATION, documentId, usable: true });
      return snapshot(HANDLE);
    }),
    publishAzureWikiLive: vi.fn(async (input: ConfluenceLivePublishInput): Promise<ConfluenceLivePublishResult> => { published.push(input); return answer.next ?? { status: 'synced', message: 'Diagramm im Wiki aktualisiert.', uploaded: 1, bodyUpdated: true, syncedAt: new Date().toISOString() }; }),
    createJiraIssue: vi.fn(), listJiraIssues: vi.fn(async () => []), updateJiraIssue: vi.fn(), transitionJiraIssue: vi.fn(), listAzureWorkItems: vi.fn(async () => []),
    onEvent: () => () => {},
  } as unknown as PluginBridge & { publishAzureWikiLive: ReturnType<typeof vi.fn>; setAzureWikiLiveLink: ReturnType<typeof vi.fn>; publishConfluenceLive: ReturnType<typeof vi.fn>; setConfluenceLiveLink: ReturnType<typeof vi.fn> };
  const bridge: DesktopBridge = { platform: 'electron', plugins, openDocument: vi.fn(async () => ({ status: 'opened' as const, text: serializeDocument(document), file: { handleId: HANDLE, name: 'shop.sketchdraw.json', versionToken: `sha256:${'1'.repeat(64)}` } })), saveDocument: vi.fn(async () => ({ status: 'cancelled' as const })), exportFile: vi.fn(async () => ({ status: 'cancelled' as const })), openExternal: vi.fn(async () => {}), onCloseRequested: () => () => {}, respondToClose: vi.fn(async () => {}), onMenuCommand: () => () => {} };
  const rasterize = vi.fn(async (svg: string) => new Uint8Array([...PNG, ...new TextEncoder().encode(svg)]));
  const store = createWhiteboardStore({ bridge, controller: createController(document), preferences: null, confluenceLive: { debounceMs: 15, retryDelaysMs: [20, 20], failureHoldMs: 400, rasterize } });
  stores.push(store);
  store.setViewportSize(1000, 700);
  await store.openDocument(); await store.refreshPluginSettings();
  return { store, plugins, remote, published, answer, snapshot };
}

describe('the wikis a page can be linked to (#281)', () => {
  it('offers the wikis whose plugin is on and finds pages through the same call', async () => {
    const { store, plugins } = await setup({ confluence: true });
    expect(store.state.wikiProviders).toEqual([{ id: 'confluence', name: 'Confluence' }, { id: 'azure-devops', name: 'Azure DevOps Wiki' }]);
    expect(await store.searchWikiPages('azure-devops', 'übersicht')).toEqual([{ provider: 'azure-devops', id: WIKI_PAGE, title: 'Übersicht', detail: 'Shop.wiki/Architektur/Übersicht', url: `${ORGANIZATION}/Shop/_wiki/wikis/wiki-1?pagePath=%2FArchitektur%2F%C3%9Cbersicht` }]);
    expect(await store.searchWikiPages('confluence', 'arch')).toEqual([{ provider: 'confluence', id: '7', title: 'Architektur', detail: 'Version 4', url: 'https://example.atlassian.net/wiki/pages/7' }]);
    expect(plugins.listConfluencePages).toHaveBeenCalledWith('arch');
  });

  it('offers only what is switched on', async () => {
    const { store } = await setup({ azure: { enabled: false } });
    expect(store.state.wikiProviders).toEqual([]);
    expect(await store.searchWikiPages('azure-devops', 'x')).toBeNull();
    expect(await store.setWikiPageLink(firstPage(store), 'azure-devops', WIKI_PAGE)).toBe(false);
  });
});

describe('a page of the diagram in the Azure DevOps wiki (#284)', () => {
  it('links a page and publishes it there, not to Confluence; every change follows', async () => {
    const { store, plugins, published } = await setup({ confluence: true });
    const pageId = firstPage(store);
    expect(await store.setWikiPageLink(pageId, 'azure-devops', WIKI_PAGE)).toBe(true);
    expect(plugins.setAzureWikiLiveLink).toHaveBeenCalledWith({ handleId: HANDLE, documentId: store.state.document.id, diagramPageId: pageId, wikiPage: WIKI_PAGE });
    expect(store.state.notices.at(-1)?.text).toBe('„Seite 1“ ist mit der Seite „Shop.wiki/Architektur/Übersicht“ in Azure DevOps Wiki verknüpft. Änderungen werden automatisch übertragen.');
    await vi.waitFor(() => expect(published).toHaveLength(1));
    expect(published[0]).toMatchObject({ handleId: HANDLE, documentId: store.state.document.id, diagramPageId: pageId });
    expect(published[0]!.images.map((image) => image.pageId)).toEqual([pageId]);
    await vi.waitFor(() => expect(live(store).state).toBe('synced'));
    expect(confluenceLiveStatusText({ state: 'synced', message: '' }, 'azure-devops')).toBe('Das Wiki ist auf dem aktuellen Stand.');
    // A local edit: a component is placed on the canvas.
    await store.insertComponent(builtInComponentSets.find((set) => set.id === 'sketchdraw.aws')!, 'aws.compute.instance'); await store.whenIdle();
    await vi.waitFor(() => expect(published).toHaveLength(2));
    expect(plugins.publishConfluenceLive).not.toHaveBeenCalled();
    expect(plugins.setConfluenceLiveLink).not.toHaveBeenCalled();
  });

  it('removes the link through the wiki it belongs to', async () => {
    const { store, plugins, published } = await setup({ linked: true });
    await vi.waitFor(() => expect(published).toHaveLength(1));
    expect(await store.setWikiPageLink(firstPage(store), 'azure-devops', null)).toBe(true);
    expect(plugins.setAzureWikiLiveLink).toHaveBeenLastCalledWith(expect.objectContaining({ wikiPage: null }));
    expect(store.state.notices.at(-1)?.text).toBe('Verknüpfung von „Seite 1“ mit Azure DevOps Wiki gelöst.');
    expect(store.state.confluencePageLive).toEqual({});
  });

  it('waits while the plugin is off, read-only, without token or set to another project', async () => {
    for (const [azure, message] of [
      [{ enabled: false }, 'Das Azure-DevOps-Plugin ist deaktiviert. Aktiviere es, damit Änderungen wieder ins Wiki übertragen werden.'],
      [{ credentialStored: false }, 'Personal Access Token fehlt.'],
      [{ readOnly: true }, 'Azure DevOps ist auf „Nur lesen“ gestellt; das Wiki wird nicht geändert.'],
    ] as const) {
      const { store, published } = await setup({ linked: true, azure });
      await vi.waitFor(() => expect(live(store)).toMatchObject({ state: 'paused', message }));
      expect(published).toEqual([]);
    }
    const { store, remote, published } = await setup({ linked: true });
    await vi.waitFor(() => expect(published).toHaveLength(1));
    remote.links = remote.links.map((link) => ({ ...link, usable: false }));
    await store.refreshPluginSettings();
    await vi.waitFor(() => expect(live(store)).toMatchObject({ state: 'paused', message: 'Die Verknüpfung gehört zu einer anderen Organisation oder einem anderen Projekt als das aktive Profil. Verknüpfe die Seite neu.' }));
  });

  it('shows what the wiki answered when it needs the user', async () => {
    const { store, published, answer } = await setup({ linked: true });
    answer.next = { status: 'failed', message: 'Die verknüpfte Wiki-Seite wurde nicht gefunden oder ist für dieses Token nicht sichtbar.', uploaded: 0, bodyUpdated: false };
    await vi.waitFor(() => expect(published.length).toBeGreaterThan(0));
    await vi.waitFor(() => expect(live(store)).toMatchObject({ state: 'error', message: 'Die verknüpfte Wiki-Seite wurde nicht gefunden oder ist für dieses Token nicht sichtbar.' }));
  });
});
