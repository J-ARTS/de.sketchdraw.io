import type {
  AutomaticPeer, CollaborationTransport, CollaborationTransportChannel, CollaborationTransportMessage, CollaborationTransportStatus,
} from '../transport';
import { openChannelIo, type ChannelIo, type ChannelTiming } from './channel-io';
import {
  actionAllowed, AUTH_TIMEOUT_MS, AUTOMATIC_DEFAULT_MAX_PARTICIPANTS, base64UrlToBytes, bytesToBase64Url, bytesToHex, CHANNEL_BY_TYPE, CHANNEL_LIMITS,
  CHANNEL_TYPE, constantTimeEqual, HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS, jsonBody, MESSAGE, OUTGOING_LIMIT_BYTES, parseJsonBody, randomHex,
} from './codec';
import type { DirectLink } from './direct-link';
import { computePinProof, type HdhtInvitation, PinGate } from './invitation';
import { type HostKeys, hostKeyToText } from './relay-channel';
import { connectViaHelpers, BadHelpers, PeerRelayHosts, rejectHelperChannel } from './peer-relay';
import { connectRelayGuest, type PacerOptions, RelayHostConnection, type RelayHostState } from './relay-wire';
import type { SecureChannel, WebSocketFactory } from './types';

const MAX_PENDING_AUTH = 8;
const DEFAULT_TIMING: ChannelTiming = { heartbeatMs: HEARTBEAT_INTERVAL_MS, timeoutMs: HEARTBEAT_TIMEOUT_MS };
const FINAL_PEER_REASONS: Readonly<Record<string, string>> = { 'PEER_BYE:SESSION_ENDED': 'SESSION_ENDED', 'PEER_BYE:KICKED': 'KICKED' };
const FATAL_AUTH_CODES = new Set(['PIN_INVALID', 'PIN_LOCKED', 'PIN_RETIRED', 'ROOM_FULL', 'DOCUMENT_MISMATCH', 'INVITATION_EXPIRED', 'SESSION_ENDED']);
const SYNC_FAILURE_REASONS = new Set(['SYNC_FAILED', 'DOCUMENT_TOO_LARGE_FOR_COLLABORATION']);
const STABLE_SESSION_MS = 30_000;
const MAX_PIN_RETRY_MS = 15 * 60_000;

function boundedNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
}

function peerFor(peerId: string, binding: Uint8Array, role: AutomaticPeer['role'], sessionId: string, keyHash: string): AutomaticPeer {
  void binding;
  return { peerId, keyHash, publicKeyBase64Url: '', invitationId: sessionId.slice(0, 32), role, grantId: `hdht:${peerId}`, grantGeneration: 0 };
}

function notifyAll<T>(listeners: ReadonlySet<(value: T) => void | Promise<void>>, value: T, copy: (value: T) => T = structuredClone): void {
  for (const listener of Array.from(listeners)) {
    queueMicrotask(() => {
      try { void Promise.resolve(listener(copy(value))).catch(() => undefined); } catch { /* listener failures do not change transport state */ }
    });
  }
}

function copyMessage(message: CollaborationTransportMessage): CollaborationTransportMessage {
  return { channel: message.channel, data: message.data, peer: { ...message.peer } };
}

export interface HdhtHostConfig {
  sessionId: string;
  documentId: string;
  hostKeys: HostKeys;
  pinGate?: PinGate;
  /** Role granted to guests that join from now on; evaluated at authentication time. */
  grantedRole(): 'editor' | 'viewer';
  /** Host-owned deadline for NEW authentications; the link's own expiry is only a hint for guests. */
  expiresAt: number;
  now?: () => number;
  direct?: { link: DirectLink; publicKey: string };
  /** Registers at volunteer relay helpers found through the DHT (native only); no endpoint is configured. */
  peers?: { link: DirectLink; target?: number; retryMs?: number; steadyMs?: number; pacer?: PacerOptions };
  relay?: { url: string; factory?: WebSocketFactory; backoffMs?: readonly number[]; pacer?: PacerOptions };
  maxParticipants?: number;
  timing?: ChannelTiming;
  authTimeoutMs?: number;
}

