import { createNanoEvents } from 'nanoevents';
import * as Y from 'yjs';
import {
  applyCommand,
  DomainConflictError,
  DomainValidationError,
  type CommandContext,
  type DocumentCommand,
  type DocumentSession,
  type HistoryAvailability,
  type SketchDocument,
} from '../domain';
import { areDocumentsEqual, cloneDocument } from '../domain/geometry';
import { cloneCrdtDocument, getCrdtRoot, readDocumentFromCrdt, writeDocumentToCrdt } from './projection';
import {
  CRDT_UPDATE_LIMIT_BYTES,
  type CrdtChangeSource,
  type CrdtDocumentController,
  type CrdtEvents,
  type CrdtUpdateEvent,
  type RemoteUpdateContext,
} from './types';

const ACTOR_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

interface TransactionOrigin {
  kind: 'sketchdraw';
  source: CrdtChangeSource;
  actorId: string;
  excludePeerId?: string;
}

function isTransactionOrigin(value: unknown): value is TransactionOrigin {
  return !!value && typeof value === 'object' && (value as TransactionOrigin).kind === 'sketchdraw';
}

function validateActorId(actorId: unknown): string {
  if (typeof actorId !== 'string' || !ACTOR_PATTERN.test(actorId)) {
    throw new DomainValidationError([{ path: 'actorId', code: 'INVALID_ID', message: 'Actor ID is invalid.' }]);
  }
  return actorId;
}

function validateInitialRevision(revision: number): number {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new DomainValidationError([{ path: 'initialRevision', code: 'INVALID_REVISION', message: 'Initial revision must be a non-negative safe integer.' }]);
  }
  return revision;
}

function changedElementIds(before: SketchDocument, after: SketchDocument): string[] {
  const beforeById = new Map(before.elements.map(element => [element.id, JSON.stringify(element)]));
  const afterById = new Map(after.elements.map(element => [element.id, JSON.stringify(element)]));
  return Array.from(new Set([...beforeById.keys(), ...afterById.keys()]))
    .filter(id => beforeById.get(id) !== afterById.get(id))
    .sort();
}

function safeEventEmitter(): {
  on: CrdtDocumentController['on'];
  emit: <K extends keyof CrdtEvents>(event: K, ...args: Parameters<CrdtEvents[K]>) => void;
} {
  const emitter = createNanoEvents<CrdtEvents>();
  return {
    on(event, listener) {
      return emitter.on(event, ((...args: unknown[]) => {
        try {
          (listener as (...values: unknown[]) => void)(...args);
        } catch {
          // A listener observes committed state and cannot roll it back.
        }
      }) as CrdtEvents[typeof event]);
    },
    emit(event, ...args) {
      queueMicrotask(() => emitter.emit(event, ...args));
    },
  };
}

