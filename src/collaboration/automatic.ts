import { joinRoom as mqttJoinRoom, type JoinRoom, type JsonValue, type MessageAction, type Room } from '@trystero-p2p/mqtt';
import type { PeerSessionKey } from '../session';
import { importKey, sign, signedEnvelope, verify } from './crypto';
import {
  base64,
  decode,
  fail,
  hex,
  id,
  integer,
  parse,
  randomHex,
  record,
  sameSession,
  sessionKey,
  sha,
  shape,
  unbase64,
  utf8,
} from './primitives';
import type {
  AutomaticInvitation,
  AutomaticPeer,
  AutomaticPeerGrant,
  AutomaticTransportConfig,
  CollaborationTransport,
  CollaborationTransportChannel,
  CollaborationTransportMessage,
  CollaborationTransportStatus,
} from './transport';

const HANDSHAKE_LIMIT = 16 * 1024;
const INVITATION_LIMIT = 64 * 1024;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const OUTGOING_LIMIT = 16 * 1024 * 1024;
const DEFAULT_MAX_RECEIVE = 8 * 1024 * 1024;
const CHANNEL_LIMITS: Record<CollaborationTransportChannel, number> = {
  sync: 256 * 1024,
  update: 4 * 1024 * 1024,
  awareness: 64 * 1024,
  asset: 8 * 1024 * 1024,
};
const ACTION_NAMES: Record<CollaborationTransportChannel, string> = {
  sync: 'sd-sync-v1',
  update: 'sd-update-v1',
  awareness: 'sd-aware-v1',
  asset: 'sd-asset-v1',
};

interface HandshakePayload {
  version: 1;
  type: 'automatic-handshake';
  session: PeerSessionKey;
  roomBinding: string;
  invitationId: string;
  publicKeyBase64Url: string;
  keyHash: string;
  nonce: string;
  createdAt: number;
}

interface ActionPayload {
  version: 1;
  type: 'automatic-action';
  session: PeerSessionKey;
  channel: CollaborationTransportChannel;
  senderKeyHash: string;
  grantId: string;
  grantGeneration: number;
  role: AutomaticPeerGrant['role'];
  sequence: number;
  byteLength: number;
  hash: string;
}

interface PeerRuntime extends AutomaticPeer {
  key: CryptoKey;
  lastSequence: Record<CollaborationTransportChannel, number>;
}

export interface AutomaticTransportDependencies {
  joinRoom?: JoinRoom;
  now?: () => number;
}

function checkedRelayUrls(urls: readonly string[]): string[] {
  if (!Array.isArray(urls) || urls.length < 1 || urls.length > 8) throw new TypeError('One to eight explicit MQTT relay URLs are required.');
  return urls.map(value => {
    if (typeof value !== 'string' || value.length > 2048) throw new TypeError('MQTT relay URL is invalid.');
    const url = new URL(value);
    if (url.protocol !== 'wss:' || url.username || url.password || url.hash) throw new TypeError('MQTT relays must use credential-free wss URLs.');
    return url.toString();
  });
}

function checkedIceServers(config: RTCConfiguration): RTCConfiguration {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new TypeError('Explicit RTC configuration is required.');
  const servers = config.iceServers ?? [];
  if (!Array.isArray(servers) || servers.length > 8) throw new TypeError('RTC ICE server configuration is invalid.');
  const iceServers = servers.map(server => {
    if (!server || typeof server !== 'object' || Array.isArray(server)) throw new TypeError('RTC ICE server is invalid.');
    const rawUrls = typeof server.urls === 'string' ? [server.urls] : server.urls;
    if (!Array.isArray(rawUrls) || rawUrls.length < 1 || rawUrls.length > 8) throw new TypeError('RTC ICE server URLs are invalid.');
    const urls = rawUrls.map(value => {
      if (typeof value !== 'string' || value.length > 2048 || !/^(?:stun|stuns|turn|turns):/i.test(value)) throw new TypeError('RTC ICE server URL is invalid.');
      return value;
    });
    if (server.username !== undefined && (typeof server.username !== 'string' || server.username.length > 256)) throw new TypeError('RTC ICE username is invalid.');
    if (server.credential !== undefined && (typeof server.credential !== 'string' || server.credential.length > 512)) throw new TypeError('RTC ICE credential must be a bounded string.');
    return {
      urls: typeof server.urls === 'string' ? urls[0]! : urls,
      ...(server.username !== undefined ? { username: server.username } : {}),
      ...(server.credential !== undefined ? { credential: server.credential } : {}),
    } satisfies RTCIceServer;
  });
  return {
    iceServers,
    iceTransportPolicy: config.iceTransportPolicy ?? 'all',
    bundlePolicy: config.bundlePolicy ?? 'balanced',
    rtcpMuxPolicy: config.rtcpMuxPolicy ?? 'require',
    iceCandidatePoolSize: config.iceCandidatePoolSize ?? 0,
  };
}

