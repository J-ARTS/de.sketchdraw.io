import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCrdtController } from '@/crdt';
import { createDocument } from '@/domain';
import { bindCrdtTransport, bootstrapRoomDocument } from '@/collaboration/crdt';
import {
  cloudRelayBase, cloudRelayRoomUrl, DEFAULT_CLOUD_RELAY_URL, relayHostName, storeCloudRelayAddress, storedCloudRelayAddress, storedSessionRoute, storeSessionRoute,
} from '../../../../src/collaboration/hdht/cloud-relay';
import { relayTopic } from '../../../../src/collaboration/hdht/codec';
import { buildHdhtLink, createSessionId, parseHdhtInvitation, type HdhtInvitation } from '../../../../src/collaboration/hdht/invitation';
import { createHostKeys, hostKeyToText } from '../../../../src/collaboration/hdht/relay-channel';
import { createHdhtGuestTransport, createHdhtHostTransport } from '../../../../src/collaboration/hdht/session';
import type { CollaborationTransport } from '../../../../src/collaboration/transport';
import type { WebSocketFactory, WebSocketLike } from '../../../../src/collaboration/hdht/types';
import { createRelayHub } from '../../../../relay/hub.mjs';
// @ts-expect-error plain ESM relay without type declarations
import { attachRelaySocket, ROOM_LIMITS, ROOM_PATH, SUBPROTOCOL } from '../../../../relay/cloudflare/src/room.mjs';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { vi.useRealTimers(); for (const fn of cleanups.splice(0).reverse()) await Promise.resolve(fn()).catch(() => undefined); });
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const until = async (check: () => boolean, ms = 8000) => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error('timeout'); await wait(10); } };
const ready = (transport: CollaborationTransport) => until(() => transport.getStatus().state === 'ready');
const timing = { heartbeatMs: 500, timeoutMs: 4000 };

function memoryStore(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
}

/**
 * What a Cloudflare room is made of, without the Workers runtime: one hub per topic and the adapter of room.mjs on the
 * server side of each socket. The client side is the socket the app's relay client speaks.
 */
function cloudRelay() {
  const rooms = new Map<string, ReturnType<typeof createRelayHub>>();
  const opened: Array<{ url: string; texts: string[]; closed: { code: number; reason: string } | null }> = [];
  const factory: WebSocketFactory = (url, protocols) => {
    const topic = ROOM_PATH.exec(new URL(url).pathname)?.[1];
    const record = { url, texts: [] as string[], closed: null as { code: number; reason: string } | null };
    opened.push(record);
    const serverListeners: Record<string, Array<(event: { data?: unknown }) => void>> = { message: [], close: [], error: [] };
    let state = 0;
    const client: WebSocketLike = {
      binaryType: 'arraybuffer', bufferedAmount: 0, onopen: null, onmessage: null, onclose: null, onerror: null,
      get readyState() { return state; },
      send(data) {
        if (state !== 1) throw new Error('closed');
        if (typeof data === 'string') record.texts.push(data);
        const copy = typeof data === 'string' ? data : Uint8Array.from(data).buffer;
        queueMicrotask(() => { if (state === 1) for (const listener of serverListeners['message']!) listener({ data: copy }); });
      },
      close(code = 1000, reason = '') {
        if (state === 3) return;
        state = 3;
        queueMicrotask(() => { for (const listener of serverListeners['close']!) listener({}); });
        client.onclose?.({ code, reason });
      },
    };
    const server = {
      get readyState() { return state; },
      send(data: string | Uint8Array) {
        const copy = typeof data === 'string' ? data : Uint8Array.from(data).buffer;
        queueMicrotask(() => { if (state === 1) client.onmessage?.({ data: copy }); });
      },
      close(code: number, reason: string) {
        if (state === 3) return;
        state = 3; record.closed = { code, reason };
        queueMicrotask(() => { for (const listener of serverListeners['close']!) listener({}); client.onclose?.({ code, reason }); });
      },
      addEventListener(type: string, listener: (event: { data?: unknown }) => void) { serverListeners[type]!.push(listener); },
    };
    queueMicrotask(() => {
      if (!topic || protocols !== SUBPROTOCOL) { state = 3; client.onerror?.({}); client.onclose?.({ code: 1006, reason: '' }); return; }
      let hub = rooms.get(topic);
      if (!hub) { hub = createRelayHub({ limits: ROOM_LIMITS, acceptTopic: (value: string) => value === topic }); rooms.set(topic, hub); }
      state = 1;
      if (!attachRelaySocket(hub, server)) { server.close(4503, 'full'); return; }
      client.onopen?.({});
    });
    return client;
  };
  cleanups.push(() => { for (const hub of rooms.values()) hub.dispose(); });
  return { factory, rooms, opened };
}

