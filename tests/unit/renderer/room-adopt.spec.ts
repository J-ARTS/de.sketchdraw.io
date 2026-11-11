import { afterEach, expect, test, vi } from 'vitest';
import { createCrdtController, createCrdtControllerFromUpdate } from '@/crdt';
import { createDocument, createElement, type DesktopBridge } from '@/domain';
import { createWhiteboardStore } from '@/renderer/state/whiteboard';
import type { WhiteboardStore } from '@/renderer/state/contract';

const stores: WhiteboardStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.dispose(); });
const bridge: DesktopBridge = { platform: 'electron', saveDocument: async () => ({ status: 'cancelled' }), openDocument: async () => ({ status: 'cancelled' }), exportFile: async () => ({ status: 'cancelled' }), openExternal: async () => {}, onCloseRequested: () => () => {}, respondToClose: async () => {}, onMenuCommand: () => () => {} };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('a room document replaces the open one and follows later remote updates', async () => {
  const store = createWhiteboardStore({ bridge }); stores.push(store);
  const hostDocument = createDocument('Gemeinsam');
  hostDocument.elements = [createElement('rectangle', { x: 10, y: 20, width: 100, height: 60 })];
  const host = createCrdtController(hostDocument);
  const room = createCrdtControllerFromUpdate(host.encodeUpdate());

  expect(await store.adoptRoomDocument(room)).toBe(true);
  expect(store.getCrdtController()).toBe(room);
  expect(store.state.document.id).toBe(hostDocument.id);
  expect(store.state.document.elements).toHaveLength(1);

  host.dispatch({ type: 'add', elements: [createElement('ellipse', { x: 300, y: 20, width: 80, height: 80 })] }, { actorId: 'actor:host', expectedRevision: host.getSnapshot().revision, source: 'human' });
  // Remote updates enter through the authority, which keeps session layer and diagram consistent.
  store.getAuthority()!.applyExternalUpdate(() => room.applyRemoteUpdate(host.encodeUpdate(room.encodeStateVector()), { actorId: 'peer:host', role: 'owner', source: 'peer' }));
  await tick(); await store.whenIdle();
  expect(room.getSnapshot().document.elements).toHaveLength(2);
  expect(store.state.document.elements).toHaveLength(2);
});

function roomFor(title = 'Raum') {
  const hostDocument = createDocument(title);
  const host = createCrdtController(hostDocument);
  return { host, room: createCrdtControllerFromUpdate(host.encodeUpdate()), hostDocument };
}

test('the room-guest marker is set atomically before authority listeners run (no local agent authority, #150)', async () => {
  for (const role of ['editor', 'viewer'] as const) {
    const store = createWhiteboardStore({ bridge }); stores.push(store);
    const seen: Array<ReturnType<WhiteboardStore['getRoomGuest']>> = [];
    store.subscribeAuthority(() => { seen.push(store.getRoomGuest()); });
    expect(await store.adoptRoomDocument(roomFor(role).room, { role })).toBe(true);
    expect(seen.at(-1)).toEqual({ role, connected: true });
  }
});

test('a viewer guest cannot write locally; an editor guest can only while connected, and a lost connection keeps the block', async () => {
  const viewer = createWhiteboardStore({ bridge }); stores.push(viewer);
  await viewer.adoptRoomDocument(roomFor('viewer').room, { role: 'viewer' });
  expect(viewer.state.canWrite).toBe(false);
  const store = createWhiteboardStore({ bridge }); stores.push(store);
  await store.adoptRoomDocument(roomFor('editor').room, { role: 'editor' });
  expect(store.state.canWrite).toBe(true);
  store.setRoomConnected(false);
  expect(store.state.canWrite).toBe(false);
  expect(store.getRoomGuest()).toEqual({ role: 'editor', connected: false });
  store.setRoomConnected(true);
  expect(store.state.canWrite).toBe(true);
});

test('joining a room with the same document id marks the guest without replacing the document, and leaving restores local authority', () => {
  const store = createWhiteboardStore({ bridge }); stores.push(store);
  const notified: Array<ReturnType<WhiteboardStore['getRoomGuest']>> = [];
  store.subscribeAuthority(() => { notified.push(store.getRoomGuest()); });
  const authority = store.getAuthority();
  expect(store.state.canWrite).toBe(true);
  store.enterRoomGuest('viewer');
  expect(store.getAuthority()).toBe(authority);
  expect(store.state.canWrite).toBe(false);
  expect(notified.at(-1)).toEqual({ role: 'viewer', connected: true });
  store.setRoomConnected(false);
  expect(store.getRoomGuest()).not.toBeNull();
  store.leaveRoomGuest();
  expect(notified.at(-1)).toBeNull();
  expect(store.state.canWrite).toBe(true);
});

test('a cancelled replacement keeps the guest role and authority; confirming ends the guest role', async () => {
  const store = createWhiteboardStore({ bridge }); stores.push(store);
  await store.adoptRoomDocument(roomFor('A').room, { role: 'viewer' });
  const authority = store.getAuthority();
  const attempt = store.newDocument();
  await vi.waitFor(() => expect(store.state.dialog?.kind).toBe('unsaved'));
  await store.resolveDialog('cancel');
  await attempt;
  expect(store.getRoomGuest()).toEqual({ role: 'viewer', connected: true });
  expect(store.getAuthority()).toBe(authority);
  expect(store.state.canWrite).toBe(false);
  void store.newDocument();
  await vi.waitFor(() => expect(store.state.dialog?.kind).toBe('unsaved'));
  await store.resolveDialog('discard');
  await store.whenIdle();
  expect(store.getRoomGuest()).toBeNull();
  expect(store.state.canWrite).toBe(true);
});
