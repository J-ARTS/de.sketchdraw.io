import {
  base64UrlToBytes, bytesToBase64Url, bytesToHex, concatBytes, hexToBytes, hostProofMessage, relayTopic, RELAY_SUBPROTOCOL,
} from './codec';
import { acceptRelayChannel, initiateRelayChannel, type HostKeys, type RecordWire, type RelayRecordChannel, WireInbox } from './relay-channel';
import type { WebSocketFactory, WebSocketLike } from './types';

const OPEN = 1;
const GUEST_ID_BYTES = 16;
// POC(#303): the answer with the ICE servers of the TURN route is the largest control (several URLs and a credential).
const MAX_CONTROL_TEXT = 8192;
const MAX_HOST_GUESTS = 64;
/**
 * A host that waits for guests sends nothing by itself. A WebSocket relay that cannot ping from its side (a Cloudflare
 * Worker) and the proxies in front of it would close that silent connection, so the host says `ping` now and then.
 * Helper peers keep their own connection alive (channel-socket.ts).
 */
const HOST_KEEPALIVE_MS = 20_000;
const HOST_PING = JSON.stringify({ t: 'ping' });
/** POC(#303): asks the relay for the ICE servers of the TURN route. */
const ICE_REQUEST = JSON.stringify({ t: 'ice' });

interface IceWaiter { resolve(servers: unknown[]): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
/** Settles the oldest waiting request with the relay's answer; unknown shapes count as "no TURN". */
function settleIce(waiters: IceWaiter[], control: Record<string, unknown>): void {
  const waiter = waiters.shift();
  if (!waiter) return;
  clearTimeout(waiter.timer);
  if (Array.isArray(control['servers'])) waiter.resolve(control['servers']);
  else waiter.reject(new Error(typeof control['error'] === 'string' ? control['error'].slice(0, 40) : 'TURN_UNAVAILABLE'));
}
function failIce(waiters: IceWaiter[], reason: string): void {
  for (const waiter of waiters.splice(0)) { clearTimeout(waiter.timer); waiter.reject(new Error(reason)); }
}
function askIce(waiters: IceWaiter[], send: () => void, timeoutMs: number): Promise<unknown[]> {
  return new Promise<unknown[]>((resolve, reject) => {
    const waiter: IceWaiter = { resolve, reject, timer: setTimeout(() => { const at = waiters.indexOf(waiter); if (at >= 0) waiters.splice(at, 1); reject(new Error('TURN_TIMEOUT')); }, timeoutMs) };
    waiters.push(waiter);
    try { send(); } catch { const at = waiters.indexOf(waiter); if (at >= 0) waiters.splice(at, 1); clearTimeout(waiter.timer); reject(new Error('WIRE_CLOSED')); }
  });
}

export const defaultWebSocketFactory: WebSocketFactory = (url, protocols) => new WebSocket(url, protocols) as unknown as WebSocketLike;

const sleep = (ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(timer); reject(new Error('ABORTED')); };
  if (signal?.aborted) { onAbort(); return; }
  signal?.addEventListener('abort', onAbort, { once: true });
});

export interface PacerOptions {
  bytesPerSecond?: number;
  burstBytes?: number;
  messagesPerSecond?: number;
  burstMessages?: number;
  /** Largest amount the socket may hold unsent before the next record waits. */
  bufferLimitBytes?: number;
  stallTimeoutMs?: number;
}

/**
 * Keeps writes to one relay socket below the relay's own rate limits (slightly under, never above) and below a socket
 * buffer bound. All guests of a host share the host socket, so they share one pacer.
 */
export class WirePacer {
  private tokens: number;
  private messageTokens: number;
  private at = Date.now();
  private readonly signal: AbortController = new AbortController();
  private readonly o: Required<PacerOptions>;

  constructor(private readonly buffered: () => number, options: PacerOptions = {}) {
    this.o = {
      bytesPerSecond: options.bytesPerSecond ?? 3 * 1024 * 1024,
      burstBytes: options.burstBytes ?? 9 * 1024 * 1024,
      messagesPerSecond: options.messagesPerSecond ?? 150,
      burstMessages: options.burstMessages ?? 300,
      bufferLimitBytes: options.bufferLimitBytes ?? 2 * 1024 * 1024,
      stallTimeoutMs: options.stallTimeoutMs ?? 30_000,
    };
    this.tokens = this.o.burstBytes;
    this.messageTokens = this.o.burstMessages;
  }

