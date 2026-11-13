import WebSocket from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCrdtController } from '@/crdt';
import { createDocument, createElement } from '@/domain';
import { bindCrdtTransport, bootstrapRoomDocument } from '@/collaboration/crdt';
import { openChannelIo } from '../../../../src/collaboration/hdht/channel-io';
import { bytesToBase64Url, jsonBody, MESSAGE } from '../../../../src/collaboration/hdht/codec';
import { computePinProof, createSessionId, PinGate, type HdhtInvitation } from '../../../../src/collaboration/hdht/invitation';
import { createHostKeys, hostKeyToText, RelayRecordChannel } from '../../../../src/collaboration/hdht/relay-channel';
import { connectRelayGuest } from '../../../../src/collaboration/hdht/relay-wire';
import { createHdhtGuestTransport, createHdhtHostTransport, type HdhtHostTransport } from '../../../../src/collaboration/hdht/session';
import type { CollaborationTransport } from '../../../../src/collaboration/transport';
// @ts-expect-error plain ESM relay without type declarations
import { createRelayServer } from '../../../../relay/server.mjs';

const factory = (url: string, protocols: string) => new WebSocket(url, protocols) as never;
const timing = { heartbeatMs: 500, timeoutMs: 4000 };
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await Promise.resolve(fn()).catch(() => undefined); });
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const until = async (check: () => boolean, ms = 8000) => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error('timeout'); await wait(15); } };

async function setup(options: { role?: 'editor' | 'viewer'; expiresInMs?: number; maxParticipants?: number; pinGate?: PinGate } = {}) {
  const relay = createRelayServer();
  const address = await relay.listen(0, '127.0.0.1');
  const url = `ws://127.0.0.1:${address.port}/`;
  cleanups.push(() => relay.close());
  const hostKeys = await createHostKeys();
  const sessionId = createSessionId();
  const expiresAt = Date.now() + (options.expiresInMs ?? 60_000);
  const role = options.role ?? 'editor';
  const host: HdhtHostTransport = createHdhtHostTransport({
    sessionId, documentId: 'doc-1', hostKeys, grantedRole: () => role, expiresAt, timing, authTimeoutMs: 3000,
    ...(options.maxParticipants ? { maxParticipants: options.maxParticipants } : {}),
    ...(options.pinGate ? { pinGate: options.pinGate } : {}),
    relay: { url, factory, backoffMs: [50, 100] },
  });
  cleanups.push(() => host.close());
  await until(() => host.getStatus().state === 'ready');
  const invitation: HdhtInvitation = { version: 1, sessionId, hostKey: hostKeyToText(hostKeys), directKey: '', relayUrl: url, documentId: 'doc-1', expiresAt };
  const guest = (pin = host.getPin(), overrides: Partial<Parameters<typeof createHdhtGuestTransport>[0]> = {}, onSocket?: (socket: WebSocket) => void) => {
    const sockets: WebSocket[] = [];
    const transport = createHdhtGuestTransport({
      invitation, pin, timing, relayFactory: (u, p) => { const s = new WebSocket(u, p); sockets.push(s); onSocket?.(s); return s as never; },
      backoffMs: [20, 40], authTimeoutMs: 3000, ...overrides,
    });
    cleanups.push(() => transport.close());
    return { transport, sockets };
  };
  return { relay, url, host, hostKeys, sessionId, invitation, guest, expiresAt };
}
const ready = (transport: CollaborationTransport) => until(() => transport.getStatus().state === 'ready');

