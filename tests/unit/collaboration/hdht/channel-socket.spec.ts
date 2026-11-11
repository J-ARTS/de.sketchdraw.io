import { afterEach, describe, expect, it, vi } from 'vitest';
import { channelSocketFactory } from '../../../../src/collaboration/hdht/channel-socket';
import type { SecureChannel, WebSocketLike } from '../../../../src/collaboration/hdht/types';

const sockets: WebSocketLike[] = [];
afterEach(() => { for (const socket of sockets.splice(0)) socket.close(); vi.useRealTimers(); });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

function channel(overrides: Partial<SecureChannel> = {}): SecureChannel {
  return { route: 'direct', binding: new Uint8Array(32), attach: () => {}, close: vi.fn(), send: vi.fn(async () => {}), ...overrides };
}

describe('native relay socket lifecycle (R26)', () => {
  it('does not open or start a keepalive after a queued close is replayed at attach', async () => {
    vi.useFakeTimers();
    const socket = channelSocketFactory(async () => channel({ attach: handlers => handlers.close('REMOTE_CLOSED') }))();
    sockets.push(socket);
    socket.onopen = vi.fn(); socket.onclose = vi.fn();
    await flush(); socket.close();
    expect(socket.readyState).toBe(3);
    expect(socket.onopen).not.toHaveBeenCalled();
    expect(socket.onclose).toHaveBeenCalledExactlyOnceWith({ code: 1006, reason: 'REMOTE_CLOSED' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts a pending connector and closes its late channel without attaching', async () => {
    let finish!: (value: SecureChannel) => void;
    let signal!: AbortSignal;
    const socket = channelSocketFactory(abort => { signal = abort; return new Promise(resolve => { finish = resolve; }); })();
    sockets.push(socket);
    socket.onopen = vi.fn(); socket.onclose = vi.fn();
    socket.close(1000, 'cancel');
    const late = channel({ attach: vi.fn() }); finish(late);
    await flush();
    expect(signal.aborted).toBe(true);
    expect(late.close).toHaveBeenCalledExactlyOnceWith('SOCKET_CLOSED');
    expect(late.attach).not.toHaveBeenCalled();
    expect(socket.onopen).not.toHaveBeenCalled();
    expect(socket.onclose).toHaveBeenCalledTimes(1);
  });

  it('handles a synchronous native send failure and releases keepalive and byte accounting', async () => {
    vi.useFakeTimers();
    const native = channel({ send: () => { throw new Error('DISPOSED'); } });
    const socket = channelSocketFactory(async () => native)(); sockets.push(socket);
    socket.onclose = vi.fn();
    await flush();
    socket.send('hello');
    expect(socket.readyState).toBe(3);
    expect(socket.bufferedAmount).toBe(0);
    expect(socket.onclose).toHaveBeenCalledExactlyOnceWith({ code: 1011, reason: 'send-failed' });
    expect(native.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('closes when buffered malformed text is replayed before onopen', async () => {
    vi.useFakeTimers();
    const native = channel({ attach: handlers => handlers.message(Uint8Array.of(0, 0xff)) });
    const socket = channelSocketFactory(async () => native)(); sockets.push(socket);
    socket.onopen = vi.fn(); socket.onclose = vi.fn();
    await flush();
    expect(socket.onopen).not.toHaveBeenCalled();
    expect(socket.onclose).toHaveBeenCalledExactlyOnceWith({ code: 1007, reason: 'bad-text' });
    expect(native.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
