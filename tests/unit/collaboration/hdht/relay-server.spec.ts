import crypto from 'node:crypto';
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
// @ts-expect-error plain ESM relay without type declarations
import { createRelayServer, SUBPROTOCOL, topicForHostKey } from '../../../../relay/server.mjs';

type Relay = ReturnType<typeof createRelayServer>;
const relays: Relay[] = [];
const sockets: WebSocket[] = [];

async function start(limits: Record<string, number> = {}): Promise<{ relay: Relay; url: string; port: number }> {
  const relay = createRelayServer({ limits });
  relays.push(relay);
  const address = await relay.listen(0, '127.0.0.1');
  return { relay, url: `ws://127.0.0.1:${address.port}/`, port: address.port };
}
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await Promise.all(relays.splice(0).map(relay => relay.close()));
});

function open(url: string): Promise<{ ws: WebSocket; texts: string[]; frames: Buffer[]; closed: Promise<number> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, SUBPROTOCOL);
    sockets.push(ws);
    const texts: string[] = [];
    const frames: Buffer[] = [];
    const closed = new Promise<number>(done => ws.on('close', code => done(code)));
    ws.on('message', (data, isBinary) => { if (isBinary) frames.push(data as Buffer); else texts.push(data.toString()); });
    ws.once('open', () => resolve({ ws, texts, frames, closed }));
    ws.once('error', reject);
  });
}
const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check()) { if (Date.now() > end) throw new Error('timeout'); await new Promise(r => setTimeout(r, 10)); }
};

function hostIdentity() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const raw = (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(-32);
  return { raw, key: raw.toString('base64url'), topic: topicForHostKey(raw) as string, privateKey };
}

async function registerHost(url: string, identity: ReturnType<typeof hostIdentity>, signWith = identity.privateKey, nonceOverride?: Buffer) {
  const conn = await open(url);
  conn.ws.send(JSON.stringify({ t: 'host', topic: identity.topic, key: identity.key }));
  await until(() => conn.texts.length > 0 || conn.ws.readyState > 1);
  const challenge = conn.texts[0] ? JSON.parse(conn.texts[0]) : null;
  if (challenge?.t === 'challenge') {
    const nonce = nonceOverride ?? Buffer.from(challenge.nonce, 'hex');
    const signature = crypto.sign(null, Buffer.concat([Buffer.from('sketchdraw-relay-host-v1\0'), Buffer.from(identity.topic, 'hex'), nonce]), signWith);
    conn.ws.send(JSON.stringify({ t: 'proof', sig: signature.toString('base64url') }));
  }
  return conn;
}

describe('relay host ownership (R2)', () => {
  it('lets a host with a valid proof register and relays guest traffic', async () => {
    const { url } = await start();
    const identity = hostIdentity();
    const host = await registerHost(url, identity);
    await until(() => host.texts.some(text => text.includes('"ready"')));
    const guest = await open(url);
    guest.ws.send(JSON.stringify({ t: 'guest', topic: identity.topic }));
    await until(() => host.texts.some(text => text.includes('guest-join')));
    const id = JSON.parse(host.texts.find(text => text.includes('guest-join'))!).id as string;
    guest.ws.send(Buffer.from('ciphertext-up'));
    await until(() => host.frames.length === 1);
    expect(host.frames[0]!.subarray(0, 16).toString('hex')).toBe(id);
    expect(host.frames[0]!.subarray(16).toString()).toBe('ciphertext-up');
    host.ws.send(Buffer.concat([Buffer.from(id, 'hex'), Buffer.from('ciphertext-down')]));
    await until(() => guest.frames.length === 1);
    expect(guest.frames[0]!.toString()).toBe('ciphertext-down');
  });

  it('rejects a takeover without the private key and leaves host and guest usable', async () => {
    const { url } = await start();
    const identity = hostIdentity();
    const host = await registerHost(url, identity);
    await until(() => host.texts.some(text => text.includes('"ready"')));
    const guest = await open(url);
    guest.ws.send(JSON.stringify({ t: 'guest', topic: identity.topic }));
    await until(() => host.texts.some(text => text.includes('guest-join')));

    const attacker = hostIdentity();
    // wrong signing key for the victim's topic
    const forged = await registerHost(url, identity, attacker.privateKey);
    expect(await forged.closed).toBe(4401);
    // arbitrary key claiming a topic it does not own
    const preclaim = await open(url);
    preclaim.ws.send(JSON.stringify({ t: 'host', topic: identity.topic, key: attacker.key }));
    expect(await preclaim.closed).toBe(1008);
    // proof for an earlier challenge (replay of a stale nonce) fails
    const replay = await registerHost(url, identity, identity.privateKey, crypto.randomBytes(32));
    expect(await replay.closed).toBe(4401);

    expect(host.ws.readyState).toBe(WebSocket.OPEN);
    expect(guest.ws.readyState).toBe(WebSocket.OPEN);
    guest.ws.send(Buffer.from('still-works'));
    await until(() => host.frames.length === 1);
  });

  it('lets the real host replace its own earlier registration', async () => {
    const { url } = await start();
    const identity = hostIdentity();
    const first = await registerHost(url, identity);
    await until(() => first.texts.some(text => text.includes('"ready"')));
    const second = await registerHost(url, identity);
    await until(() => second.texts.some(text => text.includes('"ready"')));
    expect(await first.closed).toBe(4409);
  });
});

describe('relay connection slots (R2)', () => {
  it('does not leak a per-IP slot when an upgrade is malformed', async () => {
    const { relay, url, port } = await start({ maxConnectionsPerIp: 1 });
    await new Promise<void>(resolve => {
      const raw = net.connect(port, '127.0.0.1', () => {
        raw.write(`GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: !!bad!!\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Protocol: ${SUBPROTOCOL}\r\n\r\n`);
      });
      raw.resume();
      raw.on('close', () => resolve());
      raw.on('error', () => undefined);
    });
    await until(() => relay.stats().connections === 0);
    const conn = await open(url);
    expect(conn.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('frees the slot of an aborted connection', async () => {
    const { url, port } = await start({ maxConnectionsPerIp: 1 });
    const raw = net.connect(port, '127.0.0.1');
    await new Promise<void>(resolve => raw.once('connect', () => resolve()));
    raw.write('GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\n');
    raw.destroy();
    await new Promise(r => setTimeout(r, 100));
    const conn = await open(url);
    expect(conn.ws.readyState).toBe(WebSocket.OPEN);
  });
});