function checkedGrant(grant: AutomaticPeerGrant): AutomaticPeerGrant {
  if (!grant || !['owner', 'editor', 'viewer'].includes(grant.role) || !id(grant.grantId) || !integer(grant.grantGeneration)) throw new TypeError('Automatic P2P grant is invalid.');
  return { ...grant };
}

function checkedConfig(config: AutomaticTransportConfig): AutomaticTransportConfig & { relayUrls: string[]; rtcConfig: RTCConfiguration } {
  if (!id(config.appId) || !hex(config.roomId, 32) || !hex(config.password, 32) || !hex(config.invitationId)) throw new TypeError('Automatic P2P room credentials are invalid.');
  sessionKey(config.session);
  if (typeof config.authorizePeer !== 'function') throw new TypeError('Peer authorization callback is required.');
  const maxReceiveBytes = config.maxReceiveBytes ?? DEFAULT_MAX_RECEIVE;
  if (!integer(maxReceiveBytes) || maxReceiveBytes < CHANNEL_LIMITS.update || maxReceiveBytes > DEFAULT_MAX_RECEIVE) throw new TypeError('Automatic P2P receive limit is invalid.');
  return {
    ...config,
    localGrant: checkedGrant(config.localGrant),
    relayUrls: checkedRelayUrls(config.relayUrls),
    rtcConfig: checkedIceServers(config.rtcConfig),
    maxReceiveBytes,
  };
}

function notify<T>(listeners: ReadonlySet<(value: T) => void | Promise<void>>, value: T): void {
  for (const listener of Array.from(listeners)) {
    queueMicrotask(() => {
      try {
        void Promise.resolve(listener(structuredClone(value))).catch(() => undefined);
      } catch {
        // Listener failures do not change transport state.
      }
    });
  }
}

function parseHandshake(value: unknown): HandshakePayload {
  shape(value, ['version', 'type', 'session', 'roomBinding', 'invitationId', 'publicKeyBase64Url', 'keyHash', 'nonce', 'createdAt']);
  sessionKey(value.session);
  if (value.version !== 1 || value.type !== 'automatic-handshake' || !hex(value.roomBinding, 32) || !hex(value.invitationId)
    || typeof value.publicKeyBase64Url !== 'string' || !hex(value.keyHash, 32) || !hex(value.nonce, 32) || !integer(value.createdAt)) fail();
  return value as unknown as HandshakePayload;
}

function parseAction(value: unknown): ActionPayload {
  shape(value, ['version', 'type', 'session', 'channel', 'senderKeyHash', 'grantId', 'grantGeneration', 'role', 'sequence', 'byteLength', 'hash']);
  sessionKey(value.session);
  if (value.version !== 1 || value.type !== 'automatic-action' || !['sync', 'update', 'awareness', 'asset'].includes(String(value.channel))
    || !hex(value.senderKeyHash, 32) || !id(value.grantId) || !integer(value.grantGeneration) || !['owner', 'editor', 'viewer'].includes(String(value.role))
    || !integer(value.sequence) || value.sequence < 1 || !integer(value.byteLength) || !hex(value.hash, 32)) fail();
  return value as unknown as ActionPayload;
}

function actionAllowed(channel: CollaborationTransportChannel, role: AutomaticPeerGrant['role']): boolean {
  return role !== 'viewer' || channel === 'sync' || channel === 'awareness';
}

function iceServerUrls(config: RTCConfiguration): string[] {
  return (config.iceServers ?? []).flatMap(server => typeof server.urls === 'string' ? [server.urls] : Array.from(server.urls));
}

