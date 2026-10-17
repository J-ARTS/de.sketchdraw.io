import { afterEach, describe, expect, test, vi } from 'vitest';
import { createController, createDocument, createElement, deserializeDocument, type DesktopBridge, type SaveDocumentResult } from '@/domain';
import { createWhiteboardStore } from '@/renderer/state/whiteboard';
import type { PointerInput, WhiteboardStore } from '@/renderer/state/contract';

const stores: WhiteboardStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.dispose(); });
function setup(overrides: Partial<DesktopBridge> = {}) {
  let close: (id: string) => void = () => {};
  const bridge: DesktopBridge = {
    platform: 'electron', openDocument: vi.fn<DesktopBridge['openDocument']>(async () => ({ status: 'cancelled' })),
    saveDocument: vi.fn<DesktopBridge['saveDocument']>(async () => ({ status: 'saved', file: { handleId: 'handle', name: 'test.sketchdraw.json', versionToken: 'v1' } })),
    exportFile: vi.fn<DesktopBridge['exportFile']>(async () => ({ status: 'exported', name: 'test.sketchdraw.json' })),
    openExternal: vi.fn(async () => {}), onCloseRequested: fn => { close = fn; return () => {}; },
    respondToClose: vi.fn(async () => {}), onMenuCommand: () => () => {}, ...overrides,
  };
  const store = createWhiteboardStore({ bridge }); stores.push(store);
  return { store, bridge, close: (id = 'close-1') => close(id) };
}
const point = (x: number, y: number): PointerInput => ({ x, y, button: 0, pointerType: 'mouse', shiftKey: false, altKey: false, metaOrCtrl: false, detail: 1 });
async function draw(store: WhiteboardStore, kind = 'rectangle' as 'rectangle' | 'ellipse' | 'container', x = 300) {
  store.setTool(kind); store.pointerDown(point(x, 200)); store.pointerMove(point(x + 100, 280)); store.pointerUp(point(x + 100, 280)); await store.whenIdle();
}
async function tick() { await new Promise(resolve => setTimeout(resolve, 0)); }

