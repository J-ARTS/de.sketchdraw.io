import { afterEach, describe, expect, it } from 'vitest';
import { createCrdtController } from '@/crdt';
import { createDocument, createElement } from '@/domain';
import { bindCrdtTransport, bootstrapRoomDocument } from '@/collaboration/crdt';
import { createSessionId, type HdhtInvitation } from '../../../../src/collaboration/hdht/invitation';
import { createHostKeys, hostKeyToText } from '../../../../src/collaboration/hdht/relay-channel';
import { createHdhtGuestTransport, createHdhtHostTransport } from '../../../../src/collaboration/hdht/session';
import { serviceAdTopic } from '../../../../relay/hub.mjs';
import { cleanups, nativeSide, runCleanups, startHelper, testnet, until, wait } from './harness';

const timing = { heartbeatMs: 400, timeoutMs: 3000 };
afterEach(runCleanups);

type Net = Awaited<ReturnType<typeof testnet>>;

async function startHost(net: Net, options: { role?: 'editor' | 'viewer'; expiresInMs?: number; title?: string } = {}) {
  const hostKeys = await createHostKeys();
  const sessionId = createSessionId();
  const expiresAt = Date.now() + (options.expiresInMs ?? 120_000);
  const side = nativeSide(net);
  const { publicKey } = await side.service.hostStart();
  const host = createHdhtHostTransport({
    sessionId, documentId: 'doc-1', hostKeys, grantedRole: () => options.role ?? 'editor', expiresAt, timing, authTimeoutMs: 8000,
    direct: { link: side.link, publicKey },
    peers: { link: side.link, retryMs: 150, steadyMs: 400 },
  });
  cleanups.push(() => host.close());
  const document = createDocument(options.title ?? 'Über Helfer');
  document.id = 'doc-1';
  document.elements = [createElement('rectangle', { x: 1, y: 2, width: 30, height: 40 })];
  const controller = createCrdtController(document);
  bindCrdtTransport(controller, host);
  const invitation: HdhtInvitation = { version: 1, sessionId, hostKey: hostKeyToText(hostKeys), directKey: publicKey, relayUrl: '', documentId: 'doc-1', expiresAt };
  return { host, controller, invitation, side };
}

/** A guest whose direct path to the host is blocked: only helper peers can carry the session. */
function blockedGuest(net: Net, invitation: HdhtInvitation, pin: string, overrides: Partial<Parameters<typeof createHdhtGuestTransport>[0]> = {}) {
  const side = nativeSide(net, { connectTimeoutMs: 2500 });
  side.blocked.add(invitation.directKey);
  const won: string[] = [];
  const failed: string[] = [];
  const transport = createHdhtGuestTransport({
    invitation, pin, direct: side.link, timing, directTimeoutMs: 1500, relayStartDelayMs: 100, backoffMs: [50, 100], authTimeoutMs: 8000,
    onCandidate: (key, outcome) => { if (outcome === 'won') won.push(key); if (outcome === 'failed') failed.push(key); },
    ...overrides,
  });
  cleanups.push(() => transport.close());
  return { transport, side, won, failed };
}

const hostHelpers = (host: { getStatus(): { helpers?: number } }) => host.getStatus().helpers ?? 0;

