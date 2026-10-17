import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  createController,
  createDocument,
  createElement,
  type DesktopBridge,
  type SketchAsset,
} from '@/domain';
import { bounds } from '@/renderer/lib/geometry';
import { resolveShortcut } from '@/renderer/lib/shortcuts';
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
    expect(store.state.notices.at(-1)?.text).toContain('keine Sketchdraw-Elemente');

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
});
