import crypto from 'node:crypto';
import { createRequire } from 'node:module';

/*
 * Native direct route (HyperDHT) of the HyperDHT + relay session mode. It lives in the Electron main process only;
 * the renderer addresses connections through opaque channel ids and never sees keys, sockets or network addresses.
 * HyperDHT authenticates the pinned host key with its Noise handshake and encrypts the stream. The PIN, the role and
 * the document are handled one layer up, over this channel.
 */

export const DIRECT_MAX_MESSAGE_BYTES = 8 * 1024 * 1024 + 1;
export const DIRECT_MAX_CHANNELS = 64;
export const DIRECT_MAX_PENDING_WRITE_BYTES = 16 * 1024 * 1024;
export const DIRECT_CONNECT_TIMEOUT_MS = 20_000;
export const DIRECT_LISTEN_TIMEOUT_MS = 20_000;
const DIRECT_RELEASE_TIMEOUT_MS = 2_000;
const DIRECT_GRACE_MS = 1_000;
const DIRECT_ANNOUNCE_TIMEOUT_MS = 8_000;
const DIRECT_UNANNOUNCE_TIMEOUT_MS = 1_500;
const DIRECT_LOOKUP_TIMEOUT_MS = 5_000;
export const DIRECT_MAX_QUERIES = 16;
const DIRECT_MAX_ADVERTISEMENTS = 32;
const CHANNEL_ID_PATTERN = /^[0-9a-f]{32}$/;
const KEY_PATTERN = /^[0-9a-f]{64}$/;
const MAX_TOMBSTONES = 256;

export type DirectServiceEvent =
  | { type: 'incoming'; channelId: string; binding: Uint8Array }
  | { type: 'open'; channelId: string; binding: Uint8Array }
  | { type: 'message'; channelId: string; data: Uint8Array }
  | { type: 'close'; channelId: string; reason: string };

interface DhtStream {
  remotePublicKey: Uint8Array;
  handshakeHash?: Uint8Array;
  write(data: Uint8Array): boolean;
  destroy(error?: Error): void;
  on(event: string, listener: (...args: any[]) => void): unknown;
  once(event: string, listener: (...args: any[]) => void): unknown;
  end?(): void;
  setKeepAlive?(ms: number): void;
}
interface DhtServer {
  listen(keyPair: { publicKey: Uint8Array; secretKey: Uint8Array }): Promise<void>;
  close(): Promise<void>;
  on(event: string, listener: (...args: any[]) => void): unknown;
}
interface DhtQuery { [Symbol.asyncIterator](): AsyncIterator<{ peers?: { publicKey: Uint8Array }[] }>; destroy?(): void; finished?(): Promise<void> }
interface DhtWriteQuery { finished(): Promise<void>; destroy?(): void }
export interface DhtNode {
  lookup?(topic: Uint8Array): DhtQuery;
  announce?(topic: Uint8Array, keyPair: { publicKey: Uint8Array; secretKey: Uint8Array }): { finished(): Promise<void>; destroy?(): void };
  unannounce?(topic: Uint8Array, keyPair: { publicKey: Uint8Array; secretKey: Uint8Array }): Promise<void>;
  lookupAndUnannounce?(topic: Uint8Array, keyPair: { publicKey: Uint8Array; secretKey: Uint8Array }): DhtWriteQuery;
  createServer(options: { firewall(remotePublicKey: Uint8Array, remoteHandshakePayload: { relayThrough?: unknown }): boolean }, onconnection?: (stream: DhtStream) => void): DhtServer;
  connect(publicKey: Uint8Array, options: { keyPair: { publicKey: Uint8Array; secretKey: Uint8Array } }): DhtStream;
  destroy(options?: { force?: boolean }): Promise<void>;
}
export type DhtFactory = () => DhtNode;

