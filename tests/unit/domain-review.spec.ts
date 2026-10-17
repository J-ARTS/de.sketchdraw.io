import { describe, expect, it } from 'vitest';
import {
  createController,
  createDocument,
  createElement,
  DOMAIN_LIMITS,
  DomainValidationError,
  serializeDocument,
} from '../../src/domain/index';

describe('independent domain review regressions', () => {
  it('undo restores an element kind changed by a valid replace transaction', () => {
    const original = createDocument('Kind history');
    original.elements = [createElement('rectangle', { id: 'shape' })];
    const controller = createController(original);
    const replacement = controller.getSnapshot().document;
    replacement.elements[0]!.kind = 'ellipse';
    controller.dispatch({ type: 'replace', document: replacement }, {
      actorId: 'local', source: 'code', expectedRevision: 0,
    });

    expect(controller.getSnapshot().document.elements[0]!.kind).toBe('ellipse');
    expect(controller.undo('local').document.elements[0]!.kind).toBe('rectangle');
    expect(controller.redo('local').document.elements[0]!.kind).toBe('ellipse');
  });

  it('rejects a transaction that would make the canonical document impossible to save', () => {
    const controller = createController(createDocument('Document budget'));
    const value = 'x'.repeat(DOMAIN_LIMITS.MAX_TEXT_LENGTH);
    const count = Math.ceil(DOMAIN_LIMITS.MAX_DOCUMENT_JSON_BYTES / value.length);
    const patch = Object.fromEntries(Array.from({ length: count }, (_, i) => [`key${i}`, value]));

    expect(() => controller.dispatch({ type: 'set-metadata', patch }, {
      actorId: 'remote', source: 'agent', expectedRevision: 0,
    })).toThrow(DomainValidationError);
    expect(controller.getSnapshot().revision).toBe(0);
    expect(() => serializeDocument(controller.getSnapshot().document)).not.toThrow();
  });

  it('refuses a commit, undo or redo that would overflow a safe revision', () => {
    const atLimit = createController(createDocument('At limit'), Number.MAX_SAFE_INTEGER);
    expect(() => atLimit.dispatch({ type: 'rename', title: 'At limit' }, {
      actorId: 'local', source: 'human', expectedRevision: Number.MAX_SAFE_INTEGER,
    })).not.toThrow();
    expect(() => atLimit.dispatch({ type: 'rename', title: 'Changed' }, {
      actorId: 'local', source: 'human', expectedRevision: Number.MAX_SAFE_INTEGER,
    })).toThrow();
    expect(atLimit.getSnapshot().document.title).toBe('At limit');
    expect(atLimit.getSnapshot().revision).toBe(Number.MAX_SAFE_INTEGER);

    const undoLimit = createController(createDocument('Before'), Number.MAX_SAFE_INTEGER - 1);
    undoLimit.dispatch({ type: 'rename', title: 'After' }, {
      actorId: 'local', source: 'human', expectedRevision: Number.MAX_SAFE_INTEGER - 1,
    });
    expect(() => undoLimit.undo('local')).toThrow();
    expect(undoLimit.getSnapshot().document.title).toBe('After');
    expect(undoLimit.getSnapshot().revision).toBe(Number.MAX_SAFE_INTEGER);

    const redoLimit = createController(createDocument('Before'), Number.MAX_SAFE_INTEGER - 2);
    redoLimit.dispatch({ type: 'rename', title: 'After' }, {
      actorId: 'local', source: 'human', expectedRevision: Number.MAX_SAFE_INTEGER - 2,
    });
    redoLimit.undo('local');
    expect(() => redoLimit.redo('local')).toThrow();
    expect(redoLimit.getSnapshot().document.title).toBe('Before');
    expect(redoLimit.getSnapshot().revision).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('rejects an initial revision at which successful commands cannot advance the revision', () => {
    expect(() => createController(createDocument(), 2 ** 53)).toThrow(DomainValidationError);
  });
});
