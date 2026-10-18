import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createController, createDocument, createElement, createTableDocument, deserializeDocument,
  deleteTableColumn, deleteTableRow, DomainValidationError, duplicateTableColumn, duplicateTableRow,
  formatTableCells, insertTableColumn, insertTableRow, MAX_TABLE_CELLS, moveTableColumn, moveTableRow,
  serializeDocument, setTableCellText, tablePlainText, type DesktopBridge, type TableDocument,
} from '@/domain';
import { formatDiagram, parseDiagram } from '@/codec';
import { importDrawio, importSvg, prepareDrawioExport, prepareSvgExport } from '@/interop';
import { createWhiteboardStore } from '@/renderer/state/whiteboard';
import type { PointerInput, WhiteboardStore } from '@/renderer/state/contract';

const stores: WhiteboardStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.dispose(); });
const point = (x: number, y: number): PointerInput => ({ x, y, button: 0, pointerType: 'mouse', shiftKey: false, altKey: false, metaOrCtrl: false, detail: 1 });
function setup(): WhiteboardStore {
  const bridge: DesktopBridge = { platform: 'electron', openDocument: vi.fn<DesktopBridge['openDocument']>(async () => ({ status: 'cancelled' })), saveDocument: vi.fn<DesktopBridge['saveDocument']>(async () => ({ status: 'cancelled' })), exportFile: vi.fn<DesktopBridge['exportFile']>(async () => ({ status: 'cancelled' })), openExternal: vi.fn(async () => {}), onCloseRequested: () => () => {}, respondToClose: vi.fn(async () => {}), onMenuCommand: () => () => {} };
  const store = createWhiteboardStore({ bridge }); stores.push(store); return store;
}

describe('table domain contract', () => {
  it('creates a safe 3 by 3 table and rejects stale, misplaced or oversized state', () => {
    const element = createElement('table', { id: 'table:one' });
    expect(element).toMatchObject({ kind: 'table', width: 480, height: 240 });
    expect(element.table?.rows).toHaveLength(3); expect(element.table?.columns).toHaveLength(3); expect(element.table?.cells).toHaveLength(9);
    expect(element.text).toBe(tablePlainText(element.table!));
    expect(() => createElement('rectangle', { table: element.table })).toThrow(DomainValidationError);
    expect(() => createElement('table', { table: element.table, text: 'stale' })).toThrow(DomainValidationError);
    const tooLarge = createTableDocument(1, 1) as TableDocument;
    tooLarge.rows = Array.from({ length: MAX_TABLE_CELLS + 1 }, (_, index) => ({ id: `row:${index}`, height: 80 }));
    expect(() => createElement('table', { table: tooLarge })).toThrow(DomainValidationError);
  });

  it('updates, formats and grows rows and columns immutably', () => {
    const original = createTableDocument(2, 2); const first = original.cells[0]!;
    const edited = setTableCellText(original, first.id, 'Architecture');
    const formatted = formatTableCells(edited, [first.id], { fontWeight: 'bold', fill: '#d6f2d6', color: '#2563eb', fontSize: 28, fontFamily: 'roboto', textDecoration: 'line-through', listStyle: 'bullet', textAlign: 'center' });
    const grown = insertTableColumn(insertTableRow(formatted, 1), 1);
    expect(original.cells[0]?.text).toBe('');
    expect(formatted.cells[0]).toMatchObject({ text: 'Architecture', style: { fontWeight: 'bold', fill: '#d6f2d6', color: '#2563eb', fontSize: 28, fontFamily: 'roboto', textDecoration: 'line-through', listStyle: 'bullet', textAlign: 'center' } });
    expect(grown.rows).toHaveLength(3); expect(grown.columns).toHaveLength(3); expect(grown.cells).toHaveLength(9);
    const duplicated = duplicateTableColumn(duplicateTableRow(formatted, 0), 0);
    expect(duplicated.rows).toHaveLength(3); expect(duplicated.columns).toHaveLength(3);
    expect(moveTableRow(duplicated, 0, 1).rows[1]?.id).toBe(duplicated.rows[0]?.id);
    expect(moveTableColumn(duplicated, 0, 1).columns[1]?.id).toBe(duplicated.columns[0]?.id);
    expect(deleteTableColumn(deleteTableRow(duplicated, 0), 0).cells).toHaveLength(4);
  });

  it('round-trips through JSON, Diagram as Code, controller history and clipboard-compatible cloning', () => {
    const document = createDocument('Tables'); let table = createTableDocument();
    table = setTableCellText(table, table.cells[0]!.id, 'Name');
    document.elements = [createElement('table', { id: 'table:one', table })];
    const serialized = serializeDocument(document);
    expect(deserializeDocument(serialized)).toEqual(document);
    const parsed = parseDiagram(formatDiagram(document)); expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('Diagram as Code parse failed.');
    expect(serializeDocument(parsed.document)).toBe(serialized);
    const controller = createController(document); const changed = setTableCellText(table, table.cells[1]!.id, 'Owner');
    controller.dispatch({ type: 'update', changes: [{ id: 'table:one', patch: { table: changed, text: tablePlainText(changed) } }] }, { actorId: 'local', expectedRevision: 0, source: 'human' });
    expect(controller.undo('local').document.elements[0]?.table).toEqual(table);
  });
});