export function createCrdtController(
  document: SketchDocument,
  initialRevision = 0,
  initialUpdate?: Uint8Array,
): CrdtDocumentController {
  let revision = validateInitialRevision(initialRevision);
  const ydoc = new Y.Doc({ gc: true });
  const bootstrap: TransactionOrigin = { kind: 'sketchdraw', source: 'import', actorId: 'system:bootstrap' };
  if (initialUpdate === undefined) {
    ydoc.transact(() => writeDocumentToCrdt(ydoc, document), bootstrap);
  } else {
    if (!(initialUpdate instanceof Uint8Array) || initialUpdate.byteLength === 0 || initialUpdate.byteLength > CRDT_UPDATE_LIMIT_BYTES) {
      throw new DomainValidationError([{ path: 'initialUpdate', code: 'CRDT_UPDATE_INVALID', message: 'Initial CRDT update is empty or exceeds the update limit.' }]);
    }
    Y.applyUpdateV2(ydoc, initialUpdate, bootstrap);
  }
  let current = readDocumentFromCrdt(ydoc);
  if (current.id !== document.id) {
    ydoc.destroy();
    throw new DomainValidationError([{ path: 'initialUpdate', code: 'DOCUMENT_MISMATCH', message: 'Initial CRDT update belongs to a different document.' }]);
  }
  let destroyed = false;
  let suppressTransactions = 0;
  const listeners = new Set<(snapshot: DocumentSession) => void>();
  const actorOrigins = new Map<string, TransactionOrigin>();
  const undoManagers = new Map<string, Y.UndoManager>();
  const events = safeEventEmitter();

  function snapshot(): DocumentSession {
    return { document: cloneDocument(current), revision };
  }

  function notify(): void {
    const value = snapshot();
    for (const listener of Array.from(listeners)) {
      try {
        listener({ document: cloneDocument(value.document), revision: value.revision });
      } catch {
        // Subscribers observe committed state and cannot roll it back.
      }
    }
  }

  function ensureRevisionCapacity(): void {
    if (!Number.isSafeInteger(revision + 1)) {
      throw new DomainConflictError('REVISION_OVERFLOW', 'Cannot advance revision beyond Number.MAX_SAFE_INTEGER.', revision);
    }
  }

  function originFor(actorId: string, source: CrdtChangeSource, remote = false): TransactionOrigin {
    const key = `${remote ? 'remote' : 'local'}:${actorId}`;
    const existing = actorOrigins.get(key);
    if (existing) {
      existing.source = source;
      delete existing.excludePeerId;
      return existing;
    }
    const origin: TransactionOrigin = { kind: 'sketchdraw', source, actorId };
    actorOrigins.set(key, origin);
    return origin;
  }

  function managerFor(actorId: string): Y.UndoManager {
    let manager = undoManagers.get(actorId);
    if (!manager) {
      const origin = originFor(actorId, 'human');
      manager = new Y.UndoManager(getCrdtRoot(ydoc), {
        trackedOrigins: new Set([origin]),
        captureTimeout: 0,
        ignoreRemoteMapChanges: false,
      });
      undoManagers.set(actorId, manager);
    }
    return manager;
  }

  function finalize(origin: TransactionOrigin, before: SketchDocument): void {
    const next = readDocumentFromCrdt(ydoc);
    if (areDocumentsEqual(before, next)) return;
    ensureRevisionCapacity();
    current = next;
    revision += 1;
    notify();
    events.emit('committed', {
      revision,
      source: origin.source,
      actorId: origin.actorId,
      changedElementIds: changedElementIds(before, next),
      commentsChanged: JSON.stringify(before.commentThreads ?? []) !== JSON.stringify(next.commentThreads ?? []),
      tasksChanged: JSON.stringify(before.tasks ?? []) !== JSON.stringify(next.tasks ?? []),
    });
  }

  const afterTransaction = (transaction: Y.Transaction): void => {
    if (destroyed || suppressTransactions > 0 || !transaction.changed.size) return;
    const origin = isTransactionOrigin(transaction.origin)
      ? transaction.origin
      : ({ kind: 'sketchdraw', source: 'persistence', actorId: 'system:persistence' } satisfies TransactionOrigin);
    const before = current;
    finalize(origin, before);
  };
  const onUpdate = (update: Uint8Array, rawOrigin: unknown): void => {
    if (destroyed || suppressTransactions > 0 || update.byteLength === 0) return;
    const origin = isTransactionOrigin(rawOrigin)
      ? rawOrigin
      : ({ kind: 'sketchdraw', source: 'persistence', actorId: 'system:persistence' } satisfies TransactionOrigin);
    const event: CrdtUpdateEvent = { update: Uint8Array.from(update), source: origin.source, actorId: origin.actorId };
    if (origin.excludePeerId !== undefined) event.excludePeerId = origin.excludePeerId;
    events.emit('update', event);
  };
  ydoc.on('afterTransaction', afterTransaction);
  ydoc.on('updateV2', onUpdate);

  function historyAction(actorIdInput: string, kind: 'undo' | 'redo'): DocumentSession {
    const actorId = validateActorId(actorIdInput);
    const manager = managerFor(actorId);
    const available = kind === 'undo' ? manager.undoStack.length > 0 : manager.redoStack.length > 0;
    if (!available) throw new DomainConflictError('HISTORY_EMPTY', `No ${kind} history available for actor "${actorId}".`, revision);
    ensureRevisionCapacity();
    const before = current;
    const beforeVector = Y.encodeStateVector(ydoc);
    const origin = originFor(actorId, kind);
    suppressTransactions += 1;
    try {
      const item = kind === 'undo' ? manager.undo() : manager.redo();
      if (!item) throw new DomainConflictError('HISTORY_EMPTY', `No ${kind} history available for actor "${actorId}".`, revision);
      let next: SketchDocument;
      try {
        next = readDocumentFromCrdt(ydoc);
      } catch (error) {
        if (kind === 'undo') manager.redo(); else manager.undo();
        throw new DomainConflictError('HISTORY_CONFLICT', error instanceof Error ? error.message : 'History conflicts with remote changes.', revision);
      }
      if (areDocumentsEqual(before, next)) return snapshot();
      current = next;
      revision += 1;
      notify();
      events.emit('committed', {
        revision,
        source: kind,
        actorId,
        changedElementIds: changedElementIds(before, next),
        commentsChanged: JSON.stringify(before.commentThreads ?? []) !== JSON.stringify(next.commentThreads ?? []),
        tasksChanged: JSON.stringify(before.tasks ?? []) !== JSON.stringify(next.tasks ?? []),
      });
      const update = Y.encodeStateAsUpdateV2(ydoc, beforeVector);
      if (update.byteLength) events.emit('update', { update, source: kind, actorId });
      return snapshot();
    } finally {
      suppressTransactions -= 1;
      origin.source = 'human';
    }
  }

  const controller: CrdtDocumentController = {
    ydoc,
    on: events.on,
    getSnapshot: snapshot,
    dispatch(command: DocumentCommand, context: CommandContext): DocumentSession {
      const actorId = validateActorId(context.actorId);
      if (!Number.isSafeInteger(context.expectedRevision) || context.expectedRevision !== revision) {
        throw new DomainConflictError('REVISION_CONFLICT', `Expected revision ${context.expectedRevision}, but current revision is ${revision}.`, revision);
      }
      ensureRevisionCapacity();
      const next = applyCommand(current, command);
      if (areDocumentsEqual(current, next)) return snapshot();
      const source = context.source as CrdtChangeSource;
      const origin = originFor(actorId, source);
      const manager = managerFor(actorId);
      manager.stopCapturing();
      ydoc.transact(() => writeDocumentToCrdt(ydoc, next), origin);
      manager.stopCapturing();
      return snapshot();
    },
    undo(actorId: string): DocumentSession {
      return historyAction(actorId, 'undo');
    },
    redo(actorId: string): DocumentSession {
      return historyAction(actorId, 'redo');
    },
    getHistoryState(actorIdInput: string): HistoryAvailability {
      const actorId = validateActorId(actorIdInput);
      const manager = undoManagers.get(actorId);
      if (!manager) return { canUndo: false, canRedo: false };
      if (!Number.isSafeInteger(revision + 1)) {
        return {
          canUndo: false,
          canRedo: false,
          ...(manager.undoStack.length ? { undoConflict: 'Cannot advance revision beyond Number.MAX_SAFE_INTEGER.' } : {}),
          ...(manager.redoStack.length ? { redoConflict: 'Cannot advance revision beyond Number.MAX_SAFE_INTEGER.' } : {}),
        };
      }
      return { canUndo: manager.undoStack.length > 0, canRedo: manager.redoStack.length > 0 };
    },
    subscribe(listener: (value: DocumentSession) => void): () => void {
      if (typeof listener !== 'function') throw new DomainValidationError([{ path: 'listener', code: 'INVALID_LISTENER', message: 'Controller subscriber must be a function.' }]);
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    encodeStateVector(): Uint8Array {
      return Y.encodeStateVector(ydoc);
    },
    encodeUpdate(remoteStateVector?: Uint8Array): Uint8Array {
      if (remoteStateVector !== undefined && !(remoteStateVector instanceof Uint8Array)) throw new TypeError('State vector must be a Uint8Array.');
      return Y.encodeStateAsUpdateV2(ydoc, remoteStateVector);
    },
    applyRemoteUpdate(update: Uint8Array, context: RemoteUpdateContext): DocumentSession {
      if (!(update instanceof Uint8Array) || update.byteLength === 0 || update.byteLength > CRDT_UPDATE_LIMIT_BYTES) {
        throw new DomainValidationError([{ path: 'update', code: 'CRDT_UPDATE_INVALID', message: 'CRDT update is empty or exceeds the update limit.' }]);
      }
      const actorId = validateActorId(context.actorId);
      if (context.source === 'peer' && context.role === 'viewer') {
        throw new DomainConflictError('ACCESS_DENIED', 'Viewer updates are not allowed.', revision);
      }
      const standalone = new Y.Doc({ gc: false });
      try {
        try {
          Y.applyUpdateV2(standalone, update);
        } catch (error) {
          throw new DomainValidationError([{ path: 'update', code: 'CRDT_UPDATE_REJECTED', message: error instanceof Error ? error.message : 'Malformed CRDT update.' }]);
        }
        try {
          const incoming = readDocumentFromCrdt(standalone);
          if (incoming.id !== current.id) throw new Error('DOCUMENT_MISMATCH');
        } catch (error) {
          if (error instanceof Error && error.message === 'DOCUMENT_MISMATCH') {
            throw new DomainValidationError([{ path: 'update', code: 'DOCUMENT_MISMATCH', message: 'CRDT update belongs to a different document.' }]);
          }
          // Incremental updates are valid without forming a standalone document.
        }
      } finally {
        standalone.destroy();
      }
      const shadow = cloneCrdtDocument(ydoc);
      try {
        Y.applyUpdateV2(shadow, update);
        readDocumentFromCrdt(shadow);
      } catch (error) {
        throw new DomainValidationError([{ path: 'update', code: 'CRDT_UPDATE_REJECTED', message: error instanceof Error ? error.message : 'CRDT update violates the document schema.' }]);
      } finally {
        shadow.destroy();
      }
      const origin = originFor(actorId, context.source, true);
      if (context.peerId !== undefined) origin.excludePeerId = context.peerId;
      Y.applyUpdateV2(ydoc, update, origin);
      delete origin.excludePeerId;
      return snapshot();
    },
    reportPersistence(event): void {
      events.emit('persistence', structuredClone(event));
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      ydoc.off('afterTransaction', afterTransaction);
      ydoc.off('updateV2', onUpdate);
      for (const manager of undoManagers.values()) manager.destroy();
      undoManagers.clear();
      listeners.clear();
      ydoc.destroy();
    },
  };
  return controller;
}

export function createCrdtControllerFromUpdate(update: Uint8Array, initialRevision = 0): CrdtDocumentController {
  if (!(update instanceof Uint8Array) || update.byteLength === 0 || update.byteLength > CRDT_UPDATE_LIMIT_BYTES) {
    throw new DomainValidationError([{ path: 'update', code: 'CRDT_UPDATE_INVALID', message: 'CRDT update is empty or exceeds the update limit.' }]);
  }
  const shadow = new Y.Doc({ gc: false });
  try {
    Y.applyUpdateV2(shadow, update);
    const document = readDocumentFromCrdt(shadow);
    return createCrdtController(document, initialRevision, update);
  } finally {
    shadow.destroy();
  }
}
