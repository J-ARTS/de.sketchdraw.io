import { describe, expect, it, vi } from 'vitest';
import { createCrdtTransferReceiver, sendCrdtUpdate } from '@/collaboration/crdt-transfer';
import type { CollaborationTransport } from '@/collaboration/transport';

async function frames() {
  const data = new Uint8Array(4 * 1024 * 1024 + 33).fill(7);
  const chunks: Uint8Array[] = [];
  const transport = { send: vi.fn(async (channel, bytes) => { expect(channel).toBe('asset'); chunks.push(bytes); }) } as unknown as CollaborationTransport;
  await sendCrdtUpdate(transport, data, ['peer']);
  return { data, chunks };
}

describe('bounded CRDT state transfer', () => {
  it('reassembles exact state bytes; ordinary updates use the existing update channel', async () => {
    const { data, chunks } = await frames();
    const onError = vi.fn(), receiver = createCrdtTransferReceiver({ onError });
    let complete: Uint8Array | null = null;
    try {
      for (const chunk of chunks) complete = await receiver.accept('peer:key', chunk);
      expect(complete?.byteLength).toBe(data.byteLength);
      expect(Buffer.from(complete!).equals(Buffer.from(data))).toBe(true); expect(onError).not.toHaveBeenCalled();
      const send = vi.fn(async () => {});
      await sendCrdtUpdate({ send } as unknown as CollaborationTransport, Uint8Array.of(1, 2));
      expect(send).toHaveBeenCalledWith('update', Uint8Array.of(1, 2), undefined);
    } finally { receiver.close(); }
  });

  it('rejects corruption, missing/repeated chunks and cross-peer continuation', async () => {
    const { chunks } = await frames();
    const onError = vi.fn(), receiver = createCrdtTransferReceiver({ onError });
    try {
      await receiver.accept('peer:key', chunks[0]!);
      await receiver.accept('peer:key', chunks[0]!);
      expect(onError).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'SYNC_TRANSFER_INVALID' }), 'peer:key');
      await receiver.accept('other:key', chunks[1]!);
      expect(onError).toHaveBeenCalledTimes(2);
      const corrupt = chunks.at(-1)!.slice(); corrupt[corrupt.length - 1] = corrupt[corrupt.length - 1]! ^ 1;
      for (const frame of chunks.slice(0, -1)) expect(await receiver.accept('peer:key', frame)).toBeNull();
      expect(await receiver.accept('peer:key', corrupt)).toBeNull();
      expect(onError).toHaveBeenCalledTimes(3);
    } finally { receiver.close(); }
  });

  it('reserves one total byte budget across peers and frees it on disconnect', async () => {
    const { chunks } = await frames();
    const frame = chunks[0]!.slice(); new DataView(frame.buffer).setUint32(20, 40 * 1024 * 1024);
    const onError = vi.fn(), receiver = createCrdtTransferReceiver({ onError });
    try {
      await receiver.accept('first:key', frame);
      await receiver.accept('second:key', frame);
      expect(onError).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'SYNC_TRANSFER_BUSY' }), 'second:key');
      receiver.retainPeers(new Set()); onError.mockClear();
      await receiver.accept('second:key', frame);
      expect(onError).not.toHaveBeenCalled();
    } finally { receiver.close(); }
  });

  it('allows only one unfinished allocation per authenticated peer', async () => {
    const { chunks } = await frames();
    const onError = vi.fn(), receiver = createCrdtTransferReceiver({ onError });
    try {
      await receiver.accept('peer:key', chunks[0]!);
      const another = chunks[0]!.slice(); another[4] = another[4]! ^ 1;
      await receiver.accept('peer:key', another);
      expect(onError).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'SYNC_TRANSFER_LIMIT' }), 'peer:key');
      receiver.retainPeers(new Set()); onError.mockClear();
      await receiver.accept('other:key', another);
      expect(onError).not.toHaveBeenCalled();
    } finally { receiver.close(); }
  });

  it('bounds idle reservations and stops sending after cancellation', async () => {
    const { data, chunks } = await frames();
    vi.useFakeTimers();
    const onError = vi.fn(), receiver = createCrdtTransferReceiver({ onError, timeoutMs: 20 });
    try {
      await receiver.accept('peer:key', chunks[0]!);
      await vi.advanceTimersByTimeAsync(21);
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'SYNC_TRANSFER_TIMEOUT' }), 'peer:key');
      receiver.close();
      expect(vi.getTimerCount()).toBe(0);
    } finally { receiver.close(); vi.useRealTimers(); }
    const abort = new AbortController();
    const send = vi.fn(async () => { abort.abort(); });
    await expect(sendCrdtUpdate({ send } as unknown as CollaborationTransport, data, ['peer'], abort.signal)).rejects.toThrow('ABORTED');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('keeps cancelled hash work charged until it releases the retained state', async () => {
    const { chunks } = await frames();
    const hashes: ((value: ArrayBuffer) => void)[] = [];
    const hashing = vi.spyOn(crypto.subtle, 'digest').mockImplementation(() => new Promise(resolve => { hashes.push(resolve); }));
    const onError = vi.fn(), receiver = createCrdtTransferReceiver({ onError });
    const pending: Promise<Uint8Array | null>[] = [];
    try {
      for (let index = 0; index < 8; index++) {
        for (const frame of chunks.slice(0, -1)) await receiver.accept(`peer:${index}`, frame);
        pending.push(receiver.accept(`peer:${index}`, chunks.at(-1)!));
        receiver.retainPeers(new Set());
      }
      expect(hashes).toHaveLength(8);
      await receiver.accept('ninth', chunks[0]!);
      expect(onError).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'SYNC_TRANSFER_BUSY' }), 'ninth');
      receiver.close();
      for (const resolve of hashes) resolve(new ArrayBuffer(32));
      expect((await Promise.all(pending)).every(value => value === null)).toBe(true);
    } finally { receiver.close(); for (const resolve of hashes) resolve(new ArrayBuffer(32)); hashing.mockRestore(); }
  });

  it('aborts a blocked send without waiting for the transport to drain', async () => {
    const abort = new AbortController();
    let began!: () => void;
    const sending = new Promise<void>(resolve => { began = resolve; });
    const send = vi.fn(() => { began(); return new Promise<void>(() => {}); });
    const pending = sendCrdtUpdate({ send } as unknown as CollaborationTransport, new Uint8Array(5 * 1024 * 1024), undefined, abort.signal);
    await sending;
    abort.abort();
    await expect(pending).rejects.toThrow('ABORTED');
    expect(send).toHaveBeenCalledTimes(1);
  });
});
