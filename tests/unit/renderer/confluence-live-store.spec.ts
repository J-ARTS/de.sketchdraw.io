import { crc32, deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { builtInComponentSets } from '@/catalog';
import { formatDiagram } from '@/codec';
import {
  createController, createDocument, createElement, serializeDocument,
  type ComponentSet, type ConfluenceLiveLink, type ConfluencePageLiveLink, type ConfluenceLivePublishInput, type ConfluenceLivePublishResult, type DesktopBridge, type PluginBridge, type PluginExternalEvent, type PluginSettingsSnapshot, type SketchDocument,
} from '@/domain';
import { createWhiteboardStore } from '@/renderer/state/whiteboard';
import type { WhiteboardStore } from '@/renderer/state/contract';

const HANDLE = 'hdl_0123456789abcdef0123456789abcdef';
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const file = (token: string) => ({ handleId: HANDLE, name: 'aws.sketchdraw.json', versionToken: `sha256:${token.repeat(64)}` });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Longer than debounce plus retries: nothing else is on its way afterwards. */
const settle = () => wait(160);
const synced = (): ConfluenceLivePublishResult => ({ status: 'synced', message: 'Diagramm in Confluence aktualisiert.', uploaded: 1, bodyUpdated: false, syncedAt: new Date().toISOString() });
/** The test rasterizer keeps the drawn SVG readable inside the "PNG", so a test can see what was rendered. */
const rendered = (input: ConfluenceLivePublishInput, index = 0) => new TextDecoder().decode(input.images[index]!.png.slice(PNG.length));
const aws = builtInComponentSets.find((set) => set.id === 'sketchdraw.aws')!;
/** A real 1×1 PNG of one colour as data URL; two colours give two different URLs of the same length. */
function pixel(red: number, green: number, blue: number): string {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type), data]); const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, red, green, blue]))), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

const stores: WhiteboardStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.dispose(); vi.restoreAllMocks(); });

/** What the publication of a linked page is doing; the first page of the diagram unless another one is named. */
const live = (store: WhiteboardStore, pageId = store.state.document.pages[0]!.id) => store.state.confluencePageLive[pageId] ?? { state: 'off' as const, message: '' };
const firstPage = (store: WhiteboardStore) => store.state.document.pages[0]!.id;

/**
 * `link`: the link of the first page (null: none). `links`: links of further pages by page id. `diagramLink`: a link
 * of the whole diagram as versions before #240 stored it.
 */
