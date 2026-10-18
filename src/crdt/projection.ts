import * as Y from 'yjs';
import type {
  AnnotationBlock,
  AnnotationDocument,
  AnnotationRun,
  CommentMessage,
  CommentThread,
  ComponentSet,
  SketchAsset,
  SketchDocument,
  SketchElement,
  SketchTask,
  TableCell,
  TableColumn,
  TableDocument,
  TableRow,
} from '../domain';
import { annotationPlainText, tablePlainText, validateDocument } from '../domain';
import { CRDT_SCHEMA_VERSION } from './types';

export const CRDT_ROOT_KEY = 'sketchdraw.v1';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const ELEMENT_SPECIAL_FIELDS = new Set(['text', 'annotation', 'table', 'metadata']);

function cloneJson<T>(value: T): T {
  return structuredClone(value);
}

function setValue(map: Y.Map<unknown>, key: string, value: JsonValue): void {
  const current = map.get(key);
  if (!(current instanceof Y.AbstractType) && JSON.stringify(current) === JSON.stringify(value)) return;
  map.set(key, value);
}

function asMap(value: unknown, path: string): Y.Map<unknown> {
  if (!(value instanceof Y.Map)) throw new Error(`CRDT_SCHEMA_INVALID:${path}`);
  return value;
}

function stringValue(map: Y.Map<unknown>, key: string, path: string): string {
  const value = map.get(key);
  if (typeof value !== 'string') throw new Error(`CRDT_SCHEMA_INVALID:${path}.${key}`);
  return value;
}

function numberValue(map: Y.Map<unknown>, key: string, path: string): number {
  const value = map.get(key);
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`CRDT_SCHEMA_INVALID:${path}.${key}`);
  return value;
}

function booleanValue(map: Y.Map<unknown>, key: string, path: string): boolean {
  const value = map.get(key);
  if (typeof value !== 'boolean') throw new Error(`CRDT_SCHEMA_INVALID:${path}.${key}`);
  return value;
}

function optionalString(map: Y.Map<unknown>, key: string, path: string): string | undefined {
  const value = map.get(key);
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`CRDT_SCHEMA_INVALID:${path}.${key}`);
  return value;
}

function syncText(map: Y.Map<unknown>, key: string, value: string): Y.Text {
  let text = map.get(key);
  if (!(text instanceof Y.Text)) {
    text = new Y.Text();
    map.set(key, text);
  }
  const ytext = text as Y.Text;
  if (ytext.toString() !== value) {
    let prefix = 0;
    const current = ytext.toString();
    while (prefix < current.length && prefix < value.length && current[prefix] === value[prefix]) prefix += 1;
    let suffix = 0;
    while (
      suffix < current.length - prefix &&
      suffix < value.length - prefix &&
      current[current.length - 1 - suffix] === value[value.length - 1 - suffix]
    ) suffix += 1;
    const remove = current.length - prefix - suffix;
    if (remove > 0) ytext.delete(prefix, remove);
    const insert = value.slice(prefix, value.length - suffix);
    if (insert) ytext.insert(prefix, insert);
  }
  return ytext;
}

function syncStringMap(parent: Y.Map<unknown>, key: string, record: Record<string, string>): void {
  let value = parent.get(key);
  if (!(value instanceof Y.Map)) {
    value = new Y.Map<string>();
    parent.set(key, value);
  }
  const target = value as Y.Map<string>;
  for (const existing of Array.from(target.keys())) if (!Object.hasOwn(record, existing)) target.delete(existing);
  for (const [entryKey, entryValue] of Object.entries(record)) if (target.get(entryKey) !== entryValue) target.set(entryKey, entryValue);
}

function readStringMap(parent: Y.Map<unknown>, key: string, path: string): Record<string, string> {
  const source = asMap(parent.get(key), `${path}.${key}`);
  const result: Record<string, string> = {};
  for (const [entryKey, entryValue] of source.entries()) {
    if (typeof entryValue !== 'string') throw new Error(`CRDT_SCHEMA_INVALID:${path}.${key}.${entryKey}`);
    result[entryKey] = entryValue;
  }
  return result;
}

