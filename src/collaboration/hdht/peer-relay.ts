import { base64UrlToBytes, relayTopic } from './codec';
import { channelSocketFactory } from './channel-socket';
import type { DirectLink } from './direct-link';
import type { PacerOptions } from './relay-wire';
import { connectRelayGuest, RelayHostConnection } from './relay-wire';
import type { HostKeys, RelayRecordChannel } from './relay-channel';
import type { SecureChannel } from './types';

/** Bounds of the decentralized relay selection; every query, candidate list and registration count is finite. */
export const PEER_RELAY_LIMITS = Object.freeze({
  guestCandidates: 4,
  guestConcurrency: 2,
  hostRegistrations: 2,
  hostCandidates: 6,
  attemptTimeoutMs: 8000,
  badTtlMs: 60_000,
  discoveryMaxDelayMs: 60_000,
});

/** Helpers that failed recently; they are skipped until the entry expires. */
export class BadHelpers {
  private readonly until = new Map<string, number>();
  constructor(private readonly ttlMs: number = PEER_RELAY_LIMITS.badTtlMs, private readonly now: () => number = Date.now) {}
  clear(): void { this.until.clear(); }
  mark(key: string): void {
    this.until.delete(key);
    this.until.set(key, this.now() + this.ttlMs);
    if (this.until.size > 64) this.until.delete(this.until.keys().next().value!);
  }
  oldest(keys: string[]): string | undefined {
    return keys.reduce<string | undefined>((best, key) => !best || (this.until.get(key) ?? 0) < (this.until.get(best) ?? 0) ? key : best, undefined);
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

const helperChannels = new WeakMap<SecureChannel, { key: string; failed(): void }>();

/** A completed crypto handshake does not prove later application forwarding. Avoid retrying a silent winner. */
export function rejectHelperChannel(channel: SecureChannel, bad: BadHelpers): boolean {
  const helper = helperChannels.get(channel);
  if (!helper) return false;
  helperChannels.delete(channel);
  bad.mark(helper.key);
  helper.failed();
  return true;
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
  const unique = uniqueHelpers(found);
  const candidates = unique.filter(key => !options.bad.has(key)).slice(0, PEER_RELAY_LIMITS.guestCandidates);
  // A temporary host pause must not make a lone, otherwise healthy helper unusable for the full TTL.
  // The session's bounded retry/backoff still applies; prefer every fresh candidate before one old failure.
  if (!candidates.length) { const retry = options.bad.oldest(unique); if (retry) candidates.push(retry); }
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
          helperChannels.set(channel, { key, failed: () => options.onCandidate?.(key, 'failed') });
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
  /** Initial delay between unsuccessful discovery rounds; subsequent delays grow exponentially. */
  retryMs?: number;
  maxRetryMs?: number;
  /** Injectable jitter source for deterministic timer tests. */
  random?: () => number;
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
  private emptyRounds = 0;
  private lastDiscoveryAt = -Infinity;

  constructor(private readonly options: PeerRelayHostsOptions) {}

  get activeHelpers(): number { return this.active.size; }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.emptyRounds = 0;
    this.lastDiscoveryAt = -Infinity;
    this.bad.clear();
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
    const base = Math.max(1, this.options.retryMs ?? 3000);
    while (this.current(generation)) {
      if (this.active.size + this.starting.size < target) {
        // Even repeated short-lived registrations cannot turn wakeups into an unbounded lookup loop.
        let remaining: number;
        while ((remaining = base * 0.8 - (Date.now() - this.lastDiscoveryAt)) > 0) {
          await this.wait(remaining); if (!this.current(generation)) return;
        }
        this.lastDiscoveryAt = Date.now();
        let found: string[];
        try { found = await discoverHelpers(this.options.link, { kind: 'service' }, signal); } catch { return; }
        if (!this.current(generation)) return;
        const candidates = uniqueHelpers(found)
          .filter(key => !this.active.has(key) && !this.starting.has(key) && !this.bad.has(key))
          .slice(0, PEER_RELAY_LIMITS.hostCandidates);
        // Discovery output is untrusted: rotating Sybil keys must not reset backoff.
        this.emptyRounds = Math.min(16, this.emptyRounds + 1);
        for (const key of candidates) {
          if (this.active.size + this.starting.size >= target) break;
          this.register(key, generation);
        }
      }
      if (!this.current(generation)) return;
      const maximum = Math.max(base, this.options.maxRetryMs ?? PEER_RELAY_LIMITS.discoveryMaxDelayMs);
      const delay = this.active.size >= target ? (this.options.steadyMs ?? 20_000)
        : Math.min(maximum, base * 2 ** Math.max(0, this.emptyRounds - 1)) * (0.8 + 0.2 * (this.options.random ?? Math.random)());
      await this.wait(delay);
    }
  }

  private async wait(delay: number): Promise<void> {
    let wake: () => void;
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, delay);
      wake = () => { clearTimeout(timer); resolve(); };
      this.wake = wake;
    });
    if (this.wake === wake!) this.wake = null;
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
          this.emptyRounds = 0;
          this.options.onChange?.(this.active.size);
        }
      },
      onEnded: () => {
        if (!this.current(generation)) return;
        if (this.active.get(key) !== connection && this.starting.get(key) !== connection) return;
        const wasActive = this.active.delete(key);
        this.starting.delete(key);
        this.bad.mark(key);
        if (wasActive) {
          this.emptyRounds = 0;
          this.options.onChange?.(this.active.size);
          this.wake?.();
        }
      },
    });
    this.starting.set(key, connection);
    connection.start();
  }
}
