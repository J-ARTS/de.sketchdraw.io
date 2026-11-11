import { describe, expect, it } from 'vitest';
import { DirectLink } from '../../../../src/collaboration/hdht/direct-link';
import type { DirectBridge, DirectEvent } from '../../../../src/collaboration/hdht/types';

function mockBridge(options: { connect?: (id: string) => Promise<void> } = {}) {
  const listeners = new Set<(event: DirectEvent) => void>();
  const calls = { connect: [] as string[], close: [] as string[], send: [] as string[] };
  const bridge: DirectBridge = {
    hostStart: async () => ({ publicKey: 'a'.repeat(64) }),
    hostStop: async () => undefined,
    connect: (_key, id) => { calls.connect.push(id); return options.connect ? options.connect(id) : Promise.resolve(); },
    send: async id => { calls.send.push(id); },
    close: async id => { calls.close.push(id); },
    discover: async () => [],
    onEvent: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  };
  const emit = (event: DirectEvent) => { for (const listener of Array.from(listeners)) listener(event); };
  return { bridge, calls, emit, listeners };
}
const binding = new Uint8Array(32).fill(3);
const KEY = 'b'.repeat(64);

describe('DirectLink (R5)', () => {
  it('releases the native stream of a pending connect on abort', async () => {
    const { bridge, calls } = mockBridge();
    const link = new DirectLink(bridge);
    const controller = new AbortController();
    const pending = link.connect(KEY, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('ABORTED');
    expect(calls.close).toEqual(calls.connect);
    expect(calls.close).toHaveLength(1);
  });

  it('closes every allocated pending native channel on dispose', async () => {
    const { bridge, calls, listeners } = mockBridge();
    const link = new DirectLink(bridge);
    const controller = new AbortController();
    const a = link.connect(KEY, controller.signal);
    const b = link.connect(KEY, controller.signal);
    link.dispose();
    await expect(a).rejects.toThrow('ABORTED');
    await expect(b).rejects.toThrow('ABORTED');
    expect(calls.close.sort()).toEqual(calls.connect.slice().sort());
    expect(listeners.size).toBe(0);
  });

  it('does not allocate anything when the signal is already aborted', async () => {
    const { bridge, calls } = mockBridge();
    const link = new DirectLink(bridge);
    const controller = new AbortController();
    controller.abort();
    await expect(link.connect(KEY, controller.signal)).rejects.toThrow('ABORTED');
    expect(calls.connect).toHaveLength(0);
    expect(calls.close).toHaveLength(0);
  });

  it('accepts open and message events that arrive before the connect call resolves', async () => {
    let finishConnect!: () => void;
    const { bridge, calls, emit } = mockBridge({ connect: () => new Promise<void>(resolve => { finishConnect = resolve; }) });
    const link = new DirectLink(bridge);
    const pending = link.connect(KEY, new AbortController().signal);
    const id = calls.connect[0]!;
    emit({ type: 'open', channelId: id, binding });
    emit({ type: 'message', channelId: id, data: Uint8Array.of(1, 2) });
    const channel = await pending;
    const received: Uint8Array[] = [];
    channel.attach({ message: data => received.push(data), close: () => undefined });
    expect(received).toEqual([Uint8Array.of(1, 2)]);
    finishConnect();
  });

  it('closes the native channel once even if close is requested repeatedly', async () => {
    const { bridge, calls, emit } = mockBridge();
    const link = new DirectLink(bridge);
    const pending = link.connect(KEY, new AbortController().signal);
    emit({ type: 'open', channelId: calls.connect[0]!, binding });
    const channel = await pending;
    channel.close('A');
    channel.close('B');
    expect(calls.close).toHaveLength(1);
  });

  it('rejects a connect that the native side refuses', async () => {
    const { bridge } = mockBridge({ connect: () => Promise.reject(new Error('DIRECT_LIMIT')) });
    const link = new DirectLink(bridge);
    await expect(link.connect(KEY, new AbortController().signal)).rejects.toThrow('DIRECT_LIMIT');
  });

  it('closes incoming channels when nobody is hosting', () => {
    const { bridge, calls, emit } = mockBridge();
    new DirectLink(bridge);
    emit({ type: 'incoming', channelId: 'c'.repeat(32), binding });
    expect(calls.close).toEqual(['c'.repeat(32)]);
  });
});
