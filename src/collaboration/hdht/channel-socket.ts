import { MAX_MESSAGE_BYTES } from './codec';
import type { SecureChannel, WebSocketLike } from './types';

/*
 * Presents a native, already Noise-encrypted HyperDHT channel to a helper peer as the socket the relay client speaks.
 * Every message carries one kind byte (0 = JSON control text, 1 = binary record), so the same relay protocol and the
 * same inner end-to-end channel (host proof, key exchange, PIN) run over a volunteer peer as over a WSS gateway.
 */

const KIND_TEXT = 0;
const KIND_BINARY = 1;
const KEEPALIVE_MS = 20_000;
const PING = new TextEncoder().encode(JSON.stringify({ t: 'ping' }));
const decoder = new TextDecoder('utf-8', { fatal: true });

export type ChannelConnector = (signal: AbortSignal) => Promise<SecureChannel>;

class ChannelSocket implements WebSocketLike {
  binaryType = 'arraybuffer';
  readyState = 0;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  private pending = 0;
  private channel: SecureChannel | null = null;
  private keepAlive: ReturnType<typeof setInterval> | undefined;
  private readonly abort = new AbortController();
  private closeNotified = false;

  constructor(connect: ChannelConnector) {
    void this.open(connect);
  }

  private async open(connect: ChannelConnector): Promise<void> {
    try {
      const channel = await connect(this.abort.signal);
      if (this.readyState !== 0) { channel.close('SOCKET_CLOSED'); return; }
      this.channel = channel;
      this.readyState = 1;
      channel.attach({
        message: data => this.receive(data),
        close: reason => this.finish(1006, reason),
      });
      // attach replays queued close/messages synchronously. Those callbacks may already have closed us.
      if (this.readyState !== 1 || this.channel !== channel) return;
      this.keepAlive = setInterval(() => { void this.write(KIND_TEXT, PING); }, KEEPALIVE_MS);
      this.onopen?.({});
    } catch {
      if (this.readyState === 3) return;
      this.onerror?.({});
      this.close(1011, 'connect-failed');
    }
  }

  get bufferedAmount(): number { return this.pending; }

  send(data: string | Uint8Array): void {
    if (this.readyState !== 1) throw new Error('WIRE_CLOSED');
    if (typeof data === 'string') void this.write(KIND_TEXT, new TextEncoder().encode(data));
    else void this.write(KIND_BINARY, data);
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === 3) return;
    const channel = this.channel;
    this.finish(code, reason);
    channel?.close(reason ? 'LOCAL_CLOSE' : 'CLOSED');
  }

  private write(kind: number, payload: Uint8Array): Promise<void> {
    const channel = this.channel;
    if (this.readyState !== 1 || !channel) return Promise.resolve();
    if (payload.byteLength + 1 > MAX_MESSAGE_BYTES) { this.close(1009, 'too-large'); return Promise.resolve(); }
    const frame = new Uint8Array(1 + payload.byteLength);
    frame[0] = kind;
    frame.set(payload, 1);
    this.pending += frame.byteLength;
    let sending: Promise<void>;
    try { sending = channel.send(frame); } catch {
      this.pending -= frame.byteLength;
      this.close(1011, 'send-failed');
      return Promise.resolve();
    }
    return sending.then(() => undefined, () => { this.close(1011, 'send-failed'); }).finally(() => { this.pending -= frame.byteLength; });
  }

  private receive(data: Uint8Array): void {
    if (this.readyState !== 1 || data.byteLength < 1) return;
    const body = data.subarray(1);
    if (data[0] === KIND_TEXT) {
      let text: string;
      try { text = decoder.decode(body); } catch { this.close(1007, 'bad-text'); return; }
      this.onmessage?.({ data: text });
    } else if (data[0] === KIND_BINARY) {
      this.onmessage?.({ data: Uint8Array.from(body).buffer });
    } else this.close(1002, 'bad-frame');
  }

  private finish(code: number, reason: string): void {
    this.readyState = 3;
    this.channel = null;
    clearInterval(this.keepAlive);
    this.keepAlive = undefined;
    this.abort.abort();
    if (this.closeNotified) return;
    this.closeNotified = true;
    this.onclose?.({ code, reason: reason.slice(0, 40) });
  }
}

/** A factory for the relay client: each call opens a fresh connection through `connect`. */
export function channelSocketFactory(connect: ChannelConnector): () => WebSocketLike {
  return () => new ChannelSocket(connect);
}
