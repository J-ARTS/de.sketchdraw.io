import WebSocket from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { createCrdtController } from '@/crdt';
import { createDocument } from '@/domain';
import { bindCrdtTransport, bootstrapRoomDocument } from '@/collaboration/crdt';
import { cloudRelayRoomUrl } from '../../../../src/collaboration/hdht/cloud-relay';
import { buildHdhtLink, createSessionId, parseHdhtInvitation, type HdhtInvitation } from '../../../../src/collaboration/hdht/invitation';
import { createHostKeys, hostKeyToText } from '../../../../src/collaboration/hdht/relay-channel';
import { createHdhtGuestTransport, createHdhtHostTransport } from '../../../../src/collaboration/hdht/session';
import { turnConfiguration, usableIceServers, type RtcPeerFactory } from '../../../../src/collaboration/hdht/turn-channel';
import type { CollaborationTransport } from '../../../../src/collaboration/transport';
import { RtcDouble } from '../rtc-double';
// @ts-expect-error plain ESM relay without declarations
import { createRelayServer } from '../../../../relay/server.mjs';
// @ts-expect-error plain ESM relay without declarations
import { generateIceServers, TURN_TTL_SECONDS, usableIceServers as roomIceServers } from '../../../../relay/cloudflare/src/room.mjs';

/*
 * POC(#303): the TURN route. WebRTC is a deterministic double here (no ICE, no TURN); what is real is the relay
 * with its hub, the signalling through the room, the end-to-end handshake on the data channel and the session.
 */
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await Promise.resolve(fn()).catch(() => undefined); RtcDouble.reset(); });
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const until = async (check: () => boolean, ms = 8000) => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error('timeout'); await wait(10); } };
const ready = (transport: CollaborationTransport) => until(() => transport.getStatus().state === 'ready');
const timing = { heartbeatMs: 500, timeoutMs: 4000 };
// `ws` reports closing a socket that is still connecting as an error event; a browser socket does not.
const factory = (url: string, protocols: string) => { const socket = new WebSocket(url, protocols); socket.on('error', () => undefined); return socket as never; };
const rtc: RtcPeerFactory = configuration => new RtcDouble(configuration) as unknown as RTCPeerConnection;

