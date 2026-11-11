import { frameMessage, MESSAGE, utf8 } from './codec';
import type { HdhtRoute, SecureChannel } from './types';

export interface ChannelTiming {
  heartbeatMs: number;
  timeoutMs: number;
  /** Longest time a local close waits for the goodbye message to be written (default 250 ms). */
  byeDeadlineMs?: number;
}

export interface ChannelIo {
  readonly route: HdhtRoute;
  readonly binding: Uint8Array;
  readonly closed: boolean;
  /** Resolves once the underlying channel was closed (after a best-effort goodbye, at most the bye deadline later). */
  readonly flushed: Promise<void>;
  /** Starts delivery. Messages and a close that already happened are replayed synchronously, so call it only after the owner's variables are set. */
  start(): void;
  send(type: number, body?: Uint8Array): Promise<void>;
  /** Closes locally; the peer is told with a `bye` carrying the reason token when it is a plain token. */
  close(reason?: string): void;
}

const REASON_TOKEN = /^[A-Z_]{1,40}$/;

/**
 * Typed message layer over a secure channel: heartbeat (ping/pong), idle detection and a one-shot close notification.
 * Pings, pongs and byes are consumed here; everything else is handed to `message`.
 */
export function openChannelIo(
  channel: SecureChannel,
  handlers: { message(type: number, body: Uint8Array): void; close(reason: string): void },
  timing: ChannelTiming,
): ChannelIo {
  let closed = false;
  let started = false;
  let markFlushed!: () => void;
  const flushed = new Promise<void>(resolve => { markFlushed = resolve; });
  let lastReceived = Date.now();
  const finish = (reason: string, local: boolean): void => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    if (local) {
      // Goodbye is best effort: the channel is closed after a short deadline even if the write never completes.
      const body = REASON_TOKEN.test(reason) ? utf8.encode(reason) : new Uint8Array(0);
      const deadline = setTimeout(() => { channel.close(reason); markFlushed(); }, timing.byeDeadlineMs ?? 250);
      const done = () => { clearTimeout(deadline); channel.close(reason); markFlushed(); };
      try { void channel.send(frameMessage(MESSAGE.bye, body)).then(done, done); } catch { done(); }
    } else { channel.close(reason); markFlushed(); }
    handlers.close(reason);
  };
  const io: { -readonly [K in keyof ChannelIo]: ChannelIo[K] } = {
    route: channel.route,
    binding: channel.binding,
    get closed() { return closed; },
    flushed,
    start: () => undefined,
    send(type, body) {
      if (closed) return Promise.reject(new Error('CHANNEL_CLOSED'));
      return channel.send(frameMessage(type, body));
    },
    close(reason = 'CLOSED') { finish(reason, true); },
  };
  const timer = setInterval(() => {
    if (Date.now() - lastReceived > timing.timeoutMs) finish('HEARTBEAT_TIMEOUT', true);
    else void io.send(MESSAGE.ping).catch(() => undefined);
  }, timing.heartbeatMs);
  io.start = () => {
    if (started) return;
    started = true;
    channel.attach({
        message(data) {
          if (closed || data.byteLength < 1) return;
          lastReceived = Date.now();
          const type = data[0]!;
          const body = data.subarray(1);
          if (type === MESSAGE.ping) { void io.send(MESSAGE.pong).catch(() => undefined); return; }
          if (type === MESSAGE.pong) return;
          if (type === MESSAGE.bye) {
            const token = new TextDecoder().decode(body.subarray(0, 40));
            finish(REASON_TOKEN.test(token) ? `PEER_BYE:${token}` : 'PEER_BYE', false);
            return;
          }
          handlers.message(type, body);
        },
        close(reason) { finish(reason, false); },
      });
  };
  return io;
}
