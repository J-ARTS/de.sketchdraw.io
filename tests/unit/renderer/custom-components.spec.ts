import { afterEach, describe, expect, test, vi } from 'vitest';
import { applyCommand, createController, createDocument, createElement, type DesktopBridge, type SketchDocument } from '@/domain';
import { elementClipboardPayload } from '@/renderer/state/element-clipboard';
import {
  createCustomComponentState, CUSTOM_COMPONENT_LIMITS, CUSTOM_COMPONENTS_FILE_FORMAT, CUSTOM_COMPONENTS_FILE_MAX_BYTES, CUSTOM_COMPONENTS_STORAGE_KEY,
  loadCustomComponents, normalizeComponentName, parseCustomComponentsFile, useCustomComponents, validateCustomComponents,
} from '@/renderer/lib/custom-components';
import { createWhiteboardStore } from '@/renderer/state/whiteboard';
import type { WhiteboardStore } from '@/renderer/state/contract';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { data.set(key, value); }),
  };
}

function sample(): SketchDocument {
  let document = createDocument('Library');
  document = applyCommand(document, { type: 'add', elements: [
    createElement('rectangle', { id: 'box:api', x: 100, y: 100, width: 160, height: 80, text: 'API Gateway' }),
    createElement('ellipse', { id: 'box:cache', x: 400, y: 100, width: 120, height: 80 }),
    createElement('connector', { id: 'link:api-cache', x: 260, y: 140, width: 140, height: 0, points: [{ x: 0, y: 0 }, { x: 140, y: 0 }], from: { elementId: 'box:api', anchor: { x: 1, y: 0.5 } }, to: { elementId: 'box:cache', anchor: { x: 0, y: 0.5 } } }),
  ] });
  return document;
}
const payloadOf = (document: SketchDocument, ids: string[]) => elementClipboardPayload(document, ids)!;
let counter = 0;
const nextId = () => `custom-component:${counter += 1}`;

