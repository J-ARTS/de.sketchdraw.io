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

export class RelayRoom {
  constructor() {
    this.topic = null;
    this.hub = null;
  }

  async fetch(request) {
    const topic = ROOM_PATH.exec(new URL(request.url).pathname)?.[1];
    if (!topic) return new Response(null, { status: 404 });
    // The object is addressed by its topic; the first request tells it which one that is.
    this.topic ??= topic;
    if (this.topic !== topic) return new Response(null, { status: 400 });
    this.hub ??= createRelayHub({ limits: ROOM_LIMITS, acceptTopic: value => value === this.topic });
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    server.accept();
    if (!attachRelaySocket(this.hub, server)) server.close(4503, 'full');
    return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': SUBPROTOCOL } });
  }
}
