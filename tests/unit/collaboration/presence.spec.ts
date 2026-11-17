import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanParticipantName, createGuestPresence, createHostPresence, participantInitials, PRESENCE_COLOR_COUNT, PRESENCE_RECONNECT_WINDOW_MS,
  type GuestPresence, type HostPresence, type PresenceSnapshot,
} from '@/collaboration/presence';
import type { AutomaticPeer, CollaborationTransport, CollaborationTransportMessage, CollaborationTransportStatus } from '@/collaboration/transport';

const encoder = new TextEncoder(), decoder = new TextDecoder();
const json = (value: unknown) => encoder.encode(JSON.stringify(value));

/** A host and its guests in memory: the same star the real transports form, without a network. */
function createHub() {
  const hostStatus = new Set<(status: CollaborationTransportStatus) => void>();
  const hostMessages = new Set<(message: CollaborationTransportMessage) => void | Promise<void>>();
  const links = new Map<string, Link>();
  const kicked: string[] = [];
  const hostSent: { data: unknown; targets: readonly string[] }[] = [];
  let counter = 0;
  const peer = (peerId: string, role: AutomaticPeer['role']): AutomaticPeer => ({ peerId, keyHash: peerId.padEnd(64, '0'), publicKeyBase64Url: '', invitationId: 'i', role, grantId: `g:${peerId}`, grantGeneration: 0 });
  const status = (): CollaborationTransportStatus => ({ mode: 'hyperdht-relay', state: 'ready', peers: Array.from(links.values(), link => link.peer), relayUrls: [], iceServers: [] });
  const publish = () => { const value = status(); for (const listener of Array.from(hostStatus)) listener(value); };

  interface Link { peer: AutomaticPeer; state: CollaborationTransportStatus['state']; status: Set<(status: CollaborationTransportStatus) => void>; messages: Set<(message: CollaborationTransportMessage) => void | Promise<void>>; received: unknown[] }

  const host: CollaborationTransport & { kick(peerId: string): void } = {
    mode: 'hyperdht-relay',
    getStatus: status,
    subscribeStatus(listener) { hostStatus.add(listener); return () => hostStatus.delete(listener); },
    subscribeMessage(listener) { hostMessages.add(listener); return () => hostMessages.delete(listener); },
    async send(channel, data, targets) {
      const ids = targets ?? Array.from(links.keys());
      if (!ids.length || ids.some(id => !links.has(id))) throw new Error('PEER_NOT_AUTHORIZED');
      hostSent.push({ data: JSON.parse(decoder.decode(data)), targets: ids });
      for (const id of ids) {
        const link = links.get(id)!;
        link.received.push(JSON.parse(decoder.decode(data)));
        for (const listener of Array.from(link.messages)) void listener({ channel, data, peer: peer('host', 'owner') });
      }
    },
    kick(peerId) { kicked.push(peerId); const link = links.get(peerId); if (link) { links.delete(peerId); link.state = 'error'; for (const listener of Array.from(link.status)) listener(guestStatus(link)); publish(); } },
    async close() {},
  };
  const guestStatus = (link: Link): CollaborationTransportStatus => ({ mode: 'hyperdht-relay', state: link.state, peers: link.state === 'ready' ? [peer('host', 'owner')] : [], relayUrls: [], iceServers: [] });

  /** One guest device; `connect` gives it a fresh connection the way a reconnect does. */
  function guest(role: 'editor' | 'viewer' = 'editor') {
    let link: Link = { peer: peer('none', role), state: 'connecting', status: new Set(), messages: new Set(), received: [] };
    const transport: CollaborationTransport = {
      mode: 'hyperdht-relay',
      getStatus: () => guestStatus(link),
      subscribeStatus(listener) { link.status.add(listener); return () => link.status.delete(listener); },
      subscribeMessage(listener) { link.messages.add(listener); return () => link.messages.delete(listener); },
      async send(channel, data) {
        if (link.state !== 'ready' || !links.has(link.peer.peerId)) throw new Error('NOT_CONNECTED');
        for (const listener of Array.from(hostMessages)) void listener({ channel, data, peer: link.peer });
      },
      async close() {},
    };
    const set = (state: Link['state']) => { link.state = state; for (const listener of Array.from(link.status)) listener(guestStatus(link)); };
    return {
      transport,
      get peerId() { return link.peer.peerId; },
      get received() { return link.received; },
      connect() { link.peer = peer(`p${++counter}`, role); links.set(link.peer.peerId, link); publish(); set('ready'); },
      /** The connection breaks; with `silent` the host has not noticed yet (it waits for the heartbeat). */
      drop(silent = false) { const id = link.peer.peerId; set('reconnecting'); if (!silent) { links.delete(id); publish(); } return id; },
      end(state: 'error' | 'closed' = 'error') { links.delete(link.peer.peerId); publish(); set(state); },
      raw(value: unknown) { for (const listener of Array.from(hostMessages)) void listener({ channel: 'awareness', data: value instanceof Uint8Array ? value : json(value), peer: link.peer }); },
    };
  }
  return { host, guest, kicked, hostSent, hostGone(peerId: string) { links.delete(peerId); publish(); }, fromHost(target: ReturnType<typeof guest>, value: unknown) { void host.send('awareness', value instanceof Uint8Array ? value : json(value), [target.peerId]); } };
}

