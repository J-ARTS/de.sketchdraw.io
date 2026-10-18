import { applyCommand } from './commands';
import { areAnnotationDocumentsEqual, cloneAnnotationDocument } from './annotation';
import { areTableDocumentsEqual, cloneTableDocument } from './table';
import { DomainConflictError, DomainValidationError } from './errors';
import {
  areAssetsEqual,
  areComponentSetsEqual,
  areCommentThreadsEqual,
  areDocumentsEqual,
  areElementsEqual,
  areEndpointsEqual,
  arePointsEqual,
  areStringRecordsEqual,
  areTasksEqual,
  cloneAsset,
  cloneComponentSet,
  cloneCommentThread,
  cloneDocument,
  cloneElement,
  cloneEndpoint,
  clonePoint,
  cloneStringRecord,
  cloneTask,
  normalizeZero,
} from './geometry';
import type {
  CommandContext,
  DocumentCommand,
  DocumentController,
  DocumentSession,
  ElementStyle,
  HistoryAvailability,
  SketchAsset,
  SketchDocument,
  SketchElement,
  ValidationIssue,
} from './types';
import { checkObjectKeys, isPlainRecord, validateDocument, validateIdField } from './validation';

const CONTEXT_KEYS: ReadonlySet<string> = new Set(['actorId', 'expectedRevision', 'source']);
const COMMAND_SOURCES: ReadonlySet<CommandContext['source']> = new Set([
  'human',
  'code',
  'import',
  'agent',
  'peer',
]);

const SCALAR_ELEMENT_FIELDS = [
  'kind',
  'shapeVariant',
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'label',
  'description',
  'text',
  'author',
  'assetId',
  'parentId',
  'componentType',
  'documentationUrl',
] as const;

const STYLE_FIELD_LIST: ReadonlyArray<keyof ElementStyle> = [
  'stroke',
  'fill',
  'strokeWidth',
  'opacity',
  'fontSize',
  'textAlign',
  'strokeDash',
  'fontFamily',
  'fontWeight',
  'textDecoration',
  'listStyle',
];

interface HistoryEntry {
  before: SketchDocument;
  after: SketchDocument;
}

interface ActorHistory {
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
}

type TransitionEvaluation =
  | { ok: true; document: SketchDocument }
  | { ok: false; reason: string };

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function isSubsequence(sub: readonly string[], full: readonly string[]): boolean {
  let subIdx = 0;
  for (let i = 0; i < full.length && subIdx < sub.length; i += 1) {
    if (full[i] === sub[subIdx]) {
      subIdx += 1;
    }
  }
  return subIdx === sub.length;
}

function hasSameGeometry(a: SketchElement, b: SketchElement): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.rotation === b.rotation
  );
}