  async acquire(bytes: number): Promise<void> {
    const started = Date.now();
    for (;;) {
      if (this.signal.signal.aborted) throw new Error('WIRE_CLOSED');
      const now = Date.now();
      const elapsed = (now - this.at) / 1000;
      this.at = now;
      this.tokens = Math.min(this.o.burstBytes, this.tokens + elapsed * this.o.bytesPerSecond);
      this.messageTokens = Math.min(this.o.burstMessages, this.messageTokens + elapsed * this.o.messagesPerSecond);
      if (this.tokens >= bytes && this.messageTokens >= 1 && this.buffered() <= this.o.bufferLimitBytes) {
        this.tokens -= bytes;
        this.messageTokens -= 1;
        return;
      }
      if (now - started > this.o.stallTimeoutMs) throw new Error('SEND_STALLED');
      const waitTokens = Math.max(((bytes - this.tokens) / this.o.bytesPerSecond) * 1000, ((1 - this.messageTokens) / this.o.messagesPerSecond) * 1000);
      await sleep(Math.min(250, Math.max(5, waitTokens)), this.signal.signal);
    }
  }

  close(): void { this.signal.abort(); }
}

interface SocketEvents {
  text(value: string): void;
  binary(value: Uint8Array): void;
  close(code: number | undefined, reason: string): void;
}

function openSocket(create: () => WebSocketLike, timeoutMs: number, signal: AbortSignal | undefined, events: SocketEvents): Promise<WebSocketLike> {
  return new Promise((resolve, reject) => {
    let socket: WebSocketLike;
    try { socket = create(); } catch { reject(new Error('RELAY_UNAVAILABLE')); return; }
    socket.binaryType = 'arraybuffer';
    let settled = false;
    let closeNotified = false;
    const timer = setTimeout(() => fail('RELAY_TIMEOUT'), timeoutMs);
    const onAbort = () => fail('ABORTED');
    const fail = (reason: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      detach(socket);
      try { socket.close(1000, 'abort'); } catch { /* already closed */ }
      reject(new Error(reason));
    };
    // A protocol violation closes the real socket, then reports the close exactly once.
    const violate = (code: number, reason: string) => {
      detach(socket);
      closeSocket(socket, reason);
      if (!closeNotified) { closeNotified = true; events.close(code, reason); }
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }
    socket.onopen = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(socket);
    };
    socket.onerror = () => fail('RELAY_UNAVAILABLE');
    socket.onmessage = event => {
      const data = event.data;
      if (typeof data === 'string') { if (data.length <= MAX_CONTROL_TEXT) events.text(data); else violate(1009, 'control-too-large'); return; }
      if (data instanceof ArrayBuffer) events.binary(new Uint8Array(data));
      else if (ArrayBuffer.isView(data)) events.binary(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    };
    socket.onclose = event => {
      if (!settled) { fail('RELAY_UNAVAILABLE'); return; }
      if (!closeNotified) { closeNotified = true; events.close(event.code, event.reason ?? ''); }
    };
  });
}

function detach(socket: WebSocketLike): void {
  socket.onopen = null; socket.onmessage = null; socket.onclose = null; socket.onerror = null;
}

function closeSocket(socket: WebSocketLike, reason: string): void {
  try { socket.close(1000, reason.slice(0, 100)); } catch { /* already closed */ }
}

