import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { PeerRelayHelper } from '../../../../electron/peer-relay-service';
import { DirectService, type DhtNode, type DirectServiceEvent } from '../../../../electron/direct-service';
import { serviceAdTopic, sessionAdTopic, topicForHostKey, type RelayHub } from '../../../../relay/hub.mjs';

const require = createRequire(import.meta.url);
const { Duplex } = require('streamx');
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const until = async (check: () => boolean, timeout = 2000) => {
  const end = Date.now() + timeout;
  while (!check()) { if (Date.now() > end) throw new Error('Condition did not settle'); await wait(5); }
};
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
const hex = (value: Uint8Array) => Buffer.from(value).toString('hex');
const frame = (value: unknown) => {
  const body = Buffer.concat([Buffer.from([0]), Buffer.from(JSON.stringify(value))]);
  const length = Buffer.alloc(4); length.writeUInt32BE(body.length);
  return Buffer.concat([length, body]);
};
class Stream extends (Duplex as new (options: object) => EventEmitter & { destroy(): void; destroyed: boolean }) {
  remotePublicKey = new Uint8Array(32);
  handshakeHash = new Uint8Array(32);
  texts: { t: string; nonce?: string }[] = [];
  constructor() {
    super({ write: (data: Uint8Array, done: () => void) => { this.texts.push(JSON.parse(Buffer.from(data.subarray(5)).toString())); done(); } });
  }
}
function identity() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return { privateKey, key: raw.toString('base64url'), topic: topicForHostKey(raw) };
}
function fixture(options: { listen?: () => Promise<void>; remoteAddress?: DhtNode['remoteAddress'] } = {}) {
  const state = { nodes: 0, destroyed: 0, active: 0, maximum: 0, announcements: [] as string[], withdrawals: [] as string[], published: new Set<string>(), incoming: null as null | ((stream: Stream) => void) };
  let announceGate: { topic: string; gate: ReturnType<typeof deferred> } | null = null;
  let withdrawGate: { topic: string; gate: ReturnType<typeof deferred> } | null = null;
  let failAnnounce = false;
  const query = (kind: 'announce' | 'withdraw', topic: Uint8Array) => {
    const key = hex(topic);
    (kind === 'announce' ? state.announcements : state.withdrawals).push(key);
    const block = kind === 'announce' ? announceGate : withdrawGate;
    if (block?.topic === key) { if (kind === 'announce') announceGate = null; else withdrawGate = null; }
    let cancelled = false;
    let finished = false;
    state.maximum = Math.max(state.maximum, ++state.active);
    const release = () => { if (!finished) { finished = true; state.active--; } };
    return {
      async finished() {
        try {
          if (block?.topic === key) await block.gate.promise;
          if (cancelled) return;
          if (kind === 'announce' && failAnnounce) throw new Error('QUERY_FAILED');
          if (kind === 'announce') state.published.add(key); else state.published.delete(key);
        } finally { release(); }
      },
      destroy() { cancelled = true; release(); },
    };
  };
  const createDht = (): DhtNode => {
    state.nodes++;
    return {
      ...(options.remoteAddress ? { remoteAddress: options.remoteAddress } : {}),
      createServer(_options, callback) { state.incoming = callback as never; return { listen: options.listen ?? (async () => {}), async close() {}, on() {} }; },
      connect() { throw new Error('unused'); },
      announce: topic => query('announce', topic),
      lookupAndUnannounce: topic => query('withdraw', topic),
      async destroy() { state.destroyed++; },
    };
  };
  return {
    state, createDht,
    blockAnnounce(topic: Uint8Array) { const gate = deferred(); announceGate = { topic: hex(topic), gate }; return gate; },
    blockWithdraw(topic: Uint8Array) { const gate = deferred(); withdrawGate = { topic: hex(topic), gate }; return gate; },
    failAnnouncements() { failAnnounce = true; },
    async host(id = identity()) {
      const stream = new Stream(); state.incoming!(stream);
      stream.emit('data', frame({ t: 'host', topic: id.topic, key: id.key }));
      await until(() => stream.texts.some(value => value.t === 'challenge'));
      const nonce = stream.texts.find(value => value.t === 'challenge')!.nonce!;
      const sig = crypto.sign(null, Buffer.concat([Buffer.from('sketchdraw-relay-host-v1\0'), Buffer.from(id.topic, 'hex'), Buffer.from(nonce, 'hex')]), id.privateKey);
      stream.emit('data', frame({ t: 'proof', sig: sig.toString('base64url') }));
      await until(() => stream.texts.some(value => value.t === 'ready'));
      return { stream, identity: id };
    },
  };
}
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
function helper(f: ReturnType<typeof fixture>, refreshMs?: number) {
  const value = new PeerRelayHelper({ createDht: f.createDht, refreshMs });
  cleanups.push(() => value.stop());
  return value;
}

