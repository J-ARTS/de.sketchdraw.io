import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRelayHub, type HubHandler } from '../../../../relay/hub.mjs';
import { BadHelpers, connectViaHelpers, PeerRelayHosts } from '../../../../src/collaboration/hdht/peer-relay';
import { createHostKeys, hostKeyToText } from '../../../../src/collaboration/hdht/relay-channel';
import type { DirectLink } from '../../../../src/collaboration/hdht/direct-link';
import type { SecureChannel } from '../../../../src/collaboration/hdht/types';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); vi.useRealTimers(); });
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!check()) { if (Date.now() > deadline) throw new Error('timeout'); await wait(5); }
}

/** Real signed hub registration and inner encryption over a controlled, ordered native channel. */
function helper(key: string) {
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