/** What Cloudflare answers, as documented: a STUN entry and a TURN entry with credentials, including port 53. */
const CLOUDFLARE_ICE = [
  { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
  {
    urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turn:turn.cloudflare.com:3478?transport=tcp', 'turn:turn.cloudflare.com:80?transport=tcp', 'turns:turn.cloudflare.com:5349?transport=tcp', 'turns:turn.cloudflare.com:443?transport=tcp'],
    username: 'user-1', credential: 'secret-1',
  },
];

async function relayWith(iceServers?: () => Promise<unknown[]> | unknown[]) {
  const relay = createRelayServer(iceServers ? { iceServers } : {});
  const address = await relay.listen(0, '127.0.0.1');
  cleanups.push(() => relay.close());
  return { relay, base: `ws://127.0.0.1:${address.port}` };
}

async function turnSession(base: string) {
  const hostKeys = await createHostKeys();
  const url = await cloudRelayRoomUrl(base, hostKeys.publicKey);
  const sessionId = createSessionId(), expiresAt = Date.now() + 60_000;
  const host = createHdhtHostTransport({
    sessionId, documentId: 'doc-1', hostKeys, grantedRole: () => 'editor', expiresAt, timing, authTimeoutMs: 3000,
    relay: { url, factory, backoffMs: [20, 40] }, turn: { rtc, timeoutMs: 4000 },
  });
  cleanups.push(() => host.close());
  const invitation: HdhtInvitation = { version: 1, sessionId, hostKey: hostKeyToText(hostKeys), directKey: '', relayUrl: url, documentId: 'doc-1', expiresAt, carrier: 'turn' };
  const guest = (overrides: Partial<Parameters<typeof createHdhtGuestTransport>[0]> = {}) => {
    const transport = createHdhtGuestTransport({ invitation, pin: host.getPin(), timing, relayFactory: factory, rtc, backoffMs: [20, 40], authTimeoutMs: 3000, attemptTimeoutMs: 6000, ...overrides });
    cleanups.push(() => transport.close());
    return transport;
  };
  return { host, invitation, guest, url };
}

describe('the TURN route: configuration and link (POC #303)', () => {
  it('keeps what a browser can use of the ICE servers and forces every packet through TURN', () => {
    const servers = usableIceServers(CLOUDFLARE_ICE);
    expect(servers).toEqual([
      { urls: ['stun:stun.cloudflare.com:3478'] },
      { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:3478?transport=tcp', 'turn:turn.cloudflare.com:80?transport=tcp', 'turns:turn.cloudflare.com:5349?transport=tcp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'user-1', credential: 'secret-1' },
    ]);
    // The Worker filters the same way before it answers.
    expect(roomIceServers(CLOUDFLARE_ICE)).toEqual(servers);
    expect(usableIceServers([{ urls: ['http://evil.example', 'turn:ok.example:3478'], username: 1 }, null, 'x', { urls: 'stun:one.example:3478' }])).toEqual([{ urls: ['turn:ok.example:3478'] }, { urls: ['stun:one.example:3478'] }]);
    expect(usableIceServers('nonsense')).toEqual([]);

    expect(turnConfiguration(CLOUDFLARE_ICE, 'wss://relay.example.org/v1/x')).toMatchObject({ iceTransportPolicy: 'relay', iceServers: servers });
    expect(turnConfiguration(CLOUDFLARE_ICE, 'ws://127.0.0.1:8787/v1/x').iceTransportPolicy).toBe('relay');
    // Without TURN servers the route is refused; only a relay on this computer may connect directly (tests, dev).
    expect(() => turnConfiguration([], 'wss://relay.example.org/v1/x')).toThrow('TURN_UNAVAILABLE');
    expect(() => turnConfiguration([{ urls: ['stun:stun.cloudflare.com:3478'] }], 'wss://relay.example.org/v1/x')).toThrow('TURN_UNAVAILABLE');
    expect(() => turnConfiguration([{ urls: ['turn:turn.example:3478'] }], 'wss://relay.example.org/v1/x')).toThrow('TURN_UNAVAILABLE');
    expect(turnConfiguration([], 'ws://127.0.0.1:8787/v1/x')).toEqual({ iceServers: [], iceTransportPolicy: 'all', iceCandidatePoolSize: 0 });
  });

  it('carries the carrier in the link; links of the other routes stay as they were', async () => {
    const keys = await createHostKeys();
    const relayUrl = await cloudRelayRoomUrl('relay.example.org', keys.publicKey);
    const base: HdhtInvitation = { version: 1, sessionId: createSessionId(), hostKey: hostKeyToText(keys), directKey: '', relayUrl, documentId: 'doc-1', expiresAt: Date.now() + 60_000 };
    const payload = (link: string) => JSON.parse(Buffer.from(link.split('sketchdraw-hdht=')[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
    expect(Object.keys(payload(buildHdhtLink(base))).sort()).toEqual(['d', 'e', 'h', 'i', 'r', 's', 'v']);
    expect(parseHdhtInvitation(buildHdhtLink(base))).toEqual(base);
    const turn: HdhtInvitation = { ...base, carrier: 'turn' };
    expect(payload(buildHdhtLink(turn))['c']).toBe('turn');
    expect(parseHdhtInvitation(buildHdhtLink(turn))).toEqual(turn);
    const forged = (change: Record<string, unknown>) => `sketchdraw://join#sketchdraw-hdht=${Buffer.from(JSON.stringify({ ...payload(buildHdhtLink(turn)), ...change })).toString('base64url')}`;
    expect(() => parseHdhtInvitation(forged({ c: 'relay' }))).toThrow('INVITATION_INVALID');
    expect(() => parseHdhtInvitation(forged({ c: '' }))).toThrow('INVITATION_INVALID');
    // TURN needs a place to meet.
    expect(() => parseHdhtInvitation(forged({ r: '' }))).toThrow('INVITATION_INVALID');
    expect(() => parseHdhtInvitation(forged({ x: 1 }))).toThrow('INVITATION_INVALID');
  });
});

describe('the Worker asks Cloudflare for TURN credentials (POC #303)', () => {
  it('sends the key as a bearer token, asks for a lifetime beyond the longest session and filters the answer', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ iceServers: CLOUDFLARE_ICE }), { status: 201 }); };
    const servers = await generateIceServers({ TURN_KEY_ID: ' key-1 ', TURN_KEY_API_TOKEN: 'token-1' }, fetcher);
    expect(servers).toEqual(usableIceServers(CLOUDFLARE_ICE));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://rtc.live.cloudflare.com/v1/turn/keys/key-1/credentials/generate-ice-servers');
    expect(calls[0]!.init).toMatchObject({ method: 'POST', headers: { authorization: 'Bearer token-1', 'content-type': 'application/json' } });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ ttl: TURN_TTL_SECONDS });
    expect(TURN_TTL_SECONDS).toBeGreaterThan(13 * 3600);
  });

  it('answers with a short reason and never with the key when TURN is not set up or Cloudflare refuses', async () => {
    const never = async () => { throw new Error('must not be called'); };
    await expect(generateIceServers({}, never)).rejects.toThrow('TURN_NOT_CONFIGURED');
    await expect(generateIceServers({ TURN_KEY_ID: 'key-1' }, never)).rejects.toThrow('TURN_NOT_CONFIGURED');
    const env = { TURN_KEY_ID: 'key-1', TURN_KEY_API_TOKEN: 'token-1' };
    await expect(generateIceServers(env, async () => new Response('denied', { status: 403 }))).rejects.toThrow('TURN_API_403');
    await expect(generateIceServers(env, async () => { throw new Error('token-1 leaked?'); })).rejects.toThrow('TURN_API_UNREACHABLE');
    await expect(generateIceServers(env, async () => new Response('not json', { status: 201 }))).rejects.toThrow('TURN_API_INVALID');
    // An answer without a TURN server with credentials is of no use to this route.
    await expect(generateIceServers(env, async () => new Response(JSON.stringify({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }] }), { status: 201 }))).rejects.toThrow('TURN_API_INVALID');
  });
});