export interface HdhtHostTransport extends CollaborationTransport {
  readonly hostKey: string;
  readonly directKey: string;
  readonly relayUrl: string;
  readonly expiresAt: number;
  /** Adds a native listener after it became ready; helper/WSS discovery need not wait for UDP startup. */
  attachDirect(link: DirectLink, publicKey: string): void;
  getPin(): string;
  renewPin(): string;
  readonly pinRemainingFailures: number;
  /** Disconnects one guest and tells it the host closed the connection. */
  kick(peerId: string): void;
  /** Releases one connection under temporary shared sync pressure; the guest may reconnect. */
  retryPeer(peerId: string): void;
}

interface HostPeer { peer: AutomaticPeer; io: ChannelIo }

export function createHdhtHostTransport(config: HdhtHostConfig): HdhtHostTransport {
  const gate = config.pinGate ?? new PinGate();
  const maxParticipants = config.maxParticipants ?? AUTOMATIC_DEFAULT_MAX_PARTICIPANTS;
  const timing = config.timing ?? DEFAULT_TIMING;
  const peers = new Map<string, HostPeer>();
  const pending = new Set<ChannelIo>();
  const statusListeners = new Set<(status: CollaborationTransportStatus) => void>();
  const messageListeners = new Set<(message: CollaborationTransportMessage) => void | Promise<void>>();
  let outgoing = 0;
  let closed = false;
  let closeError: string | undefined;
  let relayState: RelayHostState | 'off' = config.relay ? 'connecting' : 'off';
  let helperCount = 0;
  let relayDetail: string | undefined;
  let relay: RelayHostConnection | null = null;
  let direct = config.direct;

  const status = (): CollaborationTransportStatus => {
    const listening = relayState === 'ready' || !!direct || helperCount > 0;
    const value: CollaborationTransportStatus = {
      mode: 'hyperdht-relay',
      state: closed ? 'closed' : listening ? 'ready' : relayState === 'off' && !config.peers ? 'error' : 'connecting',
      peers: Array.from(peers.values(), entry => ({ ...entry.peer })).sort((a, b) => a.peerId.localeCompare(b.peerId)),
      relayUrls: config.relay ? [config.relay.url] : [],
      iceServers: [],
      helpers: helperCount,
    };
    if (closeError) value.error = closeError;
    else if (!closed && relayState === 'backoff' && !direct && helperCount === 0) value.error = relayDetail ?? 'RELAY_UNAVAILABLE';
    return value;
  };
  const publish = () => notifyAll(statusListeners, status());

  function adopt(channel: SecureChannel): void {
    if (closed || pending.size >= MAX_PENDING_AUTH) { channel.close('BUSY'); return; }
    let authed: HostPeer | null = null;
    let attempted = false;
    let ioRef: ChannelIo | null = null;
    const authTimer = setTimeout(() => ioRef?.close('AUTH_TIMEOUT'), config.authTimeoutMs ?? AUTH_TIMEOUT_MS);

    const authenticate = async (io: ChannelIo, body: Uint8Array): Promise<void> => {
      let proof: Uint8Array;
      try {
        const parsed = parseJsonBody(body, 256);
        if (Object.keys(parsed).join(',') !== 'proof' || typeof parsed['proof'] !== 'string') throw new Error('PROTOCOL_ERROR');
        proof = base64UrlToBytes(parsed['proof'], 32);
      } catch { io.close('PROTOCOL_ERROR'); return; }
      const now = config.now ?? Date.now;
      if (now() > config.expiresAt) {
        await io.send(MESSAGE.authFail, jsonBody({ code: 'INVITATION_EXPIRED', retryAfterMs: 0, attemptsLeft: 0 })).catch(() => undefined);
        io.close('AUTH_FAILED');
        return;
      }
      const result = await gate.attempt(async pin => constantTimeEqual(await computePinProof(pin, io.binding, config.sessionId), proof));
      if (io.closed) return;
      if (!result.ok) {
        const code = result.code === 'PIN_STALE' ? 'PIN_INVALID' : result.code;
        await io.send(MESSAGE.authFail, jsonBody({ code, retryAfterMs: result.retryAfterMs, attemptsLeft: result.attemptsLeft })).catch(() => undefined);
        io.close('AUTH_FAILED');
        return;
      }
      // Everything from here to the registration is synchronous: capacity and deadline are checked right before insertion.
      const refusal = now() > config.expiresAt ? 'INVITATION_EXPIRED' : closed ? 'SESSION_ENDED' : peers.size + 1 >= maxParticipants ? 'ROOM_FULL' : null;
      if (refusal) {
        await io.send(MESSAGE.authFail, jsonBody({ code: refusal, retryAfterMs: 0, attemptsLeft: 0 })).catch(() => undefined);
        io.close(refusal === 'SESSION_ENDED' ? 'SESSION_ENDED' : 'AUTH_FAILED');
        return;
      }
      const role = config.grantedRole();
      const peerId = randomHex(16);
      const peer = peerFor(peerId, io.binding, role, config.sessionId, bytesToHex(io.binding));
      authed = { peer, io };
      clearTimeout(authTimer);
      pending.delete(io);
      peers.set(peerId, authed);
      await io.send(MESSAGE.authOk, jsonBody({ role, documentId: config.documentId })).catch(() => undefined);
      if (!io.closed) publish();
    };

    const io = openChannelIo(channel, {
      message(type, body) {
        if (!authed) {
          if (type !== MESSAGE.auth || attempted) { io.close('PROTOCOL_ERROR'); return; }
          attempted = true;
          void authenticate(io, body).catch(() => io.close('INTERNAL_ERROR'));
          return;
        }
        const name = CHANNEL_BY_TYPE.get(type);
        if (!name || body.byteLength < 1 || body.byteLength > CHANNEL_LIMITS[name]) { io.close('PROTOCOL_ERROR'); return; }
        if (!actionAllowed(name, authed.peer.role)) { io.close('ACCESS_DENIED'); return; }
        notifyAll(messageListeners, { channel: name, data: body, peer: authed.peer }, copyMessage);
      },
      close() {
        clearTimeout(authTimer);
        pending.delete(io);
        if (authed && peers.get(authed.peer.peerId) === authed) { peers.delete(authed.peer.peerId); if (!closed) publish(); }
      },
    }, timing);
    ioRef = io;
    pending.add(io);
    io.start();
  }

  if (direct) direct.link.setIncomingHandler(adopt);
  let helpers: PeerRelayHosts | null = null;
  if (config.peers) {
    helpers = new PeerRelayHosts({
      link: config.peers.link, sessionId: config.sessionId, hostKeys: config.hostKeys, onChannel: adopt,
      ...(config.peers.target ? { target: config.peers.target } : {}),
      ...(config.peers.retryMs ? { retryMs: config.peers.retryMs } : {}),
      ...(config.peers.steadyMs ? { steadyMs: config.peers.steadyMs } : {}),
      ...(config.peers.pacer ? { pacer: config.peers.pacer } : {}),
      onChange: count => { helperCount = count; if (!closed) publish(); },
    });
    helpers.start();
  }
  if (config.relay) {
    relay = new RelayHostConnection({
      url: config.relay.url,
      sessionId: config.sessionId,
      hostKeys: config.hostKeys,
      ...(config.relay.factory ? { factory: config.relay.factory } : {}),
      ...(config.relay.backoffMs ? { backoffMs: config.relay.backoffMs } : {}),
      ...(config.relay.pacer ? { pacer: config.relay.pacer } : {}),
      onChannel: adopt,
      onState: (state, detail) => { relayState = state; relayDetail = detail; if (!closed) publish(); },
    });
    relay.start();
  }

  const transport: HdhtHostTransport = {
    mode: 'hyperdht-relay',
    hostKey: hostKeyToText(config.hostKeys),
    get directKey() { return direct?.publicKey ?? ''; },
    relayUrl: config.relay?.url ?? '',
    expiresAt: config.expiresAt,
    getStatus: status,
    attachDirect(link, publicKey) {
      if (closed) throw new Error('TRANSPORT_CLOSED');
      if (!/^[0-9a-f]{64}$/.test(publicKey)) throw new Error('DIRECT_INVALID_REQUEST');
      if (direct) {
        if (direct.link === link && direct.publicKey === publicKey) return;
        throw new Error('DIRECT_ALREADY_ATTACHED');
      }
      direct = { link, publicKey };
      link.setIncomingHandler(adopt);
      publish();
    },
    getPin: () => gate.getPin(),
    renewPin: () => gate.renew(),
    get pinRemainingFailures() { return gate.remainingFailures; },
    subscribeStatus(listener) { statusListeners.add(listener); return () => statusListeners.delete(listener); },
    subscribeMessage(listener) { messageListeners.add(listener); return () => messageListeners.delete(listener); },
    kick(peerId) { peers.get(peerId)?.io.close('KICKED'); },
    retryPeer(peerId) { peers.get(peerId)?.io.close('SYNC_BUSY'); },
    async send(channel: CollaborationTransportChannel, data: Uint8Array, targetPeerIds?: readonly string[]): Promise<void> {
      if (closed) throw new Error('TRANSPORT_CLOSED');
      if (!(data instanceof Uint8Array) || data.byteLength < 1 || data.byteLength > CHANNEL_LIMITS[channel]) throw new Error('TRANSPORT_MESSAGE_LIMIT');
      const targets = targetPeerIds === undefined ? Array.from(peers.keys()) : Array.from(new Set(targetPeerIds));
      if (!targets.length || targets.some(id => !peers.has(id))) throw new Error('PEER_NOT_AUTHORIZED');
      if (outgoing + data.byteLength * targets.length > OUTGOING_LIMIT_BYTES) throw new Error('TRANSPORT_BACKPRESSURE');
      const cost = data.byteLength * targets.length;
      outgoing += cost;
      try {
        const results = await Promise.allSettled(targets.map(id => peers.get(id)?.io.send(CHANNEL_TYPE[channel], data) ?? Promise.reject(new Error('PEER_NOT_AUTHORIZED'))));
        // A partial broadcast failure is still a sync failure: callers must not assume every target received it.
        if (results.some(result => result.status === 'rejected')) throw new Error('SEND_FAILED');
      } finally { outgoing -= cost; }
    },
    async close(reason = 'SESSION_ENDED'): Promise<void> {
      if (closed) return;
      closed = true;
      const safeReason = SYNC_FAILURE_REASONS.has(reason) ? reason : 'SESSION_ENDED';
      closeError = SYNC_FAILURE_REASONS.has(reason) ? reason : undefined;
      if (direct) direct.link.setIncomingHandler(null);
      // Tell every connected or authenticating guest first (bounded, best effort), then drop the relay registration.
      const ios = [...Array.from(pending), ...Array.from(peers.values(), entry => entry.io)];
      for (const io of ios) io.close(safeReason);
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([Promise.all(ios.map(io => io.flushed)), new Promise<void>(resolve => { deadline = setTimeout(resolve, 600); })]);
      } finally { clearTimeout(deadline); }
      relay?.stop();
      helpers?.stop();
      peers.clear();
      pending.clear();
      publish();
      statusListeners.clear();
      messageListeners.clear();
    },
  };
  return transport;
}

