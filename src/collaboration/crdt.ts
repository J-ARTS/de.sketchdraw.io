import * as Y from 'yjs';
import { createCrdtControllerFromSnapshot, type CrdtDocumentController, type ValidatedAwareness } from '../crdt';
import type { DocumentSession } from '../domain';
import type { CollaborationTransport } from './transport';
import { CRDT_TRANSFER_LIMIT_BYTES, createCrdtTransferReceiver, sendCrdtUpdate } from './crdt-transfer';

export interface CrdtTransportBinding {
  close(): Promise<void>;
}

/** Large diagrams use bounded chunked transfer; reject only states beyond that transfer budget. */
export function assertCollaborationDocumentSize(controller: CrdtDocumentController): void {
  if (controller.encodeUpdate().byteLength > CRDT_TRANSFER_LIMIT_BYTES) throw new Error('DOCUMENT_TOO_LARGE_FOR_COLLABORATION');
}

/**
 * Connects a transport to one CRDT document. Authentication and grants are
 * established by the transport before this bridge sees any bytes.
 */
export interface CrdtBindingOptions {
  /**
   * Runs the controller change for a remote update. Pass the document authority's `applyExternalUpdate` so the
   * session layer stays consistent with the controller; defaults to applying the change directly.
   */
  applyRemote?: (apply: () => DocumentSession) => unknown;
  /** A failed outgoing sync must be surfaced by owners that cannot recover it. Reported once per binding. */
  onError?: (error: Error) => void;
  /** Hosts isolate a faulty authenticated connection; guests keep using the binding-wide error handler. */
  onPeerError?: (error: Error, peer: { peerId: string; keyHash: string }) => void;
}

