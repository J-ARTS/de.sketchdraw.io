// Sketchdraw session relay on Cloudflare: forwards opaque, end-to-end encrypted records between one host and its
// guests. Each session gets its own Durable Object, addressed by the topic in the path (/v1/<topic>); the topic is a
// hash of the host's public session key. The Worker stores nothing, holds no secret and logs nothing.
import { ROOM_PATH, RelayRoom, SUBPROTOCOL } from './room.mjs';

export { RelayRoom };

const NO_STORE = { 'cache-control': 'no-store' };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/healthz') {
      return new Response(JSON.stringify({ status: 'ok', service: 'sketchdraw-relay', protocol: SUBPROTOCOL }), { headers: { ...NO_STORE, 'content-type': 'application/json' } });
    }
    const topic = ROOM_PATH.exec(url.pathname)?.[1];
    if (!topic) return new Response(null, { status: 404, headers: NO_STORE });
    if ((request.headers.get('upgrade') ?? '').toLowerCase() !== 'websocket') return new Response(null, { status: 426, headers: { ...NO_STORE, upgrade: 'websocket' } });
    const offered = (request.headers.get('sec-websocket-protocol') ?? '').split(',').map(value => value.trim());
    if (!offered.includes(SUBPROTOCOL)) return new Response(null, { status: 400, headers: NO_STORE });
    return env.RELAY_ROOM.get(env.RELAY_ROOM.idFromName(topic)).fetch(request);
  },
};