function syncRankMap(parent: Y.Map<unknown>, key: string, ids: readonly string[]): void {
  let value = parent.get(key);
  if (!(value instanceof Y.Map)) {
    value = new Y.Map<string>();
    parent.set(key, value);
  }
  const ranks = value as Y.Map<string>;
  const keep = new Set(ids);
  for (const existing of Array.from(ranks.keys())) if (!keep.has(existing)) ranks.delete(existing);
  ids.forEach((id, index) => {
    const rank = index.toString(36).padStart(10, '0');
    if (ranks.get(id) !== rank) ranks.set(id, rank);
  });
}

function orderedIds(entities: Y.Map<unknown>, ranksValue: unknown, path: string): string[] {
  const ranks = asMap(ranksValue, `${path}.order`);
  return Array.from(entities.keys()).sort((left, right) => {
    const leftRank = ranks.get(left);
    const rightRank = ranks.get(right);
    if (typeof leftRank !== 'string' || typeof rightRank !== 'string') throw new Error(`CRDT_SCHEMA_INVALID:${path}.order`);
    return leftRank.localeCompare(rightRank) || left.localeCompare(right);
  });
}

function attributesForRun(run: AnnotationRun): Record<string, JsonValue> | undefined {
  const attributes: Record<string, JsonValue> = {};
  if (run.bold) attributes.bold = true;
  if (run.italic) attributes.italic = true;
  if (run.underline) attributes.underline = true;
  if (run.color) attributes.color = run.color;
  return Object.keys(attributes).length ? attributes : undefined;
}

function syncFormattedText(map: Y.Map<unknown>, key: string, runs: readonly AnnotationRun[]): void {
  let value = map.get(key);
  if (!(value instanceof Y.Text)) {
    value = new Y.Text();
    map.set(key, value);
  }
  const text = value as Y.Text;
  const expected: Array<{ insert: string; attributes?: Record<string, JsonValue> }> = [];
  for (const run of runs) {
    if (!run.text) continue;
    const attributes = attributesForRun(run);
    const previous = expected.at(-1);
    if (previous && JSON.stringify(previous.attributes) === JSON.stringify(attributes)) previous.insert += run.text;
    else expected.push({ insert: run.text, ...(attributes === undefined ? {} : { attributes }) });
  }
  const current = text.toDelta();
  if (JSON.stringify(current) === JSON.stringify(expected)) return;
  if (text.length) text.delete(0, text.length);
  let offset = 0;
  for (const run of runs) {
    if (!run.text) continue;
    text.insert(offset, run.text, attributesForRun(run) ?? {});
    offset += run.text.length;
  }
}

function readFormattedText(text: Y.Text, path: string): AnnotationRun[] {
  const runs: AnnotationRun[] = [];
  for (const part of text.toDelta()) {
    if (typeof part.insert !== 'string') throw new Error(`CRDT_SCHEMA_INVALID:${path}`);
    const run: AnnotationRun = { text: part.insert };
    const attrs = part.attributes ?? {};
    if (attrs.bold === true) run.bold = true;
    if (attrs.italic === true) run.italic = true;
    if (attrs.underline === true) run.underline = true;
    if (typeof attrs.color === 'string') run.color = attrs.color;
    runs.push(run);
  }
  return runs.length ? runs : [{ text: '' }];
}

function syncAnnotation(element: Y.Map<unknown>, annotation: AnnotationDocument | undefined): void {
  if (!annotation) {
    element.delete('annotation');
    return;
  }
  let value = element.get('annotation');
  if (!(value instanceof Y.Map)) {
    value = new Y.Map<unknown>();
    element.set('annotation', value);
  }
  const root = value as Y.Map<unknown>;
    setValue(root, 'version', annotation.version);
  let blocksValue = root.get('blocks');
  if (!(blocksValue instanceof Y.Map)) {
    blocksValue = new Y.Map<unknown>();
    root.set('blocks', blocksValue);
  }
  const blocks = blocksValue as Y.Map<unknown>;
  const ids = annotation.blocks.map((_, index) => `block:${index}`);
  for (const id of Array.from(blocks.keys())) if (!ids.includes(id)) blocks.delete(id);
  annotation.blocks.forEach((block, index) => {
    const id = ids[index]!;
    let blockValue = blocks.get(id);
    if (!(blockValue instanceof Y.Map)) {
      blockValue = new Y.Map<unknown>();
      blocks.set(id, blockValue);
    }
    const target = blockValue as Y.Map<unknown>;
    setValue(target, 'type', block.type);
    syncFormattedText(target, 'runs', block.runs);
  });
  syncRankMap(root, 'order', ids);
}