export interface HdhtGuestConfig {
  invitation: HdhtInvitation;
  /** The PIN the user typed; it is only ever used to compute the proof bound to one channel. */
  pin: string;
  direct?: DirectLink | null;
  /** Native helper peers found through the DHT are tried when a link to the native bridge is present (default on). */
  helpers?: boolean;
  onCandidate?(key: string, outcome: 'start' | 'failed' | 'won'): void;
  relayFactory?: WebSocketFactory;
  relayUrl?: string;
  pacer?: PacerOptions;
  timing?: ChannelTiming;
  /** Optional route-specific override; by default direct gets the full overall attempt deadline. */
  directTimeoutMs?: number;
  relayStartDelayMs?: number;
  attemptTimeoutMs?: number;
  authTimeoutMs?: number;
  backoffMs?: readonly number[];
  /** Failed or short-lived attempts before first authentication / since the last stable connection. */
  maxInitialAttempts?: number;
  maxReconnectAttempts?: number;
}

const HOST_PEER_ID = 'host';

/**
 * Connects to a host over the direct route and the relay in a race: direct first, the relay joins after a short delay or
 * as soon as the direct attempt fails. The first channel that proves the pinned host key wins; the other is abandoned.
 */
async function establishChannel(config: HdhtGuestConfig, signal: AbortSignal, bad: BadHelpers): Promise<SecureChannel> {
  const { invitation } = config;
  const controller = new AbortController();
  const relayUrl = config.relayUrl ?? invitation.relayUrl;
  const useDirect = !!(config.direct && invitation.directKey);
  const useHelpers = !!config.direct && config.helpers !== false;
  return new Promise<SecureChannel>((resolve, reject) => {
    let settled = false;
    let failures = 0;
    let lastError: Error = new Error('NO_ROUTE');
    const timers: ReturnType<typeof setTimeout>[] = [];
    const expected = (useDirect ? 1 : 0) + (useHelpers ? 1 : 0) + (relayUrl ? 1 : 0);
    const onAbort = () => finish(new Error('ABORTED'));
    const finish = (error?: Error, channel?: SecureChannel) => {
      if (settled) { channel?.close('LOST_RACE'); return; }
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      controller.abort();
      if (error) reject(error); else resolve(channel!);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) { onAbort(); return; }
    // A route that fails does not end the race until every route failed; a tampered host proof over the configured
    // gateway or a direct route is final, a misbehaving volunteer helper is merely skipped.
    const failed = (error: unknown, final = false) => {
      lastError = error instanceof Error ? error : new Error('NO_ROUTE');
      failures++;
      if (final && lastError.message === 'HOST_KEY_MISMATCH') { finish(lastError); return; }
      if (failures >= expected) finish(signal.aborted ? new Error('ABORTED') : lastError);
    };
    if (expected === 0) { finish(new Error('NO_ROUTE')); return; }
    timers.push(setTimeout(() => finish(new Error('CONNECT_TIMEOUT')), config.attemptTimeoutMs ?? 20_000));

    let secondaryStarted = false;
    const startSecondary = () => {
      if (secondaryStarted || settled) return;
      secondaryStarted = true;
      if (useHelpers) {
        connectViaHelpers({
          link: config.direct!, sessionId: invitation.sessionId, hostKey: invitation.hostKey, signal: controller.signal, bad,
          ...(config.pacer ? { pacer: config.pacer } : {}),
          ...(config.onCandidate ? { onCandidate: config.onCandidate } : {}),
        }).then(channel => finish(undefined, channel), error => failed(error));
      }
      if (relayUrl) {
        connectRelayGuest({
          url: relayUrl, sessionId: invitation.sessionId, hostKey: invitation.hostKey, signal: controller.signal,
          ...(config.relayFactory ? { factory: config.relayFactory } : {}),
          ...(config.pacer ? { pacer: config.pacer } : {}),
        }).then(channel => finish(undefined, channel), error => failed(error, true));
      }
    };

    if (useDirect) {
      const directController = new AbortController();
      controller.signal.addEventListener('abort', () => directController.abort(), { once: true });
      if (config.directTimeoutMs !== undefined) timers.push(setTimeout(() => directController.abort(), config.directTimeoutMs));
      config.direct!.connect(invitation.directKey, directController.signal).then(
        channel => finish(undefined, channel),
        error => { failed(error, true); startSecondary(); },
      );
      timers.push(setTimeout(startSecondary, config.relayStartDelayMs ?? 1500));
    } else startSecondary();
  });
}

