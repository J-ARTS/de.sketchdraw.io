import { afterEach, describe, expect, test, vi } from 'vitest';
import { alignedTextTop, createDocument, createElement, supportsVerticalAlign, validateDocument, verticalAlignOf, verticalTextInset, type DesktopBridge, type ElementStyle } from '@/domain';
import { createWhiteboardStore } from '@/renderer/state/whiteboard';
import type { PointerInput, WhiteboardStore } from '@/renderer/state/contract';
import { fittedTextHeight, freeTextHeight, hasFittedTextHeight } from '@/renderer/lib/text-metrics';
import { formatDiagram, parseDiagram } from '@/codec';
import { importDrawio, prepareDrawioExport } from '@/interop';
import { drawioProjectionForValidation } from '@/interop/export';

// #296: text stands at the top, in the middle or at the bottom of its element; new elements start centred.
const stores: WhiteboardStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.dispose(); });
function setup() {
  const bridge: DesktopBridge = {
    platform: 'electron', openDocument: vi.fn(async () => ({ status: 'cancelled' as const })),
    saveDocument: vi.fn(async () => ({ status: 'saved' as const, file: { handleId: 'h', name: 't.sketchdraw.json', versionToken: 'v1' } })),
    exportFile: vi.fn(async () => ({ status: 'exported' as const, name: 't.sketchdraw.json' })),
    openExternal: vi.fn(async () => {}), onCloseRequested: () => () => {},
    respondToClose: vi.fn(async () => {}), onMenuCommand: () => () => {},
  };
  const store = createWhiteboardStore({ bridge }); stores.push(store);
  return store;
}
const point = (x: number, y: number): PointerInput => ({ x, y, button: 0, pointerType: 'mouse', shiftKey: false, altKey: false, metaOrCtrl: false, detail: 1 });
const only = (store: WhiteboardStore) => store.state.document.elements[0]!;
async function typeText(store: WhiteboardStore, text: string) {
  store.setTool('text'); store.pointerDown(point(400, 300)); store.pointerUp(point(400, 300));
  store.setTextDraft(text); store.commitTextEdit(); await store.whenIdle();
  return only(store);
}

describe('where the text stands', () => {
  test('an element without the field keeps what its kind has always shown', () => {
    expect(verticalAlignOf({ kind: 'rectangle', style: {} })).toBe('middle');
    expect(verticalAlignOf({ kind: 'ellipse', style: {} })).toBe('middle');
    expect(verticalAlignOf({ kind: 'text', style: {} })).toBe('top');
    expect(verticalAlignOf({ kind: 'text', style: { verticalAlign: 'bottom' } })).toBe('bottom');
    expect(['text', 'rectangle', 'ellipse', 'diamond'].every((kind) => supportsVerticalAlign(kind as never))).toBe(true);
    expect(['sticky-note', 'container', 'component', 'table', 'connector'].some((kind) => supportsVerticalAlign(kind as never))).toBe(false);
  });

  test('top, middle and bottom of a shape, 4 px from the edge it rests on', () => {
    const inset = verticalTextInset('rectangle');
    expect(alignedTextTop('top', 100, 20, inset)).toBe(4);
    expect(alignedTextTop('middle', 100, 20, inset)).toBe(40);
    expect(alignedTextTop('bottom', 100, 20, inset)).toBe(76);
    // Text higher than its element starts at the top instead of leaving it upwards.
    expect(alignedTextTop('bottom', 30, 50, inset)).toBe(4);
    expect(alignedTextTop('middle', 30, 50, inset)).toBe(4);
  });

  test('free text has no edge distance', () => {
    expect(alignedTextTop('top', 80, 25, verticalTextInset('text'))).toBe(0);
    expect(alignedTextTop('middle', 80, 25, verticalTextInset('text'))).toBe(27.5);
    expect(alignedTextTop('bottom', 80, 25, verticalTextInset('text'))).toBe(55);
  });

  test('the document accepts the three values and nothing else', () => {
    const document = createDocument('Test');
    const rect = createElement('rectangle', { id: 'r', pageId: document.pages[0]!.id, style: { verticalAlign: 'bottom' } as ElementStyle });
    expect(rect.style.verticalAlign).toBe('bottom');
    expect(validateDocument({ ...document, elements: [rect] }).elements[0]!.style.verticalAlign).toBe('bottom');
    const broken = { ...document, elements: [{ ...rect, style: { ...rect.style, verticalAlign: 'center' } }] };
    expect(() => validateDocument(broken as never)).toThrow(/verticalAlign/);
  });
});