let hub: ReturnType<typeof createHub>;
let hostView: PresenceSnapshot;
let hostPresence: HostPresence;
const closers: (() => void)[] = [];

function join(name: string, role: 'editor' | 'viewer' = 'editor') {
  const device = hub.guest(role);
  let view: PresenceSnapshot = { participants: [], cursors: [], views: [] };
  const presence: GuestPresence = createGuestPresence(device.transport, { name, onChange: value => { view = value; } });
  closers.push(() => presence.close());
  device.connect();
  return { device, presence, view: () => view };
}
const names = (view: PresenceSnapshot) => view.participants.map(value => `${value.name || `#${value.number}`}:${value.state}`);

beforeEach(() => {
  vi.useFakeTimers();
  hub = createHub();
  hostView = { participants: [], cursors: [], views: [] };
  hostPresence = createHostPresence(hub.host, { name: 'Jeremy', onChange: value => { hostView = value; } });
  hostView = hostPresence.snapshot();
  closers.push(() => hostPresence.close());
});
afterEach(() => { for (const close of closers.splice(0)) close(); vi.useRealTimers(); });

describe('names and initials', () => {
  it('builds one or two letters from a name', async () => {
    expect(participantInitials('Jeremy Teichmann')).toBe('JT');
    expect(participantInitials('jeremy')).toBe('JE');
    expect(participantInitials('Ünal özgür')).toBe('ÜÖ');
    expect(participantInitials('Gast 3')).toBe('G3');
    expect(participantInitials('  (anna)  ')).toBe('AN');
    expect(participantInitials('李 雷')).toBe('李雷');
    expect(participantInitials('')).toBe('?');
  });

  it('removes control and direction characters and bounds the length', async () => {
    expect(cleanParticipantName('  Anna\n\tLena  ')).toBe('Anna Lena');
    expect(cleanParticipantName('Eve\u202Enimda')).toBe('Eve nimda');
    expect(cleanParticipantName('x'.repeat(200))).toHaveLength(40);
    expect(cleanParticipantName(42)).toBe('');
  });
});

describe('participant list', () => {
  it('lists the host alone before anyone joined', async () => {
    expect(hostView.participants).toEqual([expect.objectContaining({ name: 'Jeremy', role: 'owner', color: 0, state: 'online', self: true, number: 0 })]);
  });

  it('lists a guest for the host and for every guest, each marked as itself', async () => {
    const anna = join('Anna Lena'), ben = join('Ben', 'viewer');
    expect(names(hostView)).toEqual(['Jeremy:online', 'Anna Lena:online', 'Ben:online']);
    expect(hostView.participants.map(value => value.role)).toEqual(['owner', 'editor', 'viewer']);
    expect(names(anna.view())).toEqual(names(hostView));
    expect(anna.view().participants.filter(value => value.self).map(value => value.name)).toEqual(['Anna Lena']);
    expect(ben.view().participants.filter(value => value.self).map(value => value.name)).toEqual(['Ben']);
    expect(new Set(hostView.participants.map(value => value.color)).size).toBe(3);
  });

  it('gives a guest without a name a running number', async () => {
    join(''); join('');
    expect(hostView.participants.map(value => [value.name, value.number])).toEqual([['Jeremy', 0], ['', 1], ['', 2]]);
  });

  it('lists a guest that never introduces itself after a short wait', async () => {
    const device = hub.guest();
    device.connect();
    expect(hostView.participants).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1600);
    expect(hostView.participants.map(value => value.number)).toEqual([0, 1]);
  });

  it('reuses colours only when all are taken', async () => {
    for (let index = 0; index < PRESENCE_COLOR_COUNT; index++) join(`G${index}`);
    const counts = new Map<number, number>();
    for (const value of hostView.participants) counts.set(value.color, (counts.get(value.color) ?? 0) + 1);
    expect(counts.size).toBe(PRESENCE_COLOR_COUNT);
    expect(Math.max(...counts.values())).toBe(2);
  });

  it('renames a participant for everyone', async () => {
    const anna = join('Anna'), ben = join('Ben');
    anna.presence.setName('Anna B.');
    expect(names(ben.view())).toContain('Anna B.:online');
    hostPresence.setName('Jeremy T.');
    expect(names(anna.view())[0]).toBe('Jeremy T.:online');
  });
});

