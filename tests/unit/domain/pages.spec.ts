import { describe, expect, it } from 'vitest';
import {
  applyCommand, createController, createDocument, createElement, deserializeDocument, serializeDocument, validateDocument,
  DomainValidationError, type DocumentCommand, type SketchDocument,
} from '../../../src/domain';

const context = (expectedRevision: number, actorId = 'actor:local') => ({ actorId, expectedRevision, source: 'human' as const });
const rect = (id: string, pageId = 'page:1', extra: Record<string, unknown> = {}) => createElement('rectangle', { id, pageId, x: 0, y: 0, width: 40, height: 20, ...extra });

function twoPages(): SketchDocument {
  let doc = createDocument('Pages');
  doc = applyCommand(doc, { type: 'add-page', page: { id: 'page:2', name: 'Details' } });
  doc = applyCommand(doc, { type: 'add', pageId: 'page:1', elements: [rect('a'), rect('b')] });
  doc = applyCommand(doc, { type: 'add', pageId: 'page:2', elements: [rect('c', 'page:2'), rect('d', 'page:2')] });
  return doc;
}

const invalid = (action: () => unknown, code: string) => {
  try { action(); } catch (error) {
    expect(error).toBeInstanceOf(DomainValidationError);
    expect((error as DomainValidationError).issues.map((issue) => issue.code)).toContain(code);
    return;
  }
  throw new Error(`Expected ${code}`);
};

