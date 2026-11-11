import { base64UrlToBytes, relayTopic } from './codec';
import { channelSocketFactory } from './channel-socket';
import type { DirectLink } from './direct-link';
import type { PacerOptions } from './relay-wire';
import { connectRelayGuest, RelayHostConnection } from './relay-wire';
import type { HostKeys, RelayRecordChannel } from './relay-channel';

/** Bounds of the decentralized relay selection; every query, candidate list and registration count is finite. */
export const PEER_RELAY_LIMITS = Object.freeze({
  guestCandidates: 4,
  guestConcurrency: 2,
  hostRegistrations: 2,
  hostCandidates: 6,
  attemptTimeoutMs: 8000,
  badTtlMs: 60_000,
});

/** Helpers that failed recently; they are skipped until the entry expires. */
export class BadHelpers {
  private readonly until = new Map<string, number>();
  constructor(private readonly ttlMs: number = PEER_RELAY_LIMITS.badTtlMs, private readonly now: () => number = Date.now) {}
  mark(key: string): void {
    this.until.delete(key);
    this.until.set(key, this.now() + this.ttlMs);
    if (this.until.size > 64) this.until.delete(this.until.keys().next().value!);
  }
  has(key: string): boolean {
    const expiry = this.until.get(key);
    if (expiry === undefined) return false;
    if (expiry <= this.now()) { this.until.delete(key); return false; }
    return true;
  }
}

function helperSocket(link: DirectLink, helperKey: string) {
  return channelSocketFactory(signal => link.connect(helperKey, signal));
}

function uniqueHelpers(keys: string[]): string[] {
  return [...new Set(keys)].filter(key => /^[0-9a-f]{64}$/.test(key));
}

/** Native queries have their own resource deadline; cancellation also releases the renderer's waiting owner. */
function discoverHelpers(link: DirectLink, request: Parameters<DirectLink['discover']>[0], signal: AbortSignal): Promise<string[]> {
  if (signal.aborted) return Promise.reject(new Error('ABORTED'));
  return new Promise((resolve, reject) => {
    let finished = false;
    const done = (keys: string[]) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(keys);
    };
    const onAbort = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(new Error('ABORTED'));
    };
    const timer = setTimeout(() => done([]), PEER_RELAY_LIMITS.attemptTimeoutMs);
    signal.addEventListener('abort', onAbort, { once: true });
    void Promise.resolve().then(() => signal.aborted ? [] : link.discover(request)).then(done, () => done([]));
  });
}

export interface HelperGuestOptions {
  link: DirectLink;
  sessionId: string;
  hostKey: string;
  signal: AbortSignal;
  bad: BadHelpers;
  pacer?: PacerOptions;
  /** Reports which helper candidates were tried (for diagnostics and tests). */
  onCandidate?(key: string, outcome: 'start' | 'failed' | 'won'): void;
}

/**
 * Finds the helpers that currently serve this session through the DHT and connects through the first one whose relay
 * leg and inner end-to-end handshake (pinned host key) succeed. Failing helpers are skipped and remembered.
 */
export async function connectViaHelpers(options: HelperGuestOptions): Promise<RelayRecordChannel> {
  const topic = await relayTopic(base64UrlToBytes(options.hostKey, 32));
  if (options.signal.aborted) throw new Error('ABORTED');
  const found = await discoverHelpers(options.link, { kind: 'session', topic }, options.signal);
  if (options.signal.aborted) throw new Error('ABORTED');
  const candidates = uniqueHelpers(found).filter(key => !options.bad.has(key)).slice(0, PEER_RELAY_LIMITS.guestCandidates);
  if (!candidates.length) throw new Error('NO_HELPER');
  const stop = new AbortController();
  return new Promise<RelayRecordChannel>((resolve, reject) => {
    let next = 0;
    let running = 0;
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      options.signal.removeEventListener('abort', onAbort);
      stop.abort();
      reject(new Error('ABORTED'));
    };
    options.signal.addEventListener('abort', onAbort, { once: true });
    if (options.signal.aborted) { onAbort(); return; }
    const launch = () => {
      while (!settled && running < PEER_RELAY_LIMITS.guestConcurrency && next < candidates.length) {
        const key = candidates[next++]!;
        running++;
        options.onCandidate?.(key, 'start');
        connectRelayGuest({
          socket: helperSocket(options.link, key),
          sessionId: options.sessionId,
          hostKey: options.hostKey,
          signal: stop.signal,
          timeoutMs: PEER_RELAY_LIMITS.attemptTimeoutMs,
          ...(options.pacer ? { pacer: options.pacer } : {}),
        }).then(channel => {
          running--;
          if (settled) { channel.close('LOST_RACE'); return; }
          settled = true;
          options.onCandidate?.(key, 'won');
          options.signal.removeEventListener('abort', onAbort);
          stop.abort();
          resolve(channel);
        }, () => {
          running--;
          if (settled) return;
          if (!options.signal.aborted) { options.bad.mark(key); options.onCandidate?.(key, 'failed'); }
          if (next >= candidates.length && running === 0) {
            settled = true;
            options.signal.removeEventListener('abort', onAbort);
            reject(new Error(options.signal.aborted ? 'ABORTED' : 'NO_HELPER'));
          } else launch();
        });
      }
    };
    launch();
  });
}