export interface DirectServiceOptions {
  emit(event: DirectServiceEvent): void;
  /** Overrides the DHT node creation (tests use an isolated local DHT; production uses the public bootstrap nodes). */
  createDht?: DhtFactory;
  maxChannels?: number;
  connectTimeoutMs?: number;
  listenTimeoutMs?: number;
  /** Helpers reject large frame headers before buffering their payload; ordinary direct channels retain 8 MiB. */
  maxMessageBytes?: number;
}

interface Channel {
  stream: DhtStream;
  /** Who opened the connection: only host-owned (incoming) channels end with the host. */
  owner: 'incoming' | 'outgoing';
  /** Bytes handed to the stream whose write has not completed yet; bounded per channel. */
  pendingWriteBytes: number;
  writers: Set<(error: Error) => void>;
  buffer: Uint8Array[];
  bufferedBytes: number;
  expected: number;
  closed: boolean;
  connectTimer?: ReturnType<typeof setTimeout>;
}

function defaultDht(): DhtNode {
  const require = createRequire(__filename);
  const DHT = require('hyperdht');
  return new DHT() as DhtNode;
}

/** Streamx completion: resolves true once the writes queued so far were flushed, false if the stream was destroyed. */
function drained(stream: DhtStream): Promise<boolean> {
  const require = createRequire(__filename);
  const { Writable } = require('streamx') as { Writable: { drained(stream: unknown): Promise<boolean> } };
  return Writable.drained(stream);
}

function newKeyPair(): { publicKey: Uint8Array; secretKey: Uint8Array } {
  const require = createRequire(__filename);
  return require('hyperdht').keyPair() as { publicKey: Uint8Array; secretKey: Uint8Array };
}

function bindingOf(stream: DhtStream): Uint8Array {
  return new Uint8Array(crypto.createHash('sha256').update(stream.handshakeHash ?? new Uint8Array(0)).digest());
}

export class DirectService {
  private readonly channels = new Map<string, Channel>();
  private readonly tombstones = new Set<string>();
  private readonly draining = new Set<{ owner: Channel['owner']; done: Promise<void> }>();
  private readonly createDht: DhtFactory;
  private readonly maxChannels: number;
  private readonly connectTimeoutMs: number;
  private readonly listenTimeoutMs: number;
  private readonly maxMessageBytes: number;
  private readonly queries = new Set<{ node: DhtNode; cancel(): void }>();
  private startGeneration = 0;
  private cancelStart: (() => void) | null = null;
  private serverNode: DhtNode | null = null;
  private clientNode: DhtNode | null = null;
  private server: DhtServer | null = null;
  private serverKey: string | null = null;
  private serverKeyPair: { publicKey: Uint8Array; secretKey: Uint8Array } | null = null;
  private readonly announced = new Map<string, Uint8Array>();
  private starting: { generation: number; promise: Promise<{ publicKey: string }> } | null = null;
  private disposed = false;

  constructor(private readonly options: DirectServiceOptions) {
    this.createDht = options.createDht ?? defaultDht;
    this.maxChannels = options.maxChannels ?? DIRECT_MAX_CHANNELS;
    this.connectTimeoutMs = options.connectTimeoutMs ?? DIRECT_CONNECT_TIMEOUT_MS;
    this.listenTimeoutMs = options.listenTimeoutMs ?? DIRECT_LISTEN_TIMEOUT_MS;
    this.maxMessageBytes = Math.min(DIRECT_MAX_MESSAGE_BYTES, Math.max(1, options.maxMessageBytes ?? DIRECT_MAX_MESSAGE_BYTES));
  }

  async hostStart(): Promise<{ publicKey: string }> {
    if (this.disposed) throw new Error('DIRECT_DISPOSED');
    if (this.serverKey) return { publicKey: this.serverKey };
    // A start that hostStop() already cancelled is never reused: the restart gets its own generation and node.
    if (this.starting && this.starting.generation === this.startGeneration) return this.starting.promise;
    const generation = ++this.startGeneration;
    const record: { generation: number; promise: Promise<{ publicKey: string }> } = {
      generation,
      promise: this.startServer(generation).finally(() => { if (this.starting === record) this.starting = null; }),
    };
    this.starting = record;
    return record.promise;
  }

