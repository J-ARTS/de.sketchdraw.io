import { createRequire } from 'node:module';
import { DirectService, type DhtNode, type DirectServiceEvent } from '../../../../electron/direct-service';
import { PeerRelayHelper, type PeerRelayHelperOptions } from '../../../../electron/peer-relay-service';
import { serviceAdTopic, sessionAdTopic } from '../../../../relay/hub.mjs';
import { DirectLink } from '../../../../src/collaboration/hdht/direct-link';
import type { DirectBridge, DirectEvent } from '../../../../src/collaboration/hdht/types';

const require = createRequire(import.meta.url);
export const cleanups: (() => Promise<void> | void)[] = [];
export async function runCleanups(): Promise<void> {
  for (const fn of cleanups.splice(0).reverse()) await Promise.resolve(fn()).catch(() => undefined);
}
export const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export async function until(check: () => boolean, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) { if (Date.now() > end) throw new Error('timeout'); await wait(20); }
}

/** An isolated local HyperDHT network (bootstrap nodes on loopback). Not a proof of real NAT traversal. */
export async function testnet(): Promise<{ bootstrap: unknown; makeNode(): DhtNode }> {
  const createTestnet = require('hyperdht/testnet');
  const DHT = require('hyperdht');
  const net = await createTestnet(3);
  cleanups.push(() => net.destroy());
  return { bootstrap: net.bootstrap, makeNode: () => new DHT({ bootstrap: net.bootstrap, host: '127.0.0.1' }) as DhtNode };
}

export interface NativeSide {
  link: DirectLink;
  service: DirectService;
  /** Bytes the renderer side sent to / received from the native bridge (what a relay peer sees after the outer Noise layer). */
  wire: { sent: Uint8Array[]; received: Uint8Array[] };
  /** Direct connections to these keys are refused (simulates a blocked UDP path to exactly that peer). */
  blocked: Set<string>;
  connects: string[];
}

/** Loopback of the Electron bridge: renderer-side DirectLink on top of a real DirectService on a real DHT node. */
export function nativeSide(net: { makeNode(): DhtNode }, options: { connectTimeoutMs?: number; lookupMs?: number } = {}): NativeSide {
  const listeners = new Set<(event: DirectEvent) => void>();
  const emit = (event: DirectEvent) => { for (const listener of Array.from(listeners)) listener(event); };
  const wire = { sent: [] as Uint8Array[], received: [] as Uint8Array[] };
  const blocked = new Set<string>();
  const connects: string[] = [];
  const service = new DirectService({
    emit: (event: DirectServiceEvent) => { if (event.type === 'message') wire.received.push(event.data); emit(event as DirectEvent); },
    createDht: () => net.makeNode(),
    connectTimeoutMs: options.connectTimeoutMs ?? 15_000,
  });
  const bridge: DirectBridge = {
    hostStart: () => service.hostStart(),
    hostStop: () => service.hostStop(),
    connect: async (key, id) => {
      connects.push(key);
      if (blocked.has(key)) { queueMicrotask(() => emit({ type: 'close', channelId: id, reason: 'BLOCKED' })); return; }
      service.connect(key, id);
    },
    send: (id, data) => { wire.sent.push(data); return service.send(id, data); },
    close: async id => { service.close(id); },
    onEvent: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    // Same mapping as the Electron main process: topics are derived from the request, never taken from the renderer.
    discover: request => service.lookup(request.kind === 'service' ? serviceAdTopic() : sessionAdTopic(request.topic), 8, options.lookupMs ?? 4000),
  };
  const link = new DirectLink(bridge);
  cleanups.push(() => { link.dispose(); return service.dispose(); });
  return { link, service, wire, blocked, connects };
}

export async function startHelper(net: { makeNode(): DhtNode }, options: PeerRelayHelperOptions = {}): Promise<PeerRelayHelper> {
  const helper = new PeerRelayHelper({ createDht: () => net.makeNode(), ...options });
  cleanups.push(() => helper.stop());
  const status = await helper.start();
  if (!status.running) throw new Error(`helper did not start: ${status.error}`);
  return helper;
}
