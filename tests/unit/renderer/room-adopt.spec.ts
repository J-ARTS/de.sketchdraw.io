import { afterEach, expect, test } from 'vitest';
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