describe('diagram as code', () => {
  test('the alignment is written, read back and refused when it is no alignment', () => {
    const document = createDocument('Test');
    const rect = createElement('rectangle', { id: 'r', pageId: document.pages[0]!.id, text: 'API', style: { verticalAlign: 'bottom' } as ElementStyle });
    const source = formatDiagram({ ...document, elements: [rect] });
    expect(source).toContain('"verticalAlign":"bottom"');
    const read = parseDiagram(source);
    expect(read.ok && read.document.elements[0]!.style.verticalAlign).toBe('bottom');
    const refused = parseDiagram(source.replace('"verticalAlign":"bottom"', '"verticalAlign":"center"'));
    expect(refused.ok).toBe(false);
    // A line without the field stays without it.
    const plain = formatDiagram({ ...document, elements: [createElement('rectangle', { id: 'p', pageId: document.pages[0]!.id, text: 'API' })] });
    expect(plain).not.toContain('verticalAlign');
  });
});

describe('height of free text', () => {
  test('a box that fits its lines follows them, a box made higher keeps its height', () => {
    const fitted = { text: 'a', width: 240, height: fittedTextHeight('a', 240, 20), style: { fontSize: 20 } };
    expect(hasFittedTextHeight(fitted)).toBe(true);
    expect(freeTextHeight(fitted, 'a\nb', 240, 20)).toBe(fittedTextHeight('a\nb', 240, 20));
    expect(freeTextHeight(fitted, '', 240, 20)).toBe(fittedTextHeight('', 240, 20));
    const tall = { ...fitted, height: 120 };
    expect(hasFittedTextHeight(tall)).toBe(false);
    expect(freeTextHeight(tall, 'a\nb', 240, 20)).toBe(120);
    expect(freeTextHeight(tall, 'a\nb\nc\nd\ne\nf', 240, 20)).toBe(fittedTextHeight('a\nb\nc\nd\ne\nf', 240, 20));
    expect(freeTextHeight(null, 'a', 240, 20)).toBe(fittedTextHeight('a', 240, 20));
  });
});

describe('new elements start centred', () => {
  test('text typed on the canvas is centred across and down, around the place of the click', async () => {
    const store = setup();
    store.setTool('text'); store.pointerDown(point(400, 300)); store.pointerUp(point(400, 300));
    const edit = store.state.textEdit!;
    expect(edit.style).toMatchObject({ textAlign: 'center', verticalAlign: 'middle' });
    const at = store.state.viewport;
    const clickX = (400 - at.panX) / at.zoom;
    expect(edit.box.x + edit.box.width / 2).toBeCloseTo(clickX, 5);
    store.setTextDraft('Hallo'); store.commitTextEdit(); await store.whenIdle();
    const text = only(store);
    expect(text.kind).toBe('text');
    expect(text.style).toMatchObject({ textAlign: 'center', verticalAlign: 'middle' });
    expect(store.state.selectionInfo.values).toMatchObject({ textAlign: 'center', verticalAlign: 'middle' });
  });

  test('a drawn shape is centred across and down', async () => {
    const store = setup();
    store.setTool('rectangle'); store.pointerDown(point(300, 200)); store.pointerMove(point(460, 290)); store.pointerUp(point(460, 290)); await store.whenIdle();
    expect(only(store).style).toMatchObject({ textAlign: 'center', verticalAlign: 'middle' });
  });
});

describe('changing the alignment', () => {
  test('the selection shows the alignment of an older element and takes a new one', async () => {
    const store = setup();
    const text = await typeText(store, 'Hallo');
    store.select([text.id]);
    store.applyPatch({ style: { verticalAlign: 'bottom' } }); await store.whenIdle();
    expect(only(store).style.verticalAlign).toBe('bottom');
    expect(store.state.selectionInfo.values.verticalAlign).toBe('bottom');
    expect(store.state.selectionInfo.mixed).not.toContain('verticalAlign');
  });

  test('while the text is edited the alignment is part of the draft', async () => {
    const store = setup();
    const text = await typeText(store, 'Hallo');
    store.select([text.id]); store.startTextEdit(text.id);
    store.setPropertyDraft({ style: { verticalAlign: 'top' } });
    expect(store.state.textEdit!.style.verticalAlign).toBe('top');
    expect(store.state.selectionInfo.values.verticalAlign).toBe('top');
    expect(only(store).style.verticalAlign).toBe('middle');
    store.commitTextEdit(); await store.whenIdle();
    expect(only(store).style.verticalAlign).toBe('top');
  });

  test('a kind with a fixed place for its text does not store the field', async () => {
    const store = setup();
    store.setTool('container'); store.pointerDown(point(300, 200)); store.pointerMove(point(560, 400)); store.pointerUp(point(560, 400)); await store.whenIdle();
    const container = only(store);
    store.select([container.id]);
    store.applyPatch({ style: { verticalAlign: 'bottom', fontSize: 18 } }); await store.whenIdle();
    expect(only(store).style.fontSize).toBe(18);
    expect(only(store).style.verticalAlign).toBeUndefined();
    expect(store.state.selectionInfo.values.verticalAlign).toBeUndefined();
  });
});

