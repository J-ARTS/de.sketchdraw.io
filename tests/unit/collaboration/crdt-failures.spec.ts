import { afterEach, expect, test, vi } from 'vitest';
import { assertCollaborationDocumentSize, bindCrdtTransport, bootstrapRoomDocument, EMPTY_STATE_VECTOR } from '@/collaboration/crdt';
import type { CollaborationTransport, CollaborationTransportMessage, CollaborationTransportStatus } from '@/collaboration/transport';
import { createCrdtController, createCrdtControllerFromUpdate, CRDT_UPDATE_LIMIT_BYTES } from '@/crdt';
import { createDocument, createElement, validateDocument } from '@/domain';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture() {
  const peer = { peerId: 'host', keyHash: 'a'.repeat(64), publicKeyBase64Url: '', invitationId: 'i', role: 'owner' as const, grantId: 'g', grantGeneration: 0 };
  let status: CollaborationTransportStatus = { mode: 'hyperdht-relay', state: 'ready', peers: [peer], relayUrls: [], iceServers: [] };
  const messages = new Set<(value: CollaborationTransportMessage) => void | Promise<void>>();
  const statuses = new Set<(value: CollaborationTransportStatus) => void>();
  const transport: CollaborationTransport = {
    mode: 'hyperdht-relay', getStatus: () => status,
    subscribeMessage(callback) { messages.add(callback); return () => messages.delete(callback); },
    subscribeStatus(callback) { statuses.add(callback); return () => statuses.delete(callback); },
    send: vi.fn(async () => {}), close: async () => {},
  };
  return { transport, peer, messages, statuses, update(value: Partial<CollaborationTransportStatus>) {
    status = { ...status, ...value }; for (const callback of statuses) callback(status);
  } };
}
function largeDocument() {
  const document = createDocument('Valid large diagram');
  document.elements = Array.from({ length: 100 }, (_, i) => createElement('text', { id: `text:${i}`, text: 'Architecture diagrams and notes. '.repeat(1500).slice(0, 45_000), x: i * 200, y: 0, width: 180, height: 80 }));
  validateDocument(document);
  const controller = createCrdtController(document); cleanups.push(() => controller.destroy());
  return controller;
}

test('a valid diagram above 4 MiB passes collaboration preflight without increasing the ordinary CRDT limit', () => {
  const controller = largeDocument();
  expect(controller.encodeUpdate().byteLength).toBeGreaterThan(CRDT_UPDATE_LIMIT_BYTES);
  expect(() => assertCollaborationDocumentSize(controller)).not.toThrow();
  expect(CRDT_UPDATE_LIMIT_BYTES).toBe(4 * 1024 * 1024);
  const small = createCrdtController(createDocument('Small')); cleanups.push(() => small.destroy());
  expect(() => assertCollaborationDocumentSize(small)).not.toThrow();
});

test('full state above 4 MiB bootstraps through asset chunks and subsequent edits remain bidirectional', async () => {
  const controller = largeDocument(), host = fixture(), guest = fixture(), onError = vi.fn();
  host.transport.send = vi.fn(async (channel, data) => { for (const callback of guest.messages) await callback({ channel, data, peer: guest.peer }); });
  guest.transport.send = vi.fn(async (channel, data) => { for (const callback of host.messages) await callback({ channel, data, peer: host.peer }); });
  const binding = bindCrdtTransport(controller, host.transport, undefined, { onError }); cleanups.push(() => binding.close());
  const room = await bootstrapRoomDocument(guest.transport, { documentId: controller.getSnapshot().document.id, timeoutMs: 3000 });
  cleanups.push(() => room.destroy());
  expect(room.getSnapshot().document).toEqual(controller.getSnapshot().document);
  expect(room.encodeStateVector()).toEqual(controller.encodeStateVector());
  expect(vi.mocked(host.transport.send).mock.calls.filter(([channel]) => channel === 'asset').length).toBeGreaterThan(1);
  const guestBinding = bindCrdtTransport(room, guest.transport, undefined, { onError }); cleanups.push(() => guestBinding.close());
  room.dispatch({ type: 'rename', title: 'From guest' }, { actorId: 'guest', source: 'human', expectedRevision: room.getSnapshot().revision });
  await vi.waitFor(() => expect(controller.getSnapshot().document.title).toBe('From guest'));
  controller.dispatch({ type: 'rename', title: 'From host' }, { actorId: 'host', source: 'human', expectedRevision: controller.getSnapshot().revision });
  await vi.waitFor(() => expect(room.getSnapshot().document.title).toBe('From host'));
  expect(onError).not.toHaveBeenCalled();
});