export function createAutomaticRoomCredentials(): { roomId: string; password: string; invitationId: string } {
  return { roomId: randomHex(32), password: randomHex(32), invitationId: randomHex() };
}

export async function createAutomaticInvitation(
  identity: AutomaticTransportConfig['identity'],
  input: Omit<AutomaticInvitation, 'version' | 'type' | 'ownerPublicKeyBase64Url' | 'createdAt' | 'expiresAt'> & { ttlMs?: number },
  now = Date.now(),
): Promise<string> {
  const ttlMs = input.ttlMs ?? MAX_CLOCK_SKEW_MS;
  if (!integer(ttlMs) || ttlMs < 30_000 || ttlMs > MAX_CLOCK_SKEW_MS) throw new TypeError('Invitation lifetime is invalid.');
  const payload: AutomaticInvitation = {
    version: 1,
    type: 'automatic-invitation',
    appId: input.appId,
    roomId: input.roomId,
    password: input.password,
    invitationId: input.invitationId,
    relayUrls: checkedRelayUrls(input.relayUrls),
    rtcConfig: checkedIceServers(input.rtcConfig),
    session: input.session,
    role: input.role,
    ownerPublicKeyBase64Url: identity.publicKeyBase64Url,
    createdAt: now,
    expiresAt: now + ttlMs,
  };
  checkedConfig({ ...payload, identity, localGrant: { role: 'owner', grantId: 'invite:owner', grantGeneration: 0 }, authorizePeer: () => null });
  const encoded = utf8.encode(JSON.stringify(await sign(identity, payload)));
  if (encoded.byteLength > INVITATION_LIMIT) throw new TypeError('Invitation is too large.');
  return base64(encoded);
}

export async function parseAutomaticInvitation(text: string, now = Date.now()): Promise<{ invitation: AutomaticInvitation; ownerKeyHash: string }> {
  const json = decode(unbase64(text, INVITATION_LIMIT));
  const envelope = signedEnvelope(json, INVITATION_LIMIT);
  const value = parse(envelope.payload, INVITATION_LIMIT);
  shape(value, ['version', 'type', 'appId', 'roomId', 'password', 'invitationId', 'relayUrls', 'rtcConfig', 'session', 'role', 'ownerPublicKeyBase64Url', 'createdAt', 'expiresAt']);
  if (value.version !== 1 || value.type !== 'automatic-invitation' || !id(value.appId) || !hex(value.roomId, 32) || !hex(value.password, 32)
    || !hex(value.invitationId) || !Array.isArray(value.relayUrls) || !record(value.rtcConfig) || !['editor', 'viewer'].includes(String(value.role))
    || typeof value.ownerPublicKeyBase64Url !== 'string' || !integer(value.createdAt) || !integer(value.expiresAt)
    || value.expiresAt <= value.createdAt || value.expiresAt - value.createdAt > MAX_CLOCK_SKEW_MS || now > value.expiresAt || value.createdAt > now + 60_000) fail('ACCESS_DENIED', 'INVITATION_EXPIRED');
  sessionKey(value.session);
  checkedRelayUrls(value.relayUrls as string[]);
  checkedIceServers(value.rtcConfig as RTCConfiguration);
  const key = await importKey(value.ownerPublicKeyBase64Url);
  await verify(envelope, key);
  return { invitation: value as unknown as AutomaticInvitation, ownerKeyHash: await sha(unbase64(value.ownerPublicKeyBase64Url, 65)) };
}

