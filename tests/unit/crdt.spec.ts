import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import {
  clearIndexedDbPersistence,
  createCrdtController,
  createCrdtControllerFromUpdate,
  createPersistedCrdtController,
  createValidatedAwareness,
  CRDT_UPDATE_LIMIT_BYTES,
} from '../../src/crdt';
import {
  annotationPlainText,
  createDocument,
  createElement,
  DomainConflictError,
  DomainValidationError,
  type AnnotationDocument,
  type CommentThread,
  type SketchDocument,
  type SketchTask,
} from '../../src/domain';

const NOW = '2026-10-18T12:00:00.000Z';

function baseDocument(): SketchDocument {
  const document = createDocument('CRDT');
  document.id = 'document:crdt';
  document.elements = [createElement('text', { id: 'text:one', text: 'Start' })];
  return document;
}

function context(revision: number, actorId: string) {
  return { actorId, expectedRevision: revision, source: 'human' as const };
}

function sync(source: ReturnType<typeof createCrdtController>, target: ReturnType<typeof createCrdtController>, actorId: string, peerId: string): void {
  const update = source.encodeUpdate(target.encodeStateVector());
  if (update.byteLength > 2) target.applyRemoteUpdate(update, { actorId, role: 'editor', source: 'peer', peerId });
}

