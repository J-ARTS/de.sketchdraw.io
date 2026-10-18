import { DomainValidationError } from './errors';
import {
  collectDescendantIds,
  normalizeZero,
  resolveAnchorWorldPoint,
  syncConnectorEndpoints,
  worldToElementLocalPoint,
} from './geometry';
import { DOMAIN_LIMITS } from './limits';
import type {
  DocumentCommand,
  ElementStyle,
  SketchAsset,
  SketchDocument,
  SketchElement,
  ValidationIssue,
} from './types';
import {
  checkObjectKeys,
  ELEMENT_KEYS,
  FORBIDDEN_KEYS,
  isPlainRecord,
  joinPath,
  validateDocument,
  validateIdField,
  validateStyle,
} from './validation';

const PATCH_KEYS: ReadonlySet<string> = new Set(
  Array.from(ELEMENT_KEYS).filter((key) => key !== 'id' && key !== 'kind'),
);

const ADD_COMMAND_KEYS: ReadonlySet<string> = new Set(['type', 'elements', 'assets']);
const UPDATE_COMMAND_KEYS: ReadonlySet<string> = new Set(['type', 'changes']);
const CHANGE_ENTRY_KEYS: ReadonlySet<string> = new Set(['id', 'patch']);
const DELETE_COMMAND_KEYS: ReadonlySet<string> = new Set(['type', 'ids']);
const REORDER_COMMAND_KEYS: ReadonlySet<string> = new Set(['type', 'ids']);
const RENAME_COMMAND_KEYS: ReadonlySet<string> = new Set(['type', 'title']);
const SET_COMPONENT_SETS_KEYS: ReadonlySet<string> = new Set(['type', 'sets']);
const SET_METADATA_KEYS: ReadonlySet<string> = new Set(['type', 'patch']);
const BATCH_COMMAND_KEYS: ReadonlySet<string> = new Set(['type', 'commands']);
const REPLACE_COMMAND_KEYS: ReadonlySet<string> = new Set(['type', 'document']);

interface BatchExecutionState {
  totalCommands: number;
}

function validateMetadataPatchRecord(
  patch: unknown,
  path: string,
  issues: ValidationIssue[],
): patch is Record<string, string | null> {
  if (!isPlainRecord(patch)) {
    issues.push({
      path,
      code: 'INVALID_METADATA_PATCH',
      message: 'Metadata patch must be a plain object.',
    });
    return false;
  }
  checkObjectKeys(patch, path, null, issues);
  for (const key of Object.getOwnPropertyNames(patch)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    const keyPath = joinPath(path, key);
    if (key.length === 0 || key.length > DOMAIN_LIMITS.MAX_ID_LENGTH) {
      issues.push({
        path: keyPath,
        code: 'INVALID_METADATA_KEY',
        message: `Metadata key must be between 1 and ${DOMAIN_LIMITS.MAX_ID_LENGTH} characters.`,
      });
    }
    const val = patch[key];
    if (val === null) continue;
    if (typeof val !== 'string') {
      issues.push({
        path: keyPath,
        code: 'INVALID_METADATA_VALUE',
        message: 'Metadata patch value must be a string or null.',
      });
    } else if (val.length > DOMAIN_LIMITS.MAX_TEXT_LENGTH) {
      issues.push({
        path: keyPath,
        code: 'TEXT_TOO_LONG',
        message: `Metadata value exceeds maximum length of ${DOMAIN_LIMITS.MAX_TEXT_LENGTH} characters.`,
      });
    }
  }
  return true;
}