  private async startServer(generation: number): Promise<{ publicKey: string }> {
    const node = this.createDht();
    const server = node.createServer({ firewall: (_remotePublicKey, remoteHandshakePayload) => {
      // The supported firewall hook runs after Noise decoding and before HyperDHT dials a peer-supplied relay.
      // Our application relay uses ordinary streams, so neither a document host nor a helper needs blind relay dials.
      return remoteHandshakePayload.relayThrough != null;
    } }, stream => {
      if (this.disposed || generation !== this.startGeneration) { stream.on('error', () => undefined); stream.destroy(); return; }
      this.accept(stream);
    });
    const keyPair = newKeyPair();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const interrupted = new Promise<never>((_resolve, reject) => {
      this.cancelStart = () => reject(new Error('DIRECT_STOPPED'));
      timer = setTimeout(() => reject(new Error('DIRECT_LISTEN_TIMEOUT')), this.listenTimeoutMs);
    });
    interrupted.catch(() => undefined);
    const listening = server.listen(keyPair);
    listening.catch(() => undefined);
    try {
      await Promise.race([listening, interrupted]);
    } catch (error) {
      // Force-destroy first (that also ends a pending listen); never wait unboundedly for the server to close.
      await releaseNode(node, server);
      throw error;
    } finally {
      clearTimeout(timer);
      if (this.startGeneration === generation) this.cancelStart = null;
    }
    if (this.disposed || generation !== this.startGeneration) {
      await releaseNode(node, server);
      throw new Error('DIRECT_STOPPED');
    }
    this.serverNode = node;
    this.server = server;
    this.serverKeyPair = keyPair;
    this.serverKey = Buffer.from(keyPair.publicKey).toString('hex');
    return { publicKey: this.serverKey };
  }

  async hostStop(): Promise<void> {
    const pending = this.starting?.promise;
    this.startGeneration++;
    this.cancelStart?.();
    this.cancelStart = null;
    // Detach synchronously: a new start owns a new node, and old cleanup cannot clear or close it.
    const server = this.server;
    const node = this.serverNode;
    const keyPair = this.serverKeyPair;
    const topics = Array.from(this.announced.values());
    const draining = Array.from(this.draining).filter(entry => entry.owner === 'incoming').map(entry => entry.done);
    this.announced.clear();
    this.server = null;
    this.serverNode = null;
    this.serverKey = null;
    this.serverKeyPair = null;
    for (const query of Array.from(this.queries)) if (query.node === node) query.cancel();
    for (const [id, channel] of Array.from(this.channels)) if (channel.owner === 'incoming') this.finish(id, channel, 'HOST_STOPPED');
    if (node) {
      if (keyPair) {
        // Small sequential batches also bound teardown queries when advertisements outnumber the query budget.
        for (let at = 0; at < topics.length; at += DIRECT_MAX_QUERIES) {
          await Promise.all(topics.slice(at, at + DIRECT_MAX_QUERIES).map(topic => this.withdraw(node, keyPair, topic, DIRECT_UNANNOUNCE_TIMEOUT_MS)));
        }
      }
      await Promise.all(draining);
      await releaseNode(node, server);
    }
    await pending?.catch(() => undefined);
  }

  /** Public key (hex) of the running server, or null. */
  get hostKey(): string | null { return this.serverKey; }

  /** Advertises the running server's own key under a DHT topic. Bounded; resolves false when it could not be completed. */
  async announce(topic: Uint8Array, timeoutMs = DIRECT_ANNOUNCE_TIMEOUT_MS): Promise<boolean> {
    const node = this.serverNode;
    const keyPair = this.serverKeyPair;
    if (this.disposed || !node?.announce || !keyPair) return false;
    const key = Buffer.from(topic).toString('hex');
    if (!this.announced.has(key) && this.announced.size >= DIRECT_MAX_ADVERTISEMENTS) return false;
    this.announced.set(key, topic);
    return this.runQuery(node, () => {
      const query = node.announce!(topic, keyPair);
      return { work: query.finished(), destroy: () => query.destroy?.() };
    }, timeoutMs);
  }

