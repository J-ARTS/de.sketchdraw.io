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

export interface CollaborationTransportStatus {
  mode: 'automatic-p2p';
  state: 'connecting' | 'ready' | 'closed' | 'error';
  peers: readonly AutomaticPeer[];
  relayUrls: readonly string[];
  iceServers: readonly string[];
  error?: string;
}

export interface CollaborationTransport {
  readonly mode: 'automatic-p2p';
  getStatus(): CollaborationTransportStatus;
  subscribeStatus(listener: (status: CollaborationTransportStatus) => void): () => void;
  subscribeMessage(listener: (message: CollaborationTransportMessage) => void | Promise<void>): () => void;
  send(channel: CollaborationTransportChannel, data: Uint8Array, targetPeerIds?: readonly string[]): Promise<void>;
  close(): Promise<void>;
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