test('rejected outgoing sends are reported once and further binding sends stop', async () => {
  const controller = createCrdtController(createDocument('Small')); cleanups.push(() => controller.destroy());
  const f = fixture(), onError = vi.fn();
  vi.mocked(f.transport.send).mockRejectedValue(new Error('TRANSPORT_BACKPRESSURE'));
  const binding = bindCrdtTransport(controller, f.transport, undefined, { onError }); cleanups.push(() => binding.close());
  await tick();
  expect(onError).toHaveBeenCalledTimes(1);
  expect(onError.mock.calls[0]![0].message).toBe('TRANSPORT_BACKPRESSURE');
  for (const callback of f.messages) await callback({ channel: 'sync', data: EMPTY_STATE_VECTOR, peer: f.peer });
  expect(f.transport.send).toHaveBeenCalledTimes(1);
});

test('an intentional binding close does not report the resulting pending send failure', async () => {
  const controller = createCrdtController(createDocument('Small')); cleanups.push(() => controller.destroy());
  const f = fixture(), onError = vi.fn(); let reject = (_error: Error) => {};
  vi.mocked(f.transport.send).mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  const binding = bindCrdtTransport(controller, f.transport, undefined, { onError });
  await tick();
  const closed = binding.close(); reject(new Error('TRANSPORT_CLOSED')); await closed;
  expect(onError).not.toHaveBeenCalled();
});

test.each(['DOCUMENT_TOO_LARGE_FOR_COLLABORATION', 'SYNC_FAILED'])('bootstrap immediately returns terminal %s and releases its subscriptions', async error => {
  const f = fixture();
  const pending = bootstrapRoomDocument(f.transport, { documentId: 'requested', timeoutMs: 60_000 });
  f.update({ state: 'error', error, peers: [] });
  await expect(pending).rejects.toThrow(error);
  expect(f.messages.size).toBe(0); expect(f.statuses.size).toBe(0);
});

test('an already closed transport does not leave bootstrap waiting or send another request', async () => {
  const f = fixture(); f.update({ state: 'closed', error: 'SYNC_FAILED', peers: [] });
  await expect(bootstrapRoomDocument(f.transport, { documentId: 'requested' })).rejects.toThrow('SYNC_FAILED');
  expect(f.transport.send).not.toHaveBeenCalled(); expect(f.messages.size).toBe(0); expect(f.statuses.size).toBe(0);
});

test('hosts never request sync from viewers, including new viewers, but still publish edits to them', async () => {
  const controller = createCrdtController(createDocument('Host')); cleanups.push(() => controller.destroy());
  const f = fixture(), onError = vi.fn();
  const viewer = { ...f.peer, peerId: 'viewer', role: 'viewer' as const };
  f.update({ peers: [f.peer, viewer] });
  const binding = bindCrdtTransport(controller, f.transport, undefined, { onError }); cleanups.push(() => binding.close());
  await tick();
  expect(f.transport.send).toHaveBeenCalledTimes(1);
  expect(vi.mocked(f.transport.send).mock.calls[0]![2]).toEqual(['host']);
  f.update({ peers: [f.peer, viewer, { ...viewer, peerId: 'another-viewer' }] }); await tick();
  expect(f.transport.send).toHaveBeenCalledTimes(1);
  controller.dispatch({ type: 'rename', title: 'Still shared with viewers' }, { actorId: 'host', source: 'human', expectedRevision: 0 }); await tick();
  expect(vi.mocked(f.transport.send).mock.calls.filter(([channel]) => channel === 'update').map(([, , peers]) => peers)).toEqual([['host'], ['viewer'], ['another-viewer']]);
  expect(onError).not.toHaveBeenCalled();
});