describe('Whiteboard uses the real session gateway', () => {
  test('connector tool commits only a binding between two distinct elements', async () => {
    const { store } = setup();
    await draw(store, 'rectangle', 200); await draw(store, 'ellipse', 500);
    const before = store.state.revision;

    store.setTool('connector');
    store.pointerDown(point(350, 400));
    expect(store.state.revision).toBe(before);
    expect(store.state.notices.at(-1)?.text).toContain('Beginne den Pfeil');

    store.pointerDown(point(240, 240)); store.pointerMove(point(260, 250)); store.pointerUp(point(260, 250));
    await store.whenIdle();
    expect(store.state.document.elements.filter((element) => element.kind === 'connector')).toHaveLength(0);
    expect(store.state.notices.at(-1)?.text).toContain('anderes Element');

    store.setTool('connector'); store.pointerDown(point(250, 240)); store.pointerMove(point(550, 240));
    expect(store.state.connectorTargets).toMatchObject({ fromId: store.state.document.elements[0]!.id, toId: store.state.document.elements[1]!.id });
    store.pointerUp(point(550, 240)); await store.whenIdle();
    const connector = store.state.document.elements.find((element) => element.kind === 'connector')!;
    expect(connector.from?.elementId).toBe(store.state.document.elements[0]!.id);
    expect(connector.to?.elementId).toBe(store.state.document.elements[1]!.id);
    expect(connector.from?.elementId).not.toBe(connector.to?.elementId);
    expect(store.state.connectorTargets).toBeNull();
    expect(store.state.selection).toEqual([connector.id]);
    store.applyPatch({ connectorRouting: 'curved', startMarker: 'circle', endMarker: 'diamond' });
    await store.whenIdle();
    expect(store.state.document.elements.find((element) => element.id === connector.id)).toMatchObject({ connectorRouting: 'curved', startMarker: 'circle', endMarker: 'diamond' });
  });
  test('single-page rename persists independently and participates in undo', async () => {
    const { store, bridge } = setup();
    store.renamePage('page:1', '  Übersicht  '); await store.whenIdle();
    expect(store.state.pages).toEqual([{ id: 'page:1', name: 'Übersicht', elementCount: 0 }]);
    expect(store.state.title).toBe('Unbenannt');
    expect(store.state.document.metadata['sketchdraw.page.v1.name']).toBe('Übersicht');
    await store.save();
    const saved = deserializeDocument(vi.mocked(bridge.saveDocument).mock.calls[0]![0].text);
    expect(saved.metadata['sketchdraw.page.v1.name']).toBe('Übersicht');
    const reopened = createWhiteboardStore({ bridge, controller: createController(saved) }); stores.push(reopened);
    expect(reopened.state.pages[0]?.name).toBe('Übersicht');
    expect(reopened.state.title).toBe('Unbenannt');
    store.undo(); await store.whenIdle();
    expect(store.state.pages[0]?.name).toBe('Seite 1');
    expect(store.state.document.metadata['sketchdraw.page.v1.name']).toBeUndefined();
  });

  test('single-page rename rejects empty, overlong and foreign-page names and removes the default override', async () => {
    const { store } = setup();
    store.renamePage('page:other', 'Falsch');
    store.renamePage('page:1', '   ');
    store.renamePage('page:1', 'x'.repeat(121));
    await store.whenIdle();
    expect(store.state.revision).toBe(0);
    expect(store.state.pages[0]?.name).toBe('Seite 1');
    store.renamePage('page:1', 'Details'); await store.whenIdle();
    store.renamePage('page:1', ' Seite 1 '); await store.whenIdle();
    expect(store.state.pages[0]?.name).toBe('Seite 1');
    expect(store.state.document.metadata['sketchdraw.page.v1.name']).toBeUndefined();
  });

  test('draw, resize and actor undo/redo form one history entry per gesture', async () => {
    const { store } = setup(); await draw(store);
    expect(store.state.document.elements).toHaveLength(1);
    const original = store.state.document.elements[0]!;
    const handle = store.state.handles.find(h => h.id === 'se')!;
    store.pointerDown(point(handle.x, handle.y)); store.pointerMove(point(handle.x + 50, handle.y + 30)); store.pointerUp(point(handle.x + 50, handle.y + 30)); await store.whenIdle();
    expect(store.state.document.elements[0]!.width).toBe(150);
    store.undo(); await store.whenIdle(); expect(store.state.document.elements[0]).toEqual(original);
    store.undo(); await store.whenIdle(); expect(store.state.document.elements).toHaveLength(0);
    store.redo(); await store.whenIdle(); expect(store.state.document.elements).toHaveLength(1);
  });
  test('a click creates the tool default size and group movement moves children once', async () => {
    const { store } = setup(); store.setTool('rectangle'); store.pointerDown(point(300, 200)); store.pointerUp(point(300, 200)); await store.whenIdle();
    expect(store.state.document.elements[0]!.width).toBe(160);
    store.groupSelection(); await store.whenIdle();
    const child = store.state.document.elements.find(e => e.kind === 'rectangle')!;
    store.selectAll(); store.nudge(10, 0); store.endNudge(); await store.whenIdle();
    expect(store.state.document.elements.find(e => e.id === child.id)!.x).toBe(child.x + 10);
    store.undo(); await store.whenIdle(); expect(store.state.document.elements.find(e => e.id === child.id)!.x).toBe(child.x);
  });
  test('IME draft survives close cancellation and cannot be saved mid-composition', async () => {
    const { store, close, bridge } = setup(); store.startTextEdit(); store.setTextDraft('日本語'); store.setComposing(true);
    expect(store.commitTextEdit()).toBe(false); close(); await tick();
    expect(store.state.dialog?.kind).toBe('unsaved');
    await store.resolveDialog('save'); expect(bridge.saveDocument).not.toHaveBeenCalled(); expect(store.state.textEdit?.draft).toBe('日本語');
    await store.resolveDialog('cancel'); expect(bridge.respondToClose).toHaveBeenCalledWith('close-1', 'cancel');
    store.setComposing(false); store.commitTextEdit(); await store.whenIdle();
    expect(store.state.document.elements[0]!.text).toBe('日本語');
  });
  test('a save confirms its captured revision; later commits remain dirty', async () => {
    let finish!: (value: SaveDocumentResult) => void;
    const { store, bridge } = setup({ saveDocument: vi.fn<DesktopBridge['saveDocument']>(() => new Promise<SaveDocumentResult>(resolve => { finish = resolve; })) });
    await draw(store); const save = store.save(); await tick();
    store.setTitle('Nach dem Speichern geändert'); await store.whenIdle();
    finish({ status: 'saved', file: { handleId: 'a', name: 'first.json', versionToken: 'one' } }); await save;
    const request = vi.mocked(bridge.saveDocument).mock.calls[0]![0];
    expect(deserializeDocument(request.text).title).toBe('Unbenannt'); expect(store.state.saveStatus).toBe('dirty');
  });
  test('browser download never claims persisted save', async () => {
    const { store } = setup({ platform: 'browser', saveDocument: async () => ({ status: 'download-initiated', name: 'export.json' }) });
    await draw(store); await store.save(); expect(store.state.file.savedRevision).toBeNull(); expect(store.state.saveStatus).toBe('handed-off');
  });
  test('invalid or stale code retains draft and canonical document', async () => {
    const { store } = setup(); await draw(store); const original = store.state.document;
    store.setCodeDraft('not a diagram'); expect(await store.applyCode()).toBe(false); expect(store.state.code.dirty).toBe(true); expect(store.state.document).toEqual(original);
    store.resetCodeDraft(); store.setCodeDraft(store.state.code.text.replace('Unbenannt', 'Aus Code'));
    store.setTitle('Canvas'); await store.whenIdle(); expect(await store.applyCode()).toBe(false);
    expect(store.state.title).toBe('Canvas'); expect(store.state.code.text).toContain('Aus Code');
  });
  test('remote edits cause retained text and gesture conflicts rather than silent overwrite', async () => {
    const { store } = setup(); await draw(store);
    const authority = store.getAuthority()!; const peer = authority.bindActor({ actorId: 'agent', source: 'agent', grantId: 'g', grantGeneration: 0, guard: () => ({ allowed: true }) });
    const id = store.state.document.elements[0]!.id; store.startTextEdit(id); store.setTextDraft('Mine');
    await peer.gateway.submit({ requestId: peer.gateway.nextRequestId()!, expectedRevision: store.state.revision, action: { kind: 'dispatch', command: { type: 'update', changes: [{ id, patch: { text: 'Other' } }] } } });
    store.commitTextEdit(); await tick(); expect(store.state.textEdit?.draft).toBe('Mine'); expect(store.state.document.elements[0]!.text).toBe('Other');
    store.resolveTextConflict('insert-new'); await store.whenIdle(); expect(store.state.document.elements).toHaveLength(2);
    store.select([id]); store.pointerDown(point(400, 280)); store.pointerMove(point(430, 300));
    await peer.gateway.submit({ requestId: peer.gateway.nextRequestId()!, expectedRevision: store.state.revision, action: { kind: 'dispatch', command: { type: 'update', changes: [{ id, patch: { x: 700 } }] } } });
    store.pointerUp(point(430, 300)); await tick(); expect(store.state.gestureConflict).not.toBeNull(); expect(store.state.document.elements[0]!.x).toBe(700);
    store.resolveGestureConflict('discard'); expect(store.state.gestureConflict).toBeNull();
  });
  test('close barrier blocks agent writes and cancellation releases only that transition', async () => {
    const { store, close } = setup(); await draw(store);
    const authority = store.getAuthority()!; const agent = authority.bindActor({ actorId: 'agent', source: 'agent', grantId: 'g', grantGeneration: 0, guard: () => ({ allowed: true }) });
    close(); expect(store.state.transitioning).toBe(true); expect(agent.gateway.nextRequestId()).toBeNull(); await tick();
    await store.resolveDialog('cancel'); expect(agent.gateway.nextRequestId()).not.toBeNull();
    expect(store.state.document.elements).toHaveLength(1);
  });
  test('replacement notifies trusted adapters with a new authority, even same document ID', async () => {
    const document = createDocument('Opened'); document.elements = [createElement('ellipse')];
    const controller = createController(document);
    const { bridge } = setup({ openDocument: async () => ({ status: 'opened', text: JSON.stringify(document), file: { handleId: 'a', name: 'opened.json', versionToken: 'v' } }) });
    const store = createWhiteboardStore({ bridge, controller }); stores.push(store);
    const old = store.getAuthority()!; const listener = vi.fn(); store.subscribeAuthority(listener);
    await store.openDocument();
    expect(listener).toHaveBeenCalledTimes(1); expect(store.getAuthority()!.session.documentId).toBe(old.session.documentId);
    expect(store.getAuthority()!.session.controllerEpoch).not.toBe(old.session.controllerEpoch);
  });
});