async function setup(document: SketchDocument = createDocument('AWS Bedrock AgentCore'), options: { debounceMs?: number; open?: boolean; link?: Partial<ConfluenceLiveLink> | null; links?: Record<string, Partial<ConfluenceLiveLink>>; diagramLink?: Partial<ConfluenceLiveLink>; retryDelaysMs?: number[] } = {}) {
  let pluginListener: ((event: PluginExternalEvent) => void) | undefined;
  /** What the main process would answer; tests change it to play profile, link and plugin changes. */
  const target = (overrides: Partial<ConfluenceLiveLink> = {}): ConfluenceLiveLink => ({ pageId: '164037', pageTitle: 'Architektur', pageUrl: 'https://example.atlassian.net/wiki/pages/viewpage.action?pageId=164037', siteUrl: 'https://example.atlassian.net', documentId: document.id, usable: true, ...overrides });
  const remote = {
    links: [
      ...(options.link === null || options.diagramLink ? [] : [{ ...target(options.link), diagramPageId: document.pages[0]!.id }]),
      ...Object.entries(options.links ?? {}).map(([diagramPageId, overrides]) => ({ ...target(overrides), diagramPageId })),
    ] as ConfluencePageLiveLink[],
    diagramLink: options.diagramLink ? target(options.diagramLink) : null as ConfluenceLiveLink | null,
    profile: 'default', enabled: true,
  };
  const snapshot = (handle: string | null | undefined): PluginSettingsSnapshot => ({
    available: true, projectFolder: handle === null ? '' : '/project', profiles: [{ id: 'default', name: 'Standard' }, { id: 'work', name: 'Arbeit' }], activeProfileId: remote.profile,
    git: { installed: true, enabled: true, folderPath: '/project', autoCommit: true, autoPush: false, autoPull: true, remote: 'origin', remoteUrl: '', authMode: 'system', username: '', credentialStored: false, health: 'ready', message: 'Bereit' },
    atlassian: { installed: true, enabled: remote.enabled, siteUrl: 'https://example.atlassian.net', email: 'user@example.com', confluenceSpaceKey: 'DOC', jiraProjectKey: 'SK', jiraIssueType: 'Task', jqlFilter: '', credentialStored: true, health: 'ready', message: 'Bereit' },
    ...(remote.diagramLink && handle !== null && remote.profile === 'default' ? { confluenceLive: { ...remote.diagramLink } } : {}),
    ...(remote.links.length && handle !== null && remote.profile === 'default' ? { confluencePageLinks: remote.links.map((link) => ({ ...link })) } : {}),
  });
  const published: ConfluenceLivePublishInput[] = [];
  const publishConfluenceLive = vi.fn(async (input: ConfluenceLivePublishInput): Promise<ConfluenceLivePublishResult> => { published.push(input); return synced(); });
  const plugins: PluginBridge = {
    getSettings: vi.fn(async (handle?: string | null) => snapshot(handle)),
    selectProfile: vi.fn(async (id: string) => { remote.profile = id; return snapshot(HANDLE); }), createProfile: vi.fn(), renameProfile: vi.fn(), deleteProfile: vi.fn(),
    afterDocumentSaved: vi.fn(async () => {}), installPlugin: vi.fn(), uninstallPlugin: vi.fn(), configureGit: vi.fn(), configureAtlassian: vi.fn(async (input) => { remote.enabled = input.enabled; return snapshot(HANDLE); }), testAtlassian: vi.fn(), gitStatus: vi.fn(), gitSync: vi.fn(), gitWorkbench: vi.fn(), gitDiff: vi.fn(), gitCommit: vi.fn(), gitPush: vi.fn(), gitUpdate: vi.fn(), gitLog: vi.fn(), gitBranches: vi.fn(), gitCheckout: vi.fn(), gitCreateBranch: vi.fn(), gitMerge: vi.fn(), gitDiscard: vi.fn(), gitRestoreDocument: vi.fn(), gitAutomation: vi.fn(), watchDocument: vi.fn(async () => ({ ok: true, message: 'watching' })),
    listConfluencePages: vi.fn(async () => []), getConfluencePage: vi.fn(), updateConfluencePage: vi.fn(),
    setConfluenceLiveLink: vi.fn(async ({ pageId, documentId, diagramPageId }: { pageId: string | null; documentId: string; diagramPageId?: string }) => {
      remote.links = remote.links.filter((link) => link.diagramPageId !== diagramPageId);
      if (pageId !== null) remote.links.push({ ...target({ pageId, pageTitle: `Seite ${pageId}`, pageUrl: `https://example.atlassian.net/wiki/${pageId}`, documentId }), diagramPageId: diagramPageId! });
      return snapshot(HANDLE);
    }),
    convertConfluenceLiveLink: vi.fn(async ({ documentId, diagramPageIds }: { documentId: string; diagramPageIds: string[] }) => {
      if (remote.diagramLink?.documentId === documentId) remote.links.push(...diagramPageIds.map((diagramPageId: string) => ({ ...remote.diagramLink!, diagramPageId })));
      remote.diagramLink = null;
      return snapshot(HANDLE);
    }),
    publishConfluenceLive,
    createJiraIssue: vi.fn(async (input) => ({ id: '100', key: 'SK-1', title: input.title, description: input.description, status: 'todo' as const, remoteStatus: 'To Do', url: 'https://example.atlassian.net/browse/SK-1', updatedAt: '2026-10-18T10:00:00.000Z' })),
    listJiraIssues: vi.fn(async () => []), updateJiraIssue: vi.fn(), transitionJiraIssue: vi.fn(),
    onEvent: (listener) => { pluginListener = listener; return () => { pluginListener = undefined; }; },
  };
  const bridge: DesktopBridge = { platform: 'electron', plugins, openDocument: vi.fn(async () => ({ status: 'cancelled' as const })), saveDocument: vi.fn(async () => ({ status: 'cancelled' as const })), exportFile: vi.fn(async () => ({ status: 'cancelled' as const })), openExternal: vi.fn(async () => {}), onCloseRequested: () => () => {}, respondToClose: vi.fn(async () => {}), onMenuCommand: () => () => {} };
  const rasterize = vi.fn(async (svg: string) => new Uint8Array([...PNG, ...new TextEncoder().encode(svg)]));
  const store = createWhiteboardStore({ bridge, controller: createController(document), preferences: null, confluenceLive: { debounceMs: options.debounceMs ?? 15, retryDelaysMs: options.retryDelaysMs ?? [20, 20], failureHoldMs: 400, rasterize } });
  stores.push(store);
  store.setViewportSize(1000, 700);
  if (options.open !== false) {
    vi.mocked(bridge.openDocument).mockResolvedValue({ status: 'opened', text: serializeDocument(document), file: file('1') });
    await store.openDocument(); await store.refreshPluginSettings();
  }
  return { store, plugins, bridge, remote, published, publishConfluenceLive, rasterize, emit: (event: PluginExternalEvent) => pluginListener?.(event) };
}