test('a local viewer ignores sync replies and continues receiving host edits after reconnect', async () => {
  const host = createCrdtController(createDocument('Host')); cleanups.push(() => host.destroy());
  const viewer = createCrdtControllerFromUpdate(host.encodeUpdate()); cleanups.push(() => viewer.destroy());
  const f = fixture(), onError = vi.fn(); f.update({ grantedRole: 'viewer' });
  vi.mocked(f.transport.send).mockImplementation(async channel => { if (channel === 'update' || channel === 'asset') throw new Error('ACCESS_DENIED'); });
  const binding = bindCrdtTransport(viewer, f.transport, undefined, { onError }); cleanups.push(() => binding.close());
  for (const callback of f.messages) await callback({ channel: 'sync', data: host.encodeStateVector(), peer: f.peer });
  await tick();
  expect(vi.mocked(f.transport.send).mock.calls.every(([channel]) => channel === 'sync')).toBe(true);
  for (let revision = 0; revision < 2; revision++) {
    const peer = { ...f.peer, keyHash: String(revision).repeat(64) };
    f.update({ peers: [] }); f.update({ peers: [peer] });
    host.dispatch({ type: 'rename', title: `Host edit ${revision}` }, { actorId: 'host', source: 'human', expectedRevision: revision });
    for (const callback of f.messages) await callback({ channel: 'update', data: host.encodeUpdate(viewer.encodeStateVector()), peer });
    expect(viewer.getSnapshot().document.title).toBe(`Host edit ${revision}`);
  }
  await tick(); expect(onError).not.toHaveBeenCalled();
});

test('queued updates cannot reach a replacement connection with the same peer id', async () => {
  const controller = createCrdtController(createDocument('Host')); cleanups.push(() => controller.destroy());
  const f = fixture(), onError = vi.fn(); let release = () => {};
  vi.mocked(f.transport.send).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  const binding = bindCrdtTransport(controller, f.transport, undefined, { onError }); cleanups.push(() => binding.close());
  await tick();
  controller.dispatch({ type: 'rename', title: 'Queued old generation' }, { actorId: 'host', source: 'human', expectedRevision: 0 });
  await tick(); // The controller publishes its update asynchronously; let it enter the blocked send queue.
  f.update({ peers: [{ ...f.peer, keyHash: 'b'.repeat(64) }] });
  release(); await tick();
  expect(vi.mocked(f.transport.send).mock.calls.map(([channel]) => channel)).toEqual(['sync', 'sync']);
  controller.dispatch({ type: 'rename', title: 'New generation' }, { actorId: 'host', source: 'human', expectedRevision: 1 }); await tick();
  expect(vi.mocked(f.transport.send).mock.calls.at(-1)?.[0]).toBe('update');
  expect(onError).not.toHaveBeenCalled();
});

test('a partial send failure does not resend chunks to successful recipients or stop their session', async () => {
  const controller = createCrdtController(createDocument('Host')); cleanups.push(() => controller.destroy());
  const f = fixture(), onError = vi.fn(), survivor = { ...f.peer, peerId: 'survivor', keyHash: 'b'.repeat(64) };
  f.update({ peers: [f.peer, survivor] });
  vi.mocked(f.transport.send).mockImplementation(async (channel, _data, targets) => {
    if (channel === 'update' && targets?.includes('host')) { f.update({ peers: [survivor] }); throw new Error('PEER_NOT_AUTHORIZED'); }
  });
  const binding = bindCrdtTransport(controller, f.transport, undefined, { onError }); cleanups.push(() => binding.close());
  await tick();
  controller.dispatch({ type: 'rename', title: 'Shared with survivor' }, { actorId: 'host', source: 'human', expectedRevision: 0 }); await tick();
  expect(vi.mocked(f.transport.send).mock.calls.filter(([channel]) => channel === 'update').map(([, , peers]) => peers)).toEqual([['host'], ['survivor']]);
  expect(onError).not.toHaveBeenCalled();
});

test('binding close aborts a chunk transfer whose native send never drains', async () => {
  const controller = largeDocument(), f = fixture(), onError = vi.fn();
  vi.mocked(f.transport.send).mockImplementation(async channel => { if (channel === 'asset') await new Promise<void>(() => {}); });
  const binding = bindCrdtTransport(controller, f.transport, undefined, { onError }); cleanups.push(() => binding.close());
  for (const callback of f.messages) await callback({ channel: 'sync', data: EMPTY_STATE_VECTOR, peer: f.peer });
  await vi.waitFor(() => expect(vi.mocked(f.transport.send).mock.calls.some(([channel]) => channel === 'asset')).toBe(true));
  let closed = false; void binding.close().then(() => { closed = true; });
  await vi.waitFor(() => expect(closed).toBe(true));
  expect(onError).not.toHaveBeenCalled();
});
