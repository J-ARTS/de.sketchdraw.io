/*
 * POC(#303): the TURN route of a session – a third carrier next to "direct" and "relay".
 *
 * The devices still meet in the room of the relay (cloud-relay.ts), but only to set up a WebRTC data channel: the
 * guest sends an offer through the room, the host answers, both add each other's ICE candidates. The data channel is
 * forced through TURN (`iceTransportPolicy: 'relay'`), so the session data flows through Cloudflare Realtime TURN and
 * not through the Worker. On the open data channel the same end-to-end handshake runs as on every other carrier
 * (pinned host key, PIN inside the channel); WebRTC's own encryption is not relied on, and neither the relay nor the
 * TURN server can read or forge a record.
 *
 * One of the two Cloudflare routes (Worker relay or TURN) is removed again after the comparison. Everything that
 * goes with this one carries the marker POC(#303).
 */
import { utf8 } from './codec';
import { acceptRelayChannel, initiateRelayChannel, type HostKeys, type RecordWire, type RelayRecordChannel, WireInbox } from './relay-channel';
import { openRelayGuestWire, type PacerOptions, WirePacer } from './relay-wire';
import type { WebSocketFactory } from './types';

export type RtcPeerFactory = (configuration: RTCConfiguration) => RTCPeerConnection;

const DATA_CHANNEL_LABEL = 'sketchdraw-session';
/** Signalling records carry this type byte; the end-to-end handshake never starts with it. */
const SIGNAL_TYPE = 0x53;
const MAX_SDP_CHARS = 16 * 1024;
const MAX_CANDIDATE_CHARS = 1024;
const MAX_CANDIDATES = 64;
/** TURN through a proxy needs several round trips; the data channel has this long to open. */
const CONNECT_TIMEOUT_MS = 25_000;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

const defaultRtcPeerFactory: RtcPeerFactory = configuration => {
  if (typeof RTCPeerConnection !== 'function') throw new Error('WEBRTC_UNAVAILABLE');
  return new RTCPeerConnection(configuration);
};

/** What of a relay's answer a browser can use: stun/turn/turns URLs (not port 53, which browsers block). */
export function usableIceServers(value: unknown): RTCIceServer[] {
  if (!Array.isArray(value)) return [];
  const servers: RTCIceServer[] = [];
  for (const entry of value.slice(0, 8) as unknown[]) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const urls = (Array.isArray(record['urls']) ? record['urls'] : [record['urls']])
      .filter((url): url is string => typeof url === 'string' && url.length <= 256 && /^(stun|turn|turns):[^\s]+$/.test(url) && !/:53(\?|$)/.test(url))
      .slice(0, 12);
    if (!urls.length) continue;
    const server: RTCIceServer = { urls };
    const { username, credential } = record;
    if (typeof username === 'string' && typeof credential === 'string' && username.length <= 512 && credential.length <= 512) {
      server.username = username; server.credential = credential;
    }
    servers.push(server);
  }
  return servers;
}

const hasTurn = (servers: readonly RTCIceServer[]): boolean =>
  servers.some(server => typeof server.username === 'string' && (server.urls as string[]).some(url => /^turns?:/.test(url)));

/**
 * The WebRTC configuration of the TURN route. With TURN servers every packet goes through them (`relay`): that is
 * what this route is for, and no device learns the network address of another. Without TURN servers the route is
 * refused – except against a relay on this computer, where tests and local development connect directly.
 */
export function turnConfiguration(servers: unknown, relayUrl: string): RTCConfiguration {
  const iceServers = usableIceServers(servers);
  if (hasTurn(iceServers)) return { iceServers, iceTransportPolicy: 'relay', iceCandidatePoolSize: 0 };
  let local = false;
  try { local = LOOPBACK_HOSTS.has(new URL(relayUrl).hostname); } catch { /* not local */ }
  if (!local) throw new Error('TURN_UNAVAILABLE');
  return { iceServers, iceTransportPolicy: 'all', iceCandidatePoolSize: 0 };
}

