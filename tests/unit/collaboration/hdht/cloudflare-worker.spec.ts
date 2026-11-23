import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import WebSocket from 'ws';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createCrdtController } from '@/crdt';
import { createDocument } from '@/domain';
import { bindCrdtTransport, bootstrapRoomDocument } from '@/collaboration/crdt';
import { cloudRelayRoomUrl } from '../../../../src/collaboration/hdht/cloud-relay';
import { bytesToBase64Url, relayTopic } from '../../../../src/collaboration/hdht/codec';
import { createSessionId, type HdhtInvitation } from '../../../../src/collaboration/hdht/invitation';
import { createHostKeys, hostKeyToText } from '../../../../src/collaboration/hdht/relay-channel';
import { createHdhtGuestTransport, createHdhtHostTransport } from '../../../../src/collaboration/hdht/session';
import type { CollaborationTransport } from '../../../../src/collaboration/transport';

/*
 * The Cloudflare relay in the real Workers runtime (workerd), started from relay/cloudflare/wrangler.jsonc with the
 * tooling of that package. It runs where that tooling is installed (`npm ci --prefix relay/cloudflare`) and is skipped
 * elsewhere; cloud-relay.spec.ts covers the same room logic without the runtime.
 */
const PACKAGE = path.resolve(__dirname, '../../../../relay/cloudflare');
const installed = existsSync(path.join(PACKAGE, 'node_modules', 'wrangler', 'package.json'));

interface LocalWorker { ready: Promise<void>; url: Promise<URL>; dispose(): Promise<void> }
let worker: LocalWorker | undefined;
let base = '';
const cleanups: (() => Promise<void> | void)[] = [];
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const until = async (check: () => boolean, ms = 10_000) => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error('timeout'); await wait(15); } };
const ready = (transport: CollaborationTransport) => until(() => transport.getStatus().state === 'ready');
const factory = (url: string, protocols: string) => new WebSocket(url, protocols) as never;
const timing = { heartbeatMs: 500, timeoutMs: 4000 };