function readAnnotation(element: Y.Map<unknown>, path: string): AnnotationDocument | undefined {
  const value = element.get('annotation');
  if (value === undefined) return undefined;
  const root = asMap(value, `${path}.annotation`);
  if (root.get('version') !== 1) throw new Error(`CRDT_SCHEMA_INVALID:${path}.annotation.version`);
  const blocks = asMap(root.get('blocks'), `${path}.annotation.blocks`);
  const result: AnnotationBlock[] = [];
  for (const id of orderedIds(blocks, root.get('order'), `${path}.annotation`)) {
    const block = asMap(blocks.get(id), `${path}.annotation.blocks.${id}`);
    const type = stringValue(block, 'type', `${path}.annotation.blocks.${id}`) as AnnotationBlock['type'];
    const runs = block.get('runs');
    if (!(runs instanceof Y.Text)) throw new Error(`CRDT_SCHEMA_INVALID:${path}.annotation.blocks.${id}.runs`);
    result.push({ type, runs: readFormattedText(runs, `${path}.annotation.blocks.${id}.runs`) });
  }
  return { version: 1, blocks: result };
}

function syncTable(element: Y.Map<unknown>, table: TableDocument | undefined): void {
  if (!table) {
    element.delete('table');
    return;
  }
  let value = element.get('table');
  if (!(value instanceof Y.Map)) {
    value = new Y.Map<unknown>();
    element.set('table', value);
  }
  const root = value as Y.Map<unknown>;
  setValue(root, 'version', table.version);
  syncSimpleEntities(root, 'rows', table.rows, row => ({ id: row.id, height: row.height }));
  syncRankMap(root, 'rowOrder', table.rows.map(row => row.id));
  syncSimpleEntities(root, 'columns', table.columns, column => ({ id: column.id, width: column.width }));
  syncRankMap(root, 'columnOrder', table.columns.map(column => column.id));

  let cellsValue = root.get('cells');
  if (!(cellsValue instanceof Y.Map)) {
    cellsValue = new Y.Map<unknown>();
    root.set('cells', cellsValue);
  }
  const cells = cellsValue as Y.Map<unknown>;
  const ids = new Set(table.cells.map(cell => cell.id));
  for (const id of Array.from(cells.keys())) if (!ids.has(id)) cells.delete(id);
  for (const cell of table.cells) {
    let cellValue = cells.get(cell.id);
    if (!(cellValue instanceof Y.Map)) {
      cellValue = new Y.Map<unknown>();
      cells.set(cell.id, cellValue);
    }
    const target = cellValue as Y.Map<unknown>;
    setValue(target, 'id', cell.id);
    setValue(target, 'rowId', cell.rowId);
    setValue(target, 'columnId', cell.columnId);
    setValue(target, 'style', cloneJson(cell.style) as unknown as JsonValue);
    syncText(target, 'text', cell.text);
  }
  syncRankMap(root, 'cellOrder', table.cells.map(cell => cell.id));
}

function syncSimpleEntities<T extends { id: string }>(
  parent: Y.Map<unknown>,
  key: string,
  items: readonly T[],
  serialize: (item: T) => Record<string, JsonValue>,
): void {
  let value = parent.get(key);
  if (!(value instanceof Y.Map)) {
    value = new Y.Map<unknown>();
    parent.set(key, value);
  }
  const target = value as Y.Map<unknown>;
  const ids = new Set(items.map(item => item.id));
  for (const id of Array.from(target.keys())) if (!ids.has(id)) target.delete(id);
  for (const item of items) setValue(target, item.id, serialize(item));
}