interface Signal { k: 'offer' | 'answer' | 'candidate'; sdp?: string; c?: RTCIceCandidateInit }

function encodeSignal(signal: Signal): Uint8Array {
  const body = utf8.encode(JSON.stringify(signal));
  const out = new Uint8Array(body.byteLength + 1);
  out[0] = SIGNAL_TYPE; out.set(body, 1);
  return out;
}

function decodeSignal(record: Uint8Array): Signal | null {
  if (record.byteLength < 2 || record[0] !== SIGNAL_TYPE || record.byteLength > MAX_SDP_CHARS * 4) return null;
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(record.subarray(1))); } catch { return null; }
  if (!value || typeof value !== 'object') return null;
  const { k, sdp, c } = value as Record<string, unknown>;
  if ((k === 'offer' || k === 'answer') && typeof sdp === 'string' && sdp.length > 0 && sdp.length <= MAX_SDP_CHARS) return { k, sdp };
  if (k === 'candidate' && c && typeof c === 'object') {
    const { candidate, sdpMid, sdpMLineIndex, usernameFragment } = c as Record<string, unknown>;
    if (typeof candidate !== 'string' || candidate.length > MAX_CANDIDATE_CHARS) return null;
    return {
      k, c: {
        candidate,
        ...(typeof sdpMid === 'string' && sdpMid.length <= 64 ? { sdpMid } : {}),
        ...(typeof sdpMLineIndex === 'number' && Number.isInteger(sdpMLineIndex) && sdpMLineIndex >= 0 && sdpMLineIndex < 16 ? { sdpMLineIndex } : {}),
        ...(typeof usernameFragment === 'string' && usernameFragment.length <= 256 ? { usernameFragment } : {}),
      },
    };
  }
  return null;
}

/** The record wire of an open data channel. Its inbox collects from the first message on. */
export interface TurnCarrier { wire: RecordWire; inbox: WireInbox }
interface SignalWire { wire: RecordWire; inbox: WireInbox }
export interface TurnConnectOptions { rtc?: RtcPeerFactory; timeoutMs?: number; signal?: AbortSignal; pacer?: PacerOptions }

function carrierOf(pc: RTCPeerConnection, dc: RTCDataChannel, pacerOptions: PacerOptions | undefined, inbox: WireInbox): RecordWire {
  dc.binaryType = 'arraybuffer';
  const pacer = new WirePacer(() => dc.bufferedAmount, pacerOptions);
  let closed = false;
  const fail = (reason: string) => { if (closed) return; closed = true; pacer.close(); inbox.fail(reason); };
  dc.addEventListener('message', event => {
    const data: unknown = (event as MessageEvent).data;
    if (data instanceof ArrayBuffer) inbox.push(new Uint8Array(data));
    else if (ArrayBuffer.isView(data)) inbox.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    else fail('TURN_PROTOCOL');
  });
  dc.addEventListener('close', () => fail('TURN_CLOSED'));
  dc.addEventListener('error', () => fail('TURN_CLOSED'));
  pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') fail('TURN_CLOSED'); });
  return {
    acquire: bytes => pacer.acquire(bytes),
    send: data => { if (closed || dc.readyState !== 'open') throw new Error('WIRE_CLOSED'); dc.send(data as Uint8Array<ArrayBuffer>); },
    bufferedAmount: () => dc.bufferedAmount,
    close: () => { closed = true; pacer.close(); try { dc.close(); } catch { /* already closed */ } try { pc.close(); } catch { /* already closed */ } },
  };
}

/**
 * Negotiates the data channel over the signalling wire. `offerer` is the guest. Resolves with the carrier once the
 * channel is open; rejects (and closes the peer connection) on timeout, abort or a failed connection. The signalling
 * wire is left to the caller: once the answer went through, losing it does not matter any more.
 */