  /** Withdraws one advertisement; best effort and bounded. */
  async unannounce(topic: Uint8Array, timeoutMs = DIRECT_ANNOUNCE_TIMEOUT_MS): Promise<void> {
    const node = this.serverNode;
    const keyPair = this.serverKeyPair;
    if (!node || !keyPair) return;
    const key = Buffer.from(topic).toString('hex');
    const previous = this.announced.get(key);
    const removed = await this.withdraw(node, keyPair, topic, timeoutMs);
    // Keep pending/failed withdrawals in the stop snapshot, and never erase a newer server's advertisement.
    if (removed && this.serverNode === node && this.announced.get(key) === previous) this.announced.delete(key);
  }

  private withdraw(node: DhtNode, keyPair: { publicKey: Uint8Array; secretKey: Uint8Array }, topic: Uint8Array, timeoutMs: number): Promise<boolean> {
    if (!node.lookupAndUnannounce && !node.unannounce) return Promise.resolve(false);
    return this.runQuery(node, () => {
      // Public HyperDHT API exposes the query handle, so timeout/opt-out cancels the actual network work.
      if (node.lookupAndUnannounce) {
        const query = node.lookupAndUnannounce(topic, keyPair);
        return { work: query.finished(), destroy: () => query.destroy?.() };
      }
      return { work: node.unannounce!(topic, keyPair) };
    }, timeoutMs);
  }

