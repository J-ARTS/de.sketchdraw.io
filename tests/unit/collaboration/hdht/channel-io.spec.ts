import { describe, expect, it } from 'vitest';
import { openChannelIo } from '../../../../src/collaboration/hdht/channel-io';
import { MESSAGE } from '../../../../src/collaboration/hdht/codec';
import type { SecureChannel } from '../../../../src/collaboration/hdht/types';

function fakeChannel(sendImpl: () => Promise<void>) {
  const state = { closed: [] as string[], handlers: null as null | { message(data: Uint8Array): void; close(reason: string): void } };
  const channel: SecureChannel = {
    route: 'relay', binding: new Uint8Array(32),
    send: sendImpl,
    attach(handlers) { state.handlers = handlers; },
    close(reason) { state.closed.push(reason ?? 'CLOSED'); },
  };
  return { channel, state };
}
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('channel io (R5)', () => {
  it('closes the underlying channel after a short deadline even if the goodbye write never completes', async () => {
    const { channel, state } = fakeChannel(() => new Promise<void>(() => undefined));
    const closes: string[] = [];
    const io = openChannelIo(channel, { message: () => undefined, close: reason => closes.push(reason) }, { heartbeatMs: 10_000, timeoutMs: 30_000, byeDeadlineMs: 30 });
    io.start();
    io.close('SESSION_ENDED');
    expect(io.closed).toBe(true);
    expect(closes).toEqual(['SESSION_ENDED']);
    expect(state.closed).toEqual([]);
    await wait(80);
    expect(state.closed).toEqual(['SESSION_ENDED']);
  });

  it('closes immediately when the goodbye write fails', async () => {
    const { channel, state } = fakeChannel(() => Promise.reject(new Error('gone')));
    const io = openChannelIo(channel, { message: () => undefined, close: () => undefined }, { heartbeatMs: 10_000, timeoutMs: 30_000 });
    io.start();
    io.close('KICKED');
    await wait(10);
    expect(state.closed).toEqual(['KICKED']);
  });

  it('ends a session whose heartbeat stops, even when the channel hangs on send', async () => {
    const { channel, state } = fakeChannel(() => new Promise<void>(() => undefined));
    const closes: string[] = [];
    openChannelIo(channel, { message: () => undefined, close: reason => closes.push(reason) }, { heartbeatMs: 10, timeoutMs: 40, byeDeadlineMs: 20 }).start();
    await wait(200);
    expect(closes).toEqual(['HEARTBEAT_TIMEOUT']);
    expect(state.closed).toEqual(['HEARTBEAT_TIMEOUT']);
  });

  it('consumes ping/pong, reports a peer goodbye with its reason token and hands application messages on', async () => {
    const { channel, state } = fakeChannel(() => Promise.resolve());
    const messages: number[] = [];
    const closes: string[] = [];
    openChannelIo(channel, { message: type => messages.push(type), close: reason => closes.push(reason) }, { heartbeatMs: 10_000, timeoutMs: 30_000 }).start();
    state.handlers!.message(Uint8Array.of(MESSAGE.pong));
    state.handlers!.message(Uint8Array.of(MESSAGE.sync, 1));
    state.handlers!.message(Uint8Array.from([MESSAGE.bye, ...new TextEncoder().encode('SESSION_ENDED')]));
    expect(messages).toEqual([MESSAGE.sync]);
    expect(closes).toEqual(['PEER_BYE:SESSION_ENDED']);
  });
});
