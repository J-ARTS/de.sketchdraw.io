import type { CollaborationTransport, CollaborationTransportStatus } from '@/collaboration/transport';
import { bindCrdtTransport, bootstrapRoomDocument, type CrdtTransportBinding } from '@/collaboration/crdt';
import type { CrdtDocumentController } from '@/crdt';
import type { WhiteboardStore } from './contract';

/** Owns a guest document attachment. Transport readiness alone never grants local document authority. */
export class RoomConnection {
  private readonly abort = new AbortController();
  private closed = false;
  private adopted = false;
  private adopting = false;
  private controller: CrdtDocumentController | null = null;
  private binding: CrdtTransportBinding | undefined;
  private offStatus = () => {};
  private failure: string | undefined;

  constructor(
    private readonly store: WhiteboardStore,
    readonly transport: CollaborationTransport,
    private readonly options: { documentId: string; role?: 'editor' | 'viewer'; onChange?: (status: CollaborationTransportStatus, adopted: boolean) => void; onError?: (error: Error) => void; timeoutMs?: number },
  ) {}

  get isAdopting(): boolean { return this.adopting; }
  get isAdopted(): boolean { return this.adopted; }
  private ownsDocument(): boolean { return this.adopted && this.store.getCrdtController() === this.controller; }
  private access = () => {
    const status = this.transport.getStatus();
    return {
      role: status.grantedRole ?? this.options.role ?? 'viewer',
      connected: !this.closed && this.adopted && status.state === 'ready' && status.peers.length > 0,
    };
  };

  private update = () => {
    if (this.closed) return;
    const status = this.transport.getStatus();
    if (this.ownsDocument()) {
      const access = this.access();
      const previous = this.store.getRoomGuest();
      // Apply the freshly authenticated role and connectivity together, including role changes on reconnect.
      if (previous?.role !== access.role) this.store.enterRoomGuest(access.role, access.connected, this.access);
      else this.store.setRoomConnected(access.connected);
    }
    this.options.onChange?.(status, this.adopted);
    if (!this.adopted && (status.state === 'error' || status.state === 'closed')) {
      this.failure = status.error ?? 'CONNECTION_LOST';
      this.abort.abort();
      if (this.controller) this.store.cancelRoomAdoption(this.controller);
    }
  };

  async join(): Promise<boolean> {
    this.offStatus = this.transport.subscribeStatus(this.update);
    this.update();
    try {
      const controller = await bootstrapRoomDocument(this.transport, {
        documentId: this.options.documentId, signal: this.abort.signal,
        ...(this.options.timeoutMs === undefined ? {} : { timeoutMs: this.options.timeoutMs }),
      });
      this.controller = controller;
      if (this.closed || this.abort.signal.aborted) { controller.destroy(); throw new Error(this.failure ?? 'ABORTED'); }
      this.adopting = true;
      let accepted = false;
      try { accepted = await this.store.adoptRoomDocument(controller, { role: this.access().role, access: this.access }); }
      finally { this.adopting = false; }
      if (!accepted) { await this.close(); if (this.failure) throw new Error(this.failure); return false; }
      this.adopted = true;
      if (this.closed) { this.store.setRoomConnected(false); return false; }
      this.binding = bindCrdtTransport(controller, this.transport, undefined, {
        applyRemote: apply => {
          if (this.ownsDocument()) this.store.getAuthority()?.applyExternalUpdate(apply);
        },
        onError: error => {
          if (this.closed) return;
          this.failure = error.message === 'DOCUMENT_TOO_LARGE_FOR_COLLABORATION' ? error.message : 'SYNC_FAILED';
          // Close synchronously revokes writes, while keeping guest authority until an explicit local transition.
          void this.close(false, this.failure);
          this.options.onChange?.({ ...this.transport.getStatus(), state: 'error', error: this.failure, peers: [] }, this.adopted);
          this.options.onError?.(new Error(this.failure));
        },
      });
      this.update();
      return true;
    } catch (error) {
      await this.close();
      throw new Error(this.failure ?? (error instanceof Error ? error.message : 'CONNECT_FAILED'));
    }
  }

  async close(keepLocalCopy = false, reason?: string): Promise<void> {
    const owns = this.ownsDocument();
    if (!this.closed) {
      this.closed = true;
      this.offStatus();
      this.abort.abort();
      if (this.controller && !this.adopted) this.store.cancelRoomAdoption(this.controller);
      if (owns) this.store.setRoomConnected(false);
      // Release blocked sends before awaiting the bridge's pending work.
      await this.transport.close(reason).catch(() => undefined);
      await this.binding?.close().catch(() => undefined);
    }
    if (keepLocalCopy && owns && this.ownsDocument()) this.store.leaveRoomGuest();
  }
}
