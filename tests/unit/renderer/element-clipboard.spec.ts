import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  applyCommand,
  createController,
  createDocument,
  createElement,
  type DesktopBridge,
  type SketchAsset,
} from '@/domain';
import { bounds } from '@/renderer/lib/geometry';
import { resolveShortcut } from '@/renderer/lib/shortcuts';
import { elementClipboardPayload, parseElementClipboard } from '@/renderer/state/element-clipboard';
import { createWhiteboardStore } from '@/renderer/state/whiteboard';
import type { KeyInput, PointerInput, TextClipboard, WhiteboardStore } from '@/renderer/state/contract';

const stores: WhiteboardStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.dispose(); });

const pointer = (x: number, y: number): PointerInput => ({
  x, y, button: 0, pointerType: 'mouse', shiftKey: false, altKey: false, metaOrCtrl: false, detail: 0,
});
const key = (letter: string, scope: KeyInput['scope']): KeyInput => ({
  key: letter, code: `Key${letter.toUpperCase()}`, shiftKey: false, altKey: false,
  ctrlKey: true, metaKey: false, repeat: false, isComposing: false, scope,
});
const bridge: DesktopBridge = {
  platform: 'electron',
  openDocument: vi.fn<DesktopBridge['openDocument']>(async () => ({ status: 'cancelled' })),
  saveDocument: vi.fn<DesktopBridge['saveDocument']>(async () => ({ status: 'cancelled' })),
  exportFile: vi.fn<DesktopBridge['exportFile']>(async () => ({ status: 'cancelled' })),
  openExternal: vi.fn(async () => {}), onCloseRequested: () => () => {},
  respondToClose: vi.fn(async () => {}), onMenuCommand: () => () => {},
};

function fixture() {
  const document = createDocument('Clipboard');
  const asset: SketchAsset = {
    id: 'asset:source', mimeType: 'image/png', name: 'pixel.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS9sAAAAASUVORK5CYII=',
  };
  const container = createElement('container', { id: 'container:source', x: 100, y: 100, width: 300, height: 300 });
  const child = createElement('rectangle', { id: 'rectangle:child', x: 140, y: 150, width: 100, height: 60, parentId: container.id });
  const image = createElement('image', { id: 'image:child', x: 180, y: 250, width: 80, height: 80, parentId: container.id, assetId: asset.id });
  const target = createElement('ellipse', { id: 'ellipse:source', x: 500, y: 160, width: 120, height: 80 });
  const connector = createElement('connector', {
    id: 'connector:source', x: 240, y: 180, width: 260, height: 20,
    points: [{ x: 0, y: 0 }, { x: 260, y: 20 }],
    from: { elementId: child.id, anchor: { x: 1, y: .5 } },
    to: { elementId: target.id, anchor: { x: 0, y: .5 } },
  });
  document.assets = { [asset.id]: asset };
  document.elements = [container, child, image, target, connector];
  return { document, container, target };
}

