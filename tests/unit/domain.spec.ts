import { Buffer } from 'node:buffer';
import { crc32 } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import {
  applyCommand,
  createController,
  deserializeDocument,
  DOMAIN_LIMITS,
  DomainConflictError,
  DomainValidationError,
  serializeDocument,
  validateDocument,
} from '../../src/domain/index';
import type {
  DocumentCommand,
  ElementKind,
  SketchAsset,
  SketchDocument,
  SketchElement,
} from '../../src/domain/types';

// Contract acceptance for docs/contracts.md, S1 v2 (#9 / #15).
// Fixtures use fixed IDs and explicit geometry; they do not depend on factory defaults.
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';

function element(id: string, kind: ElementKind = 'rectangle', overrides: Partial<SketchElement> = {}): SketchElement {
  return {
    id, pageId: 'page:1', kind, x: 0, y: 0, width: 40, height: 20, rotation: 0,
    style: {
      stroke: '#111111', fill: '#ffffff', strokeWidth: 2, opacity: 1,
      fontSize: 16, textAlign: 'left', strokeDash: 'solid', fontFamily: 'sans',
    },
    ...overrides,
  };
}

function document(elements: SketchElement[] = [], assets: SketchAsset[] = []): SketchDocument {
  return {
    schemaVersion: 2, id: 'document:acceptance', title: 'Acceptance workspace', pages: [{ id: 'page:1', name: 'Seite 1' }], elements,
    assets: Object.fromEntries(assets.map((asset) => [asset.id, asset])),
    componentSets: [], metadata: {},
  };
}

function pngAsset(id = 'asset:pixel'): SketchAsset {
  return { id, name: 'pixel.png', mimeType: 'image/png', dataUrl: `data:image/png;base64,${PNG_BASE64}` };
}

function paddedPngAsset(decodedBytes: number, id: string): SketchAsset {
  // A valid ancillary text chunk makes the file large without invalidating its image data.
  const png = Buffer.from(PNG_BASE64, 'base64');
  const payloadLength = decodedBytes - png.length - 12;
  const typeAndPayload = Buffer.alloc(payloadLength + 4, 0x20);
  typeAndPayload.write('tEXtComment\0', 0, 'ascii');
  const chunk = Buffer.alloc(payloadLength + 12);
  chunk.writeUInt32BE(payloadLength, 0);
  typeAndPayload.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(typeAndPayload), payloadLength + 8);
  const bytes = Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)]);
  return { ...pngAsset(id), dataUrl: `data:image/png;base64,${bytes.toString('base64')}` };
}

function find(doc: SketchDocument, id: string): SketchElement {
  const found = doc.elements.find((entry) => entry.id === id);
  if (!found) throw new Error(`Missing fixture element ${id}`);
  return found;
}

function endpoint(doc: SketchDocument, id: string, side: 'first' | 'last') {
  const connector = find(doc, id);
  const point = side === 'first' ? connector.points?.[0] : connector.points?.at(-1);
  if (!point) throw new Error(`Missing connector endpoint ${id}`);
  return { x: connector.x + point.x, y: connector.y + point.y };
}

function context(expectedRevision: number, actorId = 'actor:local') {
  return { actorId, expectedRevision, source: 'human' as const };
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function expectValidation(action: () => unknown): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainValidationError);
    if (!(error instanceof DomainValidationError)) throw error;
    expect(error.issues.length).toBeGreaterThan(0);
    for (const issue of error.issues) {
      expect(typeof issue.path).toBe('string');
      expect(issue.code.length).toBeGreaterThan(0);
      expect(issue.message.length).toBeGreaterThan(0);
    }
    return;
  }
  throw new Error('Expected a structured DomainValidationError');
}