describe('Volunteer helper lifecycle and bounded advertisements (R19/R22/R25)', () => {
  it('keeps native endpoint observation distinct from listening and advertisement success', async () => {
    let address: { host: string; port: number } | null = null;
    const f = fixture({ remoteAddress: () => address }), h = helper(f);
    await h.start();
    expect(h.status()).toMatchObject({ running: true, announced: true, externalAddressKnown: false, forwardedRecords: 0 });
    address = { host: '192.0.2.1', port: 12345 };
    expect(h.status()).toMatchObject({ externalAddressKnown: true, forwardedRecords: 0 });
    address = { host: '192.0.2.1', port: 0 };
    expect(h.status().externalAddressKnown).toBe(false);
    await h.stop(); expect(h.status().externalAddressKnown).toBe(false);
  });

  it('is off by default, shares a pending start and supports immediate restart after cancellation', async () => {
    const pending = deferred(); let first = true;
    const f = fixture({ listen: () => { if (first) { first = false; return pending.promise; } return Promise.resolve(); } });
    const h = helper(f);
    expect(h.status().running).toBe(false); expect(f.state.nodes).toBe(0);
    const old = h.start(); expect(h.start()).toBe(old);
    const stopping = h.stop(); const fresh = h.start();
    await stopping; await fresh; await old;
    expect(h.status().running).toBe(true); expect(f.state.nodes).toBe(2);
    expect(f.state.destroyed).toBe(1);
    pending.resolve(); await wait(10);
    expect(f.state.destroyed).toBe(1);
  });

  it('cancels a pending advertisement on opt-out and never resurrects announced state', async () => {
    const f = fixture(), gate = f.blockAnnounce(serviceAdTopic()), h = helper(f);
    const starting = h.start(); await until(() => f.state.active === 1);
    await h.stop(); await starting;
    gate.resolve(); await wait(10);
    expect(h.status()).toMatchObject({ running: false, announced: false, sessions: 0 });
    expect(f.state.active).toBe(0); expect(f.state.published.size).toBe(0);
  });

  it('withdraws a late session advertisement after the authenticated host leaves', async () => {
    const f = fixture(), h = helper(f); await h.start();
    const id = identity(), topic = sessionAdTopic(id.topic), gate = f.blockAnnounce(topic);
    const host = await f.host(id); host.stream.emit('close');
    gate.resolve();
    await until(() => f.state.withdrawals.includes(hex(topic)));
    expect(f.state.published.has(hex(topic))).toBe(false);
    expect(h.status().sessions).toBe(0);
  });

  it('serializes an old withdrawal before advertising a replacement registration', async () => {
    const f = fixture(), h = helper(f); await h.start();
    const id = identity(), topic = sessionAdTopic(id.topic);
    const first = await f.host(id); await until(() => f.state.published.has(hex(topic)));
    const gate = f.blockWithdraw(topic); first.stream.emit('close');
    await until(() => f.state.withdrawals.includes(hex(topic)));
    await f.host(id);
    expect(f.state.announcements.filter(key => key === hex(topic))).toHaveLength(1);
    gate.resolve();
    await until(() => f.state.announcements.filter(key => key === hex(topic)).length === 2);
    expect(f.state.published.has(hex(topic))).toBe(true);
    expect(f.state.maximum).toBe(1);
  });

  it('retries an interrupted withdrawal on opt-out before destroying the helper node', async () => {
    const f = fixture(), h = helper(f); await h.start();
    const id = identity(), topic = sessionAdTopic(id.topic);
    const host = await f.host(id); await until(() => f.state.published.has(hex(topic)));
    const gate = f.blockWithdraw(topic); host.stream.emit('close');
    await until(() => f.state.withdrawals.includes(hex(topic)));
    await h.stop(); gate.resolve(); await wait(10);
    expect(f.state.withdrawals.filter(key => key === hex(topic))).toHaveLength(2);
    expect(f.state.published.size).toBe(0);
    expect(f.state.active).toBe(0);
  });

  it('contains refresh failures, coalesces refresh work and tears down hub state on opt-out', async () => {
    const f = fixture(), h = helper(f, 5); await h.start();
    const pending = f.blockAnnounce(serviceAdTopic());
    await until(() => f.state.announcements.length === 2);
    await wait(25); expect(f.state.announcements).toHaveLength(2);
    f.failAnnouncements(); pending.resolve();
    await until(() => f.state.announcements.length >= 3);
    expect(f.state.maximum).toBe(1);
    const stream = new Stream(); f.state.incoming!(stream);
    const hub = (h as unknown as { hub: RelayHub }).hub;
    expect(hub.stats().connections).toBe(1);
    await h.stop();
    expect(hub.stats()).toMatchObject({ connections: 0, topics: 0 });
    const count = f.state.announcements.length; await wait(20);
    expect(f.state.announcements).toHaveLength(count);
  });

  it('rejects oversized native relay frames using only the length header', async () => {
    const f = fixture(), h = helper(f); await h.start();
    const stream = new Stream(); f.state.incoming!(stream);
    const hub = (h as unknown as { hub: RelayHub }).hub;
    const header = Buffer.alloc(4); header.writeUInt32BE(hub.limits.maxRecordBytes + 2);
    stream.emit('data', header);
    expect(h.status().connections).toBe(0);
    await wait(5); expect(stream.destroyed).toBe(true);
  });
});