describe('the relay route of a session (#300)', () => {
  it('reads the relay address the way people type it and refuses what is not a relay', () => {
    expect(cloudRelayBase('sketchdraw-relay.jeremy.workers.dev')).toBe('wss://sketchdraw-relay.jeremy.workers.dev/');
    expect(cloudRelayBase('  https://relay.example.org  ')).toBe('wss://relay.example.org/');
    expect(cloudRelayBase('wss://relay.example.org/team')).toBe('wss://relay.example.org/team/');
    expect(cloudRelayBase('ws://127.0.0.1:8787')).toBe('ws://127.0.0.1:8787/');
    expect(cloudRelayBase('http://localhost:8787/')).toBe('ws://localhost:8787/');
    // An address copied out of a session link is cut back to the relay itself.
    expect(cloudRelayBase(`wss://relay.example.org/v1/${'ab'.repeat(32)}`)).toBe('wss://relay.example.org/');
    expect(cloudRelayBase('wss://relay.example.org/team/v1/')).toBe('wss://relay.example.org/team/');
    expect(() => cloudRelayBase('   ')).toThrow('RELAY_URL_MISSING');
    expect(() => cloudRelayBase('http://relay.example.org')).toThrow('RELAY_URL_INSECURE');
    expect(() => cloudRelayBase('ws://relay.example.org')).toThrow('RELAY_URL_INSECURE');
    for (const bad of ['wss://user:secret@relay.example.org', 'relay.example.org/?token=1', 'relay.example.org/#x', 'ftp://relay.example.org', 'relay example.org']) {
      expect(() => cloudRelayBase(bad), bad).toThrow(/RELAY_URL_(INVALID|INSECURE)/);
    }
    expect(relayHostName('wss://relay.example.org:8443/v1/abc')).toBe('relay.example.org:8443');
    expect(relayHostName('')).toBe('');
    expect(relayHostName('nonsense')).toBe('');
  });

  it('names the room of a session after its key, and the link carries that address without any secret', async () => {
    const keys = await createHostKeys();
    const room = await cloudRelayRoomUrl('relay.example.org', keys.publicKey);
    const topic = await relayTopic(keys.publicKey);
    expect(room).toBe(`wss://relay.example.org/v1/${topic}`);
    expect(ROOM_PATH.exec(new URL(room).pathname)?.[1]).toBe(topic);
    expect(await cloudRelayRoomUrl('wss://relay.example.org/team/', keys.publicKey)).toBe(`wss://relay.example.org/team/v1/${topic}`);
    const invitation: HdhtInvitation = { version: 1, sessionId: createSessionId(), hostKey: hostKeyToText(keys), directKey: '', relayUrl: room, documentId: 'doc-1', expiresAt: Date.now() + 60_000 };
    const link = buildHdhtLink(invitation);
    expect(parseHdhtInvitation(link)).toEqual(invitation);
    expect(link.length).toBeLessThan(700);
  });

  it('remembers the route and the address on the device; direct is the default', () => {
    const store = memoryStore();
    expect(storedSessionRoute(store)).toBe('p2p');
    expect(storedCloudRelayAddress(store)).toBe(DEFAULT_CLOUD_RELAY_URL);
    storeSessionRoute('cloud', store); storeCloudRelayAddress('  relay.example.org ', store);
    expect(storedSessionRoute(store)).toBe('cloud');
    expect(storedCloudRelayAddress(store)).toBe('relay.example.org');
    storeSessionRoute('p2p', store); storeCloudRelayAddress('', store);
    expect(store.values.size).toBe(0);
    store.values.set('sketchdraw.session-route.v1', 'something-else');
    expect(storedSessionRoute(store)).toBe('p2p');
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
    expect(storedSessionRoute(broken)).toBe('p2p');
    expect(storedCloudRelayAddress(broken)).toBe(DEFAULT_CLOUD_RELAY_URL);
    expect(() => { storeSessionRoute('cloud', broken); storeCloudRelayAddress('x', broken); }).not.toThrow();
    expect(storedSessionRoute(null)).toBe('p2p');
  });
});