describe('S1 domain acceptance', () => {
  it('applies JSON null deletions while merging style and metadata fields', () => {
    const original = document([element('node:a', 'rectangle', {
      text: 'Remove me', documentationUrl: 'https://example.com/docs',
      label: 'Old label', description: 'Remove description',
      metadata: { owner: 'Alice', region: 'eu', obsolete: 'yes' },
    })]);
    const command = JSON.parse(JSON.stringify({
      type: 'update', changes: [{ id: 'node:a', patch: {
        text: null, documentationUrl: null, label: 'Accessible name', description: null,
        style: { fill: '#00ff00', fontFamily: 'mono' },
        metadata: { owner: 'Bob', obsolete: null },
      } }],
    })) as DocumentCommand;

    const updated = applyCommand(original, command);
    expect(find(updated, 'node:a').style).toEqual({ ...find(original, 'node:a').style, fill: '#00ff00', fontFamily: 'mono' });
    expect(find(updated, 'node:a').metadata).toEqual({ owner: 'Bob', region: 'eu' });
    expect(find(updated, 'node:a')).not.toHaveProperty('text');
    expect(find(updated, 'node:a')).not.toHaveProperty('documentationUrl');
    expect(find(updated, 'node:a')).not.toHaveProperty('description');
    expect(find(updated, 'node:a').label).toBe('Accessible name');

    const cleared = applyCommand(updated, { type: 'update', changes: [{ id: 'node:a', patch: { metadata: null } }] });
    expect(find(cleared, 'node:a')).not.toHaveProperty('metadata');
    const withMetadata = applyCommand(cleared, { type: 'set-metadata', patch: { owner: 'Alice', obsolete: 'yes' } });
    expect(applyCommand(withMetadata, { type: 'set-metadata', patch: { obsolete: null } }).metadata).toEqual({ owner: 'Alice' });
  });

  it('rejects forbidden patch fields, non-JSON values and removal of connector points', () => {
    const original = document([
      element('node:a'),
      element('edge:a', 'connector', { points: [{ x: 0, y: 0 }, { x: 40, y: 20 }] }),
    ]);
    const patches: unknown[] = [
      { id: 'node:renamed' }, { kind: 'ellipse' }, { unexpected: true },
      { x: Number.NaN }, { text: undefined }, { metadata: { count: 3 } },
    ];
    for (const patch of patches) {
      expectValidation(() => applyCommand(original, {
        type: 'update', changes: [{ id: 'node:a', patch }],
      } as DocumentCommand));
    }
    expectValidation(() => applyCommand(original, {
      type: 'update', changes: [{ id: 'edge:a', patch: { points: null } }],
    }));
    expectValidation(() => applyCommand(original, {
      type: 'update', changes: [{ id: 'node:a', patch: { x: 1 } }, { id: 'node:a', patch: { y: 2 } }],
    }));
    expectValidation(() => applyCommand(original, { type: 'delete', ids: ['node:a', 'node:a'] }));
    expectValidation(() => applyCommand(original, { type: 'delete', ids: ['node:missing'] }));
    expect(find(original, 'node:a').id).toBe('node:a');
  });

  it('rolls back a failing batch without changing state, revision, history or notifications', () => {
    const controller = createController(document([element('node:a')]), 7);
    const before = controller.getSnapshot();
    const listener = vi.fn();
    controller.subscribe(listener);

    expectValidation(() => controller.dispatch({ type: 'batch', commands: [
      { type: 'update', changes: [{ id: 'node:a', patch: { x: 50 } }] },
      { type: 'update', changes: [{ id: 'node:missing', patch: { y: 30 } }] },
    ] }, context(7)));

    expect(controller.getSnapshot()).toEqual(before);
    expect(controller.getHistoryState('actor:local')).toMatchObject({ canUndo: false, canRedo: false });
    expect(listener).not.toHaveBeenCalled();
  });

  it('commits a completed gesture batch as one revision, notification and undo unit', () => {
    const controller = createController(document([element('node:a')]), 7);
    const listener = vi.fn();
    controller.subscribe(listener);
    const initial = controller.getSnapshot();
    controller.dispatch({ type: 'update', changes: [{ id: 'node:a', patch: { x: 0 } }] }, context(7));
    expect(controller.getSnapshot()).toEqual(initial);
    expect(controller.getHistoryState('actor:local')).toMatchObject({ canUndo: false, canRedo: false });
    expect(listener).not.toHaveBeenCalled();
    const result = controller.dispatch({ type: 'batch', commands: [
      { type: 'update', changes: [{ id: 'node:a', patch: { x: 50 } }] },
      { type: 'update', changes: [{ id: 'node:a', patch: { y: 30 } }] },
    ] }, context(7));

    expect(result.revision).toBe(8);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(find(listener.mock.calls[0]![0].document, 'node:a')).toMatchObject({ x: 50, y: 30 });
    expect(controller.undo('actor:local').revision).toBe(9);
    expect(find(controller.getSnapshot().document, 'node:a')).toMatchObject({ x: 0, y: 0 });
    expect(controller.getHistoryState('actor:local')).toMatchObject({ canUndo: false, canRedo: true });
    expect(controller.redo('actor:local').revision).toBe(10);
    expect(find(controller.getSnapshot().document, 'node:a')).toMatchObject({ x: 50, y: 30 });
  });

  it('moves absolute container descendants exactly once and resizes only the boundary', () => {
    const original = document([
      element('group:outer', 'container', { x: 100, y: 100, width: 400, height: 300 }),
      element('group:inner', 'container', { parentId: 'group:outer', x: 140, y: 150, width: 150, height: 100 }),
      element('node:child', 'rectangle', { parentId: 'group:inner', x: 170, y: 180 }),
      element('node:outside', 'rectangle', { x: 600, y: 400 }),
    ]);
    const moved = applyCommand(original, {
      type: 'update', changes: [{ id: 'group:outer', patch: { x: 125, y: 80 } }],
    });
    expect(find(moved, 'group:inner')).toMatchObject({ x: 165, y: 130 });
    expect(find(moved, 'node:child')).toMatchObject({ x: 195, y: 160 });
    expect(find(moved, 'node:outside')).toEqual(find(original, 'node:outside'));

    const resized = applyCommand(moved, {
      type: 'update', changes: [{ id: 'group:outer', patch: { width: 800, height: 600 } }],
    });
    expect(find(resized, 'group:inner')).toEqual(find(moved, 'group:inner'));
    expect(find(resized, 'node:child')).toEqual(find(moved, 'node:child'));
  });

  it('keeps absolute geometry when reparenting or detaching an element', () => {
    const original = document([
      element('group:left', 'container', { x: 0, y: 0, width: 200, height: 200 }),
      element('group:right', 'container', { x: 400, y: 200, width: 200, height: 200 }),
      element('node:child', 'rectangle', { parentId: 'group:left', x: 50, y: 60, rotation: 30 }),
    ]);
    const reparented = applyCommand(original, {
      type: 'update', changes: [{ id: 'node:child', patch: { parentId: 'group:right' } }],
    });
    expect(find(reparented, 'node:child')).toEqual({ ...find(original, 'node:child'), parentId: 'group:right' });
    const detached = applyCommand(reparented, {
      type: 'update', changes: [{ id: 'node:child', patch: { parentId: null } }],
    });
    expect(find(detached, 'node:child')).toMatchObject({ x: 50, y: 60, width: 40, height: 20, rotation: 30 });
    expect(find(detached, 'node:child')).not.toHaveProperty('parentId');
  });

  it('tracks moved and rotated target anchors and preserves their visible endpoint on deletion', () => {
    const original = document([
      element('node:target', 'rectangle', { x: 100, y: 100 }),
      element('edge:a', 'connector', {
        x: 10, y: 20, points: [{ x: 0, y: 0 }, { x: 130, y: 90 }],
        to: { elementId: 'node:target', anchor: { x: 1, y: 0.5 } },
      }),
    ]);
    const moved = applyCommand(original, {
      type: 'update', changes: [{ id: 'node:target', patch: { x: 200, y: 150 } }],
    });
    expect(endpoint(moved, 'edge:a', 'last')).toEqual({ x: 240, y: 160 });
    const rotated = applyCommand(moved, {
      type: 'update', changes: [{ id: 'node:target', patch: { rotation: 90 } }],
    });
    expect(endpoint(rotated, 'edge:a', 'last').x).toBeCloseTo(220);
    expect(endpoint(rotated, 'edge:a', 'last').y).toBeCloseTo(180);

    const deleted = applyCommand(rotated, { type: 'delete', ids: ['node:target'] });
    expect(deleted.elements.map((entry) => entry.id)).toEqual(['edge:a']);
    expect(find(deleted, 'edge:a')).not.toHaveProperty('to');
    expect(endpoint(deleted, 'edge:a', 'last')).toEqual(endpoint(rotated, 'edge:a', 'last'));
    expect(validateDocument(deleted)).toEqual(deleted);
  });

  it('cascades container deletion without deleting external connectors or orphaned assets', () => {
    const asset = pngAsset();
    const original = document([
      element('group:outer', 'container', { width: 200, height: 200 }),
      element('group:inner', 'container', { parentId: 'group:outer', width: 100, height: 100 }),
      element('node:child', 'rectangle', { parentId: 'group:inner', x: 30, y: 40, width: 20, height: 10 }),
      element('node:outside', 'rectangle', { x: 300, y: 100 }),
      element('edge:external', 'connector', {
        points: [{ x: 320, y: 110 }, { x: 50, y: 45 }],
        from: { elementId: 'node:outside', anchor: { x: 0.5, y: 0.5 } },
        to: { elementId: 'node:child', anchor: { x: 1, y: 0.5 } },
      }),
    ], [asset]);
    const result = applyCommand(original, { type: 'delete', ids: ['group:outer'] });
    expect(result.elements.map((entry) => entry.id)).toEqual(['node:outside', 'edge:external']);
    expect(find(result, 'edge:external').from?.elementId).toBe('node:outside');
    expect(find(result, 'edge:external')).not.toHaveProperty('to');
    expect(endpoint(result, 'edge:external', 'last')).toEqual({ x: 50, y: 45 });
    expect(result.assets).toEqual(original.assets);
  });

  it('rejects a stale revision and reports the current revision without side effects', () => {
    const controller = createController(document([element('node:a')]), 10);
    controller.dispatch({ type: 'rename', title: 'Already updated' }, context(10, 'actor:peer'));
    const before = controller.getSnapshot();
    const listener = vi.fn();
    controller.subscribe(listener);
    const action = () => controller.dispatch({ type: 'rename', title: 'Stale write' }, context(10));

    expect(action).toThrow(DomainConflictError);
    try { action(); } catch (error) {
      expect(error).toMatchObject({ code: 'REVISION_CONFLICT', currentRevision: 11 });
    }
    expect(controller.getSnapshot()).toEqual(before);
    expect(controller.getHistoryState('actor:local').canUndo).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('undoes and redoes local work without removing a foreign element or unrelated field change', () => {
    const controller = createController(document([element('node:a')]));
    controller.dispatch({ type: 'update', changes: [{ id: 'node:a', patch: { x: 50 } }] }, context(0));
    controller.dispatch({ type: 'batch', commands: [
      { type: 'add', elements: [element('node:peer', 'ellipse', { x: 300 })] },
      { type: 'update', changes: [{ id: 'node:a', patch: { text: 'Peer annotation' } }] },
    ] }, { ...context(1, 'actor:peer'), source: 'peer' });

    const undone = controller.undo('actor:local');
    expect(find(undone.document, 'node:a')).toMatchObject({ x: 0, text: 'Peer annotation' });
    expect(find(undone.document, 'node:peer')).toEqual(element('node:peer', 'ellipse', { x: 300 }));
    const redone = controller.redo('actor:local');
    expect(find(redone.document, 'node:a')).toMatchObject({ x: 50, text: 'Peer annotation' });
    expect(find(redone.document, 'node:peer')).toEqual(find(undone.document, 'node:peer'));
    expect(controller.getHistoryState('actor:peer').canUndo).toBe(true);
  });

  it('reports a history conflict when another actor changed the same field', () => {
    const controller = createController(document([element('node:a')]));
    controller.dispatch({ type: 'update', changes: [{ id: 'node:a', patch: { x: 50 } }] }, context(0));
    controller.dispatch({ type: 'update', changes: [{ id: 'node:a', patch: { x: 90 } }] }, context(1, 'actor:peer'));
    const before = controller.getSnapshot();
    const listener = vi.fn();
    controller.subscribe(listener);

    expect(() => controller.undo('actor:local')).toThrow(DomainConflictError);
    try { controller.undo('actor:local'); } catch (error) {
      expect(error).toMatchObject({ code: 'HISTORY_CONFLICT' });
    }
    expect(controller.getSnapshot()).toEqual(before);
    expect(find(controller.getSnapshot().document, 'node:a').x).toBe(90);
    expect(controller.getHistoryState('actor:local')).toMatchObject({ canUndo: false });
    expect(controller.getHistoryState('actor:local').undoConflict).toBeTruthy();
    expect(listener).not.toHaveBeenCalled();
  });

  it('never mutates input documents or lets a snapshot mutate controller state', () => {
    const original = freeze(document([element('node:a', 'rectangle', { metadata: { owner: 'Alice' } })]));
    const before = JSON.parse(JSON.stringify(original));
    const command = freeze<DocumentCommand>({ type: 'update', changes: [{ id: 'node:a', patch: { x: 50 } }] });
    expect(find(applyCommand(original, command), 'node:a').x).toBe(50);
    expect(original).toEqual(before);

    const controller = createController(original);
    const snapshot = controller.getSnapshot();
    // Both detached mutable snapshots and deeply frozen snapshots satisfy the public contract.
    try { find(snapshot.document, 'node:a').metadata!.owner = 'Intruder'; } catch { /* Frozen snapshot. */ }
    try { snapshot.document.title = 'Intruder'; } catch { /* Frozen snapshot. */ }
    expect(controller.getSnapshot()).toEqual({ document: before, revision: 0 });
    const historicSnapshot = controller.getSnapshot();
    controller.dispatch(command, context(0));
    expect(historicSnapshot).toEqual({ document: before, revision: 0 });
    expect(find(controller.getSnapshot().document, 'node:a').x).toBe(50);
  });

  it('validates graph references, uniqueness and acyclic containers while allowing one related add', () => {
    const invalidDocuments = [
      document([element('node:a'), element('node:a')]),
      document([element('node:a', 'rectangle', { parentId: 'group:missing' })]),
      document([element('edge:a', 'connector', {
        points: [{ x: 0, y: 0 }, { x: 40, y: 20 }],
        to: { elementId: 'node:missing', anchor: { x: 1, y: 0.5 } },
      })]),
      document([
        element('group:a', 'container', { parentId: 'group:b' }),
        element('group:b', 'container', { parentId: 'group:a' }),
      ]),
      document([element('image:a', 'image', { assetId: 'asset:missing' })]),
      document([element('component:a', 'component', { componentType: 'custom.missing' })]),
      document([element('node:a', 'rectangle', { assetId: 'asset:pixel' })], [pngAsset()]),
      document([element('node:a', 'rectangle', { points: [{ x: 0, y: 0 }, { x: 40, y: 20 }] })]),
      document([
        element('node:a'),
        element('node:b', 'rectangle', { from: { elementId: 'node:a', anchor: { x: 0.5, y: 0.5 } } }),
      ]),
    ];
    for (const invalid of invalidDocuments) expectValidation(() => validateDocument(invalid));

    const result = applyCommand(document(), { type: 'add', elements: [
      element('node:child', 'rectangle', { parentId: 'group:new', x: 10, y: 10 }),
      element('group:new', 'container', { width: 100, height: 100 }),
    ] });
    expect(result.elements).toHaveLength(2);
    expect(find(result, 'node:child').parentId).toBe('group:new');
  });

  it('enforces the published payload, geometry, text, identity and batch limits', () => {
    expect(DOMAIN_LIMITS).toMatchObject({
      MAX_DOCUMENT_JSON_BYTES: 32 * 1024 * 1024, MAX_ELEMENTS: 10_000,
      MAX_CONTAINER_DEPTH: 32, MAX_ID_LENGTH: 128, MAX_TEXT_LENGTH: 50_000,
      MAX_POINTS_PER_ELEMENT: 10_000, MAX_ASSET_BYTES: 8 * 1024 * 1024,
      MAX_TOTAL_ASSET_BYTES: 20 * 1024 * 1024, MAX_COORDINATE_ABS: 1_000_000,
      MAX_DIMENSION: 1_000_000, MAX_BATCH_COMMANDS: 1_000, MAX_BATCH_DEPTH: 4,
    });
    const invalidElements = [
      element(''), element('id with spaces'), element('x'.repeat(129)),
      element('node:a', 'rectangle', { x: 1_000_001 }),
      element('node:a', 'rectangle', { y: -1_000_001 }),
      element('node:a', 'rectangle', { width: -1 }),
      element('node:a', 'rectangle', { width: 0 }),
      element('node:a', 'rectangle', { height: 1_000_001 }),
      element('node:a', 'rectangle', { rotation: Number.POSITIVE_INFINITY }),
      element('node:a', 'text', { text: 'x'.repeat(50_001) }),
      element('node:a', 'path', { points: Array.from({ length: 10_001 }, () => ({ x: 0, y: 0 })) }),
    ];
    for (const invalid of invalidElements) expectValidation(() => validateDocument(document([invalid])));
    expect(validateDocument(document([element('edge:vertical', 'connector', {
      width: 0, points: [{ x: 0, y: 0 }, { x: 0, y: 20 }],
    })])).elements).toHaveLength(1);
    expectValidation(() => validateDocument(document(Array.from({ length: 10_001 }, (_, index) => element(`node:${index}`)))));
    expectValidation(() => validateDocument(document(Array.from({ length: 34 }, (_, index) =>
      element(`group:${index}`, 'container', index === 0 ? {} : { parentId: `group:${index - 1}` }),
    ))));
    expectValidation(() => applyCommand(document(), {
      type: 'batch', commands: Array.from({ length: 1_001 }, (_, index) => ({ type: 'rename', title: `Title ${index}` })),
    }));
    let nested: DocumentCommand = { type: 'rename', title: 'Nested' };
    for (let depth = 0; depth < 6; depth += 1) nested = { type: 'batch', commands: [nested] };
    expectValidation(() => applyCommand(document(), nested));
    // This valid JSON is shorter than 32 MiB in UTF-16 characters, but larger in UTF-8 bytes.
    const oversized = JSON.stringify({
      ...document(),
      metadata: Object.fromEntries(Array.from({ length: 336 }, (_, index) => [`payload:${index}`, 'é'.repeat(50_000)])),
    });
    expect(oversized.length).toBeLessThan(32 * 1024 * 1024);
    expect(Buffer.byteLength(oversized, 'utf8')).toBeGreaterThan(32 * 1024 * 1024);
    expectValidation(() => deserializeDocument(oversized));
  });

  it('accepts a real embedded PNG and rejects mismatched, malformed or oversized asset payloads', () => {
    const valid = pngAsset();
    expect(validateDocument(document([element('image:a', 'image', { assetId: valid.id })], [valid])).assets[valid.id]).toEqual(valid);
    const invalidAssets: SketchAsset[] = [
      { ...valid, dataUrl: 'https://example.com/pixel.png' },
      { ...valid, dataUrl: 'data:image/png;base64,%%%not-base64%%%' },
      { ...valid, dataUrl: 'data:image/png;base64,aGVsbG8=' },
      { ...valid, mimeType: 'image/jpeg', dataUrl: `data:image/jpeg;base64,${PNG_BASE64}` },
      { ...valid, dataUrl: `data:image/jpeg;base64,${PNG_BASE64}` },
    ];
    for (const invalid of invalidAssets) expectValidation(() => validateDocument(document([], [invalid])));

    const tooLarge = paddedPngAsset(8 * 1024 * 1024 + 1, 'asset:oversized');
    expectValidation(() => validateDocument(document([], [tooLarge])));
    // Encoded length exceeds 8 MiB; the documented limit applies to decoded image bytes.
    const largeValid = paddedPngAsset(7 * 1024 * 1024, 'asset:large');
    expect(validateDocument(document([], [largeValid])).assets[largeValid.id]).toEqual(largeValid);
    expectValidation(() => validateDocument(document([], ['a', 'b', 'c'].map((suffix) => ({
      ...largeValid, id: `asset:${suffix}`,
    })))));
  });

  it('rejects hostile records, unknown fields, cyclic objects and non-JSON data', () => {
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const hostile = JSON.parse(JSON.stringify(document())) as SketchDocument;
      hostile.metadata = JSON.parse(`{"${key}":"forbidden"}`) as Record<string, string>;
      expectValidation(() => validateDocument(hostile));
    }
    expectValidation(() => validateDocument({ ...document(), unknown: true }));
    expectValidation(() => validateDocument({ ...document(), metadata: { unexpected: undefined } }));
    expectValidation(() => validateDocument({ ...document(), metadata: { callback: () => 'unsafe' } }));
    const cyclic: Record<string, unknown> = { ...document() };
    cyclic.metadata = { cyclic };
    expectValidation(() => validateDocument(cyclic));
    expectValidation(() => deserializeDocument('{"schemaVersion":'));
    expectValidation(() => deserializeDocument(JSON.stringify({ ...document(), schemaVersion: 99 })));
  });

  it('allows only absolute HTTP(S) documentation URLs in elements and component definitions', () => {
    for (const url of ['https://example.com/docs#diagram', 'http://localhost:8080/docs']) {
      expect(validateDocument(document([element('node:a', 'rectangle', { documentationUrl: url })])).elements).toHaveLength(1);
    }
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hello', '//example.com/docs', '/docs']) {
      expectValidation(() => validateDocument(document([element('node:a', 'rectangle', { documentationUrl: url })])));
      const withComponent = document();
      withComponent.componentSets = [{ id: 'set:custom', name: 'Custom', version: '1', components: [{
        type: 'custom.box', name: 'Box', provider: 'custom', category: 'General',
        defaultWidth: 40, defaultHeight: 20, style: {}, documentationUrl: url,
      }] }];
      expectValidation(() => validateDocument(withComponent));
    }
  });

  it('round-trips documents deterministically and validates an atomic replacement', () => {
    const asset = pngAsset();
    const original = document([
      element('image:z', 'image', { assetId: asset.id, x: -0, y: 1.234567891234 }),
      element('node:a', 'rectangle', { label: 'Rectangle', description: 'Accessible description' }),
    ], [asset]);
    original.metadata = { z: 'last', a: 'first' };
    const serialized = serializeDocument(original);
    expect(serializeDocument(original)).toBe(serialized);
    expect(serialized.startsWith('{\n  "assets": {')).toBe(true);
    expect(serialized).toContain('"metadata": {\n    "a": "first",\n    "z": "last"\n  }');
    expect(serialized).not.toContain('\r');
    expect(serialized.endsWith('}\n')).toBe(true);
    const restored = deserializeDocument(serialized);
    expect(serializeDocument(restored)).toBe(serialized);
    expect(restored.elements.map((entry) => entry.id)).toEqual(['image:z', 'node:a']);
    expect(Object.is(find(restored, 'image:z').x, -0)).toBe(false);
    expect(find(restored, 'image:z').y).toBe(1.234567891234);
    expect(find(restored, 'node:a')).toEqual(find(original, 'node:a'));
    expect(restored.assets).toEqual(original.assets);
    expect(restored.metadata).toEqual(original.metadata);
    const replacement = { ...restored, title: 'Replacement', metadata: { owner: 'Alice' } };
    const replaced = applyCommand(original, { type: 'replace', document: replacement });
    expect(replaced).toEqual(replacement);
    expect(replaced.id).toBe(original.id);
    expectValidation(() => applyCommand(original, {
      type: 'replace', document: { ...replacement, assets: {} },
    }));
    expect(original.title).toBe('Acceptance workspace');
    expect(original.assets[asset.id]).toEqual(asset);
  });
});