export interface HdhtGuestTransport extends CollaborationTransport {
  /** Ends the session on this device; the transport cannot be reused afterwards. */
  readonly invitation: HdhtInvitation;
}

export function createHdhtGuestTransport(config: HdhtGuestConfig): HdhtGuestTransport {
  const { invitation } = config;
  const timing = config.timing ?? DEFAULT_TIMING;
  const backoff = config.backoffMs ?? [500, 1000, 2000, 4000, 8000];
  const maxInitial = config.maxInitialAttempts ?? 3;
  const maxReconnect = config.maxReconnectAttempts ?? 8;
  const statusListeners = new Set<(status: CollaborationTransportStatus) => void>();
  const messageListeners = new Set<(message: CollaborationTransportMessage) => void | Promise<void>>();
  const stop = new AbortController();
  const badHelpers = new BadHelpers();
  let closed = false;
  let everConnected = false;
  let attempt = 0;
  let state: CollaborationTransportStatus['state'] = 'connecting';
  let phase: CollaborationTransportStatus['phase'] = 'connecting';
  let route: CollaborationTransportStatus['route'];
  let grantedRole: 'editor' | 'viewer' | undefined;
  let hostPeer: AutomaticPeer | null = null;
  let io: ChannelIo | null = null;
  /** The channel of the current attempt from the moment it exists, so close() reaches it even while authenticating. */
  let live: ChannelIo | null = null;
  let error: string | undefined;
  let retryAfterMs: number | undefined;
  let attemptsLeft: number | undefined;
  let outgoing = 0;
  const relayUrls = () => (config.relayUrl ?? invitation.relayUrl) ? [config.relayUrl ?? invitation.relayUrl] : [];

  const status = (): CollaborationTransportStatus => {
    const value: CollaborationTransportStatus = {
      mode: 'hyperdht-relay', state, peers: hostPeer ? [{ ...hostPeer }] : [], relayUrls: relayUrls(), iceServers: [], phase, attempt,
    };
    if (route) value.route = route;
    if (grantedRole) value.grantedRole = grantedRole;
    if (error) value.error = error;
    if (retryAfterMs !== undefined) value.retryAfterMs = retryAfterMs;
    if (attemptsLeft !== undefined) value.attemptsLeft = attemptsLeft;
    return value;
  };
  const publish = () => notifyAll(statusListeners, status());
  const fatal = (code: string, extra: { retryAfterMs?: number; attemptsLeft?: number } = {}) => {
    if (closed) return;
    state = 'error'; error = code; hostPeer = null; retryAfterMs = extra.retryAfterMs; attemptsLeft = extra.attemptsLeft;
    publish();
    stop.abort();
  };

  /** One authenticated session on a channel; resolves with the reason it ended. */
  function session(channel: SecureChannel): Promise<{ reason: string; authenticated: boolean; stable?: boolean; retryAfterMs?: number }> {
    return new Promise(resolve => {
      let authenticated = false;
      let authenticatedAt = 0;
      let result: { code: string; retryAfterMs?: number; attemptsLeft?: number } | null = null;
      const authTimer = setTimeout(() => connection.close('AUTH_TIMEOUT'), config.authTimeoutMs ?? AUTH_TIMEOUT_MS);
      const connection: ChannelIo = openChannelIo(channel, {
        message(type, body) {
          if (!authenticated) {
            if (type === MESSAGE.authFail) {
              try {
                const parsed = parseJsonBody(body, 256);
                const code = typeof parsed['code'] === 'string' && FATAL_AUTH_CODES.has(parsed['code']) ? parsed['code'] : 'AUTH_FAILED';
                result = {
                  code,
                  retryAfterMs: code === 'PIN_LOCKED' ? boundedNumber(parsed['retryAfterMs'], 1000, MAX_PIN_RETRY_MS, 1000) : 0,
                  attemptsLeft: boundedNumber(parsed['attemptsLeft'], 0, 20, 0),
                };
                connection.close('AUTH_FAILED');
              } catch { connection.close('PROTOCOL_ERROR'); }
              return;
            }
            if (type !== MESSAGE.authOk) { connection.close('PROTOCOL_ERROR'); return; }
            let role: unknown; let documentId: unknown;
            try { const parsed = parseJsonBody(body, 512); role = parsed['role']; documentId = parsed['documentId']; } catch { connection.close('PROTOCOL_ERROR'); return; }
            if (role !== 'editor' && role !== 'viewer') { connection.close('PROTOCOL_ERROR'); return; }
            if (documentId !== invitation.documentId) { result = { code: 'DOCUMENT_MISMATCH' }; connection.close('DOCUMENT_MISMATCH'); return; }
            clearTimeout(authTimer);
            authenticated = true;
            authenticatedAt = Date.now();
            everConnected = true;
            io = connection;
            grantedRole = role;
            route = connection.route;
            // Identity is derived synchronously: the host may send its first message right behind AUTH_OK.
            hostPeer = peerFor(HOST_PEER_ID, connection.binding, 'owner', invitation.sessionId, bytesToHex(connection.binding));
            state = 'ready'; phase = undefined; error = undefined; retryAfterMs = undefined; attemptsLeft = undefined;
            publish();
            return;
          }
          const name = CHANNEL_BY_TYPE.get(type);
          if (!name || !hostPeer || body.byteLength < 1 || body.byteLength > CHANNEL_LIMITS[name]) { if (!name || body.byteLength > 0) connection.close('PROTOCOL_ERROR'); return; }
          notifyAll(messageListeners, { channel: name, data: body, peer: hostPeer }, copyMessage);
        },
        close(reason) {
          clearTimeout(authTimer);
          if (io === connection) { io = null; hostPeer = null; }
          if (live === connection) live = null;
          const code = result?.code;
          if (code && FATAL_AUTH_CODES.has(code)) {
            if (code === 'PIN_LOCKED' && everConnected) {
              retryAfterMs = result!.retryAfterMs;
              attemptsLeft = result!.attemptsLeft;
              error = 'PIN_LOCKED';
              resolve({ reason: code, authenticated, retryAfterMs });
              return;
            }
            fatal(code, { ...(result?.retryAfterMs !== undefined ? { retryAfterMs: result.retryAfterMs } : {}), ...(result?.attemptsLeft !== undefined ? { attemptsLeft: result.attemptsLeft } : {}) });
            resolve({ reason: code, authenticated });
            return;
          }
          resolve({ reason, authenticated, stable: authenticated && Date.now() - authenticatedAt >= STABLE_SESSION_MS });
        },
      }, timing);
      live = connection;
      connection.start();
      if (closed) connection.close('SESSION_LEFT');
      void computePinProof(config.pin, connection.binding, invitation.sessionId).then(
        proof => { if (!connection.closed) void connection.send(MESSAGE.auth, jsonBody({ proof: bytesToBase64Url(proof) })).catch(() => connection.close('SEND_FAILED')); },
        () => connection.close('INTERNAL_ERROR'),
      );
    });
  }

  async function run(): Promise<void> {
    let failures = 0;
    while (!closed && !stop.signal.aborted) {
      attempt++;
      state = everConnected ? 'reconnecting' : 'connecting'; phase = 'connecting'; hostPeer = null; route = undefined;
      error = undefined; retryAfterMs = undefined; attemptsLeft = undefined;
      publish();
      let ended: { reason: string; authenticated: boolean; stable?: boolean; retryAfterMs?: number } = { reason: 'CONNECT_FAILED', authenticated: false };
      let helperFailed = false;
      try {
        const channel = await establishChannel(config, stop.signal, badHelpers);
        if (closed || stop.signal.aborted) { channel.close('ABORTED'); return; }
        phase = 'authenticating'; publish();
        ended = await session(channel);
        // A helper can forward the signed handshake and then silently discard application records. The channel
        // heartbeat/auth deadline is the bounded live forwarding check; remember that failed helper for failover.
        if (!closed && !stop.signal.aborted && ['AUTH_TIMEOUT', 'HEARTBEAT_TIMEOUT'].includes(ended.reason)) {
          helperFailed = rejectHelperChannel(channel, badHelpers);
        }
      } catch (cause) {
        ended = { reason: cause instanceof Error ? cause.message : 'CONNECT_FAILED', authenticated: false };
      }
      if (closed || stop.signal.aborted) return;
      const peerSyncFailure = ended.authenticated && ended.reason.startsWith('PEER_BYE:') && SYNC_FAILURE_REASONS.has(ended.reason.slice('PEER_BYE:'.length)) ? ended.reason.slice('PEER_BYE:'.length) : undefined;
      const final = ended.reason === 'HOST_KEY_MISMATCH' ? 'HOST_KEY_MISMATCH' : peerSyncFailure ?? FINAL_PEER_REASONS[ended.reason];
      if (final) { fatal(final); return; }
      if (FATAL_AUTH_CODES.has(ended.reason) && !(ended.reason === 'PIN_LOCKED' && everConnected)) return;
      failures = ended.stable ? 0 : failures + 1;
      const limit = everConnected ? maxReconnect : maxInitial;
      if (failures >= limit) {
        fatal(everConnected ? 'CONNECTION_LOST' : ended.reason === 'CONNECT_TIMEOUT' || ended.reason === 'NO_ROUTE' ? 'HOST_UNREACHABLE' : 'CONNECT_FAILED');
        return;
      }
      state = 'reconnecting'; error = helperFailed ? 'HELPER_FORWARDING_FAILED' : ended.reason; hostPeer = null; publish();
      const delay = Math.max(ended.retryAfterMs ?? 0, backoff[Math.min(failures, backoff.length - 1)] ?? 500);
      await new Promise<void>(resolve => {
        const finish = () => { clearTimeout(timer); stop.signal.removeEventListener('abort', finish); resolve(); };
        const timer = setTimeout(finish, ended.retryAfterMs !== undefined ? delay : delay + Math.floor(Math.random() * delay * 0.2));
        stop.signal.addEventListener('abort', finish, { once: true });
        if (stop.signal.aborted) finish();
      });
    }
  }
  void run();

  const transport: HdhtGuestTransport = {
    mode: 'hyperdht-relay',
    invitation,
    getStatus: status,
    subscribeStatus(listener) { statusListeners.add(listener); return () => statusListeners.delete(listener); },
    subscribeMessage(listener) { messageListeners.add(listener); return () => messageListeners.delete(listener); },
    async send(channel, data, targetPeerIds) {
      if (closed) throw new Error('TRANSPORT_CLOSED');
      if (!(data instanceof Uint8Array) || data.byteLength < 1 || data.byteLength > CHANNEL_LIMITS[channel]) throw new Error('TRANSPORT_MESSAGE_LIMIT');
      if (!grantedRole || !actionAllowed(channel, grantedRole)) throw new Error('ACCESS_DENIED');
      const current = io;
      if (!current || current.closed || !hostPeer) throw new Error('NOT_CONNECTED');
      if (targetPeerIds !== undefined && (targetPeerIds.length !== 1 || targetPeerIds[0] !== HOST_PEER_ID)) throw new Error('PEER_NOT_AUTHORIZED');
      if (outgoing + data.byteLength > OUTGOING_LIMIT_BYTES) throw new Error('TRANSPORT_BACKPRESSURE');
      outgoing += data.byteLength;
      try { await current.send(CHANNEL_TYPE[channel], data); } finally { outgoing -= data.byteLength; }
    },
    async close(reason = 'SESSION_LEFT'): Promise<void> {
      if (closed) return;
      closed = true;
      stop.abort();
      state = 'closed'; hostPeer = null;
      const safeReason = SYNC_FAILURE_REASONS.has(reason) ? reason : 'SESSION_LEFT';
      if (SYNC_FAILURE_REASONS.has(reason)) error = reason;
      const current = live ?? io;
      io = null; live = null;
      current?.close(safeReason);
      publish();
      statusListeners.clear();
      messageListeners.clear();
    },
  };
  return transport;
}
