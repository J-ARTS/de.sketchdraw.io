import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  annotationPlainText,
  applyCommand,
  createController,
  createDocument,
  createElement,
  deserializeDocument,
  DomainValidationError,
  serializeDocument,
  type AnnotationDocument,
  type DesktopBridge,
} from '@/domain';
import { formatDiagram, parseDiagram } from '@/codec';
import { importDrawio, importSvg, prepareDrawioExport, prepareSvgExport } from '@/interop';
import { createWhiteboardStore } from '@/renderer/state/whiteboard';
import type { PointerInput, WhiteboardStore } from '@/renderer/state/contract';

const richContent: AnnotationDocument = {
  version: 1,
  blocks: [
    { type: 'heading-1', runs: [{ text: 'Synchronization ', bold: true }, { text: 'Orchestration', color: '#2563eb' }] },
    { type: 'paragraph', runs: [{ text: 'A pipeline is ' }, { text: 'scheduled', italic: true, underline: true }, { text: ' to execute.' }] },
    { type: 'bullet', runs: [{ text: 'Safe structured content' }] },
    { type: 'numbered', runs: [{ text: 'Editable by humans and agents' }] },
    { type: 'quote', runs: [{ text: 'Everything remains understandable.' }] },
  ],
};

const stores: WhiteboardStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.dispose(); });

const point = (x: number, y: number): PointerInput => ({ x, y, button: 0, pointerType: 'mouse', shiftKey: false, altKey: false, metaOrCtrl: false, detail: 1 });

function setup(): WhiteboardStore {
  const bridge: DesktopBridge = {
    platform: 'electron',
    openDocument: vi.fn<DesktopBridge['openDocument']>(async () => ({ status: 'cancelled' })),
    saveDocument: vi.fn<DesktopBridge['saveDocument']>(async () => ({ status: 'cancelled' })),
    exportFile: vi.fn<DesktopBridge['exportFile']>(async () => ({ status: 'cancelled' })),
    openExternal: vi.fn(async () => {}),
    onCloseRequested: () => () => {}, respondToClose: vi.fn(async () => {}), onMenuCommand: () => () => {},
  };
  const store = createWhiteboardStore({ bridge });
  stores.push(store);
  return store;
}

describe('annotation domain contract', () => {
  it('stores formatted blocks safely and rejects raw or inconsistent state', () => {
    const annotation = createElement('annotation', { id: 'annotation:one', annotation: richContent });
    expect(annotation).toMatchObject({ kind: 'annotation', width: 520, height: 320, text: annotationPlainText(richContent) });
    expect(annotation.annotation).toEqual(richContent);

    expect(() => createElement('rectangle', { annotation: richContent })).toThrow(DomainValidationError);
    expect(() => createElement('annotation', { annotation: { ...richContent, blocks: [{ type: 'paragraph', runs: [{ text: 'Unsafe', color: 'javascript:red' }] }] } })).toThrow(DomainValidationError);
    expect(() => createElement('annotation', { annotation: richContent, text: 'stale fallback' })).toThrow(DomainValidationError);
    expect(() => createElement('annotation', { annotation: { version: 1, blocks: [null] } as unknown as AnnotationDocument })).toThrow(DomainValidationError);
  });

  it('round-trips through JSON, Diagram as Code, commands and undo without losing runs', () => {
    const document = createDocument('Annotations');
    document.elements = [createElement('annotation', { id: 'annotation:one', annotation: richContent })];
    const serialized = serializeDocument(document);
    expect(deserializeDocument(serialized)).toEqual(document);

    const source = formatDiagram(document);
    const parsed = parseDiagram(source);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('Diagram as Code parse failed.');
    expect(serializeDocument(parsed.document)).toBe(serialized);

    const changed: AnnotationDocument = { version: 1, blocks: [{ type: 'heading-2', runs: [{ text: 'Changed', bold: true }] }] };
    const updated = applyCommand(document, { type: 'update', changes: [{ id: 'annotation:one', patch: { annotation: changed, text: annotationPlainText(changed) } }] });
    expect(updated.elements[0]?.annotation).toEqual(changed);
    const controller = createController(document);
    controller.dispatch({ type: 'update', changes: [{ id: 'annotation:one', patch: { annotation: changed, text: annotationPlainText(changed) } }] }, { actorId: 'local', expectedRevision: 0, source: 'human' });
    expect(controller.undo('local').document.elements[0]?.annotation).toEqual(richContent);
  });

  it('creates, edits and copies annotations through the whiteboard command path', async () => {
    const store = setup();
    store.setTool('annotation'); store.pointerDown(point(220, 180)); store.pointerUp(point(220, 180));
    await store.whenIdle();
    const annotation = store.state.document.elements[0]!;
    expect(annotation).toMatchObject({ kind: 'annotation', width: 520, height: 320 });
    expect(store.state.textEdit?.kind).toBe('annotation');

    store.setAnnotationDraft(richContent, annotationPlainText(richContent));
    expect(store.commitTextEdit()).toBe(true); await store.whenIdle();
    expect(store.state.document.elements[0]?.annotation).toEqual(richContent);

    store.select([annotation.id]); await store.copySelection(); await store.pasteSelection(); await store.whenIdle();
    const annotations = store.state.document.elements.filter((element) => element.kind === 'annotation');
    expect(annotations).toHaveLength(2);
    expect(annotations[1]?.annotation).toEqual(richContent);
  });
});

describe('annotation interoperability', () => {
  it('exports formatted SVG and native draw.io while retaining the exact embedded model', () => {
    const document = createDocument('Annotations');
    document.elements = [createElement('annotation', { id: 'annotation:one', x: 20, y: 30, annotation: richContent })];
    const before = serializeDocument(document);
    const svg = prepareSvgExport(document).contents;
    const drawio = prepareDrawioExport(document).contents;
    expect(svg).toContain('annotation-shadow');
    expect(svg).toContain('font-style="italic"');
    expect(svg).toContain('text-decoration="underline"');
    expect(drawio).toContain('sketchdrawKind=annotation');
    expect(serializeDocument(importSvg(svg).document)).toBe(before);
    expect(serializeDocument(importDrawio(drawio).document)).toBe(before);

    const native = importDrawio(prepareDrawioExport(document, { embedDocument: false }).contents).document.elements[0]!;
    expect(native.kind).toBe('annotation');
    expect(native.text).toBe(annotationPlainText(richContent));
  });
});
