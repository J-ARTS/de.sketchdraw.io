import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { DIRECT_MAX_MESSAGE_BYTES, DIRECT_MAX_QUERIES, DirectService, type DhtNode, type DirectServiceEvent } from '../../../../electron/direct-service';

const require = createRequire(import.meta.url);
const KEY = 'ab'.repeat(32);
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const { Duplex } = require('streamx') as { Duplex: new (options: { write(data: Uint8Array, callback: (error?: Error | null) => void): void }) => EventEmitter & { destroyed: boolean; destroy(): void } };

/** A real streamx Duplex (the base of HyperDHT's SecretStream): write completion goes through streamx, not Node callbacks. */
class FakeStream extends (Duplex as unknown as new (options: object) => EventEmitter & { destroyed: boolean; destroy(): void; write(data: Uint8Array): boolean }) {
  remotePublicKey = Buffer.from(KEY, 'hex');
  handshakeHash = new Uint8Array(64).fill(7);
  pending: { data: Uint8Array; done: (error?: Error | null) => void }[] = [];
  constructor() { super({ write: (data: Uint8Array, done: (error?: Error | null) => void) => { this.pending.push({ data, done }); } }); }
}

function fakeDht(options: { listen?: () => Promise<void> } = {}) {
  const state = { nodes: 0, nodesDestroyedOrder: [] as string[], destroyed: 0, serverClosed: 0, streams: [] as FakeStream[], onconnection: null as null | ((stream: FakeStream) => void), firewall: null as null | Parameters<DhtNode['createServer']>[0]['firewall'] };
  const factory = (): DhtNode => {
    state.nodes++;
    return {
      createServer(serverOptions, onconnection) {
        state.firewall = serverOptions.firewall;
        state.onconnection = onconnection as never;
        return { listen: options.listen ?? (() => Promise.resolve()), close: async () => { state.serverClosed++; }, on: () => undefined };
      },
      connect() { const stream = new FakeStream(); state.streams.push(stream); return stream as never; },
      destroy: async () => { state.destroyed++; },
    };
  };
  return { factory, state };
}

function service(dht: ReturnType<typeof fakeDht>, extra: Record<string, number> = {}) {
  const events: DirectServiceEvent[] = [];
  return { events, svc: new DirectService({ emit: event => events.push(event), createDht: dht.factory, ...extra }) };
}
const frame = (payload: number[]) => { const out = new Uint8Array(4 + payload.length); new DataView(out.buffer).setUint32(0, payload.length); out.set(payload, 4); return out; };

describe('DirectService framing', () => {
  it('rejects a helper-sized frame from its header alone, and stops parsing after a callback closes the channel', async () => {
    const dht = fakeDht();
    const events: DirectServiceEvent[] = [];
    const svc = new DirectService({ createDht: dht.factory, maxMessageBytes: 64, emit: event => {
      events.push(event);
      if (event.type === 'message') svc.close(event.channelId);
    } });
    svc.connect(KEY, 'd1'.repeat(16));
    dht.state.streams[0]!.emit('open');
    const header = Buffer.alloc(4); header.writeUInt32BE(65);
    dht.state.streams[0]!.emit('data', header);
    expect(svc.channelCount).toBe(0);
    expect(events.at(-1)).toMatchObject({ type: 'close', reason: 'PROTOCOL_ERROR' });
    svc.connect(KEY, 'd2'.repeat(16));
    dht.state.streams[1]!.emit('open');
    expect(() => dht.state.streams[1]!.emit('data', Buffer.concat([frame([1]), frame([2])]))).not.toThrow();
    expect(events.filter(event => event.type === 'message')).toHaveLength(1);
    await svc.dispose();
  });
  it('reassembles split headers and multiple frames, and rejects oversized frames', async () => {
    const dht = fakeDht();
    const { svc, events } = service(dht);
    svc.connect(KEY, '1'.repeat(32));
    const stream = dht.state.streams[0]!;
    stream.emit('open');
    const a = frame([1, 2, 3]);
    const b = frame([9]);
    stream.emit('data', a.subarray(0, 2));
    stream.emit('data', Uint8Array.from([...a.subarray(2), ...b]));
    expect(events.filter(event => event.type === 'message').map(event => (event as { data: Uint8Array }).data)).toEqual([Uint8Array.of(1, 2, 3), Uint8Array.of(9)]);
    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, DIRECT_MAX_MESSAGE_BYTES + 1);
    stream.emit('data', header);
    expect(events.at(-1)).toMatchObject({ type: 'close', reason: 'PROTOCOL_ERROR' });
    await wait(20);
    expect(stream.destroyed).toBe(true);
  });

  it('refuses a host whose key differs from the pinned key', () => {
    const dht = fakeDht();
    const { svc, events } = service(dht);
    svc.connect('cd'.repeat(32), '2'.repeat(32));
    dht.state.streams[0]!.emit('open');
    expect(events.at(-1)).toMatchObject({ type: 'close', reason: 'HOST_KEY_MISMATCH' });
  });

  it('validates ids and keys and refuses reuse of a closed id', () => {
    const dht = fakeDht();
    const { svc } = service(dht);
    expect(() => svc.connect('zz', '1'.repeat(32))).toThrow('DIRECT_INVALID_REQUEST');
    expect(() => svc.connect(KEY, 'short')).toThrow('DIRECT_INVALID_REQUEST');
    svc.close('3'.repeat(32));
    expect(() => svc.connect(KEY, '3'.repeat(32))).toThrow('DIRECT_INVALID_REQUEST');
  });
});

