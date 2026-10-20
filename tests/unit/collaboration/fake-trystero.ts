import type {
  ActionReceiveContext,
  DataPayload,
  HandshakePayload,
  JoinRoom,
  JoinRoomCallbacks,
  JsonValue,
  MessageAction,
  MessageActionConfig,
  MessageContext,
  Room,
} from '@trystero-p2p/mqtt';
import { createSessionIdentity } from '../../../src/collaboration';
import { createAutomaticRoomCredentials, createAutomaticTransport } from '../../../src/collaboration/automatic';
import type { AutomaticTransportConfig, CollaborationTransport } from '../../../src/collaboration/transport';
import type { PeerSessionKey } from '../../../src/session';

// Deterministic in-memory replacement for the Trystero room network. Crypto and the transport stay real.
// It cannot prove ICE/DTLS, broker, proxy or TURN behaviour (see docs/network-test-plan.md).
export interface FakeAction {
  onMessage: MessageAction<ArrayBuffer>['onMessage'];
  onReceive: MessageAction<ArrayBuffer>['onReceive'];
}

export interface FakeEntry {
  id: string;
  roomId: string;
  callbacks: JoinRoomCallbacks;
  room: Room;
  actions: Map<string, FakeAction>;
}

export interface CapturedDelivery {
  sender: string;
  receiver: string;
  namespace: string;
  data: ArrayBuffer;
  metadata?: JsonValue;
}

export class FakeTrysteroNetwork {
  private nextId = 1;
  private entries = new Map<string, FakeEntry>();
  private gate: Promise<void> | undefined;
  private brokerAvailable = true;
  private waitingForBroker: Array<[FakeEntry, FakeEntry]> = [];
  private dropped = new Map<string, FakeEntry>();
  lastDelivery?: CapturedDelivery;
  /** Every delivery that reached a receiver (accepted or rejected), in order. */
  readonly log: CapturedDelivery[] = [];
  /** Deliveries currently waiting for the gate or for the receiver to finish. */
  inFlight = 0;

  readonly joinRoom: JoinRoom = (_config, roomId, callbacks = {}) => {
    const id = `peer:${this.nextId++}`;
    const actions = new Map<string, FakeAction>();
    let entry!: FakeEntry;
    const room = {
      makeAction: <T extends DataPayload>(namespace: string, actionConfig?: MessageActionConfig<T>) => {
        const action: FakeAction = {
          onMessage: (actionConfig?.onMessage ?? null) as FakeAction['onMessage'],
          onReceive: (actionConfig?.onReceive ?? null) as FakeAction['onReceive'],
        };
        actions.set(namespace, action);
        return {
          async send(data: T, options?: { target?: string | string[] | null; metadata?: JsonValue }): Promise<void> {
            if (!(data instanceof ArrayBuffer)) throw new Error('Fake network only accepts ArrayBuffer actions.');
            const requested = options?.target == null ? Array.from(thisNetwork.entries.values()).filter(item => item.roomId === roomId && item.id !== id).map(item => item.id)
              : typeof options.target === 'string' ? [options.target] : options.target;
            for (const receiverId of requested) await thisNetwork.deliver({ sender: id, receiver: receiverId, namespace, data: data.slice(0), ...(options?.metadata === undefined ? {} : { metadata: options.metadata }) });
          },
          get onMessage() { return action.onMessage as never; },
          set onMessage(value) { action.onMessage = value as FakeAction['onMessage']; },
          onReceiveProgress: null,
          get onReceive() { return action.onReceive as never; },
          set onReceive(value) { action.onReceive = value as FakeAction['onReceive']; },
        } as MessageAction<T>;
      },
      ping: async () => 1,
      leave: async () => {
        this.entries.delete(id);
        for (const peer of this.entries.values()) if (peer.roomId === roomId) peer.room.onPeerLeave?.(id);
      },
      isPassive: () => false,
      getPeers: () => ({}),
      addStream: () => [], removeStream: () => {}, addTrack: () => [], removeTrack: () => {}, replaceTrack: () => [],
      onPeerJoin: null, onPeerLeave: null, onPeerStream: null, onPeerTrack: null,
    } as unknown as Room;
    const thisNetwork = this;
    entry = { id, roomId, callbacks, room, actions };
    const existing = Array.from(this.entries.values()).filter(item => item.roomId === roomId);
    this.entries.set(id, entry);
    for (const peer of existing) this.scheduleConnect(peer, entry);
    return room;
  };

