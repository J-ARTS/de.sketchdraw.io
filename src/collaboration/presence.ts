/**
 * Who is in a session and where their pointers are (#222).
 *
 * Sessions are a star: guests reach only the host. The host therefore writes the participant list and relays the
 * pointers; a guest only ever speaks for itself (its name and its own pointer). Names, colours and identifiers of the
 * list come from the host alone, so a guest can neither pose as someone else nor move another pointer.
 *
 * Messages are small JSON records on the transport's `awareness` channel. Anything malformed, oversized or too frequent
 * is dropped; presence never ends a connection.
 */
import type { AutomaticPeer, CollaborationTransport, CollaborationTransportStatus } from './transport';

export const PRESENCE_COLOR_COUNT = 8;
export const PRESENCE_NAME_MAX = 40;
/** How long the host keeps listing a participant whose connection dropped; matches the guest's reconnect window. */
export const PRESENCE_RECONNECT_WINDOW_MS = 5 * 60_000;
export const PRESENCE_CURSOR_INTERVAL_MS = 80;

const HELLO_GRACE_MS = 1500;
const GUEST_MESSAGE_MAX_BYTES = 512;
const HOST_MESSAGE_MAX_BYTES = 32 * 1024;
const RATE_WINDOW_MS = 1000;
const RATE_LIMIT = 40;
const HELLO_LIMIT = 6;
const HELLO_WINDOW_MS = 10_000;
const MAX_MEMBERS = 100;
const MAX_WAITING = 25;
const PAGE_ID_MAX = 128;
const COORDINATE_LIMIT = 10_000_000;
const ID_PATTERN = /^[0-9a-f]{12}$/;
const KEY_PATTERN = /^[0-9a-f]{32}$/;

export type ParticipantRole = 'owner' | 'editor' | 'viewer';

export interface SessionParticipant {
  /** Public identifier the host assigned; stable while the participant is listed. */
  id: string;
  /** The name the participant chose; empty when none was given (the interface then shows a neutral label). */
  name: string;
  /** Running number of the guest for the neutral label; 0 for the host. */
  number: number;
  role: ParticipantRole;
  /** Index into the participant colours, 0 … PRESENCE_COLOR_COUNT - 1. */
  color: number;
  /** `reconnecting`: the connection dropped and the participant may still come back. */
  state: 'online' | 'reconnecting';
  /** This device. */
  self: boolean;
}

export interface CursorPoint { pageId: string; x: number; y: number }
export interface SessionCursor extends CursorPoint { id: string }
export interface PresenceSnapshot { participants: readonly SessionParticipant[]; cursors: readonly SessionCursor[] }

export const EMPTY_PRESENCE: PresenceSnapshot = Object.freeze({ participants: Object.freeze([]), cursors: Object.freeze([]) });

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/** Removes control and direction-override characters, collapses whitespace and bounds the length. */
export function cleanParticipantName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.slice(0, 400).normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return Array.from(text).slice(0, PRESENCE_NAME_MAX).join('').trim();
}

/** One or two letters for the badge: the first letters of the first two words, or the first two of a single word. */
export function participantInitials(name: string): string {
  const words = cleanParticipantName(name).split(' ').filter(Boolean).map(word => Array.from(word.replace(/^[^\p{L}\p{N}]+/u, ''))).filter(word => word.length);
  if (!words.length) return '?';
  const letters = words.length === 1 ? words[0]!.slice(0, 2) : [words[0]![0]!, words[1]![0]!];
  return letters.join('').toLocaleUpperCase();
}

function randomHex(bytes: number): string {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return Array.from(data, value => value.toString(16).padStart(2, '0')).join('');
}

function encode(value: unknown): Uint8Array { return encoder.encode(JSON.stringify(value)); }