export function bindCrdtTransport(
  controller: CrdtDocumentController,
  transport: CollaborationTransport,
  awareness?: ValidatedAwareness,
  options: CrdtBindingOptions = {},
): CrdtTransportBinding {
  const applyRemote = options.applyRemote ?? ((apply: () => DocumentSession) => apply());
  let closed = false;
  let failed = false;
  let knownPeers = new Set<string>();
  const pending = new Set<Promise<unknown>>();
  let pendingBytes = 0;
  const queues = new Map<string, { tail: Promise<unknown>; pending: number; abort: AbortController }>();
  const reserved = new Map<Uint8Array, number>();
  const quarantined = new Set<string>();
  const syncRequests = new Map<string, { at: number; count: number }>();
  const syncPending = new Set<string>();
  const receiver = createCrdtTransferReceiver({ onError: (error, key) => reportPeerError(key, error) });
  const peerKey = (peer: { peerId: string; keyHash: string }) => `${peer.peerId}:${peer.keyHash}`;

  function reportError(error: unknown): void {
    if (closed || failed || !options.onError) return;
    failed = true;
    options.onError(error instanceof Error ? error : new Error('SYNC_FAILED'));
  }

  function reportPeerError(key: string, error: unknown): void {
    if (closed || failed || quarantined.has(key)) return;
    const peer = transport.getStatus().peers.find(value => peerKey(value) === key);
    if (!peer) return;
    if (!options.onPeerError) { reportError(error); return; }
    quarantined.add(key);
    queues.get(key)?.abort.abort();
    receiver.retainPeers(new Set(transport.getStatus().peers.map(peerKey).filter(value => !quarantined.has(value))));
    options.onPeerError(error instanceof Error ? error : new Error('SYNC_FAILED'), { peerId: peer.peerId, keyHash: peer.keyHash });
  }

  function run(key: string, data: Uint8Array, work: (signal: AbortSignal) => Promise<unknown>): Promise<void> {
    if (quarantined.has(key)) return Promise.resolve();
    const queue = queues.get(key) ?? { tail: Promise.resolve(), pending: 0, abort: new AbortController() };
    queues.set(key, queue);
    if (queue.pending >= 32) { reportPeerError(key, new Error('SYNC_PEER_BACKPRESSURE')); return Promise.resolve(); }
    const references = reserved.get(data) ?? 0;
    if (!references && data.byteLength > CRDT_TRANSFER_LIMIT_BYTES - pendingBytes) { reportError(new Error('SYNC_FAILED')); return Promise.resolve(); }
    reserved.set(data, references + 1);
    if (!references) pendingBytes += data.byteLength;
    queue.pending++;
    const signal = queue.abort.signal;
    const promise = queue.tail.then(() => {
      if (closed || failed || signal.aborted) return;
      const task = work(signal);
      return new Promise((resolve, reject) => {
        const cancel = () => { signal.removeEventListener('abort', cancel); reject(new Error('ABORTED')); };
        signal.addEventListener('abort', cancel, { once: true });
        void task.then(value => { signal.removeEventListener('abort', cancel); resolve(value); }, error => {
          signal.removeEventListener('abort', cancel); reject(error);
        });
        if (signal.aborted) cancel();
      });
    });
    queue.tail = promise.catch(() => undefined);
    pending.add(promise);
    return promise.then(() => undefined, error => { if (!signal.aborted) reportPeerError(key, error); }).finally(() => {
      pending.delete(promise); queue.pending--;
      const count = reserved.get(data)! - 1;
      if (count) reserved.set(data, count); else { reserved.delete(data); pendingBytes -= data.byteLength; }
    });
  }

  async function send(channel: 'sync' | 'update', data: Uint8Array, targets: readonly string[]): Promise<void> {
    if (closed || failed) return;
    const recipients = transport.getStatus().peers.filter(peer => targets.includes(peer.peerId) && !quarantined.has(peerKey(peer)));
    if (channel === 'update' && data.byteLength > CRDT_TRANSFER_LIMIT_BYTES) {
      reportError(new Error('DOCUMENT_TOO_LARGE_FOR_COLLABORATION'));
      return;
    }
    // Queued work belongs to authenticated connections, not reusable peer IDs. Recheck each chunk as well.
    const current = (identity: string) => {
      const status = transport.getStatus();
      if (channel === 'update' && status.grantedRole === 'viewer') return undefined;
      return status.peers.find(peer => peerKey(peer) === identity && !quarantined.has(identity) && (channel !== 'sync' || peer.role !== 'viewer'));
    };
    await Promise.all(recipients.map(peer => {
      const key = peerKey(peer);
      const currentTransport = Object.create(transport) as CollaborationTransport;
      currentTransport.send = async (wireChannel, bytes) => {
        const recipient = current(key);
        if (!recipient) return;
        try { await transport.send(wireChannel, bytes, [recipient.peerId]); }
        catch (error) { if (current(key)) throw error; }
      };
      return run(key, data, signal => channel === 'update' ? sendCrdtUpdate(currentTransport, data, [peer.peerId], signal) : currentTransport.send(channel, data, [peer.peerId]));
    }));
  }

  const offUpdates = controller.on('update', event => {
    if (closed || failed || event.source === 'persistence' || transport.getStatus().grantedRole === 'viewer') return;
    const targets = transport.getStatus().peers.map(peer => peer.peerId).filter(peerId => peerId !== event.excludePeerId);
    if (!targets.length) return;
    void send('update', event.update, targets);
  });

  const offMessages = transport.subscribeMessage(message => {
    const key = peerKey(message.peer);
    if (closed || failed || quarantined.has(key)) return;
    if (message.channel === 'asset') {
      void receiver.accept(`${message.peer.peerId}:${message.peer.keyHash}`, message.data).then(snapshot => {
        if (!snapshot || closed || failed || quarantined.has(key)) return;
        const peer = transport.getStatus().peers.find(value => value.peerId === message.peer.peerId && value.keyHash === message.peer.keyHash);
        if (!peer) return;
        try {
          applyRemote(() => controller.applyRemoteSnapshot(snapshot, { actorId: `peer:${peer.keyHash.slice(0, 24)}`, role: peer.role, source: 'peer', peerId: peer.peerId }));
        } catch (error) { reportPeerError(key, error); }
      }).catch(error => reportPeerError(key, error));
      return;
    }
    if (message.channel === 'update') {
      try {
        applyRemote(() => controller.applyRemoteUpdate(message.data, {
          actorId: `peer:${message.peer.keyHash.slice(0, 24)}`,
          role: message.peer.role,
          source: 'peer',
          peerId: message.peer.peerId,
        }));
      } catch {
        // A rejected update (role, size, schema) must not break the connection for the others.
      }
      return;
    }
    if (message.channel === 'sync') {
      if (transport.getStatus().grantedRole === 'viewer') return;
      const now = Date.now(), previous = syncRequests.get(key);
      const requests = previous && now - previous.at < 1000 ? previous : { at: now, count: 0 };
      syncRequests.set(key, requests);
      if (++requests.count > 8) { reportPeerError(key, new Error('SYNC_PEER_RATE_LIMIT')); return; }
      if (syncPending.has(key)) return;
      let update: Uint8Array;
      try { update = controller.encodeUpdate(message.data); } catch { return; }
      if (update.byteLength > 2) {
        syncPending.add(key);
        void send('update', update, [message.peer.peerId]).finally(() => syncPending.delete(key));
      }
      return;
    }
    if (message.channel === 'awareness' && awareness) {
      awareness.applyRemoteUpdate(message.data, state => state.actorId === `peer:${message.peer.keyHash.slice(0, 24)}`);
    }
  });

  const offStatus = transport.subscribeStatus(status => {
    if (closed || failed) return;
    receiver.retainPeers(new Set(status.peers.map(peer => `${peer.peerId}:${peer.keyHash}`)));
    const present = new Set(status.peers.map(peerKey));
    for (const [key, queue] of queues) if (!present.has(key)) { queue.abort.abort(); queues.delete(key); }
    for (const key of quarantined) if (!present.has(key)) quarantined.delete(key);
    for (const key of syncRequests.keys()) if (!present.has(key)) syncRequests.delete(key);
    const editable = status.peers.filter(peer => peer.role !== 'viewer');
    const current = new Set(editable.map(peerKey));
    const joined = editable.filter(peer => !knownPeers.has(peerKey(peer)));
    knownPeers = current;
    if (!joined.length) return;
    const stateVector = controller.encodeStateVector();
    for (const peer of joined) void send('sync', stateVector, [peer.peerId]);
  });

  const existing = transport.getStatus().peers.filter(peer => peer.role !== 'viewer');
  knownPeers = new Set(existing.map(peerKey));
  for (const peer of existing) void send('sync', controller.encodeStateVector(), [peer.peerId]);

  return {
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      for (const queue of queues.values()) queue.abort.abort();
      receiver.close();
      offUpdates();
      offMessages();
      offStatus();
      await Promise.allSettled(Array.from(pending));
    },
  };
}