function readTable(element: Y.Map<unknown>, path: string): TableDocument | undefined {
  const value = element.get('table');
  if (value === undefined) return undefined;
  const root = asMap(value, `${path}.table`);
  if (root.get('version') !== 1) throw new Error(`CRDT_SCHEMA_INVALID:${path}.table.version`);
  const rowsMap = asMap(root.get('rows'), `${path}.table.rows`);
  const columnsMap = asMap(root.get('columns'), `${path}.table.columns`);
  const cellsMap = asMap(root.get('cells'), `${path}.table.cells`);
  const rows = orderedIds(rowsMap, root.get('rowOrder'), `${path}.table.rows`).map(id => {
    const raw = rowsMap.get(id);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`CRDT_SCHEMA_INVALID:${path}.table.rows.${id}`);
    const row = raw as Record<string, unknown>;
    return { id: String(row.id), height: Number(row.height) } satisfies TableRow;
  });
  const columns = orderedIds(columnsMap, root.get('columnOrder'), `${path}.table.columns`).map(id => {
    const raw = columnsMap.get(id);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`CRDT_SCHEMA_INVALID:${path}.table.columns.${id}`);
    const column = raw as Record<string, unknown>;
    return { id: String(column.id), width: Number(column.width) } satisfies TableColumn;
  });
  const cells = orderedIds(cellsMap, root.get('cellOrder'), `${path}.table.cells`).map(id => {
    const raw = asMap(cellsMap.get(id), `${path}.table.cells.${id}`);
    const text = raw.get('text');
    if (!(text instanceof Y.Text)) throw new Error(`CRDT_SCHEMA_INVALID:${path}.table.cells.${id}.text`);
    const style = raw.get('style');
    if (!style || typeof style !== 'object' || Array.isArray(style)) throw new Error(`CRDT_SCHEMA_INVALID:${path}.table.cells.${id}.style`);
    return {
      id: stringValue(raw, 'id', `${path}.table.cells.${id}`),
      rowId: stringValue(raw, 'rowId', `${path}.table.cells.${id}`),
      columnId: stringValue(raw, 'columnId', `${path}.table.cells.${id}`),
      text: text.toString(),
      style: cloneJson(style) as TableCell['style'],
    } satisfies TableCell;
  });
  return { version: 1, rows, columns, cells };
}

function syncElement(target: Y.Map<unknown>, element: SketchElement): void {
  const raw = element as unknown as Record<string, unknown>;
  for (const key of Array.from(target.keys())) {
    if (!ELEMENT_SPECIAL_FIELDS.has(key) && !Object.hasOwn(raw, key)) target.delete(key);
  }
  for (const [key, value] of Object.entries(raw)) {
    if (ELEMENT_SPECIAL_FIELDS.has(key) || value === undefined) continue;
    setValue(target, key, cloneJson(value) as unknown as JsonValue);
  }
  if (element.text === undefined) target.delete('text'); else syncText(target, 'text', element.text);
  if (element.metadata === undefined) target.delete('metadata'); else syncStringMap(target, 'metadata', element.metadata);
  syncAnnotation(target, element.annotation);
  syncTable(target, element.table);
}

function readElement(value: unknown, id: string): SketchElement {
  const source = asMap(value, `elements.${id}`);
  const raw: Record<string, unknown> = {};
  for (const [key, entry] of source.entries()) {
    if (ELEMENT_SPECIAL_FIELDS.has(key)) continue;
    if (entry instanceof Y.AbstractType) throw new Error(`CRDT_SCHEMA_INVALID:elements.${id}.${key}`);
    raw[key] = cloneJson(entry);
  }
  const text = source.get('text');
  if (text !== undefined) {
    if (!(text instanceof Y.Text)) throw new Error(`CRDT_SCHEMA_INVALID:elements.${id}.text`);
    raw.text = text.toString();
  }
  if (source.has('metadata')) raw.metadata = readStringMap(source, 'metadata', `elements.${id}`);
  const annotation = readAnnotation(source, `elements.${id}`);
  if (annotation) {
    raw.annotation = annotation;
    raw.text = annotationPlainText(annotation);
  }
  const table = readTable(source, `elements.${id}`);
  if (table) {
    raw.table = table;
    raw.text = tablePlainText(table);
  }
  return raw as unknown as SketchElement;
}

function syncCommentThread(target: Y.Map<unknown>, thread: CommentThread): void {
  setValue(target, 'id', thread.id);
  setValue(target, 'target', cloneJson(thread.target) as unknown as JsonValue);
  setValue(target, 'resolved', thread.resolved);
  setValue(target, 'createdAt', thread.createdAt);
  setValue(target, 'updatedAt', thread.updatedAt);
  let value = target.get('messages');
  if (!(value instanceof Y.Map)) {
    value = new Y.Map<unknown>();
    target.set('messages', value);
  }
  const messages = value as Y.Map<unknown>;
  const ids = new Set(thread.messages.map(message => message.id));
  for (const id of Array.from(messages.keys())) if (!ids.has(id)) messages.delete(id);
  for (const message of thread.messages) {
    let messageValue = messages.get(message.id);
    if (!(messageValue instanceof Y.Map)) {
      messageValue = new Y.Map<unknown>();
      messages.set(message.id, messageValue);
    }
    const item = messageValue as Y.Map<unknown>;
    setValue(item, 'id', message.id);
    setValue(item, 'authorId', message.authorId);
    setValue(item, 'authorName', message.authorName);
    setValue(item, 'createdAt', message.createdAt);
    if (message.editedAt === undefined) item.delete('editedAt'); else setValue(item, 'editedAt', message.editedAt);
    syncText(item, 'body', message.body);
  }
  syncRankMap(target, 'messageOrder', thread.messages.map(message => message.id));
}

