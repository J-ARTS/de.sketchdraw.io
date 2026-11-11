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
  let sendTail: Promise<unknown> = Promise.resolve();
  const abort = new AbortController();
  const receiver = createCrdtTransferReceiver({ onError: reportError });
  const peerKey = (peer: { peerId: string; keyHash: string }) => `${peer.peerId}:${peer.keyHash}`;

  function reportError(error: unknown): void {
    if (closed || failed || !options.onError) return;
    failed = true;
    options.onError(error instanceof Error ? error : new Error('SYNC_FAILED'));
  }

  function run(work: () => Promise<unknown>, bytes: number): void {
    if (pending.size >= 32 || bytes > CRDT_TRANSFER_LIMIT_BYTES - pendingBytes) { reportError(new Error('SYNC_FAILED')); return; }
    const promise = sendTail.then(() => {
      if (closed || failed) return;
      const task = work();
      return new Promise((resolve, reject) => {
        const cancel = () => { abort.signal.removeEventListener('abort', cancel); reject(new Error('ABORTED')); };
        abort.signal.addEventListener('abort', cancel, { once: true });
        void task.then(value => { abort.signal.removeEventListener('abort', cancel); resolve(value); }, error => {
          abort.signal.removeEventListener('abort', cancel); reject(error);
        });
        if (abort.signal.aborted) cancel();
      });
    });
    sendTail = promise.catch(() => undefined);
    pending.add(promise); pendingBytes += bytes;
    void promise.catch(reportError).finally(() => { pending.delete(promise); pendingBytes -= bytes; });
  }

  function send(channel: 'sync' | 'update', data: Uint8Array, targets: readonly string[]): void {
    if (closed || failed) return;
    const identities = new Set(transport.getStatus().peers.filter(peer => targets.includes(peer.peerId)).map(peerKey));
    if (channel === 'update' && data.byteLength > CRDT_TRANSFER_LIMIT_BYTES) {
      reportError(new Error('DOCUMENT_TOO_LARGE_FOR_COLLABORATION'));
      return;
    }
    // Queued work belongs to authenticated connections, not reusable peer IDs. Recheck each chunk as well.
    const currentTargets = () => {
      const status = transport.getStatus();
      if (channel === 'update' && status.grantedRole === 'viewer') return [];
      return status.peers.filter(peer => identities.has(peerKey(peer)) && (channel !== 'sync' || peer.role !== 'viewer')).map(peer => peer.peerId);
    };
    const currentTransport = Object.create(transport) as CollaborationTransport;
    currentTransport.send = async (wireChannel, bytes) => {
      await Promise.all(currentTargets().map(async id => {
        try { await transport.send(wireChannel, bytes, [id]); }
        catch (error) {
          // Never resend a chunk to successful recipients. Only an ended connection's own failure is obsolete.
          if (currentTargets().includes(id)) throw error;
        }
      }));
    };
    run(() => channel === 'update' ? sendCrdtUpdate(currentTransport, data, targets, abort.signal) : currentTransport.send(channel, data, targets), data.byteLength);
  }

  const offUpdates = controller.on('update', event => {
    if (closed || failed || event.source === 'persistence' || transport.getStatus().grantedRole === 'viewer') return;
    const targets = transport.getStatus().peers.map(peer => peer.peerId).filter(peerId => peerId !== event.excludePeerId);
    if (!targets.length) return;
    send('update', event.update, targets);
  });

  const offMessages = transport.subscribeMessage(message => {
    if (closed || failed) return;
    if (message.channel === 'asset') {
      void receiver.accept(`${message.peer.peerId}:${message.peer.keyHash}`, message.data).then(snapshot => {
        if (!snapshot || closed || failed) return;
        const peer = transport.getStatus().peers.find(value => value.peerId === message.peer.peerId && value.keyHash === message.peer.keyHash);
        if (!peer) return;
        try {
          applyRemote(() => controller.applyRemoteSnapshot(snapshot, { actorId: `peer:${peer.keyHash.slice(0, 24)}`, role: peer.role, source: 'peer', peerId: peer.peerId }));
        } catch (error) { reportError(error); }
      }).catch(reportError);
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
      let update: Uint8Array;
      try { update = controller.encodeUpdate(message.data); } catch { return; }
      if (update.byteLength > 2) send('update', update, [message.peer.peerId]);
      return;
    }
    if (message.channel === 'awareness' && awareness) {
      awareness.applyRemoteUpdate(message.data, state => state.actorId === `peer:${message.peer.keyHash.slice(0, 24)}`);
    }
  });

  const offStatus = transport.subscribeStatus(status => {
    if (closed || failed) return;
    receiver.retainPeers(new Set(status.peers.map(peer => `${peer.peerId}:${peer.keyHash}`)));
    const editable = status.peers.filter(peer => peer.role !== 'viewer');
    const current = new Set(editable.map(peerKey));
    const joined = editable.filter(peer => !knownPeers.has(peerKey(peer)));
    knownPeers = current;
    if (!joined.length) return;
    const stateVector = controller.encodeStateVector();
    for (const peer of joined) send('sync', stateVector, [peer.peerId]);
  });

  const existing = transport.getStatus().peers.filter(peer => peer.role !== 'viewer');
  knownPeers = new Set(existing.map(peerKey));
  for (const peer of existing) send('sync', controller.encodeStateVector(), [peer.peerId]);

  return {
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      abort.abort(); receiver.close();
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