describe('automatic publication of linked diagram pages to their Confluence pages (#210, #240)', () => {
  it('publishes the rendered diagram after opening and after every local edit, without a manual send', async () => {
    const { store, published, plugins } = await setup();
    await vi.waitFor(() => expect(published).toHaveLength(1));
    expect(published[0]).toMatchObject({ handleId: HANDLE, documentId: store.state.document.id, title: 'AWS Bedrock AgentCore' });
    expect(published[0]!.images).toHaveLength(1);
    expect([...published[0]!.images[0]!.png.slice(0, 8)]).toEqual(PNG);
    expect(rendered(published[0]!)).toContain('AWS Bedrock AgentCore');
    await vi.waitFor(() => expect(live(store).state).toBe('synced'));
    expect(live(store).syncedAt).toBeDefined();

    // A local edit: an AWS component is placed on the canvas.
    await store.insertComponent(aws, 'aws.compute.instance'); await store.whenIdle();
    expect(live(store).state).toBe('pending');
    await vi.waitFor(() => expect(published).toHaveLength(2));
    expect(published[1]!.images[0]!.hash).not.toBe(published[0]!.images[0]!.hash);
    expect(rendered(published[1]!)).toContain('<g id="sd-0"');
    expect(rendered(published[0]!)).not.toContain('<g id="sd-0"');
    // The image is a picture of the diagram only: no embedded document, no script.
    expect(rendered(published[1]!)).not.toMatch(/<metadata|<script|sketchdraw-interop/);
    await vi.waitFor(() => expect(live(store).state).toBe('synced'));
    await settle();
    expect(published).toHaveLength(2);
    // The diagram itself never carries the link or anything about the publication.
    expect(serializeDocument(store.state.document)).not.toMatch(/164037|atlassian\.net/);
    expect(plugins.updateConfluencePage).not.toHaveBeenCalled();
  });

  it('collects quick successive edits into one publication of the newest state', async () => {
    // The pause after the last edit is long enough that four edits on a slow runner still fall into one: with
    // 15 ms a single edit could take longer than the pause and be published on its own (CI, #193).
    const { store, published } = await setup(undefined, { debounceMs: 250 });
    await vi.waitFor(() => expect(published).toHaveLength(1));
    for (let index = 0; index < 4; index++) { await store.insertComponent(aws, 'aws.compute.instance', { x: 200 + index * 40, y: 300 }); await store.whenIdle(); }
    await vi.waitFor(() => expect(published).toHaveLength(2), { timeout: 5000 });
    await settle();
    expect(published).toHaveLength(2);
    expect(rendered(published[1]!)).toContain('<g id="sd-3"');
  });

  it('publishes one edit made while a publication is running afterwards, never two publications at once', async () => {
    const { store, published, publishConfluenceLive } = await setup();
    await vi.waitFor(() => expect(published).toHaveLength(1));
    let release!: (result: ConfluenceLivePublishResult) => void; let active = 0; let overlap = false;
    publishConfluenceLive.mockImplementation(async (input) => {
      published.push(input); if (++active > 1) overlap = true;
      const result = published.length === 2 ? await new Promise<ConfluenceLivePublishResult>((resolve) => { release = resolve; }) : synced();
      active--; return result;
    });
    await store.insertComponent(aws, 'aws.compute.instance'); await store.whenIdle();
    await vi.waitFor(() => expect(published).toHaveLength(2));
    await store.insertComponent(aws, 'aws.compute.instance', { x: 600, y: 300 }); await store.whenIdle();
    await settle();
    expect(published).toHaveLength(2);
    expect(live(store).state).toBe('syncing');
    release(synced());
    await vi.waitFor(() => expect(published).toHaveLength(3));
    expect(rendered(published[2]!)).toContain('<g id="sd-1"');
    expect(overlap).toBe(false);
  });

  it('publishes each linked page through its own link, whichever page is visible, and nothing of a page without a link', async () => {
    const document = createDocument('Plattform');
    document.pages = [{ id: 'page:overview', name: 'Übersicht' }, { id: 'page:network', name: 'Netz' }, { id: 'page:notes', name: 'Notizen' }];
    document.elements = [
      createElement('rectangle', { id: 'el:a', pageId: 'page:overview', x: 0, y: 0, width: 200, height: 100, text: 'Gateway' }),
      createElement('rectangle', { id: 'el:b', pageId: 'page:network', x: 0, y: 0, width: 200, height: 100, text: 'VPC privat' }),
      createElement('rectangle', { id: 'el:c', pageId: 'page:notes', x: 0, y: 0, width: 200, height: 100, text: 'Nur intern' }),
    ];
    const { store, published, rasterize } = await setup(document, { links: { 'page:network': { pageId: '200200' } } });
    await vi.waitFor(() => expect(published).toHaveLength(2));
    // One publication per linked page, each with exactly the image of that page.
    expect(published.map((input) => [input.diagramPageId, input.images.map((image) => [image.pageId, image.name])]).sort()).toEqual([
      ['page:network', [['page:network', 'Netz']]],
      ['page:overview', [['page:overview', 'Übersicht']]],
    ]);
    expect(store.state.activePageId).toBe('page:overview');
    const overview = published.find((input) => input.diagramPageId === 'page:overview')!;
    const network = published.find((input) => input.diagramPageId === 'page:network')!;
    expect(rendered(overview)).toContain('Gateway');
    expect(rendered(overview)).toContain('Plattform · Übersicht');
    expect(rendered(network)).toContain('VPC privat');
    expect(rendered(network)).not.toContain('Gateway');
    expect(published.map((input) => rendered(input)).join()).not.toContain('Nur intern');
    expect(rasterize).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect([live(store, 'page:overview').state, live(store, 'page:network').state]).toEqual(['synced', 'synced']));
    expect(Object.keys(store.state.confluencePageLive).sort()).toEqual(['page:network', 'page:overview']);

    // An edit on one page publishes that page only; the other page is neither drawn nor sent again.
    store.selectPage('page:network');
    await store.insertComponent(aws, 'aws.compute.instance'); await store.whenIdle();
    await vi.waitFor(() => expect(published).toHaveLength(3));
    await settle();
    expect(published).toHaveLength(3);
    expect(published[2]!.diagramPageId).toBe('page:network');
    expect(published[2]!.images[0]!.hash).not.toBe(network.images[0]!.hash);
    expect(rasterize).toHaveBeenCalledTimes(3);

    // A page without a link is never published, also when it changes or a page is added.
    store.selectPage('page:notes');
    await store.insertComponent(aws, 'aws.compute.instance'); await store.whenIdle();
    store.addPage(); await store.whenIdle();
    await settle();
    expect(published).toHaveLength(3);
  });

  it('brings every linked page to Confluence again when the diagram is saved, also after the attempts had given up', async () => {
    const document = createDocument('Plattform');
    document.pages = [{ id: 'page:overview', name: 'Übersicht' }, { id: 'page:network', name: 'Netz' }, { id: 'page:notes', name: 'Notizen' }];
    document.elements = [
      createElement('rectangle', { id: 'el:a', pageId: 'page:overview', x: 0, y: 0, width: 200, height: 100, text: 'Gateway' }),
      createElement('rectangle', { id: 'el:b', pageId: 'page:network', x: 0, y: 0, width: 200, height: 100, text: 'VPC privat' }),
      createElement('rectangle', { id: 'el:c', pageId: 'page:notes', x: 0, y: 0, width: 200, height: 100, text: 'Nur intern' }),
    ];
    const { store, bridge, published, publishConfluenceLive } = await setup(document, { links: { 'page:network': { pageId: '200200' } }, retryDelaysMs: [] });
    await vi.waitFor(() => expect(published).toHaveLength(2));
    vi.mocked(bridge.saveDocument).mockResolvedValue({ status: 'saved', file: file('2') });
    // Nothing changed, yet the save asks Confluence for both linked pages; the page without a link stays out of it.
    await store.save();
    await vi.waitFor(() => expect(published).toHaveLength(4));
    expect(published.slice(2).map((input) => input.diagramPageId).sort()).toEqual(['page:network', 'page:overview']);
    // Confluence refuses, and with no retry left the publication stops with the reason.
    publishConfluenceLive.mockResolvedValue({ status: 'retry', message: 'Atlassian antwortete mit 403.', uploaded: 0, bodyUpdated: false });
    await store.insertComponent(aws, 'aws.compute.instance'); await store.whenIdle();
    await vi.waitFor(() => expect(store.state.confluencePageLive['page:overview']).toMatchObject({ state: 'error' }));
    const stopped = publishConfluenceLive.mock.calls.length;
    // The next save starts every page anew.
    publishConfluenceLive.mockResolvedValue({ status: 'synced', message: 'Diagramm in Confluence aktualisiert.', uploaded: 1, bodyUpdated: true, syncedAt: '2026-11-23T15:00:00.000Z' });
    await store.save();
    await vi.waitFor(() => expect(store.state.confluencePageLive['page:overview']).toMatchObject({ state: 'synced' }));
    await vi.waitFor(() => expect(store.state.confluencePageLive['page:network']).toMatchObject({ state: 'synced' }));
    // Both linked pages were sent again: the one whose attempts had stopped and the one that had not changed.
    expect(publishConfluenceLive.mock.calls.slice(stopped).map(([input]) => input.diagramPageId).sort()).toEqual(['page:network', 'page:overview']);
  });

  it('pauses the link of a deleted page and continues when the deletion is undone', async () => {
    const document = createDocument('Plattform');
    document.pages = [{ id: 'page:overview', name: 'Übersicht' }, { id: 'page:network', name: 'Netz' }];
    document.elements = [createElement('rectangle', { id: 'el:b', pageId: 'page:network', x: 0, y: 0, width: 200, height: 100, text: 'VPC privat' })];
    const { store, published } = await setup(document, { link: null, links: { 'page:network': {} } });
    await vi.waitFor(() => expect(live(store, 'page:network').state).toBe('synced'));
    expect(published).toHaveLength(1);

    store.deletePage('page:network'); await store.whenIdle();
    expect(store.state.pages.map((page) => page.id)).toEqual(['page:overview']);
    expect(live(store, 'page:network')).toMatchObject({ state: 'paused', message: 'Diese Seite gibt es im Diagramm nicht mehr.' });
    await store.insertComponent(aws, 'aws.compute.instance'); await store.whenIdle();
    await settle();
    expect(published).toHaveLength(1);

    await store.undo(); await store.whenIdle();
    await store.undo(); await store.whenIdle();
    expect(store.state.pages.map((page) => page.id)).toEqual(['page:overview', 'page:network']);
    await vi.waitFor(() => expect(live(store, 'page:network').state).toBe('synced'));
    expect(published.every((input) => input.diagramPageId === 'page:network')).toBe(true);
  });

  it('turns a link of the whole diagram from an earlier version into links per page as soon as the diagram is open', async () => {
    const document = createDocument('Plattform');
    document.pages = [{ id: 'page:overview', name: 'Übersicht' }, { id: 'page:network', name: 'Netz' }];
    const { store, published, plugins } = await setup(document, { diagramLink: { lastSyncedAt: '2026-11-19T10:00:00.000Z' } });
    await vi.waitFor(() => expect(plugins.convertConfluenceLiveLink).toHaveBeenCalledTimes(1));
    expect(plugins.convertConfluenceLiveLink).toHaveBeenCalledWith({ handleId: HANDLE, documentId: document.id, diagramPageIds: ['page:overview', 'page:network'] });
    await vi.waitFor(() => expect(store.state.pluginSettings?.confluencePageLinks?.map((link) => link.diagramPageId)).toEqual(['page:overview', 'page:network']));
    expect(store.state.pluginSettings).not.toHaveProperty('confluenceLive');
    await vi.waitFor(() => expect(published).toHaveLength(2));
    // Nothing is ever published through the link of the whole diagram.
    expect(published.map((input) => input.diagramPageId).sort()).toEqual(['page:network', 'page:overview']);
    await settle();
    expect(plugins.convertConfluenceLiveLink).toHaveBeenCalledTimes(1);
  });

  it('leaves a link of the whole diagram alone when the diagram is not open as a local file, and asks only once when the conversion fails', async () => {
    const closed = await setup(createDocument('AWS'), { open: false, diagramLink: {} });
    await closed.store.refreshPluginSettings();
    await settle();
    expect(closed.plugins.convertConfluenceLiveLink).not.toHaveBeenCalled();
    expect(closed.published).toHaveLength(0);

    const failing = await setup(createDocument('AWS'), { open: false, diagramLink: {} });
    vi.mocked(failing.plugins.convertConfluenceLiveLink!).mockRejectedValue(new Error('Profile sind gesperrt.'));
    vi.mocked(failing.bridge.openDocument).mockResolvedValue({ status: 'opened', text: serializeDocument(failing.store.state.document), file: file('1') });
    await failing.store.openDocument(); await failing.store.refreshPluginSettings(); await failing.store.refreshPluginSettings();
    await settle();
    expect(failing.plugins.convertConfluenceLiveLink).toHaveBeenCalledTimes(1);
    expect(failing.published).toHaveLength(0);
    expect(failing.store.state.notices.filter((notice) => notice.kind === 'error')).toEqual([]);
  });

  it('publishes a version that arrives through Git as soon as it is loaded', async () => {
    const document = createDocument('AWS Bedrock AgentCore');
    const { store, published, emit } = await setup(document);
    await vi.waitFor(() => expect(published).toHaveLength(1));
    const pulled = structuredClone(document);
    pulled.elements = [createElement('rectangle', { id: 'el:git', pageId: pulled.pages[0]!.id, x: 40, y: 40, width: 240, height: 120, text: 'Aus Git: Guardrails' })];
    emit({ type: 'document-changed', text: serializeDocument(pulled), file: file('2') });
    await vi.waitFor(() => expect(published).toHaveLength(2));
    expect(store.state.document.elements).toHaveLength(1);
    expect(rendered(published[1]!)).toContain('Aus Git: Guardrails');
    expect(published[1]!.images[0]!.hash).not.toBe(published[0]!.images[0]!.hash);
    await vi.waitFor(() => expect(live(store).state).toBe('synced'));
  });

  it('keeps unsaved local work when Git brings a change and pauses the publication until the conflict is resolved', async () => {
    const document = createDocument('AWS Bedrock AgentCore');
    const { store, published, emit } = await setup(document);
    await vi.waitFor(() => expect(published).toHaveLength(1));
    await store.insertComponent(aws, 'aws.compute.instance'); await store.whenIdle();
    await vi.waitFor(() => expect(published).toHaveLength(2));
    const pulled = structuredClone(document);
    pulled.elements = [createElement('rectangle', { id: 'el:git', pageId: pulled.pages[0]!.id, x: 40, y: 40, width: 240, height: 120, text: 'Aus Git' })];
    emit({ type: 'document-changed', text: serializeDocument(pulled), file: file('2') });
    // The local, unsaved component stays; the external version waits.
    expect(store.state.pendingExternalDocument).toBe(true);
    expect(store.state.document.elements[0]?.kind).toBe('component');
    expect(live(store)).toMatchObject({ state: 'paused', message: expect.stringContaining('externe Änderung wartet') });
    await store.insertComponent(aws, 'aws.compute.instance', { x: 600, y: 300 }); await store.whenIdle();
    await settle();
    expect(published).toHaveLength(2);

    expect(await store.acceptExternalDocument()).toBe(true);
    await vi.waitFor(() => expect(published).toHaveLength(3));
    expect(rendered(published[2]!)).toContain('Aus Git');
  });

  it('does not contact Confluence for changes that leave the pictures as they are', async () => {
    const { store, published, rasterize } = await setup();
    await vi.waitFor(() => expect(published).toHaveLength(1));
    await vi.waitFor(() => expect(live(store).state).toBe('synced'));
    const states: string[] = [];
    const stop = setInterval(() => { states.push(live(store).state); }, 2);
    expect(await store.createTask({ title: 'Review', description: 'Nur eine Aufgabe' })).toBe(true);
    expect(store.state.document.tasks).toHaveLength(1);
    await settle();
    clearInterval(stop);
    // Not even a new rendering is started: the pictures are the same.
    expect(new Set(states)).toEqual(new Set(['synced']));
    expect(published).toHaveLength(1);
    expect(rasterize).toHaveBeenCalledTimes(1);
  });

  it('publishes on its own when only the icon of a used component changes through the code view', async () => {
    const icon = (colour: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4L20 20" stroke="${colour}" stroke-width="2" fill="none"/></svg>`;
    const team: ComponentSet = { id: 'custom.team', name: 'Team', version: '1.0.0', components: [{ type: 'custom.team.service', name: 'Service', provider: 'custom', category: 'Team', defaultWidth: 160, defaultHeight: 120, style: {}, iconSvg: icon('#ff0000') }] };
    const document = createDocument('Icons'); document.componentSets = [team];
    const { store, published, rasterize } = await setup(document);
    await vi.waitFor(() => expect(published).toHaveLength(1));
    await store.insertComponent(team, 'custom.team.service'); await store.whenIdle();
    await vi.waitFor(() => expect(published).toHaveLength(2));
    await vi.waitFor(() => expect(live(store).state).toBe('synced'));
    expect(rendered(published[1]!)).toContain('#ff0000');

    // A valid replacement of the whole diagram code in which nothing but the icon definition differs.
    const next = structuredClone(JSON.parse(JSON.stringify(store.state.document)) as SketchDocument);
    next.componentSets[0]!.components[0]!.iconSvg = icon('#0000ff');
    expect(JSON.stringify(next.elements)).toBe(JSON.stringify(store.state.document.elements));
    store.setCodeDraft(formatDiagram(next));
    expect(await store.applyCode()).toBe(true);
    expect(store.state.code.diagnostics).toEqual([]);
    expect(store.state.document.componentSets[0]!.components[0]!.iconSvg).toContain('#0000ff');

    // No "Jetzt synchronisieren": the changed picture goes out by itself.
    await vi.waitFor(() => expect(published).toHaveLength(3));
    expect(published[2]!.images[0]!.hash).not.toBe(published[1]!.images[0]!.hash);
    expect(rendered(published[2]!)).toContain('#0000ff');
    expect(rendered(published[2]!)).not.toContain('#ff0000');
    expect(rasterize).toHaveBeenCalledTimes(3);
    await vi.waitFor(() => expect(live(store).state).toBe('synced'));
  });

  it('publishes on its own when a used image is replaced by another one of exactly the same size', async () => {
    const red = pixel(255, 0, 0); const blue = pixel(0, 0, 255);
    expect(red).not.toBe(blue);
    expect(red).toHaveLength(blue.length);
    const document = createDocument('Bilder');
    document.assets = { 'asset:logo': { id: 'asset:logo', name: 'Logo', mimeType: 'image/png', dataUrl: red } };
    document.elements = [createElement('image', { id: 'el:logo', pageId: document.pages[0]!.id, x: 40, y: 40, width: 120, height: 120, assetId: 'asset:logo' })];
    const { store, published } = await setup(document);
    await vi.waitFor(() => expect(published).toHaveLength(1));
    await vi.waitFor(() => expect(live(store).state).toBe('synced'));
    expect(rendered(published[0]!)).toContain(red);

    const next = JSON.parse(JSON.stringify(store.state.document)) as SketchDocument;
    next.assets['asset:logo']!.dataUrl = blue;
    store.setCodeDraft(formatDiagram(next));
    expect(await store.applyCode()).toBe(true);
    expect(store.state.code.diagnostics).toEqual([]);
    expect(store.state.document.assets['asset:logo']!.dataUrl).toBe(blue);

    await vi.waitFor(() => expect(published).toHaveLength(2));
    expect(published[1]!.images[0]!.hash).not.toBe(published[0]!.images[0]!.hash);
    expect(rendered(published[1]!)).toContain(blue);
    expect(rendered(published[1]!)).not.toContain(red);
  });

  it('still does not publish when a code replacement changes only tasks and comments', async () => {
    const document = createDocument('Nur Aufgaben');
    document.elements = [createElement('rectangle', { id: 'el:a', pageId: document.pages[0]!.id, x: 0, y: 0, width: 200, height: 100, text: 'Gateway' })];
    const { store, published, rasterize } = await setup(document);
    await vi.waitFor(() => expect(published).toHaveLength(1));
    await vi.waitFor(() => expect(live(store).state).toBe('synced'));
    const next = JSON.parse(JSON.stringify(store.state.document)) as SketchDocument;
    next.tasks = [{ id: 'task:1', title: 'Review', description: 'Nur eine Aufgabe', status: 'todo', rank: 0, createdAt: '2026-11-15T10:00:00.000Z', updatedAt: '2026-11-15T10:00:00.000Z' }];
    next.commentThreads = [{ id: 'thread:1', target: { anchor: { x: .5, y: .5 }, fallback: { x: 10, y: 10 } }, messages: [{ id: 'message:1', authorId: 'user:1', authorName: 'User', body: 'Nur ein Kommentar', createdAt: '2026-11-15T10:00:00.000Z' }], resolved: false, createdAt: '2026-11-15T10:00:00.000Z', updatedAt: '2026-11-15T10:00:00.000Z' }];
    store.setCodeDraft(formatDiagram(next));
    expect(await store.applyCode()).toBe(true);
    expect(store.state.document.tasks).toHaveLength(1);
    expect(store.state.document.commentThreads).toHaveLength(1);
    await settle();
    expect(published).toHaveLength(1);
    expect(rasterize).toHaveBeenCalledTimes(1);
    expect(live(store).state).toBe('synced');
  });

  it('retries with growing pauses, shows the truth meanwhile and stops after the last attempt', async () => {
    // The pauses are long enough for a slow runner to see the state between two attempts; with 20 and 30 ms the
    // retries could be over before the first look (Windows CI, #193).
    const { store, published, publishConfluenceLive } = await setup(createDocument('AWS'), { retryDelaysMs: [150, 200] });
    await vi.waitFor(() => expect(published).toHaveLength(1));
    publishConfluenceLive.mockImplementation(async (input) => { published.push(input); return { status: 'retry', message: 'Confluence ist nicht erreichbar. Die Veröffentlichung wird wiederholt, sobald die Verbindung steht.', uploaded: 0, bodyUpdated: false }; });
    await store.insertComponent(aws, 'aws.compute.instance'); await store.whenIdle();
    await vi.waitFor(() => expect(live(store).state).toBe('retrying'));
    expect(live(store).message).toContain('nicht erreichbar');
    // One attempt plus two retries, then the automatic attempts end.
    await vi.waitFor(() => expect(live(store).state).toBe('error'), { timeout: 5000 });
    expect(published).toHaveLength(4);
    expect(live(store).message).toContain('Automatische Wiederholungen sind pausiert');
    await settle();
    expect(published).toHaveLength(4);

    // The connection is back: the same unpublished state goes out and only then counts as published.
    publishConfluenceLive.mockImplementation(async (input) => { published.push(input); return synced(); });
    store.syncConfluencePage(firstPage(store));
    await vi.waitFor(() => expect(live(store).state).toBe('synced'));
    expect(published).toHaveLength(5);
    expect(published[4]!.images[0]!.hash).toBe(published[1]!.images[0]!.hash);
  });

  it('recovers on its own when the first retry succeeds', async () => {
    const { store, published, publishConfluenceLive } = await setup();
    await vi.waitFor(() => expect(published).toHaveLength(1));
    publishConfluenceLive.mockImplementationOnce(async (input) => { published.push(input); throw new Error('IPC lost'); });
    await store.insertComponent(aws, 'aws.compute.instance'); await store.whenIdle();
    await vi.waitFor(() => expect(published).toHaveLength(3));
    await vi.waitFor(() => expect(live(store).state).toBe('synced'));
    expect(published[2]!.images[0]!.hash).toBe(published[1]!.images[0]!.hash);
  });

  it('shows a problem that needs the user and does not ask Confluence again at every edit', async () => {
    const { store, published, publishConfluenceLive } = await setup();
    await vi.waitFor(() => expect(published).toHaveLength(1));
    publishConfluenceLive.mockImplementation(async (input) => { published.push(input); return { status: 'failed', message: 'Confluence verweigert den Zugriff. Prüfe das API-Token und die Rechte für die Seite.', uploaded: 0, bodyUpdated: false }; });
    await store.insertComponent(aws, 'aws.compute.instance'); await store.whenIdle();
    await vi.waitFor(() => expect(live(store)).toMatchObject({ state: 'error', message: expect.stringContaining('verweigert den Zugriff') }));
    await store.insertComponent(aws, 'aws.compute.instance', { x: 600, y: 300 }); await store.whenIdle();
    await settle();
    expect(published).toHaveLength(2);
    expect(live(store).state).toBe('error');
    // After the hold, the newest state is tried once more.
    await vi.waitFor(() => expect(published).toHaveLength(3), { timeout: 2000 });
    expect(rendered(published[2]!)).toContain('<g id="sd-1"');
  });

  it('drops a publication that was still running when the profile changed', async () => {
    const { store, published, publishConfluenceLive } = await setup();
    await vi.waitFor(() => expect(published).toHaveLength(1));
    let release!: (result: ConfluenceLivePublishResult) => void;
    publishConfluenceLive.mockImplementation((input) => { published.push(input); return new Promise((resolve) => { release = resolve; }); });
    await store.insertComponent(aws, 'aws.compute.instance'); await store.whenIdle();
    await vi.waitFor(() => expect(published).toHaveLength(2));
    // The other profile has no link for this diagram.
    expect(await store.selectPluginProfile('work')).toBe(true);
    expect(live(store).state).toBe('off');
    release(synced());
    await settle();
    expect(live(store)).toEqual({ state: 'off', message: '' });
    await store.insertComponent(aws, 'aws.compute.instance', { x: 600, y: 300 }); await store.whenIdle();
    await settle();
    expect(published).toHaveLength(2);
  });

  it('drops a running publication when another diagram replaces the linked one', async () => {
    const { store, published, publishConfluenceLive } = await setup();
    await vi.waitFor(() => expect(published).toHaveLength(1));
    let release!: (result: ConfluenceLivePublishResult) => void;
    publishConfluenceLive.mockImplementation((input) => { published.push(input); return new Promise((resolve) => { release = resolve; }); });
    store.syncConfluencePage(firstPage(store));
    await vi.waitFor(() => expect(published).toHaveLength(2));
    await store.newDocument();
    expect(live(store).state).toBe('off');
    release(synced());
    await store.insertComponent(aws, 'aws.compute.instance'); await store.whenIdle();
    await settle();
    expect(live(store).state).toBe('off');
    expect(published).toHaveLength(2);
  });

  it('never publishes as a guest of a session, with a disabled plugin, for a foreign diagram or over a link of another site', async () => {
    const guest = await setup();
    await vi.waitFor(() => expect(guest.published).toHaveLength(1));
    guest.store.enterRoomGuest('editor', true);
    await guest.store.insertComponent(aws, 'aws.compute.instance'); await guest.store.whenIdle();
    await settle();
    expect(live(guest.store).state).toBe('off');
    expect(guest.published).toHaveLength(1);

    const disabled = await setup();
    await vi.waitFor(() => expect(disabled.published).toHaveLength(1));
    expect(await disabled.store.configureAtlassianPlugin({ enabled: false, siteUrl: 'https://example.atlassian.net', email: 'user@example.com', confluenceSpaceKey: 'DOC', jiraProjectKey: 'SK', jiraIssueType: 'Task', jqlFilter: '' })).toBe(true);
    expect(live(disabled.store)).toMatchObject({ state: 'paused', message: expect.stringContaining('deaktiviert') });
    await disabled.store.insertComponent(aws, 'aws.compute.instance'); await disabled.store.whenIdle();
    await settle();
    expect(disabled.published).toHaveLength(1);

    // The linked file now holds another diagram (for example after a pull replaced it).
    const foreign = await setup(createDocument('Fremd'), { link: { documentId: 'document:the-linked-one' } });
    await settle();
    expect(live(foreign.store)).toMatchObject({ state: 'paused', message: expect.stringContaining('anderen Diagramm') });
    expect(foreign.published).toHaveLength(0);

    const otherSite = await setup(createDocument('AWS'), { link: { usable: false, siteUrl: 'https://old.atlassian.net' } });
    await settle();
    expect(live(otherSite.store)).toMatchObject({ state: 'paused', message: expect.stringContaining('anderen Atlassian-Site') });
    expect(otherSite.published).toHaveLength(0);

    const unsaved = await setup(createDocument('Neu'), { open: false });
    await unsaved.store.insertComponent(aws, 'aws.compute.instance'); await unsaved.store.whenIdle();
    await settle();
    expect(live(unsaved.store).state).toBe('off');
    expect(unsaved.published).toHaveLength(0);
  });

  it('starts publishing when a page is linked, follows the page to another Confluence page and stops when the link is removed', async () => {
    const { store, published, plugins } = await setup(createDocument('AWS'), { link: null });
    const page = firstPage(store);
    await store.insertComponent(aws, 'aws.compute.instance'); await store.whenIdle();
    await settle();
    expect(published).toHaveLength(0);
    expect(live(store).state).toBe('off');
    expect(store.state.confluencePageLive).toEqual({});

    expect(await store.setConfluencePageLink(page, '164037')).toBe(true);
    expect(plugins.setConfluenceLiveLink).toHaveBeenCalledWith({ handleId: HANDLE, documentId: store.state.document.id, pageId: '164037', diagramPageId: page, diagramPageIds: [page] });
    expect(store.state.pluginSettings?.confluencePageLinks).toMatchObject([{ diagramPageId: page, pageId: '164037' }]);
    expect(store.state.notices.at(-1)?.text).toContain('ist mit der Confluence-Seite „Seite 164037“ verknüpft');
    await vi.waitFor(() => expect(published).toHaveLength(1));
    expect(published[0]!.diagramPageId).toBe(page);
    expect(rendered(published[0]!)).toContain('<g id="sd-0"');
    await vi.waitFor(() => expect(live(store).state).toBe('synced'));

    // Another target is another publication: the same picture is sent to the new Confluence page.
    expect(await store.setConfluencePageLink(page, '200200')).toBe(true);
    await vi.waitFor(() => expect(published).toHaveLength(2));
    expect(published[1]!.images[0]!.hash).toBe(published[0]!.images[0]!.hash);

    expect(await store.setConfluencePageLink(page, null)).toBe(true);
    expect(plugins.setConfluenceLiveLink).toHaveBeenLastCalledWith({ handleId: HANDLE, documentId: store.state.document.id, pageId: null, diagramPageId: page, diagramPageIds: [page] });
    expect(live(store).state).toBe('off');
    expect(store.state.confluencePageLive).toEqual({});
    await store.insertComponent(aws, 'aws.compute.instance', { x: 600, y: 300 }); await store.whenIdle();
    await settle();
    expect(published).toHaveLength(2);
    // A page that does not exist cannot be linked.
    expect(await store.setConfluencePageLink('page:missing', '164037')).toBe(false);
  });

  it('opens the link dialog for an existing page and closes it when the diagram goes away', async () => {
    const { store, bridge } = await setup();
    store.openConfluencePageLink('page:missing');
    expect(store.state.confluenceLinkPageId).toBeNull();
    store.openConfluencePageLink(firstPage(store));
    expect(store.state.confluenceLinkPageId).toBe(firstPage(store));
    store.closeConfluencePageLink();
    expect(store.state.confluenceLinkPageId).toBeNull();

    store.openConfluencePageLink(firstPage(store));
    const other = createDocument('Anderes Diagramm');
    vi.mocked(bridge.openDocument).mockResolvedValue({ status: 'opened', text: serializeDocument(other), file: { ...file('2'), handleId: 'hdl_ffffffffffffffffffffffffffffffff' } });
    await store.openDocument();
    expect(store.state.confluenceLinkPageId).toBeNull();
  });

  it('stops for good when the store is disposed', async () => {
    const { store, published } = await setup();
    await vi.waitFor(() => expect(published).toHaveLength(1));
    await store.insertComponent(aws, 'aws.compute.instance'); await store.whenIdle();
    store.dispose();
    await settle();
    expect(published).toHaveLength(1);
  });
});

