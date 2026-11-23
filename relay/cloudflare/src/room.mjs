// One relay room: the Durable Object that serves exactly one session topic. It runs the same hub as the Node relay and
// the desktop helper, so limits, the host proof and the forwarding rules are identical. Nothing is stored: the object
// keeps its sockets in memory and is gone when the last one closes.
import { Buffer } from 'node:buffer';
import { createRelayHub } from '../../hub.mjs';

export const SUBPROTOCOL = 'sketchdraw-relay.v1';
export const ROOM_PATH = /^\/v1\/([0-9a-f]{64})$/;

/** One session: the host, its guests and a few connections that are still joining. */
export const ROOM_LIMITS = Object.freeze({ maxTopics: 1, maxConnections: 40, maxGuestsPerTopic: 24 });

const OPEN = 1;
const encoder = new TextEncoder();

/**
 * Hands one accepted server-side WebSocket to the hub. Returns false when the hub is full. The socket only needs
 * `send`, `close`, `readyState` and `addEventListener` (Workers and the browser API agree on these).
 */
export function attachRelaySocket(hub, socket) {
  let open = true;
  const handler = hub.accept({
    send: data => socket.send(data),
    // Workers do not report what is waiting to be sent; the hub's rate limits bound each sender instead.
    bufferedAmount: () => 0,
    isOpen: () => open && socket.readyState === OPEN,
    close: (code, reason) => { open = false; try { socket.close(code, reason); } catch { /* already closed */ } },
  });
  if (!handler) return false;
  // The Workers runtime of this compatibility date does not hand binary messages over as ArrayBuffer unless asked to
  // (found in the runtime test: records arrived empty). Records must arrive whole and in order.
  try { socket.binaryType = 'arraybuffer'; } catch { /* a runtime without the property already delivers ArrayBuffer */ }
  socket.addEventListener('message', event => {
    const data = event.data;
    if (typeof data === 'string') handler.message(Buffer.from(encoder.encode(data)), false);
    else if (data instanceof ArrayBuffer) handler.message(Buffer.from(new Uint8Array(data)), true);
    else if (ArrayBuffer.isView(data)) handler.message(Buffer.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)), true);
    // Anything else (a Blob) cannot be forwarded without reordering; the connection ends instead of losing records.
    else { open = false; try { socket.close(1003, 'binary-type'); } catch { /* already closed */ } handler.closed(); }
  });
  const ended = () => { open = false; handler.closed(); };
  socket.addEventListener('close', ended);
  socket.addEventListener('error', ended);
  return true;
}

/*
 * POC(#303): the TURN route. The room hands out short-lived ICE servers of Cloudflare Realtime TURN to the host and
 * the guests it has joined; the session data then flows through TURN and the room only carries the WebRTC signalling.
 * The TURN key is a secret of the Worker (TURN_KEY_ID, TURN_KEY_API_TOKEN) and never leaves it.
 */
export const TURN_API = 'https://rtc.live.cloudflare.com';
/** Credentials outlive the longest session the hub allows (13 h). */
export const TURN_TTL_SECONDS = 14 * 60 * 60;

/** Keeps what a browser can use of an ICE server list: stun/turn/turns URLs (not port 53, which browsers block). */
export function usableIceServers(value) {
  if (!Array.isArray(value)) return [];
  const servers = [];
  for (const entry of value.slice(0, 8)) {
    if (!entry || typeof entry !== 'object') continue;
    const urls = (Array.isArray(entry.urls) ? entry.urls : [entry.urls])
      .filter(url => typeof url === 'string' && url.length <= 256 && /^(stun|turn|turns):[^\s]+$/.test(url) && !/:53(\?|$)/.test(url))
      .slice(0, 12);
    if (!urls.length) continue;
    const server = { urls };
    if (typeof entry.username === 'string' && typeof entry.credential === 'string' && entry.username.length <= 512 && entry.credential.length <= 512) {
      server.username = entry.username; server.credential = entry.credential;
    }
    servers.push(server);
  }
  return servers;
}

/** Asks Cloudflare for ICE servers with fresh credentials. Throws a short code when TURN is not set up or refuses. */
export async function generateIceServers(env, fetcher = fetch) {
  const id = typeof env?.TURN_KEY_ID === 'string' ? env.TURN_KEY_ID.trim() : '';
  const token = typeof env?.TURN_KEY_API_TOKEN === 'string' ? env.TURN_KEY_API_TOKEN.trim() : '';
  if (!id || !token) throw new Error('TURN_NOT_CONFIGURED');
  const base = typeof env.TURN_API_BASE === 'string' && env.TURN_API_BASE ? env.TURN_API_BASE.replace(/\/+$/, '') : TURN_API;
  let response;
  try {
    response = await fetcher(`${base}/v1/turn/keys/${encodeURIComponent(id)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
    });
  } catch { throw new Error('TURN_API_UNREACHABLE'); }
  if (!response.ok) throw new Error(`TURN_API_${response.status}`);
  let body;
  try { body = await response.json(); } catch { throw new Error('TURN_API_INVALID'); }
  const servers = usableIceServers(body?.iceServers);
  if (!servers.some(server => server.username && server.urls.some(url => /^turns?:/.test(url)))) throw new Error('TURN_API_INVALID');
  return servers;
}

export class RelayRoom {
  constructor(_state, env) {
    this.topic = null;
    this.hub = null;
    this.env = env ?? {};
  }

  async fetch(request) {
    const topic = ROOM_PATH.exec(new URL(request.url).pathname)?.[1];
    if (!topic) return new Response(null, { status: 404 });
    // The object is addressed by its topic; the first request tells it which one that is.
    this.topic ??= topic;
    if (this.topic !== topic) return new Response(null, { status: 400 });
    this.hub ??= createRelayHub({ limits: ROOM_LIMITS, acceptTopic: value => value === this.topic, iceServers: () => generateIceServers(this.env) });
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    server.accept();
    if (!attachRelaySocket(this.hub, server)) server.close(4503, 'full');
    return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': SUBPROTOCOL } });
  }
}
