import type {
  CommandContext, DocumentCommand, DocumentController, DocumentSession,
  HistoryAvailability,
} from '../domain';
import type { WriteErrorCode } from './errors';

export interface DocumentSessionKey {
  documentId: string;
  controllerEpoch: string; // random 128-bit hex; never reused
}
export interface PeerSessionKey extends DocumentSessionKey {
  sessionId: string;       // random 128-bit hex; never reused
  permissionEpoch: number; // non-negative safe integer
}
export type WriteAction =
  | { kind: 'dispatch'; command: DocumentCommand }
  | { kind: 'undo' }
  | { kind: 'redo' };
export interface WriteIntent {
  requestId: string;       // scopeId + ':' + clientSequence; stable across retries
  expectedRevision: number;
  action: WriteAction;
}
export type WriteOutcome =
  | { status: 'committed'; requestId: string; revision: number }
  | { status: 'no-op'; requestId: string; revision: number }
  | { status: 'rejected'; requestId: string; code: WriteErrorCode;
      accepted: boolean; currentRevision?: number }
  | { status: 'outcome-unknown'; requestId: string };
export interface DocumentSnapshotSource {
  getSnapshot(): DocumentSession; // detached validated copy
  subscribe(listener: (snapshot: DocumentSession) => void): () => void;
}
export interface ReadonlyDocumentSource extends DocumentSnapshotSource {
  getHistoryState(): HistoryAvailability; // for this bound actor
}
export interface BoundWriteGateway {
  readonly session: DocumentSessionKey;
  nextRequestId(): string | null; // no new ID while this actor has an unresolved write
  submit(intent: WriteIntent): Promise<WriteOutcome>;
  queryOutcome(requestId: string): Promise<WriteOutcome
    | { status: 'pending'; requestId: string } | { status: 'not-seen' }>;
}
export interface TransitionBarrier {
  readonly token: string;
  readonly session: DocumentSessionKey;
  readonly snapshot: DocumentSession;
  readonly draftGeneration: number;
  readonly unresolvedRequestIds: readonly string[]; // guest only; never implicitly saved
}
export interface DocumentLifecycleGate {
  beginTransition(reason: 'close' | 'replace' | 'revoke',
    draftGeneration: number): Promise<TransitionBarrier>;
  isCurrent(barrier: TransitionBarrier, draftGeneration: number): boolean;
  cancelTransition(token: string): void;
  completeTransition(token: string): void;
}

export interface GrantCheck {
  readonly session: DocumentSessionKey;
  readonly bindingId: string;
  readonly bindingGeneration: number; // authority-assigned, never reused in this session
  readonly grantId: string;
  readonly grantGeneration: number;
  readonly actorId: string;
  readonly source: CommandContext['source'];
  readonly permission: 'read' | 'write';
}
export type GrantDecision = { allowed: true }
  | { allowed: false; code: 'ACCESS_DENIED' | 'ACCESS_REVOKED' | 'SESSION_CHANGED' };
export type GrantGuard = (check: GrantCheck) => GrantDecision; // synchronous, no I/O
export interface ActorBindingOptions {
  actorId: string; // trusted composition only; never copied from untrusted intent
  source: CommandContext['source'];
  grantId: string;
  grantGeneration: number;
  guard: GrantGuard;
  peerSessionId?: string; // required exactly for source: 'peer'; trusted OwnerSession ID
}
export interface ActorBinding {
  readonly bindingId: string;
  readonly bindingGeneration: number;
  readonly scopeId: string; // authority-generated 128-bit request namespace
  readonly actorId: string;
  readonly source: ReadonlyDocumentSource;
  readonly gateway: BoundWriteGateway;
}
export interface DocumentCommit {
  readonly session: DocumentSessionKey;
  readonly bindingId: string;
  readonly requestId: string;
  readonly actorId: string;
  readonly source: CommandContext['source'];
  readonly action: WriteAction;
  readonly previousRevision: number;
  readonly snapshot: DocumentSession; // exact result; revision = previousRevision + 1
}
export interface DocumentAuthority {
  readonly session: DocumentSessionKey;
  readonly source: DocumentSnapshotSource; // trusted adapters; no unbound history access
  readonly lifecycleGate: DocumentLifecycleGate;
  bindActor(options: ActorBindingOptions): ActorBinding;
  revokeBinding(bindingId: string): void; // synchronous; queued writes lose permission
  finalizePeerSession(peerSessionId: string): void; // trusted irreversible session end
  subscribeCommits(listener: (commit: DocumentCommit) => void): () => void;
  /**
   * Trusted entry for changes the controller receives from a replication transport (a CRDT update from a peer):
   * `apply` must perform exactly one controller change. The authority validates that change, adopts the new
   * revision and notifies its subscribers. Returns whether the document changed. Not usable during a write.
   */
  applyExternalUpdate(apply: () => DocumentSession): boolean;
}
export interface DocumentAuthorityOptions {
  controller: DocumentController; // exclusive ownership transferred to this authority
  onFatal?: (error: { code: 'AUTHORITY_DIVERGED' | 'INTERNAL_ERROR' }) => void;
}