describe('manual send of an embedded Confluence page', () => {
  it('passes the loaded page content along, so the main process can refuse a page that changed or would lose content', async () => {
    const { store, plugins } = await setup(createDocument('Seiten'), { link: null });
    const hash = 'a'.repeat(64);
    vi.mocked(plugins.getConfluencePage).mockResolvedValue({ id: '7', title: 'Live Architecture', version: 4, url: 'https://example.atlassian.net/wiki/pages/7', storageBody: '<h2>Architecture</h2><p>Editable page</p>', bodyHash: hash });
    expect(await store.insertConfluencePage('7')).toBe(true);
    const element = store.state.document.elements[0]!;
    expect(element.metadata?.['sketchdraw.atlassian.pageBodyHash']).toBe(hash);

    vi.mocked(plugins.updateConfluencePage).mockRejectedValueOnce(new Error('Senden würde Inhalte der Confluence-Seite entfernen, die eine Annotation nicht abbilden kann (zum Beispiel Formatierungen, Links, Tabellen, Bilder oder Makros). Die Seite wurde nicht geändert.'));
    expect(await store.syncConfluenceElement(element.id)).toBe(false);
    expect(plugins.updateConfluencePage).toHaveBeenLastCalledWith(expect.objectContaining({ pageId: '7', version: 4, expectedBodyHash: hash }));
    expect(store.state.notices.at(-1)).toMatchObject({ kind: 'error', text: expect.stringContaining('Die Seite wurde nicht geändert') });
    // A refused send leaves the recorded page state alone.
    expect(store.state.document.elements[0]!.metadata?.['sketchdraw.atlassian.pageVersion']).toBe('4');
  });

  it('does not send a page that was embedded before its content was recorded; reloading gives it a starting point', async () => {
    const { store, plugins } = await setup(createDocument('Seiten'), { link: null });
    // An annotation as older versions stored it: page id and version, no content digest.
    vi.mocked(plugins.getConfluencePage).mockResolvedValue({ id: '7', title: 'Live Architecture', version: 4, url: 'https://example.atlassian.net/wiki/pages/7', storageBody: '<p>Editable page</p>' });
    expect(await store.insertConfluencePage('7')).toBe(true);
    const element = store.state.document.elements[0]!;
    expect(element.metadata).not.toHaveProperty('sketchdraw.atlassian.pageBodyHash');
    expect(await store.syncConfluenceElement(element.id)).toBe(false);
    expect(plugins.updateConfluencePage).not.toHaveBeenCalled();
    expect(store.state.notices.at(-1)).toMatchObject({ kind: 'error', text: expect.stringContaining('Lade sie neu') });

    const hash = 'b'.repeat(64);
    vi.mocked(plugins.getConfluencePage).mockResolvedValue({ id: '7', title: 'Live Architecture', version: 5, url: 'https://example.atlassian.net/wiki/pages/7', storageBody: '<p>Editable page</p>', bodyHash: hash });
    expect(await store.refreshConfluenceElement(element.id)).toBe(true);
    vi.mocked(plugins.updateConfluencePage).mockResolvedValue({ id: '7', title: 'Live Architecture', version: 6, url: 'https://example.atlassian.net/wiki/pages/7', storageBody: '<p>Editable page</p>', bodyHash: 'c'.repeat(64) });
    expect(await store.syncConfluenceElement(element.id)).toBe(true);
    expect(plugins.updateConfluencePage).toHaveBeenCalledWith(expect.objectContaining({ pageId: '7', version: 5, expectedBodyHash: hash }));
    expect(store.state.document.elements[0]!.metadata).toMatchObject({ 'sketchdraw.atlassian.pageVersion': '6', 'sketchdraw.atlassian.pageBodyHash': 'c'.repeat(64) });
  });

  it('shows a pause the server asked for with its end', async () => {
    const { store, published, publishConfluenceLive } = await setup();
    await vi.waitFor(() => expect(published).toHaveLength(1));
    const retryAt = new Date(Date.now() + 3600_000).toISOString();
    publishConfluenceLive.mockImplementation(async (input) => { published.push(input); return { status: 'retry', message: 'Confluence hat um eine Pause gebeten. Die Veröffentlichung wird danach automatisch fortgesetzt.', uploaded: 0, bodyUpdated: false, retryAt }; });
    await store.insertComponent(aws, 'aws.compute.instance'); await store.whenIdle();
    await vi.waitFor(() => expect(live(store)).toMatchObject({ state: 'retrying', retryAt }));
    // Edits and a manual start during the pause do not call the main process again.
    await store.insertComponent(aws, 'aws.compute.instance', { x: 600, y: 300 }); await store.whenIdle();
    store.syncConfluencePage(firstPage(store));
    await settle();
    expect(published).toHaveLength(2);
    expect(live(store)).toMatchObject({ state: 'retrying', retryAt });
  });
});