function parseControl(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

/** Where a relay client connects: a WebSocket URL (WSS gateway) or any socket-like connection (e.g. a native helper peer). */
export interface RelaySocketSource {
  url?: string;
  factory?: WebSocketFactory;
  /** Opens a socket-like connection; takes precedence over `url`. */
  socket?: () => WebSocketLike;
}

function socketCreator(source: RelaySocketSource): () => WebSocketLike {
  if (source.socket) return source.socket;
  const url = source.url;
  if (!url) throw new Error('RELAY_UNAVAILABLE');
  const factory = source.factory ?? defaultWebSocketFactory;
  return () => factory(url, RELAY_SUBPROTOCOL);
}

export interface RelayGuestOptions extends RelaySocketSource {
  sessionId: string;
  hostKey: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  pacer?: PacerOptions;
}

/** A guest's joined connection to a relay room, before any handshake: raw records to and from the host. */
export interface RelayGuestWire {
  wire: RecordWire;
  inbox: WireInbox;
  /** POC(#303): asks the relay for the ICE servers of the TURN route. */
  requestIce(timeoutMs?: number): Promise<unknown[]>;
}

/** Opens the relay socket as a guest and joins the room of the pinned host key. */
export async function openRelayGuestWire(options: Omit<RelayGuestOptions, 'sessionId'>): Promise<RelayGuestWire> {
  const create = socketCreator(options);
  const timeoutMs = options.timeoutMs ?? 10_000;
  const topic = await relayTopic(base64UrlToBytes(options.hostKey, 32));
  const inbox = new WireInbox();
  const iceWaiters: IceWaiter[] = [];
  let ready: { resolve(): void; reject(error: Error): void } | null = null;
  const readyPromise = new Promise<void>((resolve, reject) => { ready = { resolve, reject }; });
  readyPromise.catch(() => undefined);
  let pacer: WirePacer | null = null;
  const socket = await openSocket(create, timeoutMs, options.signal, {
    text(value) {
      const control = parseControl(value);
      if (control?.['t'] === 'ready') ready?.resolve();
      else if (control?.['t'] === 'ice') settleIce(iceWaiters, control);
      else if (control?.['t'] === 'error') ready?.reject(new Error(String(control['code'] ?? 'RELAY_ERROR').slice(0, 40)));
    },
    binary(value) { inbox.push(value); },
    close(_code, reason) {
      ready?.reject(new Error(reason ? `RELAY_CLOSED:${reason.slice(0, 40)}` : 'RELAY_CLOSED'));
      inbox.fail(reason ? `RELAY_CLOSED:${reason.slice(0, 40)}` : 'RELAY_CLOSED');
      failIce(iceWaiters, 'RELAY_CLOSED');
      pacer?.close();
    },
  });
  pacer = new WirePacer(() => socket.bufferedAmount, options.pacer);
  const wire: RecordWire = {
    acquire: bytes => pacer!.acquire(bytes),
    send: data => { if (socket.readyState !== OPEN) throw new Error('WIRE_CLOSED'); socket.send(data); },
    bufferedAmount: () => socket.bufferedAmount,
    close: reason => { pacer?.close(); failIce(iceWaiters, 'WIRE_CLOSED'); detach(socket); closeSocket(socket, reason); },
  };
  const abandon = (error: Error) => { inbox.dispose(error.message); wire.close(error.message); };
  const onAbort = () => abandon(new Error('ABORTED'));
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    socket.send(JSON.stringify({ t: 'guest', topic }));
    await withTimeout(readyPromise, timeoutMs, options.signal);
    options.signal?.removeEventListener('abort', onAbort);
    return { wire, inbox, requestIce: (ms = timeoutMs) => askIce(iceWaiters, () => { if (socket.readyState !== OPEN) throw new Error('WIRE_CLOSED'); socket.send(ICE_REQUEST); }, ms) };
  } catch (error) {
    options.signal?.removeEventListener('abort', onAbort);
    abandon(error instanceof Error ? error : new Error('RELAY_FAILED'));
    throw error;
  }
}

/** Opens the relay socket as a guest and completes the end-to-end handshake against the pinned host key. */
export async function connectRelayGuest(options: RelayGuestOptions): Promise<RelayRecordChannel> {
  const { wire, inbox } = await openRelayGuestWire(options);
  const abandon = (error: Error) => { inbox.dispose(error.message); wire.close(error.message); };
  const onAbort = () => abandon(new Error('ABORTED'));
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    if (options.signal?.aborted) throw new Error('ABORTED');
    // The socket lives as long as the channel: a channel close (local or remote) must close the socket too.
    return await initiateRelayChannel(wire, inbox, { sessionId: options.sessionId, hostKey: options.hostKey, timeoutMs: options.timeoutMs ?? 10_000 });
  } catch (error) {
    abandon(error instanceof Error ? error : new Error('RELAY_FAILED'));
    throw error;
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error('RELAY_TIMEOUT')), ms);
    const onAbort = () => done(new Error('ABORTED'));
    const done = (error?: Error, value?: T) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error); else resolve(value as T);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }
    promise.then(value => done(undefined, value), error => done(error instanceof Error ? error : new Error('RELAY_FAILED')));
  });
}

export type RelayHostState = 'connecting' | 'ready' | 'backoff' | 'closed';

