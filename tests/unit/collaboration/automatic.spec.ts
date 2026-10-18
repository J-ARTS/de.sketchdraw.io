import { describe, expect, it, vi } from 'vitest';
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
import {
  bindCrdtTransport,
  createSessionIdentity,
} from '../../../src/collaboration';
import {
  createAutomaticInvitation,
  createAutomaticRoomCredentials,
  createAutomaticTransport,
  parseAutomaticInvitation,
} from '../../../src/collaboration/automatic';
import type { AutomaticTransportConfig } from '../../../src/collaboration/transport';
import { createCrdtController, createCrdtControllerFromUpdate } from '../../../src/crdt';
import { createDocument } from '../../../src/domain';
import type { PeerSessionKey } from '../../../src/session';

interface FakeAction {
  onMessage: MessageAction<ArrayBuffer>['onMessage'];
  onReceive: MessageAction<ArrayBuffer>['onReceive'];
}

interface FakeEntry {
  id: string;
  roomId: string;
  callbacks: JoinRoomCallbacks;
  room: Room;
  actions: Map<string, FakeAction>;
}

interface CapturedDelivery {
  sender: string;
  receiver: string;
  namespace: string;
  data: ArrayBuffer;
  metadata?: JsonValue;
}

class FakeTrysteroNetwork {
  private nextId = 1;
  private entries = new Map<string, FakeEntry>();
  lastDelivery?: CapturedDelivery;

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
    for (const peer of existing) queueMicrotask(() => { void this.connect(peer, entry); });
    return room;
  };

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
    this.lastDelivery = { ...delivery, data: delivery.data.slice(0) };
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

  async replayLast(): Promise<void> {
    if (!this.lastDelivery) throw new Error('No delivery captured.');
    await this.deliver(this.lastDelivery);
  }
}

const session: PeerSessionKey = {
  documentId: 'document:auto',
  controllerEpoch: '11'.repeat(16),
  sessionId: '22'.repeat(16),
  permissionEpoch: 1,
};

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  throw new Error('Condition was not reached.');
}