describe('free text and its box', () => {
  test('a text made higher by hand keeps its height when the text changes', async () => {
    const store = setup();
    const text = await typeText(store, 'Hallo');
    expect(hasFittedTextHeight(text)).toBe(true);
    store.select([text.id]);
    store.applyPatch({ height: 160 }); await store.whenIdle();
    store.startTextEdit(text.id); store.setTextDraft('Hallo\nWelt'); store.commitTextEdit(); await store.whenIdle();
    expect(only(store).height).toBe(160);
    expect(only(store).text).toBe('Hallo\nWelt');
  });

  test('a fitted text still grows and shrinks with its lines', async () => {
    const store = setup();
    const text = await typeText(store, 'Hallo');
    store.select([text.id]);
    store.startTextEdit(text.id); store.setTextDraft('a\nb\nc'); store.commitTextEdit(); await store.whenIdle();
    expect(only(store).height).toBe(fittedTextHeight('a\nb\nc', text.width, text.style.fontSize));
    store.startTextEdit(text.id); store.setTextDraft('a'); store.commitTextEdit(); await store.whenIdle();
    expect(only(store).height).toBe(fittedTextHeight('a', text.width, text.style.fontSize));
  });

  test('a fitted text follows a new font size', async () => {
    const store = setup();
    const text = await typeText(store, 'Hallo');
    store.select([text.id]);
    store.applyPatch({ style: { fontSize: 40 } }); await store.whenIdle();
    expect(only(store).height).toBe(fittedTextHeight('Hallo', text.width, 40));
    expect(hasFittedTextHeight(only(store))).toBe(true);
  });
});

describe('draw.io', () => {
  const page = (elements: ReturnType<typeof createElement>[]) => { const document = createDocument('Test'); return { ...document, elements: elements.map((element) => ({ ...element, pageId: document.pages[0]!.id })) }; };
  const cellStyle = (xml: string, value: string) => new RegExp(`value="${value}" style="([^"]*)"`).exec(xml)?.[1] ?? '';

  test('writes where the text stands when it is not the middle', () => {
    const document = page([
      createElement('text', { id: 'old-text', x: 0, y: 0, width: 160, height: 80, text: 'A' }),
      createElement('text', { id: 'new-text', x: 0, y: 100, width: 160, height: 80, text: 'B', style: { verticalAlign: 'middle' } as ElementStyle }),
      createElement('rectangle', { id: 'low', x: 0, y: 200, width: 160, height: 80, text: 'C', style: { verticalAlign: 'bottom' } as ElementStyle }),
      createElement('rectangle', { id: 'plain', x: 0, y: 300, width: 160, height: 80, text: 'D' }),
    ]);
    const xml = prepareDrawioExport(document, { embedDocument: false }).contents;
    expect(cellStyle(xml, 'A')).toContain('verticalAlign=top');
    expect(cellStyle(xml, 'B')).not.toContain('verticalAlign');
    expect(cellStyle(xml, 'C')).toContain('verticalAlign=bottom');
    expect(cellStyle(xml, 'D')).not.toContain('verticalAlign');

    // Picture 3 knew no vertical alignment: a file written with it is still what its exporter draws.
    const before = drawioProjectionForValidation(document, 3);
    expect(before).not.toContain('verticalAlign=top');
    expect(drawioProjectionForValidation(document, 4)).toContain('verticalAlign=top');

    const back = importDrawio(xml);
    const byText = new Map(back.document.elements.map((element) => [element.text, element]));
    expect(byText.get('A')!.style.verticalAlign).toBeUndefined();
    expect(verticalAlignOf(byText.get('A')!)).toBe('top');
    expect(byText.get('B')!.style.verticalAlign).toBe('middle');
    expect(byText.get('C')!.style.verticalAlign).toBe('bottom');
    expect(byText.get('D')!.style.verticalAlign).toBeUndefined();
  });
});