describe('decentralized discovery + native peer relay on a real local DHT', () => {
  it('finds a helper without any configured endpoint and carries bootstrap and Yjs both ways, with only ciphertext at the helper', async () => {
    const net = await testnet();
    const helper = await startHelper(net);
    expect(helper.status()).toMatchObject({ running: true, announced: true });
    const { host, controller, invitation } = await startHost(net, { title: 'GEHEIMER-TITEL-XYZ' });
    await until(() => hostHelpers(host) >= 1);
    expect(invitation.relayUrl).toBe('');

    const { transport, side, won } = blockedGuest(net, invitation, host.getPin());
    const fetched = await bootstrapRoomDocument(transport, { documentId: 'doc-1', timeoutMs: 20_000 });
    expect(fetched.getSnapshot().document.title).toBe('GEHEIMER-TITEL-XYZ');
    bindCrdtTransport(fetched, transport);
    await until(() => transport.getStatus().state === 'ready');
    expect(transport.getStatus()).toMatchObject({ route: 'relay', grantedRole: 'editor' });
    expect(won).toEqual([helper.keyHex]);
    expect(side.connects).toContain(invitation.directKey);

    controller.dispatch({ type: 'rename', title: 'GEHEIMER-TITEL-ABC' }, { actorId: 'actor:h', expectedRevision: controller.getSnapshot().revision, source: 'human' });
    await until(() => fetched.getSnapshot().document.title === 'GEHEIMER-TITEL-ABC');
    fetched.dispatch({ type: 'rename', title: 'Vom Gast' }, { actorId: 'actor:g', expectedRevision: fetched.getSnapshot().revision, source: 'human' });
    await until(() => controller.getSnapshot().document.title === 'Vom Gast');

    // What the helper decrypts from the outer Noise layer is still end-to-end ciphertext: no title, no PIN.
    const seen = Buffer.concat([...side.wire.sent, ...side.wire.received].map(chunk => Buffer.from(chunk))).toString('latin1');
    expect(side.wire.sent.length).toBeGreaterThan(3);
    expect(seen).not.toContain('GEHEIMER');
    expect(seen).not.toContain(host.getPin());
    expect(helper.status().forwardedRecords).toBeGreaterThan(3);
  }, 90_000);

  it('keeps wrong PIN, expired link and viewer role enforced over a helper', async () => {
    const net = await testnet();
    await startHelper(net);
    const { host, controller, invitation } = await startHost(net, { role: 'viewer', expiresInMs: 6000 });
    await until(() => hostHelpers(host) >= 1);

    const wrong = blockedGuest(net, invitation, host.getPin() === '111111' ? '222222' : '111111');
    await until(() => wrong.transport.getStatus().state === 'error', 30_000);
    expect(wrong.transport.getStatus()).toMatchObject({ error: 'PIN_INVALID', attemptsLeft: 19 });
    expect(host.getStatus().peers).toHaveLength(0);

    const viewer = blockedGuest(net, invitation, host.getPin());
    const fetched = await bootstrapRoomDocument(viewer.transport, { documentId: 'doc-1', timeoutMs: 20_000 });
    bindCrdtTransport(fetched, viewer.transport);
    expect(viewer.transport.getStatus().grantedRole).toBe('viewer');
    await expect(viewer.transport.send('update', Uint8Array.of(1))).rejects.toThrow('ACCESS_DENIED');
    fetched.dispatch({ type: 'rename', title: 'Viewer-Edit' }, { actorId: 'actor:v', expectedRevision: fetched.getSnapshot().revision, source: 'human' });
    await wait(400);
    expect(controller.getSnapshot().document.title).toBe('Über Helfer');

    await wait(Math.max(0, invitation.expiresAt - Date.now() + 100));
    const forged = blockedGuest(net, { ...invitation, expiresAt: Date.now() + 60_000 }, host.getPin());
    await until(() => forged.transport.getStatus().state === 'error', 30_000);
    expect(forged.transport.getStatus().error).toBe('INVITATION_EXPIRED');
    expect(viewer.transport.getStatus().state).toBe('ready');
  }, 120_000);

  it('switches to the second helper when the first dies and converges the Yjs state', async () => {
    const net = await testnet();
    const helpers = [await startHelper(net), await startHelper(net)];
    const { host, controller, invitation } = await startHost(net);
    await until(() => hostHelpers(host) >= 2, 30_000);

    const { transport, won, side } = blockedGuest(net, invitation, host.getPin());
    const fetched = await bootstrapRoomDocument(transport, { documentId: 'doc-1', timeoutMs: 20_000 });
    bindCrdtTransport(fetched, transport);
    await until(() => transport.getStatus().state === 'ready');
    const first = helpers.find(helper => helper.keyHex === won[0])!;
    const second = helpers.find(helper => helper !== first)!;
    expect(first).toBeDefined();

    await first.stop();
    controller.dispatch({ type: 'rename', title: 'Während Ausfall' }, { actorId: 'actor:h', expectedRevision: controller.getSnapshot().revision, source: 'human' });
    await until(() => won.length >= 2, 40_000);
    expect(won[1]).toBe(second.keyHex);
    await until(() => fetched.getSnapshot().document.title === 'Während Ausfall', 30_000);
    fetched.dispatch({ type: 'rename', title: 'Nach Wechsel' }, { actorId: 'actor:g', expectedRevision: fetched.getSnapshot().revision, source: 'human' });
    await until(() => controller.getSnapshot().document.title === 'Nach Wechsel');
    expect(side.wire.sent.length).toBeGreaterThan(0);
  }, 150_000);

  it('ends with a bounded error when no helper exists, or only unreachable and invalid candidates', async () => {
    const net = await testnet();
    const { host, invitation } = await startHost(net);
    void host;
    const none = blockedGuest(net, invitation, '123456', { backoffMs: [20, 40], maxInitialAttempts: 2 });
    const started = Date.now();
    await until(() => none.transport.getStatus().state === 'error', 30_000);
    expect(['HOST_UNREACHABLE', 'CONNECT_FAILED']).toContain(none.transport.getStatus().error);
    expect(Date.now() - started).toBeLessThan(25_000);
    expect(none.won).toEqual([]);

    // A candidate that is advertised but not reachable (nobody listens under that key) is skipped within the bounds.
    const fakeKey = 'ab'.repeat(32);
    const side = nativeSide(net, { connectTimeoutMs: 1500 });
    side.blocked.add(invitation.directKey);
    const original = side.link.discover.bind(side.link);
    side.link.discover = async request => (request.kind === 'session' ? [fakeKey] : original(request));
    const invalid = createHdhtGuestTransport({
      invitation, pin: '123456', direct: side.link, timing, directTimeoutMs: 800, relayStartDelayMs: 50, backoffMs: [20, 40], maxInitialAttempts: 2, attemptTimeoutMs: 8000,
    });
    cleanups.push(() => invalid.close());
    await until(() => invalid.getStatus().state === 'error', 30_000);
    expect(invalid.getStatus().error).toBeDefined();
  }, 90_000);

  it('does nothing unless the helper is switched on, withdraws its advertisement on stop, and can be restarted', async () => {
    const net = await testnet();
    const probe = nativeSide(net);
    expect(await probe.service.lookup(serviceAdTopic(), 8, 2500)).toEqual([]);
    const helper = await startHelper(net);
    const key = helper.keyHex!;
    expect(await probe.service.lookup(serviceAdTopic(), 8, 4000)).toContain(key);
    await helper.stop();
    expect(helper.status()).toMatchObject({ running: false, announced: false, connections: 0 });
    expect(await probe.service.lookup(serviceAdTopic(), 8, 2500)).not.toContain(key);
    const again = await helper.start();
    expect(again).toMatchObject({ running: true, announced: true });
    expect(helper.keyHex).not.toBe(key);
  }, 60_000);

  it('cancelling a guest while it connects through a helper leaves no connection behind', async () => {
    const net = await testnet();
    const helper = await startHelper(net);
    const { host, invitation } = await startHost(net);
    await until(() => hostHelpers(host) >= 1);
    const { transport } = blockedGuest(net, invitation, host.getPin());
    await until(() => transport.getStatus().phase === 'authenticating' || transport.getStatus().state === 'ready');
    await transport.close();
    await until(() => host.getStatus().peers.length === 0 && helper.status().guests === 0, 8000);
  }, 60_000);
});
