import {
  base64UrlToBytes, bytesToBase64Url, concatBytes, HANDSHAKE_TIMEOUT_MS, hexToBytes, MAX_MESSAGE_BYTES, MAX_RECORD_WIRE_BYTES, RECORD_PLAINTEXT_BYTES, randomBytes, sha256, utf8,
} from './codec';
import type { SecureChannel } from './types';

/*
 * End-to-end channel for the relay route (WebCrypto only, so it runs in browsers and the Electron renderer).
 *
 *   guest -> host : 0x01 | 0x01 | guestEphemeralX25519 (32) | guestNonce (16)
 *   host -> guest : 0x02 | hostEphemeralX25519 (32) | hostNonce (16) | Ed25519 signature (64)
 *
 * The host signs the transcript (label, session id, both messages) with the key pinned in the invitation. Keys come
 * from HKDF-SHA-256(ECDH secret, salt = transcript hash) with one AES-256-GCM key per direction. Each record uses a
 * strictly increasing counter nonce, so loss, replay, duplication and reordering by the relay fail authentication.
 * Every connection performs a fresh ephemeral exchange; nothing is reused across connections.
 */

const HANDSHAKE_LABEL = utf8.encode('sketchdraw-relay-hs-v1\0');
const KEY_INFO_C2S = utf8.encode('sketchdraw-relay-key-c2s-v1');
const KEY_INFO_S2C = utf8.encode('sketchdraw-relay-key-s2c-v1');
const RECORD_AAD = utf8.encode('sketchdraw-relay-record-v1');
const M1_TYPE = 0x01;
const M2_TYPE = 0x02;
const PROTOCOL_VERSION = 0x01;
const M1_BYTES = 2 + 32 + 16;
const M2_BYTES = 1 + 32 + 16 + 64;
const MAX_RECORDS = 2 ** 32;
const INBOUND_QUEUE_LIMIT_BYTES = 32 * 1024 * 1024;
const INBOUND_QUEUE_LIMIT_RECORDS = 1024;

export interface HostKeys {
  /** Raw Ed25519 public key (32 bytes). */
  readonly publicKey: Uint8Array;
  sign(data: Uint8Array): Promise<Uint8Array>;
}

export interface RecordWire {
  /** Resolves when `bytes` more may be written without exceeding the relay's rate and the socket buffer. */
  acquire?(bytes: number): Promise<void>;
  send(data: Uint8Array): void;
  bufferedAmount(): number;
  close(reason: string): void;
}

export async function relayCryptoSupported(): Promise<boolean> {
  try {
    await crypto.subtle.generateKey({ name: 'X25519' } as AlgorithmIdentifier, false, ['deriveBits']);
    await crypto.subtle.generateKey({ name: 'Ed25519' } as AlgorithmIdentifier, false, ['sign', 'verify']);
    return true;
  } catch { return false; }
}

export async function createHostKeys(): Promise<HostKeys> {
  let pair: CryptoKeyPair;
  try { pair = await crypto.subtle.generateKey({ name: 'Ed25519' } as AlgorithmIdentifier, false, ['sign', 'verify']) as CryptoKeyPair; }
  catch { throw new Error('CRYPTO_UNSUPPORTED'); }
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return Object.freeze({
    publicKey,
    async sign(data: Uint8Array): Promise<Uint8Array> {
      return new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' } as AlgorithmIdentifier, pair.privateKey, data as BufferSource));
    },
  });
}

export function hostKeyToText(keys: HostKeys): string { return bytesToBase64Url(keys.publicKey); }

export interface InboxLimits { maxBytes: number; maxMessages: number }
/** Before the handshake finished only two small control messages are expected; anything beyond is hostile or broken. */
const DEFAULT_INBOX_LIMITS: InboxLimits = { maxBytes: 1024 * 1024, maxMessages: 32 };

/**
 * Single-consumer inbox of the wire. Before the channel exists it buffers a bounded amount (bytes and count) for the
 * handshake; afterwards `handoff` routes everything, including a close, straight into the channel.
 */
export class WireInbox {
  private queue: Uint8Array[] = [];
  private queuedBytes = 0;
  private waiter: { resolve(data: Uint8Array): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> } | null = null;
  private failure: Error | null = null;
  private channel: RelayRecordChannel | null = null;

  constructor(private readonly limits: InboxLimits = DEFAULT_INBOX_LIMITS) {}