  /** Peer discovery needs the signaling broker; established connections do not. */
  private scheduleConnect(left: FakeEntry, right: FakeEntry): void {
    if (!this.brokerAvailable) {
      this.waitingForBroker.push([left, right]);
      return;
    }
    queueMicrotask(() => { void this.connect(left, right); });
  }

  private async connect(left: FakeEntry, right: FakeEntry): Promise<void> {
    type Waiter = (payload: HandshakePayload) => void;
    const leftQueue: HandshakePayload[] = [];
    const rightQueue: HandshakePayload[] = [];
    let leftWaiter: Waiter | undefined;
    let rightWaiter: Waiter | undefined;
    const sendLeft = async (data: DataPayload, metadata?: JsonValue) => {
      const payload: HandshakePayload = { data, ...(metadata === undefined ? {} : { metadata }) };
      if (rightWaiter) { const resolve = rightWaiter; rightWaiter = undefined; resolve(payload); } else rightQueue.push(payload);
    };
    const sendRight = async (data: DataPayload, metadata?: JsonValue) => {
      const payload: HandshakePayload = { data, ...(metadata === undefined ? {} : { metadata }) };
      if (leftWaiter) { const resolve = leftWaiter; leftWaiter = undefined; resolve(payload); } else leftQueue.push(payload);
    };
    const receiveLeft = async () => leftQueue.shift() ?? await new Promise<HandshakePayload>(resolve => { leftWaiter = resolve; });
    const receiveRight = async () => rightQueue.shift() ?? await new Promise<HandshakePayload>(resolve => { rightWaiter = resolve; });
    try {
      await Promise.all([
        left.callbacks.onPeerHandshake?.(right.id, sendLeft, receiveLeft, true),
        right.callbacks.onPeerHandshake?.(left.id, sendRight, receiveRight, false),
      ]);
      left.room.onPeerJoin?.(right.id);
      right.room.onPeerJoin?.(left.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'HANDSHAKE_FAILED';
      left.callbacks.onJoinError?.({ error: message, appId: 'test', roomId: left.roomId, peerId: right.id });
      right.callbacks.onJoinError?.({ error: message, appId: 'test', roomId: right.roomId, peerId: left.id });
    }
  }

  private async deliver(delivery: CapturedDelivery): Promise<void> {
    this.inFlight += 1;
    try {
      if (this.gate) await this.gate;
      await this.deliverNow(delivery);
    } finally {
      this.inFlight -= 1;
    }
  }

  private async deliverNow(delivery: CapturedDelivery): Promise<void> {
    if (!this.entries.has(delivery.sender)) throw new Error('TRANSFER_ABORTED');
    this.lastDelivery = { ...delivery, data: delivery.data.slice(0) };
    this.log.push(this.lastDelivery);
    const receiver = this.entries.get(delivery.receiver);
    const action = receiver?.actions.get(delivery.namespace);
    if (!receiver || !action) throw new Error('Receiver action is missing.');
    const receiveContext: ActionReceiveContext = {
      peerId: delivery.sender,
      byteLength: delivery.data.byteLength,
      kind: 'message',
      signal: new AbortController().signal,
      ...(delivery.metadata === undefined ? {} : { metadata: delivery.metadata }),
    };
    if (action.onReceive && !await action.onReceive(receiveContext)) throw new Error('RECEIVE_REJECTED');
    const context: MessageContext = { peerId: delivery.sender, ...(delivery.metadata === undefined ? {} : { metadata: delivery.metadata }) };
    await action.onMessage?.(delivery.data.slice(0), context);
  }

  /** Peer ids in join order (peer:1 joined first). */
  peerIds(): string[] {
    return Array.from(this.entries.keys());
  }

  /** Holds every delivery until the returned function is called (simulates a slow or stalled link). */
  hold(): () => void {
    let release!: () => void;
    this.gate = new Promise<void>(resolve => { release = resolve; });
    return () => {
      this.gate = undefined;
      release();
    };
  }

  /** Simulates a lost peer connection: both sides notice the loss, neither leaves gracefully. */
  drop(peerId: string): void {
    const entry = this.entries.get(peerId);
    if (!entry) throw new Error('Unknown fake peer.');
    this.entries.delete(peerId);
    this.dropped.set(peerId, entry);
    for (const peer of this.entries.values()) {
      if (peer.roomId !== entry.roomId) continue;
      peer.room.onPeerLeave?.(peerId);
      entry.room.onPeerLeave?.(peer.id);
    }
  }

  /** The dropped peer finds the room again (same transport instance) and re-runs the handshake with everyone. */
  reconnect(peerId: string): void {
    const entry = this.dropped.get(peerId);
    if (!entry) throw new Error('Peer was not dropped.');
    this.dropped.delete(peerId);
    const existing = Array.from(this.entries.values()).filter(item => item.roomId === entry.roomId);
    this.entries.set(peerId, entry);
    for (const peer of existing) this.scheduleConnect(peer, entry);
  }

  /** While the broker is unreachable no new peer can be discovered; established connections keep working. */
  setBrokerAvailable(available: boolean): void {
    this.brokerAvailable = available;
    if (!available) return;
    const waiting = this.waitingForBroker;
    this.waitingForBroker = [];
    for (const [left, right] of waiting) this.scheduleConnect(left, right);
  }

  /** Delivers a previously captured message a second time (duplicate or replayed delivery). */
  async replay(index: number): Promise<void> {
    const delivery = this.log[index];
    if (!delivery) throw new Error('No such delivery.');
    await this.deliver(delivery);
  }

  async replayLast(): Promise<void> {
    if (!this.lastDelivery) throw new Error('No delivery captured.');
    await this.deliver(this.lastDelivery);
  }
}

export const session: PeerSessionKey = {
  documentId: 'document:auto',
  controllerEpoch: '11'.repeat(16),
  sessionId: '22'.repeat(16),
  permissionEpoch: 1,
};

export async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  throw new Error('Condition was not reached.');
}

