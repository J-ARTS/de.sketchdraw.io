import { createRequire } from 'node:module';
import WebSocket from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { createCrdtController } from '@/crdt';
import { createDocument, createElement } from '@/domain';
import { bindCrdtTransport, bootstrapRoomDocument } from '@/collaboration/crdt';
import { DirectService, type DhtNode, type DirectServiceEvent } from '../../../../electron/direct-service';
import { DirectLink } from '../../../../src/collaboration/hdht/direct-link';
import { createSessionId, type HdhtInvitation } from '../../../../src/collaboration/hdht/invitation';
import { createHostKeys, hostKeyToText } from '../../../../src/collaboration/hdht/relay-channel';
import { createHdhtGuestTransport, createHdhtHostTransport } from '../../../../src/collaboration/hdht/session';
import type { DirectBridge, DirectEvent } from '../../../../src/collaboration/hdht/types';
// @ts-expect-error plain ESM relay without type declarations
import { createRelayServer } from '../../../../relay/server.mjs';

const require = createRequire(import.meta.url);
const timing = { heartbeatMs: 500, timeoutMs: 4000 };
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await Promise.resolve(fn()).catch(() => undefined); });
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const until = async (check: () => boolean, ms = 15_000) => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error('timeout'); await wait(20); } };
const factory = (url: string, protocols: string) => new WebSocket(url, protocols) as never;

/** Loopback of the Electron bridge: the renderer-side DirectLink talks to a real DirectService on a real DHT node. */
function nativeSide(bootstrap: unknown) {
  const DHT = require('hyperdht');
  const listeners = new Set<(event: DirectEvent) => void>();
  const service = new DirectService({
    emit: (event: DirectServiceEvent) => { for (const listener of Array.from(listeners)) listener(event as DirectEvent); },
    createDht: () => new DHT({ bootstrap, host: '127.0.0.1' }) as DhtNode,
    connectTimeoutMs: 15_000,
  });
  const bridge: DirectBridge = {
    hostStart: () => service.hostStart(),
    hostStop: () => service.hostStop(),
    connect: async (key, id) => { service.connect(key, id); },
    send: (id, data) => service.send(id, data),
    close: async id => { service.close(id); },
    discover: async () => [],
    onEvent: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  };
  const link = new DirectLink(bridge);
  cleanups.push(() => { link.dispose(); return service.dispose(); });
  return { link, service, bridge };
}

async function testnet() {
  const createTestnet = require('hyperdht/testnet');
  const net = await createTestnet(3);
  cleanups.push(() => net.destroy());
  return net as { bootstrap: unknown };
}

async function hostWith(options: { direct: boolean; relayUrl?: string; net: { bootstrap: unknown } }) {
  const hostKeys = await createHostKeys();
  const sessionId = createSessionId();
  const expiresAt = Date.now() + 60_000;
  const side = nativeSide(options.net.bootstrap);
  const direct = options.direct ? { link: side.link, publicKey: (await side.service.hostStart()).publicKey } : undefined;
  const host = createHdhtHostTransport({
    sessionId, documentId: 'doc-1', hostKeys, grantedRole: () => 'editor', expiresAt, timing, authTimeoutMs: 8000,
    ...(direct ? { direct } : {}),
    ...(options.relayUrl ? { relay: { url: options.relayUrl, factory, backoffMs: [50, 100] } } : {}),
  });
  cleanups.push(() => host.close());
  const invitation: HdhtInvitation = {
    version: 1, sessionId, hostKey: hostKeyToText(hostKeys), directKey: direct?.publicKey ?? '', relayUrl: options.relayUrl ?? '', documentId: 'doc-1', expiresAt,
  };
  return { host, invitation };
}

function hostDocument() {
  const document = createDocument('Direkt');
  document.id = 'doc-1';
  document.elements = [createElement('rectangle', { x: 5, y: 6, width: 70, height: 80 })];
  return createCrdtController(document);
}