function negotiate(role: 'offerer' | 'answerer', signalling: SignalWire, configuration: RTCConfiguration, options: TurnConnectOptions): Promise<TurnCarrier> {
  return new Promise<TurnCarrier>((resolve, reject) => {
    let pc: RTCPeerConnection;
    try { pc = (options.rtc ?? defaultRtcPeerFactory)(configuration); } catch (error) { reject(error instanceof Error ? error : new Error('WEBRTC_UNAVAILABLE')); return; }
    const inbox = new WireInbox();
    let settled = false, remoteSet = false, candidates = 0, wire: RecordWire | null = null;
    const pendingCandidates: RTCIceCandidateInit[] = [];
    const timer = setTimeout(() => finish(new Error('TURN_TIMEOUT')), options.timeoutMs ?? CONNECT_TIMEOUT_MS);
    const onAbort = () => finish(new Error('ABORTED'));
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (error || !wire) {
        inbox.dispose(error?.message ?? 'TURN_FAILED');
        if (wire) wire.close('TURN_FAILED'); else { try { pc.close(); } catch { /* already closed */ } }
        reject(error ?? new Error('TURN_FAILED'));
      } else resolve({ wire, inbox });
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) { onAbort(); return; }

    const send = (signal: Signal) => { try { signalling.wire.send(encodeSignal(signal)); } catch { /* the wire is gone; the timeout decides */ } };
    const adopt = (dc: RTCDataChannel) => {
      if (wire) { try { dc.close(); } catch { /* ignore */ } return; }
      wire = carrierOf(pc, dc, options.pacer, inbox);
      if (dc.readyState === 'open') finish(); else dc.addEventListener('open', () => finish());
    };
    pc.addEventListener('icecandidate', event => {
      const candidate = (event as RTCPeerConnectionIceEvent).candidate;
      if (candidate && !settled) send({ k: 'candidate', c: typeof candidate.toJSON === 'function' ? candidate.toJSON() : candidate });
    });
    pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'failed') finish(new Error('TURN_FAILED')); });
    pc.addEventListener('datachannel', event => {
      const dc = (event as RTCDataChannelEvent).channel;
      if (role === 'answerer' && dc.label === DATA_CHANNEL_LABEL) adopt(dc); else { try { dc.close(); } catch { /* ignore */ } }
    });

    const addCandidate = (candidate: RTCIceCandidateInit) => { void pc.addIceCandidate(candidate).catch(() => undefined); };
    const remote = async (description: RTCSessionDescriptionInit) => {
      await pc.setRemoteDescription(description);
      remoteSet = true;
      for (const candidate of pendingCandidates.splice(0)) addCandidate(candidate);
    };
    const pump = async () => {
      while (!settled) {
        let record: Uint8Array;
        try { record = await signalling.inbox.next(options.timeoutMs ?? CONNECT_TIMEOUT_MS); } catch { return; }
        const signal = decodeSignal(record);
        if (!signal) { finish(new Error('TURN_PROTOCOL')); return; }
        if (signal.k === 'candidate') {
          if (++candidates > MAX_CANDIDATES) { finish(new Error('TURN_PROTOCOL')); return; }
          if (remoteSet) addCandidate(signal.c!); else pendingCandidates.push(signal.c!);
        } else if (signal.k === 'offer' && role === 'answerer' && !remoteSet) {
          await remote({ type: 'offer', sdp: signal.sdp! });
          await pc.setLocalDescription(await pc.createAnswer());
          send({ k: 'answer', sdp: pc.localDescription?.sdp ?? '' });
        } else if (signal.k === 'answer' && role === 'offerer' && !remoteSet) {
          await remote({ type: 'answer', sdp: signal.sdp! });
        } else { finish(new Error('TURN_PROTOCOL')); return; }
      }
    };

    void (async () => {
      if (role === 'offerer') {
        adopt(pc.createDataChannel(DATA_CHANNEL_LABEL, { ordered: true }));
        await pc.setLocalDescription(await pc.createOffer());
        send({ k: 'offer', sdp: pc.localDescription?.sdp ?? '' });
      }
      await pump();
    })().catch(() => finish(new Error('TURN_FAILED')));
  });
}