describe('HyperDHT+relay session over a real local relay', () => {
  it('#179 retries shared receive-capacity pressure without a final kick or a host-wide failure', async () => {
    const { host, guest } = await setup();
    const controller = createCrdtController(createDocument('Busy host')); cleanups.push(() => controller.destroy());
    const first = guest().transport, second = guest().transport;
    await Promise.all([ready(first), ready(second)]);
    const errors: string[] = [], peerErrors: string[] = [], states: string[] = [];
    second.subscribeStatus(status => states.push(status.state));
    const binding = bindCrdtTransport(controller, host, undefined, {
      onError: error => errors.push(error.message),
      onPeerError: (error, peer) => {
        peerErrors.push(error.message);
        if (error.message === 'SYNC_TRANSFER_BUSY') { host.retryPeer(peer.peerId); void first.close(); }
        else host.kick(peer.peerId);
      },
    });
    cleanups.push(() => binding.close());
    const frame = new Uint8Array(60 + 48 * 1024); frame.set([0x53, 0x43, 0x59, 0x31]);
    new DataView(frame.buffer).setUint32(20, 40 * 1024 * 1024);
    let assets = 0; host.subscribeMessage(message => { if (message.channel === 'asset') assets++; });
    await first.send('asset', frame); await until(() => assets === 1);
    await second.send('asset', frame);
    await until(() => peerErrors.length === 1 && states.includes('reconnecting') && second.getStatus().state === 'ready');
    expect(peerErrors).toEqual(['SYNC_TRANSFER_BUSY']); expect(errors).toEqual([]);
    expect(second.getStatus().error).toBeUndefined(); expect(host.getStatus().state).toBe('ready');
    expect(states).not.toContain('error');
    const received: Uint8Array[] = [];
    second.subscribeMessage(message => { if (message.channel === 'update') received.push(message.data); });
    controller.dispatch({ type: 'rename', title: 'Recovered capacity' }, { actorId: 'host', source: 'human', expectedRevision: controller.getSnapshot().revision });
    await until(() => received.length > 0);
  });

  it('#179 isolates a malformed authenticated editor upload while a second encrypted guest keeps syncing', async () => {
    const { host, guest } = await setup();
    const document = createDocument('Host survives'); document.id = 'doc-1';
    const controller = createCrdtController(document); cleanups.push(() => controller.destroy());
    const errors: string[] = [], peerErrors: string[] = [];
    const binding = bindCrdtTransport(controller, host, undefined, {
      onError: error => errors.push(error.message),
      onPeerError: (error, peer) => { peerErrors.push(error.message); host.kick(peer.peerId); },
    });
    cleanups.push(() => binding.close());
    const attacker = guest().transport, survivor = guest().transport;
    const remote = await bootstrapRoomDocument(survivor, { documentId: document.id, timeoutMs: 8000 });
    cleanups.push(() => remote.destroy());
    const remoteBinding = bindCrdtTransport(remote, survivor); cleanups.push(() => remoteBinding.close());
    await ready(attacker); await until(() => host.getStatus().peers.length === 2);
    await attacker.send('asset', Uint8Array.of(0x53, 0x43, 0x59, 0x31));
    await until(() => attacker.getStatus().state === 'error');
    expect(attacker.getStatus().error).toBe('KICKED');
    expect(host.getStatus()).toMatchObject({ state: 'ready' });
    expect(host.getStatus().peers).toHaveLength(1);
    expect(peerErrors).toEqual(['SYNC_TRANSFER_INVALID']); expect(errors).toEqual([]);
    controller.dispatch({ type: 'rename', title: 'Still connected' }, { actorId: 'host', source: 'human', expectedRevision: controller.getSnapshot().revision });
    await until(() => remote.getSnapshot().document.title === 'Still connected');
    remote.dispatch({ type: 'rename', title: 'Survivor edits' }, { actorId: 'survivor', source: 'human', expectedRevision: remote.getSnapshot().revision });
    await until(() => controller.getSnapshot().document.title === 'Survivor edits');
  });

  it('bootstraps and syncs Yjs in both directions through the encrypted relay route', async () => {
    const { host, guest } = await setup();
    const document = createDocument('Gemeinsam');
    document.id = 'doc-1';
    document.elements = [createElement('rectangle', { x: 1, y: 2, width: 30, height: 40 })];
    const hostController = createCrdtController(document);
    bindCrdtTransport(hostController, host);
    const { transport } = guest();
    const fetched = await bootstrapRoomDocument(transport, { documentId: 'doc-1', timeoutMs: 8000 });
    expect(fetched.getSnapshot().document.elements).toHaveLength(1);
    bindCrdtTransport(fetched, transport);
    await ready(transport);
    expect(transport.getStatus()).toMatchObject({ route: 'relay', grantedRole: 'editor' });
    hostController.dispatch({ type: 'rename', title: 'Vom Host' }, { actorId: 'actor:h', expectedRevision: hostController.getSnapshot().revision, source: 'human' });
    await until(() => fetched.getSnapshot().document.title === 'Vom Host');
    fetched.dispatch({ type: 'rename', title: 'Vom Gast' }, { actorId: 'actor:g', expectedRevision: fetched.getSnapshot().revision, source: 'human' });
    await until(() => hostController.getSnapshot().document.title === 'Vom Gast');
  });

  it('does not show plaintext of the drawing on the relay wire', async () => {
    const { host, guest } = await setup();
    const seen: Buffer[] = [];
    const document = createDocument('GEHEIMER-TITEL-XYZ');
    document.id = 'doc-1';
    const hostController = createCrdtController(document);
    bindCrdtTransport(hostController, host);
    const { transport } = guest(undefined, {}, socket => socket.on('message', data => seen.push(Buffer.from(data as Buffer))));
    const fetched = await bootstrapRoomDocument(transport, { documentId: 'doc-1', timeoutMs: 8000 });
    expect(fetched.getSnapshot().document.title).toBe('GEHEIMER-TITEL-XYZ');
    bindCrdtTransport(fetched, transport);
    await ready(transport);
    hostController.dispatch({ type: 'rename', title: 'GEHEIMER-TITEL-ABC' }, { actorId: 'actor:h', expectedRevision: hostController.getSnapshot().revision, source: 'human' });
    await until(() => fetched.getSnapshot().document.title === 'GEHEIMER-TITEL-ABC', 4000);
    const wire = Buffer.concat(seen).toString('latin1');
    expect(wire).not.toContain('GEHEIMER');
    expect(wire).not.toContain(host.getPin());
    expect(seen.length).toBeGreaterThan(3);
  });

  it('refuses a wrong PIN, reports remaining attempts and leaves no host peer', async () => {
    const { host, guest } = await setup();
    const { transport } = guest('000000' === host.getPin() ? '000001' : '000000');
    await until(() => transport.getStatus().state === 'error');
    expect(transport.getStatus()).toMatchObject({ error: 'PIN_INVALID', attemptsLeft: 19 });
    expect(host.getStatus().peers).toHaveLength(0);
  });

  it('rejects a host that cannot prove the pinned identity (tampered session binding) as final', async () => {
    const { invitation, host, guest } = await setup();
    const { transport } = guest(host.getPin(), { invitation: { ...invitation, sessionId: createSessionId() } });
    await until(() => transport.getStatus().state === 'error');
    expect(transport.getStatus().error).toBe('HOST_KEY_MISMATCH');
    expect(host.getStatus().peers).toHaveLength(0);
  });

  it('enforces the viewer role on the host even against a raw malicious client', async () => {
    const { host, url, invitation } = await setup({ role: 'viewer' });
    const received: unknown[] = [];
    host.subscribeMessage(message => { received.push(message.channel); });
    const channel = await connectRelayGuest({ url, sessionId: invitation.sessionId, hostKey: invitation.hostKey, factory });
    const closes: string[] = [];
    const types: number[] = [];
    const io = openChannelIo(channel, { message: type => types.push(type), close: reason => closes.push(reason) }, timing);
    io.start();
    await io.send(MESSAGE.auth, jsonBody({ proof: bytesToBase64Url(await computePinProof(host.getPin(), io.binding, invitation.sessionId)) }));
    await until(() => types.includes(MESSAGE.authOk));
    await io.send(MESSAGE.update, Uint8Array.of(1, 2, 3));
    await until(() => closes.length > 0);
    expect(closes[0]).toContain('ACCESS_DENIED');
    expect(received).not.toContain('update');
  });

  it('keeps a viewer from sending updates and lets the host stay unchanged', async () => {
    const { host, guest } = await setup({ role: 'viewer' });
    const document = createDocument('Nur ansehen');
    document.id = 'doc-1';
    const hostController = createCrdtController(document);
    bindCrdtTransport(hostController, host);
    const { transport } = guest();
    const fetched = await bootstrapRoomDocument(transport, { documentId: 'doc-1', timeoutMs: 8000 });
    bindCrdtTransport(fetched, transport);
    await expect(transport.send('update', Uint8Array.of(1))).rejects.toThrow('ACCESS_DENIED');
    fetched.dispatch({ type: 'rename', title: 'Viewer-Edit' }, { actorId: 'actor:v', expectedRevision: fetched.getSnapshot().revision, source: 'human' });
    await wait(300);
    expect(hostController.getSnapshot().document.title).toBe('Nur ansehen');
  });

  it('reconnects with fresh keys after the connection is cut, and resyncs', async () => {
    const { host, guest } = await setup();
    const document = createDocument('Reconnect');
    document.id = 'doc-1';
    const hostController = createCrdtController(document);
    bindCrdtTransport(hostController, host);
    const { transport, sockets } = guest();
    const fetched = await bootstrapRoomDocument(transport, { documentId: 'doc-1', timeoutMs: 8000 });
    bindCrdtTransport(fetched, transport);
    await ready(transport);
    const before = transport.getStatus().peers[0]!.keyHash;
    sockets[0]!.terminate();
    await until(() => transport.getStatus().state === 'reconnecting');
    await ready(transport);
    expect(transport.getStatus().peers[0]!.keyHash).not.toBe(before);
    hostController.dispatch({ type: 'rename', title: 'Nach Reconnect' }, { actorId: 'actor:h', expectedRevision: hostController.getSnapshot().revision, source: 'human' });
    await until(() => fetched.getSnapshot().document.title === 'Nach Reconnect');
  });

  it('recovers an authenticated guest after another peer has triggered the real PIN cooldown', async () => {
    const pinGate = new PinGate({ baseCooldownMs: 1000 });
    const { host, guest } = await setup({ pinGate });
    const { transport, sockets } = guest();
    await ready(transport);
    for (let attempt = 0; attempt < 5; attempt++) await pinGate.attempt(async () => false);
    sockets[0]!.terminate();
    await until(() => transport.getStatus().error === 'PIN_LOCKED');
    expect(transport.getStatus().state).toBe('reconnecting');
    await ready(transport);
    expect(transport.getStatus().attempt).toBeGreaterThanOrEqual(3);
    expect(host.pinRemainingFailures).toBe(15);
  });

  it.each(['renewed', 'retired'])('does not readmit a previous guest with a %s PIN', async policy => {
    const pinGate = new PinGate({ maxFailures: policy === 'retired' ? 1 : 20 });
    const { host, guest } = await setup({ pinGate });
    const { transport, sockets } = guest();
    await ready(transport);
    if (policy === 'renewed') {
      const oldPin = host.getPin();
      while (host.renewPin() === oldPin) { /* Avoid the random six-digit collision in this regression. */ }
    }
    else await pinGate.attempt(async () => false);
    sockets[0]!.terminate();
    await until(() => transport.getStatus().state === 'error');
    expect(transport.getStatus().error).toBe(policy === 'retired' ? 'PIN_RETIRED' : 'PIN_INVALID');
    expect(host.getStatus().peers).toHaveLength(0);
  });

  it('reports a partial broadcast failure even when another guest receives the update', async () => {
    const { host, guest } = await setup();
    const first = guest().transport;
    const second = guest().transport;
    await Promise.all([ready(first), ready(second)]);
    const received: Uint8Array[] = [];
    first.subscribeMessage(message => { received.push(message.data); });
    second.subscribeMessage(message => { received.push(message.data); });
    const original = RelayRecordChannel.prototype.send;
    let rejected = false;
    vi.spyOn(RelayRecordChannel.prototype, 'send').mockImplementation(function (this: RelayRecordChannel, data) {
      if (data[0] === MESSAGE.update && !rejected) { rejected = true; return Promise.reject(new Error('SIMULATED_WRITE_FAILURE')); }
      return original.call(this, data);
    });
    await expect(host.send('update', Uint8Array.of(1, 2, 3))).rejects.toThrow('SEND_FAILED');
    await until(() => received.length === 1);
    expect(received[0]).toEqual(Uint8Array.of(1, 2, 3));
  });

  it.each(['SYNC_FAILED', 'DOCUMENT_TOO_LARGE_FOR_COLLABORATION'])('propagates host %s through the authenticated encrypted bye', async reason => {
    const { host, guest } = await setup();
    const { transport } = guest();
    await ready(transport);
    await host.close(reason);
    await until(() => transport.getStatus().state === 'error');
    expect(host.getStatus()).toMatchObject({ state: 'closed', error: reason });
    expect(transport.getStatus().error).toBe(reason);
  });

  it('keeps the host and other guests connected when one guest reports its own sync failure', async () => {
    const { host, guest } = await setup();
    const first = guest().transport;
    const second = guest().transport;
    await Promise.all([ready(first), ready(second)]);
    await first.close('SYNC_FAILED');
    await until(() => host.getStatus().peers.length === 1);
    expect(first.getStatus()).toMatchObject({ state: 'closed', error: 'SYNC_FAILED' });
    expect(host.getStatus().state).toBe('ready');
    expect(host.getStatus().error).toBeUndefined();
    expect(second.getStatus().state).toBe('ready');
  });

  it('treats a host kick as final: no automatic rejoin (R13)', async () => {
    const { host, guest } = await setup();
    const { transport } = guest();
    await ready(transport);
    host.kick(host.getStatus().peers[0]!.peerId);
    await until(() => transport.getStatus().state === 'error');
    expect(transport.getStatus().error).toBe('KICKED');
    await wait(400);
    expect(host.getStatus().peers).toHaveLength(0);
    expect(transport.getStatus().state).toBe('error');
  });

  it('reports SESSION_ENDED immediately when the host ends the session (R13)', async () => {
    const { host, guest } = await setup();
    const { transport } = guest();
    await ready(transport);
    const started = Date.now();
    await host.close();
    await until(() => transport.getStatus().state === 'error', 3000);
    expect(transport.getStatus().error).toBe('SESSION_ENDED');
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('leaves no ghost connection when the guest closes while authenticating (R11)', async () => {
    const { host, guest, relay } = await setup();
    const { transport } = guest();
    await until(() => transport.getStatus().phase === 'authenticating' || transport.getStatus().state === 'ready');
    await transport.close();
    await wait(400);
    expect(host.getStatus().peers).toHaveLength(0);
    expect(relay.stats().connections).toBe(1);
  });

  it('never admits more guests than the capacity when they authenticate in parallel (R11)', async () => {
    const { host, guest } = await setup({ maxParticipants: 2 });
    const a = guest().transport;
    const b = guest().transport;
    const c = guest().transport;
    await until(() => [a, b, c].filter(t => t.getStatus().state === 'ready').length >= 1 && [a, b, c].filter(t => t.getStatus().error === 'ROOM_FULL').length >= 2);
    expect(host.getStatus().peers).toHaveLength(1);
  });

  it('enforces the host-owned invitation deadline, not the editable link (R14)', async () => {
    const { host, guest, invitation } = await setup({ expiresInMs: 700 });
    const early = guest().transport;
    await ready(early);
    await wait(800);
    const forged = guest(host.getPin(), { invitation: { ...invitation, expiresAt: Date.now() + 60_000 } }).transport;
    await until(() => forged.getStatus().state === 'error');
    expect(forged.getStatus().error).toBe('INVITATION_EXPIRED');
    expect(early.getStatus().state).toBe('ready');
    expect(host.getStatus().peers).toHaveLength(1);
  });
});
