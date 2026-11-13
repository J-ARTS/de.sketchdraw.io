import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRelayHub, topicForHostKey, type HubConnection, type RelayHubLimits } from '../../../../relay/hub.mjs';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.useRealTimers(); });

function hostIdentity() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const raw = (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(-32);
  return { raw, privateKey, topic: topicForHostKey(raw) };
}

function fixture(synchronousClose = true, limits: Partial<RelayHubLimits> = {}) {
  const identity = hostIdentity();
  const topic = identity.topic;
  const events: string[] = [];
  const pending: (() => number)[] = [];
  let peakBufferedBytes = 0;
  const hub = createRelayHub({ limits, onHostRegistered: () => events.push('registered'), onHostGone: () => events.push('gone') });
  cleanups.push(() => hub.dispose());

  function client(noDrain = false) {
    let open = true;
    let queuedBytes = 0;
    pending.push(() => queuedBytes);
    const texts: Record<string, unknown>[] = [];
    const frames: Uint8Array[] = [];
    const closes: { code: number; reason: string }[] = [];
    const conn: HubConnection = {
      isOpen: () => open,
      bufferedAmount: () => queuedBytes,
      send: (data, binary) => {
        // Model the native adapter's pending writes: payload plus kind and length header, until drained.
        if (noDrain) queuedBytes += (typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength) + 5;
        peakBufferedBytes = Math.max(peakBufferedBytes, pending.reduce((sum, get) => sum + get(), 0));
        if (binary) frames.push(Uint8Array.from(data as Uint8Array)); else texts.push(JSON.parse(String(data)));
      },
      close: (code, reason) => { open = false; queuedBytes = 0; closes.push({ code, reason }); if (synchronousClose) handler.closed(); },
    };
    const handler = hub.accept(conn)!;
    return { conn, handler, texts, frames, closes, drain: () => { queuedBytes = 0; }, send: (value: unknown) => handler.message(Buffer.from(JSON.stringify(value)), false) };
  }
  function register(host: ReturnType<typeof client>, { raw, privateKey, topic: hostTopic } = identity) {
    host.send({ t: 'host', key: raw.toString('base64url'), topic: hostTopic });
    const nonce = host.texts.find(value => value.t === 'challenge')!.nonce as string;
    const signature = crypto.sign(null, Buffer.concat([Buffer.from('sketchdraw-relay-host-v1\0'), Buffer.from(hostTopic, 'hex'), Buffer.from(nonce, 'hex')]), privateKey);
    host.send({ t: 'proof', sig: signature.toString('base64url') });
  }
  return { hub, topic, events, client, register, peakBufferedBytes: () => peakBufferedBytes };
}