describe.skipIf(!installed)('the Cloudflare relay in the Workers runtime (#300)', () => {
  beforeAll(async () => {
    const wrangler = createRequire(path.join(PACKAGE, 'package.json'))('wrangler') as { unstable_startWorker(options: unknown): Promise<LocalWorker> };
    worker = await wrangler.unstable_startWorker({ config: path.join(PACKAGE, 'wrangler.jsonc'), dev: { server: { hostname: '127.0.0.1', port: 0 }, inspector: false, logLevel: 'error' } });
    await worker.ready;
    base = String(await worker.url);
  }, 120_000);
  afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await Promise.resolve(fn()).catch(() => undefined); });
  afterAll(async () => { await worker?.dispose(); }, 60_000);

  const http = (pathname: string, init?: RequestInit) => fetch(new URL(pathname, base), init);
  const wsBase = () => base.replace(/^http/, 'ws');

  function raw(pathname: string, protocol: string | null = 'sketchdraw-relay.v1') {
    const socket = protocol ? new WebSocket(new URL(pathname, wsBase()), protocol) : new WebSocket(new URL(pathname, wsBase()));
    cleanups.push(() => socket.terminate());
    const texts: string[] = [];
    let closed: { code: number; reason: string } | null = null, refused = 0;
    socket.on('message', (data, isBinary) => { if (!isBinary) texts.push(data.toString()); });
    socket.on('close', (code, reason) => { closed = { code, reason: reason.toString() }; });
    socket.on('unexpected-response', (_request, response) => { refused = response.statusCode ?? 0; });
    socket.on('error', () => undefined);
    return { socket, texts, closed: () => closed, refused: () => refused, opened: () => new Promise<void>((resolve, reject) => { socket.once('open', () => resolve()); socket.once('error', reject); }) };
  }

  it('answers the health check and refuses everything that is not a room socket', async () => {
    const health = await http('/healthz');
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok', service: 'sketchdraw-relay', protocol: 'sketchdraw-relay.v1' });
    const topic = 'ab'.repeat(32);
    // Every answer is read to its end, so no request waits for an earlier one.
    const status = async (pathname: string): Promise<number> => { const response = await http(pathname); await response.arrayBuffer(); return response.status; };
    expect(await status('/')).toBe(404);
    expect(await status('/v1')).toBe(404);
    expect(await status(`/v1/${topic.toUpperCase()}`)).toBe(404);
    expect(await status(`/v1/${topic}`)).toBe(426);
    const noProtocol = raw(`/v1/${topic}`, null);
    await until(() => noProtocol.refused() !== 0);
    expect(noProtocol.refused()).toBe(400);
  });

  it('checks the host proof with the key of the room and turns away a guest while no host is there', async () => {
    const keys = await createHostKeys(), other = await createHostKeys();
    const topic = await relayTopic(keys.publicKey);
    const early = raw(`/v1/${topic}`);
    await early.opened();
    early.socket.send(JSON.stringify({ t: 'guest', topic }));
    await until(() => early.closed() !== null);
    expect(early.texts.map(text => JSON.parse(text))).toEqual([{ t: 'error', code: 'HOST_OFFLINE' }]);
    expect(early.closed()).toEqual({ code: 4404, reason: 'host-offline' });

    // A room only serves its own topic: another session's host is closed before it can take the place.
    const stranger = raw(`/v1/${topic}`);
    await stranger.opened();
    stranger.socket.send(JSON.stringify({ t: 'host', topic: await relayTopic(other.publicKey), key: bytesToBase64Url(other.publicKey) }));
    await until(() => stranger.closed() !== null);
    expect(stranger.closed()).toEqual({ code: 1008, reason: 'bad-topic' });

    // The right topic with a signature of the wrong key fails the proof (Ed25519 verified inside the runtime).
    const forged = raw(`/v1/${topic}`);
    await forged.opened();
    forged.socket.send(JSON.stringify({ t: 'host', topic, key: bytesToBase64Url(keys.publicKey) }));
    await until(() => forged.texts.length === 1);
    const challenge = JSON.parse(forged.texts[0]!) as { t: string; nonce: string };
    expect(challenge.t).toBe('challenge');
    const { hostProofMessage, hexToBytes } = await import('../../../../src/collaboration/hdht/codec');
    forged.socket.send(JSON.stringify({ t: 'proof', sig: bytesToBase64Url(await other.sign(hostProofMessage(topic, hexToBytes(challenge.nonce)))) }));
    await until(() => forged.closed() !== null);
    expect(forged.closed()).toEqual({ code: 4401, reason: 'bad-proof' });
  });

  it('carries a session of a host and four guests: every edit reaches everyone, and a second session stays separate', async () => {
    async function session(title: string) {
      const hostKeys = await createHostKeys();
      const url = await cloudRelayRoomUrl(wsBase(), hostKeys.publicKey);
      const sessionId = createSessionId(), expiresAt = Date.now() + 60_000;
      const host = createHdhtHostTransport({
        sessionId, documentId: 'doc-1', hostKeys, grantedRole: () => 'editor', expiresAt, timing, authTimeoutMs: 4000,
        relay: { url, factory, backoffMs: [50, 100], keepAliveMs: 200 },
      });
      cleanups.push(() => host.close());
      await ready(host);
      const document = createDocument(title); document.id = 'doc-1';
      const controller = createCrdtController(document); cleanups.push(() => controller.destroy());
      const binding = bindCrdtTransport(controller, host); cleanups.push(() => binding.close());
      const invitation: HdhtInvitation = { version: 1, sessionId, hostKey: hostKeyToText(hostKeys), directKey: '', relayUrl: url, documentId: 'doc-1', expiresAt };
      const join = async () => {
        const transport = createHdhtGuestTransport({ invitation, pin: host.getPin(), timing, relayFactory: factory, backoffMs: [50, 100], authTimeoutMs: 4000 });
        cleanups.push(() => transport.close());
        const remote = await bootstrapRoomDocument(transport, { documentId: 'doc-1', timeoutMs: 10_000 });
        cleanups.push(() => remote.destroy());
        const remoteBinding = bindCrdtTransport(remote, transport); cleanups.push(() => remoteBinding.close());
        return { transport, remote };
      };
      return { host, controller, join };
    }
    const first = await session('First'), second = await session('Second');
    const guests = await Promise.all([first.join(), first.join(), first.join(), first.join()]);
    const outsider = await second.join();
    await until(() => first.host.getStatus().peers.length === 4 && second.host.getStatus().peers.length === 1);
    for (const guest of guests) expect(guest.transport.getStatus()).toMatchObject({ state: 'ready', route: 'relay', grantedRole: 'editor' });

    first.controller.dispatch({ type: 'rename', title: 'From the host' }, { actorId: 'host', source: 'human', expectedRevision: first.controller.getSnapshot().revision });
    await until(() => guests.every(guest => guest.remote.getSnapshot().document.title === 'From the host'));
    const editor = guests[3]!.remote;
    editor.dispatch({ type: 'rename', title: 'From a guest' }, { actorId: 'guest-4', source: 'human', expectedRevision: editor.getSnapshot().revision });
    await until(() => first.controller.getSnapshot().document.title === 'From a guest' && guests.every(guest => guest.remote.getSnapshot().document.title === 'From a guest'));
    expect(outsider.remote.getSnapshot().document.title).toBe('Second');
    expect(second.controller.getSnapshot().document.title).toBe('Second');

    // The host waited through several keep-alive pings and is still registered; ending the session reaches every guest.
    await wait(700);
    expect(first.host.getStatus().state).toBe('ready');
    await first.host.close();
    await until(() => guests.every(guest => guest.transport.getStatus().state === 'error'));
    expect(guests.map(guest => guest.transport.getStatus().error)).toEqual(['SESSION_ENDED', 'SESSION_ENDED', 'SESSION_ENDED', 'SESSION_ENDED']);
    expect(outsider.transport.getStatus().state).toBe('ready');
  }, 60_000);
});
