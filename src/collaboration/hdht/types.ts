/** Contracts of the HyperDHT + relay session mode shared by renderer code and the Electron main process. */

export type HdhtRoute = 'direct' | 'relay';

/**
 * An end-to-end encrypted, ordered message channel whose remote side already proved the pinned host key (or is the
 * host itself). Messages are whole application messages; fragmentation is internal to the channel.
 */
export interface SecureChannel {
  readonly route: HdhtRoute;
  /** 32-byte value both ends derive from the channel handshake; binds the PIN proof to this very channel. */
  readonly binding: Uint8Array;
  send(message: Uint8Array): Promise<void>;
  /** Starts delivery. Messages and a close that happened before this call are replayed in order. */
  attach(handlers: { message(data: Uint8Array): void; close(reason: string): void }): void;
  close(reason?: string): void;
}

export type DirectEvent =
  | { type: 'incoming'; channelId: string; binding: Uint8Array }
  | { type: 'open'; channelId: string; binding: Uint8Array }
  | { type: 'message'; channelId: string; data: Uint8Array }
  | { type: 'close'; channelId: string; reason: string };

/** Scoped native bridge: only Electron provides it; the renderer never sees keys, sockets or addresses. */
export interface DirectBridge {
  /** Starts the DHT server and returns its public key (hex). At most one host per window. */
  hostStart(): Promise<{ publicKey: string }>;
  hostStop(): Promise<void>;
  /** Starts a connection attempt to the pinned host key (hex) under a caller-chosen id; progress arrives as events. */
  connect(hostPublicKey: string, channelId: string): Promise<void>;
  send(channelId: string, data: Uint8Array): Promise<void>;
  close(channelId: string): Promise<void>;
  onEvent(listener: (event: DirectEvent) => void): () => void;
  /**
   * Looks up relay helpers on the DHT: `service` finds volunteer peers that offer relay capacity, `session` finds the
   * helpers that currently serve one session (topic = relay topic, hex). Returns at most a few public keys (hex).
   */
  discover(request: { kind: 'service' } | { kind: 'session'; topic: string }): Promise<string[]>;
}

export interface HelperStatus {
  running: boolean;
  announced: boolean;
  connections: number;
  sessions: number;
  guests: number;
  forwardedRecords: number;
  error?: string;
}

/** Volunteer relay of this device (Electron main). It runs while a session of this device is active (#162). */
export interface HelperBridge {
  start(): Promise<HelperStatus>;
  stop(): Promise<void>;
  status(): Promise<HelperStatus>;
}

export interface WebSocketLike {
  binaryType: string;
  readonly readyState: number;
  readonly bufferedAmount: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketFactory = (url: string, protocols: string) => WebSocketLike;