describe('pointers', () => {
  it('shows the pointer of a guest to the host and to the other guests, not to the guest itself', async () => {
    const anna = join('Anna'), ben = join('Ben', 'viewer');
    anna.presence.setCursor({ pageId: 'page-1', x: 120.26, y: 80 });
    await vi.advanceTimersByTimeAsync(200);
    const id = hostView.participants.find(value => value.name === 'Anna')!.id;
    expect(hostView.cursors).toEqual([{ id, pageId: 'page-1', x: 120.3, y: 80 }]);
    expect(ben.view().cursors).toEqual([{ id, pageId: 'page-1', x: 120.3, y: 80 }]);
    expect(anna.view().cursors).toEqual([]);
  });

  it('shows the pointer of the host and of a viewer to the others', async () => {
    const anna = join('Anna'), ben = join('Ben', 'viewer');
    hostPresence.setCursor({ pageId: 'p', x: 1, y: 2 });
    ben.presence.setCursor({ pageId: 'p', x: 3, y: 4 });
    await vi.advanceTimersByTimeAsync(300);
    expect(anna.view().cursors.map(value => [value.x, value.y]).sort()).toEqual([[1, 2], [3, 4]]);
    expect(hostView.cursors.map(value => [value.x, value.y])).toEqual([[3, 4]]);
  });

  it('removes a pointer when the mouse leaves the canvas', async () => {
    const anna = join('Anna'), ben = join('Ben');
    anna.presence.setCursor({ pageId: 'p', x: 1, y: 2 });
    await vi.advanceTimersByTimeAsync(200);
    expect(ben.view().cursors).toHaveLength(1);
    anna.presence.setCursor(null);
    await vi.advanceTimersByTimeAsync(300);
    expect(ben.view().cursors).toEqual([]);
    expect(hostView.cursors).toEqual([]);
  });

  it('sends at most one position per interval, the latest one', async () => {
    const anna = join('Anna'); join('Ben');
    hub.hostSent.length = 0;
    for (let step = 0; step < 50; step++) anna.presence.setCursor({ pageId: 'p', x: step, y: 0 });
    await vi.advanceTimersByTimeAsync(400);
    const batches = hub.hostSent.filter(entry => (entry.data as { t: string }).t === 'cursors');
    expect(batches.length).toBeLessThanOrEqual(2);
    expect(hostView.cursors[0]).toMatchObject({ x: 49 });
  });

  it('tells a late joiner where the others already are', async () => {
    const anna = join('Anna');
    anna.presence.setCursor({ pageId: 'p', x: 5, y: 6 });
    hostPresence.setCursor({ pageId: 'p', x: 7, y: 8 });
    await vi.advanceTimersByTimeAsync(300);
    const ben = join('Ben');
    expect(ben.view().cursors.map(value => [value.x, value.y]).sort()).toEqual([[5, 6], [7, 8]]);
  });
});

