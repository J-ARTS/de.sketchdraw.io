import type {
  BoundWriteGateway, DocumentAuthority, DocumentLifecycleGate,
  DocumentSnapshotSource, PeerSessionKey, ReadonlyDocumentSource,
} from '../session';

export type PeerRole = 'owner' | 'editor' | 'viewer';
export type PeerState = 'pairing' | 'awaiting-confirmation' | 'syncing' | 'ready'
  | 'disconnected' | 'resync-required' | 'revoked' | 'closed';
export interface PairingText { invitationId: string; text: string; expiresAt: number }
export interface PairingReview {
  invitationId: string;
  ownerKeyFingerprint: string;
  peerKeyFingerprint: string;
  ownerDtlsFingerprint?: string;
  peerDtlsFingerprint?: string;
  comparisonCode: string;
  role: 'editor' | 'viewer';
}
export interface CollaborationStatus {
  mode: 'owner' | 'guest';
  state: PeerState;
  session: PeerSessionKey;
  role: PeerRole;
  confirmedRevision: number;
  pendingWrites: number;
  hasUnresolvedOutcome: boolean;
  peers: readonly { peerId: string; role: PeerRole; state: PeerState }[];
}
export interface OwnerSession {
  source: DocumentSnapshotSource;
  createInvitation(role: 'editor' | 'viewer',
    options?: { resumePeerId: string }): Promise<PairingText>;
  acceptAnswer(text: string): Promise<PairingReview>;
  confirmPeer(invitationId: string, comparisonCode: string): Promise<void>;
  // Ends the current permission/session generation; see lifecycle policy below.
  revokePeer(peerId: string): Promise<void>;
  getStatus(): CollaborationStatus;
  subscribeStatus(listener: (status: CollaborationStatus) => void): () => void;
  close(): Promise<void>;
}
export interface GuestPairing {
  answer: PairingText;
  review: PairingReview;
  confirmOwner(comparisonCode: string): Promise<GuestSession>;
  cancel(): void;
}
export interface GuestSession {
  source: ReadonlyDocumentSource;
  gateway: BoundWriteGateway; // role checked at owner; viewer never gains write
  lifecycleGate: DocumentLifecycleGate; // local mirror/submission barrier, not owner freeze
  getStatus(): CollaborationStatus;
  subscribeStatus(listener: (status: CollaborationStatus) => void): () => void;
  acceptReconnectOffer(text: string): Promise<GuestPairing>; // same live identity, new PC
  leave(): Promise<void>;
}
declare const identityBrand: unique symbol;
export interface SessionIdentity {
  readonly [identityBrand]: true; // private runtime registry, not just a TypeScript cast
  readonly publicKeyBase64Url: string;
  readonly keyHash: string;
}
export interface OwnerSessionOptions {
  authority: DocumentAuthority;
  identity: SessionIdentity;
  onStatus?: (status: CollaborationStatus) => void;
}
export interface GuestOptions {
  identity: SessionIdentity;
  onStatus?: (status: CollaborationStatus) => void;
}
