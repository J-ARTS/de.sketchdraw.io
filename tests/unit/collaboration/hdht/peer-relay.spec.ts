import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRelayHub, type HubHandler } from '../../../../relay/hub.mjs';
import { BadHelpers, connectViaHelpers, PeerRelayHosts } from '../../../../src/collaboration/hdht/peer-relay';
import { createHostKeys, hostKeyToText } from '../../../../src/collaboration/hdht/relay-channel';
import type { DirectLink } from '../../../../src/collaboration/hdht/direct-link';
import type { SecureChannel } from '../../../../src/collaboration/hdht/types';
import { createHdhtGuestTransport, createHdhtHostTransport } from '../../../../src/collaboration/hdht/session';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!check()) { if (Date.now() > deadline) throw new Error('timeout'); await wait(5); }
}

/** Real signed hub registration and inner encryption over a controlled, ordered native channel. */
function helper(key: string, options: { dropRecords?: (data: Uint8Array) => boolean } = {}) {
  const hub = createRelayHub();
  const sockets = new Set<SecureChannel>();
  cleanups.push(() => hub.dispose());
  function connect(): SecureChannel {
    let handlers: Parameters<SecureChannel['attach']>[0] | null = null;
    let open = true;
    let handler: HubHandler;
    const pending: Uint8Array[] = [];
    const deliver = (data: Uint8Array) => { if (!open) return; if (handlers) handlers.message(data); else pending.push(data); };
    const close = (reason = 'CLOSED') => {
      if (!open) return;
      open = false;
      sockets.delete(channel);
      handler.closed();
      handlers?.close(reason);
    };
    handler = hub.accept({
      isOpen: () => open, bufferedAmount: () => 0,
      send: (data, binary) => {
        const payload = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        // The signed handshake still passes; only subsequent opaque encrypted records disappear.
        if (binary && options.dropRecords?.(payload) && ![50, 66, 113, 129].includes(payload.length)) return;
        const frame = new Uint8Array(payload.length + 1); frame[0] = binary ? 1 : 0; frame.set(payload, 1);
        queueMicrotask(() => deliver(frame));
      },
      close: (_code, reason) => close(reason),
    })!;
    if (!handler) throw new Error('HELPER_OFFLINE');
    const channel: SecureChannel = {
      route: 'direct', binding: new Uint8Array(32),
      attach: value => { handlers = value; for (const data of pending.splice(0)) deliver(data); if (!open) value.close('CLOSED'); },
      send: async data => { if (!open) throw new Error('CLOSED'); handler.message(data.subarray(1), data[0] === 1); },
      close,
    };
    sockets.add(channel);
    return channel;
  }
  return { hub, key, connect, sockets };
}

function link(options: { discover: DirectLink['discover']; connect: DirectLink['connect'] }): DirectLink {
  return options as unknown as DirectLink;
}

async function manager(native: DirectLink, target = 2) {
  const hostKeys = await createHostKeys();
  const channels: SecureChannel[] = [];
  const hosts = new PeerRelayHosts({ link: native, sessionId: 'a'.repeat(64), hostKeys, target, retryMs: 10, steadyMs: 10, onChannel: channel => channels.push(channel) });
  cleanups.push(() => hosts.stop());
  return { hosts, hostKeys, channels };
}