describe('draft and lifecycle recovery', () => {
  test('malformed opened file never replaces the document, and unlocks editing', async () => {
    const { store } = setup({ openDocument: async () => ({ status: 'opened', text: '{broken', file: { handleId: 'a', name: 'broken.json', versionToken: 'v' } }) });
    await draw(store); const before = store.state.document;
    await store.openDocument(); await store.resolveDialog('discard');
    expect(store.state.document).toEqual(before); expect(store.state.transitioning).toBe(false);
    store.setTitle('Still editing'); await store.whenIdle(); expect(store.state.title).toBe('Still editing');
  });
  test('cancelled save in new-document dialog keeps document and retryable dialog', async () => {
    const { store } = setup({ saveDocument: async () => ({ status: 'cancelled' }) });
    await draw(store); await store.newDocument(); await store.resolveDialog('save');
    expect(store.state.dialog?.kind).toBe('unsaved'); expect(store.state.document.elements).toHaveLength(1);
    await store.resolveDialog('cancel'); expect(store.state.transitioning).toBe(false);
  });
  test('successful close saves both title and text drafts under final write barrier', async () => {
    const { store, bridge, close } = setup();
    store.updateTitleDraft('Entwurfstitel'); store.startTextEdit(); store.setTextDraft('Noch nicht übernommen');
    close(); await tick(); await store.resolveDialog('save');
    expect(bridge.respondToClose).toHaveBeenCalledWith('close-1', 'close');
    const saved = deserializeDocument(vi.mocked(bridge.saveDocument).mock.calls[0]![0].text);
    expect(saved.title).toBe('Entwurfstitel'); expect(saved.elements[0]!.text).toBe('Noch nicht übernommen');
  });
  test('uncommitted nudge is included in save and rejected nudge preview is retained', async () => {
    const { store, bridge } = setup(); await draw(store);
    store.nudge(12, 0); await store.save();
    const saved = deserializeDocument(vi.mocked(bridge.saveDocument).mock.calls[0]![0].text);
    expect(saved.elements[0]!.x).toBe(312);
    store.nudge(10, 0);
    const agent = store.getAuthority()!.bindActor({ actorId: 'agent', source: 'agent', grantId: 'g', grantGeneration: 0, guard: () => ({ allowed: true }) });
    await agent.gateway.submit({ requestId: agent.gateway.nextRequestId()!, expectedRevision: store.state.revision, action: { kind: 'dispatch', command: { type: 'update', changes: [{ id: saved.elements[0]!.id, patch: { x: 900 } }] } } });
    store.endNudge(); await tick(); expect(store.state.gestureConflict).not.toBeNull();
    expect(store.state.document.elements[0]!.x).toBe(900); expect(store.state.displayElements[0]!.x).toBe(322);
  });
});

