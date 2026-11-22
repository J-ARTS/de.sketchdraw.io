import { afterEach, describe, expect, it, vi } from 'vitest';
import { createController, createDocument, createElement, type DesktopBridge, type SketchDocument } from '@/domain';
import { builtInComponentSets } from '@/catalog';
import { createWhiteboardStore } from '@/renderer/state/whiteboard';
import { parsePageClipboard } from '@/renderer/state/pages';
import type { WhiteboardStore } from '@/renderer/state/contract';

const stores: WhiteboardStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.dispose(); });

/** A clipboard in memory. `hold()` makes the next read wait until `release()` is called. */
function memoryClipboard() {
  let text = ''; let gate: Promise<void> | null = null; let open: () => void = () => {};
  return {
    writeText: async (value: string) => { text = value; },
    readText: async () => { const value = text; if (gate) await gate; return value; },
    hold() { gate = new Promise<void>((resolve) => { open = resolve; }); },
    release() { open(); gate = null; },
    get text() { return text; }, set text(value: string) { text = value; },
  };
}
function setup(clipboard = memoryClipboard(), document?: SketchDocument) {
  const bridge: DesktopBridge = {
    platform: 'electron', openDocument: vi.fn<DesktopBridge['openDocument']>(async () => ({ status: 'cancelled' })),
    saveDocument: vi.fn<DesktopBridge['saveDocument']>(async () => ({ status: 'saved', file: { handleId: 'handle', name: 'test.sketchdraw.json', versionToken: 'v1' } })),
    exportFile: vi.fn<DesktopBridge['exportFile']>(async () => ({ status: 'cancelled' })),
    openExternal: vi.fn(async () => {}), onCloseRequested: () => () => {}, respondToClose: vi.fn(async () => {}), onMenuCommand: () => () => {},
  };
  const store = createWhiteboardStore({ bridge, clipboard, ...(document ? { controller: createController(document) } : {}) });
  store.setViewportSize(1000, 700); stores.push(store);
  return { store, clipboard };
}
const aws = builtInComponentSets.find((set) => set.id === 'sketchdraw.aws')!;

describe('page clipboard', () => {
  it('a page with a library component is pasted in the same and in another document, with its definition (#269)', async () => {
    const { store, clipboard } = setup();
    await store.insertComponent(aws, 'aws.compute.instance'); await store.whenIdle();
    const pageId = store.state.activePageId;
    await store.copyPage(pageId);
    expect(clipboard.text).toContain('aws.compute.instance');

    await store.pastePage(); await store.whenIdle();
    expect(store.state.notices.at(-1)?.kind).not.toBe('error');
    expect(store.state.document.pages).toHaveLength(2);
    const pasted = store.state.document.elements.filter((element) => element.pageId === store.state.document.pages[1]!.id);
    expect(pasted).toHaveLength(1);
    expect(pasted[0]).toMatchObject({ kind: 'component', componentType: 'aws.compute.instance' });
    // The definition was there already: it is neither doubled nor replaced.
    expect(store.state.document.componentSets.filter((set) => set.id === 'sketchdraw.aws')).toHaveLength(1);

    // Another document knows nothing about AWS yet; the page brings the definition along.
    const other = setup(clipboard);
    expect(other.store.state.document.componentSets).toHaveLength(0);
    await other.store.pastePage(); await other.store.whenIdle();
    expect(other.store.state.document.pages).toHaveLength(2);
    expect(other.store.state.document.componentSets.map((set) => set.id)).toEqual(['sketchdraw.aws']);
    expect(other.store.state.document.elements.find((element) => element.kind === 'component')).toMatchObject({ componentType: 'aws.compute.instance', pageId: other.store.state.document.pages[1]!.id });
    // One undo step removes the page and the definition it brought.
    other.store.undo(); await other.store.whenIdle();
    expect(other.store.state.document.pages).toHaveLength(1);
    expect(other.store.state.document.componentSets).toHaveLength(0);
  });

  it('still reads a page copied before definitions were carried along, and refuses a component without its definition', () => {
    const rectangle = createElement('rectangle', { id: 'el:1', text: 'Alt' });
    const old = JSON.stringify({ format: 'sketchdraw.page', version: 1, name: 'Alte Seite', elements: [rectangle], assets: {} });
    expect(parsePageClipboard(old)).toMatchObject({ name: 'Alte Seite', componentSets: [] });
    const orphan = JSON.stringify({ format: 'sketchdraw.page', version: 1, name: 'Ohne Definition', elements: [createElement('component', { id: 'el:2', componentType: 'aws.compute.instance' })], assets: {} });
    expect(parsePageClipboard(orphan)).toBeNull();
  });

  it('a paste that started in one document does not write into the document opened meanwhile (#274)', async () => {
    const source = createDocument('A'); source.pages[0]!.name = 'Diagramm aus A';
    source.elements = [{ ...createElement('rectangle', { id: 'el:a', text: 'aus A' }), pageId: source.pages[0]!.id }];
    const { store, clipboard } = setup(memoryClipboard(), source);
    await store.copyPage(store.state.activePageId);
    await store.save();
    const documentA = store.state.document.id;

    clipboard.hold();
    const pending = store.pastePage();
    await store.newDocument(); await store.whenIdle();
    const documentB = store.state.document.id;
    expect(documentB).not.toBe(documentA);
    expect(store.state.document.pages).toHaveLength(1);

    clipboard.release(); await pending; await store.whenIdle();
    expect(store.state.document.id).toBe(documentB);
    expect(store.state.document.pages).toHaveLength(1);
    expect(store.state.document.elements).toHaveLength(0);

    // In the document that is open, pasting works as before.
    await store.pastePage(); await store.whenIdle();
    expect(store.state.document.pages.map((page) => page.name)).toContain('Diagramm aus A');
  });
});