/** Encoded state vector of an empty document: asks a peer for its complete state. */
export const EMPTY_STATE_VECTOR: Uint8Array = Uint8Array.of(0);

const MAX_BOOTSTRAP_REQUESTS = 16;

export interface RoomBootstrapOptions {
  /** The document the invitation belongs to; any other document is rejected. */
  documentId: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Fetches the complete document of a room from its host without having a local copy. Requests the full state from
 * the first peer and accumulates updates until they form a valid document, so a concurrent partial update cannot
 * produce a broken start. The returned controller owns a document that shares the host's history.
 */
export function bootstrapRoomDocument(transport: CollaborationTransport, options: RoomBootstrapOptions): Promise<CrdtDocumentController> {
  const timeoutMs = options.timeoutMs ?? 35_000;
  return new Promise((resolve, reject) => {
    const scratch = new Y.Doc({ gc: false });
    let finished = false;
    /** One full-state request per authenticated connection (peer id + key hash), bounded in total. */
    const requestedFor = new Set<string>();
    let requestCount = 0;
    let offMessage = () => {};
    let offStatus = () => {};
    const receiver = createCrdtTransferReceiver({ onError: error => finish(error) });
    const timer = setTimeout(() => finish(new Error('DIRECT_CONNECTION_TIMEOUT')), timeoutMs);
    const finish = (error?: Error, controller?: CrdtDocumentController) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer); offMessage(); offStatus(); receiver.close(); options.signal?.removeEventListener('abort', onAbort); scratch.destroy();
      if (error) reject(error); else resolve(controller!);
    };
    const onAbort = () => finish(new Error('ABORTED'));
    options.signal?.addEventListener('abort', onAbort);
    if (options.signal?.aborted) { onAbort(); return; }

    const request = (status = transport.getStatus()) => {
      if (finished) return;
      if (status.state === 'error' || status.state === 'closed') { finish(new Error(status.error ?? 'CONNECTION_LOST')); return; }
      receiver.retainPeers(new Set(status.peers.map(peer => `${peer.peerId}:${peer.keyHash}`)));
      const connected = new Set(status.peers.map(peer => `${peer.peerId}:${peer.keyHash}`));
      for (const generation of requestedFor) if (!connected.has(generation)) requestedFor.delete(generation);
      for (const peer of status.peers) {
        const generation = `${peer.peerId}:${peer.keyHash}`;
        if (requestedFor.has(generation) || requestCount >= MAX_BOOTSTRAP_REQUESTS) continue;
        requestedFor.add(generation);
        requestCount++;
        void transport.send('sync', EMPTY_STATE_VECTOR, [peer.peerId]).catch(error => {
          const current = transport.getStatus();
          if (current.state === 'error' || current.state === 'closed') finish(new Error(current.error ?? 'CONNECTION_LOST'));
          else if (error instanceof Error && /^(DOCUMENT_TOO_LARGE_FOR_COLLABORATION|SYNC_FAILED)$/.test(error.message)) finish(error);
        });
      }
    };
    const applyBootstrapUpdate = (data: Uint8Array) => {
      if (finished) return;
      try {
        if (data.byteLength > CRDT_TRANSFER_LIMIT_BYTES) { finish(new Error('DOCUMENT_TOO_LARGE_FOR_COLLABORATION')); return; }
        Y.applyUpdateV2(scratch, data);
        const fullUpdate = Y.encodeStateAsUpdateV2(scratch);
        if (fullUpdate.byteLength > CRDT_TRANSFER_LIMIT_BYTES) { finish(new Error('DOCUMENT_TOO_LARGE_FOR_COLLABORATION')); return; }
        const controller = createCrdtControllerFromSnapshot(fullUpdate);
        if (controller.getSnapshot().document.id !== options.documentId) {
          controller.destroy();
          finish(new Error('DOCUMENT_MISMATCH'));
          return;
        }
        finish(undefined, controller);
      } catch {
        // Not a complete document yet (or invalid): keep waiting for the full state.
      }
    };
    offMessage = transport.subscribeMessage(message => {
      if (finished || message.peer.role === 'viewer') return;
      if (message.channel === 'update') applyBootstrapUpdate(message.data);
      else if (message.channel === 'asset') void receiver.accept(`${message.peer.peerId}:${message.peer.keyHash}`, message.data).then(update => {
        if (update && transport.getStatus().peers.some(peer => peer.peerId === message.peer.peerId && peer.keyHash === message.peer.keyHash)) applyBootstrapUpdate(update);
      }).catch(error => finish(error instanceof Error ? error : new Error('SYNC_FAILED')));
    });
    offStatus = transport.subscribeStatus(request);
    request();
  });
}