describe('views', () => {
  const rect = { pageId: 'p', x: 100.04, y: 50, width: 640, height: 400 };

  it('shows what a guest looks at to the host and the other guests, not to the guest itself', async () => {
    const anna = join('Anna'), ben = join('Ben', 'viewer');
    anna.presence.setView(rect);
    await vi.advanceTimersByTimeAsync(300);
    const id = hostView.participants.find(value => value.name === 'Anna')!.id;
    expect(hostView.views).toEqual([{ id, pageId: 'p', x: 100, y: 50, width: 640, height: 400 }]);
    expect(ben.view().views).toEqual(hostView.views);
    expect(anna.view().views).toEqual([]);
  });

  it('shows what the host and a viewer look at', async () => {
    const anna = join('Anna'), ben = join('Ben', 'viewer');
    hostPresence.setView({ ...rect, x: 1 });
    ben.presence.setView({ ...rect, x: 2 });
    await vi.advanceTimersByTimeAsync(300);
    expect(anna.view().views.map(value => value.x).sort()).toEqual([1, 2]);
    expect(hostView.views.map(value => value.x)).toEqual([2]);
  });

  it('withdraws a view, as a participant does that follows someone', async () => {
    const anna = join('Anna'), ben = join('Ben');
    anna.presence.setView(rect);
    await vi.advanceTimersByTimeAsync(300);
    expect(ben.view().views).toHaveLength(1);
    anna.presence.setView(null);
    await vi.advanceTimersByTimeAsync(300);
    expect(ben.view().views).toEqual([]);
    expect(hostView.views).toEqual([]);
  });

  it('sends the latest view only and tells a late joiner what the others look at', async () => {
    const anna = join('Anna');
    hub.hostSent.length = 0;
    for (let step = 0; step < 40; step++) anna.presence.setView({ ...rect, x: step });
    hostPresence.setView({ ...rect, x: -5 });
    await vi.advanceTimersByTimeAsync(400);
    expect(hostView.views[0]).toMatchObject({ x: 39 });
    const ben = join('Ben');
    expect(ben.view().views.map(value => value.x).sort((a, b) => a - b)).toEqual([-5, 39]);
  });

  it('forgets the view of a participant whose connection drops or who is removed', async () => {
    const anna = join('Anna'), ben = join('Ben');
    anna.presence.setView(rect);
    await vi.advanceTimersByTimeAsync(300);
    anna.device.drop();
    await vi.advanceTimersByTimeAsync(300);
    expect(hostView.views).toEqual([]);
    expect(ben.view().views).toEqual([]);
    anna.device.connect();
    await vi.advanceTimersByTimeAsync(300);
    expect(ben.view().views).toHaveLength(1);
    hostPresence.remove(hostView.participants.find(value => value.name === 'Anna')!.id);
    expect(ben.view().views).toEqual([]);
  });

  it('ignores a view that is not a usable rectangle', async () => {
    const anna = join('Anna');
    for (const value of [
      { t: 'view', p: 'p', x: 0, y: 0, w: 0, h: 10 }, { t: 'view', p: 'p', x: 0, y: 0, w: 10, h: -1 }, { t: 'view', p: 'p', x: 0, y: 0, w: 'wide', h: 1 },
      { t: 'view', p: '', x: 0, y: 0, w: 1, h: 1 }, { t: 'view', p: 'p', x: 0, y: 0, w: 1 }, { t: 'view', p: 'p', x: 0, y: 0, w: 1, h: 1, id: 'other' },
    ]) anna.device.raw(value);
    expect(hostView.views).toEqual([]);
    anna.device.raw({ t: 'view', p: 'p', x: 1e300, y: 0, w: 1e300, h: 5 });
    expect(hostView.views[0]).toMatchObject({ x: 10_000_000, width: 10_000_000, height: 5 });
    for (const value of [{ t: 'views', v: 'x' }, { t: 'views', v: [{ id: 'zz', p: 'p', x: 1, y: 1, w: 1, h: 1 }] }, { t: 'views', v: [{ id: 'a'.repeat(12), p: 'p', x: 1, y: 1, w: 0, h: 1 }] }]) hub.fromHost(anna.device, value);
    expect(anna.view().views).toEqual([]);
  });
});

