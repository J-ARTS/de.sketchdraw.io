import { bytesToHex, MAX_MESSAGE_BYTES, randomBytes } from './codec';
import type { DirectBridge, DirectEvent, SecureChannel } from './types';

const PENDING_MESSAGE_LIMIT = 256;

class DirectChannel implements SecureChannel {
  readonly route = 'direct' as const;
  private handlers: { message(data: Uint8Array): void; close(reason: string): void } | null = null;
  private pending: Uint8Array[] = [];
  private pendingBytes = 0;
  private closedReason: string | null = null;
  private closeDelivered = false;

  constructor(readonly channelId: string, readonly binding: Uint8Array, private readonly bridge: DirectBridge, private readonly onClosed: () => void) {}

  attach(handlers: { message(data: Uint8Array): void; close(reason: string): void }): void {
    if (this.handlers) return;
    this.handlers = handlers;
    const queued = this.pending;
    this.pending = [];
    this.pendingBytes = 0;
    for (const message of queued) handlers.message(message);
    this.deliverClose();
  }

  send(message: Uint8Array): Promise<void> {
    if (this.closedReason !== null) return Promise.reject(new Error('CHANNEL_CLOSED'));
    if (message.byteLength < 1 || message.byteLength > MAX_MESSAGE_BYTES) return Promise.reject(new Error('TRANSPORT_MESSAGE_LIMIT'));
    return this.bridge.send(this.channelId, message);
  }

  close(reason = 'CLOSED'): void {
    if (this.closedReason !== null) return;
    this.closedReason = reason;
    void this.bridge.close(this.channelId).catch(() => undefined);
    this.onClosed();
    this.deliverClose();
  }

  receive(data: Uint8Array): void {
    if (this.closedReason !== null) return;
    if (this.handlers) { this.handlers.message(data); return; }
    this.pendingBytes += data.byteLength;
    if (this.pending.length >= PENDING_MESSAGE_LIMIT || this.pendingBytes > 2 * MAX_MESSAGE_BYTES) { this.close('INBOUND_BACKPRESSURE'); return; }
    this.pending.push(data);
  }

  remoteClosed(reason: string): void {
    if (this.closedReason !== null) return;
    this.closedReason = reason;
    this.onClosed();
    this.deliverClose();
  }

  private deliverClose(): void {
    if (!this.handlers || this.closedReason === null || this.closeDelivered) return;
    this.closeDelivered = true;
    this.handlers.close(this.closedReason);
  }
}

/** Routes the native bridge's events to per-connection channels of this window. */
export class DirectLink {
  private readonly channels = new Map<string, DirectChannel>();
  private readonly connecting = new Map<string, { resolve(channel: SecureChannel): void; reject(error: Error): void; abort(): void }>();
  private onIncoming: ((channel: SecureChannel) => void) | null = null;
  private off: () => void;
  private disposed = false;

  constructor(private readonly bridge: DirectBridge) {
    this.off = bridge.onEvent(event => this.route(event));
  }

  setIncomingHandler(handler: ((channel: SecureChannel) => void) | null): void { this.onIncoming = handler; }

  /** Connects to the pinned host key; `signal` aborts the attempt and releases the native stream. */
  connect(hostPublicKey: string, signal: AbortSignal): Promise<SecureChannel> {
    if (this.disposed) return Promise.reject(new Error('DIRECT_UNAVAILABLE'));
    if (signal.aborted) return Promise.reject(new Error('ABORTED'));
    const channelId = bytesToHex(randomBytes(16));
    return new Promise<SecureChannel>((resolve, reject) => {
      let allocated = false;
      let nativeClosed = false;
      const closeNative = () => {
        if (!allocated || nativeClosed) return;
        nativeClosed = true;
        void this.bridge.close(channelId).catch(() => undefined);
      };
      const cleanup = () => { signal.removeEventListener('abort', onAbort); this.connecting.delete(channelId); };
      const onAbort = () => { if (!this.connecting.has(channelId)) return; cleanup(); closeNative(); reject(new Error('ABORTED')); };
      this.connecting.set(channelId, {
        resolve: channel => { cleanup(); resolve(channel); },
        reject: error => { cleanup(); closeNative(); reject(error); },
        abort: () => { cleanup(); closeNative(); reject(new Error('ABORTED')); },
      });
      signal.addEventListener('abort', onAbort, { once: true });
      allocated = true;
      this.bridge.connect(hostPublicKey, channelId).catch(error => {
        if (this.connecting.has(channelId)) { cleanup(); reject(error instanceof Error ? error : new Error('DIRECT_UNAVAILABLE')); }
      });
    });
  }

  /** Helper candidates for a discovery request (service topic or one session); empty when none or unavailable. */
  async discover(request: Parameters<DirectBridge['discover']>[0]): Promise<string[]> {
    if (this.disposed) return [];
    try { return (await this.bridge.discover(request)).slice(0, 16); } catch { return []; }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.off();
    for (const pending of Array.from(this.connecting.values())) pending.abort();
    this.connecting.clear();
    for (const channel of Array.from(this.channels.values())) channel.close('DISPOSED');
    this.channels.clear();
  }

  private route(event: DirectEvent): void {
    if (this.disposed) return;
    if (event.type === 'incoming') {
      if (this.channels.has(event.channelId)) return;
      const channel = this.register(event.channelId, event.binding);
      if (this.onIncoming) this.onIncoming(channel); else channel.close('NOT_HOSTING');
      return;
    }
    if (event.type === 'open') {
      const pending = this.connecting.get(event.channelId);
      if (!pending || this.channels.has(event.channelId)) return;
      pending.resolve(this.register(event.channelId, event.binding));
      return;
    }
    if (event.type === 'message') { this.channels.get(event.channelId)?.receive(event.data); return; }
    const pending = this.connecting.get(event.channelId);
    if (pending) { pending.reject(new Error(event.reason || 'DIRECT_UNAVAILABLE')); return; }
    this.channels.get(event.channelId)?.remoteClosed(event.reason || 'CLOSED');
  }

  private register(channelId: string, binding: Uint8Array): DirectChannel {
    const channel = new DirectChannel(channelId, binding, this.bridge, () => this.channels.delete(channelId));
    this.channels.set(channelId, channel);
    return channel;
  }
}