export async function createAutomaticTransport(
  rawConfig: AutomaticTransportConfig,
  dependencies: AutomaticTransportDependencies = {},
): Promise<CollaborationTransport> {
  const config = checkedConfig(rawConfig);
  const now = dependencies.now ?? Date.now;
  const roomBinding = await sha(`sketchdraw.auto.v1\n${config.appId}\n${config.roomId}\n${config.invitationId}`);
  const peers = new Map<string, PeerRuntime>();
  const peerSequences = new Map<string, Record<CollaborationTransportChannel, number>>();
  const statusListeners = new Set<(status: CollaborationTransportStatus) => void>();
  const messageListeners = new Set<(message: CollaborationTransportMessage) => void | Promise<void>>();
  const sequence: Record<CollaborationTransportChannel, number> = { sync: 0, update: 0, awareness: 0, asset: 0 };
  let outgoingBytes = 0;
  let closed = false;
  let transportState: CollaborationTransportStatus['state'] = 'connecting';
  let transportError: string | undefined;
  let room!: Room;

  function publicPeer(peer: PeerRuntime): AutomaticPeer {
    const { key: _key, lastSequence: _lastSequence, ...value } = peer;
    return value;
  }

  function status(): CollaborationTransportStatus {
    const value: CollaborationTransportStatus = {
      mode: 'automatic-p2p',
      state: transportState,
      peers: Array.from(peers.values(), publicPeer).sort((a, b) => a.peerId.localeCompare(b.peerId)),
      relayUrls: [...config.relayUrls],
      iceServers: iceServerUrls(config.rtcConfig),
    };
    if (transportError !== undefined) value.error = transportError;
    return value;
  }

  function publishStatus(): void {
    notify(statusListeners, status());
  }

  async function handshake(peerId: string, send: (data: string) => Promise<void>, receive: () => Promise<{ data: unknown }>): Promise<void> {
    const createdAt = now();
    const own: HandshakePayload = {
      version: 1,
      type: 'automatic-handshake',
      session: config.session,
      roomBinding,
      invitationId: config.invitationId,
      publicKeyBase64Url: config.identity.publicKeyBase64Url,
      keyHash: config.identity.keyHash,
      nonce: randomHex(32),
      createdAt,
    };
    await send(JSON.stringify(await sign(config.identity, own)));
    const received = await receive();
    if (typeof received.data !== 'string') fail('ACCESS_DENIED');
    const envelope = signedEnvelope(received.data, HANDSHAKE_LIMIT);
    const payload = parseHandshake(parse(envelope.payload, HANDSHAKE_LIMIT));
    if (!sameSession(payload.session, config.session) || payload.roomBinding !== roomBinding || payload.invitationId !== config.invitationId
      || Math.abs(now() - payload.createdAt) > MAX_CLOCK_SKEW_MS) fail('ACCESS_DENIED', 'AUTOMATIC_HANDSHAKE_MISMATCH');
    const key = await importKey(payload.publicKeyBase64Url);
    await verify(envelope, key);
    if (await sha(unbase64(payload.publicKeyBase64Url, 65)) !== payload.keyHash) fail('ACCESS_DENIED', 'IDENTITY_KEY_MISMATCH');
    if (Array.from(peers.values()).some(peer => peer.keyHash === payload.keyHash && peer.peerId !== peerId)) fail('SESSION_CHANGED', 'DUPLICATE_PEER_IDENTITY');
    const grant = await config.authorizePeer({
      peerId,
      keyHash: payload.keyHash,
      publicKeyBase64Url: payload.publicKeyBase64Url,
      invitationId: payload.invitationId,
      session: payload.session,
    });
    if (!grant) fail('ACCESS_DENIED', 'PEER_NOT_AUTHORIZED');
    const checked = checkedGrant(grant);
    let lastSequence = peerSequences.get(payload.keyHash);
    if (!lastSequence) {
      lastSequence = { sync: 0, update: 0, awareness: 0, asset: 0 };
      peerSequences.set(payload.keyHash, lastSequence);
    }
    peers.set(peerId, {
      peerId,
      keyHash: payload.keyHash,
      publicKeyBase64Url: payload.publicKeyBase64Url,
      invitationId: payload.invitationId,
      ...checked,
      key,
      lastSequence,
    });
  }

  const join = dependencies.joinRoom ?? mqttJoinRoom;
  room = join({
    appId: config.appId,
    password: config.password,
    maxReceiveBytes: config.maxReceiveBytes,
    relayConfig: { urls: [...config.relayUrls], warnOnRelayFailure: true },
    rtcConfig: config.rtcConfig,
    trickleIce: true,
  }, config.roomId, {
    handshakeTimeoutMs: 20_000,
    onPeerHandshake: (peerId, send, receive) => handshake(peerId, data => send(data), receive as () => Promise<{ data: unknown }>),
    onJoinError: details => {
      transportState = 'error';
      transportError = details.error.slice(0, 512);
      publishStatus();
    },
  });

  const actions = {} as Record<CollaborationTransportChannel, MessageAction<ArrayBuffer>>;
  for (const channel of Object.keys(ACTION_NAMES) as CollaborationTransportChannel[]) {
    const action = room.makeAction<ArrayBuffer>(ACTION_NAMES[channel]);
    action.onReceive = ({ peerId, byteLength }) => {
      const peer = peers.get(peerId);
      return !!peer && byteLength > 0 && byteLength <= CHANNEL_LIMITS[channel] && actionAllowed(channel, peer.role);
    };
    action.onMessage = async (buffer, context) => {
      if (closed || !(buffer instanceof ArrayBuffer)) return;
      const peer = peers.get(context.peerId);
      if (!peer || !actionAllowed(channel, peer.role) || buffer.byteLength < 1 || buffer.byteLength > CHANNEL_LIMITS[channel]) fail('ACCESS_DENIED');
      if (!record(context.metadata)) fail();
      const envelope = signedEnvelope(JSON.stringify(context.metadata), HANDSHAKE_LIMIT);
      const payload = parseAction(parse(envelope.payload, HANDSHAKE_LIMIT));
      if (!sameSession(payload.session, config.session) || payload.channel !== channel || payload.senderKeyHash !== peer.keyHash
        || payload.grantId !== peer.grantId || payload.grantGeneration !== peer.grantGeneration || payload.role !== peer.role
        || payload.byteLength !== buffer.byteLength || payload.sequence <= peer.lastSequence[channel]) fail('ACCESS_DENIED');
      await verify(envelope, peer.key);
      if (await sha(new Uint8Array(buffer)) !== payload.hash) fail('ACCESS_DENIED', 'ACTION_HASH_MISMATCH');
      peer.lastSequence[channel] = payload.sequence;
      notify(messageListeners, { channel, data: new Uint8Array(buffer), peer: publicPeer(peer) });
    };
    actions[channel] = action;
  }

  room.onPeerJoin = peerId => {
    if (!peers.has(peerId)) {
      room.getPeers()[peerId]?.close();
      return;
    }
    transportState = 'ready';
    transportError = undefined;
    publishStatus();
  };
  room.onPeerLeave = peerId => {
    peers.delete(peerId);
    if (!closed) transportState = peers.size ? 'ready' : 'connecting';
    publishStatus();
  };

  const transport: CollaborationTransport = {
    mode: 'automatic-p2p',
    getStatus: status,
    subscribeStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    subscribeMessage(listener) {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    },
    async send(channel, data, targetPeerIds): Promise<void> {
      if (closed) throw new Error('TRANSPORT_CLOSED');
      if (!(data instanceof Uint8Array) || data.byteLength < 1 || data.byteLength > CHANNEL_LIMITS[channel]) throw new Error('TRANSPORT_MESSAGE_LIMIT');
      if (!actionAllowed(channel, config.localGrant.role)) throw new Error('ACCESS_DENIED');
      const targets = targetPeerIds === undefined ? Array.from(peers.keys()) : Array.from(new Set(targetPeerIds));
      if (!targets.length || targets.some(peerId => !peers.has(peerId))) throw new Error('PEER_NOT_AUTHORIZED');
      if (outgoingBytes + data.byteLength > OUTGOING_LIMIT) throw new Error('TRANSPORT_BACKPRESSURE');
      outgoingBytes += data.byteLength;
      try {
        const nextSequence = sequence[channel] + 1;
        if (!Number.isSafeInteger(nextSequence)) throw new Error('SEQUENCE_OVERFLOW');
        sequence[channel] = nextSequence;
        const payload: ActionPayload = {
          version: 1,
          type: 'automatic-action',
          session: config.session,
          channel,
          senderKeyHash: config.identity.keyHash,
          grantId: config.localGrant.grantId,
          grantGeneration: config.localGrant.grantGeneration,
          role: config.localGrant.role,
          sequence: nextSequence,
          byteLength: data.byteLength,
          hash: await sha(data),
        };
        const metadata = await sign(config.identity, payload) as unknown as JsonValue;
        const copy = Uint8Array.from(data);
        await actions[channel].send(copy.buffer, { target: targets, metadata });
      } finally {
        outgoingBytes -= data.byteLength;
      }
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      transportState = 'closed';
      peers.clear();
      peerSequences.clear();
      await room.leave();
      publishStatus();
      statusListeners.clear();
      messageListeners.clear();
    },
  };
  return transport;
}