function decode(data: Uint8Array, limit: number): Record<string, unknown> | null {
  if (!(data instanceof Uint8Array) || data.byteLength < 2 || data.byteLength > limit) return null;
  try {
    const value: unknown = JSON.parse(decoder.decode(data));
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

function hasOnly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function coordinate(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(Math.min(COORDINATE_LIMIT, Math.max(-COORDINATE_LIMIT, value)) * 10) / 10;
}

/** A pointer position as it may be sent or accepted; null when any part is not usable. */
function cleanPoint(pageId: unknown, x: unknown, y: unknown): CursorPoint | null {
  const px = coordinate(x), py = coordinate(y);
  if (typeof pageId !== 'string' || !pageId || pageId.length > PAGE_ID_MAX || px === null || py === null) return null;
  return { pageId, x: px, y: py };
}

function samePoint(a: CursorPoint | null, b: CursorPoint | null): boolean {
  return a === b || (!!a && !!b && a.pageId === b.pageId && a.x === b.x && a.y === b.y);
}

const realTimers = {
  set(callback: () => void, ms: number): unknown { const handle = setTimeout(callback, ms); (handle as { unref?: () => void }).unref?.(); return handle; },
  clear(handle: unknown): void { clearTimeout(handle as ReturnType<typeof setTimeout>); },
};

export interface PresenceOptions {
  /** The name of the local user; may be empty. */
  name?: string;
  onChange(snapshot: PresenceSnapshot): void;
  now?: () => number;
  cursorIntervalMs?: number;
}

export interface HostPresenceOptions extends PresenceOptions {
  /** How long a dropped participant stays listed; defaults to PRESENCE_RECONNECT_WINDOW_MS. */
  removeAfterMs?: number;
  helloGraceMs?: number;
}

interface PresenceBase {
  snapshot(): PresenceSnapshot;
  /** The local pointer in document coordinates; null when it left the canvas. */
  setCursor(point: CursorPoint | null): void;
  setName(name: string): void;
  close(): void;
}

export interface HostPresence extends PresenceBase {
  /** Ends the participant's connection (the guest is told it was removed) and takes it off the list. */
  remove(id: string): boolean;
  /** Takes a peer off the list before the host ends its connection for another reason. */
  forgetPeer(peerId: string): void;
}

export interface GuestPresence extends PresenceBase {
  /** Tells the host this device leaves on purpose, so it is not listed as interrupted. */
  leave(): Promise<void>;
}

type HostTransport = CollaborationTransport & { kick(peerId: string): void };

interface Member {
  id: string;
  /** Secret the guest chose; proves on reconnect that it is the same participant. */
  key: string | null;
  name: string;
  number: number;
  role: ParticipantRole;
  color: number;
  order: number;
  peerId: string | null;
  lostTimer: unknown;
  cursor: CursorPoint | null;
}

export function createHostPresence(transport: HostTransport, options: HostPresenceOptions): HostPresence {
  const now = options.now ?? (() => Date.now());
  const removeAfterMs = options.removeAfterMs ?? PRESENCE_RECONNECT_WINDOW_MS;
  const graceMs = options.helloGraceMs ?? HELLO_GRACE_MS;
  const intervalMs = options.cursorIntervalMs ?? PRESENCE_CURSOR_INTERVAL_MS;
  const members = new Map<string, Member>();
  const byPeer = new Map<string, Member>();
  /** Authenticated peers that have not introduced themselves yet. */
  const waiting = new Map<string, { peer: AutomaticPeer; timer: unknown }>();
  /** Connections that are still open but no longer stand for a participant (left, removed, replaced by a reconnect). */
  const ignored = new Set<string>();
  const rates = new Map<string, { at: number; count: number; helloAt: number; hellos: number }>();
  const dirty = new Set<string>();
  let order = 0, guests = 0, closed = false;
  let cursorTimer: unknown = null, sending = false;
  const self: Member = { id: randomHex(6), key: null, name: cleanParticipantName(options.name), number: 0, role: 'owner', color: 0, order: order++, peerId: null, lostTimer: null, cursor: null };
  members.set(self.id, self);

  const listed = () => Array.from(members.values()).sort((a, b) => a.order - b.order);
  const online = (member: Member) => member === self || member.peerId !== null;
  const snapshot = (): PresenceSnapshot => ({
    participants: listed().map(member => ({ id: member.id, name: member.name, number: member.number, role: member.role, color: member.color, state: online(member) ? 'online' : 'reconnecting', self: member === self })),
    cursors: listed().filter(member => member !== self && member.cursor && online(member)).map(member => ({ id: member.id, ...member.cursor! })),
  });
  const changed = () => { if (!closed) options.onChange(snapshot()); };
  const targets = () => Array.from(byPeer.keys());
  /** Best effort: a peer that left a moment ago must not fail the message for everyone else. */
  const send = (data: Uint8Array, peerIds: readonly string[]): Promise<void> => {
    const present = new Set(transport.getStatus().peers.map(peer => peer.peerId));
    const reachable = peerIds.filter(peerId => present.has(peerId));
    return reachable.length ? transport.send('awareness', data, reachable).catch(() => undefined) : Promise.resolve();
  };

  function sendRoster(): void {
    const list = listed().map(member => ({ id: member.id, name: member.name, number: member.number, role: member.role, color: member.color, state: online(member) ? 'online' : 'reconnecting' }));
    for (const [peerId, member] of byPeer) void send(encode({ t: 'roster', you: member.id, members: list }), [peerId]);
  }
  function rosterChanged(): void { sendRoster(); changed(); }

  function cursorRecord(member: Member): Record<string, unknown> {
    return member.cursor && online(member) ? { id: member.id, p: member.cursor.pageId, x: member.cursor.x, y: member.cursor.y } : { id: member.id, p: null };
  }
  function flushCursors(): void {
    cursorTimer = null;
    if (closed || !dirty.size) return;
    // One batch at a time: while a send is still on its way, newer positions simply replace the waiting ones.
    if (sending) { scheduleCursors(); return; }
    const records = Array.from(dirty, id => members.get(id)).filter((member): member is Member => !!member).map(cursorRecord);
    dirty.clear();
    const peerIds = targets();
    if (!records.length || !peerIds.length) return;
    sending = true;
    void send(encode({ t: 'cursors', c: records }), peerIds).finally(() => { sending = false; });
  }
  function scheduleCursors(): void { if (cursorTimer === null && !closed) cursorTimer = realTimers.set(flushCursors, intervalMs); }
  function setMemberCursor(member: Member, point: CursorPoint | null): boolean {
    if (samePoint(member.cursor, point)) return false;
    member.cursor = point;
    dirty.add(member.id);
    scheduleCursors();
    return true;
  }

  function freeColor(): number {
    const used = new Array<number>(PRESENCE_COLOR_COUNT).fill(0);
    for (const member of members.values()) used[member.color] = (used[member.color] ?? 0) + 1;
    let best = 0;
    for (let index = 1; index < PRESENCE_COLOR_COUNT; index++) if (used[index]! < used[best]!) best = index;
    return best;
  }

  function drop(member: Member): void {
    if (member === self) return;
    realTimers.clear(member.lostTimer);
    members.delete(member.id);
    dirty.delete(member.id);
    if (member.peerId) { byPeer.delete(member.peerId); member.peerId = null; }
  }

  /** The connection is gone: the participant stays listed as interrupted until the window closes. */
  function lose(member: Member): void {
    if (member.peerId) byPeer.delete(member.peerId);
    member.peerId = null;
    if (member.cursor) setMemberCursor(member, null); else dirty.delete(member.id);
    // Without a key the participant could never be recognised again, so there is nothing to wait for.
    if (!member.key || removeAfterMs <= 0) { drop(member); return; }
    realTimers.clear(member.lostTimer);
    member.lostTimer = realTimers.set(() => { if (!closed && members.get(member.id) === member && !member.peerId) { drop(member); rosterChanged(); } }, removeAfterMs);
    const interrupted = Array.from(members.values()).filter(value => value !== self && !value.peerId).sort((a, b) => a.order - b.order);
    while (interrupted.length > MAX_WAITING) drop(interrupted.shift()!);
  }

  function admit(peer: AutomaticPeer, key: string | null, name: string): void {
    const pending = waiting.get(peer.peerId);
    if (pending) { realTimers.clear(pending.timer); waiting.delete(peer.peerId); }
    if (closed || ignored.has(peer.peerId) || !transport.getStatus().peers.some(value => value.peerId === peer.peerId)) return;
    const current = byPeer.get(peer.peerId);
    const known = key ? Array.from(members.values()).find(member => member.key === key) : undefined;
    let member: Member;
    if (known && known !== current) {
      // The same participant on a new connection. An older connection the host has not seen fail yet is replaced.
      if (current) drop(current);
      if (known.peerId) { ignored.add(known.peerId); byPeer.delete(known.peerId); }
      realTimers.clear(known.lostTimer);
      known.lostTimer = null;
      member = known;
    } else if (current) {
      if (current.key && key && current.key !== key) return;
      member = current;
      member.key ??= key;
    } else {
      if (members.size >= MAX_MEMBERS) return;
      member = { id: randomHex(6), key, name: '', number: ++guests, role: peer.role, color: freeColor(), order: order++, peerId: null, lostTimer: null, cursor: null };
      members.set(member.id, member);
    }
    member.peerId = peer.peerId;
    member.role = peer.role;
    if (key !== null) member.name = name;
    byPeer.set(peer.peerId, member);
    rosterChanged();
    const cursors = listed().filter(value => value !== member && value.cursor && online(value)).map(cursorRecord);
    if (cursors.length) void send(encode({ t: 'cursors', c: cursors }), [peer.peerId]);
  }

  function allowed(peerId: string, hello: boolean): boolean {
    const at = now();
    let rate = rates.get(peerId);
    if (!rate) { rate = { at, count: 0, helloAt: at, hellos: 0 }; rates.set(peerId, rate); }
    if (at - rate.at >= RATE_WINDOW_MS) { rate.at = at; rate.count = 0; }
    if (++rate.count > RATE_LIMIT) return false;
    if (!hello) return true;
    if (at - rate.helloAt >= HELLO_WINDOW_MS) { rate.helloAt = at; rate.hellos = 0; }
    return ++rate.hellos <= HELLO_LIMIT;
  }

  const offMessage = transport.subscribeMessage(message => {
    if (closed || message.channel !== 'awareness' || ignored.has(message.peer.peerId)) return;
    const value = decode(message.data, GUEST_MESSAGE_MAX_BYTES);
    if (!value) return;
    if (!allowed(message.peer.peerId, value['t'] === 'hello')) return;
    if (value['t'] === 'hello') {
      if (!hasOnly(value, ['t', 'key', 'name']) || typeof value['key'] !== 'string' || !KEY_PATTERN.test(value['key']) || typeof value['name'] !== 'string') return;
      admit(message.peer, value['key'], cleanParticipantName(value['name']));
      return;
    }
    const member = byPeer.get(message.peer.peerId);
    if (!member) return;
    if (value['t'] === 'cursor') {
      if (!hasOnly(value, ['t', 'p', 'x', 'y'])) return;
      const point = value['p'] === null ? null : cleanPoint(value['p'], value['x'], value['y']);
      if (value['p'] !== null && !point) return;
      if (setMemberCursor(member, point)) changed();
      return;
    }
    if (value['t'] === 'bye' && hasOnly(value, ['t'])) {
      ignored.add(message.peer.peerId);
      if (member.cursor) setMemberCursor(member, null);
      drop(member);
      rosterChanged();
    }
  });

  function inspect(status: CollaborationTransportStatus): void {
    if (closed) return;
    const present = new Map(status.peers.map(peer => [peer.peerId, peer]));
    let lost = false;
    for (const [peerId, member] of Array.from(byPeer)) if (!present.has(peerId)) { lose(member); lost = true; }
    for (const [peerId, entry] of Array.from(waiting)) if (!present.has(peerId)) { realTimers.clear(entry.timer); waiting.delete(peerId); }
    for (const peerId of Array.from(ignored)) if (!present.has(peerId)) ignored.delete(peerId);
    for (const peerId of Array.from(rates.keys())) if (!present.has(peerId)) rates.delete(peerId);
    for (const peer of status.peers) {
      if (byPeer.has(peer.peerId) || waiting.has(peer.peerId) || ignored.has(peer.peerId)) continue;
      // A guest introduces itself right after joining; one that never does (an older version) is listed without a name.
      waiting.set(peer.peerId, { peer, timer: realTimers.set(() => admit(peer, null, ''), graceMs) });
    }
    if (lost) rosterChanged();
  }
  const offStatus = transport.subscribeStatus(inspect);
  inspect(transport.getStatus());

  return {
    snapshot,
    setCursor(point) {
      const clean = point ? cleanPoint(point.pageId, point.x, point.y) : null;
      setMemberCursor(self, clean);
    },
    setName(name) {
      const clean = cleanParticipantName(name);
      if (clean === self.name) return;
      self.name = clean;
      rosterChanged();
    },
    remove(id) {
      const member = members.get(id);
      if (!member || member === self) return false;
      const peerId = member.peerId;
      if (member.cursor) setMemberCursor(member, null);
      if (peerId) ignored.add(peerId);
      drop(member);
      if (peerId) transport.kick(peerId);
      rosterChanged();
      return true;
    },
    forgetPeer(peerId) {
      const entry = waiting.get(peerId);
      if (entry) { realTimers.clear(entry.timer); waiting.delete(peerId); }
      ignored.add(peerId);
      const member = byPeer.get(peerId);
      if (!member) return;
      if (member.cursor) setMemberCursor(member, null);
      drop(member);
      rosterChanged();
    },
    close() {
      if (closed) return;
      closed = true;
      offMessage(); offStatus();
      realTimers.clear(cursorTimer);
      for (const entry of waiting.values()) realTimers.clear(entry.timer);
      for (const member of members.values()) realTimers.clear(member.lostTimer);
      waiting.clear(); members.clear(); byPeer.clear(); dirty.clear(); ignored.clear(); rates.clear();
    },
  };
}

function parseRoster(value: Record<string, unknown>): { you: string; members: Omit<SessionParticipant, 'self'>[] } | null {
  if (!hasOnly(value, ['t', 'you', 'members']) || typeof value['you'] !== 'string' || !ID_PATTERN.test(value['you'])) return null;
  const list = value['members'];
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_MEMBERS + MAX_WAITING) return null;
  const members: Omit<SessionParticipant, 'self'>[] = [];
  const seen = new Set<string>();
  for (const entry of list as unknown[]) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const item = entry as Record<string, unknown>;
    if (!hasOnly(item, ['id', 'name', 'number', 'role', 'color', 'state'])) return null;
    const { id, name, number, role, color, state } = item;
    if (typeof id !== 'string' || !ID_PATTERN.test(id) || seen.has(id) || typeof name !== 'string') return null;
    if (typeof number !== 'number' || !Number.isInteger(number) || number < 0 || number > 1_000_000) return null;
    if (role !== 'owner' && role !== 'editor' && role !== 'viewer') return null;
    if (typeof color !== 'number' || !Number.isInteger(color) || color < 0 || color >= PRESENCE_COLOR_COUNT) return null;
    if (state !== 'online' && state !== 'reconnecting') return null;
    seen.add(id);
    members.push({ id, name: cleanParticipantName(name), number, role, color, state });
  }
  if (!seen.has(value['you']) || members.filter(member => member.role === 'owner').length !== 1) return null;
  return { you: value['you'], members };
}

