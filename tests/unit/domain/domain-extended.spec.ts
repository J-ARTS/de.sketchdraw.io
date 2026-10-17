import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import {
  applyCommand,
  createController,
  createDocument,
  createElement,
  deserializeDocument,
  DOMAIN_LIMITS,
  DomainConflictError,
  DomainValidationError,
  serializeDocument,
  validateDocument,
} from '../../../src/domain/index';
import type { ElementKind, Point, SketchAsset, SketchDocument, SketchElement } from '../../../src/domain/types';

function toWorldPoint(element: SketchElement, local: Point): Point {
  const rad = (element.rotation * Math.PI) / 180;
  const dx = local.x - element.width / 2;
  const dy = local.y - element.height / 2;
  return {
    x: element.x + element.width / 2 + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: element.y + element.height / 2 + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

const ALL_KINDS: readonly ElementKind[] = [
  'rectangle',
  'ellipse',
  'diamond',
  'text',
  'path',
  'image',
  'connector',
  'container',
  'component',
];

function createJpegAsset(id = 'asset:jpeg'): SketchAsset {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
  return {
    id,
    name: 'sample.jpg',
    mimeType: 'image/jpeg',
    dataUrl: `data:image/jpeg;base64,${bytes.toString('base64')}`,
  };
}

function createWebpAsset(id = 'asset:webp'): SketchAsset {
  const bytes = Buffer.from([
    0x52, 0x49, 0x46, 0x46, // RIFF
    0x0c, 0x00, 0x00, 0x00, // size
    0x57, 0x45, 0x42, 0x50, // WEBP
    0x56, 0x50, 0x38, 0x20, // VP8
  ]);
  return {
    id,
    name: 'sample.webp',
    mimeType: 'image/webp',
    dataUrl: `data:image/webp;base64,${bytes.toString('base64')}`,
  };
}

describe('S1 domain extended contract verification', () => {
  it('creates valid documents and elements for all nine ElementKind variants', () => {
    const doc = createDocument('Architecture Canvas');
    expect(doc.schemaVersion).toBe(1);
    expect(doc.title).toBe('Architecture Canvas');
    expect(validateDocument(doc)).toEqual(doc);

    for (const kind of ALL_KINDS) {
      const el = createElement(kind, { id: `el:${kind}` });
      expect(el.id).toBe(`el:${kind}`);
      expect(el.kind).toBe(kind);
      expect(el.width).toBeGreaterThan(0);
      expect(el.height).toBeGreaterThan(0);
      expect(el.style.fontFamily).toBe('sans');
      if (kind === 'container') {
        expect(el.rotation).toBe(0);
      }
      if (kind === 'connector' || kind === 'path') {
        expect(el.points?.length).toBeGreaterThanOrEqual(2);
      }
      if (kind === 'text') {
        expect(el.text?.length).toBeGreaterThan(0);
      }
    }

    expect(() => createElement('container', { rotation: 15 })).toThrow(DomainValidationError);
    expect(() => createElement('rectangle', { kind: 'ellipse' })).toThrow(DomainValidationError);
  });

  it('rejects replace commands when the replacement document has a different id', () => {
    const docA = createDocument('Doc A');
    const docB = createDocument('Doc B');
    expect(docA.id).not.toBe(docB.id);

    expect(() => applyCommand(docA, { type: 'replace', document: docB })).toThrow(
      DomainValidationError,
    );
  });

  it('validates JPEG and WebP binary magic signatures accurately', () => {
    const jpeg = createJpegAsset();
    const webp = createWebpAsset();
    const baseDoc: SketchDocument = {
      ...createDocument('Assets'),
      assets: {
        [jpeg.id]: jpeg,
        [webp.id]: webp,
      },
      elements: [
        createElement('image', { id: 'img:1', assetId: jpeg.id }),
        createElement('image', { id: 'img:2', assetId: webp.id }),
      ],
    };

    const validated = validateDocument(baseDoc);
    expect(validated.assets[jpeg.id]).toEqual(jpeg);
    expect(validated.assets[webp.id]).toEqual(webp);

    // Mismatched WebP header declared as image/jpeg must fail
    const spoofedJpeg: SketchAsset = {
      ...jpeg,
      dataUrl: `data:image/jpeg;base64,${webp.dataUrl.slice('data:image/webp;base64,'.length)}`,
    };
    expect(() =>
      validateDocument({
        ...baseDoc,
        assets: { [jpeg.id]: spoofedJpeg, [webp.id]: webp },
      }),
    ).toThrow(DomainValidationError);
  });

  it('enforces full permutation semantics on reorder and protects reorder undo against foreign changes', () => {
    const a = createElement('rectangle', { id: 'node:a' });
    const b = createElement('ellipse', { id: 'node:b' });
    const c = createElement('diamond', { id: 'node:c' });
    const initial: SketchDocument = {
      ...createDocument('Stacking'),
      id: 'doc:stack',
      elements: [a, b, c],
    };

    expect(() => applyCommand(initial, { type: 'reorder', ids: ['node:a', 'node:b'] })).toThrow(
      DomainValidationError,
    );
    expect(() =>
      applyCommand(initial, { type: 'reorder', ids: ['node:a', 'node:b', 'node:b'] }),
    ).toThrow(DomainValidationError);
    expect(() =>
      applyCommand(initial, { type: 'reorder', ids: ['node:a', 'node:b', 'node:unknown'] }),
    ).toThrow(DomainValidationError);

    const controller = createController(initial, 0);
    const reordered = controller.dispatch(
      { type: 'reorder', ids: ['node:c', 'node:a', 'node:b'] },
      { actorId: 'actor:local', expectedRevision: 0, source: 'human' },
    );
    expect(reordered.document.elements.map((el) => el.id)).toEqual(['node:c', 'node:a', 'node:b']);

    // Undo and redo reorder cleanly when no foreign order change intervened
    const undone = controller.undo('actor:local');
    expect(undone.document.elements.map((el) => el.id)).toEqual(['node:a', 'node:b', 'node:c']);
    const redone = controller.redo('actor:local');
    expect(redone.document.elements.map((el) => el.id)).toEqual(['node:c', 'node:a', 'node:b']);

    // Foreign actor adds an element, making full-permutation reorder undo ambiguous
    controller.dispatch(
      { type: 'add', elements: [createElement('rectangle', { id: 'node:peer' })] },
      { actorId: 'actor:peer', expectedRevision: 3, source: 'peer' },
    );
    expect(controller.getHistoryState('actor:local').canUndo).toBe(false);
    expect(controller.getHistoryState('actor:local').undoConflict).toBeTruthy();
    expect(() => controller.undo('actor:local')).toThrow(DomainConflictError);
  });

  it('prevents undo from breaking foreign child or connector dependencies and preserves commits on listener throw', () => {
    const controller = createController(createDocument('Collaborative'), 0);
    const throwingListener = vi.fn(() => {
      throw new Error('UI subscriber failure');
    });
    const healthyListener = vi.fn();
    controller.subscribe(throwingListener);
    const unsubscribeHealthy = controller.subscribe(healthyListener);

    // Local actor adds a container
    const afterAdd = controller.dispatch(
      {
        type: 'add',
        elements: [createElement('container', { id: 'group:shared', x: 50, y: 50 })],
      },
      { actorId: 'actor:local', expectedRevision: 0, source: 'human' },
    );
    expect(afterAdd.revision).toBe(1);
    expect(throwingListener).toHaveBeenCalledTimes(1);
    expect(healthyListener).toHaveBeenCalledTimes(1);

    // Peer actor adds a child inside the container
    controller.dispatch(
      {
        type: 'add',
        elements: [
          createElement('rectangle', {
            id: 'node:peer-child',
            parentId: 'group:shared',
            x: 70,
            y: 70,
          }),
        ],
      },
      { actorId: 'actor:peer', expectedRevision: 1, source: 'peer' },
    );

    // Local actor cannot undo adding group:shared while peer-child is inside it
    expect(controller.getHistoryState('actor:local').canUndo).toBe(false);
    expect(() => controller.undo('actor:local')).toThrow(DomainConflictError);

    // Once peer undoes adding peer-child, local actor can undo adding group:shared
    controller.undo('actor:peer');
    expect(controller.getHistoryState('actor:local').canUndo).toBe(true);
    const finalSession = controller.undo('actor:local');
    expect(finalSession.document.elements).toHaveLength(0);

    unsubscribeHealthy();
    const textRoundtrip = serializeDocument(finalSession.document);
    expect(deserializeDocument(textRoundtrip)).toEqual(finalSession.document);
  });

  it('maintains both from and to world anchors on rotated connectors across container moves, resizes and detaches (#18)', () => {
    const group = createElement('container', { id: 'group:main', x: 0, y: 0, width: 500, height: 400 });
    const source = createElement('rectangle', {
      id: 'node:src',
      parentId: 'group:main',
      x: 40,
      y: 60,
      width: 80,
      height: 40,
      rotation: 25,
    });
    const sink = createElement('ellipse', {
      id: 'node:dst',
      x: 320,
      y: 180,
      width: 100,
      height: 50,
      rotation: -40,
    });
    const edge = createElement('connector', {
      id: 'edge:rot',
      parentId: 'group:main',
      x: 80,
      y: 90,
      width: 160,
      height: 80,
      rotation: 135,
      points: [
        { x: 0, y: 0 },
        { x: 80, y: 40 },
        { x: 160, y: 80 },
      ],
      from: { elementId: 'node:src', anchor: { x: 1, y: 0.5 } },
      to: { elementId: 'node:dst', anchor: { x: 0, y: 0.5 } },
    });

    const added = applyCommand(createDocument('Rotated connectors'), {
      type: 'add',
      elements: [group, source, sink, edge],
    });
    const addedEdge = added.elements.find((el) => el.id === 'edge:rot')!;
    const expectedFromWorld = toWorldPoint(source, { x: 80, y: 20 });
    const expectedToWorld = toWorldPoint(sink, { x: 0, y: 25 });
    expect(toWorldPoint(addedEdge, addedEdge.points![0]!).x).toBeCloseTo(expectedFromWorld.x, 8);
    expect(toWorldPoint(addedEdge, addedEdge.points![0]!).y).toBeCloseTo(expectedFromWorld.y, 8);
    expect(toWorldPoint(addedEdge, addedEdge.points![2]!).x).toBeCloseTo(expectedToWorld.x, 8);
    expect(toWorldPoint(addedEdge, addedEdge.points![2]!).y).toBeCloseTo(expectedToWorld.y, 8);

    // Move container (moves source and edge by +30, -20 while sink stays fixed)
    const movedGroup = applyCommand(added, {
      type: 'update',
      changes: [{ id: 'group:main', patch: { x: 30, y: -20 } }],
    });
    const movedSource = movedGroup.elements.find((el) => el.id === 'node:src')!;
    const movedEdge = movedGroup.elements.find((el) => el.id === 'edge:rot')!;
    const movedFromWorld = toWorldPoint(movedSource, { x: 80, y: 20 });
    expect(toWorldPoint(movedEdge, movedEdge.points![0]!).x).toBeCloseTo(movedFromWorld.x, 8);
    expect(toWorldPoint(movedEdge, movedEdge.points![0]!).y).toBeCloseTo(movedFromWorld.y, 8);
    expect(toWorldPoint(movedEdge, movedEdge.points![2]!).x).toBeCloseTo(expectedToWorld.x, 8);
    expect(toWorldPoint(movedEdge, movedEdge.points![2]!).y).toBeCloseTo(expectedToWorld.y, 8);

    // Resize and rotate the connector itself, then delete sink
    const resizedEdgeDoc = applyCommand(movedGroup, {
      type: 'update',
      changes: [{ id: 'edge:rot', patch: { width: 220, height: 110, rotation: 270 } }],
    });
    const detachedDoc = applyCommand(resizedEdgeDoc, {
      type: 'delete',
      ids: ['node:dst'],
    });
    const detachedEdge = detachedDoc.elements.find((el) => el.id === 'edge:rot')!;
    expect(detachedEdge.from?.elementId).toBe('node:src');
    expect(detachedEdge.to).toBeUndefined();
    expect(toWorldPoint(detachedEdge, detachedEdge.points![0]!).x).toBeCloseTo(movedFromWorld.x, 8);
    expect(toWorldPoint(detachedEdge, detachedEdge.points![0]!).y).toBeCloseTo(movedFromWorld.y, 8);
    expect(toWorldPoint(detachedEdge, detachedEdge.points![2]!).x).toBeCloseTo(expectedToWorld.x, 8);
    expect(toWorldPoint(detachedEdge, detachedEdge.points![2]!).y).toBeCloseTo(expectedToWorld.y, 8);
  });

  it('preserves unrelated foreign fields when undoing/redoing a replace kind change and detects kind conflicts (#19)', () => {
    const base = createDocument('Kind collaboration');
    base.elements = [createElement('rectangle', { id: 'shape:1', x: 10, text: 'Initial' })];
    const controller = createController(base, 0);

    // Local actor replaces rectangle with diamond
    const replaceDoc = controller.getSnapshot().document;
    replaceDoc.elements[0]!.kind = 'diamond';
    controller.dispatch(
      { type: 'replace', document: replaceDoc },
      { actorId: 'actor:local', expectedRevision: 0, source: 'code' },
    );

    // Peer actor updates text and x on the same element
    controller.dispatch(
      { type: 'update', changes: [{ id: 'shape:1', patch: { x: 95, text: 'Peer note' } }] },
      { actorId: 'actor:peer', expectedRevision: 1, source: 'peer' },
    );

    // Local undo restores kind to rectangle without overwriting peer's x or text
    const afterUndo = controller.undo('actor:local');
    expect(afterUndo.document.elements[0]).toMatchObject({
      id: 'shape:1',
      kind: 'rectangle',
      x: 95,
      text: 'Peer note',
    });

    // Local redo restores kind to diamond while still preserving peer's x and text
    const afterRedo = controller.redo('actor:local');
    expect(afterRedo.document.elements[0]).toMatchObject({
      id: 'shape:1',
      kind: 'diamond',
      x: 95,
      text: 'Peer note',
    });

    // If peer changes kind via replace, local undo must report a conflict
    const peerReplace = controller.getSnapshot().document;
    peerReplace.elements[0]!.kind = 'ellipse';
    controller.dispatch(
      { type: 'replace', document: peerReplace },
      { actorId: 'actor:peer', expectedRevision: 4, source: 'code' },
    );
    expect(controller.getHistoryState('actor:local').canUndo).toBe(false);
    expect(() => controller.undo('actor:local')).toThrow(DomainConflictError);
    expect(controller.getSnapshot().document.elements[0]!.kind).toBe('ellipse');
  });

  it('enforces canonical JSON byte budget across validateDocument, applyCommand, createController and undo/redo (#20)', () => {
    // 336 entries of 50,000 quotes: each quote escapes to \" (2 bytes in canonical JSON), exceeding 32 MiB
    const escapedChunk = '"'.repeat(DOMAIN_LIMITS.MAX_TEXT_LENGTH);
    const count = 340;
    const oversizedDoc = createDocument('Escaped budget');
    oversizedDoc.metadata = Object.fromEntries(
      Array.from({ length: count }, (_, i) => [`k${i}`, escapedChunk]),
    );

    expect(() => validateDocument(oversizedDoc)).toThrow(DomainValidationError);
    expect(() => createController(oversizedDoc)).toThrow(DomainValidationError);
    expect(() =>
      applyCommand(createDocument('Base'), {
        type: 'set-metadata',
        patch: oversizedDoc.metadata,
      }),
    ).toThrow(DomainValidationError);

    // Undo conflict when restoring removed metadata on top of peer metadata would exceed 32 MiB
    const halfCount = 175;
    const halfMetaA = Object.fromEntries(
      Array.from({ length: halfCount }, (_, i) => [`a${i}`, escapedChunk]),
    );
    const halfMetaB = Object.fromEntries(
      Array.from({ length: halfCount }, (_, i) => [`b${i}`, escapedChunk]),
    );
    const initialWithA = createDocument('Half A');
    initialWithA.metadata = halfMetaA;
    const controller = createController(initialWithA, 0);

    // Local actor deletes all a* keys
    const deleteAPatch = Object.fromEntries(
      Array.from({ length: halfCount }, (_, i) => [`a${i}`, null]),
    );
    controller.dispatch(
      { type: 'set-metadata', patch: deleteAPatch },
      { actorId: 'actor:local', expectedRevision: 0, source: 'human' },
    );

    // Peer actor adds b* keys (fits within 32 MiB on its own)
    controller.dispatch(
      { type: 'set-metadata', patch: halfMetaB },
      { actorId: 'actor:peer', expectedRevision: 1, source: 'peer' },
    );

    // Undoing local deletion would combine a* and b* (> 32 MiB canonical JSON), so undo must fail cleanly
    expect(controller.getHistoryState('actor:local').canUndo).toBe(false);
    expect(() => controller.undo('actor:local')).toThrow(DomainConflictError);
    expect(controller.getSnapshot().revision).toBe(2);
    expect(() => serializeDocument(controller.getSnapshot().document)).not.toThrow();
  });

  it('enforces safe revision boundaries on context, getHistoryState, and no-op batches (#21)', () => {
    const controller = createController(createDocument('Safe limit'), Number.MAX_SAFE_INTEGER - 1);

    expect(() =>
      controller.dispatch(
        { type: 'rename', title: 'Unsafe expectedRevision' },
        { actorId: 'actor:local', expectedRevision: 2 ** 53, source: 'human' },
      ),
    ).toThrow(DomainValidationError);

    controller.dispatch(
      { type: 'rename', title: 'Reached max safe' },
      { actorId: 'actor:local', expectedRevision: Number.MAX_SAFE_INTEGER - 1, source: 'human' },
    );
    expect(controller.getSnapshot().revision).toBe(Number.MAX_SAFE_INTEGER);

    // At MAX_SAFE_INTEGER, getHistoryState reports canUndo: false with conflict explanation
    const historyAtLimit = controller.getHistoryState('actor:local');
    expect(historyAtLimit.canUndo).toBe(false);
    expect(historyAtLimit.undoConflict).toBeTruthy();

    // A batch that nets to a semantic No-Op is still permitted at MAX_SAFE_INTEGER
    const noOpBatch = controller.dispatch(
      {
        type: 'batch',
        commands: [
          { type: 'rename', title: 'Temporary title' },
          { type: 'rename', title: 'Reached max safe' },
        ],
      },
      { actorId: 'actor:local', expectedRevision: Number.MAX_SAFE_INTEGER, source: 'human' },
    );
    expect(noOpBatch.revision).toBe(Number.MAX_SAFE_INTEGER);
    expect(noOpBatch.document.title).toBe('Reached max safe');
  });
});