describe('own component library (#188)', () => {
  test('names are one clean line of limited length', () => {
    expect(normalizeComponentName('  API\n\tGateway  ')).toBe('API Gateway');
    expect(normalizeComponentName('\u0000\u0007')).toBe('');
    expect(Array.from(normalizeComponentName('x'.repeat(200)))).toHaveLength(CUSTOM_COMPONENT_LIMITS.MAX_NAME_LENGTH);
  });

  test('saved components survive a restart, with connectors between the saved elements', () => {
    const storage = memoryStorage();
    const state = createCustomComponentState(storage);
    const result = state.add('Gateway', payloadOf(sample(), ['box:api', 'box:cache']), nextId);
    expect(result.ok).toBe(true);
    expect(state.components.value.map((component) => component.name)).toEqual(['Gateway']);

    const restarted = createCustomComponentState(storage);
    expect(restarted.components.value).toHaveLength(1);
    expect(restarted.components.value[0]!.payload.elements.map((element) => element.kind).sort()).toEqual(['connector', 'ellipse', 'rectangle']);
  });

  test('new components come first, and equal names are numbered', () => {
    const state = createCustomComponentState(memoryStorage());
    const payload = payloadOf(sample(), ['box:api']);
    state.add('Gateway', payload, nextId);
    state.add('gateway', payload, nextId);
    state.add('Gateway', payload, nextId);
    expect(state.components.value.map((component) => component.name)).toEqual(['Gateway 3', 'gateway 2', 'Gateway']);
    expect(state.numberedName('Komponente')).toBe('Komponente 1');
    state.add('Komponente 1', payload, nextId);
    expect(state.numberedName('Komponente')).toBe('Komponente 2');
  });

  test('rename and remove are stored; an empty name keeps the old one', () => {
    const storage = memoryStorage();
    const state = createCustomComponentState(storage);
    const added = state.add('Gateway', payloadOf(sample(), ['box:api']), nextId);
    if (!added.ok) throw new Error('not saved');
    const { id } = added.component;

    expect(state.rename(id, '   ')).toBe(false);
    expect(state.rename(id, ' Edge  Gateway ')).toBe(true);
    expect(createCustomComponentState(storage).components.value[0]!.name).toBe('Edge Gateway');
    expect(state.rename('custom-component:missing', 'x')).toBe(false);

    state.renamingId.value = id;
    expect(state.remove(id)).toBe(true);
    expect(state.renamingId.value).toBeNull();
    expect(state.remove(id)).toBe(false);
    expect(createCustomComponentState(storage).components.value).toEqual([]);
  });

  test('nothing is saved without a selection, beyond the size limit, or when storage refuses', () => {
    const storage = memoryStorage();
    const state = createCustomComponentState(storage);
    expect(state.add('Empty', null, nextId)).toEqual({ ok: false, reason: 'empty' });
    expect(state.add('  ', payloadOf(sample(), ['box:api']), nextId)).toEqual({ ok: false, reason: 'empty' });

    let big = createDocument('Big');
    big = applyCommand(big, { type: 'add', elements: Array.from({ length: 40 }, (_, index) => createElement('text', { id: `text:${index}`, x: 0, y: index * 40, width: 400, height: 32, text: 'x'.repeat(20_000) })) });
    expect(state.add('Big', payloadOf(big, big.elements.map((element) => element.id)), nextId)).toEqual({ ok: false, reason: 'too-large' });

    storage.setItem.mockImplementation(() => { throw new Error('QuotaExceededError'); });
    expect(state.add('Gateway', payloadOf(sample(), ['box:api']), nextId)).toEqual({ ok: false, reason: 'storage' });
    expect(state.components.value).toEqual([]);
  });

  test('stored text is untrusted: broken, duplicate and foreign entries are dropped', () => {
    const payload = payloadOf(sample(), ['box:api']);
    const broken = JSON.parse(JSON.stringify(payload)) as { elements: Array<Record<string, unknown>> };
    broken.elements[0]!.width = -1;
    const stored = [
      { id: 'a', name: 'Good', payload },
      { id: 'a', name: 'Same id', payload },
      { id: 'b', name: 'Broken', payload: broken },
      { id: 'c', name: '', payload },
      { id: 'd', name: 'No payload' },
      { id: '', name: 'No id', payload },
      'nonsense',
      { id: 'e', name: ' Also\ngood ', payload },
    ];
    expect(validateCustomComponents(stored).map((component) => [component.id, component.name])).toEqual([['a', 'Good'], ['e', 'Also good']]);
    expect(validateCustomComponents({ not: 'a list' })).toEqual([]);

    expect(loadCustomComponents(memoryStorage({ [CUSTOM_COMPONENTS_STORAGE_KEY]: '{not json' }))).toEqual([]);
    expect(loadCustomComponents(memoryStorage({ [CUSTOM_COMPONENTS_STORAGE_KEY]: JSON.stringify({ version: 2, components: stored }) }))).toEqual([]);
    expect(loadCustomComponents(memoryStorage({ [CUSTOM_COMPONENTS_STORAGE_KEY]: JSON.stringify({ version: 1, components: stored }) }))).toHaveLength(2);
    expect(loadCustomComponents(undefined)).toEqual([]);
  });
});