export interface RelayHostOptions extends RelaySocketSource {
  sessionId: string;
  hostKeys: HostKeys;
  timeoutMs?: number;
  /** false: a single registration; when it ends the connection stops and reports through `onEnded` (helper peers). */
  reconnect?: boolean;
  /** The relay must announce at least this much guest capacity in `ready` (helper validation). */
  requireCapacity?: number;
  onEnded?(reason: string): void;
  /** Delays between registration attempts; the last value repeats. */
  backoffMs?: readonly number[];
  pacer?: PacerOptions;
  /** Interval of the keep-alive of a WebSocket registration; defaults to HOST_KEEPALIVE_MS. */
  keepAliveMs?: number;
  /**
   * POC(#303): replaces the end-to-end handshake on the relay socket. The TURN route negotiates a WebRTC data channel
   * over the given wire and completes the handshake on that channel, which then lives apart from the relay socket.
   */
  acceptGuest?(wire: RecordWire, inbox: WireInbox): Promise<RelayRecordChannel>;
  onChannel(channel: RelayRecordChannel): void;
  onState?(state: RelayHostState, detail?: string): void;
}

/** Keeps one host registration alive at the relay and turns every joining guest into an end-to-end channel. */
export class RelayHostConnection {
  private readonly abort = new AbortController();
  private running = false;
  private socket: WebSocketLike | null = null;
  private endActive: ((reason: string) => void) | null = null;
  private state: RelayHostState = 'closed';
  private readonly iceWaiters: IceWaiter[] = [];

  constructor(private readonly options: RelayHostOptions) {}

  /** POC(#303): asks the relay for the ICE servers of the TURN route over the current registration. */
  requestIce(timeoutMs = 10_000): Promise<unknown[]> {
    return askIce(this.iceWaiters, () => {
      const socket = this.socket;
      if (!socket || socket.readyState !== OPEN || this.state !== 'ready') throw new Error('WIRE_CLOSED');
      socket.send(ICE_REQUEST);
    }, timeoutMs);
  }

  get currentState(): RelayHostState { return this.state; }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop(): void {
    this.running = false;
    this.abort.abort();
    this.endActive?.('HOST_STOPPED');
    const socket = this.socket;
    this.socket = null;
    if (socket) { detach(socket); closeSocket(socket, 'host-stop'); }
    this.setState('closed');
  }

  private setState(state: RelayHostState, detail?: string): void {
    this.state = state;
    this.options.onState?.(state, detail);
  }

  private async loop(): Promise<void> {
    const backoff = this.options.backoffMs ?? [500, 1000, 2000, 4000, 8000, 15_000, 30_000];
    let failures = 0;
    while (this.running) {
      this.setState('connecting');
      let reason = 'RELAY_CLOSED';
      try {
        reason = await this.session(() => { failures = 0; });
      } catch (error) {
        reason = error instanceof Error ? error.message : 'RELAY_FAILED';
      }
      if (!this.running) return;
      if (this.options.reconnect === false) { this.running = false; this.setState('closed', reason); this.options.onEnded?.(reason); return; }
      if (reason === 'REPLACED') { this.running = false; this.setState('closed', reason); return; }
      const delay = backoff[Math.min(failures, backoff.length - 1)]!;
      failures++;
      this.setState('backoff', reason);
      try { await sleep(delay + Math.floor(Math.random() * delay * 0.2), this.abort.signal); } catch { return; }
    }
  }