  /** One shared budget for lookup, announce and withdrawal, with cancellation settling every waiter. */
  private runQuery(node: DhtNode, start: () => { work: Promise<unknown>; destroy?(): void }, timeoutMs: number): Promise<boolean> {
    if (this.queries.size >= DIRECT_MAX_QUERIES) return Promise.resolve(false);
    return new Promise(resolve => {
      let settled = false;
      let destroy: (() => void) | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const entry = { node, cancel: () => finish(false) };
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.queries.delete(entry);
        try { destroy?.(); } catch { /* query already ended */ }
        resolve(ok);
      };
      this.queries.add(entry);
      timer = setTimeout(() => finish(false), timeoutMs);
      timer.unref?.();
      try {
        const operation = start();
        destroy = operation.destroy;
        operation.work.then(() => finish(true), () => finish(false));
        if (settled) { try { destroy?.(); } catch { /* cancelled during startup */ } }
      } catch { finish(false); }
    });
  }

  /** Public keys (hex) that advertise a topic. At most `limit` distinct keys and `timeoutMs` of querying. */
  async lookup(topic: Uint8Array, limit = 8, timeoutMs = DIRECT_LOOKUP_TIMEOUT_MS): Promise<string[]> {
    if (this.disposed) throw new Error('DIRECT_DISPOSED');
    if (!Number.isInteger(limit) || limit < 1 || limit > 16) throw new Error('DIRECT_INVALID_REQUEST');
    const node = this.clientNode ??= this.createDht();
    if (!node.lookup) return [];
    const found = new Set<string>();
    const own = this.serverKey;
    await this.runQuery(node, () => {
      const query = node.lookup!(topic);
      let active = true;
      const collect = (async () => {
        for await (const reply of query) {
          if (!active) break;
          for (const peer of reply.peers ?? []) {
            const key = Buffer.from(peer.publicKey).toString('hex');
            if (KEY_PATTERN.test(key) && key !== own && found.size < limit) found.add(key);
          }
          if (found.size >= limit) break;
        }
      })();
      return { work: collect, destroy: () => { active = false; query.destroy?.(); } };
    }, timeoutMs);
    return this.disposed ? [] : Array.from(found);
  }

  /** Bytes still queued for a channel; used by hubs to bound slow consumers. */
  pendingBytes(channelId: string): number { return this.channels.get(channelId)?.pendingWriteBytes ?? 0; }

  /** Starts an outgoing connection under a caller-chosen id; the outcome arrives as `open` or `close`. */
  connect(hostPublicKey: string, channelId: string): void {
    if (this.disposed) throw new Error('DIRECT_DISPOSED');
    if (!KEY_PATTERN.test(hostPublicKey) || !CHANNEL_ID_PATTERN.test(channelId)) throw new Error('DIRECT_INVALID_REQUEST');
    if (this.channels.has(channelId) || this.tombstones.has(channelId)) throw new Error('DIRECT_INVALID_REQUEST');
    if (this.channels.size + this.draining.size >= this.maxChannels) throw new Error('DIRECT_LIMIT');
    const node = this.clientNode ??= this.createDht();
    const pinned = Buffer.from(hostPublicKey, 'hex');
    const stream = node.connect(pinned, { keyPair: newKeyPair() });
    const channel = this.register(channelId, stream, 'outgoing');
    channel.connectTimer = setTimeout(() => this.finish(channelId, channel, 'CONNECT_TIMEOUT'), this.connectTimeoutMs);
    stream.once('open', () => {
      if (channel.closed) return;
      if (!crypto.timingSafeEqual(Buffer.from(stream.remotePublicKey), pinned)) { this.finish(channelId, channel, 'HOST_KEY_MISMATCH'); return; }
      clearTimeout(channel.connectTimer);
      channel.connectTimer = undefined;
      this.options.emit({ type: 'open', channelId, binding: bindingOf(stream) });
    });
  }

  /**
   * Resolves when the stream has actually flushed the message. The bytes of writes that are still in flight count
   * against a per-channel limit, so a peer that does not read cannot make this process buffer without bound.
   */
  send(channelId: string, data: Uint8Array): Promise<void> {
    const channel = this.channels.get(channelId);
    if (!channel || channel.closed || channel.connectTimer) return Promise.reject(new Error('DIRECT_NOT_OPEN'));
    if (!(data instanceof Uint8Array) || data.byteLength < 1 || data.byteLength > this.maxMessageBytes) return Promise.reject(new Error('DIRECT_MESSAGE_LIMIT'));
    const size = data.byteLength + 4;
    if (channel.pendingWriteBytes + size > DIRECT_MAX_PENDING_WRITE_BYTES) return Promise.reject(new Error('DIRECT_BACKPRESSURE'));
    const frame = new Uint8Array(size);
    new DataView(frame.buffer).setUint32(0, data.byteLength);
    frame.set(data, 4);
    channel.pendingWriteBytes += size;
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (error?: Error) => {
        if (settled) return;
        settled = true;
        channel.writers.delete(abort);
        channel.pendingWriteBytes -= size;
        if (error) reject(error); else resolve();
      };
      const abort = (error: Error) => settle(error);
      channel.writers.add(abort);
      try {
        channel.stream.write(frame);
        drained(channel.stream).then(ok => settle(ok ? undefined : new Error('DIRECT_CLOSED')), () => settle(new Error('DIRECT_WRITE_FAILED')));
      } catch (error) { settle(error instanceof Error ? error : new Error('DIRECT_WRITE_FAILED')); }
    });
  }

  close(channelId: string): void {
    const channel = this.channels.get(channelId);
    if (channel) this.finish(channelId, channel, 'CLOSED', true);
    else this.remember(channelId);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const query of Array.from(this.queries)) query.cancel();
    for (const [id, channel] of Array.from(this.channels)) this.finish(id, channel, 'DISPOSED');
    const client = this.clientNode;
    this.clientNode = null;
    await this.hostStop();
    await Promise.all(Array.from(this.draining, entry => entry.done));
    if (client) await releaseNode(client, null);
  }

  get channelCount(): number { return this.channels.size; }

  private accept(stream: DhtStream): void {
    if (this.disposed || this.channels.size + this.draining.size >= this.maxChannels) { stream.on('error', () => undefined); stream.destroy(); return; }
    const channelId = crypto.randomBytes(16).toString('hex');
    this.register(channelId, stream, 'incoming');
    this.options.emit({ type: 'incoming', channelId, binding: bindingOf(stream) });
  }

  private register(channelId: string, stream: DhtStream, owner: Channel['owner']): Channel {
    const channel: Channel = { stream, owner, pendingWriteBytes: 0, writers: new Set(), buffer: [], bufferedBytes: 0, expected: -1, closed: false };
    this.channels.set(channelId, channel);
    stream.on('data', (chunk: Uint8Array) => this.receive(channelId, channel, chunk));
    stream.on('error', () => undefined);
    stream.on('close', () => this.finish(channelId, channel, 'STREAM_CLOSED'));
    return channel;
  }

  private receive(channelId: string, channel: Channel, chunk: Uint8Array): void {
    if (channel.closed) return;
    channel.buffer.push(chunk);
    channel.bufferedBytes += chunk.byteLength;
    for (;;) {
      if (channel.expected < 0) {
        if (channel.bufferedBytes < 4) return;
        const header = take(channel, 4);
        channel.expected = new DataView(header.buffer, header.byteOffset, 4).getUint32(0);
        if (channel.expected < 1 || channel.expected > this.maxMessageBytes) { this.finish(channelId, channel, 'PROTOCOL_ERROR'); return; }
      }
      if (channel.bufferedBytes < channel.expected) return;
      const message = take(channel, channel.expected);
      channel.expected = -1;
      this.options.emit({ type: 'message', channelId, data: message });
      if (channel.closed) return;
    }
  }

  /** `graceful` ends the stream so data already written (a final refusal, a goodbye) reaches the peer before it is destroyed. */
  private finish(channelId: string, channel: Channel, reason: string, graceful = false): void {
    if (channel.closed) return;
    channel.closed = true;
    clearTimeout(channel.connectTimer);
    this.channels.delete(channelId);
    this.remember(channelId);
    channel.buffer = [];
    channel.bufferedBytes = 0;
    channel.expected = -1;
    for (const abort of Array.from(channel.writers)) abort(new Error('DIRECT_CLOSED'));
    if (graceful && channel.stream.end) {
      let resolve!: () => void;
      const entry = { owner: channel.owner, done: new Promise<void>(done => { resolve = done; }) };
      this.draining.add(entry);
      const finishDrain = () => { clearTimeout(timer); this.draining.delete(entry); resolve(); };
      const timer = setTimeout(() => {
        try { channel.stream.destroy(); } catch { /* already destroyed */ }
        finishDrain();
      }, DIRECT_GRACE_MS);
      timer.unref?.();
      channel.stream.once('close', finishDrain);
      try { channel.stream.end(); } catch { finishDrain(); }

    } else {
      try { channel.stream.destroy(); } catch { /* already destroyed */ }
    }
    this.options.emit({ type: 'close', channelId, reason });
  }

  private remember(channelId: string): void {
    this.tombstones.add(channelId);
    if (this.tombstones.size > MAX_TOMBSTONES) this.tombstones.delete(this.tombstones.values().next().value as string);
  }
}

/**
 * Force-destroys the node first (that also ends a pending listen) and never waits unboundedly for the server to close:
 * stopping must not hang on a DHT that does not answer.
 */
async function releaseNode(node: DhtNode, server: DhtServer | null): Promise<void> {
  const work = Promise.allSettled([node.destroy({ force: true }), server ? server.close() : Promise.resolve()]);
  await Promise.race([work, new Promise<void>(resolve => { setTimeout(resolve, DIRECT_RELEASE_TIMEOUT_MS).unref?.(); })]);
}

function take(channel: Channel, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let offset = 0;
  while (offset < length) {
    const head = channel.buffer[0]!;
    const need = length - offset;
    if (head.byteLength <= need) { out.set(head, offset); offset += head.byteLength; channel.buffer.shift(); }
    else { out.set(head.subarray(0, need), offset); channel.buffer[0] = head.subarray(need); offset += need; }
  }
  channel.bufferedBytes -= length;
  return out;
}
