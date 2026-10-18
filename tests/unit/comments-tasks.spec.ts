import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  createController,
  createDocument,
  createElement,
  DomainValidationError,
  resolveAnchorWorldPoint,
  serializeDocument,
  validateDocument,
  type CommentThread,
  type SketchTask,
} from '../../src/domain';
import { formatDiagram, parseDiagram } from '../../src/codec';
import { importDrawio, importSvg, prepareDrawioExport, prepareSvgExport } from '../../src/interop';

const NOW = '2026-10-18T12:00:00.000Z';

function thread(elementId = 'shape:one'): CommentThread {
  return {
    id: 'thread:one',
    target: { elementId, anchor: { x: 0.75, y: 0.25 }, fallback: { x: 175, y: 125 } },
    messages: [{ id: 'comment:one', authorId: 'actor:one', authorName: 'Jeremy Teichmann', body: 'Bitte prüfen', createdAt: NOW }],
    resolved: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function task(): SketchTask {
  return { id: 'task:one', sourceThreadId: 'thread:one', title: 'Bitte prüfen', description: 'Bitte prüfen', status: 'todo', rank: 0, createdAt: NOW, updatedAt: NOW };
}

describe('comment threads and tasks', () => {
  it('normalizes legacy documents and roundtrips collaboration data through JSON and Diagram as Code', () => {
    const legacy = createDocument('Legacy');
    const oldShape = { ...legacy } as Record<string, unknown>;
    delete oldShape.commentThreads; delete oldShape.tasks;
    const normalized = validateDocument(oldShape);
    expect(normalized.commentThreads ?? []).toEqual([]); expect(normalized.tasks ?? []).toEqual([]);

    const shape = createElement('rectangle', { id: 'shape:one', x: 100, y: 100, width: 100, height: 100 });
    let document = applyCommand(normalized, { type: 'add', elements: [shape] });
    document = applyCommand(document, { type: 'set-comments', threads: [thread()] });
    document = applyCommand(document, { type: 'set-tasks', tasks: [task()] });

    const json = JSON.parse(serializeDocument(document));
    expect(json.commentThreads[0].messages[0].body).toBe('Bitte prüfen');
    expect(json.tasks[0].sourceThreadId).toBe('thread:one');
    const script = formatDiagram(document);
    const parsed = parseDiagram(script);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.document.commentThreads).toEqual(document.commentThreads);
      expect(parsed.document.tasks).toEqual(document.tasks);
    }
  });

  it('keeps pins attached during geometry changes and preserves an orphan at its fallback after deletion', () => {
    const shape = createElement('rectangle', { id: 'shape:one', x: 100, y: 100, width: 100, height: 100 });
    let document = applyCommand(createDocument(), { type: 'add', elements: [shape] });
    document = applyCommand(document, { type: 'set-comments', threads: [thread()] });
    document = applyCommand(document, { type: 'set-tasks', tasks: [task()] });
    document = applyCommand(document, { type: 'update', changes: [{ id: shape.id, patch: { x: 300, width: 200 } }] });
    expect(resolveAnchorWorldPoint(document.elements[0]!, document.commentThreads![0]!.target.anchor)).toEqual({ x: 450, y: 125 });

    const deleted = applyCommand(document, { type: 'delete', ids: [shape.id] });
    expect(deleted.commentThreads![0]!.target).toEqual({ anchor: { x: .75, y: .25 }, fallback: { x: 175, y: 125 } });
    expect(deleted.tasks![0]!.sourceThreadId).toBe('thread:one');
  });

  it('keeps a free canvas comment at its absolute fallback position', () => {
    const freeThread: CommentThread = {
      ...thread(),
      target: { anchor: { x: 0.5, y: 0.5 }, fallback: { x: 640, y: 420 } },
    };
    const document = applyCommand(createDocument(), { type: 'set-comments', threads: [freeThread] });
    expect(document.commentThreads?.[0]?.target).toEqual(freeThread.target);
    expect(JSON.parse(serializeDocument(document)).commentThreads[0].target).toEqual(freeThread.target);
  });

  it('enforces one task per thread and integrates comment writes with history', () => {
    let document = applyCommand(createDocument(), { type: 'set-comments', threads: [thread('missing:allowed')] });
    expect(() => applyCommand(document, { type: 'set-tasks', tasks: [task(), { ...task(), id: 'task:two' }] })).toThrow(DomainValidationError);

    const controller = createController(document);
    controller.dispatch({ type: 'set-tasks', tasks: [task()] }, { actorId: 'actor:one', expectedRevision: 0, source: 'human' });
    expect(controller.getSnapshot().document.tasks).toHaveLength(1);
    controller.undo('actor:one');
    expect(controller.getSnapshot().document.tasks).toEqual([]);
  });

  it('keeps collaboration data in exact SVG and draw.io envelopes without visible pins', () => {
    let document = applyCommand(createDocument(), { type: 'set-comments', threads: [thread('missing:allowed')] });
    document = applyCommand(document, { type: 'set-tasks', tasks: [task()] });
    const svg = prepareSvgExport(document);
    const drawio = prepareDrawioExport(document);
    expect(svg.contents).not.toContain('comment-pin');
    expect(drawio.contents).not.toContain('comment-pin');
    expect(importSvg(svg.contents).document.commentThreads).toEqual(document.commentThreads);
    expect(importDrawio(drawio.contents).document.tasks).toEqual(document.tasks);
  });
});