describe('a session over the TURN route (WebRTC double)', () => {
  it('connects three guests through data channels: the room only introduces them and carries no session data', async () => {
    let asked = 0;
    const { relay, base } = await relayWith(() => { asked++; return CLOUDFLARE_ICE; });
    const { host, guest } = await turnSession(base);
    await ready(host);
    const document = createDocument('Together'); document.id = 'doc-1';
    const controller = createCrdtController(document); cleanups.push(() => controller.destroy());
    const binding = bindCrdtTransport(controller, host); cleanups.push(() => binding.close());
    const guests = await Promise.all([0, 1, 2].map(async () => {
      const transport = guest();
      const remote = await bootstrapRoomDocument(transport, { documentId: 'doc-1', timeoutMs: 8000 });
      cleanups.push(() => remote.destroy());
      const remoteBinding = bindCrdtTransport(remote, transport); cleanups.push(() => remoteBinding.close());
      return { transport, remote };
    }));
    await until(() => host.getStatus().peers.length === 3);
    for (const entry of guests) expect(entry.transport.getStatus()).toMatchObject({ state: 'ready', route: 'relay', grantedRole: 'editor' });

    // Every peer connection was forced through TURN with the credentials the relay handed out.
    expect(RtcDouble.all).toHaveLength(6);
    for (const pc of RtcDouble.all) {
      expect(pc.config.iceTransportPolicy).toBe('relay');
      expect(pc.config.iceServers).toEqual(usableIceServers(CLOUDFLARE_ICE));
    }
    // The host asked once for all guests (and once ahead of them), each guest once for itself.
    expect(asked).toBe(1 + 3);
    // The guests have left the room: only the host's registration remains at the relay.
    await until(() => relay.stats().connections === 1);

    const before = relay.stats();
    controller.dispatch({ type: 'rename', title: 'From the host' }, { actorId: 'host', source: 'human', expectedRevision: controller.getSnapshot().revision });
    await until(() => guests.every(entry => entry.remote.getSnapshot().document.title === 'From the host'));
    const second = guests[1]!.remote;
    second.dispatch({ type: 'rename', title: 'From a guest' }, { actorId: 'guest-2', source: 'human', expectedRevision: second.getSnapshot().revision });
    await until(() => controller.getSnapshot().document.title === 'From a guest' && guests.every(entry => entry.remote.getSnapshot().document.title === 'From a guest'));
    // None of that went through the relay, and nothing on the data channels is readable.
    expect(relay.stats().forwardedRecords).toBe(before.forwardedRecords);
    // What the relay did forward is the signalling of three guests: an offer and an answer each, no candidates here.
    expect(before.forwardedRecords).toBe(6);
    const onChannels = RtcDouble.sent.map(entry => Buffer.from(entry.data as ArrayBuffer).toString('latin1')).join('');
    expect(RtcDouble.sent.length).toBeGreaterThan(10);
    expect(onChannels).not.toContain('From the host');
    expect(onChannels).not.toContain(host.getPin());

    // A data channel that drops is a lost guest; the others stay.
    RtcDouble.all.find(pc => pc.channels.some(channel => channel.readyState === 'open'))!.close();
    await until(() => host.getStatus().peers.length === 2);
  });

  it('keeps the PIN and the pinned host key in force on the data channel', async () => {
    const { base } = await relayWith(() => CLOUDFLARE_ICE);
    const { host, guest, invitation } = await turnSession(base);
    await ready(host);
    const wrong = guest({ pin: host.getPin() === '000000' ? '111111' : '000000' });
    await until(() => wrong.getStatus().state === 'error');
    expect(wrong.getStatus().error).toBe('PIN_INVALID');
    const other = await createHostKeys();
    const impostor = guest({ invitation: { ...invitation, hostKey: hostKeyToText(other) } });
    await until(() => impostor.getStatus().state === 'error', 12_000);
    expect(host.getStatus().peers).toHaveLength(0);
  }, 15_000);

  it('tells the host why TURN is not usable, keeps asking, and starts listening once the relay hands servers out', async () => {
    let configured = false;
    const { base } = await relayWith(() => { if (!configured) throw new Error('TURN_NOT_CONFIGURED'); return CLOUDFLARE_ICE; });
    const { host, guest } = await turnSession(base);
    await until(() => host.getStatus().error === 'TURN_NOT_CONFIGURED');
    expect(host.getStatus().state).toBe('connecting');
    const early = guest({ attemptTimeoutMs: 1500 });
    await until(() => early.getStatus().state === 'error', 12_000);
    expect(host.getStatus().peers).toHaveLength(0);
    configured = true;
    // The host asks again on its own (after 15 s in the app); a new registration asks at once.
    const again = await turnSession(base);
    await ready(again.host);
    const late = again.guest();
    await ready(late);
  }, 20_000);

  it('refuses the route against a relay that has no TURN servers to offer, unless that relay runs on this computer', async () => {
    // A relay on this computer without TURN: the double "connects directly", as local development does.
    const { base } = await relayWith(() => []);
    const local = await turnSession(base);
    await ready(local.host);
    const joined = local.guest();
    await ready(joined);
    expect(RtcDouble.all.every(pc => pc.config.iceTransportPolicy === 'all')).toBe(true);
    // A relay that does not know the request at all closes the connection; the host never listens.
    const plain = await relayWith();
    const none = await turnSession(plain.base);
    await wait(400);
    expect(none.host.getStatus().state).not.toBe('ready');
  });
});