  push(data: Uint8Array): void {
    if (data.byteLength > MAX_RECORD_WIRE_BYTES) { this.queue = []; this.queuedBytes = 0; this.fail('RECORD_TOO_LARGE'); return; }
    if (this.channel) { this.channel.deliver(data); return; }
    if (this.failure) return;
    if (this.waiter) {
      const { resolve, timer } = this.waiter;
      this.waiter = null;
      clearTimeout(timer);
      resolve(data);
      return;
    }
    if (this.queue.length + 1 > this.limits.maxMessages || this.queuedBytes + data.byteLength > this.limits.maxBytes) {
      this.queue = [];
      this.queuedBytes = 0;
      this.fail('INBOUND_OVERFLOW');
      return;
    }
    this.queue.push(data);
    this.queuedBytes += data.byteLength;
  }

  fail(reason: string): void {
    if (this.channel) { this.channel.notifyClosed(reason); return; }
    this.failure ??= new Error(reason);
    if (this.waiter) {
      const { reject, timer } = this.waiter;
      this.waiter = null;
      clearTimeout(timer);
      reject(this.failure);
    }
  }

  get failed(): boolean { return this.failure !== null; }

  /** Throws the recorded failure; called after every asynchronous step of a handshake. */
  assertOpen(): void { if (this.failure) throw this.failure; }

  next(timeoutMs: number): Promise<Uint8Array> {
    const queued = this.queue.shift();
    if (queued) { this.queuedBytes -= queued.byteLength; return Promise.resolve(queued); }
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiter = null; reject(new Error('HANDSHAKE_TIMEOUT')); }, timeoutMs);
      this.waiter = { resolve, reject, timer };
    });
  }

  /** Gives everything buffered, and any failure that already happened, to the channel; later input goes there directly. */
  handoff(channel: RelayRecordChannel): void {
    this.channel = channel;
    const messages = this.queue;
    this.queue = [];
    this.queuedBytes = 0;
    for (const message of messages) channel.deliver(message);
    if (this.failure) channel.notifyClosed(this.failure.message);
  }

  /** Releases a waiter and buffers; used when the owner abandons the handshake. */
  dispose(reason = 'HANDSHAKE_ABORTED'): void {
    this.failure ??= new Error(reason);
    if (this.waiter) {
      const { reject, timer } = this.waiter;
      this.waiter = null;
      clearTimeout(timer);
      reject(this.failure);
    }
    this.queue = [];
    this.queuedBytes = 0;
  }
}

function transcriptBytes(sessionId: string, m1: Uint8Array, ephemeral: Uint8Array, nonce: Uint8Array): Uint8Array {
  return concatBytes(HANDSHAKE_LABEL, hexToBytes(sessionId), m1, ephemeral, nonce);
}

async function deriveRecordKeys(privateKey: CryptoKey, peerPublic: Uint8Array, transcriptHash: Uint8Array): Promise<{ c2s: CryptoKey; s2c: CryptoKey }> {
  const peer = await crypto.subtle.importKey('raw', peerPublic as BufferSource, { name: 'X25519' } as AlgorithmIdentifier, false, []);
  let secret: ArrayBuffer;
  try { secret = await crypto.subtle.deriveBits({ name: 'X25519', public: peer } as unknown as AlgorithmIdentifier, privateKey, 256); }
  catch { throw new Error('HANDSHAKE_INVALID'); }
  const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  const derive = (info: Uint8Array) => crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: transcriptHash as BufferSource, info: info as BufferSource },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
  return { c2s: await derive(KEY_INFO_C2S), s2c: await derive(KEY_INFO_S2C) };
}

async function generateEphemeral(): Promise<{ privateKey: CryptoKey; publicKey: Uint8Array }> {
  const pair = await crypto.subtle.generateKey({ name: 'X25519' } as AlgorithmIdentifier, false, ['deriveBits']) as CryptoKeyPair;
  return { privateKey: pair.privateKey, publicKey: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)) };
}