function readCommentThread(value: unknown, id: string): CommentThread {
  const source = asMap(value, `commentThreads.${id}`);
  const messagesMap = asMap(source.get('messages'), `commentThreads.${id}.messages`);
  const messages: CommentMessage[] = orderedIds(messagesMap, source.get('messageOrder'), `commentThreads.${id}.messages`).map(messageId => {
    const message = asMap(messagesMap.get(messageId), `commentThreads.${id}.messages.${messageId}`);
    const body = message.get('body');
    if (!(body instanceof Y.Text)) throw new Error(`CRDT_SCHEMA_INVALID:commentThreads.${id}.messages.${messageId}.body`);
    const result: CommentMessage = {
      id: stringValue(message, 'id', `commentThreads.${id}.messages.${messageId}`),
      authorId: stringValue(message, 'authorId', `commentThreads.${id}.messages.${messageId}`),
      authorName: stringValue(message, 'authorName', `commentThreads.${id}.messages.${messageId}`),
      body: body.toString(),
      createdAt: stringValue(message, 'createdAt', `commentThreads.${id}.messages.${messageId}`),
    };
    const editedAt = optionalString(message, 'editedAt', `commentThreads.${id}.messages.${messageId}`);
    if (editedAt !== undefined) result.editedAt = editedAt;
    return result;
  });
  const target = source.get('target');
  if (!target || typeof target !== 'object' || Array.isArray(target)) throw new Error(`CRDT_SCHEMA_INVALID:commentThreads.${id}.target`);
  return {
    id: stringValue(source, 'id', `commentThreads.${id}`),
    target: cloneJson(target) as CommentThread['target'],
    messages,
    resolved: booleanValue(source, 'resolved', `commentThreads.${id}`),
    createdAt: stringValue(source, 'createdAt', `commentThreads.${id}`),
    updatedAt: stringValue(source, 'updatedAt', `commentThreads.${id}`),
  };
}

function syncTask(target: Y.Map<unknown>, task: SketchTask): void {
  setValue(target, 'id', task.id);
  if (task.sourceThreadId === undefined) target.delete('sourceThreadId'); else setValue(target, 'sourceThreadId', task.sourceThreadId);
  setValue(target, 'title', task.title);
  syncText(target, 'description', task.description);
  setValue(target, 'status', task.status);
  setValue(target, 'rank', task.rank);
  setValue(target, 'createdAt', task.createdAt);
  setValue(target, 'updatedAt', task.updatedAt);
  if (task.external === undefined) target.delete('external'); else setValue(target, 'external', cloneJson(task.external) as unknown as JsonValue);
}

function readTask(value: unknown, id: string): SketchTask {
  const source = asMap(value, `tasks.${id}`);
  const description = source.get('description');
  if (!(description instanceof Y.Text)) throw new Error(`CRDT_SCHEMA_INVALID:tasks.${id}.description`);
  const task: SketchTask = {
    id: stringValue(source, 'id', `tasks.${id}`),
    title: stringValue(source, 'title', `tasks.${id}`),
    description: description.toString(),
    status: stringValue(source, 'status', `tasks.${id}`) as SketchTask['status'],
    rank: numberValue(source, 'rank', `tasks.${id}`),
    createdAt: stringValue(source, 'createdAt', `tasks.${id}`),
    updatedAt: stringValue(source, 'updatedAt', `tasks.${id}`),
  };
  const sourceThreadId = optionalString(source, 'sourceThreadId', `tasks.${id}`);
  if (sourceThreadId !== undefined) task.sourceThreadId = sourceThreadId;
  const external = source.get('external');
  if (external !== undefined) {
    if (!external || typeof external !== 'object' || Array.isArray(external)) throw new Error(`CRDT_SCHEMA_INVALID:tasks.${id}.external`);
    task.external = cloneJson(external) as SketchTask['external'];
  }
  return task;
}

