import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { createCrdtController } from '@/crdt';
import { createDocument, createElement } from '@/domain';
import { bindCrdtTransport, bootstrapRoomDocument } from '@/collaboration/crdt';
import { DirectService, type DhtFactory, type DhtNode } from '../../../../electron/direct-service';
import { PeerRelayHelper } from '../../../../electron/peer-relay-service';
import { serviceAdTopic, sessionAdTopic } from '../../../../relay/hub.mjs';
import { DirectLink } from '@/collaboration/hdht/direct-link';
import { createSessionId, type HdhtInvitation } from '@/collaboration/hdht/invitation';
import { createHostKeys, hostKeyToText } from '@/collaboration/hdht/relay-channel';
import { createHdhtGuestTransport, createHdhtHostTransport } from '@/collaboration/hdht/session';
import type { DirectBridge, DirectEvent } from '@/collaboration/hdht/types';

const require = createRequire(import.meta.url);
const cleanups: (() => void | Promise<void>)[] = [];
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean, timeout = 15_000) {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() >= end) throw new Error('condition timed out');
    await delay(15);
  }
}
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
}, 30_000);

async function fixture(helperCount: number, role: 'editor' | 'viewer' = 'editor') {
  const net = await require('hyperdht/testnet')(3);
  cleanups.push(() => net.destroy());
  const DHT = require('hyperdht');
  const captures: Buffer[] = [];
  const createNode: DhtFactory = () => new DHT({ bootstrap: net.bootstrap, host: '127.0.0.1' }) as DhtNode;
  const createObservedHelperNode: DhtFactory = () => {
    const node = createNode();
    const createServer = node.createServer.bind(node);
    node.createServer = (options, connected) => createServer(options, stream => {
      // Observe what the intermediary can read AFTER its outer Noise connection decrypts the stream.
      // Inner host/guest encryption must still hide the document and PIN here.
      stream.on('data', (data: Uint8Array) => captures.push(Buffer.from(data)));
      connected?.(stream);
    });
    return node;
  };
  const helpers: PeerRelayHelper[] = [];
  for (let index = 0; index < helperCount; index++) {
    const helper = new PeerRelayHelper({ createDht: createObservedHelperNode });
    helpers.push(helper);
    cleanups.push(() => helper.stop());
    expect(await helper.start()).toMatchObject({ running: true, announced: true });
  }
  function side(deniedKey?: string) {
    const listeners = new Set<(event: DirectEvent) => void>();
    let denied = 0;
    const service = new DirectService({ createDht: createNode, emit: event => {
      for (const listener of Array.from(listeners)) listener(event);
    } });
    const bridge: DirectBridge = {
      hostStart: () => service.hostStart(), hostStop: () => service.hostStop(),
      connect: async (key, id) => {
        // Only host→guest direct reachability is denied. Connections to every helper use real HyperDHT.
        if (key === deniedKey) { denied++; throw new Error('TEST_DIRECT_PATH_UNAVAILABLE'); }
        service.connect(key, id);
      },
      send: (id, data) => service.send(id, data), close: async id => service.close(id),
      discover: request => service.lookup(request.kind === 'service' ? serviceAdTopic() : sessionAdTopic(request.topic), 8, 1500),
      onEvent: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    };
    const link = new DirectLink(bridge);
    cleanups.push(async () => { link.dispose(); await service.dispose(); });
    return { link, service, get denied() { return denied; } };
  }
  const owner = side();
  const publicKey = (await owner.service.hostStart()).publicKey;
  const hostKeys = await createHostKeys();
  const sessionId = createSessionId();
  const expiresAt = Date.now() + 120_000;
  const timing = { heartbeatMs: 250, timeoutMs: 2500 };
  const host = createHdhtHostTransport({
    sessionId, documentId: 'native-relay-doc', hostKeys, expiresAt, grantedRole: () => role, timing,
    direct: { link: owner.link, publicKey }, peers: { link: owner.link, target: helperCount || 1, retryMs: 100, steadyMs: 200 },
  });
  cleanups.push(() => host.close());
  const document = createDocument('SECRET-NATIVE-RELAY-DOCUMENT');
  document.id = 'native-relay-doc';
  document.elements = [createElement('rectangle', { x: 5, y: 6, width: 70, height: 80 })];
  const hostController = createCrdtController(document);
  const binding = bindCrdtTransport(hostController, host);
  cleanups.push(() => binding.close());
  const invitation: HdhtInvitation = {
    version: 1, sessionId, hostKey: hostKeyToText(hostKeys), directKey: publicKey, relayUrl: '', documentId: document.id, expiresAt,
  };
  if (helperCount) await until(() => host.getStatus().helpers === helperCount);
  function guest(pin = host.getPin()) {
    const client = side(publicKey);
    const winners: string[] = [];
    const transport = createHdhtGuestTransport({
      invitation, pin, direct: client.link, timing, backoffMs: [25, 50], maxInitialAttempts: 2,
      attemptTimeoutMs: 5000, onCandidate: (key, outcome) => { if (outcome === 'won') winners.push(key); },
    });
    cleanups.push(() => transport.close());
    return { transport, client, winners };
  }
  return { helpers, captures, host, hostController, guest };
}

describe('decentralized native peer relay on real isolated HyperDHT nodes', () => {
  it('discovers a third peer without an endpoint, checks PIN, syncs Yjs both ways and keeps the helper blind', async () => {
    const { helpers, host, hostController, guest, captures } = await fixture(1);
    const wrong = guest(host.getPin() === '000000' ? '000001' : '000000');
    await until(() => wrong.transport.getStatus().state === 'error');
    expect(wrong.transport.getStatus().error).toBe('PIN_INVALID');
    expect(host.getStatus().peers).toHaveLength(0);
    await wrong.transport.close();

    const joined = guest();
    const remote = await bootstrapRoomDocument(joined.transport, { documentId: 'native-relay-doc', timeoutMs: 15_000 });
    const binding = bindCrdtTransport(remote, joined.transport);
    cleanups.push(() => binding.close());
    expect(joined.client.denied).toBeGreaterThan(0);
    expect(joined.transport.getStatus()).toMatchObject({ state: 'ready', route: 'relay', grantedRole: 'editor' });
    expect(remote.getSnapshot().document.elements).toHaveLength(1);
    hostController.dispatch({ type: 'rename', title: 'SECRET-HOST-UPDATE' }, { actorId: 'actor:h', expectedRevision: hostController.getSnapshot().revision, source: 'human' });
    await until(() => remote.getSnapshot().document.title === 'SECRET-HOST-UPDATE');
    remote.dispatch({ type: 'rename', title: 'SECRET-GUEST-UPDATE' }, { actorId: 'actor:g', expectedRevision: remote.getSnapshot().revision, source: 'human' });
    await until(() => hostController.getSnapshot().document.title === 'SECRET-GUEST-UPDATE');

    const asset = new Uint8Array(8 * 1024 * 1024).fill(173);
    let received: Uint8Array | undefined;
    const off = joined.transport.subscribeMessage(message => { if (message.channel === 'asset') received = message.data; });
    cleanups.push(off);
    await host.send('asset', asset);
    await until(() => received !== undefined);
    expect(Buffer.from(received!).equals(Buffer.from(asset))).toBe(true);
    expect(helpers[0]!.status().forwardedRecords).toBeGreaterThan(100);
    const observed = Buffer.concat(captures).toString('latin1');
    for (const secret of ['SECRET-NATIVE-RELAY-DOCUMENT', 'SECRET-HOST-UPDATE', 'SECRET-GUEST-UPDATE', host.getPin()]) expect(observed).not.toContain(secret);
  }, 45_000);

});