describe('table whiteboard and interoperability', () => {
  it('creates, edits, formats, changes structure and copies a table through the store', async () => {
    const store = setup(); store.setTool('table'); store.pointerDown(point(200, 180)); store.pointerUp(point(200, 180)); await store.whenIdle();
    const element = store.state.document.elements[0]!; expect(element.kind).toBe('table');
    store.applyPatch({ width: 600, height: 300 }); await store.whenIdle();
    const first = element.table!.cells[0]!; store.selectTableCells(element.id, [first.id], 'cell', 0, 0);
    store.setTableCellText(element.id, first.id, 'Hello'); await store.whenIdle();
    store.formatTableSelection({ fontFamily: 'roboto', fontWeight: 'bold', textDecoration: 'line-through', listStyle: 'bullet', textAlign: 'center', fill: '#d6f2d6' }); await store.whenIdle();
    expect(store.state.document.elements[0]?.table?.cells[0]).toMatchObject({ text: 'Hello', style: { fontFamily: 'roboto', fontWeight: 'bold', textDecoration: 'line-through', listStyle: 'bullet', textAlign: 'center', fill: '#d6f2d6' } });
    expect(store.state.document.elements[0]).toMatchObject({ width: 600, height: 300 });
    store.changeTableStructure('row-after'); await store.whenIdle(); store.changeTableStructure('column-after'); await store.whenIdle();
    expect(store.state.document.elements[0]?.table?.rows).toHaveLength(4); expect(store.state.document.elements[0]?.table?.columns).toHaveLength(4);
    expect(store.state.document.elements[0]).toMatchObject({ width: 800, height: 400 });
    store.select([element.id]); await store.copySelection(); await store.pasteSelection(); await store.whenIdle();
    expect(store.state.document.elements.filter((entry) => entry.kind === 'table')).toHaveLength(2);
  });

  it('exports visible SVG cells and preserves exact tables in SVG and draw.io', () => {
    const document = createDocument('Tables'); let table = createTableDocument(2, 2); table = setTableCellText(table, table.cells[0]!.id, 'Name');
    document.elements = [createElement('table', { id: 'table:one', table })]; const before = serializeDocument(document);
    const svg = prepareSvgExport(document).contents; const drawio = prepareDrawioExport(document).contents;
    expect(svg).toContain('Name'); expect(svg.match(/<rect/g)?.length).toBeGreaterThanOrEqual(4); expect(drawio).toContain('sketchdrawKind=table');
    expect(serializeDocument(importSvg(svg).document)).toBe(before); expect(serializeDocument(importDrawio(drawio).document)).toBe(before);
    const native = importDrawio(prepareDrawioExport(document, { embedDocument: false }).contents).document.elements[0]!;
    expect(native.kind).toBe('table'); expect(native.table?.cells[0]?.text).toBe('Name');
  });
});