describe('schema v2 pages', () => {
  it('creates documents with one default page and stamps new elements with it', () => {
    const doc = createDocument('x');
    expect(doc.schemaVersion).toBe(2);
    expect(doc.pages).toEqual([{ id: 'page:1', name: 'Seite 1' }]);
    const added = applyCommand(doc, { type: 'add', elements: [createElement('rectangle', { id: 'r' })] });
    expect(added.elements[0]!.pageId).toBe('page:1');
  });

  it('migrates v1 documents deterministically to a single page and keeps the legacy page name', () => {
    const v1 = JSON.parse(JSON.stringify(createDocument('Legacy'))) as Record<string, unknown>;
    v1['schemaVersion'] = 1; delete v1['pages'];
    v1['elements'] = [{ ...rect('a'), pageId: undefined }];
    v1['metadata'] = { 'sketchdraw.page.v1.name': 'Übersicht', keep: 'me' };
    const migrated = validateDocument(JSON.parse(JSON.stringify(v1)));
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.pages).toEqual([{ id: 'page:1', name: 'Übersicht' }]);
    expect(migrated.elements[0]!.pageId).toBe('page:1');
    expect(migrated.metadata).toEqual({ keep: 'me' });
    expect(serializeDocument(validateDocument(JSON.parse(JSON.stringify(v1))))).toBe(serializeDocument(migrated));
  });

  it('migrates the multi-page preview stored in the metadata of v1 documents', () => {
    const base = createDocument('Preview');
    const v1 = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    v1['schemaVersion'] = 1; delete v1['pages'];
    v1['elements'] = [{ ...rect('first'), pageId: undefined }];
    v1['metadata'] = { 'sketchdraw.pages.compat.v1': JSON.stringify({ version: 1, activePageId: 'p-a', pages: [
      { id: 'p-a', name: 'Eins' }, { id: 'p-b', name: 'Zwei', elements: [{ ...rect('second'), pageId: undefined }] },
    ] }) };
    const migrated = validateDocument(v1);
    expect(migrated.pages).toEqual([{ id: 'p-a', name: 'Eins' }, { id: 'p-b', name: 'Zwei' }]);
    expect(migrated.elements.map((element) => [element.id, element.pageId])).toEqual([['first', 'p-a'], ['second', 'p-b']]);
    expect(Object.keys(migrated.metadata)).toEqual([]);
    // Broken preview data falls back to one page.
    v1['metadata'] = { 'sketchdraw.pages.compat.v1': '{nope' };
    expect(validateDocument(v1).pages).toHaveLength(1);
  });

  it('round-trips through the canonical JSON', () => {
    const doc = twoPages();
    expect(deserializeDocument(serializeDocument(doc))).toEqual(doc);
  });

  it('requires a page for elements when the document has several pages', () => {
    const doc = twoPages();
    invalid(() => applyCommand(doc, { type: 'add', elements: [{ ...rect('x'), pageId: undefined } as never] }), 'MISSING_PAGE_ID');
    invalid(() => applyCommand(doc, { type: 'add', pageId: 'page:9', elements: [rect('x', 'page:9')] }), 'MISSING_PAGE_REFERENCE');
  });

  it('rejects references across pages', () => {
    const doc = twoPages();
    const container = createElement('container', { id: 'box', pageId: 'page:1' });
    const withBox = applyCommand(doc, { type: 'add', pageId: 'page:1', elements: [container] });
    invalid(() => applyCommand(withBox, { type: 'add', pageId: 'page:2', elements: [rect('child', 'page:2', { parentId: 'box' })] }), 'CROSS_PAGE_REFERENCE');
    const connector = createElement('connector', { id: 'e', pageId: 'page:2', from: { elementId: 'a', anchor: { x: .5, y: .5 } }, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] });
    invalid(() => applyCommand(withBox, { type: 'add', pageId: 'page:2', elements: [connector] }), 'CROSS_PAGE_REFERENCE');
  });

  it('adds, renames, reorders and deletes pages', () => {
    let doc = twoPages();
    doc = applyCommand(doc, { type: 'rename-page', pageId: 'page:2', name: '  Neu  ' });
    expect(doc.pages[1]!.name).toBe('Neu');
    invalid(() => applyCommand(doc, { type: 'rename-page', pageId: 'page:2', name: '   ' }), 'INVALID_PAGE_NAME');
    invalid(() => applyCommand(doc, { type: 'rename-page', pageId: 'nope', name: 'x' }), 'UNKNOWN_PAGE_ID');
    invalid(() => applyCommand(doc, { type: 'add-page', page: { id: 'page:2', name: 'dup' } }), 'DUPLICATE_PAGE_ID');

    doc = applyCommand(doc, { type: 'reorder-pages', ids: ['page:2', 'page:1'] });
    expect(doc.pages.map((page) => page.id)).toEqual(['page:2', 'page:1']);
    invalid(() => applyCommand(doc, { type: 'reorder-pages', ids: ['page:2'] }), 'INVALID_PERMUTATION_LENGTH');

    const inserted = applyCommand(doc, { type: 'add-page', index: 0, page: { id: 'page:3', name: 'Kopie' }, elements: [rect('copy', 'ignored')] });
    expect(inserted.pages.map((page) => page.id)).toEqual(['page:3', 'page:2', 'page:1']);
    expect(inserted.elements.find((element) => element.id === 'copy')!.pageId).toBe('page:3');

    const removed = applyCommand(doc, { type: 'delete-page', pageId: 'page:2' });
    expect(removed.pages.map((page) => page.id)).toEqual(['page:1']);
    expect(removed.elements.map((element) => element.id)).toEqual(['a', 'b']);
    invalid(() => applyCommand(removed, { type: 'delete-page', pageId: 'page:1' }), 'LAST_PAGE');
  });

  it('deleting a page detaches comments and tasks that pointed to its elements', () => {
    let doc = twoPages();
    doc = applyCommand(doc, { type: 'set-comments', threads: [{
      id: 'thread:1', target: { elementId: 'c', anchor: { x: 1, y: 1 }, fallback: { x: 1, y: 1 } },
      messages: [{ id: 'm1', authorId: 'u', authorName: 'U', body: 'hi', createdAt: '2026-10-20T10:00:00.000Z' }],
      resolved: false, createdAt: '2026-10-20T10:00:00.000Z', updatedAt: '2026-10-20T10:00:00.000Z',
    }] });
    const after = applyCommand(doc, { type: 'delete-page', pageId: 'page:2' });
    expect(after.commentThreads![0]!.target.elementId).toBeUndefined();
  });

  it('reorders the stacking of one page and leaves the other pages alone', () => {
    const doc = twoPages();
    const reordered = applyCommand(doc, { type: 'reorder', ids: ['b', 'a'] });
    expect(reordered.elements.filter((element) => element.pageId === 'page:1').map((element) => element.id)).toEqual(['b', 'a']);
    expect(reordered.elements.filter((element) => element.pageId === 'page:2').map((element) => element.id)).toEqual(['c', 'd']);
    invalid(() => applyCommand(doc, { type: 'reorder', ids: ['a', 'c'] }), 'CROSS_PAGE_REORDER');
    invalid(() => applyCommand(doc, { type: 'reorder', ids: ['a'] }), 'INVALID_PERMUTATION_LENGTH');
  });

  it('does not let an update move an element to another page', () => {
    const doc = twoPages();
    invalid(() => applyCommand(doc, { type: 'update', changes: [{ id: 'a', patch: { pageId: 'page:2' } as never }] }), 'UNKNOWN_FIELD');
  });

  it('undoes and redoes page operations, including a deleted page with its elements', () => {
    const controller = createController(twoPages());
    const run = (command: DocumentCommand) => controller.dispatch(command, context(controller.getSnapshot().revision));
    run({ type: 'rename-page', pageId: 'page:2', name: 'Umbenannt' });
    run({ type: 'reorder-pages', ids: ['page:2', 'page:1'] });
    run({ type: 'delete-page', pageId: 'page:2' });
    expect(controller.getSnapshot().document.pages.map((page) => page.id)).toEqual(['page:1']);

    controller.undo('actor:local');
    let snapshot = controller.getSnapshot().document;
    expect(snapshot.pages).toEqual([{ id: 'page:2', name: 'Umbenannt' }, { id: 'page:1', name: 'Seite 1' }]);
    expect(snapshot.elements.map((element) => element.id).sort()).toEqual(['a', 'b', 'c', 'd']);

    controller.undo('actor:local');
    expect(controller.getSnapshot().document.pages.map((page) => page.id)).toEqual(['page:1', 'page:2']);
    controller.undo('actor:local');
    snapshot = controller.getSnapshot().document;
    expect(snapshot.pages[1]!.name).toBe('Details');

    controller.redo('actor:local'); controller.redo('actor:local'); controller.redo('actor:local');
    expect(controller.getSnapshot().document.pages.map((page) => page.id)).toEqual(['page:1']);
  });
});

describe('canonical element order', () => {
  it('keeps the elements of a page contiguous and follows the page order', () => {
    let doc = twoPages();
    doc = applyCommand(doc, { type: 'add', pageId: 'page:1', elements: [rect('late')] });
    expect(doc.elements.map((element) => element.id)).toEqual(['a', 'b', 'late', 'c', 'd']);
    doc = applyCommand(doc, { type: 'reorder-pages', ids: ['page:2', 'page:1'] });
    expect(doc.elements.map((element) => element.id)).toEqual(['c', 'd', 'a', 'b', 'late']);
  });
});