function evaluateTransition(
  currentDoc: SketchDocument,
  expectedDoc: SketchDocument,
  targetDoc: SketchDocument,
): TransitionEvaluation {
  // 1. Document title
  let nextTitle = currentDoc.title;
  if (expectedDoc.title !== targetDoc.title) {
    if (currentDoc.title !== expectedDoc.title) {
      return {
        ok: false,
        reason: 'Document title was modified by another operation.',
      };
    }
    nextTitle = targetDoc.title;
  }

  // 2. Document metadata
  const nextMetadata = cloneStringRecord(currentDoc.metadata);
  const docMetaKeys = new Set([
    ...Object.keys(expectedDoc.metadata),
    ...Object.keys(targetDoc.metadata),
  ]);
  for (const key of docMetaKeys) {
    const expVal = expectedDoc.metadata[key];
    const tgtVal = targetDoc.metadata[key];
    if (expVal !== tgtVal) {
      if (currentDoc.metadata[key] !== expVal) {
        return {
          ok: false,
          reason: `Document metadata key "${key}" was modified by another operation.`,
        };
      }
      if (tgtVal === undefined) {
        delete nextMetadata[key];
      } else {
        nextMetadata[key] = tgtVal;
      }
    }
  }

  // 3. ComponentSets
  let nextComponentSets = currentDoc.componentSets.map(cloneComponentSet);
  if (!areComponentSetsEqual(expectedDoc.componentSets, targetDoc.componentSets)) {
    if (!areComponentSetsEqual(currentDoc.componentSets, expectedDoc.componentSets)) {
      return {
        ok: false,
        reason: 'Document componentSets were modified by another operation.',
      };
    }
    nextComponentSets = targetDoc.componentSets.map(cloneComponentSet);
  }

  // 4. Assets
  const nextAssets: Record<string, SketchAsset> = {};
  for (const key of Object.keys(currentDoc.assets)) {
    const asset = currentDoc.assets[key];
    if (asset) nextAssets[key] = cloneAsset(asset);
  }
  const assetKeys = new Set([
    ...Object.keys(expectedDoc.assets),
    ...Object.keys(targetDoc.assets),
  ]);
  for (const key of assetKeys) {
    const expAsset = expectedDoc.assets[key];
    const tgtAsset = targetDoc.assets[key];
    if (!areAssetsEqual(expAsset, tgtAsset)) {
      if (!areAssetsEqual(currentDoc.assets[key], expAsset)) {
        return {
          ok: false,
          reason: `Asset "${key}" was modified by another operation.`,
        };
      }
      if (tgtAsset === undefined) {
        delete nextAssets[key];
      } else {
        nextAssets[key] = cloneAsset(tgtAsset);
      }
    }
  }

  // 5. Elements
  const expectedMap = new Map(expectedDoc.elements.map((el) => [el.id, el]));
  const targetMap = new Map(targetDoc.elements.map((el) => [el.id, el]));
  const currentMap = new Map(currentDoc.elements.map((el) => [el.id, el]));

  const removedIds = new Set<string>();
  for (const id of expectedMap.keys()) {
    if (!targetMap.has(id)) {
      removedIds.add(id);
    }
  }

  const restoredIds = new Set<string>();
  for (const id of targetMap.keys()) {
    if (!expectedMap.has(id)) {
      restoredIds.add(id);
    }
  }

  // Check removed elements
  for (const id of removedIds) {
    const expEl = expectedMap.get(id)!;
    const curEl = currentMap.get(id);
    if (!curEl) {
      return {
        ok: false,
        reason: `Element "${id}" no longer exists in the document.`,
      };
    }
    if (!areElementsEqual(curEl, expEl)) {
      return {
        ok: false,
        reason: `Element "${id}" was modified by another operation.`,
      };
    }
  }

  // Check restored/added elements do not collide with existing IDs
  for (const id of restoredIds) {
    if (currentMap.has(id)) {
      return {
        ok: false,
        reason: `Element "${id}" already exists in the document.`,
      };
    }
  }

  // Build updated element map for surviving + restored elements
  const nextElementMap = new Map<string, SketchElement>();
  for (const [id, curEl] of currentMap.entries()) {
    if (!removedIds.has(id)) {
      nextElementMap.set(id, cloneElement(curEl));
    }
  }
  for (const id of restoredIds) {
    nextElementMap.set(id, cloneElement(targetMap.get(id)!));
  }

  // Check and apply field-level changes for elements in both expectedMap and targetMap
  for (const [id, expEl] of expectedMap.entries()) {
    const tgtEl = targetMap.get(id);
    if (!tgtEl) continue;
    if (areElementsEqual(expEl, tgtEl)) continue;

    const curEl = currentMap.get(id);
    if (!curEl) {
      return {
        ok: false,
        reason: `Element "${id}" was deleted by another operation.`,
      };
    }

    const working = nextElementMap.get(id)!;

    for (const field of SCALAR_ELEMENT_FIELDS) {
      const expVal = expEl[field];
      const tgtVal = tgtEl[field];
      if (expVal !== tgtVal) {
        if (curEl[field] !== expVal) {
          return {
            ok: false,
            reason: `Element "${id}" field "${field}" was modified by another operation.`,
          };
        }
        if ((field === 'x' || field === 'y') && curEl.parentId !== expEl.parentId) {
          return {
            ok: false,
            reason: `Element "${id}" parent container was modified by another operation.`,
          };
        }
        if (tgtVal === undefined) {
          delete (working as unknown as Record<string, unknown>)[field];
        } else {
          (working as unknown as Record<string, unknown>)[field] = tgtVal;
        }
      }
    }

    if (!arePointsEqual(expEl.points, tgtEl.points)) {
      if (!arePointsEqual(curEl.points, expEl.points)) {
        return {
          ok: false,
          reason: `Element "${id}" points were modified by another operation.`,
        };
      }
      if (
        (expEl.kind === 'connector' || curEl.kind === 'connector' || tgtEl.kind === 'connector') &&
        (!areEndpointsEqual(curEl.from, expEl.from) || !areEndpointsEqual(curEl.to, expEl.to))
      ) {
        return {
          ok: false,
          reason: `Connector "${id}" endpoint binding was modified by another operation.`,
        };
      }
      if (tgtEl.points === undefined) {
        delete working.points;
      } else {
        working.points = tgtEl.points.map(clonePoint);
      }
    }

    if (!areAnnotationDocumentsEqual(expEl.annotation, tgtEl.annotation)) {
      if (!areAnnotationDocumentsEqual(curEl.annotation, expEl.annotation)) {
        return {
          ok: false,
          reason: `Element "${id}" annotation content was modified by another operation.`,
        };
      }
      if (tgtEl.annotation === undefined) delete working.annotation;
      else working.annotation = cloneAnnotationDocument(tgtEl.annotation);
    }

    if (!areTableDocumentsEqual(expEl.table, tgtEl.table)) {
      if (!areTableDocumentsEqual(curEl.table, expEl.table)) {
        return { ok: false, reason: `Element "${id}" table content was modified by another operation.` };
      }
      if (tgtEl.table === undefined) delete working.table;
      else working.table = cloneTableDocument(tgtEl.table);
    }

    for (const endKey of ['from', 'to'] as const) {
      if (!areEndpointsEqual(expEl[endKey], tgtEl[endKey])) {
        if (!areEndpointsEqual(curEl[endKey], expEl[endKey])) {
          return {
            ok: false,
            reason: `Element "${id}" endpoint "${endKey}" was modified by another operation.`,
          };
        }
        if (tgtEl[endKey] === undefined) {
          delete working[endKey];
        } else {
          working[endKey] = cloneEndpoint(tgtEl[endKey]!);
        }
      }
    }

    for (const sKey of STYLE_FIELD_LIST) {
      const expStyleVal = expEl.style[sKey];
      const tgtStyleVal = tgtEl.style[sKey];
      if (expStyleVal !== tgtStyleVal) {
        if (curEl.style[sKey] !== expStyleVal) {
          return {
            ok: false,
            reason: `Element "${id}" style "${sKey}" was modified by another operation.`,
          };
        }
        if (tgtStyleVal === undefined) {
          delete (working.style as unknown as Record<string, unknown>)[sKey];
        } else {
          (working.style as unknown as Record<string, unknown>)[sKey] = tgtStyleVal;
        }
      }
    }

    if (!areStringRecordsEqual(expEl.metadata, tgtEl.metadata)) {
      if (tgtEl.metadata === undefined) {
        if (!areStringRecordsEqual(curEl.metadata, expEl.metadata)) {
          return {
            ok: false,
            reason: `Element "${id}" metadata was modified by another operation.`,
          };
        }
        delete working.metadata;
      } else if (expEl.metadata === undefined) {
        const nextMeta: Record<string, string> = working.metadata
          ? { ...working.metadata }
          : {};
        for (const mKey of Object.keys(tgtEl.metadata)) {
          if (
            curEl.metadata !== undefined &&
            Object.prototype.hasOwnProperty.call(curEl.metadata, mKey)
          ) {
            return {
              ok: false,
              reason: `Element "${id}" metadata key "${mKey}" was modified by another operation.`,
            };
          }
          nextMeta[mKey] = tgtEl.metadata[mKey]!;
        }
        working.metadata = nextMeta;
      } else {
        if (curEl.metadata === undefined) {
          return {
            ok: false,
            reason: `Element "${id}" metadata was removed by another operation.`,
          };
        }
        const nextMeta: Record<string, string> = { ...curEl.metadata };
        const allMetaKeys = new Set([
          ...Object.keys(expEl.metadata),
          ...Object.keys(tgtEl.metadata),
        ]);
        for (const mKey of allMetaKeys) {
          const expM = expEl.metadata[mKey];
          const tgtM = tgtEl.metadata[mKey];
          if (expM !== tgtM) {
            if (curEl.metadata[mKey] !== expM) {
              return {
                ok: false,
                reason: `Element "${id}" metadata key "${mKey}" was modified by another operation.`,
              };
            }
            if (tgtM === undefined) {
              delete nextMeta[mKey];
            } else {
              nextMeta[mKey] = tgtM;
            }
          }
        }
        working.metadata = nextMeta;
      }
    }

    // Check container descendant consistency if container position changed
    if (
      (expEl.kind === 'container' || curEl.kind === 'container' || tgtEl.kind === 'container') &&
      (expEl.x !== tgtEl.x || expEl.y !== tgtEl.y)
    ) {
      for (const [otherId, otherEl] of nextElementMap.entries()) {
        if (otherEl.parentId === id) {
          const expOther = expectedMap.get(otherId);
          const tgtOther = targetMap.get(otherId);
          if (!expOther || expOther.parentId !== id || !tgtOther || tgtOther.parentId !== id) {
            return {
              ok: false,
              reason: `Container "${id}" has modified child hierarchy ("${otherId}").`,
            };
          }
        }
      }
    }

    // Check if geometry changed while a foreign connector is bound to this element
    if (!hasSameGeometry(expEl, tgtEl)) {
      for (const [otherId, otherEl] of nextElementMap.entries()) {
        if (otherEl.kind !== 'connector') continue;
        const boundToThis =
          otherEl.from?.elementId === id || otherEl.to?.elementId === id;
        if (boundToThis) {
          const expConnector = expectedMap.get(otherId);
          const wasBoundInExp =
            expConnector?.from?.elementId === id || expConnector?.to?.elementId === id;
          if (!wasBoundInExp) {
            return {
              ok: false,
              reason: `Element "${id}" is referenced by connector "${otherId}" added or rebound by another operation.`,
            };
          }
        }
      }
    }
  }

  // Check if any removed element is still referenced by any element in nextElementMap
  for (const removedId of removedIds) {
    for (const [otherId, otherEl] of nextElementMap.entries()) {
      if (otherEl.parentId === removedId) {
        return {
          ok: false,
          reason: `Cannot remove container "${removedId}" because child "${otherId}" depends on it.`,
        };
      }
      if (otherEl.from?.elementId === removedId || otherEl.to?.elementId === removedId) {
        return {
          ok: false,
          reason: `Cannot remove element "${removedId}" because connector "${otherId}" is bound to it.`,
        };
      }
    }
  }

  // Check restored elements and re-attached connectors against target parent/endpoint geometry
  for (const [id, nextEl] of nextElementMap.entries()) {
    const tgtEl = targetMap.get(id);
    if (!tgtEl) continue;
    const expEl = expectedMap.get(id);

    if (
      tgtEl.parentId !== undefined &&
      (restoredIds.has(id) || expEl?.parentId !== tgtEl.parentId)
    ) {
      const nextParent = nextElementMap.get(tgtEl.parentId);
      const tgtParent = targetMap.get(tgtEl.parentId);
      if (
        !nextParent ||
        !tgtParent ||
        nextParent.x !== tgtParent.x ||
        nextParent.y !== tgtParent.y
      ) {
        return {
          ok: false,
          reason: `Parent container "${tgtEl.parentId}" for element "${id}" was moved or deleted.`,
        };
      }
    }

    if (nextEl.kind === 'connector') {
      for (const endKey of ['from', 'to'] as const) {
        const tgtEp = tgtEl[endKey];
        const expEp = expEl?.[endKey];
        if (
          tgtEp !== undefined &&
          (restoredIds.has(id) ||
            !expEl ||
            expEl.kind !== 'connector' ||
            !areEndpointsEqual(expEp, tgtEp) ||
            !arePointsEqual(expEl.points, tgtEl.points) ||
            !hasSameGeometry(expEl, tgtEl))
        ) {
          if (!hasSameGeometry(nextEl, tgtEl)) {
            return {
              ok: false,
              reason: `Connector "${id}" geometry was modified by another operation.`,
            };
          }
          const nextTarget = nextElementMap.get(tgtEp.elementId);
          const tgtTarget = targetMap.get(tgtEp.elementId);
          if (!nextTarget || !tgtTarget || !hasSameGeometry(nextTarget, tgtTarget)) {
            return {
              ok: false,
              reason: `Target element "${tgtEp.elementId}" for connector "${id}" was modified.`,
            };
          }
        }
      }
    }
  }

  // 6. Reconstruct Z-order
  const expectedIds = expectedDoc.elements.map((el) => el.id);
  const targetIds = targetDoc.elements.map((el) => el.id);
  const currentIds = currentDoc.elements.map((el) => el.id);

  const expectedCommon = expectedIds.filter((id) => targetMap.has(id));
  const targetCommon = targetIds.filter((id) => expectedMap.has(id));
  const commonOrderChanged = !arraysEqual(expectedCommon, targetCommon);

  let orderedIds: string[];
  if (commonOrderChanged) {
    if (!arraysEqual(currentIds, expectedIds)) {
      return {
        ok: false,
        reason: 'Element stacking order was modified by another operation.',
      };
    }
    orderedIds = [...targetIds];
  } else {
    const survivingCurrentCommon = currentIds.filter((id) => targetMap.has(id));
    if (!arraysEqual(survivingCurrentCommon, expectedCommon)) {
      return {
        ok: false,
        reason: 'Element stacking order was modified by another operation.',
      };
    }
    orderedIds = currentIds.filter((id) => !removedIds.has(id));

    if (restoredIds.size > 0) {
      if (!isSubsequence(expectedCommon, orderedIds)) {
        return {
          ok: false,
          reason: 'Cannot reconstruct element stacking order.',
        };
      }
      for (let i = 0; i < targetIds.length; i += 1) {
        const id = targetIds[i]!;
        if (!restoredIds.has(id)) continue;
        const prevId = i > 0 ? targetIds[i - 1] : undefined;
        if (prevId === undefined) {
          orderedIds.unshift(id);
        } else {
          const prevIndex = orderedIds.indexOf(prevId);
          if (prevIndex === -1) {
            return {
              ok: false,
              reason: 'Cannot reconstruct insertion order for restored element.',
            };
          }
          orderedIds.splice(prevIndex + 1, 0, id);
        }
      }
    }
  }

  const nextElements = orderedIds.map((id) => nextElementMap.get(id)!);

  let nextCommentThreads = currentDoc.commentThreads?.map(cloneCommentThread);
  if (!areCommentThreadsEqual(expectedDoc.commentThreads ?? [], targetDoc.commentThreads ?? [])) {
    if (!areCommentThreadsEqual(currentDoc.commentThreads ?? [], expectedDoc.commentThreads ?? [])) {
      return { ok: false, reason: 'Document comments were modified by another operation.' };
    }
    nextCommentThreads = targetDoc.commentThreads?.map(cloneCommentThread);
  }

  let nextTasks = currentDoc.tasks?.map(cloneTask);
  if (!areTasksEqual(expectedDoc.tasks ?? [], targetDoc.tasks ?? [])) {
    if (!areTasksEqual(currentDoc.tasks ?? [], expectedDoc.tasks ?? [])) {
      return { ok: false, reason: 'Document tasks were modified by another operation.' };
    }
    nextTasks = targetDoc.tasks?.map(cloneTask);
  }
  const candidateDoc: SketchDocument = {
    schemaVersion: 1,
    id: currentDoc.id,
    title: nextTitle,
    elements: nextElements,
    assets: nextAssets,
    componentSets: nextComponentSets,
    metadata: nextMetadata,
  };
  if (nextCommentThreads !== undefined) candidateDoc.commentThreads = nextCommentThreads;
  if (nextTasks !== undefined) candidateDoc.tasks = nextTasks;

  try {
    const validated = validateDocument(candidateDoc);
    return { ok: true, document: validated };
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error
          ? error.message
          : 'Resulting document violates domain constraints.',
    };
  }
}