export interface TurnGuestOptions extends TurnConnectOptions {
  url: string;
  factory?: WebSocketFactory;
  sessionId: string;
  hostKey: string;
}

/** A guest's way in: join the room, get ICE servers, open the data channel through TURN, then the handshake on it. */
export async function connectTurnGuest(options: TurnGuestOptions): Promise<RelayRecordChannel> {
  const timeoutMs = options.timeoutMs;
  const signalling = await openRelayGuestWire({
    url: options.url, hostKey: options.hostKey,
    ...(options.factory ? { factory: options.factory } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const endSignalling = (reason: string) => { signalling.inbox.dispose(reason); signalling.wire.close(reason); };
  let carrier: TurnCarrier;
  try {
    const configuration = turnConfiguration(await signalling.requestIce(), options.url);
    carrier = await negotiate('offerer', signalling, configuration, options);
  } catch (error) {
    endSignalling('TURN_FAILED');
    throw error;
  }
  // The room has done its part; from here on nothing of this guest runs through the Worker.
  endSignalling('SIGNALLING_DONE');
  try {
    return await initiateRelayChannel(carrier.wire, carrier.inbox, { sessionId: options.sessionId, hostKey: options.hostKey, ...(timeoutMs !== undefined ? { timeoutMs } : {}) });
  } catch (error) {
    carrier.inbox.dispose('HANDSHAKE_FAILED'); carrier.wire.close('HANDSHAKE_FAILED');
    throw error;
  }
}

export interface TurnHostOptions extends TurnConnectOptions {
  url: string;
  sessionId: string;
  hostKeys: HostKeys;
  /** The ICE servers of the host's registration; asked again when the cached answer is older than `iceMaxAgeMs`. */
  requestIce(): Promise<unknown[]>;
  iceMaxAgeMs?: number;
}

export interface TurnGuestAcceptor {
  /** For `RelayHostConnection.acceptGuest`. */
  accept(wire: RecordWire, inbox: WireInbox): Promise<RelayRecordChannel>;
  /** Asks for the ICE servers ahead of the first guest; rejects with the relay's reason when TURN is not usable. */
  prime(): Promise<void>;
}

/**
 * The host's side: answers a guest's offer on its signalling wire and completes the handshake on the data channel.
 * The ICE servers are asked once and reused for a while, so a full room does not mean a request per guest.
 */
export function turnGuestAcceptor(options: TurnHostOptions): TurnGuestAcceptor {
  const maxAge = options.iceMaxAgeMs ?? 30 * 60_000;
  let cached: { at: number; servers: Promise<unknown[]> } | null = null;
  const servers = (): Promise<unknown[]> => {
    if (!cached || Date.now() - cached.at > maxAge) {
      const entry = { at: Date.now(), servers: options.requestIce() };
      entry.servers.catch(() => { if (cached === entry) cached = null; });
      cached = entry;
    }
    return cached.servers;
  };
  return {
    async prime() { cached = null; turnConfiguration(await servers(), options.url); },
    async accept(wire, inbox) {
      const configuration = turnConfiguration(await servers(), options.url);
      const carrier = await negotiate('answerer', { wire, inbox }, configuration, options);
      try {
        return await acceptRelayChannel(carrier.wire, carrier.inbox, { sessionId: options.sessionId, hostKeys: options.hostKeys, ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}) });
      } catch (error) {
        carrier.inbox.dispose('HANDSHAKE_FAILED'); carrier.wire.close('HANDSHAKE_FAILED');
        throw error;
      }
    },
  };
}