describe('Volunteer helper discovery on an isolated real HyperDHT test network', () => {
  it('discovers the helper without a configured endpoint, publishes only authenticated sessions and withdraws on exit', async () => {
    const testnet = await require('hyperdht/testnet')(3), DHT = require('hyperdht');
    cleanups.push(() => testnet.destroy());
    let nodes = 0;
    const createDht = (): DhtNode => { nodes++; return new DHT({ bootstrap: testnet.bootstrap, host: '127.0.0.1' }); };
    const h = new PeerRelayHelper({ createDht }); cleanups.push(() => h.stop());
    const events: DirectServiceEvent[] = [];
    const client = new DirectService({ createDht, emit: event => events.push(event) }); cleanups.push(() => client.dispose());
    expect(nodes).toBe(0);
    expect(await h.start()).toMatchObject({ running: true, announced: true });
    expect(nodes).toBe(1);
    expect(await client.lookup(serviceAdTopic())).toContain(h.keyHex);
    const id = identity(), topic = sessionAdTopic(id.topic);
    expect(await client.lookup(topic)).toEqual([]);
    const channel = 'b3'.repeat(16); client.connect(h.keyHex!, channel);
    await until(() => events.some(event => event.type === 'open'), 15_000);
    const texts = () => events.filter((event): event is Extract<DirectServiceEvent, { type: 'message' }> => event.type === 'message').map(event => JSON.parse(Buffer.from(event.data.subarray(1)).toString()));
    const send = (value: unknown) => client.send(channel, frame(value).subarray(4));
    await send({ t: 'host', topic: id.topic, key: id.key });
    await until(() => texts().some(value => value.t === 'challenge'));
    const nonce = texts().find(value => value.t === 'challenge').nonce;
    const sig = crypto.sign(null, Buffer.concat([Buffer.from('sketchdraw-relay-host-v1\0'), Buffer.from(id.topic, 'hex'), Buffer.from(nonce, 'hex')]), id.privateKey);
    await send({ t: 'proof', sig: sig.toString('base64url') });
    await until(() => texts().some(value => value.t === 'ready'));
    let found: string[] = [];
    for (let i = 0; i < 5 && !found.length; i++) { await wait(20); found = await client.lookup(topic); }
    expect(found).toContain(h.keyHex);
    client.close(channel); await until(() => h.status().sessions === 0);
    for (let i = 0; i < 5; i++) { await wait(20); found = await client.lookup(topic); if (!found.length) break; }
    expect(found).toEqual([]);
    const key = h.keyHex; await h.stop();
    expect(await client.lookup(serviceAdTopic())).not.toContain(key);
    expect(nodes).toBe(2);
  }, 45_000);
});
