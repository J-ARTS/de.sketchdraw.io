import * as Y from 'yjs';
import { createCrdtControllerFromUpdate, type CrdtDocumentController, type ValidatedAwareness } from '../crdt';
import type { DocumentSession } from '../domain';
import type { CollaborationTransport } from './transport';

export interface CrdtTransportBinding {
  close(): Promise<void>;
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
}

export function bindCrdtTransport(
  controller: CrdtDocumentController,
  transport: CollaborationTransport,
  awareness?: ValidatedAwareness,
  options: CrdtBindingOptions = {},
): CrdtTransportBinding {
  const applyRemote = options.applyRemote ?? ((apply: () => DocumentSession) => apply());
  let closed = false;
  let knownPeers = new Set<string>();
  const pending = new Set<Promise<unknown>>();

  function run(work: Promise<unknown>): void {
    pending.add(work);
    void work.catch(() => undefined).finally(() => pending.delete(work));
  }

  const offUpdates = controller.on('update', event => {
    if (closed || event.source === 'persistence') return;
    const targets = transport.getStatus().peers.map(peer => peer.peerId).filter(peerId => peerId !== event.excludePeerId);
    if (!targets.length) return;
    run(transport.send('update', event.update, targets));
  });

  const offMessages = transport.subscribeMessage(message => {
    if (closed) return;
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
      const update = controller.encodeUpdate(message.data);
      if (update.byteLength > 2) run(transport.send('update', update, [message.peer.peerId]));
      return;
    }
    if (message.channel === 'awareness' && awareness) {
      awareness.applyRemoteUpdate(message.data, state => state.actorId === `peer:${message.peer.keyHash.slice(0, 24)}`);
    }
  });

  const offStatus = transport.subscribeStatus(status => {
    if (closed) return;
    const current = new Set(status.peers.map(peer => peer.peerId));
    const joined = Array.from(current).filter(peerId => !knownPeers.has(peerId));
    knownPeers = current;
    if (!joined.length) return;
    const stateVector = controller.encodeStateVector();
    for (const peerId of joined) run(transport.send('sync', stateVector, [peerId]));
  });

  const existing = transport.getStatus().peers;
  knownPeers = new Set(existing.map(peer => peer.peerId));
  for (const peer of existing) run(transport.send('sync', controller.encodeStateVector(), [peer.peerId]));

  return {
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      offUpdates();
      offMessages();
      offStatus();
      await Promise.allSettled(Array.from(pending));
    },
  };
}

/** Encoded state vector of an empty document: asks a peer for its complete state. */
export const EMPTY_STATE_VECTOR: Uint8Array = Uint8Array.of(0);

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
    let requested = false;
    let offMessage = () => {};
    let offStatus = () => {};
    const timer = setTimeout(() => finish(new Error('DIRECT_CONNECTION_TIMEOUT')), timeoutMs);
    const finish = (error?: Error, controller?: CrdtDocumentController) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer); offMessage(); offStatus(); options.signal?.removeEventListener('abort', onAbort); scratch.destroy();
      if (error) reject(error); else resolve(controller!);
    };
    const onAbort = () => finish(new Error('ABORTED'));
    options.signal?.addEventListener('abort', onAbort);
    if (options.signal?.aborted) { onAbort(); return; }

    const request = () => {
      const peers = transport.getStatus().peers;
      if (requested || !peers.length) return;
      requested = true;
      for (const peer of peers) void transport.send('sync', EMPTY_STATE_VECTOR, [peer.peerId]).catch(() => undefined);
    };
    offMessage = transport.subscribeMessage(message => {
      if (finished || message.channel !== 'update') return;
      try {
        Y.applyUpdateV2(scratch, message.data);
        const controller = createCrdtControllerFromUpdate(Y.encodeStateAsUpdateV2(scratch));
        if (controller.getSnapshot().document.id !== options.documentId) {
          controller.destroy();
          finish(new Error('DOCUMENT_MISMATCH'));
          return;
        }
        finish(undefined, controller);
      } catch {
        // Not a complete document yet (or invalid): keep waiting for the full state.
      }
    });
    offStatus = transport.subscribeStatus(() => request());
    request();
  });
}