describe('own component library as a file (#244)', () => {
  test('an exported library is imported on another device with new ids, in front of what is there', () => {
    const document = sample();
    const source = createCustomComponentState(memoryStorage());
    source.add('Service', payloadOf(document, ['box:api']), nextId);
    source.add('Pair', payloadOf(document, ['box:api', 'box:cache', 'link:api-cache']), nextId);
    const file = source.exportLibrary();
    expect(JSON.parse(file)).toMatchObject({ format: CUSTOM_COMPONENTS_FILE_FORMAT, version: 1 });

    const storage = memoryStorage();
    const target = createCustomComponentState(storage);
    target.add('Mine', payloadOf(document, ['box:cache']), nextId);
    expect(target.importLibrary(file, nextId)).toEqual({ ok: true, added: 2, duplicates: 0, rejected: 0 });
    expect(target.components.value.map((component) => component.name)).toEqual(['Pair', 'Service', 'Mine']);
    const sourceIds = source.components.value.map((component) => component.id);
    expect(target.components.value.every((component) => !sourceIds.includes(component.id))).toBe(true);
    expect(target.components.value[0]!.payload).toEqual(source.components.value[0]!.payload);
    // What was imported is stored like a saved component.
    expect(loadCustomComponents(storage).map((component) => component.name)).toEqual(['Pair', 'Service', 'Mine']);
  });

  test('importing the same file again adds nothing; a different component with a taken name gets a free name', () => {
    const document = sample();
    const source = createCustomComponentState(memoryStorage());
    source.add('Service', payloadOf(document, ['box:api']), nextId);
    const file = source.exportLibrary();

    const target = createCustomComponentState(memoryStorage());
    expect(target.importLibrary(file, nextId)).toMatchObject({ ok: true, added: 1 });
    expect(target.importLibrary(file, nextId)).toEqual({ ok: true, added: 0, duplicates: 1, rejected: 0 });
    expect(target.components.value).toHaveLength(1);

    const other = createCustomComponentState(memoryStorage());
    other.add('service', payloadOf(document, ['box:cache']), nextId);
    expect(other.importLibrary(file, nextId)).toMatchObject({ ok: true, added: 1, duplicates: 0 });
    expect(other.components.value.map((component) => component.name)).toEqual(['Service 2', 'service']);
  });

  test('a file is untrusted: other JSON is refused, broken entries are counted and left out', () => {
    const document = sample();
    const good = { id: 'a', name: 'Good', payload: payloadOf(document, ['box:api']) };
    const state = createCustomComponentState(memoryStorage());
    for (const text of ['', 'not json', '[]', '{"version":2,"components":[]}', JSON.stringify({ format: 'something-else', version: 1, components: [good] }), JSON.stringify({ version: 1, components: [{ id: 'x', name: 'Broken', payload: { nope: true } }] })]) {
      expect(state.importLibrary(text, nextId)).toEqual({ ok: false, reason: 'invalid' });
    }
    expect(state.importLibrary(JSON.stringify({ format: CUSTOM_COMPONENTS_FILE_FORMAT, version: 1, components: [] }), nextId)).toEqual({ ok: false, reason: 'empty' });
    expect(state.importLibrary(' '.repeat(CUSTOM_COMPONENTS_FILE_MAX_BYTES + 1), nextId)).toEqual({ ok: false, reason: 'too-large' });
    expect(state.components.value).toEqual([]);

    const mixed = JSON.stringify({ format: CUSTOM_COMPONENTS_FILE_FORMAT, version: 1, components: [good, { id: 'b', name: 'Broken', payload: { elements: 'nope' } }, null] });
    expect(parseCustomComponentsFile(mixed)).toMatchObject({ ok: true, rejected: 2 });
    expect(state.importLibrary(mixed, nextId)).toEqual({ ok: true, added: 1, duplicates: 0, rejected: 2 });
    // The stored shape without the marker (a copy of the storage entry) is read as well.
    expect(parseCustomComponentsFile(JSON.stringify({ version: 1, components: [good] }))).toMatchObject({ ok: true, rejected: 0 });
  });

  test('an import is all or nothing: a full library and a failing storage leave it as it was', () => {
    const document = sample();
    const payload = payloadOf(document, ['box:api']);
    const full = createCustomComponentState(memoryStorage());
    for (let index = 0; index < CUSTOM_COMPONENT_LIMITS.MAX_COMPONENTS - 1; index += 1) full.add(`C${index}`, payload, nextId);
    const two = JSON.stringify({ format: CUSTOM_COMPONENTS_FILE_FORMAT, version: 1, components: [{ id: 'a', name: 'New A', payload }, { id: 'b', name: 'New B', payload }] });
    expect(full.importLibrary(two, nextId)).toEqual({ ok: false, reason: 'library-full' });
    expect(full.components.value).toHaveLength(CUSTOM_COMPONENT_LIMITS.MAX_COMPONENTS - 1);

    const storage = memoryStorage();
    const failing = createCustomComponentState(storage);
    storage.setItem.mockImplementation(() => { throw new Error('quota'); });
    expect(failing.importLibrary(two, nextId)).toEqual({ ok: false, reason: 'storage' });
    expect(failing.components.value).toEqual([]);
  });
});

