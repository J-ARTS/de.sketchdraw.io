import { expect, test, vi } from 'vitest';
import { bootstrapRoomDocument } from '@/collaboration/crdt';
import { createCrdtController } from '@/crdt';
import { createDocument } from '@/domain';

function fixture(mode = 'hyperdht-relay') {
 const host = createCrdtController(createDocument('Bootstrap'));
 const peer = (hash = 'first') => ({ peerId: 'host', keyHash: hash, publicKeyBase64Url: 'k', invitationId: 'i', role: 'owner', grantId: 'g', grantGeneration: 0 });
 let peers: any[] = [peer()]; const status = () => ({ mode, state: peers.length ? 'ready' : 'reconnecting', peers, relayUrls: [], iceServers: [] });
 const statuses = new Set<any>(); const messages = new Set<any>(); let sendCount = 0;
 const transport: any = { mode, getStatus: status, subscribeStatus: (cb: any) => { statuses.add(cb); return () => statuses.delete(cb); }, subscribeMessage: (cb: any) => { messages.add(cb); return () => messages.delete(cb); }, send: vi.fn(async () => { sendCount++; if (sendCount >= 2) queueMicrotask(() => { for (const cb of messages) cb({ channel: 'update', data: host.encodeUpdate(), peer: peers[0] }); }); }), close: async () => {} };
 const update = (hash: string | null) => { peers = hash === null ? [] : [peer(hash)]; for (const cb of statuses) cb(status()); };
 return { host, transport, update, statuses, messages };
}

test('new connection hash with same host peer id retries a lost first sync', async () => {
 const f = fixture();
 const pending = bootstrapRoomDocument(f.transport, { documentId: f.host.getSnapshot().document.id, timeoutMs: 1000 });
 f.update(null); f.update('second');
 const room = await pending;
 expect(f.transport.send).toHaveBeenCalledTimes(2);
 expect(room.getSnapshot().document.title).toBe('Bootstrap');
 room.destroy(); f.host.destroy();
});

test('legacy reconnect with same identity retries a lost first sync', async () => {
 const f = fixture('automatic-p2p');
 const pending = bootstrapRoomDocument(f.transport, { documentId: f.host.getSnapshot().document.id, timeoutMs: 100 });
 f.update(null); f.update('first');
 try { const room = await pending; room.destroy(); expect(f.transport.send).toHaveBeenCalledTimes(2); } finally { f.host.destroy(); }
});

test('request budget remains bounded over many fresh authenticated connections', async () => {
 const f = fixture(); f.transport.send.mockImplementation(async () => {});
 const controller = new AbortController();
 const pending = bootstrapRoomDocument(f.transport, { documentId: 'x', signal: controller.signal, timeoutMs: 1000 }).catch(e => e.message);
 for (let i = 0; i < 40; i++) { f.update(null); f.update(`next-${i}`); }
 expect(f.transport.send).toHaveBeenCalledTimes(16);
 controller.abort(); expect(await pending).toBe('ABORTED');
 expect(f.statuses.size).toBe(0); expect(f.messages.size).toBe(0); f.host.destroy();
});

test('an already queued status delivery cannot send after bootstrap abort', async () => {
 const f = fixture(); f.transport.send.mockImplementation(async () => {});
 const controller = new AbortController();
 const pending = bootstrapRoomDocument(f.transport, { documentId: 'x', signal: controller.signal, timeoutMs: 1000 }).catch(e => e.message);
 const queued = [...f.statuses][0];
 controller.abort(); expect(await pending).toBe('ABORTED');
 f.update('second'); queued(f.transport.getStatus());
 expect(f.transport.send).toHaveBeenCalledTimes(1); f.host.destroy();
});

test('preaborted bootstrap subscribes to nothing and sends nothing', async () => {
 const f = fixture(); const controller = new AbortController(); controller.abort();
 await expect(bootstrapRoomDocument(f.transport, { documentId: 'x', signal: controller.signal })).rejects.toThrow('ABORTED');
 expect(f.transport.send).not.toHaveBeenCalled(); expect(f.statuses.size).toBe(0); expect(f.messages.size).toBe(0); f.host.destroy();
});