describe('DirectService discovery lifecycle and budgets (R23/R24)', () => {
  it('detaches the old host before a delayed withdrawal so restart survives old cleanup', async () => {
    let finishWithdrawal!: () => void;
    let created = 0;
    const destroyed: number[] = [];
    const svc = new DirectService({ emit() {}, createDht: () => {
      const id = ++created;
      return {
        createServer: () => ({ async listen() {}, async close() {}, on() {} }),
        connect() { throw new Error('unused'); },
        announce: () => ({ async finished() {}, destroy() {} }),
        lookupAndUnannounce: () => ({ finished: () => id === 1 ? new Promise<void>(resolve => { finishWithdrawal = resolve; }) : Promise.resolve(), destroy() {} }),
        async destroy() { destroyed.push(id); },
      };
    } });
    const first = await svc.hostStart();
    await svc.announce(new Uint8Array(32));
    const stopping = svc.hostStop();
    expect(svc.hostKey).toBeNull();
    const next = await svc.hostStart();
    expect(next.publicKey).not.toBe(first.publicKey);
    finishWithdrawal();
    await stopping;
    expect(svc.hostKey).toBe(next.publicKey);
    expect(destroyed).toEqual([1]);
    await svc.dispose();
    expect(destroyed).toEqual([1, 2]);
  });

  it('caps outstanding lookups and settles all waiters on dispose without waiting for query timeout', async () => {
    let queries = 0;
    let destroyed = 0;
    const svc = new DirectService({ emit() {}, createDht: () => ({
      createServer() { throw new Error('unused'); }, connect() { throw new Error('unused'); }, async destroy() {},
      lookup() {
        queries++;
        let finish!: (value: IteratorResult<{ peers: { publicKey: Uint8Array }[] }>) => void;
        const iterator = { [Symbol.asyncIterator]() { return iterator; }, next() { return new Promise<IteratorResult<{ peers: { publicKey: Uint8Array }[] }>>(resolve => { finish = resolve; }); }, destroy() { destroyed++; finish({ done: true, value: undefined }); } };
        return iterator;
      },
    }) });
    const pending = Array.from({ length: 50 }, () => svc.lookup(new Uint8Array(32), 8, 60_000));
    expect(queries).toBe(DIRECT_MAX_QUERIES);
    await svc.dispose();
    expect(await Promise.all(pending)).toEqual(Array.from({ length: 50 }, () => []));
    expect(destroyed).toBe(DIRECT_MAX_QUERIES);
  });

  it('cancels the actual public withdrawal query when its deadline expires', async () => {
    let destroyed = 0;
    const svc = new DirectService({ emit() {}, createDht: () => ({
      createServer: () => ({ async listen() {}, async close() {}, on() {} }), connect() { throw new Error('unused'); }, async destroy() {},
      lookupAndUnannounce: () => ({ finished: () => new Promise<void>(() => undefined), destroy() { destroyed++; } }),
    }) });
    await svc.hostStart();
    await svc.unannounce(new Uint8Array(32), 15);
    expect(destroyed).toBe(1);
    await svc.dispose();
  });
});

