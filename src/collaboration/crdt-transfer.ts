import { CRDT_SNAPSHOT_LIMIT_BYTES, CRDT_UPDATE_LIMIT_BYTES } from '../crdt/types';
import type { CollaborationTransport } from './transport';

export const CRDT_TRANSFER_LIMIT_BYTES = CRDT_SNAPSHOT_LIMIT_BYTES;
const MAGIC = Uint8Array.of(0x53, 0x43, 0x59, 0x31); // SCY1, reserved Yjs state-transfer envelope on the asset channel.
const HEADER = 60; // magic, random transfer id (16), total (4), offset (4), SHA-256 (32).
const CHUNK_BYTES = 48 * 1024;
const MAX_TRANSFERS = 8;
const IDLE_MS = 30_000;
const TOTAL_MS = 120_000;
const hex = (data: Uint8Array) => Array.from(data, byte => byte.toString(16).padStart(2, '0')).join('');
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, index) => byte === b[index]);
const digest = async (data: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource));

function abortable(work: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return work;
  return new Promise((resolve, reject) => {
    const cancel = () => { signal.removeEventListener('abort', cancel); reject(new Error('ABORTED')); };
    signal.addEventListener('abort', cancel, { once: true });
    void work.then(() => { signal.removeEventListener('abort', cancel); resolve(); }, error => {
      signal.removeEventListener('abort', cancel); reject(error);
    });
    if (signal.aborted) cancel();
  });
}

/** Normal updates keep their existing guard. Large states use small ordered, authenticated asset records. */
export async function sendCrdtUpdate(
  transport: CollaborationTransport, data: Uint8Array, targetPeerIds?: readonly string[], signal?: AbortSignal,
): Promise<void> {
  const check = () => { if (signal?.aborted) throw new Error('ABORTED'); };
  check();
  if (data.byteLength < 1 || data.byteLength > CRDT_TRANSFER_LIMIT_BYTES) throw new Error('DOCUMENT_TOO_LARGE_FOR_COLLABORATION');
  if (data.byteLength <= CRDT_UPDATE_LIMIT_BYTES) return abortable(transport.send('update', data, targetPeerIds), signal);
  const id = crypto.getRandomValues(new Uint8Array(16));
  const hash = await digest(data);
  for (let offset = 0; offset < data.byteLength; offset += CHUNK_BYTES) {
    check();
    const chunk = data.subarray(offset, offset + CHUNK_BYTES);
    const frame = new Uint8Array(HEADER + chunk.byteLength);
    frame.set(MAGIC); frame.set(id, 4); frame.set(hash, 28);
    const view = new DataView(frame.buffer);
    view.setUint32(20, data.byteLength); view.setUint32(24, offset);
    frame.set(chunk, HEADER);
    // Await every record: no unbounded queue of asset frames, including when the native stream stalls.
    await abortable(transport.send('asset', frame, targetPeerIds), signal);
  }
}

interface Transfer {
  peerKey: string;
  bytes: Uint8Array;
  hash: Uint8Array;
  offset: number;
  verifying: boolean;
  idle: ReturnType<typeof setTimeout>;
  deadline: ReturnType<typeof setTimeout>;
}

/** One aggregate allocation budget across all peers; incomplete states never reach Yjs. */
export function createCrdtTransferReceiver(options: { onError(error: Error): void; timeoutMs?: number }) {
  const transfers = new Map<string, Transfer>();
  const reservations = new Set<Transfer>();
  let allocated = 0;
  let closed = false;
  const idleMs = Math.max(1, Math.min(options.timeoutMs ?? IDLE_MS, TOTAL_MS));

  function release(entry: Transfer): void {
    if (!reservations.delete(entry)) return;
    allocated -= entry.bytes.byteLength;
  }
  function remove(key: string): void {
    const entry = transfers.get(key);
    if (!entry) return;
    clearTimeout(entry.idle); clearTimeout(entry.deadline);
    transfers.delete(key);
    // A cancelled digest still holds its input. Logical cancellation must not free that allocation early.
    if (!entry.verifying) release(entry);
  }
  function fail(key: string, code = 'SYNC_TRANSFER_INVALID'): null {
    remove(key);
    if (!closed) options.onError(new Error(code));
    return null;
  }
  return {
    async accept(peerKey: string, frame: Uint8Array): Promise<Uint8Array | null> {
      if (closed || frame.length < 4 || !same(frame.subarray(0, 4), MAGIC)) return null;
      if (frame.length <= HEADER || frame.length > HEADER + CHUNK_BYTES) return fail('');
      const key = `${peerKey}:${hex(frame.subarray(4, 20))}`;
      const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
      const total = view.getUint32(20), offset = view.getUint32(24);
      const chunk = frame.subarray(HEADER), hash = frame.subarray(28, HEADER);
      if (total <= CRDT_UPDATE_LIMIT_BYTES || total > CRDT_TRANSFER_LIMIT_BYTES || offset + chunk.length > total
        || (offset + chunk.length < total && chunk.length !== CHUNK_BYTES)) return fail(key);
      let entry = transfers.get(key);
      if (!entry) {
        if (offset !== 0 || reservations.size >= MAX_TRANSFERS || allocated + total > CRDT_TRANSFER_LIMIT_BYTES) return fail(key, 'SYNC_TRANSFER_LIMIT');
        const expire = () => fail(key, 'SYNC_TRANSFER_TIMEOUT');
        entry = { peerKey, bytes: new Uint8Array(total), hash: hash.slice(), offset: 0, verifying: false,
          idle: setTimeout(expire, idleMs), deadline: setTimeout(expire, TOTAL_MS) };
        transfers.set(key, entry); reservations.add(entry); allocated += total;
      }
      if (entry.verifying || entry.bytes.length !== total || entry.offset !== offset || !same(entry.hash, hash)) return fail(key);
      entry.bytes.set(chunk, offset); entry.offset += chunk.length;
      clearTimeout(entry.idle);
      entry.idle = setTimeout(() => fail(key, 'SYNC_TRANSFER_TIMEOUT'), idleMs);
      if (entry.offset !== total) return null;
      entry.verifying = true;
      // Keep the reservation until hashing finishes; otherwise concurrent finals can exceed the budget.
      try {
        const actual = await digest(entry.bytes);
        if (closed || transfers.get(key) !== entry) return null;
        if (!same(actual, entry.hash)) return fail(key);
        remove(key);
        return entry.bytes;
      } finally {
        if (transfers.get(key) === entry) remove(key);
        release(entry);
      }
    },
    retainPeers(keys: ReadonlySet<string>): void {
      for (const [key, entry] of transfers) if (!keys.has(entry.peerKey)) remove(key);
    },
    close(): void {
      closed = true;
      for (const key of transfers.keys()) remove(key);
    },
  };
}
