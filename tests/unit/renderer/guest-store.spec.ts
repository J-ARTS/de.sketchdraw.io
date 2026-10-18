import { afterEach, expect, test, vi } from 'vitest';
import { createController, createDocument, deserializeDocument, type DesktopBridge } from '@/domain';
import { createDocumentAuthority, type WriteIntent, type WriteOutcome } from '@/session';
import type { CollaborationStatus, GuestSession } from '@/collaboration';
import { createWhiteboardStore } from '@/renderer/state/whiteboard';
import type { PointerInput, WhiteboardStore } from '@/renderer/state/contract';

// Transport boundary fixture: canonical writes and lifecycle checks use the real authority.
// These are renderer coordination tests, not a WebRTC or Internet connectivity claim.
const stores: WhiteboardStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.dispose(); });
function setup() {
  const save = vi.fn<DesktopBridge['saveDocument']>(async () => ({ status: 'saved', file: { handleId: 'copy', name: 'copy.json', versionToken: '1' } }));
  const bridge: DesktopBridge = { platform: 'electron', saveDocument: save, openDocument: async () => ({ status: 'cancelled' }), exportFile: async () => ({ status: 'cancelled' }), openExternal: async () => {}, onCloseRequested: () => () => {}, respondToClose: async () => {}, onMenuCommand: () => () => {} };
  const factory = vi.fn((controller: ReturnType<typeof createController>) => createDocumentAuthority({ controller }));
  const store = createWhiteboardStore({ bridge, authorityFactory: factory }); stores.push(store);
  return { store, save, factory };
}
function guestFixture(role: 'editor' | 'viewer' = 'editor') {
  const authority = createDocumentAuthority({ controller: createController(createDocument('Peer-Dokument')) });
  const binding = authority.bindActor({ actorId: 'peer:fixture', source: 'peer', grantId: 'peer-grant', grantGeneration: 0, peerSessionId: 'a'.repeat(32), guard: check => role === 'editor' || check.permission === 'read' ? { allowed: true } : { allowed: false, code: 'ACCESS_DENIED' } });
  let status: CollaborationStatus = { mode: 'guest', state: 'ready', session: { ...authority.session, sessionId: 'a'.repeat(32), permissionEpoch: 0 }, role, confirmedRevision: 0, pendingWrites: 0, hasUnresolvedOutcome: false, peers: [] };
  const listeners = new Set<(status: CollaborationStatus) => void>();
  function update(patch: Partial<CollaborationStatus>) { status = { ...status, ...patch }; for (const listener of listeners) listener(status); }
  authority.source.subscribe(snapshot => update({ confirmedRevision: snapshot.revision }));
  const submit = vi.fn(binding.gateway.submit); const query = vi.fn(binding.gateway.queryOutcome);
  const leave = vi.fn(async () => { update({ state: 'closed' }); });
  const guest: GuestSession = { source: binding.source, gateway: { ...binding.gateway, submit, queryOutcome: query }, lifecycleGate: { ...authority.lifecycleGate, completeTransition(token) { authority.lifecycleGate.completeTransition(token); void leave(); } }, getStatus: () => status, subscribeStatus: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, leave, acceptReconnectOffer: async () => { throw new Error('not part of renderer fixture'); } };
  return { guest, authority, binding, update, submit, query, leave };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const point = (x: number, y: number): PointerInput => ({ x, y, button: 0, pointerType: 'mouse', shiftKey: false, altKey: false, metaOrCtrl: false, detail: 1 });
function draw(store: WhiteboardStore) {
  store.setTool('rectangle'); store.pointerDown(point(300, 200)); store.pointerMove(point(420, 280)); store.pointerUp(point(420, 280)); return store.whenIdle();
}

test('join cancellation keeps local drafts; accepted guest writes, code and undo use the supplied gateway without a guest controller', async () => {
  const { store, factory } = setup(); const { guest, submit, authority } = guestFixture(); const changes = vi.fn(); store.subscribeAuthority(changes);
  store.updateTitleDraft('Lokaler Entwurf');
  const cancelled = store.joinGuestSession(guest); await tick(); expect(store.state.dialog?.kind).toBe('unsaved'); await store.resolveDialog('cancel');
  expect(await cancelled).toBe(false); expect(store.getAuthority()).not.toBeNull(); expect(store.state.hasDraft).toBe(true);
  const accepted = store.joinGuestSession(guest); await tick(); await store.resolveDialog('discard'); expect(await accepted).toBe(true);
  expect(store.getAuthority()).toBeNull(); expect(changes).toHaveBeenLastCalledWith(null); expect(factory).toHaveBeenCalledTimes(1);
  await draw(store); expect(submit).toHaveBeenCalledTimes(1); expect(authority.source.getSnapshot().document.elements).toHaveLength(1);
  store.setCodeDraft(store.state.code.text.replace('Peer-Dokument', 'Code beim Gastgeber')); expect(await store.applyCode()).toBe(true);
  expect(authority.source.getSnapshot().document.title).toBe('Code beim Gastgeber');
  store.undo(); await store.whenIdle(); expect(store.state.title).toBe('Peer-Dokument'); expect(factory).toHaveBeenCalledTimes(1);
});

test('viewer and disconnected sessions suppress writes while retaining draft and allowing a confirmed local copy', async () => {
  const { store, factory } = setup(); const peer = guestFixture('viewer'); await store.joinGuestSession(peer.guest);
  expect(store.state.canWrite).toBe(false); await draw(store); store.setTool('eraser'); store.setPencilPreset('marker'); store.setPencilColor('#e5533a'); store.setPencilSize(200); store.setPencilOpacity(20); store.setEraserRadius(200); expect(store.state.tool).toBe('select'); expect(store.state.pencilPreset).toBe('fine'); expect(store.state.pencilColor).toBe('#1e1e1e'); expect(store.state.pencilSize).toBe(2); expect(store.state.pencilOpacity).toBe(100); expect(store.state.eraserRadius).toBe(18); store.setTitle('Denied'); store.renamePage('page:1', 'Denied page'); store.deleteSelection(); await store.whenIdle(); expect(peer.submit).not.toHaveBeenCalled();
  store.setTool('laser'); expect(store.state.tool).toBe('laser'); store.pointerDown(point(300, 200)); store.pointerMove(point(420, 280)); store.pointerUp(point(420, 280)); await store.whenIdle(); expect(peer.submit).not.toHaveBeenCalled(); store.setTool('select');
  peer.update({ role: 'editor', state: 'disconnected' }); expect(store.state.canWrite).toBe(false); store.setCodeDraft('blocked'); expect(store.state.code.dirty).toBe(false);
  const leave = store.leaveGuestSession(); await tick(); await store.resolveDialog('discard'); expect(await leave).toBe(true);
  expect(peer.leave).toHaveBeenCalledTimes(1); expect(store.getAuthority()).not.toBeNull(); expect(factory).toHaveBeenCalledTimes(2); expect(store.state.title).toBe('Peer-Dokument'); expect(store.needsCloseWarning()).toBe(true);
});

test('an editor page rename uses the shared authority and updates every snapshot view', async () => {
  const { store } = setup(); const peer = guestFixture(); await store.joinGuestSession(peer.guest);
  store.renamePage('page:1', 'Gemeinsame Übersicht'); await store.whenIdle();
  expect(peer.submit).toHaveBeenCalledWith(expect.objectContaining({
    action: { kind: 'dispatch', command: expect.objectContaining({
      type: 'replace',
      document: expect.objectContaining({
        metadata: expect.objectContaining({
          'sketchdraw.pages.compat.v1': expect.stringContaining('"name":"Gemeinsame Übersicht"'),
        }),
      }),
    }) },
  }));
  expect(peer.authority.source.getSnapshot().document.metadata['sketchdraw.pages.compat.v1']).toContain('Gemeinsame Übersicht');
  expect(store.state.pages[0]?.name).toBe('Gemeinsame Übersicht');
});

test('unknown result keeps gesture, blocks save/retry, and queries the same request before clearing confirmed draft', async () => {
  const { store, save } = setup(); const peer = guestFixture(); await store.joinGuestSession(peer.guest);
  let submitted!: WriteIntent;
  peer.submit.mockImplementation(async intent => { submitted = intent; peer.update({ hasUnresolvedOutcome: true }); return { status: 'outcome-unknown', requestId: intent.requestId }; });
  await draw(store); expect(store.state.gestureConflict).not.toBeNull(); expect(store.state.pendingPeerWrite?.requestId).toBe(submitted.requestId);
  await store.save(); expect(save).not.toHaveBeenCalled(); store.resolveGestureConflict('retry'); await store.whenIdle(); expect(peer.submit).toHaveBeenCalledTimes(1);
  peer.query.mockResolvedValueOnce({ status: 'outcome-unknown', requestId: submitted.requestId }); await store.resolvePendingWrite(); expect(store.state.gestureConflict).not.toBeNull();
  const committed = await peer.binding.gateway.submit(submitted); peer.update({ hasUnresolvedOutcome: false }); peer.query.mockResolvedValueOnce(committed);
  await store.resolvePendingWrite(); expect(peer.query).toHaveBeenLastCalledWith(submitted.requestId); expect(store.state.pendingPeerWrite).toBeNull(); expect(store.state.gestureConflict).toBeNull(); expect(store.state.document.elements).toHaveLength(1);
  await store.save(); expect(deserializeDocument(save.mock.calls[0]![0].text).elements).toHaveLength(1);
});

test('leaving unknown proposal only copies confirmed snapshot; pending response cannot alter replacement document', async () => {
  const { store } = setup(); const peer = guestFixture(); await store.joinGuestSession(peer.guest);
  let finish!: (result: WriteOutcome) => void; let requestId = '';
  peer.submit.mockImplementation(intent => { requestId = intent.requestId; peer.update({ hasUnresolvedOutcome: true }); return new Promise(resolve => { finish = resolve; }); });
  void draw(store); await tick(); const leave = store.leaveGuestSession(); await tick();
  expect(store.state.dialog?.kind).toBe('unsaved'); await store.resolveDialog('discard'); expect(await leave).toBe(true); expect(store.state.document.elements).toHaveLength(0);
  finish({ status: 'outcome-unknown', requestId }); await tick(); expect(store.state.pendingPeerWrite).toBeNull(); expect(store.state.gestureConflict).toBeNull(); expect(store.state.document.elements).toHaveLength(0);
  await draw(store); expect(store.state.document.elements).toHaveLength(1);
});

test('saving before leave includes only successfully confirmed drafts and cancel preserves the guest', async () => {
  const { store, save } = setup(); const peer = guestFixture(); await store.joinGuestSession(peer.guest);
  store.startTextEdit(); store.setTextDraft('Bestätigter Text');
  const cancel = store.leaveGuestSession(); await tick(); await store.resolveDialog('cancel'); expect(await cancel).toBe(false); expect(store.getGuestSession()).toBe(peer.guest); expect(store.state.textEdit?.draft).toBe('Bestätigter Text');
  const leave = store.leaveGuestSession(); await tick(); await store.resolveDialog('save'); expect(await leave).toBe(true);
  expect(store.state.document.elements[0]!.text).toBe('Bestätigter Text'); expect(deserializeDocument(save.mock.calls[0]![0].text).elements[0]!.text).toBe('Bestätigter Text'); expect(store.state.file.handle).toBeNull(); expect(store.needsCloseWarning()).toBe(true);
});

test('receipt recovery clears only its own draft, preserving unrelated properties', async () => {
  const { store } = setup(); const peer = guestFixture(); await store.joinGuestSession(peer.guest); await draw(store);
  store.setPropertyDraft({ label: 'Noch offen' });
  let submitted!: WriteIntent;
  peer.submit.mockImplementation(async intent => { submitted = intent; peer.update({ hasUnresolvedOutcome: true }); return { status: 'outcome-unknown', requestId: intent.requestId }; });
  store.setTitle('Unklarer Titel'); await store.whenIdle(); expect(store.state.propertyDraft?.patch.label).toBe('Noch offen');
  const committed = await peer.binding.gateway.submit(submitted); peer.update({ hasUnresolvedOutcome: false }); peer.query.mockResolvedValueOnce(committed);
  await store.resolvePendingWrite(); expect(store.state.title).toBe('Unklarer Titel'); expect(store.state.propertyDraft?.patch.label).toBe('Noch offen');
});

test('an early committed reply cannot clear a draft or save an older mirror', async () => {
  const { store, save } = setup(); const peer = guestFixture(); await store.joinGuestSession(peer.guest);
  let submitted!: WriteIntent;
  peer.submit.mockImplementation(async intent => { submitted = intent; return { status: 'committed', requestId: intent.requestId, revision: 1 }; });
  await draw(store); expect(store.state.document.elements).toHaveLength(0); expect(store.state.pendingPeerWrite).not.toBeNull(); expect(store.state.gestureConflict).not.toBeNull();
  peer.query.mockResolvedValue({ status: 'committed', requestId: submitted.requestId, revision: 1 });
  await store.resolvePendingWrite(); expect(store.state.pendingPeerWrite).not.toBeNull(); await store.save(); expect(save).not.toHaveBeenCalled();
  await peer.binding.gateway.submit(submitted); await store.resolvePendingWrite(); expect(store.state.pendingPeerWrite).toBeNull(); expect(store.state.gestureConflict).toBeNull();
  await store.save(); expect(deserializeDocument(save.mock.calls[0]![0].text).elements).toHaveLength(1);
});