describe('interruptions', () => {
  it('keeps a dropped guest listed as interrupted and removes it after five minutes', async () => {
    const anna = join('Anna'), ben = join('Ben');
    anna.presence.setCursor({ pageId: 'p', x: 1, y: 1 });
    await vi.advanceTimersByTimeAsync(200);
    anna.device.drop();
    expect(names(hostView)).toEqual(['Jeremy:online', 'Anna:reconnecting', 'Ben:online']);
    expect(names(ben.view())).toEqual(names(hostView));
    await vi.advanceTimersByTimeAsync(200);
    expect(hostView.cursors).toEqual([]);
    expect(ben.view().cursors).toEqual([]);
    await vi.advanceTimersByTimeAsync(PRESENCE_RECONNECT_WINDOW_MS - 1000);
    expect(names(hostView)).toContain('Anna:reconnecting');
    await vi.advanceTimersByTimeAsync(1500);
    expect(names(hostView)).toEqual(['Jeremy:online', 'Ben:online']);
    expect(names(ben.view())).toEqual(['Jeremy:online', 'Ben:online']);
  });

  it('recognises a guest that comes back and keeps its entry, colour and number', async () => {
    const anna = join('Anna'); join('Ben');
    const before = hostView.participants.find(value => value.name === 'Anna')!;
    anna.device.drop();
    await vi.advanceTimersByTimeAsync(60_000);
    anna.device.connect();
    expect(names(hostView)).toEqual(['Jeremy:online', 'Anna:online', 'Ben:online']);
    expect(hostView.participants.find(value => value.name === 'Anna')).toEqual(before);
    await vi.advanceTimersByTimeAsync(PRESENCE_RECONNECT_WINDOW_MS);
    expect(names(hostView)).toContain('Anna:online');
  });

  it('replaces a connection the host has not seen fail yet instead of listing the guest twice', async () => {
    const anna = join('Anna');
    const stale = anna.device.drop(true);
    anna.device.connect();
    await vi.advanceTimersByTimeAsync(2000);
    expect(names(hostView)).toEqual(['Jeremy:online', 'Anna:online']);
    hub.hostGone(stale);
    await vi.advanceTimersByTimeAsync(2000);
    expect(names(hostView)).toEqual(['Jeremy:online', 'Anna:online']);
  });

  it('removes a guest that leaves on purpose at once', async () => {
    const anna = join('Anna');
    const leaving = anna.presence.leave();
    await vi.advanceTimersByTimeAsync(10);
    await leaving;
    expect(names(hostView)).toEqual(['Jeremy:online']);
    anna.device.end('closed');
    await vi.advanceTimersByTimeAsync(5000);
    expect(names(hostView)).toEqual(['Jeremy:online']);
  });

  it('hides the pointers of others while the own connection is interrupted and forgets the list when it ends', async () => {
    const anna = join('Anna'), ben = join('Ben');
    anna.presence.setCursor({ pageId: 'p', x: 1, y: 1 });
    await vi.advanceTimersByTimeAsync(200);
    ben.device.drop();
    expect(ben.view().cursors).toEqual([]);
    expect(ben.view().participants).toHaveLength(3);
    ben.device.end('error');
    expect(ben.view().participants).toEqual([]);
  });
});

describe('removing a participant', () => {
  it('ends the connection, takes the entry off every list and does not list the peer again', async () => {
    const anna = join('Anna'), ben = join('Ben');
    const peerId = anna.device.peerId;
    const id = hostView.participants.find(value => value.name === 'Anna')!.id;
    expect(hostPresence.remove(id)).toBe(true);
    expect(hub.kicked).toEqual([peerId]);
    expect(names(hostView)).toEqual(['Jeremy:online', 'Ben:online']);
    expect(names(ben.view())).toEqual(['Jeremy:online', 'Ben:online']);
    await vi.advanceTimersByTimeAsync(PRESENCE_RECONNECT_WINDOW_MS + 5000);
    expect(names(hostView)).toEqual(['Jeremy:online', 'Ben:online']);
  });

  it('removes an interrupted participant without a connection', async () => {
    const anna = join('Anna');
    anna.device.drop();
    const id = hostView.participants.find(value => value.name === 'Anna')!.id;
    expect(hostPresence.remove(id)).toBe(true);
    expect(hub.kicked).toEqual([]);
    expect(names(hostView)).toEqual(['Jeremy:online']);
  });

  it('does not remove the host or an unknown entry', async () => {
    expect(hostPresence.remove(hostView.participants[0]!.id)).toBe(false);
    expect(hostPresence.remove('0123456789ab')).toBe(false);
  });

  it('drops a peer the host disconnects for another reason', async () => {
    const anna = join('Anna');
    hostPresence.forgetPeer(anna.device.peerId);
    expect(names(hostView)).toEqual(['Jeremy:online']);
    await vi.advanceTimersByTimeAsync(3000);
    expect(names(hostView)).toEqual(['Jeremy:online']);
  });
});

