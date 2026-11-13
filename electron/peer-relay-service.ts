import { createRelayHub, type HubConnection, type HubHandler, type RelayHub, type RelayHubLimits, serviceAdTopic, sessionAdTopic } from '../relay/hub.mjs';
import { type DhtFactory, DirectService, type DirectServiceEvent } from './direct-service';

/*
 * Volunteer peer relay (active for the lifetime of a session, #162). A native peer offers relay capacity to other peers:
 *  - it listens on HyperDHT under its OWN key pair (never a document host key) and advertises that key under a
 *    versioned service topic, so no registry, domain or fixed server is needed to find helpers;
 *  - after a host proved ownership of its session key, it advertises a per-session topic under its own key so guests
 *    find exactly the helpers that serve their session, and withdraws it when the host leaves;
 *  - it forwards only opaque, end-to-end encrypted records through the same bounded hub the WSS relay uses, so it
 *    learns neither the PIN nor drawing content.
 * It has no document authority; its owner stops it at session end, window exit or dispose.
 */

export interface HelperStatus {
  running: boolean;
  /** The service advertisement was published at least once. */
  announced: boolean;
  /** HyperDHT reports an external endpoint. This does not prove reachability from another network. */
  externalAddressKnown: boolean;
  connections: number;
  sessions: number;
  guests: number;
  forwardedRecords: number;
  error?: string;
}

export const HELPER_DEFAULT_LIMITS: Partial<RelayHubLimits> = Object.freeze({
  maxConnections: 48,
  maxTopics: 8,
  maxGuestsPerTopic: 24,
  aggregateBytesPerSecond: 12 * 1024 * 1024,
  aggregateByteBurst: 24 * 1024 * 1024,
});

export interface PeerRelayHelperOptions {
  createDht?: DhtFactory;
  limits?: Partial<RelayHubLimits>;
  /** Re-advertisement interval; DHT records expire, so a running helper refreshes them (bounded timer). */
  refreshMs?: number;
  startTimeoutMs?: number;
}

const FRAME_TEXT = 0;
const FRAME_BINARY = 1;
const encoder = new TextEncoder();

interface AdvertisementRun {
  generation: number;
  service: DirectService;
  revision: number;
  desired: Map<string, { topic: Uint8Array; revision: number }>;
  published: Map<string, { topic: Uint8Array; revision: number }>;
  work: Promise<void> | null;
}

export class PeerRelayHelper {
  private service: DirectService | null = null;
  private hub: RelayHub | null = null;
  private starting: { generation: number; promise: Promise<HelperStatus> } | null = null;
  private generation = 0;
  private announced = false;
  private lastError: string | undefined;
  private refreshTimer: ReturnType<typeof setInterval> | undefined;
  private advertisements: AdvertisementRun | null = null;
  private readonly handlers = new Map<string, { handler: HubHandler; open: boolean }>();

  constructor(private readonly options: PeerRelayHelperOptions = {}) {}

  /** Public key (hex) this helper is reachable under; separate from any document host key. */
  get keyHex(): string | null { return this.service?.hostKey ?? null; }

  status(): HelperStatus {
    const stats = this.hub?.stats();
    return {
      running: this.service?.hostKey != null,
      announced: this.announced,
      externalAddressKnown: this.service?.externalAddressKnown ?? false,
      connections: stats?.connections ?? 0,
      sessions: stats?.topics ?? 0,
      guests: stats?.guests ?? 0,
      forwardedRecords: stats?.forwardedRecords ?? 0,
      ...(this.lastError ? { error: this.lastError } : {}),
    };
  }

  start(): Promise<HelperStatus> {
    if (this.starting?.generation === this.generation) return this.starting.promise;
    if (this.service) return Promise.resolve(this.status());
    const generation = ++this.generation;
    const record = { generation, promise: this.run(generation).finally(() => { if (this.starting === record) this.starting = null; }) };
    this.starting = record;
    return record.promise;
  }

  private async run(generation: number): Promise<HelperStatus> {
    this.lastError = undefined;
    const hub = createRelayHub({
      limits: { ...HELPER_DEFAULT_LIMITS, ...(this.options.limits ?? {}) },
      onHostRegistered: topic => this.wantAdvertisement(generation, sessionAdTopic(topic), true),
      onHostGone: topic => this.wantAdvertisement(generation, sessionAdTopic(topic), false),
    });
    const service = new DirectService({
      emit: event => this.route(generation, event),
      ...(this.options.createDht ? { createDht: this.options.createDht } : {}),
      maxChannels: hub.limits.maxConnections,
      maxMessageBytes: hub.limits.maxRecordBytes + 1,
      listenTimeoutMs: this.options.startTimeoutMs ?? 15_000,
    });
    this.hub = hub;
    this.service = service;
    const advertisements: AdvertisementRun = { generation, service, revision: 0, desired: new Map(), published: new Map(), work: null };
    this.advertisements = advertisements;
    try {
      await service.hostStart();
    } catch (error) {
      if (generation === this.generation) {
        this.lastError = error instanceof Error ? error.message.slice(0, 80) : 'HELPER_START_FAILED';
        this.service = null; this.hub = null;
        this.advertisements = null;
      }
      hub.dispose();
      await service.dispose();
      return this.status();
    }
    if (generation !== this.generation) { hub.dispose(); await service.dispose(); return this.status(); }
    this.wantAdvertisement(generation, serviceAdTopic(), true);
    await advertisements.work;
    if (generation === this.generation) {
      this.refreshTimer = setInterval(() => this.refresh(generation), this.options.refreshMs ?? 4 * 60_000);
      this.refreshTimer.unref?.();
    }
    return this.status();
  }

