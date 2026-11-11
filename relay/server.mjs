#!/usr/bin/env node
// Sketchdraw session relay: forwards opaque, end-to-end encrypted records between one host and its guests.
// It keeps state in memory only, never sees the PIN, keys or document content, and is meant to sit behind a
// TLS-terminating reverse proxy (see relay/README.md). It does not log URLs, topics or payloads.
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { createRelayHub, DEFAULT_LIMITS as HUB_LIMITS, topicForHostKey } from './hub.mjs';

export { topicForHostKey };
export const SUBPROTOCOL = 'sketchdraw-relay.v1';
export const DEFAULT_LIMITS = Object.freeze({ ...HUB_LIMITS, maxConnectionsPerIp: 40 });

export function createRelayServer(options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits ?? {}) };
  const trustProxy = options.trustProxy === true;
  const allowedOrigins = options.allowedOrigins?.length ? new Set(options.allowedOrigins) : null;
  const hub = createRelayHub({ limits, ...(options.now ? { now: options.now } : {}) });
  const perIp = new Map();
  const sockets = new Set();
  let reserved = 0;
  const counters = { accepted: 0, rejected: 0 };

  const server = http.createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/healthz') {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ status: 'ok', connections: sockets.size, topics: hub.stats().topics }));
      return;
    }
    response.writeHead(404, { 'cache-control': 'no-store' });
    response.end();
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 10_000;
  server.maxHeadersCount = 64;

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: limits.maxRecordBytes,
    perMessageDeflate: false,
    handleProtocols: protocols => (protocols.has(SUBPROTOCOL) ? SUBPROTOCOL : false),
  });

  function clientIp(request) {
    if (trustProxy) {
      const forwarded = String(request.headers['x-forwarded-for'] ?? '').split(',').at(-1)?.trim();
      if (forwarded) return forwarded.slice(0, 64);
    }
    return request.socket.remoteAddress ?? 'unknown';
  }

  function reject(socket, status) {
    counters.rejected++;
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  }

  server.on('upgrade', (request, socket, head) => {
    socket.on('error', () => {});
    if (request.url !== '/' && request.url !== '/v1') return reject(socket, '404 Not Found');
    if (allowedOrigins && !allowedOrigins.has(String(request.headers.origin ?? ''))) return reject(socket, '403 Forbidden');
    const offered = String(request.headers['sec-websocket-protocol'] ?? '').split(',').map(value => value.trim());
    if (!offered.includes(SUBPROTOCOL)) return reject(socket, '400 Bad Request');
    const ip = clientIp(request);
    if (reserved >= limits.maxConnections || (perIp.get(ip) ?? 0) >= limits.maxConnectionsPerIp) return reject(socket, '503 Service Unavailable');
    // The slot belongs to the raw socket: whatever way it ends (failed upgrade, abort, normal close) frees it once.
    reserved++;
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      reserved--;
      const remaining = (perIp.get(ip) ?? 1) - 1;
      remaining <= 0 ? perIp.delete(ip) : perIp.set(ip, remaining);
    };
    socket.once('close', release);
    try {
      wss.handleUpgrade(request, socket, head, ws => attach(ws));
    } catch {
      counters.rejected++;
      socket.destroy();
    }
  });

  function attach(ws) {
    counters.accepted++;
    sockets.add(ws);
    const handler = hub.accept({
      send: (data, binary) => ws.send(data, { binary }),
      bufferedAmount: () => ws.bufferedAmount,
      isOpen: () => ws.readyState === WebSocket.OPEN,
      close: (code, reason) => ws.close(code, reason),
      terminate: () => ws.terminate(),
    });
    if (!handler) { ws.close(4503, 'full'); sockets.delete(ws); return; }
    // Protocol-level pings keep idle connections alive and let the hub see that the peer is still there.
    const pinger = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.ping(); }, Math.max(1000, Math.floor(limits.idleTimeoutMs / 3)));
    ws.on('pong', () => handler.touch());
    ws.on('message', (data, isBinary) => handler.message(data, isBinary));
    ws.on('close', () => { clearInterval(pinger); sockets.delete(ws); handler.closed(); });
    ws.on('error', () => ws.terminate());
  }

  return {
    server,
    hub,
    stats: () => ({ connections: sockets.size, topics: hub.stats().topics, ...counters, forwardedRecords: hub.stats().forwardedRecords, closedForLimit: hub.stats().closedForLimit }),
    listen: (port = 0, host = '127.0.0.1') => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => { server.off('error', reject); resolve(server.address()); });
    }),
    close: () => new Promise(resolve => {
      hub.dispose();
      for (const ws of sockets) ws.terminate();
      wss.close();
      server.close(() => resolve());
      server.closeAllConnections?.();
    }),
  };
}

function numberFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const host = process.env.RELAY_HOST ?? '127.0.0.1';
  const port = numberFromEnv('RELAY_PORT', 8787);
  const limits = {};
  for (const [env, key] of [['RELAY_MAX_CONNECTIONS', 'maxConnections'], ['RELAY_MAX_CONNECTIONS_PER_IP', 'maxConnectionsPerIp'], ['RELAY_MAX_TOPICS', 'maxTopics'], ['RELAY_MAX_GUESTS_PER_TOPIC', 'maxGuestsPerTopic']]) {
    if (process.env[env]) limits[key] = numberFromEnv(env, DEFAULT_LIMITS[key]);
  }
  const relay = createRelayServer({
    limits,
    trustProxy: process.env.RELAY_TRUST_PROXY === '1',
    allowedOrigins: (process.env.RELAY_ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean),
  });
  relay.listen(port, host).then(address => {
    console.log(`sketchdraw relay listening on ${typeof address === 'object' && address ? `${address.address}:${address.port}` : address}`);
  }).catch(error => { console.error('relay failed to start:', error.message); process.exit(1); });
  const stop = () => { void relay.close().then(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
