import { afterEach, expect, test } from 'vitest';
import { createCrdtController } from '@/crdt';
import { createDocument, type DesktopBridge } from '@/domain';
import type { CollaborationTransport, CollaborationTransportMessage, CollaborationTransportStatus } from '@/collaboration/transport';
import { createWhiteboardStore } from '@/renderer/state/whiteboard';
import { RoomConnection } from '@/renderer/state/room-connection';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const bridge: DesktopBridge = { platform: 'electron', saveDocument: async () => ({ status: 'cancelled' }), openDocument: async () => ({ status: 'cancelled' }), exportFile: async () => ({ status: 'cancelled' }), openExternal: async () => {}, onCloseRequested: () => () => {}, respondToClose: async () => {}, onMenuCommand: () => () => {} };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function setup(sameDocument = false) {
  const store = createWhiteboardStore({ bridge }); cleanups.push(() => store.dispose());
  const document = sameDocument ? store.state.document : createDocument('From host');
  const host = createCrdtController(document); cleanups.push(() => host.destroy());
  const peer = { peerId: 'host', keyHash: 'a'.repeat(64), publicKeyBase64Url: '', invitationId: 'i', role: 'owner' as const, grantId: 'g', grantGeneration: 0 };
  let status: CollaborationTransportStatus = { mode: 'hyperdht-relay', state: 'ready', peers: [peer], relayUrls: [], iceServers: [], grantedRole: 'editor' };
  const statuses = new Set<(value: CollaborationTransportStatus) => void>();
  const messages = new Set<(value: CollaborationTransportMessage) => void | Promise<void>>();
  const errors: Error[] = [], changes: CollaborationTransportStatus[] = [], closeReasons: (string | undefined)[] = [];
  const transport: CollaborationTransport = {
    mode: 'hyperdht-relay', getStatus: () => status,
    subscribeStatus(callback) { statuses.add(callback); return () => statuses.delete(callback); },
    subscribeMessage(callback) { messages.add(callback); return () => messages.delete(callback); },
    async send(channel) {
      if (channel === 'sync') queueMicrotask(() => { for (const callback of messages) void callback({ channel: 'update', data: host.encodeUpdate(), peer }); });
    },
    async close(reason) { closeReasons.push(reason); status = { ...status, state: 'closed', peers: [] }; for (const callback of statuses) callback(status); },
  };
  const room = new RoomConnection(store, transport, { documentId: document.id, timeoutMs: 1000, onError: error => errors.push(error), onChange: value => changes.push(value) });
  cleanups.push(() => room.close());
  function update(patch: Partial<CollaborationTransportStatus>, emit = true) { status = { ...status, ...patch }; if (emit) for (const callback of statuses) callback(status); }
  return { store, room, transport, update, statuses, messages, errors, changes, closeReasons };
}

test('same-id adoption still becomes a guest before authority notification', async () => {
  const { store, room } = setup(true);
  const eligible: boolean[] = []; store.subscribeAuthority(authority => eligible.push(!!authority && !store.getRoomGuest()));
  expect(await room.join()).toBe(true);
  expect(eligible).toEqual([false]);
  expect(store.getRoomGuest()).toEqual({ role: 'editor', connected: true });
});

test('a freshly granted viewer role replaces the editor role atomically on reconnect', async () => {
  const { store, room, update } = setup(); await room.join();
  update({ state: 'reconnecting', peers: [] }); expect(store.state.canWrite).toBe(false);
  update({ state: 'ready', grantedRole: 'viewer', peers: [{ peerId: 'host', keyHash: 'b'.repeat(64), publicKeyBase64Url: '', invitationId: 'i', role: 'owner', grantId: 'g', grantGeneration: 0 }] });
  expect(store.getRoomGuest()).toEqual({ role: 'viewer', connected: true });
  store.setTitle('Denied'); await store.whenIdle(); expect(store.state.document.title).toBe('From host');
});

test('live transport state blocks writes even before a queued status callback is delivered', async () => {
  const { store, room, update } = setup(); await room.join();
  update({ state: 'reconnecting', peers: [] }, false);
  store.setTitle('Denied'); await store.whenIdle();
  expect(store.state.document.title).toBe('From host'); expect(store.state.canWrite).toBe(false);
});

test('disconnect during the unsaved decision never installs a writable guest', async () => {
  const { store, room, update } = setup(); store.updateTitleDraft('Local draft');
  const join = room.join(); await tick(); expect(store.state.dialog?.kind).toBe('unsaved');
  update({ state: 'reconnecting', peers: [] }); await store.resolveDialog('discard');
  expect(await join).toBe(true); expect(store.state.canWrite).toBe(false);
  expect(store.getRoomGuest()).toEqual({ role: 'editor', connected: false });
});

test('terminal failure cancels pending adoption without consuming local drafts', async () => {
  const { store, room, update } = setup(); const authority = store.getAuthority(); store.updateTitleDraft('Local draft');
  const join = room.join().catch(error => error.message); await tick();
  update({ state: 'error', error: 'CONNECTION_LOST', peers: [] });
  expect(await join).toBe('CONNECTION_LOST'); expect(store.getAuthority()).toBe(authority);
  expect(store.getRoomGuest()).toBeNull(); expect(store.state.hasDraft).toBe(true); expect(store.state.dialog).toBeNull();
});

test('transport close retains guest restrictions; only explicit leave restores local access', async () => {
  const { store, room, update, statuses, messages } = setup(); await room.join();
  update({ state: 'error', error: 'CONNECTION_LOST', peers: [] });
  expect(store.getRoomGuest()).not.toBeNull(); expect(store.state.canWrite).toBe(false);
  await room.close(); expect(store.getRoomGuest()).not.toBeNull();
  expect(statuses.size).toBe(0); expect(messages.size).toBe(0);
  await room.close(true); expect(store.getRoomGuest()).toBeNull(); expect(store.state.canWrite).toBe(true);
});

test('failed guest sync terminates visibly and preserves guest restrictions and the local drawing', async () => {
  const { store, room, transport, errors, changes, closeReasons } = setup(); await room.join();
  transport.send = async () => { throw new Error('SEND_FAILED'); };
  store.setTitle('Locally preserved change'); await store.whenIdle(); await tick();
  expect(errors.map(error => error.message)).toEqual(['SYNC_FAILED']);
  expect(changes.at(-1)).toMatchObject({ state: 'error', error: 'SYNC_FAILED', peers: [] });
  expect(closeReasons).toEqual(['SYNC_FAILED']);
  expect(store.state.canWrite).toBe(false);
  expect(store.getRoomGuest()).toEqual({ role: 'editor', connected: false });
  expect(store.state.document.title).toBe('Locally preserved change');
  await room.close(true); expect(store.getRoomGuest()).toBeNull(); expect(store.state.canWrite).toBe(true);
});
