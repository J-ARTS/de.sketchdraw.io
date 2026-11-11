export interface RelayHubLimits {
  /** Maximum incoming or forwarded record, including the 16-byte guest prefix on the host leg. */
  maxRecordBytes: number;
  maxConnections: number;
  maxTopics: number;
  maxGuestsPerTopic: number;
  joinTimeoutMs: number;
  idleTimeoutMs: number;
  maxSessionMs: number;
  messagesPerSecond: number;
  messageBurst: number;
  bytesPerSecond: number;
  byteBurst: number;
  /** Per joined connection's pending outgoing adapter bytes, shared by data and controls. */
  maxBufferedBytes: number;
  /** Smaller pending outgoing limit for connections that have not joined yet. */
  maxControlBufferedBytes: number;
  /** Combined pending outgoing adapter bytes over all hub connections; includes controls (default 64 MiB). */
  maxTotalBufferedBytes: number;
  aggregateBytesPerSecond: number;
  aggregateByteBurst: number;
}

export interface HubConnection {
  /** Must synchronously account any queued bytes in bufferedAmount; supports at most 14 bytes of framing. */
  send(data: Uint8Array | string, binary: boolean): void;
  /**
   * Pending application writes, including framing, released on drain/close. This is not total process memory:
   * downstream transport, encryption, kernel buffers and bytes handed off to them are outside this counter.
   */
  bufferedAmount(): number;
  isOpen(): boolean;
  close(code: number, reason: string): void;
  terminate?(code?: number, reason?: string): void;
}

export interface HubHandler {
  message(data: Uint8Array, isBinary: boolean): void;
  touch(): void;
  /** Idempotent remote-close notification; hub-initiated closure also releases ownership itself. */
  closed(): void;
}

export interface RelayHubOptions {
  limits?: Partial<RelayHubLimits>;
  now?: () => number;
  onHostRegistered?(topicHex: string): void;
  onHostGone?(topicHex: string): void;
}

export interface RelayHub {
  accept(connection: HubConnection): HubHandler | null;
  readonly limits: RelayHubLimits;
  stats(): { connections: number; topics: number; guests: number; forwardedRecords: number; closedForLimit: number };
  /** Synchronously releases all state/timers and closes transports, without needing their close callbacks. */
  dispose(): void;
}

export const DEFAULT_LIMITS: Readonly<RelayHubLimits>;
export function createRelayHub(options?: RelayHubOptions): RelayHub;
export function topicForHostKey(rawKey: Uint8Array): string;
export function sessionAdTopic(relayTopicHex: string): Buffer;
export function serviceAdTopic(): Buffer;