export interface PeerRelayHostsOptions {
  link: DirectLink;
  sessionId: string;
  hostKeys: HostKeys;
  onChannel(channel: RelayRecordChannel): void;
  onChange?(activeHelpers: number): void;
  target?: number;
  /** Time between discovery rounds while fewer than `target` helpers are registered. */
  retryMs?: number;
  /** Time between checks while the target is met (a lost helper is replaced after at most this long). */
  steadyMs?: number;
  pacer?: PacerOptions;
}

/**
 * Keeps a small, bounded number of registrations at volunteer helpers found through the DHT service topic. A helper
 * that refuses (full, wrong protocol) or drops is replaced by another candidate; nothing is configured by hand.
 */
export class PeerRelayHosts {
  private readonly active = new Map<string, RelayHostConnection>();
  private readonly starting = new Map<string, RelayHostConnection>();
  private readonly bad = new BadHelpers();
  private abort: AbortController | null = null;
  private generation = 0;
  private running = false;
  private wake: (() => void) | null = null;

  constructor(private readonly options: PeerRelayHostsOptions) {}

  get activeHelpers(): number { return this.active.size; }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.abort = new AbortController();
    void this.loop(++this.generation, this.abort.signal);
  }

  stop(): void {
    if (!this.running && !this.active.size && !this.starting.size) return;
    this.running = false;
    this.generation++;
    this.abort?.abort();
    this.abort = null;
    this.wake?.();
    this.wake = null;
    const connections = [...this.active.values(), ...this.starting.values()];
    this.active.clear();
    this.starting.clear();
    for (const connection of connections) connection.stop();
    this.options.onChange?.(0);
  }

  private current(generation: number): boolean { return this.running && this.generation === generation; }

  private async loop(generation: number, signal: AbortSignal): Promise<void> {
    const target = Math.max(1, Math.min(PEER_RELAY_LIMITS.hostRegistrations, Math.floor(this.options.target ?? PEER_RELAY_LIMITS.hostRegistrations) || 1));
    while (this.current(generation)) {
      if (this.active.size + this.starting.size < target) {
        let found: string[];
        try { found = await discoverHelpers(this.options.link, { kind: 'service' }, signal); } catch { return; }
        if (!this.current(generation)) return;
        const candidates = uniqueHelpers(found)
          .filter(key => !this.active.has(key) && !this.starting.has(key) && !this.bad.has(key))
          .slice(0, PEER_RELAY_LIMITS.hostCandidates);
        for (const key of candidates) {
          if (this.active.size + this.starting.size >= target) break;
          this.register(key, generation);
        }
      }
      if (!this.current(generation)) return;
      const delay = this.active.size >= target ? (this.options.steadyMs ?? 20_000) : (this.options.retryMs ?? 3000);
      let wake: () => void;
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, delay);
        wake = () => { clearTimeout(timer); resolve(); };
        this.wake = wake;
      });
      if (this.wake === wake!) this.wake = null;
    }
  }

  private register(key: string, generation: number): void {
    const connection: RelayHostConnection = new RelayHostConnection({
      socket: helperSocket(this.options.link, key),
      sessionId: this.options.sessionId,
      hostKeys: this.options.hostKeys,
      timeoutMs: PEER_RELAY_LIMITS.attemptTimeoutMs,
      reconnect: false,
      requireCapacity: 1,
      ...(this.options.pacer ? { pacer: this.options.pacer } : {}),
      onChannel: channel => {
        if (!this.current(generation) || this.active.get(key) !== connection) { channel.close('HOST_STOPPED'); return; }
        this.options.onChannel(channel);
      },
      onState: state => {
        if (state === 'ready' && this.current(generation) && this.starting.get(key) === connection) {
          this.starting.delete(key);
          this.active.set(key, connection);
          this.options.onChange?.(this.active.size);
        }
      },
      onEnded: () => {
        if (!this.current(generation)) return;
        if (this.active.get(key) !== connection && this.starting.get(key) !== connection) return;
        const wasActive = this.active.delete(key);
        this.starting.delete(key);
        this.bad.mark(key);
        if (wasActive) this.options.onChange?.(this.active.size);
        this.wake?.();
      },
    });
    this.starting.set(key, connection);
    connection.start();
  }
}