function syncMapEntities<T extends { id: string }>(
  root: Y.Map<unknown>,
  key: string,
  items: readonly T[],
  sync: (target: Y.Map<unknown>, item: T) => void,
): void {
  let value = root.get(key);
  if (!(value instanceof Y.Map)) {
    value = new Y.Map<unknown>();
    root.set(key, value);
  }
  const map = value as Y.Map<unknown>;
  const ids = new Set(items.map(item => item.id));
  for (const id of Array.from(map.keys())) if (!ids.has(id)) map.delete(id);
  for (const item of items) {
    let entity = map.get(item.id);
    if (!(entity instanceof Y.Map)) {
      entity = new Y.Map<unknown>();
      map.set(item.id, entity);
    }
    sync(entity as Y.Map<unknown>, item);
  }
}

function syncJsonRecord<T extends { id: string }>(root: Y.Map<unknown>, key: string, record: Record<string, T>): void {
  let value = root.get(key);
  if (!(value instanceof Y.Map)) {
    value = new Y.Map<unknown>();
    root.set(key, value);
  }
  const map = value as Y.Map<unknown>;
  for (const id of Array.from(map.keys())) if (!Object.hasOwn(record, id)) map.delete(id);
  for (const [id, item] of Object.entries(record)) setValue(map, id, cloneJson(item) as unknown as JsonValue);
}

function readJsonRecord<T>(root: Y.Map<unknown>, key: string, path: string): Record<string, T> {
  const map = asMap(root.get(key), path);
  const result: Record<string, T> = {};
  for (const [id, value] of map.entries()) {
    if (!value || typeof value !== 'object' || value instanceof Y.AbstractType || Array.isArray(value)) throw new Error(`CRDT_SCHEMA_INVALID:${path}.${id}`);
    result[id] = cloneJson(value) as T;
  }
  return result;
}

function syncJsonArrayById<T extends { id: string }>(root: Y.Map<unknown>, key: string, items: readonly T[]): void {
  let value = root.get(key);
  if (!(value instanceof Y.Map)) {
    value = new Y.Map<unknown>();
    root.set(key, value);
  }
  const map = value as Y.Map<unknown>;
  const ids = new Set(items.map(item => item.id));
  for (const id of Array.from(map.keys())) if (!ids.has(id)) map.delete(id);
  for (const item of items) setValue(map, item.id, cloneJson(item) as unknown as JsonValue);
  syncRankMap(root, `${key}Order`, items.map(item => item.id));
}

function readJsonArrayById<T>(root: Y.Map<unknown>, key: string, path: string): T[] {
  const map = asMap(root.get(key), path);
  return orderedIds(map, root.get(`${key}Order`), path).map(id => {
    const value = map.get(id);
    if (!value || typeof value !== 'object' || value instanceof Y.AbstractType || Array.isArray(value)) throw new Error(`CRDT_SCHEMA_INVALID:${path}.${id}`);
    return cloneJson(value) as T;
  });
}

function repairConcurrentReferences(document: SketchDocument): void {
  const elements = new Map(document.elements.map(element => [element.id, element]));
  const componentTypes = new Set(document.componentSets.flatMap(set => set.components.map(component => component.type)));
  for (const element of document.elements) {
    if (element.parentId !== undefined) {
      const parent = elements.get(element.parentId);
      if (!parent || parent.kind !== 'container') delete element.parentId;
    }
    if (element.assetId !== undefined && !document.assets[element.assetId]) delete element.assetId;
    if (element.componentType !== undefined && !componentTypes.has(element.componentType)) delete element.componentType;
    if (element.kind === 'connector') {
      if (element.from !== undefined && !elements.has(element.from.elementId)) delete element.from;
      if (element.to !== undefined && !elements.has(element.to.elementId)) delete element.to;
    }
  }

  // Concurrent moves can create a cycle although every individual move was valid.
  // Every replica removes the lexicographically greatest edge in that cycle.
  let repaired = true;
  while (repaired) {
    repaired = false;
    for (const start of document.elements) {
      const path: string[] = [];
      const index = new Map<string, number>();
      let current: SketchElement | undefined = start;
      while (current?.parentId !== undefined) {
        const seenAt = index.get(current.id);
        if (seenAt !== undefined) {
          const cycle = path.slice(seenAt);
          const breakId = [...cycle].sort().at(-1);
          const target = breakId ? elements.get(breakId) : undefined;
          if (target?.parentId !== undefined) {
            delete target.parentId;
            repaired = true;
          }
          break;
        }
        index.set(current.id, path.length);
        path.push(current.id);
        current = elements.get(current.parentId);
      }
      if (repaired) break;
    }
  }

  const threadIds = new Set((document.commentThreads ?? []).map(thread => thread.id));
  for (const thread of document.commentThreads ?? []) {
    const elementId = thread.target.elementId;
    if (elementId !== undefined && !elements.has(elementId)) {
      delete thread.target.elementId;
      delete thread.target.tableCellId;
    } else if (thread.target.tableCellId !== undefined) {
      const table = elementId === undefined ? undefined : elements.get(elementId)?.table;
      if (!table?.cells.some(cell => cell.id === thread.target.tableCellId)) delete thread.target.tableCellId;
    }
  }
  for (const task of document.tasks ?? []) {
    if (task.sourceThreadId !== undefined && !threadIds.has(task.sourceThreadId)) delete task.sourceThreadId;
  }
}