describe('a session through a Cloudflare room (hub and room adapter, without the Workers runtime)', () => {
  async function session(relay = cloudRelay()) {
    const hostKeys = await createHostKeys();
    const url = await cloudRelayRoomUrl('wss://relay.example.org', hostKeys.publicKey);
    const sessionId = createSessionId(), expiresAt = Date.now() + 60_000;
    const host = createHdhtHostTransport({
      sessionId, documentId: 'doc-1', hostKeys, grantedRole: () => 'editor', expiresAt, timing, authTimeoutMs: 3000,
      relay: { url, factory: relay.factory, backoffMs: [20, 40] },
    });
    cleanups.push(() => host.close());
    await ready(host);
    const invitation: HdhtInvitation = { version: 1, sessionId, hostKey: hostKeyToText(hostKeys), directKey: '', relayUrl: url, documentId: 'doc-1', expiresAt };
    const guest = (pin = host.getPin()) => {
      const transport = createHdhtGuestTransport({ invitation, pin, timing, relayFactory: relay.factory, backoffMs: [20, 40], authTimeoutMs: 3000 });
      cleanups.push(() => transport.close());
      return transport;
    };
    return { relay, host, hostKeys, url, invitation, guest };
  }

  it('lets four guests draw together with the host: every edit reaches everyone', async () => {
    const { host, guest, relay } = await session();
    const document = createDocument('Together'); document.id = 'doc-1';
    const controller = createCrdtController(document); cleanups.push(() => controller.destroy());
    const binding = bindCrdtTransport(controller, host); cleanups.push(() => binding.close());
    const guests = await Promise.all([0, 1, 2, 3].map(async () => {
      const transport = guest();
      const remote = await bootstrapRoomDocument(transport, { documentId: 'doc-1', timeoutMs: 8000 });
      cleanups.push(() => remote.destroy());
      const remoteBinding = bindCrdtTransport(remote, transport); cleanups.push(() => remoteBinding.close());
      return { transport, remote };
    }));
    await until(() => host.getStatus().peers.length === 4);
    for (const entry of guests) expect(entry.transport.getStatus()).toMatchObject({ state: 'ready', route: 'relay', grantedRole: 'editor' });
    expect(relay.rooms.size).toBe(1);
    expect([...relay.rooms.values()][0]!.stats()).toMatchObject({ topics: 1, guests: 4, connections: 5 });

    controller.dispatch({ type: 'rename', title: 'From the host' }, { actorId: 'host', source: 'human', expectedRevision: controller.getSnapshot().revision });
    await until(() => guests.every(entry => entry.remote.getSnapshot().document.title === 'From the host'));
    const third = guests[2]!.remote;
    third.dispatch({ type: 'rename', title: 'From a guest' }, { actorId: 'guest-3', source: 'human', expectedRevision: third.getSnapshot().revision });
    await until(() => controller.getSnapshot().document.title === 'From a guest' && guests.every(entry => entry.remote.getSnapshot().document.title === 'From a guest'));

    // One guest leaves; the others stay connected and keep receiving.
    await guests[0]!.transport.close();
    await until(() => host.getStatus().peers.length === 3);
    controller.dispatch({ type: 'rename', title: 'Three left' }, { actorId: 'host', source: 'human', expectedRevision: controller.getSnapshot().revision });
    await until(() => guests.slice(1).every(entry => entry.remote.getSnapshot().document.title === 'Three left'));
  });

  it('keeps sessions apart: each one has its own room, and a wrong PIN stays outside', async () => {
    const relay = cloudRelay();
    const first = await session(relay), second = await session(relay);
    expect(relay.rooms.size).toBe(2);
    const a = first.guest(), b = second.guest();
    await Promise.all([ready(a), ready(b)]);
    const got: string[] = [];
    a.subscribeMessage(message => { got.push(`a:${message.channel}`); });
    b.subscribeMessage(message => { got.push(`b:${message.channel}`); });
    await first.host.send('update', Uint8Array.of(1, 2, 3));
    await until(() => got.includes('a:update'));
    await wait(50);
    expect(got).toEqual(['a:update']);
    const wrong = first.guest(first.host.getPin() === '000000' ? '111111' : '000000');
    await until(() => wrong.getStatus().state === 'error');
    expect(wrong.getStatus().error).toBe('PIN_INVALID');
    expect(first.host.getStatus().peers).toHaveLength(1);
  });

  it('refuses a host that asks a room for another session, so nobody can occupy a room that is not theirs', async () => {
    const relay = cloudRelay();
    const owner = await createHostKeys(), stranger = await createHostKeys();
    const room = await cloudRelayRoomUrl('wss://relay.example.org', owner.publicKey);
    const intruder = createHdhtHostTransport({
      sessionId: createSessionId(), documentId: 'doc-1', hostKeys: stranger, grantedRole: () => 'viewer', expiresAt: Date.now() + 60_000, timing,
      relay: { url: room, factory: relay.factory, backoffMs: [20, 40] },
    });
    cleanups.push(() => intruder.close());
    await until(() => relay.opened.some(socket => socket.closed?.reason === 'bad-topic'));
    expect(relay.opened.find(socket => socket.closed)?.closed).toEqual({ code: 1008, reason: 'bad-topic' });
    expect(intruder.getStatus().state).not.toBe('ready');
    // The room is still free for the session it belongs to.
    const host = createHdhtHostTransport({
      sessionId: createSessionId(), documentId: 'doc-1', hostKeys: owner, grantedRole: () => 'viewer', expiresAt: Date.now() + 60_000, timing,
      relay: { url: room, factory: relay.factory, backoffMs: [20, 40] },
    });
    cleanups.push(() => host.close());
    await ready(host);
  });

  it('asks the runtime for whole binary records and ends a connection that gets something else instead of losing data', () => {
    const closed: Array<{ code: number; reason: string }> = [];
    const listeners: Record<string, Array<(event: { data?: unknown }) => void>> = { message: [], close: [], error: [] };
    const socket = {
      binaryType: 'blob', readyState: 1,
      send: () => undefined,
      close: (code: number, reason: string) => { closed.push({ code, reason }); },
      addEventListener: (type: string, listener: (event: { data?: unknown }) => void) => { listeners[type]!.push(listener); },
    };
    const hub = createRelayHub({ limits: ROOM_LIMITS }); cleanups.push(() => hub.dispose());
    expect(attachRelaySocket(hub, socket)).toBe(true);
    // Newer Workers runtimes default to Blob; the room switches the socket to ArrayBuffer.
    expect(socket.binaryType).toBe('arraybuffer');
    expect(hub.stats().connections).toBe(1);
    for (const listener of listeners['message']!) listener({ data: new Blob([Uint8Array.of(1, 2, 3)]) });
    expect(closed).toEqual([{ code: 1003, reason: 'binary-type' }]);
    expect(hub.stats().connections).toBe(0);
  });

  it('tells a guest that the session is not there when the host is gone', async () => {
    const { host, guest } = await session();
    await host.close();
    const late = guest();
    await until(() => late.getStatus().state === 'error', 12_000);
    expect(late.getStatus().error).toBe('CONNECT_FAILED');
  }, 15_000);

  it('keeps a waiting host registered: it pings the relay, which cannot ping from its side', async () => {
    const relay = cloudRelay();
    const hostKeys = await createHostKeys();
    const url = await cloudRelayRoomUrl('wss://relay.example.org', hostKeys.publicKey);
    const host = createHdhtHostTransport({
      sessionId: createSessionId(), documentId: 'doc-1', hostKeys, grantedRole: () => 'viewer', expiresAt: Date.now() + 60_000, timing,
      relay: { url, factory: relay.factory, backoffMs: [20, 40], keepAliveMs: 40 },
    });
    cleanups.push(() => host.close());
    await ready(host);
    const socket = relay.opened[0]!;
    await until(() => socket.texts.filter(text => text === '{"t":"ping"}').length >= 3);
    expect(host.getStatus().state).toBe('ready');
    expect(socket.closed).toBeNull();
    await host.close();
    const sent = socket.texts.length;
    await wait(150);
    expect(socket.texts.length).toBe(sent);
  });
});
