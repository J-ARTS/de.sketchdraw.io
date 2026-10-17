import {
  createDocument,
  deserializeDocument,
  DOMAIN_LIMITS,
  type ComponentSet,
  type DocumentCommand,
  type Point,
  type SketchAsset,
  type SketchDocument,
  type SketchElement,
} from '@/domain';
import { bounds } from '../lib/geometry';

export const ELEMENT_CLIPBOARD_FORMAT = 'sketchdraw.elements' as const;

export interface ElementClipboardPayload {
  format: typeof ELEMENT_CLIPBOARD_FORMAT;
  version: 1;
  elements: SketchElement[];
  assets: Record<string, SketchAsset>;
  componentSets: ComponentSet[];
}

export interface ElementPastePlan {
  command: DocumentCommand;
  selection: string[];
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Expands the explicit selection with descendants and connectors whose two endpoints are copied.
 * References leaving that closed subgraph are removed, so the clipboard is independently valid.
 */
export function elementClipboardPayload(document: SketchDocument, selection: readonly string[]): ElementClipboardPayload | null {
  const ids = new Set(selection.filter((id) => document.elements.some((element) => element.id === id)));
  if (!ids.size) return null;

  for (let pass = 0; pass < DOMAIN_LIMITS.MAX_CONTAINER_DEPTH; pass += 1) {
    let changed = false;
    for (const element of document.elements) {
      if (element.parentId && ids.has(element.parentId) && !ids.has(element.id)) {
        ids.add(element.id);
        changed = true;
      }
    }
    if (!changed) break;
  }

  for (const element of document.elements) {
    if (element.kind === 'connector' && element.from && element.to && ids.has(element.from.elementId) && ids.has(element.to.elementId)) {
      ids.add(element.id);
    }
  }

  const elements = document.elements.filter((element) => ids.has(element.id)).map((source) => {
    const element = clone(source);
    if (element.parentId && !ids.has(element.parentId)) delete element.parentId;
    if (element.from && !ids.has(element.from.elementId)) delete element.from;
    if (element.to && !ids.has(element.to.elementId)) delete element.to;
    return element;
  });

  const assets: Record<string, SketchAsset> = {};
  for (const element of elements) {
    if (element.assetId && document.assets[element.assetId]) assets[element.assetId] = clone(document.assets[element.assetId]!);
  }

  const componentTypes = new Set(elements.flatMap((element) => element.componentType ? [element.componentType] : []));
  const componentSets = document.componentSets
    .filter((set) => set.components.some((definition) => componentTypes.has(definition.type)))
    .map(clone);

  return { format: ELEMENT_CLIPBOARD_FORMAT, version: 1, elements, assets, componentSets };
}

/** Treats OS clipboard text as hostile input and returns a detached, fully validated payload. */
export function parseElementClipboard(text: string): ElementClipboardPayload | null {
  if (!text || new TextEncoder().encode(text).byteLength > DOMAIN_LIMITS.MAX_DOCUMENT_JSON_BYTES) return null;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!isRecord(raw) || raw.format !== ELEMENT_CLIPBOARD_FORMAT || raw.version !== 1) return null;
  if (!Array.isArray(raw.elements) || !raw.elements.length || !isRecord(raw.assets) || !Array.isArray(raw.componentSets)) return null;
  if (Object.keys(raw).some((key) => !['format', 'version', 'elements', 'assets', 'componentSets'].includes(key))) return null;

  try {
    const candidate = createDocument('Zwischenablage');
    candidate.elements = raw.elements as SketchElement[];
    candidate.assets = raw.assets as Record<string, SketchAsset>;
    candidate.componentSets = raw.componentSets as ComponentSet[];
    const validated = deserializeDocument(JSON.stringify(candidate));
    return {
      format: ELEMENT_CLIPBOARD_FORMAT,
      version: 1,
      elements: validated.elements,
      assets: validated.assets,
      componentSets: validated.componentSets,
    };
  } catch { return null; }
}

/** Creates one atomic command whose pasted selection is centred at `at`. */
export function planElementPaste(
  payload: ElementClipboardPayload,
  document: SketchDocument,
  at: Point,
  createId: (prefix: string) => string,
): ElementPastePlan {
  const sourceBounds = bounds(payload.elements);
  if (!sourceBounds || !Number.isFinite(at.x) || !Number.isFinite(at.y)) throw new Error('Clipboard selection has no valid bounds.');
  const dx = at.x - (sourceBounds.x + sourceBounds.width / 2);
  const dy = at.y - (sourceBounds.y + sourceBounds.height / 2);
  const elementIds = new Map(payload.elements.map((element) => [element.id, createId(element.kind)]));
  const assetIds = new Map(Object.keys(payload.assets).map((id) => [id, createId('asset')]));

  const elements = payload.elements.map((source) => {
    const element = clone(source);
    element.id = elementIds.get(source.id)!;
    element.x += dx;
    element.y += dy;
    if (element.parentId) element.parentId = elementIds.get(element.parentId)!;
    if (element.from) element.from.elementId = elementIds.get(element.from.elementId)!;
    if (element.to) element.to.elementId = elementIds.get(element.to.elementId)!;
    if (element.assetId) element.assetId = assetIds.get(element.assetId)!;
    return element;
  });
  const assets = Object.entries(payload.assets).map(([sourceId, source]) => ({ ...clone(source), id: assetIds.get(sourceId)! }));

  const currentDefinitions = new Map(document.componentSets.flatMap((set) => set.components.map((definition) => [definition.type, definition] as const)));
  const neededTypes = new Set(elements.flatMap((element) => element.componentType ? [element.componentType] : []));
  const additions: ComponentSet[] = [];
  for (const set of payload.componentSets) {
    const needed = set.components.filter((definition) => neededTypes.has(definition.type));
    if (!needed.length) continue;
    for (const definition of needed) {
      const current = currentDefinitions.get(definition.type);
      if (current && !same(current, definition)) throw new Error(`Component type "${definition.type}" conflicts with the current document.`);
    }
    if (needed.every((definition) => currentDefinitions.has(definition.type))) continue;
    const currentSet = document.componentSets.find((entry) => entry.id === set.id);
    if (currentSet && !same(currentSet, set)) throw new Error(`Component set "${set.id}" conflicts with the current document.`);
    additions.push(clone(set));
    for (const definition of set.components) currentDefinitions.set(definition.type, definition);
  }

  const add: DocumentCommand = { type: 'add', elements, ...(assets.length ? { assets } : {}) };
  const command: DocumentCommand = additions.length
    ? { type: 'batch', commands: [{ type: 'set-component-sets', sets: [...document.componentSets.map(clone), ...additions] }, add] }
    : add;
  return { command, selection: elements.map((element) => element.id) };
}