async function config(
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

describe('automatic Trystero transport', () => {
  it('creates signed high-entropy invitations with explicit relay and RTC configuration', async () => {
    const identity = await createSessionIdentity();
    const credentials = createAutomaticRoomCredentials();
    expect(credentials.roomId).toMatch(/^[a-f0-9]{64}$/);
    expect(credentials.password).toMatch(/^[a-f0-9]{64}$/);
    const invitationText = await createAutomaticInvitation(identity, {
      appId: 'sketchdraw.test',
      ...credentials,
      relayUrls: ['wss://mqtt.example.test/mqtt'],
      rtcConfig: { iceServers: [{ urls: 'turns:turn.example.test:443?transport=tcp', username: 'user', credential: 'secret' }] },
      session,
      role: 'editor',
    }, 1000);
    const parsed = await parseAutomaticInvitation(invitationText, 2000);
    expect(parsed.invitation).toMatchObject({ roomId: credentials.roomId, password: credentials.password, role: 'editor' });
    expect(parsed.ownerKeyHash).toBe(identity.keyHash);
    await expect(parseAutomaticInvitation(invitationText, 1000 + 5 * 60_000 + 1)).rejects.toThrow();
    const tampered = `${invitationText.slice(0, -1)}${invitationText.endsWith('a') ? 'b' : 'a'}`;
    await expect(parseAutomaticInvitation(tampered, 2000)).rejects.toThrow();
  });

  it('rejects peers bound to another document session and revokes a closed transport', async () => {
    const network = new FakeTrysteroNetwork();
    const credentials = createAutomaticRoomCredentials();
    const ownerConfig = await config({ role: 'owner', grantId: 'grant:owner', grantGeneration: 0 }, credentials);
    const guestConfig = await config({ role: 'editor', grantId: 'grant:guest', grantGeneration: 0 }, credentials);
    guestConfig.session = { ...guestConfig.session, documentId: 'document:other' };
    ownerConfig.authorizePeer = () => ({ role: 'editor', grantId: 'grant:guest', grantGeneration: 0 });
    guestConfig.authorizePeer = () => ({ role: 'owner', grantId: 'grant:owner', grantGeneration: 0 });
    const owner = await createAutomaticTransport(ownerConfig, { joinRoom: network.joinRoom, now: () => 1000 });
    const guest = await createAutomaticTransport(guestConfig, { joinRoom: network.joinRoom, now: () => 1000 });
    await waitFor(() => owner.getStatus().state === 'error' && guest.getStatus().state === 'error');
    expect(owner.getStatus().peers).toHaveLength(0);
    await owner.close();
    await expect(owner.send('sync', new Uint8Array([1]))).rejects.toThrow('TRANSPORT_CLOSED');
    await guest.close();
  });

  it('authenticates peers, binds actions to grants and rejects replayed envelopes', async () => {
    const network = new FakeTrysteroNetwork();
    const credentials = createAutomaticRoomCredentials();
    const ownerConfig = await config({ role: 'owner', grantId: 'grant:owner', grantGeneration: 1 }, credentials);
    const editorConfig = await config({ role: 'editor', grantId: 'grant:editor', grantGeneration: 2 }, credentials);
    ownerConfig.authorizePeer = request => request.keyHash === editorConfig.identity.keyHash ? { role: 'editor', grantId: 'grant:editor', grantGeneration: 2 } : null;
    editorConfig.authorizePeer = request => request.keyHash === ownerConfig.identity.keyHash ? { role: 'owner', grantId: 'grant:owner', grantGeneration: 1 } : null;
    const owner = await createAutomaticTransport(ownerConfig, { joinRoom: network.joinRoom, now: () => 1000 });
    const editor = await createAutomaticTransport(editorConfig, { joinRoom: network.joinRoom, now: () => 1000 });
    await waitFor(() => owner.getStatus().state === 'ready' && editor.getStatus().state === 'ready');
    const received = vi.fn();
    owner.subscribeMessage(received);
    await editor.send('update', new Uint8Array([1, 2, 3]));
    await waitFor(() => received.mock.calls.length === 1);
    expect(received).toHaveBeenCalledWith(expect.objectContaining({ channel: 'update', data: new Uint8Array([1, 2, 3]), peer: expect.objectContaining({ role: 'editor', grantId: 'grant:editor' }) }));
    await expect(network.replayLast()).rejects.toThrow();
    await owner.close();
    await editor.close();
  });

  it('prevents viewers and unknown peers from sending document updates', async () => {
    const network = new FakeTrysteroNetwork();
    const credentials = createAutomaticRoomCredentials();
    const ownerConfig = await config({ role: 'owner', grantId: 'grant:owner', grantGeneration: 0 }, credentials);
    const viewerConfig = await config({ role: 'viewer', grantId: 'grant:viewer', grantGeneration: 0 }, credentials);
    ownerConfig.authorizePeer = request => request.keyHash === viewerConfig.identity.keyHash ? { role: 'viewer', grantId: 'grant:viewer', grantGeneration: 0 } : null;
    viewerConfig.authorizePeer = request => request.keyHash === ownerConfig.identity.keyHash ? { role: 'owner', grantId: 'grant:owner', grantGeneration: 0 } : null;
    const owner = await createAutomaticTransport(ownerConfig, { joinRoom: network.joinRoom, now: () => 1000 });
    const viewer = await createAutomaticTransport(viewerConfig, { joinRoom: network.joinRoom, now: () => 1000 });
    await waitFor(() => owner.getStatus().state === 'ready' && viewer.getStatus().state === 'ready');
    await expect(viewer.send('update', new Uint8Array([1]))).rejects.toThrow('ACCESS_DENIED');
    await viewer.send('awareness', new Uint8Array([1]));
    await owner.close();
    await viewer.close();

    const deniedNetwork = new FakeTrysteroNetwork();
    const deniedOwnerConfig = await config({ role: 'owner', grantId: 'grant:owner', grantGeneration: 0 });
    const deniedGuestConfig = await config({ role: 'editor', grantId: 'grant:guest', grantGeneration: 0 }, {
      roomId: deniedOwnerConfig.roomId,
      password: deniedOwnerConfig.password,
      invitationId: deniedOwnerConfig.invitationId,
    });
    const deniedOwner = await createAutomaticTransport(deniedOwnerConfig, { joinRoom: deniedNetwork.joinRoom, now: () => 1000 });
    const deniedGuest = await createAutomaticTransport(deniedGuestConfig, { joinRoom: deniedNetwork.joinRoom, now: () => 1000 });
    await waitFor(() => deniedOwner.getStatus().state === 'error' && deniedGuest.getStatus().state === 'error');
    expect(deniedOwner.getStatus().peers).toHaveLength(0);
    await deniedOwner.close();
    await deniedGuest.close();
  });

  it('synchronizes validated Yjs updates through the transport bridge', async () => {
    const network = new FakeTrysteroNetwork();
    const credentials = createAutomaticRoomCredentials();
    const ownerConfig = await config({ role: 'owner', grantId: 'grant:owner', grantGeneration: 0 }, credentials);
    const editorConfig = await config({ role: 'editor', grantId: 'grant:editor', grantGeneration: 0 }, credentials);
    ownerConfig.authorizePeer = request => request.keyHash === editorConfig.identity.keyHash ? { role: 'editor', grantId: 'grant:editor', grantGeneration: 0 } : null;
    editorConfig.authorizePeer = request => request.keyHash === ownerConfig.identity.keyHash ? { role: 'owner', grantId: 'grant:owner', grantGeneration: 0 } : null;
    const ownerTransport = await createAutomaticTransport(ownerConfig, { joinRoom: network.joinRoom, now: () => 1000 });
    const editorTransport = await createAutomaticTransport(editorConfig, { joinRoom: network.joinRoom, now: () => 1000 });
    await waitFor(() => ownerTransport.getStatus().state === 'ready' && editorTransport.getStatus().state === 'ready');

    const document = createDocument('Initial');
    document.id = session.documentId;
    const ownerController = createCrdtController(document);
    const editorController = createCrdtControllerFromUpdate(ownerController.encodeUpdate());
    const ownerBinding = bindCrdtTransport(ownerController, ownerTransport);
    const editorBinding = bindCrdtTransport(editorController, editorTransport);
    editorController.dispatch({ type: 'rename', title: 'From editor' }, { actorId: 'actor:editor', expectedRevision: 0, source: 'human' });
    await waitFor(() => ownerController.getSnapshot().document.title === 'From editor');
    expect(ownerController.getSnapshot().document).toEqual(editorController.getSnapshot().document);

    await ownerBinding.close(); await editorBinding.close();
    await ownerTransport.close(); await editorTransport.close();
    ownerController.destroy(); editorController.destroy();
  });

  it('requires explicit WSS relays and rejects embedded relay credentials', async () => {
    const value = await config({ role: 'owner', grantId: 'grant:owner', grantGeneration: 0 });
    await expect(createAutomaticTransport({ ...value, relayUrls: [] })).rejects.toThrow();
    await expect(createAutomaticTransport({ ...value, relayUrls: ['wss://user:secret@example.test/mqtt'] })).rejects.toThrow();
    await expect(createAutomaticTransport({ ...value, roomId: 'weak' })).rejects.toThrow();
  });
});