function applyCommandInternal(
  baseDoc: SketchDocument,
  command: unknown,
  commandPath: string,
  batchDepth: number,
  batchState: BatchExecutionState,
): SketchDocument {
  const issues: ValidationIssue[] = [];

  if (!isPlainRecord(command)) {
    throw new DomainValidationError([
      {
        path: commandPath,
        code: 'INVALID_COMMAND',
        message: 'Command must be a plain object.',
      },
    ]);
  }

  const cmdType = command.type;
  if (typeof cmdType !== 'string') {
    throw new DomainValidationError([
      {
        path: joinPath(commandPath, 'type'),
        code: 'INVALID_COMMAND_TYPE',
        message: 'Command type must be a string.',
      },
    ]);
  }

  switch (cmdType) {
    case 'add': {
      checkObjectKeys(command, commandPath, ADD_COMMAND_KEYS, issues);
      if (!Array.isArray(command.elements)) {
        issues.push({
          path: joinPath(commandPath, 'elements'),
          code: 'INVALID_ELEMENTS',
          message: 'Add command elements must be an array.',
        });
      }
      if (
        Object.prototype.hasOwnProperty.call(command, 'assets') &&
        command.assets !== undefined &&
        !Array.isArray(command.assets)
      ) {
        issues.push({
          path: joinPath(commandPath, 'assets'),
          code: 'INVALID_ASSETS',
          message: 'Add command assets must be an array when provided.',
        });
      }
      if (issues.length > 0) {
        throw new DomainValidationError(issues);
      }

      const nextAssets: Record<string, SketchAsset> = { ...baseDoc.assets };
      if (Array.isArray(command.assets)) {
        const seenAssetIds = new Set<string>();
        for (let i = 0; i < command.assets.length; i += 1) {
          const asset = command.assets[i] as unknown;
          const assetPath = joinPath(joinPath(commandPath, 'assets'), i);
          if (!isPlainRecord(asset) || typeof asset.id !== 'string' || asset.id.length === 0) {
            issues.push({
              path: assetPath,
              code: 'INVALID_ASSET',
              message: 'Asset in add command must be a valid SketchAsset object.',
            });
            continue;
          }
          if (seenAssetIds.has(asset.id)) {
            issues.push({
              path: joinPath(assetPath, 'id'),
              code: 'DUPLICATE_ASSET_ID',
              message: `Duplicate asset id "${asset.id}" in add command.`,
            });
            continue;
          }
          seenAssetIds.add(asset.id);
          const existing = nextAssets[asset.id];
          if (
            existing &&
            (existing.mimeType !== asset.mimeType ||
              existing.dataUrl !== asset.dataUrl ||
              existing.name !== asset.name)
          ) {
            issues.push({
              path: joinPath(assetPath, 'id'),
              code: 'CONFLICTING_ASSET_ID',
              message: `Asset "${asset.id}" already exists with different content.`,
            });
            continue;
          }
          nextAssets[asset.id] = asset as unknown as SketchAsset;
        }
      }

      if (issues.length > 0) {
        throw new DomainValidationError(issues);
      }

      const rawElements = [...baseDoc.elements, ...(command.elements as SketchElement[])];
      const candidateDoc: SketchDocument = {
        ...baseDoc,
        elements: rawElements,
        assets: nextAssets,
      };

      const validatedDoc = validateDocument(candidateDoc);
      const addedIds = new Set<string>();
      for (const added of command.elements as SketchElement[]) {
        if (isPlainRecord(added) && typeof added.id === 'string') {
          addedIds.add(added.id);
        }
      }
      const elementMap = new Map(validatedDoc.elements.map((el) => [el.id, el]));
      let connectorsAdjusted = false;
      validatedDoc.elements = validatedDoc.elements.map((el) => {
        if (el.kind === 'connector' && addedIds.has(el.id)) {
          const synced = syncConnectorEndpoints(el, elementMap);
          if (synced !== el) {
            connectorsAdjusted = true;
          }
          return synced;
        }
        return el;
      });
      return connectorsAdjusted ? validateDocument(validatedDoc) : validatedDoc;
    }

    case 'update': {
      checkObjectKeys(command, commandPath, UPDATE_COMMAND_KEYS, issues);
      if (!Array.isArray(command.changes)) {
        issues.push({
          path: joinPath(commandPath, 'changes'),
          code: 'INVALID_CHANGES',
          message: 'Update command changes must be an array.',
        });
        throw new DomainValidationError(issues);
      }

      const existingById = new Map<string, SketchElement>();
      for (const el of baseDoc.elements) {
        existingById.set(el.id, el);
      }

      const seenIds = new Set<string>();
      const movedContainers = new Map<string, { dx: number; dy: number }>();
      const directlyPatchedIds = new Set<string>();
      const explicitPositionIds = new Set<string>();
      const geometryChangedIds = new Set<string>();

      for (let i = 0; i < command.changes.length; i += 1) {
        const change = command.changes[i] as unknown;
        const changePath = joinPath(joinPath(commandPath, 'changes'), i);
        if (!isPlainRecord(change)) {
          issues.push({
            path: changePath,
            code: 'INVALID_CHANGE_ENTRY',
            message: 'Update change entry must be a plain object.',
          });
          continue;
        }
        checkObjectKeys(change, changePath, CHANGE_ENTRY_KEYS, issues);

        const idPath = joinPath(changePath, 'id');
        if (!validateIdField(change.id, idPath, issues)) {
          continue;
        }

        const targetId = change.id;
        if (seenIds.has(targetId)) {
          issues.push({
            path: idPath,
            code: 'DUPLICATE_CHANGE_ID',
            message: `Duplicate element id "${targetId}" in update changes.`,
          });
          continue;
        }
        seenIds.add(targetId);

        const currentEl = existingById.get(targetId);
        if (!currentEl) {
          issues.push({
            path: idPath,
            code: 'UNKNOWN_ELEMENT_ID',
            message: `Cannot update unknown element "${targetId}".`,
          });
          continue;
        }

        const patch = change.patch;
        const patchPath = joinPath(changePath, 'patch');
        if (!isPlainRecord(patch)) {
          issues.push({
            path: patchPath,
            code: 'INVALID_PATCH',
            message: 'Element patch must be a plain object.',
          });
          continue;
        }

        checkObjectKeys(patch, patchPath, PATCH_KEYS, issues);

        const updatedEl: Record<string, unknown> = {
          ...currentEl,
          style: { ...currentEl.style },
        };

        for (const numKey of ['x', 'y', 'width', 'height', 'rotation'] as const) {
          if (Object.prototype.hasOwnProperty.call(patch, numKey)) {
            const val = patch[numKey];
            if (typeof val !== 'number' || !Number.isFinite(val)) {
              issues.push({
                path: joinPath(patchPath, numKey),
                code: 'INVALID_NUMBER',
                message: `Patch field "${numKey}" must be a finite number.`,
              });
            } else {
              const normalized = normalizeZero(val);
              if (normalized !== currentEl[numKey]) {
                geometryChangedIds.add(targetId);
              }
              if (numKey === 'x' || numKey === 'y') {
                explicitPositionIds.add(targetId);
              }
              updatedEl[numKey] = normalized;
            }
          }
        }

        if (Object.prototype.hasOwnProperty.call(patch, 'style') && patch.style !== undefined) {
          if (validateStyle(patch.style, joinPath(patchPath, 'style'), new Set<object>(), issues, true)) {
            const mergedStyle: Record<string, unknown> = { ...currentEl.style };
            const stylePatch = patch.style as Partial<ElementStyle>;
            for (const sKey of Object.keys(stylePatch) as Array<keyof ElementStyle>) {
              const sVal = stylePatch[sKey];
              if (sVal !== undefined) {
                mergedStyle[sKey] = typeof sVal === 'number' ? normalizeZero(sVal) : sVal;
              }
            }
            updatedEl.style = mergedStyle;
          }
        }

        if (Object.prototype.hasOwnProperty.call(patch, 'metadata')) {
          if (patch.metadata === null) {
            delete updatedEl.metadata;
          } else if (
            patch.metadata !== undefined &&
            validateMetadataPatchRecord(patch.metadata, joinPath(patchPath, 'metadata'), issues)
          ) {
            const nextMeta: Record<string, string> = currentEl.metadata
              ? { ...currentEl.metadata }
              : {};
            for (const mKey of Object.keys(patch.metadata)) {
              const mVal = patch.metadata[mKey];
              if (mVal === null) {
                delete nextMeta[mKey];
              } else if (typeof mVal === 'string') {
                nextMeta[mKey] = mVal;
              }
            }
            updatedEl.metadata = nextMeta;
          }
        }

        for (const nullableKey of [
          'label',
          'description',
          'text',
          'annotation',
          'author',
          'points',
          'connectorRouting',
          'startMarker',
          'endMarker',
          'assetId',
          'from',
          'to',
          'parentId',
          'componentType',
          'documentationUrl',
          'shapeVariant',
        ] as const) {
          if (!Object.prototype.hasOwnProperty.call(patch, nullableKey)) {
            continue;
          }
          const val = patch[nullableKey];
          if (val === null) {
            if (nullableKey === 'points' && currentEl.kind === 'connector') {
              issues.push({
                path: joinPath(patchPath, 'points'),
                code: 'CONNECTOR_POINTS_REQUIRED',
                message: 'Connector points cannot be set to null.',
              });
              continue;
            }
            delete updatedEl[nullableKey];
          } else if (val !== undefined) {
            updatedEl[nullableKey] = val;
          }
        }

        if (currentEl.kind === 'container') {
          const newX = typeof updatedEl.x === 'number' ? updatedEl.x : currentEl.x;
          const newY = typeof updatedEl.y === 'number' ? updatedEl.y : currentEl.y;
          const dx = newX - currentEl.x;
          const dy = newY - currentEl.y;
          if (dx !== 0 || dy !== 0) {
            movedContainers.set(targetId, { dx, dy });
          }
        }

        directlyPatchedIds.add(targetId);
        existingById.set(targetId, updatedEl as unknown as SketchElement);
      }

      if (issues.length > 0) {
        throw new DomainValidationError(issues);
      }

      // Translate container descendants exactly once for moved containers
      if (movedContainers.size > 0) {
        for (const [id, el] of existingById.entries()) {
          if (explicitPositionIds.has(id)) {
            continue;
          }
          const visited = new Set<string>([id]);
          let parentId = el.parentId;
          let matchedDelta: { dx: number; dy: number } | undefined;
          while (parentId !== undefined && !visited.has(parentId)) {
            visited.add(parentId);
            const delta = movedContainers.get(parentId);
            if (delta) {
              matchedDelta = delta;
              break;
            }
            const parentEl = existingById.get(parentId);
            parentId = parentEl?.parentId;
          }
          if (matchedDelta) {
            existingById.set(id, {
              ...el,
              x: normalizeZero(el.x + matchedDelta.dx),
              y: normalizeZero(el.y + matchedDelta.dy),
            });
            geometryChangedIds.add(id);
          }
        }
      }

      // Synchronize bound connector endpoints when connector or target geometry changed
      for (const [id, el] of existingById.entries()) {
        if (el.kind !== 'connector') continue;
        const fromChanged =
          isPlainRecord(el.from) &&
          typeof el.from.elementId === 'string' &&
          geometryChangedIds.has(el.from.elementId);
        const toChanged =
          isPlainRecord(el.to) &&
          typeof el.to.elementId === 'string' &&
          geometryChangedIds.has(el.to.elementId);
        if (
          directlyPatchedIds.has(id) ||
          geometryChangedIds.has(id) ||
          fromChanged ||
          toChanged
        ) {
          existingById.set(id, syncConnectorEndpoints(el, existingById));
        }
      }

      const nextElements = baseDoc.elements.map((el) => existingById.get(el.id)!);
      return validateDocument({
        ...baseDoc,
        elements: nextElements,
      });
    }

    case 'delete': {
      checkObjectKeys(command, commandPath, DELETE_COMMAND_KEYS, issues);
      if (!Array.isArray(command.ids)) {
        issues.push({
          path: joinPath(commandPath, 'ids'),
          code: 'INVALID_DELETE_IDS',
          message: 'Delete command ids must be an array.',
        });
        throw new DomainValidationError(issues);
      }

      const elementById = new Map(baseDoc.elements.map((el) => [el.id, el]));
      const seenDeleteIds = new Set<string>();
      for (let i = 0; i < command.ids.length; i += 1) {
        const rawId = command.ids[i];
        const idPath = joinPath(joinPath(commandPath, 'ids'), i);
        if (!validateIdField(rawId, idPath, issues)) {
          continue;
        }
        if (seenDeleteIds.has(rawId)) {
          issues.push({
            path: idPath,
            code: 'DUPLICATE_DELETE_ID',
            message: `Duplicate element id "${rawId}" in delete command.`,
          });
          continue;
        }
        seenDeleteIds.add(rawId);
        if (!elementById.has(rawId)) {
          issues.push({
            path: idPath,
            code: 'UNKNOWN_DELETE_ID',
            message: `Cannot delete unknown element "${rawId}".`,
          });
        }
      }

      if (issues.length > 0) {
        throw new DomainValidationError(issues);
      }

      const deletedSet = new Set<string>(seenDeleteIds);
      const descendantIds = collectDescendantIds(baseDoc.elements, seenDeleteIds);
      for (const descId of descendantIds) {
        deletedSet.add(descId);
      }

      const survivingElements: SketchElement[] = [];
      for (const el of baseDoc.elements) {
        if (deletedSet.has(el.id)) {
          continue;
        }
        if (el.kind === 'connector' && Array.isArray(el.points) && el.points.length >= 2) {
          const detachFrom = el.from !== undefined && deletedSet.has(el.from.elementId);
          const detachTo = el.to !== undefined && deletedSet.has(el.to.elementId);
          if (detachFrom || detachTo) {
            const nextPoints = el.points.map((pt) => ({ x: pt.x, y: pt.y }));
            const nextConnector: SketchElement = {
              ...el,
              points: nextPoints,
            };
            if (detachFrom && el.from) {
              const target = elementById.get(el.from.elementId);
              if (target) {
                const world = resolveAnchorWorldPoint(target, el.from.anchor);
                nextPoints[0] = worldToElementLocalPoint(el, world);
              }
              delete nextConnector.from;
            }
            if (detachTo && el.to) {
              const target = elementById.get(el.to.elementId);
              if (target) {
                const world = resolveAnchorWorldPoint(target, el.to.anchor);
                nextPoints[nextPoints.length - 1] = worldToElementLocalPoint(el, world);
              }
              delete nextConnector.to;
            }
            survivingElements.push(nextConnector);
            continue;
          }
        }
        survivingElements.push(el);
      }

      return validateDocument({
        ...baseDoc,
        elements: survivingElements,
      });
    }

    case 'reorder': {
      checkObjectKeys(command, commandPath, REORDER_COMMAND_KEYS, issues);
      if (!Array.isArray(command.ids)) {
        issues.push({
          path: joinPath(commandPath, 'ids'),
          code: 'INVALID_REORDER_IDS',
          message: 'Reorder command ids must be an array.',
        });
        throw new DomainValidationError(issues);
      }

      const elementById = new Map(baseDoc.elements.map((el) => [el.id, el]));
      if (command.ids.length !== baseDoc.elements.length) {
        issues.push({
          path: joinPath(commandPath, 'ids'),
          code: 'INVALID_PERMUTATION_LENGTH',
          message: `Reorder ids length (${command.ids.length}) must match element count (${baseDoc.elements.length}).`,
        });
      }

      const seenIds = new Set<string>();
      const reordered: SketchElement[] = [];
      for (let i = 0; i < command.ids.length; i += 1) {
        const rawId = command.ids[i];
        const idPath = joinPath(joinPath(commandPath, 'ids'), i);
        if (!validateIdField(rawId, idPath, issues)) {
          continue;
        }
        if (seenIds.has(rawId)) {
          issues.push({
            path: idPath,
            code: 'DUPLICATE_REORDER_ID',
            message: `Duplicate element id "${rawId}" in reorder permutation.`,
          });
          continue;
        }
        seenIds.add(rawId);
        const found = elementById.get(rawId);
        if (!found) {
          issues.push({
            path: idPath,
            code: 'UNKNOWN_REORDER_ID',
            message: `Reorder references unknown element id "${rawId}".`,
          });
          continue;
        }
        reordered.push(found);
      }

      if (issues.length > 0) {
        throw new DomainValidationError(issues);
      }

      return validateDocument({
        ...baseDoc,
        elements: reordered,
      });
    }

    case 'rename': {
      checkObjectKeys(command, commandPath, RENAME_COMMAND_KEYS, issues);
      if (typeof command.title !== 'string') {
        issues.push({
          path: joinPath(commandPath, 'title'),
          code: 'INVALID_TITLE',
          message: 'Rename title must be a string.',
        });
      } else if (command.title.length > DOMAIN_LIMITS.MAX_TEXT_LENGTH) {
        issues.push({
          path: joinPath(commandPath, 'title'),
          code: 'TEXT_TOO_LONG',
          message: `Title exceeds maximum length of ${DOMAIN_LIMITS.MAX_TEXT_LENGTH} characters.`,
        });
      }
      if (issues.length > 0) {
        throw new DomainValidationError(issues);
      }
      return validateDocument({
        ...baseDoc,
        title: command.title as string,
      });
    }

    case 'set-component-sets': {
      checkObjectKeys(command, commandPath, SET_COMPONENT_SETS_KEYS, issues);
      if (!Array.isArray(command.sets)) {
        issues.push({
          path: joinPath(commandPath, 'sets'),
          code: 'INVALID_COMPONENT_SETS',
          message: 'set-component-sets sets must be an array.',
        });
      }
      if (issues.length > 0) {
        throw new DomainValidationError(issues);
      }
      return validateDocument({
        ...baseDoc,
        componentSets: command.sets as SketchDocument['componentSets'],
      });
    }

    case 'set-metadata': {
      checkObjectKeys(command, commandPath, SET_METADATA_KEYS, issues);
      validateMetadataPatchRecord(command.patch, joinPath(commandPath, 'patch'), issues);
      if (issues.length > 0) {
        throw new DomainValidationError(issues);
      }
      const patch = command.patch as Record<string, string | null>;
      const nextMetadata: Record<string, string> = { ...baseDoc.metadata };
      for (const key of Object.keys(patch)) {
        const val = patch[key];
        if (val === null) {
          delete nextMetadata[key];
        } else if (typeof val === 'string') {
          nextMetadata[key] = val;
        }
      }
      return validateDocument({
        ...baseDoc,
        metadata: nextMetadata,
      });
    }

    case 'batch': {
      checkObjectKeys(command, commandPath, BATCH_COMMAND_KEYS, issues);
      const nextDepth = batchDepth + 1;
      if (nextDepth > DOMAIN_LIMITS.MAX_BATCH_DEPTH) {
        issues.push({
          path: commandPath,
          code: 'BATCH_DEPTH_EXCEEDED',
          message: `Batch nesting depth (${nextDepth}) exceeds maximum of ${DOMAIN_LIMITS.MAX_BATCH_DEPTH}.`,
        });
      }
      if (!Array.isArray(command.commands)) {
        issues.push({
          path: joinPath(commandPath, 'commands'),
          code: 'INVALID_BATCH_COMMANDS',
          message: 'Batch commands must be an array.',
        });
        throw new DomainValidationError(issues);
      }
      if (command.commands.length > DOMAIN_LIMITS.MAX_BATCH_COMMANDS) {
        issues.push({
          path: joinPath(commandPath, 'commands'),
          code: 'BATCH_TOO_MANY_COMMANDS',
          message: `Batch command count (${command.commands.length}) exceeds maximum of ${DOMAIN_LIMITS.MAX_BATCH_COMMANDS}.`,
        });
      }
      batchState.totalCommands += command.commands.length;
      if (batchState.totalCommands > DOMAIN_LIMITS.MAX_BATCH_COMMANDS) {
        issues.push({
          path: joinPath(commandPath, 'commands'),
          code: 'BATCH_TOO_MANY_COMMANDS',
          message: `Total commands across batch (${batchState.totalCommands}) exceed maximum of ${DOMAIN_LIMITS.MAX_BATCH_COMMANDS}.`,
        });
      }
      if (issues.length > 0) {
        throw new DomainValidationError(issues);
      }

      let current = baseDoc;
      for (let i = 0; i < command.commands.length; i += 1) {
        current = applyCommandInternal(
          current,
          command.commands[i],
          joinPath(joinPath(commandPath, 'commands'), i),
          nextDepth,
          batchState,
        );
      }
      return current;
    }

    case 'replace': {
      checkObjectKeys(command, commandPath, REPLACE_COMMAND_KEYS, issues);
      if (issues.length > 0) {
        throw new DomainValidationError(issues);
      }
      const nextDoc = validateDocument(command.document);
      if (nextDoc.id !== baseDoc.id) {
        throw new DomainValidationError([
          {
            path: joinPath(commandPath, 'document.id'),
            code: 'DOCUMENT_ID_MISMATCH',
            message: `Replacement document id "${nextDoc.id}" does not match existing document id "${baseDoc.id}".`,
          },
        ]);
      }
      return nextDoc;
    }

    default:
      throw new DomainValidationError([
        {
          path: joinPath(commandPath, 'type'),
          code: 'UNKNOWN_COMMAND_TYPE',
          message: `Unsupported command type "${cmdType}".`,
        },
      ]);
  }
}

export function applyCommand(document: SketchDocument, command: DocumentCommand): SketchDocument {
  const validatedBase = validateDocument(document);
  return applyCommandInternal(validatedBase, command, '', 0, { totalCommands: 0 });
}