test('unblurred property draft is saved on close under the final barrier', async () => {
  const { store, bridge, close } = setup(); await draw(store);
  store.setPropertyDraft({ label: 'Noch fokussiert', width: 180 });
  close(); await tick(); await store.resolveDialog('save');
  const document = deserializeDocument(vi.mocked(bridge.saveDocument).mock.calls[0]![0].text);
  expect(document.elements[0]!.label).toBe('Noch fokussiert'); expect(document.elements[0]!.width).toBe(180);
});

test('a single rejected property draft shows its values without inventing mixed selection', async () => {
  const { store } = setup(); await draw(store);
  store.applyPatch({ label: 'Original' }); await store.whenIdle();
  const before = store.state.document;
  store.setPropertyDraft({ width: -1, label: 'Mein Entwurf', style: { strokeWidth: -2 } });
  expect(store.state.selectionInfo.values).toMatchObject({ width: -1, label: 'Mein Entwurf', strokeWidth: -2 });
  expect(store.state.selectionInfo.mixed).toEqual([]);
  expect(await store.commitPropertyDraft()).toBe(false);
  expect(store.state.document).toEqual(before);
  expect(store.state.selectionInfo.values.width).toBe(-1);
  expect(store.state.selectionInfo.mixed).toEqual([]);
  store.discardPropertyDraft();
  expect(store.state.selectionInfo.values.width).toBe(100);
  expect(store.state.selectionInfo.values.label).toBe('Original');
  store.setPropertyDraft({ label: null });
  expect(store.state.selectionInfo.values.label).toBeUndefined();
  expect(store.state.selectionInfo.mixed).toEqual([]);
  expect(store.state.document.elements[0]!.label).toBe('Original');
});