export async function config(
  grant: AutomaticTransportConfig['localGrant'],
  credentials = createAutomaticRoomCredentials(),
): Promise<AutomaticTransportConfig> {
  return {
    appId: 'sketchdraw.test',
    ...credentials,
    relayUrls: ['wss://mqtt.example.test/mqtt'],
    rtcConfig: { iceServers: [] },
    session,
    identity: await createSessionIdentity(),
    localGrant: grant,
    authorizePeer: () => null,
  };
}


export interface Mesh {
  transports: CollaborationTransport[];
  configs: AutomaticTransportConfig[];
}

/**
 * Creates `count` participants of one room. Participant 0 is the owner; everyone grants every known
 * participant the editor role (the owner as owner), so the room forms a full mesh.
 */
export async function createMesh(
  network: FakeTrysteroNetwork,
  count: number,
  tweak: (config: AutomaticTransportConfig, index: number) => void = () => {},
): Promise<Mesh> {
  const credentials = createAutomaticRoomCredentials();
  const configs: AutomaticTransportConfig[] = [];
  for (let index = 0; index < count; index += 1) {
    const own = await config(index === 0
      ? { role: 'owner', grantId: 'grant:owner', grantGeneration: 0 }
      : { role: 'editor', grantId: `grant:member:${index}`, grantGeneration: 0 }, credentials);
    configs.push(own);
  }
  const grants = new Map(configs.map((value, index) => [value.identity.keyHash, index === 0
    ? { role: 'owner' as const, grantId: 'grant:owner', grantGeneration: 0 }
    : { role: 'editor' as const, grantId: `grant:member:${index}`, grantGeneration: 0 }]));
  configs.forEach((value, index) => {
    value.authorizePeer = request => request.keyHash === value.identity.keyHash ? null : grants.get(request.keyHash) ?? null;
    tweak(value, index);
  });
  const transports: CollaborationTransport[] = [];
  for (const value of configs) transports.push(await createAutomaticTransport(value, { joinRoom: network.joinRoom, now: () => 1000 }));
  return { transports, configs };
}