describe('DirectService write completion on real streamx (R8/R10)', () => {
  it('resolves a send when streamx flushes the write, and counts in-flight bytes until then', async () => {
    const dht = fakeDht();
    const { svc } = service(dht);
    svc.connect(KEY, '4'.repeat(32));
    const stream = dht.state.streams[0]!;
    stream.emit('open');
    const big = new Uint8Array(7 * 1024 * 1024);
    let firstDone = false;
    const first = svc.send('4'.repeat(32), big).then(() => { firstDone = true; });
    const second = svc.send('4'.repeat(32), big);
    await expect(svc.send('4'.repeat(32), big)).rejects.toThrow('DIRECT_BACKPRESSURE');
    await wait(20);
    expect(firstDone).toBe(false);
    expect(stream.pending).toHaveLength(1);
    stream.pending[0]!.done(null);
    await first;
    await wait(10);
    const third = svc.send('4'.repeat(32), big);
    await wait(10);
    stream.pending[1]!.done(null);
    await wait(10);
    stream.pending[2]!.done(null);
    await Promise.all([second, third]);
  });

  it('rejects in-flight writes when the channel closes', async () => {
    const dht = fakeDht();
    const { svc } = service(dht);
    svc.connect(KEY, '5'.repeat(32));
    dht.state.streams[0]!.emit('open');
    const pending = svc.send('5'.repeat(32), Uint8Array.of(1));
    svc.close('5'.repeat(32));
    await expect(pending).rejects.toThrow('DIRECT_CLOSED');
    await expect(svc.send('5'.repeat(32), Uint8Array.of(1))).rejects.toThrow('DIRECT_NOT_OPEN');
  });
});