test('shared property drafts unify only edited fields and preserve real multiselection differences', async () => {
  const { store } = setup(); await draw(store); await draw(store, 'rectangle', 600);
  store.applyPatch({ width: 160, height: 90, style: { stroke: '#ef4444', strokeWidth: 3 } }); await store.whenIdle();
  store.selectAll();
  expect(store.state.selectionInfo.mixed).toEqual(expect.arrayContaining(['x', 'width', 'height', 'stroke', 'strokeWidth']));
  store.setPropertyDraft({ width: 0, style: { stroke: '#15803d' } });
  expect(store.state.selectionInfo.values).toMatchObject({ width: 0, stroke: '#15803d' });
  expect(store.state.selectionInfo.mixed).not.toContain('width');
  expect(store.state.selectionInfo.mixed).not.toContain('stroke');
  expect(store.state.selectionInfo.mixed).toEqual(expect.arrayContaining(['x', 'height', 'strokeWidth']));
  expect(await store.commitPropertyDraft()).toBe(false);
  store.discardPropertyDraft();
  expect(store.state.selectionInfo.mixed).toEqual(expect.arrayContaining(['width', 'stroke']));
  store.setPropertyDraft({ width: 200, style: { stroke: '#15803d' } });
  expect(await store.commitPropertyDraft()).toBe(true);
  expect(store.state.document.elements.map(element => element.width)).toEqual([200, 200]);
  expect(store.state.document.elements.map(element => element.style.stroke)).toEqual(['#15803d', '#15803d']);
  expect(store.state.selectionInfo.mixed).toEqual(expect.arrayContaining(['x', 'height', 'strokeWidth']));
  expect(store.state.selectionInfo.mixed).not.toContain('width');
  expect(store.state.selectionInfo.mixed).not.toContain('stroke');
});

test('close takes over an existing unsaved new-dialog and responds to the native request', async () => {
  const { store, bridge, close } = setup(); await draw(store); await store.newDocument();
  close('close-2'); await tick(); await store.resolveDialog('cancel');
  expect(bridge.respondToClose).toHaveBeenCalledWith('close-2', 'cancel');
  expect(store.state.document.elements).toHaveLength(1);
});

test('blank title draft blocks close-save and remains recoverable', async () => {
  const { store, bridge, close } = setup(); store.updateTitleDraft('   '); close(); await tick();
  await store.resolveDialog('save'); expect(bridge.saveDocument).not.toHaveBeenCalled(); expect(bridge.respondToClose).not.toHaveBeenCalled();
  expect(store.state.dialog?.kind).toBe('unsaved'); await store.resolveDialog('cancel');
  store.updateTitleDraft('  Gültiger Titel  '); await store.save();
  expect(store.state.title).toBe('Gültiger Titel'); expect(store.state.hasDraft).toBe(false);
});

test('failed close barrier and stale final draft generation cancel the native request', async () => {
  const { store, bridge, close } = setup(); await draw(store);
  const gate = store.getAuthority()!.lifecycleGate;
  const occupied = await gate.beginTransition('revoke', 0);
  close('blocked-close'); await tick();
  expect(bridge.respondToClose).toHaveBeenCalledWith('blocked-close', 'cancel');
  expect(store.state.transitioning).toBe(false); gate.cancelTransition(occupied.token);
  close('stale-close'); await tick(); store.setInputComposing(true);
  await store.resolveDialog('discard');
  expect(bridge.respondToClose).toHaveBeenCalledWith('stale-close', 'cancel');
  expect(store.state.transitioning).toBe(false); expect(store.state.document.elements).toHaveLength(1);
});

test('converted import starts unsaved at revision zero and cancellation preserves the old document', async () => {
  const { store, bridge } = setup(); await draw(store); const old = store.state.document;
  const imported = createDocument('Import'); imported.elements = [createElement('diamond')];
  await store.importDocument(imported); await store.resolveDialog('cancel'); expect(store.state.document).toEqual(old);
  await store.importDocument(imported); await store.resolveDialog('discard');
  expect(store.state.title).toBe('Import'); expect(store.state.revision).toBe(0); expect(store.needsCloseWarning()).toBe(true);
  expect(store.state.saveStatusText).not.toBe('Neues Dokument');
  await store.save(); expect(bridge.saveDocument).toHaveBeenCalled(); expect(store.needsCloseWarning()).toBe(false);
});
