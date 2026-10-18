import type { CrdtDocumentController, ValidatedAwareness } from '../crdt';
import type { CollaborationTransport } from './transport';

export interface CrdtTransportBinding {
  close(): Promise<void>;
}

/**
 * Connects a transport to one CRDT document. Authentication and grants are
 * established by the transport before this bridge sees any bytes.
 */
export function bindCrdtTransport(
  controller: CrdtDocumentController,
  transport: CollaborationTransport,
  awareness?: ValidatedAwareness,
): CrdtTransportBinding {
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
      controller.applyRemoteUpdate(message.data, {
        actorId: `peer:${message.peer.keyHash.slice(0, 24)}`,
        role: message.peer.role,
        source: 'peer',
        peerId: message.peer.peerId,
      });
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