export function createGuestPresence(transport: CollaborationTransport, options: PresenceOptions): GuestPresence {
  const intervalMs = options.cursorIntervalMs ?? PRESENCE_CURSOR_INTERVAL_MS;
  const key = randomHex(16);
  const cursors = new Map<string, CursorPoint>();
  let name = cleanParticipantName(options.name);
  let roster: Omit<SessionParticipant, 'self'>[] = [];
  let you = '';
  let closed = false, greeted = false, connected = false;
  let wanted: CursorPoint | null = null, sent: CursorPoint | null = null;
  let cursorTimer: unknown = null, helloTimer: unknown = null, sending = false;

  const snapshot = (): PresenceSnapshot => {
    const visible = new Set(roster.filter(member => member.id !== you && member.state === 'online').map(member => member.id));
    return {
      participants: roster.map(member => ({ ...member, self: member.id === you })),
      cursors: connected ? Array.from(cursors).filter(([id]) => visible.has(id)).map(([id, point]) => ({ id, ...point })) : [],
    };
  };
  const changed = () => { if (!closed) options.onChange(snapshot()); };
  const send = (value: unknown): Promise<boolean> => transport.send('awareness', encode(value)).then(() => true, () => false);

  function greet(): void {
    realTimers.clear(helloTimer); helloTimer = null;
    if (closed || !connected) return;
    greeted = true;
    void send({ t: 'hello', key, name }).then(ok => {
      if (ok || closed) return;
      // The channel was busy or just went away; a status change or this retry introduces the device again.
      greeted = false;
      helloTimer = realTimers.set(() => { if (!greeted) greet(); }, 1000);
    });
  }

  function flushCursor(): void {
    cursorTimer = null;
    if (closed || !connected || samePoint(wanted, sent)) return;
    if (sending) { scheduleCursor(); return; }
    const point = wanted;
    sending = true;
    void send(point ? { t: 'cursor', p: point.pageId, x: point.x, y: point.y } : { t: 'cursor', p: null, x: 0, y: 0 })
      .then(ok => { sending = false; if (ok) sent = point; if (!samePoint(wanted, sent) && ok) scheduleCursor(); });
  }
  function scheduleCursor(): void { if (cursorTimer === null && !closed) cursorTimer = realTimers.set(flushCursor, intervalMs); }

  const offMessage = transport.subscribeMessage(message => {
    if (closed || message.channel !== 'awareness') return;
    const value = decode(message.data, HOST_MESSAGE_MAX_BYTES);
    if (!value) return;
    if (value['t'] === 'roster') {
      const parsed = parseRoster(value);
      if (!parsed) return;
      roster = parsed.members; you = parsed.you;
      const listed = new Set(roster.map(member => member.id));
      for (const id of Array.from(cursors.keys())) if (!listed.has(id)) cursors.delete(id);
      changed();
      return;
    }
    if (value['t'] !== 'cursors' || !hasOnly(value, ['t', 'c']) || !Array.isArray(value['c']) || value['c'].length > MAX_MEMBERS + MAX_WAITING) return;
    let moved = false;
    for (const entry of value['c'] as unknown[]) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const item = entry as Record<string, unknown>;
      if (typeof item['id'] !== 'string' || !ID_PATTERN.test(item['id']) || item['id'] === you) continue;
      if (item['p'] === null) { moved = cursors.delete(item['id']) || moved; continue; }
      const point = cleanPoint(item['p'], item['x'], item['y']);
      if (!point || cursors.size >= MAX_MEMBERS && !cursors.has(item['id'])) continue;
      if (!samePoint(cursors.get(item['id']) ?? null, point)) { cursors.set(item['id'], point); moved = true; }
    }
    if (moved) changed();
  });

  function inspect(status: CollaborationTransportStatus): void {
    if (closed) return;
    const ready = status.state === 'ready' && status.peers.length > 0;
    if (ready && !connected) {
      connected = true; sent = null;
      greet();
      if (wanted) scheduleCursor();
      changed();
    } else if (!ready && connected) {
      // Positions are only meaningful while they are fed; the list stays so a brief interruption does not flicker.
      connected = false; greeted = false; cursors.clear();
      if (status.state === 'error' || status.state === 'closed') { roster = []; you = ''; }
      changed();
    } else if (!ready && roster.length && (status.state === 'error' || status.state === 'closed')) {
      roster = []; you = ''; changed();
    }
  }
  const offStatus = transport.subscribeStatus(inspect);
  inspect(transport.getStatus());

  function close(): void {
    if (closed) return;
    closed = true;
    offMessage(); offStatus();
    realTimers.clear(cursorTimer); realTimers.clear(helloTimer);
    cursors.clear(); roster = [];
  }

  return {
    snapshot,
    setCursor(point) {
      wanted = point ? cleanPoint(point.pageId, point.x, point.y) : null;
      if (connected && !samePoint(wanted, sent)) scheduleCursor();
    },
    setName(value) {
      const clean = cleanParticipantName(value);
      if (clean === name) return;
      name = clean;
      if (connected) greet();
    },
    async leave() {
      if (closed) return;
      const wasConnected = connected;
      close();
      if (!wasConnected) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([send({ t: 'bye' }), new Promise<void>(resolve => { timer = setTimeout(resolve, 400); })]); }
      finally { clearTimeout(timer); }
    },
    close,
  };
}
