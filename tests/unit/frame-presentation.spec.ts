import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FRAME_ORDER_METADATA_KEY,
  createDocument,
  createElement,
  deserializeDocument,
  frameOrderMetadata,
  orderedFrames,
  serializeDocument,
  type DesktopBridge,
} from '@/domain';
import { formatDiagram, parseDiagram } from '@/codec';
import { prepareDrawioExport, prepareSvgExport } from '@/interop';
import { createWhiteboardStore } from '@/renderer/state/whiteboard';
import { hitElement } from '@/renderer/lib/geometry';
import type { PointerInput, WhiteboardStore } from '@/renderer/state/contract';

const stores: WhiteboardStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.dispose(); });

const bridge: DesktopBridge = {
  platform: 'electron',
  openDocument: vi.fn<DesktopBridge['openDocument']>(async () => ({ status: 'cancelled' })),
  saveDocument: vi.fn<DesktopBridge['saveDocument']>(async () => ({ status: 'cancelled' })),
  exportFile: vi.fn<DesktopBridge['exportFile']>(async () => ({ status: 'cancelled' })),
  openExternal: vi.fn(async () => {}),
  onCloseRequested: () => () => {},
  respondToClose: vi.fn(async () => {}),
  onMenuCommand: () => () => {},
};
const point = (x: number, y: number): PointerInput => ({ x, y, button: 0, pointerType: 'mouse', shiftKey: false, altKey: false, metaOrCtrl: false, detail: 1 });

describe('frame slides and presenter state', () => {
  it('keeps a deterministic frame order without creating parent relationships', () => {
    const document = createDocument('Slides');
    const first = createElement('frame', { id: 'frame:first', label: 'Intro', x: 0, y: 0, width: 1280, height: 720 });
    const content = createElement('rectangle', { id: 'shape:one', x: 80, y: 80, width: 200, height: 120 });
    const second = createElement('frame', { id: 'frame:second', label: 'Architektur', x: 1400, y: 0, width: 1280, height: 720 });
    document.elements = [first, content, second];
    document.metadata[FRAME_ORDER_METADATA_KEY] = frameOrderMetadata(['frame:second', 'missing', 'frame:first'])!;

    expect(orderedFrames(document).map((frame) => frame.id)).toEqual(['frame:second', 'frame:first']);
    expect(content.parentId).toBeUndefined();
    expect(hitElement(first, { x: 640, y: 360 }, 8)).toBe(false);
    expect(hitElement(first, { x: 2, y: 360 }, 8)).toBe(true);
    expect(deserializeDocument(serializeDocument(document)).metadata[FRAME_ORDER_METADATA_KEY]).toBe('["frame:second","missing","frame:first"]');
    const parsed = parseDiagram(formatDiagram(document));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(orderedFrames(parsed.document).map((frame) => frame.id)).toEqual(['frame:second', 'frame:first']);
  });

  it('creates, renames, reorders and presents frames through the shared authority', async () => {
    const store = createWhiteboardStore({ bridge }); stores.push(store);
    store.setTool('frame');
    store.pointerDown(point(100, 120)); store.pointerMove(point(740, 480)); store.pointerUp(point(740, 480));
    await store.whenIdle();
    const first = store.state.frameSlides[0]!;
    expect(first).toMatchObject({ kind: 'frame', label: 'Folie 1', x: 100, y: 120, width: 640, height: 360 });
    expect(store.state.frameSidebarOpen).toBe(true);

    store.duplicateSelection(); await store.whenIdle();
    const second = store.state.frameSlides.find((frame) => frame.id !== first.id)!;
    store.renameFrame(second.id, 'Folie 2'); await store.whenIdle();
    store.renameFrame(first.id, 'Einführung'); await store.whenIdle();
    store.moveFrame(second.id, 0); await store.whenIdle();
    expect(store.state.frameSlides.map((frame) => [frame.id, frame.label])).toEqual([[second.id, 'Folie 2'], [first.id, 'Einführung']]);
    expect(store.state.document.metadata[FRAME_ORDER_METADATA_KEY]).toBe(JSON.stringify([second.id, first.id]));

    store.startPresentation(first.id);
    expect(store.state.presenterOpen).toBe(true);
    expect(store.state.presenterIndex).toBe(1);
    store.goToPresentation(0); expect(store.state.presenterIndex).toBe(0);
    store.goToPresentation(99); expect(store.state.presenterIndex).toBe(1);
    store.stopPresentation(); expect(store.state.presenterOpen).toBe(false);
    expect(store.handleKeyDown({ key: 'P', code: 'KeyP', shiftKey: true, altKey: true, ctrlKey: false, metaKey: false, repeat: false, isComposing: false, scope: 'canvas' })).toBe(true);
    expect(store.state.presenterOpen).toBe(true);
    store.stopPresentation();

    store.select([second.id]); store.deleteSelection(); await store.whenIdle();
    expect(store.state.frameSlides.map((frame) => frame.id)).toEqual([first.id]);
    expect(store.state.document.metadata[FRAME_ORDER_METADATA_KEY]).toBe(JSON.stringify([first.id]));
  });

  it('exports frame viewports as editable outlines while preserving native semantics', () => {
    const document = createDocument('Frame export');
    document.elements = [createElement('frame', { id: 'frame:one', label: 'Release', width: 1280, height: 720 })];
    document.metadata[FRAME_ORDER_METADATA_KEY] = frameOrderMetadata(['frame:one'])!;
    const svg = prepareSvgExport(document);
    const drawio = prepareDrawioExport(document);
    expect(svg.contents).toContain('data-sketchdraw-kind="frame"');
    expect(drawio.contents).toContain('sketchdrawKind=frame');
    expect(svg.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'FRAME_PROJECTED_AS_VIEWPORT', severity: 'info' })]));
    expect(drawio.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'FRAME_PROJECTED_AS_VIEWPORT', severity: 'info' })]));
  });
});
