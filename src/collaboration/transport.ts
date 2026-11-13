import type { PeerSessionKey } from '../session';
import type { SessionIdentity } from './types';

export type CollaborationTransportChannel = 'sync' | 'update' | 'awareness' | 'asset';

export interface AutomaticPeerGrant {
  role: 'owner' | 'editor' | 'viewer';
  grantId: string;
  grantGeneration: number;
}

export interface AutomaticPeerAuthorizationRequest {
  peerId: string;
  keyHash: string;
  publicKeyBase64Url: string;
  invitationId: string;
  session: PeerSessionKey;
}

export interface AutomaticPeer extends AutomaticPeerGrant {
  peerId: string;
  keyHash: string;
  publicKeyBase64Url: string;
  invitationId: string;
}

export interface AutomaticTransportConfig {
  appId: string;
  roomId: string;
  password: string;
  invitationId: string;
  relayUrls: readonly string[];
  rtcConfig: RTCConfiguration;
  session: PeerSessionKey;
  identity: SessionIdentity;
  localGrant: AutomaticPeerGrant;
  authorizePeer(request: AutomaticPeerAuthorizationRequest): AutomaticPeerGrant | null | Promise<AutomaticPeerGrant | null>;
  maxReceiveBytes?: number;
  /** Participants including the local one; defaults to AUTOMATIC_DEFAULT_MAX_PARTICIPANTS, at most 100. */
  maxParticipants?: number;
}

export interface CollaborationTransportMessage {
  channel: CollaborationTransportChannel;
  data: Uint8Array;
  peer: AutomaticPeer;
}

export type CollaborationTransportMode = 'automatic-p2p' | 'hyperdht-relay';

export interface CollaborationTransportStatus {
  mode: CollaborationTransportMode;
  state: 'connecting' | 'ready' | 'reconnecting' | 'closed' | 'error';
  peers: readonly AutomaticPeer[];
  relayUrls: readonly string[];
  iceServers: readonly string[];
  error?: string;
  /** hyperdht-relay only: route of the current connection and what the connection attempt is doing. */
  route?: 'direct' | 'relay';
  phase?: 'connecting' | 'authenticating';
  attempt?: number;
  /** Role the host granted to this device; set by guests after authentication. */
  grantedRole?: 'editor' | 'viewer';
  retryAfterMs?: number;
  attemptsLeft?: number;
  /** hyperdht-relay host: authenticated helper registrations, not a count of proven Internet paths. */
  helpers?: number;
}

export interface CollaborationTransport {
  readonly mode: CollaborationTransportMode;
  getStatus(): CollaborationTransportStatus;
  subscribeStatus(listener: (status: CollaborationTransportStatus) => void): () => void;
  subscribeMessage(listener: (message: CollaborationTransportMessage) => void | Promise<void>): () => void;
  send(channel: CollaborationTransportChannel, data: Uint8Array, targetPeerIds?: readonly string[]): Promise<void>;
  /** Optional application failure token; transports may send it to authenticated peers before closing. */
  close(reason?: string): Promise<void>;
}

export interface AutomaticInvitation {
  version: 1;
  type: 'automatic-invitation';
  appId: string;
  roomId: string;
  password: string;
  invitationId: string;
  relayUrls: string[];
  rtcConfig: RTCConfiguration;
  session: PeerSessionKey;
  role: 'editor' | 'viewer';
  ownerPublicKeyBase64Url: string;
  createdAt: number;
  expiresAt: number;
}