  /** Opt-out / exit: withdraws advertisements, closes every relayed connection, destroys the DHT node. */
  async stop(): Promise<void> {
    const starting = this.starting;
    const advertisements = this.advertisements;
    this.generation++;
    clearInterval(this.refreshTimer);
    this.refreshTimer = undefined;
    const service = this.service;
    const hub = this.hub;
    this.service = null;
    this.hub = null;
    this.advertisements = null;
    this.announced = false;
    hub?.dispose();
    // Adapter close callbacks can be suppressed after detaching the generation; finish handlers explicitly as well.
    for (const entry of this.handlers.values()) { entry.open = false; entry.handler.closed(); }
    this.handlers.clear();
    await service?.dispose();
    await advertisements?.work;
    await starting?.promise.catch(() => undefined);
  }

  private refresh(generation: number): void {
    const run = this.advertisements;
    if (!run || generation !== this.generation || run.work) return;
    for (const [key, value] of run.desired) run.desired.set(key, { topic: value.topic, revision: ++run.revision });
    this.reconcile(run);
  }

  private wantAdvertisement(generation: number, topic: Uint8Array, wanted: boolean): void {
    const run = this.advertisements;
    if (!run || generation !== this.generation) return;
    const key = Buffer.from(topic).toString('hex');
    const revision = ++run.revision;
    if (wanted) run.desired.set(key, { topic, revision }); else run.desired.delete(key);
    this.reconcile(run);
  }

  /** Coalesces host churn into bounded desired state; only one DHT operation can run for this helper at a time. */
  private reconcile(run: AdvertisementRun): void {
    if (run.work) return;
    const current = () => this.advertisements === run && run.generation === this.generation;
    let processed = run.revision;
    const work = (async () => {
      do {
        const revision = run.revision;
        for (const [key, old] of run.published) {
          if (!current()) return;
          if (run.desired.has(key)) continue;
          await run.service.unannounce(old.topic);
          if (!current()) return;
          run.published.delete(key);
        }
        for (const [key, desired] of Array.from(run.desired)) {
          if (!current()) return;
          if (run.desired.get(key) !== desired || run.published.get(key)?.revision === desired.revision) continue;
          // Record the in-flight advertisement too: leaving while it finishes schedules its withdrawal next.
          run.published.set(key, desired);
          const ok = await run.service.announce(desired.topic);
          if (!current()) return;
          if (key === Buffer.from(serviceAdTopic()).toString('hex')) this.announced = ok || this.announced;
          // A failed query may have reached only some DHT nodes; retain it for a later withdrawal.
        }
        processed = revision;
        if (run.revision === revision) return;
      } while (current());
    })().catch(() => {
      if (current()) this.lastError = 'HELPER_DISCOVERY_FAILED';
      processed = run.revision;
    }).finally(() => {
      if (run.work === work) run.work = null;
      if (current() && run.revision !== processed) this.reconcile(run);
    });
    run.work = work;
  }

  private route(generation: number, event: DirectServiceEvent): void {
    const service = this.service;
    const hub = this.hub;
    if (generation !== this.generation || !service || !hub) return;
    if (event.type === 'incoming') {
      const entry = { handler: null as HubHandler | null, open: true };
      const conn: HubConnection = {
        send: (data, binary) => {
          if (!entry.open) return;
          const payload = typeof data === 'string' ? encoder.encode(data) : data;
          const frame = new Uint8Array(1 + payload.byteLength);
          frame[0] = binary ? FRAME_BINARY : FRAME_TEXT;
          frame.set(payload, 1);
          service.send(event.channelId, frame).catch(() => conn.close(1011, 'send-failed'));
        },
        bufferedAmount: () => service.pendingBytes(event.channelId),
        isOpen: () => entry.open,
        close: () => { entry.open = false; service.close(event.channelId); },
      };
      const handler = hub.accept(conn);
      if (!handler) { service.close(event.channelId); return; }
      entry.handler = handler;
      this.handlers.set(event.channelId, entry as { handler: HubHandler; open: boolean });
      return;
    }
    const entry = this.handlers.get(event.channelId);
    if (!entry) return;
    if (event.type === 'message') {
      const kind = event.data[0];
      if (kind !== FRAME_TEXT && kind !== FRAME_BINARY) { entry.open = false; service.close(event.channelId); return; }
      entry.handler.message(event.data.subarray(1), kind === FRAME_BINARY);
    } else if (event.type === 'close') {
      entry.open = false;
      this.handlers.delete(event.channelId);
      entry.handler.closed();
    }
  }
}