export function getCrdtRoot(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>(CRDT_ROOT_KEY);
}

export function writeDocumentToCrdt(doc: Y.Doc, document: SketchDocument): void {
  const valid = validateDocument(document);
  const root = getCrdtRoot(doc);
  setValue(root, 'crdtSchemaVersion', CRDT_SCHEMA_VERSION);
  setValue(root, 'documentSchemaVersion', valid.schemaVersion);
  setValue(root, 'id', valid.id);
  setValue(root, 'title', valid.title);
  syncStringMap(root, 'metadata', valid.metadata);

  syncMapEntities(root, 'elements', valid.elements, syncElement);
  syncRankMap(root, 'elementOrder', valid.elements.map(element => element.id));
  syncJsonRecord(root, 'assets', valid.assets);
  syncJsonArrayById(root, 'componentSets', valid.componentSets);
  syncMapEntities(root, 'commentThreads', valid.commentThreads ?? [], syncCommentThread);
  syncRankMap(root, 'commentThreadsOrder', (valid.commentThreads ?? []).map(thread => thread.id));
  syncMapEntities(root, 'tasks', valid.tasks ?? [], syncTask);
  syncRankMap(root, 'tasksOrder', (valid.tasks ?? []).map(task => task.id));
}

export function readDocumentFromCrdt(doc: Y.Doc): SketchDocument {
  const root = getCrdtRoot(doc);
  if (root.get('crdtSchemaVersion') !== CRDT_SCHEMA_VERSION) throw new Error('CRDT_SCHEMA_VERSION_UNSUPPORTED');
  if (root.get('documentSchemaVersion') !== 1) throw new Error('DOCUMENT_SCHEMA_VERSION_UNSUPPORTED');
  const elementsMap = asMap(root.get('elements'), 'elements');
  const commentThreadsMap = asMap(root.get('commentThreads'), 'commentThreads');
  const tasksMap = asMap(root.get('tasks'), 'tasks');
  const candidate: SketchDocument = {
    schemaVersion: 1,
    id: stringValue(root, 'id', 'document'),
    title: stringValue(root, 'title', 'document'),
    elements: orderedIds(elementsMap, root.get('elementOrder'), 'elements').map(id => readElement(elementsMap.get(id), id)),
    assets: readJsonRecord<SketchAsset>(root, 'assets', 'assets'),
    componentSets: readJsonArrayById<ComponentSet>(root, 'componentSets', 'componentSets'),
    metadata: readStringMap(root, 'metadata', 'document'),
    commentThreads: orderedIds(commentThreadsMap, root.get('commentThreadsOrder'), 'commentThreads').map(id => readCommentThread(commentThreadsMap.get(id), id)),
    tasks: orderedIds(tasksMap, root.get('tasksOrder'), 'tasks').map(id => readTask(tasksMap.get(id), id)),
  };
  repairConcurrentReferences(candidate);
  return validateDocument(candidate);
}

export function cloneCrdtDocument(doc: Y.Doc): Y.Doc {
  const clone = new Y.Doc({ gc: false });
  Y.applyUpdateV2(clone, Y.encodeStateAsUpdateV2(doc));
  return clone;
}