  /** One registration; resolves with the reason it ended. */
  private session(onReady: () => void): Promise<string> {
    const { sessionId, hostKeys, onChannel } = this.options;
    const create = socketCreator(this.options);
    const timeoutMs = this.options.timeoutMs ?? 10_000;
    const guests = new Map<string, WireInbox>();
    return new Promise<string>((resolve, reject) => {
      let socketRef: WebSocketLike | null = null;
      let pacer: WirePacer | null = null;
      let ended = false;
      let registered = false;
      let topicHex = '';
      let readyTimer: ReturnType<typeof setTimeout> | null = null;
      let keepAlive: ReturnType<typeof setInterval> | undefined;
      const end = (reason: string) => {
        if (ended) return;
        ended = true;
        if (readyTimer) clearTimeout(readyTimer);
        clearInterval(keepAlive);
        pacer?.close();
        failIce(this.iceWaiters, 'RELAY_CLOSED');
        for (const inbox of guests.values()) inbox.fail(reason);
        guests.clear();
        if (socketRef) { detach(socketRef); closeSocket(socketRef, reason); }
        if (this.socket === socketRef) this.socket = null;
        if (this.endActive === end) this.endActive = null;
        resolve(reason);
      };
      this.endActive = end;
      const spawnGuest = (idHex: string) => {
        if (guests.size >= MAX_HOST_GUESTS || guests.has(idHex) || !socketRef) return;
        const socket = socketRef;
        const inbox = new WireInbox();
        guests.set(idHex, inbox);
        const id = hexToBytes(idHex);
        const wire: RecordWire = {
          acquire: bytes => pacer!.acquire(bytes + GUEST_ID_BYTES),
          send: data => { if (socket.readyState !== OPEN || ended) throw new Error('WIRE_CLOSED'); socket.send(concatBytes(id, data)); },
          bufferedAmount: () => socket.bufferedAmount,
          close: () => { if (guests.get(idHex) === inbox) { guests.delete(idHex); if (socket.readyState === OPEN) socket.send(id); } },
        };
        const acceptGuest = this.options.acceptGuest;
        if (acceptGuest) {
          // POC(#303): the channel runs over its own carrier; the relay socket of this guest was only the way there
          // and is closed either way, so a channel is kept as long as the host itself is still running.
          acceptGuest(wire, inbox).then(
            channel => { inbox.dispose('SIGNALLING_DONE'); wire.close('SIGNALLING_DONE'); if (this.running) onChannel(channel); else channel.close('HOST_STOPPED'); },
            () => { inbox.dispose('HANDSHAKE_FAILED'); wire.close('HANDSHAKE_FAILED'); },
          );
          return;
        }
        acceptRelayChannel(wire, inbox, { sessionId, hostKeys, timeoutMs }).then(
          channel => { if (guests.get(idHex) === inbox) onChannel(channel); else channel.close('GUEST_GONE'); },
          () => { inbox.dispose('HANDSHAKE_FAILED'); wire.close('HANDSHAKE_FAILED'); },
        );
      };
      const text = (value: string) => {
        const control = parseControl(value);
        if (!control) return;
        const socket = socketRef;
        if (!socket) return;
        if (control['t'] === 'challenge' && !registered && typeof control['nonce'] === 'string' && /^[0-9a-f]{64}$/.test(control['nonce'])) {
          void hostKeys.sign(hostProofMessage(topicHex, hexToBytes(control['nonce']))).then(signature => {
            if (!ended && socket.readyState === OPEN) socket.send(JSON.stringify({ t: 'proof', sig: bytesToBase64Url(signature) }));
          }, () => end('SIGN_FAILED'));
        } else if (control['t'] === 'ready' && !registered) {
          const need = this.options.requireCapacity;
          if (need !== undefined && !(typeof control['capacity'] === 'number' && control['capacity'] >= need)) { end('HELPER_CAPACITY'); return; }
          registered = true;
          if (readyTimer) clearTimeout(readyTimer);
          if (!this.options.socket) {
            keepAlive = setInterval(() => {
              if (ended || socket.readyState !== OPEN) return;
              try { socket.send(HOST_PING); } catch { /* the close event ends the registration */ }
            }, this.options.keepAliveMs ?? HOST_KEEPALIVE_MS);
          }
          pacer = new WirePacer(() => socket.bufferedAmount, this.options.pacer);
          this.setState('ready');
          onReady();
        } else if (control['t'] === 'guest-join' && registered && typeof control['id'] === 'string' && /^[0-9a-f]{32}$/.test(control['id'])) {
          spawnGuest(control['id']);
        } else if (control['t'] === 'guest-leave' && typeof control['id'] === 'string') {
          const inbox = guests.get(control['id']);
          guests.delete(control['id']);
          inbox?.fail('GUEST_LEFT');
        } else if (control['t'] === 'ice') {
          settleIce(this.iceWaiters, control);
        } else if (control['t'] === 'replaced') {
          end('REPLACED');
        }
      };
      const binary = (value: Uint8Array) => {
        if (!registered || value.byteLength <= GUEST_ID_BYTES) return;
        guests.get(bytesToHex(value.subarray(0, GUEST_ID_BYTES)))?.push(value.subarray(GUEST_ID_BYTES));
      };
      void relayTopic(hostKeys.publicKey).then(topic => {
        topicHex = topic;
        return openSocket(create, timeoutMs, this.abort.signal, {
          text,
          binary,
          close: (code, reason) => end(code === 4409 ? 'REPLACED' : reason ? `RELAY_CLOSED:${reason.slice(0, 40)}` : 'RELAY_CLOSED'),
        });
      }).then(socket => {
        if (ended || !this.running) { detach(socket); closeSocket(socket, 'stopped'); end('STOPPED'); return; }
        socketRef = socket;
        this.socket = socket;
        readyTimer = setTimeout(() => end('REGISTRATION_TIMEOUT'), timeoutMs);
        socket.send(JSON.stringify({ t: 'host', topic: topicHex, key: bytesToBase64Url(hostKeys.publicKey) }));
      }).catch(error => { if (!ended) { ended = true; reject(error); } });
    });
  }
}