describe('own components in the whiteboard store (#188)', () => {
  const stores: WhiteboardStore[] = [];
  afterEach(() => {
    for (const store of stores.splice(0)) store.dispose();
    const library = useCustomComponents();
    for (const component of [...library.components.value]) library.remove(component.id);
  });
  const bridge: DesktopBridge = {
    platform: 'electron',
    openDocument: vi.fn<DesktopBridge['openDocument']>(async () => ({ status: 'cancelled' })),
    saveDocument: vi.fn<DesktopBridge['saveDocument']>(async () => ({ status: 'cancelled' })),
    exportFile: vi.fn<DesktopBridge['exportFile']>(async () => ({ status: 'cancelled' })),
    openExternal: vi.fn(async () => {}), onCloseRequested: () => () => {},
    respondToClose: vi.fn(async () => {}), onMenuCommand: () => () => {},
  };
  function open(document: SketchDocument): WhiteboardStore {
    const store = createWhiteboardStore({ bridge, controller: createController(document), isMac: false });
    stores.push(store);
    return store;
  }

  test('the selection is saved under its caption and inserted as new elements on the active page, as one undo step', async () => {
    let document = sample();
    document = applyCommand(document, { type: 'add-page', page: { id: 'page:two', name: 'Two' } });
    const store = open(document);
    const library = useCustomComponents();

    store.select(['box:api']);
    const single = store.saveSelectionAsComponent();
    expect(library.get(single!)?.name).toBe('API Gateway');

    store.select(['box:api', 'box:cache']);
    const pair = store.saveSelectionAsComponent();
    expect(library.get(pair!)?.name).toBe('Komponente 1');
    expect(library.components.value.map((component) => component.id)).toEqual([pair, single]);

    store.selectPage('page:two');
    await store.insertCustomComponent(pair!);
    await store.whenIdle();
    const inserted = store.state.document.elements.filter((element) => element.pageId === 'page:two');
    expect(inserted.map((element) => element.kind).sort()).toEqual(['connector', 'ellipse', 'rectangle']);
    expect(inserted.every((element) => !['box:api', 'box:cache', 'link:api-cache'].includes(element.id))).toBe(true);
    const connector = inserted.find((element) => element.kind === 'connector')!;
    expect(inserted.map((element) => element.id)).toEqual(expect.arrayContaining([connector.from!.elementId, connector.to!.elementId]));
    expect([...store.state.selection].sort()).toEqual(inserted.map((element) => element.id).sort());
    expect(store.state.notices.filter((notice) => notice.kind === 'error')).toEqual([]);

    store.undo();
    await store.whenIdle();
    expect(store.state.document.elements.filter((element) => element.pageId === 'page:two')).toEqual([]);

    // The library does not depend on the document it was filled from.
    const other = open(createDocument('Other'));
    await other.insertCustomComponent(single!);
    await other.whenIdle();
    expect(other.state.document.elements.map((element) => element.text)).toEqual(['API Gateway']);
  });

  test('nothing is saved without a selection, and an unknown component inserts nothing', async () => {
    const store = open(sample());
    expect(store.saveSelectionAsComponent()).toBeNull();
    expect(useCustomComponents().components.value).toEqual([]);
    await store.insertCustomComponent('custom-component:missing');
    await store.whenIdle();
    expect(store.state.document.elements).toHaveLength(3);
  });
  test('the library is exported through the bridge and imported from a picked file, with a readable outcome', async () => {
    const store = open(sample());
    const library = useCustomComponents();
    const exportFile = vi.mocked(bridge.exportFile);
    exportFile.mockClear();
    await store.exportCustomComponents();
    expect(exportFile).not.toHaveBeenCalled();
    expect(store.state.notices.at(-1)).toMatchObject({ kind: 'error' });

    store.select(['box:api']);
    store.saveSelectionAsComponent();
    exportFile.mockResolvedValueOnce({ status: 'exported', name: 'Eigene Komponenten.sketchdraw-components.json' } as never);
    await store.exportCustomComponents();
    const [contents, name, format] = exportFile.mock.calls.at(-1)!;
    expect(format).toBe('components');
    expect(name).toBe('Eigene Komponenten');
    expect(store.state.notices.at(-1)).toMatchObject({ kind: 'info', text: 'Exportiert: Eigene Komponenten.sketchdraw-components.json' });

    const file = (text: string, size = text.length) => ({ size, text: async () => text });
    expect(await store.importCustomComponents(file(contents))).toBe(true);
    expect(store.state.notices.at(-1)).toMatchObject({ kind: 'info', text: 'Keine neue Komponente importiert. 1 ist schon in der Bibliothek.' });
    library.remove(library.components.value[0]!.id);
    expect(await store.importCustomComponents(file(contents))).toBe(true);
    expect(store.state.notices.at(-1)).toMatchObject({ kind: 'info', text: '1 Komponente importiert.' });
    expect(library.components.value.map((component) => component.name)).toEqual(['API Gateway']);

    expect(await store.importCustomComponents(file('{}'))).toBe(false);
    expect(store.state.notices.at(-1)).toMatchObject({ kind: 'error', text: 'Die Datei enthält keine Sketchdraw-Komponenten.' });
    // A file that is too large is refused by its size, without being read.
    const text = vi.fn(async () => contents);
    expect(await store.importCustomComponents({ size: CUSTOM_COMPONENTS_FILE_MAX_BYTES + 1, text })).toBe(false);
    expect(text).not.toHaveBeenCalled();
    expect(await store.importCustomComponents({ size: 10, text: async () => { throw new Error('unreadable'); } })).toBe(false);
    expect(library.components.value).toHaveLength(1);
  });
});
