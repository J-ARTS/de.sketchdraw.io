import { afterEach, describe, expect, test, vi } from 'vitest';
import { applyCommand, createController, createDocument, createElement, type DesktopBridge, type SketchDocument } from '@/domain';
import { elementClipboardPayload } from '@/renderer/state/element-clipboard';
import {
  createCustomComponentState, CUSTOM_COMPONENT_LIMITS, CUSTOM_COMPONENTS_STORAGE_KEY, loadCustomComponents,
  normalizeComponentName, useCustomComponents, validateCustomComponents,
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
});
