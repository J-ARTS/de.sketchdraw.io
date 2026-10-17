import { afterEach, describe, expect, test, vi } from 'vitest';
import type { DesktopBridge } from '@/domain';
import { createWhiteboardStore } from '@/renderer/state/whiteboard';
import type { PointerInput, WhiteboardStore } from '@/renderer/state/contract';

// #44: ElementStyle changes during textEdit live in the text draft and commit together with the text.
const stores: WhiteboardStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.dispose(); });
function setup() {
  let close: (id: string) => void = () => {};
  const bridge: DesktopBridge = {
    platform: 'electron', openDocument: vi.fn(async () => ({ status: 'cancelled' as const })),
    saveDocument: vi.fn(async () => ({ status: 'saved' as const, file: { handleId: 'h', name: 't.sketchdraw.json', versionToken: 'v1' } })),
    exportFile: vi.fn(async () => ({ status: 'exported' as const, name: 't.sketchdraw.json' })),
    openExternal: vi.fn(async () => {}), onCloseRequested: fn => { close = fn; return () => {}; },
    respondToClose: vi.fn(async () => {}), onMenuCommand: () => () => {},
  };
  const store = createWhiteboardStore({ bridge }); stores.push(store);
  return { store, bridge, close: () => close('close-1') };
}
const point = (x: number, y: number): PointerInput => ({ x, y, button: 0, pointerType: 'mouse', shiftKey: false, altKey: false, metaOrCtrl: false, detail: 1 });
async function drawRect(store: WhiteboardStore) {
  store.setTool('rectangle'); store.pointerDown(point(300, 200)); store.pointerMove(point(400, 280)); store.pointerUp(point(400, 280)); await store.whenIdle();
  return store.state.document.elements[0]!.id;
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const peerUpdate = async (store: WhiteboardStore, id: string, patch: object) => {
  const peer = store.getAuthority()!.bindActor({ actorId: 'agent', source: 'agent', grantId: 'g', grantGeneration: 0, guard: () => ({ allowed: true }) });
  await peer.gateway.submit({ requestId: peer.gateway.nextRequestId()!, expectedRevision: store.state.revision, action: { kind: 'dispatch', command: { type: 'update', changes: [{ id, patch }] } } });
};

describe('text edit style draft (#44)', () => {
  test('style changes stay in the draft, update selectionInfo and leave the document untouched until commit', async () => {
    const { store } = setup(); const id = await drawRect(store);
    store.select([id]); const original = store.state.document; const before = store.state.revision;
    store.startTextEdit(id); store.setPropertyDraft({ style: { fontFamily: 'scribbled', fontSize: 32 } });
    expect(store.state.textEdit?.style).toMatchObject({ fontFamily: 'scribbled', fontSize: 32 });
    expect(store.state.selectionInfo.values).toMatchObject({ fontFamily: 'scribbled', fontSize: 32 });
    expect(store.state.propertyDraft).toBeNull();
    expect(store.state.document).toBe(original); expect(store.state.revision).toBe(before);
    expect(store.state.textEdit?.conflict).toBeNull(); expect(store.state.hasDraft).toBe(true);
  });

  test('style-only edit still writes exactly one update command and is one undo step', async () => {
    const { store } = setup(); const id = await drawRect(store);
    store.select([id]); const original = store.state.document.elements[0]!; const before = store.state.revision;
    store.startTextEdit(id); store.setPropertyDraft({ style: { fontFamily: 'roboto' } });
    store.commitTextEdit(); await store.whenIdle();
    const element = store.state.document.elements[0]!;
    expect(store.state.textEdit).toBeNull(); expect(store.state.revision).toBe(before + 1);
    expect(element.style.fontFamily).toBe('roboto'); expect(element.text).toBe(original.text);
    expect({ ...element.style, fontFamily: original.style.fontFamily }).toEqual(original.style);
    store.undo(); await store.whenIdle(); expect(store.state.document.elements[0]!.style).toEqual(original.style);
  });

  test('text and style are saved together and undone together in one step', async () => {
    const { store } = setup(); const id = await drawRect(store);
    store.select([id]); const original = store.state.document.elements[0]!; const before = store.state.revision;
    store.startTextEdit(id); store.setTextDraft('Hallo'); store.setPropertyDraft({ style: { textAlign: 'center', fontFamily: 'mono' } });
    expect(store.state.document.elements[0]!.text).toBe(original.text);
    store.commitTextEdit(); await store.whenIdle();
    expect(store.state.revision).toBe(before + 1);
    expect(store.state.document.elements[0]).toMatchObject({ text: 'Hallo', style: { textAlign: 'center', fontFamily: 'mono' } });
    store.undo(); await store.whenIdle();
    expect(store.state.document.elements[0]!.text).toBe(original.text); expect(store.state.document.elements[0]!.style).toEqual(original.style);
  });

  test('cancel discards text and style and leaves the document and selection values unchanged', async () => {
    const { store } = setup(); const id = await drawRect(store);
    store.select([id]); const original = store.state.document; const style = store.state.document.elements[0]!.style;
    store.startTextEdit(id); store.setTextDraft('Weg'); store.setPropertyDraft({ style: { fontFamily: 'scribbled' } });
    store.cancelTextEdit();
    expect(store.state.textEdit).toBeNull(); expect(store.state.document).toBe(original);
    expect(store.state.selectionInfo.values.fontFamily).toBe(style.fontFamily); expect(store.state.hasDraft).toBe(false);
  });

  test('new text adopts the draft style and an untouched empty new text writes nothing', async () => {
    const { store } = setup(); const before = store.state.revision;
    store.startTextEdit(); store.setPropertyDraft({ style: { fontFamily: 'roboto' } });
    expect(store.state.selectionInfo.values.fontFamily).toBe('roboto');
    store.commitTextEdit(); await store.whenIdle(); expect(store.state.revision).toBe(before); expect(store.state.document.elements).toHaveLength(0);
    store.startTextEdit(); store.setPropertyDraft({ style: { fontFamily: 'scribbled' } }); store.setTextDraft('Neu');
    store.commitTextEdit(); await store.whenIdle();
    expect(store.state.document.elements).toHaveLength(1); expect(store.state.document.elements[0]).toMatchObject({ kind: 'text', text: 'Neu', style: { fontFamily: 'scribbled' } });
  });

  test('external base changes still conflict; keeping mine applies only my own style keys', async () => {
    const { store } = setup(); const id = await drawRect(store);
    store.select([id]); store.startTextEdit(id); store.setPropertyDraft({ style: { fontFamily: 'roboto' } });
    expect(store.state.textEdit?.conflict).toBeNull();
    await peerUpdate(store, id, { style: { fill: '#ff0000' } });
    expect(store.state.textEdit?.conflict).not.toBeNull();
    store.commitTextEdit(); await tick(); expect(store.state.textEdit).not.toBeNull(); expect(store.state.document.elements[0]!.style.fontFamily).not.toBe('roboto');
    store.resolveTextConflict('keep-mine'); await store.whenIdle();
    expect(store.state.textEdit).toBeNull();
    expect(store.state.document.elements[0]!.style).toMatchObject({ fontFamily: 'roboto', fill: '#ff0000' });
  });

  test('read-only state and transitions ignore style drafts; close barrier saves text and style first', async () => {
    const { store, bridge, close } = setup(); const id = await drawRect(store);
    store.select([id]); store.startTextEdit(id); store.setTextDraft('Sichern'); store.setPropertyDraft({ style: { fontFamily: 'scribbled' } });
    close(); await tick(); expect(store.state.transitioning).toBe(true);
    store.setPropertyDraft({ style: { fontFamily: 'mono' } });
    expect(store.state.textEdit?.style.fontFamily).toBe('scribbled');
    await store.resolveDialog('save');
    expect(bridge.saveDocument).toHaveBeenCalled();
    const saved = JSON.parse((bridge.saveDocument as ReturnType<typeof vi.fn>).mock.calls[0]![0].text);
    expect(saved.elements[0]).toMatchObject({ text: 'Sichern', style: { fontFamily: 'scribbled' } });
  });
});