describe('HyperDHT direct route on real local DHT nodes', () => {
  it('connects by pinned key, authenticates the PIN and syncs Yjs both ways without any relay', async () => {
    const net = await testnet();
    const { host, invitation } = await hostWith({ direct: true, net });
    const hostController = hostDocument();
    bindCrdtTransport(hostController, host);
    const guestSide = nativeSide(net.bootstrap);
    const transport = createHdhtGuestTransport({ invitation, pin: host.getPin(), direct: guestSide.link, timing, directTimeoutMs: 10_000 });
    cleanups.push(() => transport.close());
    const fetched = await bootstrapRoomDocument(transport, { documentId: 'doc-1', timeoutMs: 15_000 });
    expect(fetched.getSnapshot().document.elements).toHaveLength(1);
    bindCrdtTransport(fetched, transport);
    await until(() => transport.getStatus().state === 'ready');
    expect(transport.getStatus().route).toBe('direct');
    hostController.dispatch({ type: 'rename', title: 'Direkt vom Host' }, { actorId: 'actor:h', expectedRevision: hostController.getSnapshot().revision, source: 'human' });
    await until(() => fetched.getSnapshot().document.title === 'Direkt vom Host');
    fetched.dispatch({ type: 'rename', title: 'Direkt vom Gast' }, { actorId: 'actor:g', expectedRevision: fetched.getSnapshot().revision, source: 'human' });
    await until(() => hostController.getSnapshot().document.title === 'Direkt vom Gast');
  }, 60_000);

  it('rejects a wrong PIN on the direct route', async () => {
    const net = await testnet();
    const { host, invitation } = await hostWith({ direct: true, net });
    const guestSide = nativeSide(net.bootstrap);
    const wrong = host.getPin() === '111111' ? '222222' : '111111';
    const transport = createHdhtGuestTransport({ invitation, pin: wrong, direct: guestSide.link, timing, directTimeoutMs: 10_000 });
    cleanups.push(() => transport.close());
    await until(() => transport.getStatus().state === 'error');
    expect(transport.getStatus().error).toBe('PIN_INVALID');
    expect(host.getStatus().peers).toHaveLength(0);
  }, 40_000);

  it('falls back to the relay data path when UDP/DHT is unavailable, within seconds', async () => {
    const net = await testnet();
    const relay = createRelayServer();
    const address = await relay.listen(0, '127.0.0.1');
    cleanups.push(() => relay.close());
    const relayUrl = `ws://127.0.0.1:${address.port}/`;
    const { host, invitation } = await hostWith({ direct: true, relayUrl, net });
    const hostController = hostDocument();
    bindCrdtTransport(hostController, host);
    // The guest's DHT bootstrap points at a dead port: nothing can be reached directly.
    const blocked = nativeSide(['127.0.0.1:1']);
    const started = Date.now();
    const transport = createHdhtGuestTransport({
      invitation, pin: host.getPin(), direct: blocked.link, relayFactory: factory, timing, directTimeoutMs: 2000, relayStartDelayMs: 300,
    });
    cleanups.push(() => transport.close());
    const fetched = await bootstrapRoomDocument(transport, { documentId: 'doc-1', timeoutMs: 15_000 });
    bindCrdtTransport(fetched, transport);
    await until(() => transport.getStatus().state === 'ready');
    expect(transport.getStatus().route).toBe('relay');
    expect(Date.now() - started).toBeLessThan(6000);
    hostController.dispatch({ type: 'rename', title: 'Über das Relay' }, { actorId: 'actor:h', expectedRevision: hostController.getSnapshot().revision, source: 'human' });
    await until(() => fetched.getSnapshot().document.title === 'Über das Relay');
  }, 60_000);

  it('does not hang when neither route is reachable and ends with a bounded error', async () => {
    const blocked = nativeSide(['127.0.0.1:1']);
    const invitation: HdhtInvitation = {
      version: 1, sessionId: createSessionId(), hostKey: hostKeyToText(await createHostKeys()), directKey: 'ab'.repeat(32), relayUrl: 'ws://127.0.0.1:1/', documentId: 'doc-1', expiresAt: Date.now() + 60_000,
    };
    const transport = createHdhtGuestTransport({
      invitation, pin: '123456', direct: blocked.link, relayFactory: factory, timing, directTimeoutMs: 800, relayStartDelayMs: 100, attemptTimeoutMs: 1500, backoffMs: [20, 40], maxInitialAttempts: 2,
    });
    cleanups.push(() => transport.close());
    const started = Date.now();
    await until(() => transport.getStatus().state === 'error', 12_000);
    expect(['HOST_UNREACHABLE', 'CONNECT_FAILED']).toContain(transport.getStatus().error);
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 30_000);
});