describe('Yjs document data layer', () => {
  it('projects a valid document bidirectionally and emits compact post-commit events', async () => {
    const controller = createCrdtController(baseDocument());
    const committed = vi.fn();
    const broken = vi.fn(() => { throw new Error('listener failure'); });
    controller.on('committed', broken);
    controller.on('committed', committed);

    controller.dispatch({ type: 'rename', title: 'Shared' }, context(0, 'actor:one'));
    await Promise.resolve();
    expect(controller.getSnapshot()).toMatchObject({ revision: 1, document: { title: 'Shared' } });
    expect(committed).toHaveBeenCalledWith(expect.objectContaining({ revision: 1, actorId: 'actor:one', changedElementIds: [] }));
    expect(broken).toHaveBeenCalledOnce();
    expect(committed.mock.calls[0]?.[0]).not.toHaveProperty('document');
    controller.destroy();
  });

  it('converges concurrent text, comments, tasks, additions and ordering independent of delivery order', () => {
    const owner = createCrdtController(baseDocument());
    const initial = owner.encodeUpdate();
    const left = createCrdtControllerFromUpdate(initial);
    const right = createCrdtControllerFromUpdate(initial);

    left.dispatch({ type: 'update', changes: [{ id: 'text:one', patch: { text: 'Start left' } }] }, context(0, 'actor:left'));
    right.dispatch({ type: 'update', changes: [{ id: 'text:one', patch: { text: 'Start right' } }] }, context(0, 'actor:right'));
    left.dispatch({ type: 'add', elements: [createElement('rectangle', { id: 'shape:left' })] }, context(1, 'actor:left'));
    right.dispatch({ type: 'add', elements: [createElement('ellipse', { id: 'shape:right' })] }, context(1, 'actor:right'));

    const leftThread: CommentThread = {
      id: 'thread:left', target: { anchor: { x: 0, y: 0 }, fallback: { x: 1, y: 1 } },
      messages: [{ id: 'message:left', authorId: 'actor:left', authorName: 'Left', body: 'Left note', createdAt: NOW }],
      resolved: false, createdAt: NOW, updatedAt: NOW,
    };
    const rightTask: SketchTask = {
      id: 'task:right', title: 'Right task', description: 'Do it', status: 'todo', rank: 0, createdAt: NOW, updatedAt: NOW,
    };
    left.dispatch({ type: 'set-comments', threads: [leftThread] }, context(2, 'actor:left'));
    right.dispatch({ type: 'set-tasks', tasks: [rightTask] }, context(2, 'actor:right'));

    const leftUpdate = left.encodeUpdate(owner.encodeStateVector());
    const rightUpdate = right.encodeUpdate(owner.encodeStateVector());
    owner.applyRemoteUpdate(rightUpdate, { actorId: 'actor:right', role: 'editor', source: 'peer', peerId: 'peer:right' });
    owner.applyRemoteUpdate(leftUpdate, { actorId: 'actor:left', role: 'editor', source: 'peer', peerId: 'peer:left' });
    sync(owner, left, 'actor:owner', 'peer:owner');
    sync(owner, right, 'actor:owner', 'peer:owner');

    const ownerDocument = owner.getSnapshot().document;
    expect(left.getSnapshot().document).toEqual(ownerDocument);
    expect(right.getSnapshot().document).toEqual(ownerDocument);
    expect(ownerDocument.elements.map(element => element.id).sort()).toEqual(['shape:left', 'shape:right', 'text:one']);
    expect(ownerDocument.elements.find(element => element.id === 'text:one')?.text).toContain('left');
    expect(ownerDocument.elements.find(element => element.id === 'text:one')?.text).toContain('right');
    expect(ownerDocument.commentThreads?.map(thread => thread.id)).toContain('thread:left');
    expect(ownerDocument.tasks?.map(task => task.id)).toContain('task:right');
    owner.destroy(); left.destroy(); right.destroy();
  });

  it('merges concurrent rich text runs and comment replies without whole-field loss', () => {
    const annotation: AnnotationDocument = { version: 1, blocks: [{ type: 'paragraph', runs: [{ text: 'Base' }] }] };
    const document = createDocument('Rich text');
    document.id = 'document:rich';
    document.elements = [createElement('annotation', { id: 'annotation:one', annotation })];
    const first = createCrdtController(document);
    const second = createCrdtControllerFromUpdate(first.encodeUpdate());
    const firstValue: AnnotationDocument = { version: 1, blocks: [{ type: 'paragraph', runs: [{ text: 'Base A', bold: true }] }] };
    const secondValue: AnnotationDocument = { version: 1, blocks: [{ type: 'paragraph', runs: [{ text: 'Base B', italic: true }] }] };
    first.dispatch({ type: 'update', changes: [{ id: 'annotation:one', patch: { annotation: firstValue, text: annotationPlainText(firstValue) } }] }, context(0, 'actor:first'));
    second.dispatch({ type: 'update', changes: [{ id: 'annotation:one', patch: { annotation: secondValue, text: annotationPlainText(secondValue) } }] }, context(0, 'actor:second'));
    sync(first, second, 'actor:first', 'peer:first');
    sync(second, first, 'actor:second', 'peer:second');
    expect(first.getSnapshot().document).toEqual(second.getSnapshot().document);
    const text = first.getSnapshot().document.elements[0]?.annotation?.blocks[0]?.runs.map(run => run.text).join('');
    expect(text).toContain('A');
    expect(text).toContain('B');
    first.destroy(); second.destroy();
  });

  it('merges concurrent comment replies by message identity', () => {
    const document = baseDocument();
    const base: CommentThread = {
      id: 'thread:shared', target: { elementId: 'text:one', anchor: { x: .5, y: .5 }, fallback: { x: 0, y: 0 } },
      messages: [{ id: 'message:base', authorId: 'actor:base', authorName: 'Base', body: 'Base', createdAt: NOW }],
      resolved: false, createdAt: NOW, updatedAt: NOW,
    };
    document.commentThreads = [base];
    const first = createCrdtController(document);
    const second = createCrdtControllerFromUpdate(first.encodeUpdate());
    first.dispatch({ type: 'set-comments', threads: [{ ...base, messages: [...base.messages, { id: 'message:first', authorId: 'actor:first', authorName: 'First', body: 'First', createdAt: NOW }] }] }, context(0, 'actor:first'));
    second.dispatch({ type: 'set-comments', threads: [{ ...base, messages: [...base.messages, { id: 'message:second', authorId: 'actor:second', authorName: 'Second', body: 'Second', createdAt: NOW }] }] }, context(0, 'actor:second'));
    sync(first, second, 'actor:first', 'peer:first');
    sync(second, first, 'actor:second', 'peer:second');
    expect(first.getSnapshot().document).toEqual(second.getSnapshot().document);
    expect(first.getSnapshot().document.commentThreads?.[0]?.messages.map(message => message.id).sort()).toEqual(['message:base', 'message:first', 'message:second']);
    first.destroy(); second.destroy();
  });

  it('converges concurrent reorder, delete and cyclic parent moves deterministically', () => {
    const document = createDocument('Structure');
    document.id = 'document:structure';
    document.elements = [
      createElement('container', { id: 'container:a', x: 0, y: 0 }),
      createElement('container', { id: 'container:b', x: 400, y: 0 }),
      createElement('rectangle', { id: 'shape:delete', x: 900, y: 0 }),
    ];
    const first = createCrdtController(document);
    const second = createCrdtControllerFromUpdate(first.encodeUpdate());
    first.dispatch({ type: 'update', changes: [{ id: 'container:a', patch: { parentId: 'container:b' } }] }, context(0, 'actor:first'));
    first.dispatch({ type: 'reorder', ids: ['shape:delete', 'container:b', 'container:a'] }, context(1, 'actor:first'));
    second.dispatch({ type: 'update', changes: [{ id: 'container:b', patch: { parentId: 'container:a' } }] }, context(0, 'actor:second'));
    second.dispatch({ type: 'delete', ids: ['shape:delete'] }, context(1, 'actor:second'));
    const firstUpdate = first.encodeUpdate(second.encodeStateVector());
    const secondUpdate = second.encodeUpdate(first.encodeStateVector());
    first.applyRemoteUpdate(secondUpdate, { actorId: 'actor:second', role: 'editor', source: 'peer' });
    second.applyRemoteUpdate(firstUpdate, { actorId: 'actor:first', role: 'editor', source: 'peer' });
    expect(first.getSnapshot().document).toEqual(second.getSnapshot().document);
    const result = first.getSnapshot().document;
    expect(result.elements.map(element => element.id)).not.toContain('shape:delete');
    expect(result.elements.find(element => element.id === 'container:a')?.parentId).toBe('container:b');
    expect(result.elements.find(element => element.id === 'container:b')?.parentId).toBeUndefined();
    first.destroy(); second.destroy();
  });

  it('keeps undo actor-local and retains remote changes', () => {
    const local = createCrdtController(baseDocument());
    const remote = createCrdtControllerFromUpdate(local.encodeUpdate());
    local.dispatch({ type: 'rename', title: 'Local title' }, context(0, 'actor:local'));
    remote.dispatch({ type: 'add', elements: [createElement('ellipse', { id: 'shape:remote' })] }, context(0, 'actor:remote'));
    sync(remote, local, 'actor:remote', 'peer:remote');
    local.undo('actor:local');
    expect(local.getSnapshot().document.title).toBe('CRDT');
    expect(local.getSnapshot().document.elements.some(element => element.id === 'shape:remote')).toBe(true);
    expect(local.getHistoryState('actor:local')).toMatchObject({ canUndo: false, canRedo: true });
    local.destroy(); remote.destroy();
  });

  it('rejects viewers, malformed updates, oversized updates and mismatched documents', () => {
    const controller = createCrdtController(baseDocument());
    const update = controller.encodeUpdate();
    expect(() => controller.applyRemoteUpdate(update, { actorId: 'viewer:one', role: 'viewer', source: 'peer' })).toThrow(DomainConflictError);
    expect(() => controller.applyRemoteUpdate(new Uint8Array([1, 2, 3]), { actorId: 'editor:one', role: 'editor', source: 'peer' })).toThrow(DomainValidationError);
    expect(() => controller.applyRemoteUpdate(new Uint8Array(CRDT_UPDATE_LIMIT_BYTES + 1), { actorId: 'editor:one', role: 'editor', source: 'peer' })).toThrow(DomainValidationError);
    const other = baseDocument(); other.id = 'document:other';
    const otherController = createCrdtController(other);
    expect(() => controller.applyRemoteUpdate(otherController.encodeUpdate(), { actorId: 'editor:one', role: 'editor', source: 'peer' })).toThrow(DomainValidationError);
    controller.destroy(); otherController.destroy();
  });

  it('validates and bounds ephemeral awareness without persisting it in document updates', () => {
    const controller = createCrdtController(baseDocument());
    const peer = createCrdtControllerFromUpdate(controller.encodeUpdate());
    const local = createValidatedAwareness(controller.ydoc);
    const remote = createValidatedAwareness(peer.ydoc);
    local.setLocalState({ actorId: 'actor:one', displayName: 'One', cursor: { x: 10, y: 20 }, selectionIds: ['text:one'], agent: null });
    const update = local.encodeUpdate();
    remote.applyRemoteUpdate(update, state => state.actorId === 'actor:one');
    expect(Array.from(remote.getStates().values())).toContainEqual(expect.objectContaining({ actorId: 'actor:one' }));
    expect(() => local.setLocalState({ actorId: 'bad actor', displayName: 'One', cursor: null, selectionIds: [], agent: null })).toThrow(TypeError);
    const restarted = createCrdtControllerFromUpdate(controller.encodeUpdate());
    expect(createValidatedAwareness(restarted.ydoc).getStates().size).toBe(0);
    local.destroy(); remote.destroy(); controller.destroy(); peer.destroy(); restarted.destroy();
  });

  it('deduplicates repeated updates', () => {
    const source = createCrdtController(baseDocument());
    const target = createCrdtControllerFromUpdate(source.encodeUpdate());
    source.dispatch({ type: 'rename', title: 'Once' }, context(0, 'actor:source'));
    const update = source.encodeUpdate(target.encodeStateVector());
    target.applyRemoteUpdate(update, { actorId: 'actor:source', role: 'editor', source: 'peer' });
    const revision = target.getSnapshot().revision;
    target.applyRemoteUpdate(update, { actorId: 'actor:source', role: 'editor', source: 'peer' });
    expect(target.getSnapshot()).toMatchObject({ revision, document: { title: 'Once' } });
    source.destroy(); target.destroy();
  });

  it('recovers local changes from y-indexeddb and isolates cache keys', async () => {
    const cacheKey = `test:${crypto.randomUUID()}`;
    const otherKey = `test:${crypto.randomUUID()}`;
    const first = await createPersistedCrdtController(cacheKey, baseDocument());
    expect(first.recovered).toBe(false);
    first.controller.dispatch({ type: 'rename', title: 'Recovered' }, context(0, 'actor:local'));
    await new Promise(resolve => setTimeout(resolve, 10));
    await first.persistence.destroy();
    first.controller.destroy();

    const recovered = await createPersistedCrdtController(cacheKey, baseDocument());
    expect(recovered.recovered).toBe(true);
    expect(recovered.controller.getSnapshot().document.title).toBe('Recovered');
    const isolated = await createPersistedCrdtController(otherKey, baseDocument());
    expect(isolated.recovered).toBe(false);
    expect(isolated.controller.getSnapshot().document.title).toBe('CRDT');

    await recovered.persistence.destroy();
    recovered.controller.destroy();
    await isolated.persistence.destroy();
    isolated.controller.destroy();
    await clearIndexedDbPersistence(cacheKey);
    await clearIndexedDbPersistence(otherKey);
    const cleared = await createPersistedCrdtController(cacheKey, baseDocument());
    expect(cleared.recovered).toBe(false);
    await cleared.persistence.destroy();
    cleared.controller.destroy();
    await clearIndexedDbPersistence(cacheKey);
  });
});
