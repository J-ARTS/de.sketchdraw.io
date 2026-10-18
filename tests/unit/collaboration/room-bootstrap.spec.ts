import { describe, expect, it, vi } from 'vitest';
import { createCrdtController } from '@/crdt';
import { createDocument, createElement } from '@/domain';
import { bindCrdtTransport, bootstrapRoomDocument } from '@/collaboration/crdt';
import {
  buildSessionLink, DEFAULT_WEB_APP_URL, extractSessionInvitation, normalizeWebAppUrl, ownWebAppUrl,
} from '@/collaboration/session-link';
import type { AutomaticPeer, CollaborationTransport, CollaborationTransportChannel, CollaborationTransportMessage, CollaborationTransportStatus } from '@/collaboration/transport';

/** Two in-memory transports that deliver to each other like a connected room. */
type Side = { transport: CollaborationTransport; messageListeners: Set<(message: CollaborationTransportMessage) => void | Promise<void>>; statusListeners: Set<(status: CollaborationTransportStatus) => void>; link(value: Side): void };
function connectedPair(): [CollaborationTransport, CollaborationTransport] {
  const peer = (peerId: string): AutomaticPeer => ({ peerId, keyHash: `${peerId}`.padEnd(32, '0'), publicKeyBase64Url: 'k', invitationId: 'i', role: 'editor', grantId: 'g', grantGeneration: 0 });
  const make = (selfId: string, otherId: string): Side => {
    const messageListeners = new Set<(message: CollaborationTransportMessage) => void | Promise<void>>();
    const statusListeners = new Set<(status: CollaborationTransportStatus) => void>();
    let other: Side | undefined;
    const status = (): CollaborationTransportStatus => ({ mode: 'automatic-p2p', state: 'ready', peers: [peer(otherId)], relayUrls: [], iceServers: [] });
    const transport: CollaborationTransport = {
      mode: 'automatic-p2p',
      getStatus: status,
      subscribeStatus: listener => { statusListeners.add(listener); return () => statusListeners.delete(listener); },
      subscribeMessage: listener => { messageListeners.add(listener); return () => messageListeners.delete(listener); },
      async send(channel: CollaborationTransportChannel, data: Uint8Array) {
        const target = other!;
        queueMicrotask(() => { for (const listener of target.messageListeners) void listener({ channel, data: data.slice(), peer: peer(selfId) }); });
      },
      async close() {},
    };
    return { transport, messageListeners, statusListeners, link(value: Side) { other = value; } };
  };
  const a = make('host', 'guest'); const b = make('guest', 'host');
  a.link(b); b.link(a);
  return [a.transport, b.transport];
}

describe('room bootstrap', () => {
  it('fetches the complete document of the host and keeps syncing afterwards', async () => {
    const document = createDocument('Gemeinsam');
    document.elements = [createElement('rectangle', { x: 10, y: 20, width: 100, height: 60 })];
    const host = createCrdtController(document);
    const [hostTransport, guestTransport] = connectedPair();
    const hostBinding = bindCrdtTransport(host, hostTransport);

    const guest = await bootstrapRoomDocument(guestTransport, { documentId: document.id, timeoutMs: 2000 });
    expect(guest.getSnapshot().document.id).toBe(document.id);
    expect(guest.getSnapshot().document.elements).toHaveLength(1);

    const guestBinding = bindCrdtTransport(guest, guestTransport);
    // Both directions keep converging after the bootstrap.
    host.dispatch({ type: 'rename', title: 'Vom Host' }, { actorId: 'actor:host', expectedRevision: host.getSnapshot().revision, source: 'human' });
    await vi.waitFor(() => expect(guest.getSnapshot().document.title).toBe('Vom Host'));
    guest.dispatch({ type: 'rename', title: 'Vom Gast' }, { actorId: 'actor:guest', expectedRevision: guest.getSnapshot().revision, source: 'human' });
    await vi.waitFor(() => expect(host.getSnapshot().document.title).toBe('Vom Gast'));
    await hostBinding.close(); await guestBinding.close();
    host.destroy(); guest.destroy();
  });

  it('rejects a room that belongs to another document', async () => {
    const host = createCrdtController(createDocument('Anders'));
    const [hostTransport, guestTransport] = connectedPair();
    const binding = bindCrdtTransport(host, hostTransport);
    await expect(bootstrapRoomDocument(guestTransport, { documentId: 'document:other', timeoutMs: 2000 })).rejects.toThrow('DOCUMENT_MISMATCH');
    await binding.close(); host.destroy();
  });

  it('times out when nobody answers', async () => {
    const [, guestTransport] = connectedPair();
    await expect(bootstrapRoomDocument(guestTransport, { documentId: 'x', timeoutMs: 50 })).rejects.toThrow('DIRECT_CONNECTION_TIMEOUT');
  });
});

describe('session links', () => {
  const invitation = 'eyJ2ZXJzaW9uIjoxLCJ0eXBlIjoiYXV0b21hdGljIn0'.repeat(3);
  it('round-trips an invitation through the link fragment', () => {
    const link = buildSessionLink(invitation, 'https://app.example.org/sketch/');
    expect(link.startsWith('https://app.example.org/sketch/#sketchdraw-session=')).toBe(true);
    expect(extractSessionInvitation(link)).toBe(invitation);
    expect(extractSessionInvitation(`  ${link}  `)).toBe(invitation);
    expect(extractSessionInvitation(`#sketchdraw-session=${encodeURIComponent(invitation)}`)).toBe(invitation);
    expect(extractSessionInvitation(invitation)).toBe(invitation);
  });
  it('rejects text that is no invitation', () => {
    for (const bad of ['', '   ', 'hallo welt', 'https://example.org/']) expect(extractSessionInvitation(bad)).toBeNull();
  });
  it('normalizes the web app address', () => {
    expect(normalizeWebAppUrl('javascript:alert(1)')).toBe(DEFAULT_WEB_APP_URL);
    expect(normalizeWebAppUrl('')).toBe(DEFAULT_WEB_APP_URL);
    expect(normalizeWebAppUrl('https://x.org/app/?a=1#b')).toBe('https://x.org/app/');
    expect(ownWebAppUrl({ protocol: 'file:', origin: 'null', pathname: '/index.html' })).toBe(DEFAULT_WEB_APP_URL);
    expect(ownWebAppUrl({ protocol: 'https:', origin: 'https://sketch.example', pathname: '/' })).toBe('https://sketch.example/');
  });
});