describe('bounded volunteer helper selection and ownership (R27)', () => {
  it('retries a lone helper after temporary silence and does not quarantine an authenticated busy bye', async () => {
    let discard = false;
    const only = helper('d'.repeat(64), { dropRecords: () => discard });
    const native = link({ discover: async () => [only.key], connect: async () => only.connect() });
    const hostKeys = await createHostKeys();
    const timing = { heartbeatMs: 30, timeoutMs: 200, byeDeadlineMs: 10 };
    const host = createHdhtHostTransport({
      sessionId: 'a'.repeat(64), documentId: 'doc-1', hostKeys, expiresAt: Date.now() + 60_000,
      grantedRole: () => 'editor', timing: { ...timing, timeoutMs: 1000 }, peers: { link: native, retryMs: 10, steadyMs: 10 },
    });
    cleanups.push(() => { void host.close(); });
    await until(() => host.getStatus().helpers === 1);
    const won: string[] = [], failed: string[] = [];
    const guest = createHdhtGuestTransport({
      invitation: { version: 1, sessionId: 'a'.repeat(64), hostKey: hostKeyToText(hostKeys), directKey: '', relayUrl: '', documentId: 'doc-1', expiresAt: Date.now() + 60_000 },
      pin: host.getPin(), timing, backoffMs: [5], direct: native,
      onCandidate: (key, outcome) => {
        if (outcome === 'won') won.push(key);
        if (outcome === 'failed') { failed.push(key); discard = false; }
      },
    });
    cleanups.push(() => { void guest.close(); });
    await until(() => guest.getStatus().state === 'ready');
    discard = true;
    await until(() => guest.getStatus().state === 'ready' && won.length === 2);
    expect(failed).toEqual([only.key]);
    host.retryPeer(host.getStatus().peers[0]!.peerId);
    await until(() => guest.getStatus().state === 'ready' && won.length === 3);
    expect(failed).toEqual([only.key]);
    expect(host.pinRemainingFailures).toBe(20);
  });

  it('rechecks the discovery floor after two staggered active-helper loss wakeups', async () => {
    const first = helper('e'.repeat(64)), second = helper('f'.repeat(64));
    const at: number[] = [];
    const keys = await createHostKeys();
    const hosts = new PeerRelayHosts({
      link: link({ discover: async () => { at.push(Date.now()); return [first.key, second.key]; },
        connect: async key => (key === first.key ? first : second).connect() }),
      sessionId: 'a'.repeat(64), hostKeys: keys, retryMs: 100, steadyMs: 10_000, onChannel: () => {},
    });
    cleanups.push(() => hosts.stop());
    hosts.start(); await until(() => hosts.activeHelpers === 2);
    vi.useFakeTimers(); vi.setSystemTime(at[0]! + 1);
    for (const socket of first.sockets) socket.close('LOST');
    await vi.advanceTimersByTimeAsync(1);
    for (const socket of second.sockets) socket.close('LOST');
    await vi.advanceTimersByTimeAsync(77);
    expect(at).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(at).toHaveLength(2);
    expect(at[1]! - at[0]!).toBe(80);
    hosts.stop(); expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['authentication', 'connected'] as const)('quarantines a silent helper during %s and recovers through another', async phase => {
    let discard = phase === 'authentication';
    const silent = helper('b'.repeat(64), { dropRecords: () => discard });
    const working = helper('c'.repeat(64));
    const hostKeys = await createHostKeys();
    const timing = { heartbeatMs: 40, timeoutMs: 500, byeDeadlineMs: 10 };
    const host = createHdhtHostTransport({
      sessionId: 'a'.repeat(64), documentId: 'doc-1', hostKeys, expiresAt: Date.now() + 60_000,
      grantedRole: () => 'editor', timing: { ...timing, timeoutMs: 2000 }, authTimeoutMs: 2000,
      peers: { link: link({ discover: async () => [silent.key, working.key], connect: async key => (key === silent.key ? silent : working).connect() }), retryMs: 10, steadyMs: 10 },
    });
    cleanups.push(() => { void host.close(); });
    await until(() => host.getStatus().helpers === 2);
    const failed: string[] = [], won: string[] = [];
    const statuses: { state: string; error?: string }[] = [];
    const guest = createHdhtGuestTransport({
      invitation: { version: 1, sessionId: 'a'.repeat(64), hostKey: hostKeyToText(hostKeys), directKey: '', relayUrl: '', documentId: 'doc-1', expiresAt: Date.now() + 60_000 },
      pin: host.getPin(), timing, authTimeoutMs: 1000, backoffMs: [5], maxInitialAttempts: 3,
      direct: link({ discover: async () => won.length ? [silent.key, working.key] : [silent.key], connect: async key => (key === silent.key ? silent : working).connect() }),
      onCandidate: (key, outcome) => { if (outcome === 'won') won.push(key); if (outcome === 'failed') failed.push(key); },
    });
    cleanups.push(() => { void guest.close(); });
    guest.subscribeStatus(status => statuses.push(status));
    if (phase === 'connected') {
      await until(() => guest.getStatus().state === 'ready');
      expect(won).toEqual([silent.key]);
      discard = true;
    }
    await until(() => guest.getStatus().state === 'ready' && won.length === 2);
    expect(won).toEqual([silent.key, working.key]);
    expect(failed).toEqual([silent.key]);
    expect(statuses.some(status => status.state === 'reconnecting' && status.error === 'HELPER_FORWARDING_FAILED')).toBe(true);
    expect(host.pinRemainingFailures).toBe(20);
    discard = false;
    const received: Uint8Array[] = [];
    host.subscribeMessage(message => { received.push(message.data); });
    await guest.send('update', Uint8Array.of(3, 1, 4));
    await until(() => received.length === 1);
    expect(received).toEqual([Uint8Array.of(3, 1, 4)]);
  });

  it('backs off empty discovery with bounded jitter, and resets on restart without leaving timers', async () => {
    const hostKeys = await createHostKeys();
    vi.useFakeTimers();
    const discover = vi.fn(async () => []);
    const hosts = new PeerRelayHosts({
      link: link({ discover, connect: vi.fn() }), sessionId: 'a'.repeat(64), hostKeys,
      retryMs: 100, maxRetryMs: 400, random: () => 0.5, onChannel: () => {},
    });
    cleanups.push(() => hosts.stop());
    hosts.start(); await vi.advanceTimersByTimeAsync(0);
    expect(discover).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(89); expect(discover).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(discover).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(180); expect(discover).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(360); expect(discover).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(360); expect(discover).toHaveBeenCalledTimes(5);
    hosts.stop(); expect(vi.getTimerCount()).toBe(0);
    hosts.start(); await vi.advanceTimersByTimeAsync(0);
    expect(discover).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(90); expect(discover).toHaveBeenCalledTimes(7);
    hosts.stop(); expect(vi.getTimerCount()).toBe(0);
  });

  it('does not reset discovery backoff for rotating unusable helper advertisements', async () => {
    const hostKeys = await createHostKeys();
    vi.useFakeTimers();
    vi.spyOn(crypto.subtle, 'digest').mockResolvedValue(new ArrayBuffer(32));
    const at: number[] = [];
    const hosts = new PeerRelayHosts({
      link: link({ discover: async () => { at.push(Date.now()); return [at.length.toString(16).padStart(64, '0')]; }, connect: async () => { throw new Error('OFFLINE'); } }),
      sessionId: 'a'.repeat(64), hostKeys, retryMs: 100, maxRetryMs: 400, random: () => 0.5, onChannel: () => {},
    });
    cleanups.push(() => hosts.stop());
    hosts.start(); await vi.advanceTimersByTimeAsync(990);
    expect(at.map(value => value - at[0]!)).toEqual([0, 90, 270, 630, 990]);
    hosts.stop(); expect(vi.getTimerCount()).toBe(0);
  });

  it('stops a pending host registration and prevents a late ghost in the actual hub', async () => {
    const remote = helper('b'.repeat(64));
    const nativeChannel = remote.connect();
    let finish!: (channel: SecureChannel) => void;
    let signal!: AbortSignal;
    const native = link({ discover: async () => [remote.key], connect: (_key, abort) => { signal = abort!; return new Promise(resolve => { finish = resolve; }); } });
    const { hosts } = await manager(native);
    hosts.start(); await until(() => !!finish);
    hosts.stop();
    expect(signal.aborted).toBe(true);
    finish(nativeChannel);
    await until(() => remote.hub.stats().connections === 0);
    expect(hosts.activeHelpers).toBe(0);
    expect(remote.hub.stats()).toMatchObject({ topics: 0, guests: 0 });
  });

  it('finds a new candidate after empty rounds and retries a failed helper immediately on explicit restart', async () => {
    const remote = helper('b'.repeat(64));
    let discoveries = 0, connections = 0, available = false;
    const native = link({
      discover: async () => ++discoveries <= 2 ? [] : [remote.key],
      connect: async () => { connections++; if (!available) throw new Error('OFFLINE'); return remote.connect(); },
    });
    const { hosts } = await manager(native, 1);
    hosts.start(); await until(() => connections === 1);
    expect(discoveries).toBeGreaterThanOrEqual(3);
    expect(hosts.activeHelpers).toBe(0);
    hosts.stop(); available = true; hosts.start();
    await until(() => hosts.activeHelpers === 1);
    expect(connections).toBe(2);
  });

  it('ignores discovery from a stopped generation after an immediate restart', async () => {
    const stale = helper('b'.repeat(64));
    const current = helper('c'.repeat(64));
    let finish!: (keys: string[]) => void;
    let calls = 0;
    const connected: string[] = [];
    const native = link({
      discover: () => ++calls === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve([current.key]),
      connect: async key => { connected.push(key); return (key === current.key ? current : stale).connect(); },
    });
    const { hosts } = await manager(native, 1);
    hosts.start(); await until(() => !!finish);
    hosts.stop(); hosts.start();
    await until(() => hosts.activeHelpers === 1);
    finish([stale.key]); await wait(30);
    expect(connected).toEqual([current.key]);
    expect(stale.hub.stats().topics).toBe(0);
    expect(current.hub.stats().topics).toBe(1);
  });

  it('aborts pending work of the old generation without cancelling a fresh registration to the same helper', async () => {
    const remote = helper('b'.repeat(64));
    const oldChannel = remote.connect();
    let finish!: (channel: SecureChannel) => void;
    let calls = 0;
    const native = link({
      discover: async () => [remote.key],
      connect: async () => ++calls === 1 ? new Promise<SecureChannel>(resolve => { finish = resolve; }) : remote.connect(),
    });
    const { hosts } = await manager(native, 1);
    hosts.start(); await until(() => !!finish);
    hosts.stop(); hosts.start();
    await until(() => hosts.activeHelpers === 1);
    finish(oldChannel); await until(() => remote.hub.stats().connections === 1);
    expect(hosts.activeHelpers).toBe(1);
    expect(remote.hub.stats().topics).toBe(1);
  });

  it('deduplicates candidates, skips failed helpers and replaces a lost registration with another helper', async () => {
    const bad = 'e'.repeat(64);
    const helpers = [helper('b'.repeat(64)), helper('c'.repeat(64)), helper('d'.repeat(64))];
    const connected: string[] = [];
    const native = link({
      discover: async () => [bad, bad, ...helpers.flatMap(value => [value.key, value.key])],
      connect: async key => { connected.push(key); if (key === bad) throw new Error('OFFLINE'); return helpers.find(value => value.key === key)!.connect(); },
    });
    const { hosts } = await manager(native);
    hosts.start(); await until(() => hosts.activeHelpers === 2);
    expect(connected.filter(key => key === bad)).toHaveLength(1);
    expect(helpers[0]!.hub.stats().topics).toBe(1);
    expect(helpers[1]!.hub.stats().topics).toBe(1);
    expect(helpers[2]!.hub.stats().topics).toBe(0);
    helpers[0]!.hub.dispose();
    await until(() => hosts.activeHelpers === 2 && helpers[2]!.hub.stats().topics === 1);
    expect(connected.filter(key => key === helpers[0]!.key)).toHaveLength(1);
    expect(connected.filter(key => key === bad)).toHaveLength(1);
  });

  it('reaches a valid guest helper despite repeated failed advertisements and performs the pinned handshake', async () => {
    const remote = helper('b'.repeat(64));
    const host = await manager(link({ discover: async () => [remote.key], connect: async () => remote.connect() }), 1);
    host.hosts.start(); await until(() => host.hosts.activeHelpers === 1);
    const bad = 'e'.repeat(64);
    const attempts: string[] = [];
    const guest = await connectViaHelpers({
      link: link({ discover: async () => [bad, bad, bad, bad, remote.key], connect: async key => { attempts.push(key); if (key === bad) throw new Error('OFFLINE'); return remote.connect(); } }),
      sessionId: 'a'.repeat(64), hostKey: hostKeyToText(host.hostKeys), signal: new AbortController().signal, bad: new BadHelpers(),
    });
    cleanups.push(() => guest.close());
    await until(() => host.channels.length === 1);
    const received: Uint8Array[] = [];
    host.channels[0]!.attach({ message: data => received.push(data), close: () => {} });
    await guest.send(Uint8Array.of(3, 1, 4));
    await until(() => received.length === 1);
    expect(received).toEqual([Uint8Array.of(3, 1, 4)]);
    expect(attempts.sort()).toEqual([bad, remote.key].sort());
  });

  it('settles cancellation during a stalled discovery and ignores its later result', async () => {
    const abort = new AbortController();
    let finish!: (keys: string[]) => void;
    const connect = vi.fn<DirectLink['connect']>();
    const hostKeys = await createHostKeys();
    const pending = connectViaHelpers({
      link: link({ discover: () => new Promise(resolve => { finish = resolve; }), connect }),
      sessionId: 'a'.repeat(64), hostKey: hostKeyToText(hostKeys), signal: abort.signal, bad: new BadHelpers(),
    });
    const result = expect(pending).rejects.toThrow('ABORTED');
    await until(() => !!finish); abort.abort(); await result;
    finish(['b'.repeat(64)]); await wait(10);
    expect(connect).not.toHaveBeenCalled();
  });

  it('keeps the failed-helper cache bounded while allowing expired peers again', () => {
    let now = 0;
    const bad = new BadHelpers(10, () => now);
    for (let i = 0; i < 100; i++) bad.mark(String(i));
    expect(bad.has('0')).toBe(false);
    expect(bad.has('35')).toBe(false);
    expect(bad.has('36')).toBe(true);
    expect(bad.has('99')).toBe(true);
    now = 11;
    expect(bad.has('99')).toBe(false);
  });
});