describe('untrusted input', () => {
  it('ignores malformed, oversized and unknown messages from a guest without ending anything', async () => {
    const anna = join('Anna');
    const before = hostPresence.snapshot();
    for (const value of [
      new Uint8Array([0xff, 0xfe, 0xfd]), json([]), json('x'), json({ t: 'hello' }), json({ t: 'hello', key: 'short', name: 'x' }),
      json({ t: 'hello', key: 'a'.repeat(32), name: 'x', extra: 1 }), json({ t: 'cursor', p: 'p', x: 'NaN', y: 1 }), json({ t: 'cursor', p: '', x: 1, y: 1 }),
      json({ t: 'cursor', p: 'p'.repeat(200), x: 1, y: 1 }), json({ t: 'roster', you: 'x', members: [] }), json({ t: 'cursor', p: 'p', x: 1, y: 1, id: 'other' }),
      json({ t: 'hello', key: 'b'.repeat(32), name: 'y'.repeat(600) }),
    ]) anna.device.raw(value);
    expect(hostPresence.snapshot()).toEqual(before);
    expect(hub.kicked).toEqual([]);
  });

  it('does not let a guest change its key to take over another entry', async () => {
    const anna = join('Anna'), ben = join('Ben');
    anna.device.raw({ t: 'hello', key: 'c'.repeat(32), name: 'Ben' });
    expect(names(hostView)).toEqual(['Jeremy:online', 'Anna:online', 'Ben:online']);
    void ben;
  });

  it('bounds coordinates and drops positions beyond the message rate', async () => {
    const anna = join('Anna');
    anna.device.raw({ t: 'cursor', p: 'p', x: 1e300, y: -1e300 });
    expect(hostView.cursors[0]).toMatchObject({ x: 10_000_000, y: -10_000_000 });
    for (let step = 0; step < 200; step++) anna.device.raw({ t: 'cursor', p: 'p', x: step, y: 0 });
    expect(hostView.cursors[0]!.x).toBeLessThan(60);
    await vi.advanceTimersByTimeAsync(1100);
    anna.device.raw({ t: 'cursor', p: 'p', x: 777, y: 0 });
    expect(hostView.cursors[0]!.x).toBe(777);
  });

  it('ignores a list or positions that are not well formed on the guest', async () => {
    const anna = join('Anna');
    const before = anna.view();
    const member = { id: 'a'.repeat(12), name: 'X', number: 1, role: 'editor', color: 1, state: 'online' };
    for (const value of [
      { t: 'roster', you: 'a'.repeat(12), members: [member] },
      { t: 'roster', you: 'a'.repeat(12), members: [{ ...member, role: 'owner', color: 99 }] },
      { t: 'roster', you: 'b'.repeat(12), members: [{ ...member, role: 'owner' }] },
      { t: 'roster', you: 'a'.repeat(12), members: [{ ...member, role: 'owner' }, { ...member, role: 'owner' }] },
      { t: 'roster', you: 'a'.repeat(12), members: 'none' },
      { t: 'cursors', c: 'x' }, { t: 'cursors', c: [{ id: 'zz', p: 'p', x: 1, y: 1 }] }, { t: 'other' },
    ]) hub.fromHost(anna.device, value);
    expect(anna.view()).toEqual(before);
  });

  it('cleans names the host passes on', async () => {
    const anna = join('Anna');
    hub.fromHost(anna.device, { t: 'roster', you: 'a'.repeat(12), members: [{ id: 'a'.repeat(12), name: 'A', number: 1, role: 'editor', color: 1, state: 'online' }, { id: 'b'.repeat(12), name: 'Host\u202Etsoh\n', number: 0, role: 'owner', color: 0, state: 'online' }] });
    expect(anna.view().participants.map(value => value.name)).toEqual(['A', 'Host tsoh']);
  });
});

describe('participant colours', () => {
  it('has one token per colour the host hands out and wraps around', async () => {
    const { PRESENCE_COLORS, presenceColor } = await import('@/renderer/design-system/atoms/presence-colors');
    expect(PRESENCE_COLORS).toHaveLength(PRESENCE_COLOR_COUNT);
    expect(presenceColor(0)).toBe('var(--presence-1)');
    expect(presenceColor(7)).toBe('var(--presence-8)');
    expect(presenceColor(8)).toBe('var(--presence-1)');
    expect(presenceColor(-1)).toBe('var(--presence-8)');
    expect(presenceColor(Number.NaN)).toBe('var(--presence-1)');
  });
});