function validateCommandContext(context: unknown): CommandContext {
  const issues: ValidationIssue[] = [];
  if (!isPlainRecord(context)) {
    throw new DomainValidationError([
      {
        path: 'context',
        code: 'INVALID_COMMAND_CONTEXT',
        message: 'CommandContext must be a plain object.',
      },
    ]);
  }
  checkObjectKeys(context, 'context', CONTEXT_KEYS, issues);
  validateIdField(context.actorId, 'context.actorId', issues);

  if (
    typeof context.expectedRevision !== 'number' ||
    !Number.isSafeInteger(context.expectedRevision) ||
    context.expectedRevision < 0
  ) {
    issues.push({
      path: 'context.expectedRevision',
      code: 'INVALID_REVISION',
      message: 'CommandContext expectedRevision must be a non-negative safe integer.',
    });
  }

  if (
    typeof context.source !== 'string' ||
    !COMMAND_SOURCES.has(context.source as CommandContext['source'])
  ) {
    issues.push({
      path: 'context.source',
      code: 'INVALID_COMMAND_SOURCE',
      message: 'CommandContext source must be human, code, import, agent, or peer.',
    });
  }

  if (issues.length > 0) {
    throw new DomainValidationError(issues);
  }

  return {
    actorId: context.actorId as string,
    expectedRevision: normalizeZero(context.expectedRevision as number),
    source: context.source as CommandContext['source'],
  };
}