describe('element clipboard', () => {
  test('pastes a closed selection graph at the last mouse position in one undo step', async () => {
    const { document, container, target } = fixture();
    let clipboardText = '';
    const clipboard: TextClipboard = {
      writeText: vi.fn(async (value) => { clipboardText = value; }),
      readText: vi.fn(async () => clipboardText),
    };
    const store = createWhiteboardStore({ bridge, clipboard, controller: createController(document), isMac: false });
    stores.push(store);
    store.select([container.id, target.id]);
    store.pointerMove(pointer(820, 610));

    await store.copySelection();
    expect(JSON.parse(clipboardText)).toMatchObject({ format: 'sketchdraw.elements', version: 1 });
    await store.pasteSelection();
    await store.whenIdle();

    const sourceIds = new Set(document.elements.map((element) => element.id));
    const copies = store.state.document.elements.filter((element) => !sourceIds.has(element.id));
    expect(copies).toHaveLength(5);
    expect(store.state.selection).toEqual(copies.map((element) => element.id));
    const copyBounds = bounds(copies)!;
    expect(copyBounds.x + copyBounds.width / 2).toBeCloseTo(820);
    expect(copyBounds.y + copyBounds.height / 2).toBeCloseTo(610);

    const copiedContainer = copies.find((element) => element.kind === 'container')!;
    const copiedChild = copies.find((element) => element.kind === 'rectangle')!;
    const copiedImage = copies.find((element) => element.kind === 'image')!;
    const copiedTarget = copies.find((element) => element.kind === 'ellipse')!;
    const copiedConnector = copies.find((element) => element.kind === 'connector')!;
    expect(copiedChild.parentId).toBe(copiedContainer.id);
    expect(copiedImage.parentId).toBe(copiedContainer.id);
    expect(copiedImage.assetId).not.toBe('asset:source');
    expect(store.state.document.assets[copiedImage.assetId!]).toEqual(expect.objectContaining({ name: 'pixel.png' }));
    expect(new Set([copiedConnector.from?.elementId, copiedConnector.to?.elementId])).toEqual(new Set([copiedChild.id, copiedTarget.id]));

    store.undo(); await store.whenIdle();
    expect(store.state.document.elements).toHaveLength(5);
    expect(Object.keys(store.state.document.assets)).toEqual(['asset:source']);
    store.redo(); await store.whenIdle();
    expect(store.state.document.elements).toHaveLength(10);
    expect(Object.keys(store.state.document.assets)).toHaveLength(2);
  });

  test('rejects foreign clipboard text and preserves native text-field copy and paste', async () => {
    const { document, container } = fixture();
    const clipboard: TextClipboard = { writeText: vi.fn(async () => {}), readText: vi.fn(async () => 'plain text') };
    const store = createWhiteboardStore({ bridge, clipboard, controller: createController(document), isMac: false });
    stores.push(store);
    store.select([container.id]);
    await store.pasteSelection();
    expect(store.state.document.elements).toHaveLength(5);
    expect(store.state.notices.at(-1)?.text).toBe('Die Zwischenablage enthält weder Sketchdraw-Elemente noch ein Bild.');

    expect(resolveShortcut(key('c', 'canvas'), false)).toBe('edit.copy');
    expect(resolveShortcut(key('v', 'canvas'), false)).toBe('edit.paste');
    expect(resolveShortcut(key('c', 'text'), false)).toBeNull();
    expect(resolveShortcut(key('v', 'text'), false)).toBeNull();
  });

  test('uses the in-process clipboard when system clipboard writing is unavailable', async () => {
    const document = createDocument('Fallback');
    document.elements = [createElement('rectangle', { id: 'rectangle:source', x: 100, y: 100 })];
    const clipboard: TextClipboard = {
      writeText: vi.fn(async () => { throw new Error('permission denied'); }),
      readText: vi.fn(async () => 'stale external clipboard'),
    };
    const store = createWhiteboardStore({ bridge, clipboard, controller: createController(document) });
    stores.push(store);
    store.select(['rectangle:source']);
    store.pointerMove(pointer(500, 400));
    await store.copySelection();
    await store.pasteSelection();
    expect(store.state.document.elements).toHaveLength(2);
    expect(clipboard.readText).not.toHaveBeenCalled();
    expect(store.state.notices.some((notice) => notice.text === '1 Element intern kopiert.')).toBe(true);
  });

  // Clipboard events (#174): copy and paste through the event's data, which needs no permission and carries images.
  test('a copy event receives the selection and a paste event with that text pastes it at the pointer', async () => {
    const { document, container, target } = fixture();
    const clipboard: TextClipboard = { writeText: vi.fn(async () => { throw new Error('permission denied'); }), readText: vi.fn(async () => { throw new Error('permission denied'); }) };
    const store = createWhiteboardStore({ bridge, clipboard, controller: createController(document), isMac: false });
    stores.push(store);
    const written = new Map<string, string>();
    const sink = { setData: (format: string, value: string) => { written.set(format, value); } };

    // Nothing selected: the event stays with the browser.
    expect(store.copyToClipboardData(sink)).toBe(false);
    expect(written.size).toBe(0);

    store.select([container.id, target.id]);
    store.pointerMove(pointer(820, 610));
    expect(store.copyToClipboardData(sink)).toBe(true);
    expect([...written.keys()]).toEqual(['text/plain']);
    expect(JSON.parse(written.get('text/plain')!)).toMatchObject({ format: 'sketchdraw.elements', version: 1 });
    expect(store.state.notices.at(-1)?.text).toBe('5 Elemente kopiert.');

    await store.pasteClipboardData({ text: written.get('text/plain')!, image: null });
    await store.whenIdle();
    const sourceIds = new Set(document.elements.map((element) => element.id));
    const copies = store.state.document.elements.filter((element) => !sourceIds.has(element.id));
    expect(copies).toHaveLength(5);
    expect(store.state.selection).toEqual(copies.map((element) => element.id));
    const copyBounds = bounds(copies)!;
    expect(copyBounds.x + copyBounds.width / 2).toBeCloseTo(820);
    expect(copyBounds.y + copyBounds.height / 2).toBeCloseTo(610);
    // The permission-bound clipboard API was never needed.
    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(clipboard.readText).not.toHaveBeenCalled();
  });

  test('a paste event with an image inserts it at the pointer; Sketchdraw elements in the text win over an image', async () => {
    const { document, target } = fixture();
    const clipboard: TextClipboard = { writeText: vi.fn(async () => {}), readText: vi.fn(async () => '') };
    const store = createWhiteboardStore({ bridge, clipboard, controller: createController(document), isMac: false });
    stores.push(store);
    const insert = vi.spyOn(store, 'insertImageFile').mockResolvedValue();
    const image = new File([new Uint8Array([1, 2, 3])], 'image.png', { type: 'image/png' });
    store.pointerMove(pointer(300, 200));

    await store.pasteClipboardData({ text: 'Tabellentext aus einer anderen App', image });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0]![0]).toBe(image);
    expect(insert.mock.calls[0]![1]).toEqual({ x: 300, y: 200 });
    expect(store.state.document.elements).toHaveLength(5);

    // Without a pointer position yet, the image lands in the middle of the view.
    const fresh = createWhiteboardStore({ bridge, clipboard, controller: createController(createDocument('Leer')), isMac: false });
    stores.push(fresh);
    fresh.setViewportSize(1000, 600);
    const insertFresh = vi.spyOn(fresh, 'insertImageFile').mockResolvedValue();
    await fresh.pasteClipboardData({ text: '', image });
    expect(insertFresh.mock.calls[0]![1]).toEqual({ x: 500, y: 300 });

    const written = new Map<string, string>();
    store.select([target.id]);
    store.copyToClipboardData({ setData: (format, value) => { written.set(format, value); } });
    await store.pasteClipboardData({ text: written.get('text/plain')!, image });
    await store.whenIdle();
    expect(insert).toHaveBeenCalledTimes(1);
    expect(store.state.document.elements).toHaveLength(6);

    // Neither elements nor an image: nothing changes and the notice says so.
    await store.pasteClipboardData({ text: 'nur Text', image: null });
    expect(store.state.document.elements).toHaveLength(6);
    expect(store.state.notices.at(-1)).toMatchObject({ kind: 'error', text: 'Die Zwischenablage enthält weder Sketchdraw-Elemente noch ein Bild.' });
  });

  test('an internal copy that could not reach the system clipboard is pasted before stale event content', async () => {
    const document = createDocument('Fallback');
    document.elements = [createElement('rectangle', { id: 'rectangle:source', x: 100, y: 100 })];
    const clipboard: TextClipboard = { writeText: vi.fn(async () => { throw new Error('permission denied'); }), readText: vi.fn(async () => '') };
    const store = createWhiteboardStore({ bridge, clipboard, controller: createController(document) });
    stores.push(store);
    const insert = vi.spyOn(store, 'insertImageFile').mockResolvedValue();
    const stale = new File([new Uint8Array([1])], 'alt.png', { type: 'image/png' });
    store.select(['rectangle:source']);
    await store.copySelection();
    await store.pasteClipboardData({ text: '', image: stale });
    await store.whenIdle();
    expect(store.state.document.elements).toHaveLength(2);
    expect(insert).not.toHaveBeenCalled();
    // That preference holds once; afterwards the event content counts again.
    await store.pasteClipboardData({ text: '', image: stale });
    expect(insert).toHaveBeenCalledTimes(1);
  });

  test('the key press is left to the clipboard event where the component announces such events', async () => {
    const { document, container } = fixture();
    const clipboard: TextClipboard = { writeText: vi.fn(async () => {}), readText: vi.fn(async () => '') };
    const store = createWhiteboardStore({ bridge, clipboard, controller: createController(document), isMac: false });
    stores.push(store);
    store.select([container.id]);
    expect(store.handleKeyDown({ ...key('c', 'canvas'), clipboardEvents: true })).toBe(false);
    expect(store.handleKeyDown({ ...key('v', 'canvas'), clipboardEvents: true })).toBe(false);
    await store.whenIdle();
    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(clipboard.readText).not.toHaveBeenCalled();
    // Other shortcuts are unaffected, and without the announcement the key still copies.
    expect(store.handleKeyDown({ ...key('a', 'canvas'), clipboardEvents: true })).toBe(true);
    expect(store.handleKeyDown(key('c', 'canvas'))).toBe(true);
    await store.whenIdle();
    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
  });

  test('copies and pastes on pages whose ID is not the default one (#185)', async () => {
    // A document like the reference diagrams: no page is called "page:1".
    let document = createDocument('Pages');
    document = applyCommand(document, { type: 'add-page', page: { id: 'page:traefik', name: 'Traefik' } });
    document = applyCommand(document, { type: 'add-page', page: { id: 'page:workflow', name: 'Workflow' } });
    document = applyCommand(document, { type: 'delete-page', pageId: document.pages[0]!.id });
    document = applyCommand(document, { type: 'add', elements: [createElement('ellipse', { id: 'ellipse:source', pageId: 'page:workflow', x: 100, y: 100, width: 120, height: 80 })] });
    expect(document.pages.map((page) => page.id)).toEqual(['page:traefik', 'page:workflow']);

    const text = JSON.stringify(elementClipboardPayload(document, ['ellipse:source']));
    expect(parseElementClipboard(text)?.elements).toHaveLength(1);
    // The check stays complete: a broken element is still refused.
    const broken = JSON.parse(text) as { elements: Array<Record<string, unknown>> };
    broken.elements[0]!.width = -5;
    expect(parseElementClipboard(JSON.stringify(broken))).toBeNull();
    expect(parseElementClipboard(JSON.stringify({ ...JSON.parse(text), elements: ['nonsense'] }))).toBeNull();

    let clipboardText = '';
    const clipboard: TextClipboard = { writeText: vi.fn(async (value) => { clipboardText = value; }), readText: vi.fn(async () => clipboardText) };
    const store = createWhiteboardStore({ bridge, clipboard, controller: createController(document), isMac: false });
    stores.push(store);
    store.selectPage('page:workflow');
    store.select(['ellipse:source']);
    await store.copySelection();
    await store.pasteSelection();
    await store.whenIdle();
    expect(store.state.notices.filter((notice) => notice.kind === 'error')).toEqual([]);
    expect(store.state.document.elements.map((element) => [element.kind, element.pageId])).toEqual([['ellipse', 'page:workflow'], ['ellipse', 'page:workflow']]);

    // Copied on one page and pasted on another, the copy lands on the page on screen.
    store.selectPage('page:traefik');
    await store.pasteSelection();
    await store.whenIdle();
    expect(store.state.document.elements.filter((element) => element.pageId === 'page:traefik')).toHaveLength(1);
  });
});