describe('DirectService startup and ownership (R8/R9/R12)', () => {
  it('rejects every non-null peer-supplied relayThrough before native connection establishment (R30)', async () => {
    const dht = fakeDht();
    const { svc } = service(dht);
    try {
      await svc.hostStart();
      const key = Buffer.from(KEY, 'hex');
      expect(dht.state.firewall!(key, {})).toBe(false);
      expect(dht.state.firewall!(key, { relayThrough: null })).toBe(false);
      for (const relayThrough of [{ publicKey: key, token: new Uint8Array(32) }, {}, false, '']) {
        expect(dht.state.firewall!(key, { relayThrough })).toBe(true);
      }
    } finally { await svc.dispose(); }
  });
  it('keeps a successfully listening server running (R9)', async () => {
    const dht = fakeDht();
    const { svc } = service(dht);
    const { publicKey } = await svc.hostStart();
    await wait(20);
    expect(dht.state.serverClosed).toBe(0);
    expect(dht.state.destroyed).toBe(0);
    expect(await svc.hostStart()).toEqual({ publicKey });
    expect(dht.state.nodes).toBe(1);
    await svc.dispose();
  });

  it('starts a fresh node when hostStart follows an immediate hostStop (R12)', async () => {
    let first = true;
    const dht = fakeDht({ listen: () => { if (first) { first = false; return new Promise<void>(() => undefined); } return Promise.resolve(); } });
    const { svc } = service(dht);
    const cancelled = svc.hostStart();
    cancelled.catch(() => undefined);
    await svc.hostStop();
    const restarted = svc.hostStart();
    await expect(cancelled).rejects.toThrow('DIRECT_STOPPED');
    await expect(restarted).resolves.toMatchObject({ publicKey: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(dht.state.nodes).toBe(2);
    await svc.dispose();
  });

  it('hostStop during a never-resolving listen rejects the start and destroys the node', async () => {
    let finishListen!: () => void;
    const dht = fakeDht({ listen: () => new Promise<void>(resolve => { finishListen = resolve; }) });
    const { svc } = service(dht);
    const starting = svc.hostStart();
    starting.catch(() => undefined);
    await svc.hostStop();
    await expect(starting).rejects.toThrow('DIRECT_STOPPED');
    expect(dht.state.destroyed).toBe(1);
    finishListen();
    await wait(20);
    expect(svc.channelCount).toBe(0);
    await svc.dispose();
  });

  it('dispose during startup releases the pending node', async () => {
    const dht = fakeDht({ listen: () => new Promise<void>(() => undefined) });
    const { svc } = service(dht);
    const starting = svc.hostStart();
    starting.catch(() => undefined);
    await svc.dispose();
    await expect(starting).rejects.toThrow('DIRECT_STOPPED');
    expect(dht.state.destroyed).toBe(1);
    await expect(svc.hostStart()).rejects.toThrow('DIRECT_DISPOSED');
  });

  it('bounds the listen startup', async () => {
    const dht = fakeDht({ listen: () => new Promise<void>(() => undefined) });
    const { svc } = service(dht, { listenTimeoutMs: 30 });
    await expect(svc.hostStart()).rejects.toThrow('DIRECT_LISTEN_TIMEOUT');
    expect(dht.state.destroyed).toBe(1);
    await svc.dispose();
  });

  it('hostStop ends only host-owned channels; dispose ends everything', async () => {
    const dht = fakeDht();
    const { svc, events } = service(dht);
    await svc.hostStart();
    const incoming = new FakeStream();
    dht.state.onconnection!(incoming);
    svc.connect(KEY, '6'.repeat(32));
    const outgoing = dht.state.streams[0]!;
    outgoing.emit('open');
    await svc.hostStop();
    await wait(20);
    expect(incoming.destroyed).toBe(true);
    expect(outgoing.destroyed).toBe(false);
    expect(events.filter(event => event.type === 'close').map(event => (event as { reason: string }).reason)).toEqual(['HOST_STOPPED']);
    await svc.dispose();
    await wait(20);
    expect(outgoing.destroyed).toBe(true);
    expect(svc.channelCount).toBe(0);
  });

  it('hostStop preserves the bounded graceful stream close before destroying its node', async () => {
    const dht = fakeDht();
    const { svc, events } = service(dht);
    await svc.hostStart();
    const incoming = new FakeStream();
    dht.state.onconnection!(incoming);
    const opened = events.find(event => event.type === 'incoming')!;
    svc.close(opened.channelId);
    const stopping = svc.hostStop();
    await wait(20);
    expect(dht.state.destroyed).toBe(0);
    incoming.destroy();
    await stopping;
    expect(dht.state.destroyed).toBe(1);
    await svc.dispose();
  });
});

describe('DirectService on real local HyperDHT nodes', () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn().catch(() => undefined); });

  async function pair() {
    const createTestnet = require('hyperdht/testnet');
    const DHT = require('hyperdht');
    const testnet = await createTestnet(3);
    cleanups.push(() => testnet.destroy());
    const make = (): DhtNode => new DHT({ bootstrap: testnet.bootstrap, host: '127.0.0.1' });
    const hostEvents: DirectServiceEvent[] = [];
    const guestEvents: DirectServiceEvent[] = [];
    const host = new DirectService({ emit: event => hostEvents.push(event), createDht: make });
    const guest = new DirectService({ emit: event => guestEvents.push(event), createDht: make });
    cleanups.push(() => host.dispose(), () => guest.dispose());
    return { host, guest, hostEvents, guestEvents };
  }
  const until = async (check: () => boolean, ms = 15_000) => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error('timeout'); await wait(20); } };

  it('rejects a real Noise handshake advertising an unrelated relay without dialing it (R30)', async () => {
    const createTestnet = require('hyperdht/testnet');
    const DHT = require('hyperdht');
    const testnet = await createTestnet(3);
    cleanups.push(() => testnet.destroy());
    const nativeHost = new DHT({ bootstrap: testnet.bootstrap, host: '127.0.0.1' });
    const attacker = new DHT({ bootstrap: testnet.bootstrap, host: '127.0.0.1' });
    cleanups.push(() => attacker.destroy({ force: true }));
    const unrelatedRelayKey = DHT.keyPair().publicKey;
    const decisions: { blocked: boolean; relayKey: string | undefined }[] = [];
    const outboundKeys: string[] = [];
    const originalConnect = nativeHost.connect.bind(nativeHost);
    const originalCreateServer = nativeHost.createServer.bind(nativeHost);
    // Observe the public native API; the production gate is still the callback supplied by DirectService.
    nativeHost.connect = (key: Uint8Array, options: unknown) => {
      outboundKeys.push(Buffer.from(key).toString('hex'));
      return originalConnect(key, options);
    };
    nativeHost.createServer = (options: Parameters<DhtNode['createServer']>[0], onconnection: unknown) => originalCreateServer({
      ...options,
      firewall: (key: Uint8Array, payload: { relayThrough?: { publicKey: Uint8Array } | null }) => {
        const blocked = options.firewall(key, payload);
        decisions.push({ blocked, relayKey: payload.relayThrough ? Buffer.from(payload.relayThrough.publicKey).toString('hex') : undefined });
        return blocked;
      },
    }, onconnection);
    const hostEvents: DirectServiceEvent[] = [];
    const host = new DirectService({ emit: event => hostEvents.push(event), createDht: () => nativeHost });
    cleanups.push(() => host.dispose());
    const { publicKey } = await host.hostStart();
    // Public connect() creates and encrypts the hostile relay proposal. All discovery stays inside this testnet.
    const maliciousStream = attacker.connect(Buffer.from(publicKey, 'hex'), { relayThrough: unrelatedRelayKey, localConnection: false });
    maliciousStream.on('error', () => undefined);
    await until(() => decisions.some(decision => decision.blocked));
    maliciousStream.destroy();
    expect(decisions).toContainEqual({ blocked: true, relayKey: unrelatedRelayKey.toString('hex') });
    expect(hostEvents.some(event => event.type === 'incoming')).toBe(false);
    expect(outboundKeys).toEqual([]);
    // The same gated server must still accept ordinary, relay-free document/helper streams.
    const guestEvents: DirectServiceEvent[] = [];
    const guest = new DirectService({ emit: event => guestEvents.push(event), createDht: () => new DHT({ bootstrap: testnet.bootstrap, host: '127.0.0.1' }) });
    cleanups.push(() => guest.dispose());
    guest.connect(publicKey, 'ad'.repeat(16));
    await until(() => guestEvents.some(event => event.type === 'open') && hostEvents.some(event => event.type === 'incoming'));
    await guest.send('ad'.repeat(16), Uint8Array.of(1, 2, 3));
    await until(() => hostEvents.some(event => event.type === 'message'));
    expect(decisions).toContainEqual({ blocked: false, relayKey: undefined });
    expect(outboundKeys).toEqual([]);
  }, 40_000);

  it('connects to the pinned key, binds both ends to the same handshake and carries an 8 MiB message', async () => {
    const { host, guest, hostEvents, guestEvents } = await pair();
    const { publicKey } = await host.hostStart();
    const id = 'a1'.repeat(16);
    guest.connect(publicKey, id);
    await until(() => guestEvents.some(event => event.type === 'open') && hostEvents.some(event => event.type === 'incoming'));
    const open = guestEvents.find(event => event.type === 'open') as { binding: Uint8Array };
    const incoming = hostEvents.find(event => event.type === 'incoming') as { channelId: string; binding: Uint8Array };
    expect(Buffer.from(open.binding).equals(Buffer.from(incoming.binding))).toBe(true);
    const payload = new Uint8Array(DIRECT_MAX_MESSAGE_BYTES);
    for (let i = 0; i < payload.length; i += 4099) payload[i] = i % 251;
    await guest.send(id, payload);
    await host.send(incoming.channelId, Uint8Array.of(4, 5, 6));
    await until(() => hostEvents.some(event => event.type === 'message') && guestEvents.some(event => event.type === 'message'));
    const received = (hostEvents.find(event => event.type === 'message') as { data: Uint8Array }).data;
    expect(received.byteLength).toBe(payload.byteLength);
    expect(Buffer.from(received).equals(Buffer.from(payload))).toBe(true);
    expect((guestEvents.find(event => event.type === 'message') as { data: Uint8Array }).data).toEqual(Uint8Array.of(4, 5, 6));
  }, 40_000);

  it('does not complete a connection to a key nobody hosts, and closes it on timeout', async () => {
    const createTestnet = require('hyperdht/testnet');
    const DHT = require('hyperdht');
    const testnet = await createTestnet(3);
    cleanups.push(() => testnet.destroy());
    const events: DirectServiceEvent[] = [];
    const guest = new DirectService({ emit: event => events.push(event), createDht: () => new DHT({ bootstrap: testnet.bootstrap, host: '127.0.0.1' }), connectTimeoutMs: 1500 });
    cleanups.push(() => guest.dispose());
    guest.connect('ef'.repeat(32), 'b2'.repeat(16));
    await until(() => events.some(event => event.type === 'close'), 10_000);
    expect(events.find(event => event.type === 'open')).toBeUndefined();
  }, 20_000);

  it('hostStop leaves no host reachable', async () => {
    const { host, guest, guestEvents } = await pair();
    const { publicKey } = await host.hostStart();
    await host.hostStop();
    guest.connect(publicKey, 'c3'.repeat(16));
    await until(() => guestEvents.some(event => event.type === 'close' || event.type === 'open'), 25_000).catch(() => undefined);
    expect(guestEvents.find(event => event.type === 'open')).toBeUndefined();
  }, 40_000);
});