describe('transport-neutral relay ownership and limits (R20/R21)', () => {
  it('does not charge controls or unknown destinations against shared forwarding capacity (#182)', () => {
    vi.useFakeTimers();
    const f = fixture(true, { aggregateBytesPerSecond: 100, aggregateByteBurst: 100 });
    const host = f.client(); f.register(host);
    const guest = f.client(); guest.send({ t: 'guest', topic: f.topic });
    const other = f.client(); f.register(other, hostIdentity());
    for (let index = 0; index < 30; index++) other.handler.message(new Uint8Array(1000), true);
    for (let index = 0; index < 10; index++) other.send({ t: 'ping' });
    host.send({ t: 'ping' });
    guest.handler.message(new Uint8Array(84), true);
    expect(host.frames).toHaveLength(1);
    expect(host.texts.at(-1)).toEqual({ t: 'pong' });
    expect([host, guest, other].every(client => !client.closes.length)).toBe(true);
    expect(f.hub.stats()).toMatchObject({ forwardedRecords: 1, closedForLimit: 0 });
  });

  it('paces real aggregate saturation fairly without losing order or rejecting another session', async () => {
    vi.useFakeTimers();
    const f = fixture(true, { aggregateBytesPerSecond: 100, aggregateByteBurst: 100 });
    const host = f.client(); f.register(host);
    const first = f.client(); first.send({ t: 'guest', topic: f.topic });
    const otherIdentity = hostIdentity(), otherHost = f.client(); f.register(otherHost, otherIdentity);
    const second = f.client(); second.send({ t: 'guest', topic: otherIdentity.topic });
    for (const value of [1, 2, 3]) first.handler.message(new Uint8Array(84).fill(value), true);
    second.handler.message(new Uint8Array(84).fill(4), true);
    otherHost.send({ t: 'ping' });
    expect(otherHost.texts.at(-1)).toEqual({ t: 'pong' });
    expect(otherHost.closes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(host.frames.map(frame => frame[16])).toEqual([1, 2]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(otherHost.frames.map(frame => frame[16])).toEqual([4]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(host.frames.map(frame => frame[16])).toEqual([1, 2, 3]);
    expect(f.hub.stats().closedForLimit).toBe(0);
    f.hub.dispose(); expect(vi.getTimerCount()).toBe(0);
  });

  it('sheds the largest queued producer rather than the unrelated next sender at the global queue bound', async () => {
    vi.useFakeTimers();
    const f = fixture(true, { aggregateBytesPerSecond: 100, aggregateByteBurst: 100, maxAggregateQueuedBytes: 250 });
    const host = f.client(); f.register(host);
    const flood = f.client(); flood.send({ t: 'guest', topic: f.topic });
    const survivor = f.client(); survivor.send({ t: 'guest', topic: f.topic });
    for (let index = 0; index < 3; index++) flood.handler.message(new Uint8Array(84), true);
    survivor.handler.message(new Uint8Array(84).fill(7), true);
    expect(flood.closes).toEqual([{ code: 4429, reason: 'aggregate-queue-full' }]);
    expect(survivor.closes).toEqual([]); expect(host.closes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(host.frames.map(frame => frame[16])).toEqual([0, 7]);
    f.hub.dispose(); expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the shared queue counter exact when shedding also removes the current source destination', async () => {
    vi.useFakeTimers();
    const f = fixture(true, { aggregateBytesPerSecond: 100, aggregateByteBurst: 100, maxAggregateQueuedBytes: 250 });
    const host = f.client(); f.register(host);
    const flood = f.client(); flood.send({ t: 'guest', topic: f.topic });
    const survivor = f.client(); survivor.send({ t: 'guest', topic: f.topic });
    const ids = host.texts.filter(value => value.t === 'guest-join').map(value => Buffer.from(value.id as string, 'hex'));
    const sendTo = (id: Buffer, value: number) => host.handler.message(Buffer.concat([id, Buffer.alloc(30, value)]), true);
    for (let index = 0; index < 3; index++) flood.handler.message(new Uint8Array(84), true);
    sendTo(ids[0]!, 8); // This pending record is removed together with the biggest producer below.
    sendTo(ids[1]!, 9);
    expect(flood.closes).toEqual([{ code: 4429, reason: 'aggregate-queue-full' }]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(survivor.frames.map(frame => frame[0])).toEqual([9]);
    const next = f.client(); next.send({ t: 'guest', topic: f.topic });
    for (let index = 0; index < 3; index++) next.handler.message(new Uint8Array(84), true);
    sendTo(ids[1]!, 10); sendTo(ids[1]!, 11);
    // Actual queued payloads again exceed 250 bytes. No stale negative accounting may grant extra capacity.
    expect(next.closes).toEqual([{ code: 4429, reason: 'aggregate-queue-full' }]);
    expect(survivor.closes).toEqual([]); expect(host.closes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(survivor.frames.map(frame => frame[0])).toEqual([9, 10, 11]);
    f.hub.dispose(); expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['bytes', 'records'] as const)('bounds each producer queue by %s with an explicit disconnect', bound => {
    vi.useFakeTimers();
    const f = fixture(true, { aggregateBytesPerSecond: 100, aggregateByteBurst: 100,
      maxAggregateQueuedBytesPerConnection: bound === 'bytes' ? 200 : 1000, maxAggregateQueuedRecordsPerConnection: bound === 'records' ? 2 : 10 });
    const host = f.client(); f.register(host);
    const flood = f.client(); flood.send({ t: 'guest', topic: f.topic });
    flood.handler.message(new Uint8Array(84), true);
    for (let index = 0; index < 3; index++) flood.handler.message(new Uint8Array(84), true);
    expect(flood.closes).toEqual([{ code: 4429, reason: 'aggregate-queue-full' }]);
    expect(host.closes).toEqual([]);
    f.hub.dispose(); expect(vi.getTimerCount()).toBe(0);
  });

  it('expires queued producers and removes stale destination records on replacement and disposal', async () => {
    vi.useFakeTimers();
    const f = fixture(false, { aggregateBytesPerSecond: 1, aggregateByteBurst: 100, aggregateQueueTimeoutMs: 50 });
    const host = f.client(); f.register(host);
    const guest = f.client(); guest.send({ t: 'guest', topic: f.topic });
    guest.handler.message(new Uint8Array(84), true); guest.handler.message(new Uint8Array(84), true);
    await vi.advanceTimersByTimeAsync(50);
    expect(guest.closes).toEqual([{ code: 4429, reason: 'aggregate-queue-timeout' }]);
    const next = f.client(); next.send({ t: 'guest', topic: f.topic });
    next.handler.message(new Uint8Array(84), true);
    const replacement = f.client(); f.register(replacement);
    await vi.advanceTimersByTimeAsync(1000);
    expect(replacement.frames).toEqual([]);
    expect(next.closes).toEqual([{ code: 4410, reason: 'host-replaced' }]);
    f.hub.dispose(); expect(vi.getTimerCount()).toBe(0);
  });

  it.each([true, false])('keeps the replacement routable with synchronous close callbacks = %s', synchronous => {
    const f = fixture(synchronous);
    const first = f.client(); f.register(first);
    const oldGuest = f.client(); oldGuest.send({ t: 'guest', topic: f.topic });
    const second = f.client(); f.register(second);
    first.handler.closed(); oldGuest.handler.closed(); // a delayed old close must also be harmless
    const guest = f.client(); guest.send({ t: 'guest', topic: f.topic });
    guest.handler.message(Uint8Array.of(17, 18), true);
    expect(f.hub.stats()).toMatchObject({ topics: 1, connections: 2, guests: 1 });
    expect(guest.texts).toContainEqual({ t: 'ready' });
    expect(second.frames[0]!.subarray(16)).toEqual(Uint8Array.of(17, 18));
    expect(first.closes).toContainEqual({ code: 4409, reason: 'replaced' });
    expect(f.events).toEqual(['registered', 'registered']);
  });

  it.each(['host', 'guest'] as const)('rejects oversized %s records without forwarding', role => {
    const f = fixture(false);
    const host = f.client(); f.register(host);
    const guest = f.client(); guest.send({ t: 'guest', topic: f.topic });
    const sender = role === 'host' ? host : guest;
    sender.handler.message(new Uint8Array(f.hub.limits.maxRecordBytes + 1), true);
    expect(host.frames).toHaveLength(0);
    expect(guest.frames).toHaveLength(0);
    expect(sender.closes).toEqual([{ code: 1009, reason: 'too-large' }]);
    expect(f.hub.stats().closedForLimit).toBe(1);
  });

  it('includes the multiplex prefix in the forwarded record limit', () => {
    const f = fixture(false, { maxRecordBytes: 512 });
    const host = f.client(); f.register(host);
    const guest = f.client(); guest.send({ t: 'guest', topic: f.topic });
    guest.handler.message(new Uint8Array(512 - 16), true);
    expect(host.frames[0]).toHaveLength(512);
    guest.handler.message(new Uint8Array(512 - 15), true);
    expect(host.frames).toHaveLength(1);
    expect(guest.closes).toEqual([{ code: 1009, reason: 'too-large' }]);
  });

  it('checks text size before accepting a pre-authentication ping', () => {
    const f = fixture(false, { maxRecordBytes: 100 });
    const client = f.client();
    client.send({ t: 'ping', padding: 'x'.repeat(150) });
    expect(client.texts).toEqual([]);
    expect(client.closes).toEqual([{ code: 1009, reason: 'too-large' }]);
    expect(f.hub.stats().connections).toBe(0);
  });

  it('owns shutdown cleanup even when no adapter ever reports closed', () => {
    vi.useFakeTimers();
    const f = fixture(false);
    const host = f.client(); f.register(host);
    const guest = f.client(); guest.send({ t: 'guest', topic: f.topic });
    const pending = f.client();
    f.hub.dispose(); f.hub.dispose();
    for (const client of [host, guest, pending]) { client.handler.closed(); client.send({ t: 'ping' }); }
    expect(f.hub.stats()).toMatchObject({ topics: 0, connections: 0, guests: 0 });
    expect(f.events).toEqual(['registered', 'gone']);
    expect(vi.getTimerCount()).toBe(0);
    expect(host.texts.some(value => value.t === 'pong')).toBe(false);
    expect(f.hub.accept(pending.conn)).toBeNull();
  });

  it('releases an unauthenticated slot on timeout without a close callback', () => {
    vi.useFakeTimers();
    const f = fixture(false, { joinTimeoutMs: 10, maxConnections: 1 });
    const first = f.client();
    vi.advanceTimersByTime(11);
    expect(first.closes).toEqual([{ code: 4408, reason: 'join-timeout' }]);
    expect(f.hub.stats().connections).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(f.client().handler).not.toBeNull();
  });

  it('removes a slow host and its guests when a control frame would exceed its buffer limit', () => {
    const f = fixture(false);
    const host = f.client(); f.register(host);
    host.conn.bufferedAmount = () => f.hub.limits.maxBufferedBytes;
    const guest = f.client(); guest.send({ t: 'guest', topic: f.topic });
    expect(host.closes).toEqual([{ code: 4408, reason: 'slow-consumer' }]);
    expect(f.hub.stats()).toMatchObject({ connections: 0, topics: 0, guests: 0 });
  });
});

describe('relay shared outgoing buffer budget', () => {
  it.each(['host', 'guest'] as const)('keeps a joined %s alive for controls during a 200 KiB transfer backlog', role => {
    const f = fixture();
    const host = f.client(true); f.register(host);
    const guest = f.client(true); guest.send({ t: 'guest', topic: f.topic });
    const guestId = Buffer.from(host.texts.find(value => value.t === 'guest-join')!.id as string, 'hex');
    for (let i = 0; i < 4; i++) {
      const data = new Uint8Array(50 * 1024);
      if (role === 'host') guest.handler.message(data, true);
      else host.handler.message(Buffer.concat([guestId, data]), true);
    }
    const target = role === 'host' ? host : guest;
    expect(f.hub.limits.maxTotalBufferedBytes).toBe(64 * 1024 * 1024);
    expect(target.conn.bufferedAmount()).toBeGreaterThan(200 * 1024);
    target.send({ t: 'ping' });
    const newcomer = f.client(); newcomer.send({ t: 'guest', topic: f.topic });
    expect(target.texts).toContainEqual({ t: 'pong' });
    expect(target.closes).toEqual([]);
    expect(newcomer.texts).toContainEqual({ t: 'ready' });
    expect(f.hub.stats()).toMatchObject({ connections: 3, topics: 1, guests: 2, closedForLimit: 0 });
  });

  it('retains the smaller control buffer limit before a connection joins', () => {
    const f = fixture(false, { maxControlBufferedBytes: 128 });
    const pending = f.client(true);
    for (let i = 0; i < 12; i++) pending.send({ t: 'ping' });
    expect(pending.closes).toEqual([{ code: 4408, reason: 'slow-consumer' }]);
    expect(f.peakBufferedBytes()).toBeLessThanOrEqual(128);
  });

  it('bounds the combined pending writes across two hosts and their non-draining guests', () => {
    const f = fixture(false, { maxBufferedBytes: 4096, maxTotalBufferedBytes: 4096 });
    const secondIdentity = hostIdentity();
    const hosts = [f.client(true), f.client(true)];
    f.register(hosts[0]!); f.register(hosts[1]!, secondIdentity);
    const guests = Array.from({ length: 4 }, (_, index) => {
      const guest = f.client(true);
      guest.send({ t: 'guest', topic: index < 2 ? f.topic : secondIdentity.topic });
      return guest;
    });
    const targets = hosts.flatMap(host => host.texts.filter(value => value.t === 'guest-join').map(value => ({ host, id: Buffer.from(value.id as string, 'hex') })));
    for (let i = 0; i < 32; i++) {
      const { host, id } = targets[i % targets.length]!;
      host.handler.message(Buffer.concat([id, new Uint8Array(400)]), true);
    }
    expect(f.hub.stats().closedForLimit).toBeGreaterThan(0);
    expect(f.peakBufferedBytes()).toBeLessThanOrEqual(4096);
    expect(guests.some(guest => guest.closes.length > 0)).toBe(true);
    expect([...hosts, ...guests].every(client => client.conn.bufferedAmount() <= 4096)).toBe(true);
  });

  it('counts control-only connections against the shared buffer budget', () => {
    const f = fixture(false, { maxTotalBufferedBytes: 256 });
    const pending = Array.from({ length: 3 }, () => f.client(true));
    for (let i = 0; i < 30; i++) pending[i % pending.length]!.send({ t: 'ping' });
    expect(f.hub.stats().closedForLimit).toBeGreaterThan(0);
    expect(f.peakBufferedBytes()).toBeLessThanOrEqual(256);
  });

  it('reserves framing bytes before a control write reaches the shared budget boundary', () => {
    const f = fixture(false, { maxTotalBufferedBytes: 48 });
    const pending = [f.client(true), f.client(true)];
    pending[0]!.send({ t: 'ping' });
    pending[1]!.send({ t: 'ping' });
    // Two native pong frames account for 34 bytes; another 12-byte payload fits, its 5-byte header does not.
    pending[1]!.send({ t: 'ping' });
    expect(pending[1]!.closes).toEqual([{ code: 4408, reason: 'slow-consumer' }]);
    expect(f.peakBufferedBytes()).toBeLessThanOrEqual(48);
  });

  it('uses immediate termination when a slow transport offers it', () => {
    const f = fixture(false, { maxTotalBufferedBytes: 48 });
    const pending = f.client(true);
    const close = pending.conn.close;
    pending.conn.close = vi.fn();
    pending.conn.terminate = vi.fn((code = 1001, reason = '') => close(code, reason));
    for (let i = 0; i < 4; i++) pending.send({ t: 'ping' });
    expect(pending.conn.terminate).toHaveBeenCalledExactlyOnceWith(4408, 'slow-consumer');
    expect(pending.conn.close).not.toHaveBeenCalled();
    expect(f.hub.stats().connections).toBe(0);
    expect(pending.conn.bufferedAmount()).toBe(0);
  });

  it('reuses shared budget after the adapter drains instead of accumulating a lifetime byte count', () => {
    const f = fixture(false, { maxTotalBufferedBytes: 1024 });
    const host = f.client(true); f.register(host);
    const guest = f.client(true); guest.send({ t: 'guest', topic: f.topic });
    for (let i = 0; i < 20; i++) {
      guest.handler.message(new Uint8Array(700), true);
      host.drain(); guest.drain();
    }
    expect(host.frames).toHaveLength(20);
    expect(f.hub.stats().closedForLimit).toBe(0);
    expect(f.peakBufferedBytes()).toBeLessThanOrEqual(1024);
  });
});