function validateActorId(actorId: unknown): string {
  const issues: ValidationIssue[] = [];
  validateIdField(actorId, 'actorId', issues);
  if (issues.length > 0) {
    throw new DomainValidationError(issues);
  }
  return actorId as string;
}

export function createController(
  document: SketchDocument,
  initialRevision = 0,
): DocumentController {
  if (
    typeof initialRevision !== 'number' ||
    !Number.isSafeInteger(initialRevision) ||
    initialRevision < 0
  ) {
    throw new DomainValidationError([
      {
        path: 'initialRevision',
        code: 'INVALID_REVISION',
        message: 'Initial revision must be a non-negative safe integer.',
      },
    ]);
  }

  let currentDoc = validateDocument(document);
  let currentRevision = normalizeZero(initialRevision);
  const historyByActor = new Map<string, ActorHistory>();
  const listeners = new Set<(snapshot: DocumentSession) => void>();

  function getOrCreateActorHistory(actorId: string): ActorHistory {
    let history = historyByActor.get(actorId);
    if (!history) {
      history = { undoStack: [], redoStack: [] };
      historyByActor.set(actorId, history);
    }
    return history;
  }

  function createDetachedSnapshot(): DocumentSession {
    return {
      document: cloneDocument(currentDoc),
      revision: currentRevision,
    };
  }

  function notifyListeners(): void {
    const activeListeners = Array.from(listeners);
    for (const listener of activeListeners) {
      try {
        listener(createDetachedSnapshot());
      } catch {
        // Subscriber errors must not roll back a committed transaction.
      }
    }
  }

  return {
    getSnapshot(): DocumentSession {
      return createDetachedSnapshot();
    },

    dispatch(command: DocumentCommand, context: CommandContext): DocumentSession {
      const validContext = validateCommandContext(context);
      if (validContext.expectedRevision !== currentRevision) {
        throw new DomainConflictError(
          'REVISION_CONFLICT',
          `Expected revision ${validContext.expectedRevision}, but current revision is ${currentRevision}.`,
          currentRevision,
        );
      }

      const nextDoc = applyCommand(currentDoc, command);
      if (areDocumentsEqual(currentDoc, nextDoc)) {
        return createDetachedSnapshot();
      }

      if (!Number.isSafeInteger(currentRevision + 1)) {
        throw new DomainConflictError(
          'REVISION_OVERFLOW',
          'Cannot advance revision beyond Number.MAX_SAFE_INTEGER.',
          currentRevision,
        );
      }

      const actorHistory = getOrCreateActorHistory(validContext.actorId);
      actorHistory.undoStack.push({
        before: cloneDocument(currentDoc),
        after: cloneDocument(nextDoc),
      });
      actorHistory.redoStack.length = 0;

      currentDoc = nextDoc;
      currentRevision += 1;

      notifyListeners();
      return createDetachedSnapshot();
    },

    undo(actorId: string): DocumentSession {
      const validActorId = validateActorId(actorId);
      const actorHistory = historyByActor.get(validActorId);
      const topEntry = actorHistory?.undoStack.at(-1);
      if (!topEntry) {
        throw new DomainConflictError(
          'HISTORY_EMPTY',
          `No undo history available for actor "${validActorId}".`,
          currentRevision,
        );
      }

      const evaluation = evaluateTransition(currentDoc, topEntry.after, topEntry.before);
      if (!evaluation.ok) {
        throw new DomainConflictError('HISTORY_CONFLICT', evaluation.reason, currentRevision);
      }

      if (!Number.isSafeInteger(currentRevision + 1)) {
        throw new DomainConflictError(
          'REVISION_OVERFLOW',
          'Cannot advance revision beyond Number.MAX_SAFE_INTEGER.',
          currentRevision,
        );
      }

      actorHistory!.undoStack.pop();
      actorHistory!.redoStack.push(topEntry);

      currentDoc = evaluation.document;
      currentRevision += 1;

      notifyListeners();
      return createDetachedSnapshot();
    },

    redo(actorId: string): DocumentSession {
      const validActorId = validateActorId(actorId);
      const actorHistory = historyByActor.get(validActorId);
      const topEntry = actorHistory?.redoStack.at(-1);
      if (!topEntry) {
        throw new DomainConflictError(
          'HISTORY_EMPTY',
          `No redo history available for actor "${validActorId}".`,
          currentRevision,
        );
      }

      const evaluation = evaluateTransition(currentDoc, topEntry.before, topEntry.after);
      if (!evaluation.ok) {
        throw new DomainConflictError('HISTORY_CONFLICT', evaluation.reason, currentRevision);
      }

      if (!Number.isSafeInteger(currentRevision + 1)) {
        throw new DomainConflictError(
          'REVISION_OVERFLOW',
          'Cannot advance revision beyond Number.MAX_SAFE_INTEGER.',
          currentRevision,
        );
      }

      actorHistory!.redoStack.pop();
      actorHistory!.undoStack.push(topEntry);

      currentDoc = evaluation.document;
      currentRevision += 1;

      notifyListeners();
      return createDetachedSnapshot();
    },

    getHistoryState(actorId: string): HistoryAvailability {
      const validActorId = validateActorId(actorId);
      const actorHistory = historyByActor.get(validActorId);
      const availability: HistoryAvailability = {
        canUndo: false,
        canRedo: false,
      };
      const canAdvanceRevision = Number.isSafeInteger(currentRevision + 1);

      const topUndo = actorHistory?.undoStack.at(-1);
      if (topUndo) {
        const undoEval = evaluateTransition(currentDoc, topUndo.after, topUndo.before);
        if (!undoEval.ok) {
          availability.canUndo = false;
          availability.undoConflict = undoEval.reason;
        } else if (!canAdvanceRevision) {
          availability.canUndo = false;
          availability.undoConflict = 'Cannot advance revision beyond Number.MAX_SAFE_INTEGER.';
        } else {
          availability.canUndo = true;
        }
      }

      const topRedo = actorHistory?.redoStack.at(-1);
      if (topRedo) {
        const redoEval = evaluateTransition(currentDoc, topRedo.before, topRedo.after);
        if (!redoEval.ok) {
          availability.canRedo = false;
          availability.redoConflict = redoEval.reason;
        } else if (!canAdvanceRevision) {
          availability.canRedo = false;
          availability.redoConflict = 'Cannot advance revision beyond Number.MAX_SAFE_INTEGER.';
        } else {
          availability.canRedo = true;
        }
      }

      return availability;
    },

    subscribe(listener: (snapshot: DocumentSession) => void): () => void {
      if (typeof listener !== 'function') {
        throw new DomainValidationError([
          {
            path: 'listener',
            code: 'INVALID_LISTENER',
            message: 'Controller subscriber must be a function.',
          },
        ]);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