/** Guest side: connects to whoever answers on the wire and accepts them only if they prove the pinned host key. */
export async function initiateRelayChannel(wire: RecordWire, inbox: WireInbox, options: { sessionId: string; hostKey: string; timeoutMs?: number }): Promise<RelayRecordChannel> {
  const pinned = base64UrlToBytes(options.hostKey, 32);
  const ephemeral = await generateEphemeral();
  const m1 = concatBytes(Uint8Array.of(M1_TYPE, PROTOCOL_VERSION), ephemeral.publicKey, randomBytes(16));
  inbox.assertOpen();
  wire.send(m1);
  const m2 = await inbox.next(options.timeoutMs ?? HANDSHAKE_TIMEOUT_MS);
  inbox.assertOpen();
  if (m2.byteLength !== M2_BYTES || m2[0] !== M2_TYPE) throw new Error('HANDSHAKE_INVALID');
  const hostEphemeral = m2.subarray(1, 33);
  const hostNonce = m2.subarray(33, 49);
  const signature = m2.subarray(49, 113);
  const transcript = transcriptBytes(options.sessionId, m1, hostEphemeral, hostNonce);
  const verifyKey = await crypto.subtle.importKey('raw', pinned as BufferSource, { name: 'Ed25519' } as AlgorithmIdentifier, false, ['verify']);
  const valid = await crypto.subtle.verify({ name: 'Ed25519' } as AlgorithmIdentifier, verifyKey, signature as BufferSource, transcript as BufferSource);
  inbox.assertOpen();
  if (!valid) throw new Error('HOST_KEY_MISMATCH');
  const binding = await sha256(transcript);
  const keys = await deriveRecordKeys(ephemeral.privateKey, hostEphemeral, binding);
  inbox.assertOpen();
  const channel = new RelayRecordChannel({ binding, sendKey: keys.c2s, recvKey: keys.s2c, wire });
  inbox.handoff(channel);
  return channel;
}

/** Host side: answers the first wire message of a new guest connection. */
export async function acceptRelayChannel(wire: RecordWire, inbox: WireInbox, options: { sessionId: string; hostKeys: HostKeys; timeoutMs?: number }): Promise<RelayRecordChannel> {
  const m1 = await inbox.next(options.timeoutMs ?? HANDSHAKE_TIMEOUT_MS);
  inbox.assertOpen();
  if (m1.byteLength !== M1_BYTES || m1[0] !== M1_TYPE || m1[1] !== PROTOCOL_VERSION) throw new Error('HANDSHAKE_INVALID');
  const guestEphemeral = m1.subarray(2, 34);
  const ephemeral = await generateEphemeral();
  inbox.assertOpen();
  const nonce = randomBytes(16);
  const transcript = transcriptBytes(options.sessionId, m1, ephemeral.publicKey, nonce);
  const signature = await options.hostKeys.sign(transcript);
  inbox.assertOpen();
  const binding = await sha256(transcript);
  const keys = await deriveRecordKeys(ephemeral.privateKey, guestEphemeral, binding);
  inbox.assertOpen();
  wire.send(concatBytes(Uint8Array.of(M2_TYPE), ephemeral.publicKey, nonce, signature));
  const channel = new RelayRecordChannel({ binding, sendKey: keys.s2c, recvKey: keys.c2s, wire });
  inbox.handoff(channel);
  return channel;
}

function nonceFor(counter: number): Uint8Array {
  const nonce = new Uint8Array(12);
  const view = new DataView(nonce.buffer);
  view.setUint32(4, Math.floor(counter / 2 ** 32));
  view.setUint32(8, counter >>> 0);
  return nonce;
}

export class RelayRecordChannel implements SecureChannel {
  readonly route = 'relay' as const;
  readonly binding: Uint8Array;
  private readonly wire: RecordWire;
  private readonly sendKey: CryptoKey;
  private readonly recvKey: CryptoKey;
  private sendSeq = 0;
  private recvSeq = 0;
  private sendChain: Promise<void> = Promise.resolve();
  private recvChain: Promise<void> = Promise.resolve();
  private inboundBytes = 0;
  private inboundRecords = 0;
  private fragments: Uint8Array[] = [];
  private fragmentBytes = 0;
  private handlers: { message(data: Uint8Array): void; close(reason: string): void } | null = null;
  private pending: Uint8Array[] = [];
  private closedReason: string | null = null;
  private closeDelivered = false;

  constructor(options: { binding: Uint8Array; sendKey: CryptoKey; recvKey: CryptoKey; wire: RecordWire }) {
    this.binding = options.binding;
    this.sendKey = options.sendKey;
    this.recvKey = options.recvKey;
    this.wire = options.wire;
  }

  attach(handlers: { message(data: Uint8Array): void; close(reason: string): void }): void {
    if (this.handlers) return;
    this.handlers = handlers;
    const queued = this.pending;
    this.pending = [];
    for (const message of queued) handlers.message(message);
    this.deliverClose();
  }

