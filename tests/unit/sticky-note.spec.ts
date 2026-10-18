import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDocument, createElement, deserializeDocument, DomainValidationError, serializeDocument,
  type DesktopBridge,
} from '@/domain';
import { importDrawio, importSvg, prepareDrawioExport, prepareSvgExport } from '@/interop';
import { createWhiteboardStore } from '@/renderer/state/whiteboard';
import type { PointerInput, WhiteboardStore } from '@/renderer/state/contract';

const stores: WhiteboardStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.dispose(); });

const point = (x: number, y: number): PointerInput => ({
  x, y, button: 0, pointerType: 'mouse', shiftKey: false, altKey: false, metaOrCtrl: false, detail: 1,
});

function setup(): WhiteboardStore {
  const bridge: DesktopBridge = {
    platform: 'electron',
    openDocument: vi.fn<DesktopBridge['openDocument']>(async () => ({ status: 'cancelled' })),
    saveDocument: vi.fn<DesktopBridge['saveDocument']>(async () => ({ status: 'cancelled' })),
    exportFile: vi.fn<DesktopBridge['exportFile']>(async () => ({ status: 'cancelled' })),
    openExternal: vi.fn(async () => {}),
    onCloseRequested: () => () => {}, respondToClose: vi.fn(async () => {}), onMenuCommand: () => () => {},
  };
  const store = createWhiteboardStore({ bridge, authorName: 'Jeremy Teichmann' });
  stores.push(store);
  return store;
}

describe('sticky-note domain and store', () => {
  it('validates and serializes note author and text formatting without allowing author on other kinds', () => {
    const note = createElement('sticky-note', {
      id: 'note:one', text: 'Plan', author: 'Jeremy Teichmann',
      style: { ...createElement('sticky-note').style, fill: '#aeeebd', fontWeight: 'bold', textDecoration: 'line-through', listStyle: 'bullet' },
    });
    const document = createDocument('Notes'); document.elements = [note];
    expect(deserializeDocument(serializeDocument(document)).elements[0]).toEqual(note);
    expect(() => createElement('rectangle', { author: 'Invalid' })).toThrow(DomainValidationError);
  });

  it('creates a 240px note, edits text and style atomically, then quick-connects a clean note copy', async () => {
    const store = setup();
    store.setTool('sticky-note'); store.pointerDown(point(300, 200)); store.pointerUp(point(300, 200));
    await store.whenIdle();
    const note = store.state.document.elements[0]!;
    expect(note).toMatchObject({ kind: 'sticky-note', width: 240, height: 240, author: 'Jeremy Teichmann', text: '' });
    expect(note.style.fill).toBe('#aeeebd');
    expect(store.state.textEdit?.elementId).toBe(note.id);

    store.setTextDraft('Plan\nReview');
    store.setPropertyDraft({ style: { fontWeight: 'bold', textDecoration: 'line-through', listStyle: 'bullet' } });
    expect(store.commitTextEdit()).toBe(true); await store.whenIdle();
    expect(store.state.document.elements[0]).toMatchObject({ text: 'Plan\nReview', style: { fontWeight: 'bold', textDecoration: 'line-through', listStyle: 'bullet' } });
    expect(store.state.handles.map(handle => handle.id)).toContain('rotate');

    store.quickConnect('right'); await store.whenIdle();
    const notes = store.state.document.elements.filter(element => element.kind === 'sticky-note');
    const connector = store.state.document.elements.find(element => element.kind === 'connector')!;
    expect(notes).toHaveLength(2);
    expect(notes[1]).toMatchObject({ text: '', author: 'Jeremy Teichmann' });
    expect(connector.from?.elementId).toBe(notes[0]!.id);
    expect(connector.to?.elementId).toBe(notes[1]!.id);
  });

  it('creates one linked task from a note, persists it and detaches it when the note is deleted', async () => {
    const store = setup();
    store.setTool('sticky-note'); store.pointerDown(point(300, 200)); store.pointerUp(point(300, 200));
    await store.whenIdle();
    const note = store.state.document.elements[0]!;
    store.setTextDraft('Release planen\nInstaller prüfen');
    expect(store.commitTextEdit()).toBe(true); await store.whenIdle();

    expect(await store.createTaskFromStickyNote(note.id)).toBe(true);
    expect(await store.createTaskFromStickyNote(note.id)).toBe(false);
    expect(store.state.document.tasks).toEqual([expect.objectContaining({
      sourceElementId: note.id,
      title: 'Release planen',
      description: 'Release planen\nInstaller prüfen',
      status: 'todo',
    })]);
    expect(deserializeDocument(serializeDocument(store.state.document)).tasks).toEqual(store.state.document.tasks);

    store.undo(); await store.whenIdle();
    expect(store.state.document.tasks).toEqual([]);
    store.redo(); await store.whenIdle();
    expect(store.state.document.tasks).toHaveLength(1);

    store.deleteSelection(); await store.whenIdle();
    expect(store.state.document.elements).toHaveLength(0);
    expect(store.state.document.tasks).toEqual([expect.not.objectContaining({ sourceElementId: expect.anything() })]);
  });
});

describe('sticky-note interoperability', () => {
  it('exports visible SVG and native draw.io notes while preserving an exact embedded round-trip', () => {
    const document = createDocument('Notes');
    document.elements = [createElement('sticky-note', {
      id: 'note:one', x: 20, y: 30, width: 240, height: 240, text: 'Plan\nReview', author: 'Jeremy Teichmann', documentationUrl: 'https://example.com/note',
      style: { ...createElement('sticky-note').style, fill: '#aeeebd', stroke: '#53675a', fontWeight: 'bold', textDecoration: 'line-through', listStyle: 'bullet' },
    })];
    const before = serializeDocument(document);
    const svg = prepareSvgExport(document).contents;
    const drawio = prepareDrawioExport(document).contents;
    expect(svg).toContain('feDropShadow');
    expect(svg).toContain('Jeremy Teichmann');
    expect(svg).toContain('font-weight="bold"');
    expect(drawio).toContain('shape=note');
    expect(drawio).toContain('sketchdrawAuthor=Jeremy%20Teichmann');
    expect(serializeDocument(importSvg(svg).document)).toBe(before);
    expect(serializeDocument(importDrawio(drawio).document)).toBe(before);

    const native = importDrawio(prepareDrawioExport(document, { embedDocument: false }).contents).document.elements[0]!;
    expect(native).toMatchObject({ kind: 'sticky-note', text: 'Plan\nReview', author: 'Jeremy Teichmann', style: { fontWeight: 'bold', textDecoration: 'line-through', listStyle: 'bullet' } });
  });
});