  send(message: Uint8Array): Promise<void> {
    if (this.closedReason !== null) return Promise.reject(new Error('CHANNEL_CLOSED'));
    if (message.byteLength < 1 || message.byteLength > MAX_MESSAGE_BYTES) return Promise.reject(new Error('TRANSPORT_MESSAGE_LIMIT'));
    const run = this.sendChain.then(async () => {
      for (let offset = 0; offset < message.byteLength || offset === 0; offset += RECORD_PLAINTEXT_BYTES) {
        if (this.closedReason !== null) throw new Error('CHANNEL_CLOSED');
        if (this.sendSeq >= MAX_RECORDS) throw new Error('SEQUENCE_OVERFLOW');
        const chunk = message.subarray(offset, Math.min(message.byteLength, offset + RECORD_PLAINTEXT_BYTES));
        const last = offset + RECORD_PLAINTEXT_BYTES >= message.byteLength;
        const plain = concatBytes(Uint8Array.of(last ? 0 : 1), chunk);
        const iv = nonceFor(this.sendSeq++);
        const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: RECORD_AAD as BufferSource }, this.sendKey, plain as BufferSource));
        if (this.closedReason !== null) throw new Error('CHANNEL_CLOSED');
        if (this.wire.acquire) await this.wire.acquire(sealed.byteLength);
        if (this.closedReason !== null) throw new Error('CHANNEL_CLOSED');
        this.wire.send(sealed);
        if (last) break;
      }
    });
    this.sendChain = run.catch(() => undefined);
    run.catch(() => this.close('SEND_FAILED'));
    return run;
  }

  /** Feeds one wire message (one sealed record). */
  deliver(data: Uint8Array): void {
    if (this.closedReason !== null) return;
    if (data.byteLength > MAX_RECORD_WIRE_BYTES) { this.close('RECORD_TOO_LARGE'); return; }
    this.inboundBytes += data.byteLength;
    this.inboundRecords++;
    if (this.inboundBytes > INBOUND_QUEUE_LIMIT_BYTES || this.inboundRecords > INBOUND_QUEUE_LIMIT_RECORDS) { this.close('INBOUND_BACKPRESSURE'); return; }
    this.recvChain = this.recvChain.then(async () => {
      try {
        if (this.closedReason !== null) return;
        if (this.recvSeq >= MAX_RECORDS || data.byteLength < 17) throw new Error('RECORD_INVALID');
        const iv = nonceFor(this.recvSeq);
        const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: RECORD_AAD as BufferSource }, this.recvKey, data as BufferSource));
        // A local close during the asynchronous decryption must not still produce a message afterwards.
        if (this.closedReason !== null) return;
        this.recvSeq++;
        if (plain.byteLength < 1 || plain[0]! > 1) throw new Error('RECORD_INVALID');
        const chunk = plain.subarray(1);
        // Version 1 sends full continuation chunks and a nonempty final chunk. Besides rejecting malformed records,
        // this bounds the fragment array by the message limit; empty/tiny continuations cannot accumulate forever.
        if (chunk.byteLength < 1 || chunk.byteLength > RECORD_PLAINTEXT_BYTES || (plain[0] === 1 && chunk.byteLength !== RECORD_PLAINTEXT_BYTES)) throw new Error('RECORD_INVALID');
        this.fragmentBytes += chunk.byteLength;
        if (this.fragmentBytes > MAX_MESSAGE_BYTES) throw new Error('RECORD_TOO_LARGE');
        this.fragments.push(chunk);
        if (plain[0] === 0) {
          const message = concatBytes(...this.fragments);
          this.fragments = [];
          this.fragmentBytes = 0;
          if (message.byteLength < 1) throw new Error('RECORD_INVALID');
          this.emit(message);
        }
      } catch (error) {
        this.close(error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'RECORD_AUTH_FAILED');
      } finally {
        this.inboundBytes -= data.byteLength;
        this.inboundRecords--;
      }
    });
  }

  /** The wire closed underneath the channel. */
  notifyClosed(reason: string): void {
    // Records already received are processed first so a final message (e.g. a refusal) is not lost to the close.
    this.recvChain = this.recvChain.then(() => {
      if (this.closedReason !== null) return;
      this.closedReason = reason;
      this.fragments = [];
      this.fragmentBytes = 0;
      this.deliverClose();
    });
  }

  close(reason = 'CLOSED'): void {
    if (this.closedReason !== null) return;
    this.closedReason = reason;
    this.fragments = [];
    this.fragmentBytes = 0;
    try { this.wire.close(reason); } catch { /* the wire is already gone */ }
    this.deliverClose();
  }

  get wireBuffered(): number { return this.wire.bufferedAmount(); }

  private emit(message: Uint8Array): void {
    if (this.closedReason !== null) return;
    if (this.handlers) this.handlers.message(message); else this.pending.push(message);
  }

  private deliverClose(): void {
    if (!this.handlers || this.closedReason === null || this.closeDelivered) return;
    this.closeDelivered = true;
    this.handlers.close(this.closedReason);
  }
}
