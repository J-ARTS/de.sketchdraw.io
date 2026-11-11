import { createHash } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import WebSocket from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { createCrdtController, type CrdtDocumentController } from '@/crdt';
import { createDocument, createElement, validateDocument, type SketchAsset, type SketchDocument } from '@/domain';
import { bindCrdtTransport, bootstrapRoomDocument } from '@/collaboration/crdt';
import { createSessionId, type HdhtInvitation } from '@/collaboration/hdht/invitation';
import { createHostKeys, hostKeyToText } from '@/collaboration/hdht/relay-channel';
import { createHdhtGuestTransport, createHdhtHostTransport } from '@/collaboration/hdht/session';
import type { CollaborationTransport } from '@/collaboration/transport';
import { nativeSide, runCleanups, testnet } from './harness';
// @ts-expect-error plain ESM relay without type declarations
import { createRelayServer } from '../../../../relay/server.mjs';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await Promise.resolve(close()).catch(() => undefined); });
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const until = async (check: () => boolean, ms = 15_000) => {
  const deadline = Date.now() + ms;
  while (!check()) { if (Date.now() > deadline) throw new Error('Rich-document convergence timeout'); await wait(20); }
};
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

/** A complete decodable PNG with IHDR, IDAT, CRCs and IEND; its real pixel bytes exceed 3.5 MiB. */
function largePng(id: string, seed: number): SketchAsset {
  const width = 1024, height = 896;
  const pixels = Buffer.alloc((width * 4 + 1) * height);
  for (let row = 0; row < height; row++) {
    const offset = row * (width * 4 + 1);
    pixels[offset] = 0; // PNG filter: none.
    for (let col = 0; col < width; col++) {
      const at = offset + 1 + col * 4;
      pixels[at] = (col + seed) % 256;
      pixels[at + 1] = (row * 7 + seed) % 256;
      pixels[at + 2] = (row ^ col ^ seed) % 256;
      pixels[at + 3] = 255;
    }
  }
  const chunk = (name: string, data: Buffer) => {
    const type = Buffer.from(name);
    const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
    return Buffer.concat([size, type, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels, { level: 0 })), chunk('IEND', Buffer.alloc(0))]);
  return { id, name: `${id}.png`, mimeType: 'image/png', dataUrl: `data:image/png;base64,${png.toString('base64')}` };
}

function richDocument(): SketchDocument {
  const doc = createDocument('Mehrseitige gemeinsame Architektur');
  doc.id = 'document:rich-relay';
  doc.pages.push({ id: 'page:details', name: 'Details' });
  const image = largePng('asset:host-image', 17);
  doc.assets[image.id] = image;
  doc.elements = [
    createElement('rectangle', { id: 'shape:gateway', text: 'Gateway', x: 40, y: 40 }),
    createElement('path', { id: 'sketch:flow', x: 80, y: 180, points: [{ x: 0, y: 0 }, { x: 20, y: 40 }, { x: 80, y: 10 }] }),
    createElement('sticky-note', { id: 'note:plan', text: 'Erste gemeinsame Notiz', author: 'Host', x: 300, y: 40 }),
    createElement('image', { id: 'image:host', assetId: image.id, x: 600, y: 40, width: 1024, height: 896 }),
    createElement('text', { id: 'text:details', pageId: 'page:details', text: 'Zweite Seite', x: 40, y: 80 }),
    createElement('annotation', { id: 'annotation:details', pageId: 'page:details', text: 'Entscheidungen und nächste Schritte', x: 40, y: 180 }),
  ];
  const timestamp = '2026-11-11T12:00:00.000Z';
  doc.commentThreads = [{ id: 'thread:review', target: { elementId: 'note:plan', anchor: { x: 0.5, y: 0.5 }, fallback: { x: 420, y: 160 } }, resolved: false,
    createdAt: timestamp, updatedAt: timestamp, messages: [{ id: 'message:review', authorId: 'actor:host', authorName: 'Host', body: 'Bitte die zweite Seite prüfen.', createdAt: timestamp }] }];
  doc.tasks = [{ id: 'task:review', sourceThreadId: 'thread:review', title: 'Architektur prüfen', description: 'Notiz und Details gemeinsam abstimmen.', status: 'todo', rank: 0, createdAt: timestamp, updatedAt: timestamp }];
  return validateDocument(doc);
}

/** Compare every document field without dumping megabytes of base64 on failure; independently check decoded bytes. */
function comparable(document: SketchDocument) {
  return { ...document, assets: Object.fromEntries(Object.entries(document.assets).map(([id, asset]) => [id, { ...asset, dataUrl: hash(asset.dataUrl) }])) };
}
function decodedHash(asset: SketchAsset): string { return hash(Buffer.from(asset.dataUrl.split(',')[1]!, 'base64')); }

describe('real document transfers over the encrypted local relay', () => {
  it('bootstraps editor and viewer with a large PNG, pages and annotations, then converges after another large image and reconnect', async () => {
    const initial = richDocument();
    const hostController = createCrdtController(initial);
    cleanups.push(() => hostController.destroy());
    expect(hostController.encodeUpdate().byteLength).toBeGreaterThan(4 * 1024 * 1024);
    expect(Buffer.byteLength(JSON.stringify(initial))).toBeLessThan(32 * 1024 * 1024);
    const relay = createRelayServer();
    const address = await relay.listen(0, '127.0.0.1');
    cleanups.push(() => relay.close());
    const url = `ws://127.0.0.1:${address.port}/`;
    const hostKeys = await createHostKeys();
    const sessionId = createSessionId(), expiresAt = Date.now() + 120_000;
    const timing = { heartbeatMs: 1000, timeoutMs: 15_000 };
    let role: 'editor' | 'viewer' = 'editor';
    const host = createHdhtHostTransport({ sessionId, documentId: initial.id, hostKeys, expiresAt, timing, grantedRole: () => role,
      relay: { url, factory: (u, p) => new WebSocket(u, p) as never } });
    cleanups.push(() => host.close());
    const errors: string[] = [];
    const bind = (controller: CrdtDocumentController, transport: CollaborationTransport) => {
      const binding = bindCrdtTransport(controller, transport, undefined, { onError: error => errors.push(`${transport.getStatus().grantedRole ?? 'host'}:${error.message}`) });
      cleanups.push(() => binding.close());
    };
    bind(hostController, host);
    await until(() => host.getStatus().state === 'ready');
    const invitation: HdhtInvitation = { version: 1, sessionId, hostKey: hostKeyToText(hostKeys), directKey: '', relayUrl: url, documentId: initial.id, expiresAt };
    const join = async () => {
      const sockets: WebSocket[] = [];
      const transport = createHdhtGuestTransport({ invitation, pin: host.getPin(), timing, backoffMs: [500],
        relayFactory: (u, p) => { const socket = new WebSocket(u, p); sockets.push(socket); return socket as never; } });
      cleanups.push(() => transport.close());
      const controller = await bootstrapRoomDocument(transport, { documentId: initial.id, timeoutMs: 15_000 });
      cleanups.push(() => controller.destroy());
      bind(controller, transport);
      return { transport, controller, sockets };
    };
    const editor = await join();
    role = 'viewer';
    const viewer = await join();
    expect(editor.transport.getStatus().grantedRole).toBe('editor');
    expect(viewer.transport.getStatus().grantedRole).toBe('viewer');
    for (const guest of [editor, viewer]) {
      expect(comparable(guest.controller.getSnapshot().document)).toEqual(comparable(hostController.getSnapshot().document));
      expect(decodedHash(guest.controller.getSnapshot().document.assets['asset:host-image']!)).toBe(decodedHash(initial.assets['asset:host-image']!));
    }

    hostController.dispatch({ type: 'update', changes: [
      { id: 'note:plan', patch: { text: 'Notiz nach dem vollständigen Beitritt' } },
      { id: 'text:details', patch: { text: 'Aktualisierte zweite Seite' } },
    ] }, { actorId: 'actor:host', source: 'human', expectedRevision: hostController.getSnapshot().revision });
    await until(() => [editor, viewer].every(guest => guest.controller.getSnapshot().document.elements.find(element => element.id === 'text:details')?.text === 'Aktualisierte zweite Seite'));

    const additional = largePng('asset:editor-image', 71);
    let editorDeltaBytes = 0;
    const off = editor.controller.on('update', event => { if (event.source === 'human') editorDeltaBytes = event.update.byteLength; });
    cleanups.push(off);
    editor.controller.dispatch({ type: 'add', elements: [createElement('image', { id: 'image:editor', pageId: 'page:details', assetId: additional.id, x: 640, y: 80, width: 1024, height: 896 })], assets: [additional] },
      { actorId: 'actor:editor', source: 'human', expectedRevision: editor.controller.getSnapshot().revision });
    await until(() => {
      if (errors.length) throw new Error(`Document transfer failed: ${errors.join(', ')}`);
      return !!hostController.getSnapshot().document.assets[additional.id] && !!viewer.controller.getSnapshot().document.assets[additional.id];
    });
    expect(editorDeltaBytes).toBeGreaterThan(4 * 1024 * 1024);
    for (const controller of [hostController, viewer.controller]) expect(decodedHash(controller.getSnapshot().document.assets[additional.id]!)).toBe(decodedHash(additional));
    for (const guest of [editor, viewer]) expect(comparable(guest.controller.getSnapshot().document)).toEqual(comparable(hostController.getSnapshot().document));

    await expect(viewer.transport.send('update', Uint8Array.of(1))).rejects.toThrow('ACCESS_DENIED');
    await expect(viewer.transport.send('asset', Uint8Array.of(1))).rejects.toThrow('ACCESS_DENIED');
    const oldBinding = viewer.transport.getStatus().peers[0]!.keyHash;
    viewer.sockets[0]!.terminate();
    await until(() => host.getStatus().peers.length === 1);
    hostController.dispatch({ type: 'rename-page', pageId: 'page:details', name: 'Nach Wiederverbindung' },
      { actorId: 'actor:host', source: 'human', expectedRevision: hostController.getSnapshot().revision });
    await until(() => viewer.transport.getStatus().state === 'ready' && viewer.transport.getStatus().peers[0]?.keyHash !== oldBinding);
    await until(() => {
      if (errors.length) throw new Error(`Reconnect sync failed: ${errors.join(', ')}`);
      return [editor, viewer].every(guest => guest.controller.getSnapshot().document.pages[1]?.name === 'Nach Wiederverbindung');
    }).catch(cause => { throw new Error(`${cause.message}; host=${hostController.getSnapshot().document.pages[1]?.name}; editor=${editor.controller.getSnapshot().document.pages[1]?.name}; viewer=${viewer.controller.getSnapshot().document.pages[1]?.name}`); });
    for (const guest of [editor, viewer]) expect(comparable(guest.controller.getSnapshot().document)).toEqual(comparable(hostController.getSnapshot().document));
    expect(errors).toEqual([]);
  }, 60_000);
});

describe('real document transfers over native HyperDHT', () => {
  it('bootstraps the same rich document and returns a note edit plus a second large PNG over direct streams', async () => {
    cleanups.push(runCleanups);
    const net = await testnet(); // All native nodes in this harness bind 127.0.0.1.
    const hostSide = nativeSide(net), guestSide = nativeSide(net);
    const directKey = (await hostSide.service.hostStart()).publicKey;
    const initial = richDocument();
    const hostController = createCrdtController(initial);
    cleanups.push(() => hostController.destroy());
    const hostKeys = await createHostKeys();
    const sessionId = createSessionId(), expiresAt = Date.now() + 120_000;
    const timing = { heartbeatMs: 1000, timeoutMs: 15_000 };
    const host = createHdhtHostTransport({ sessionId, documentId: initial.id, hostKeys, expiresAt, timing, grantedRole: () => 'editor', direct: { link: hostSide.link, publicKey: directKey } });
    cleanups.push(() => host.close());
    const errors: string[] = [];
    const hostBinding = bindCrdtTransport(hostController, host, undefined, { onError: error => errors.push(`host:${error.message}`) });
    cleanups.push(() => hostBinding.close());
    const invitation: HdhtInvitation = { version: 1, sessionId, hostKey: hostKeyToText(hostKeys), directKey, relayUrl: '', documentId: initial.id, expiresAt };
    const guest = createHdhtGuestTransport({ invitation, pin: host.getPin(), timing, direct: guestSide.link, helpers: false });
    cleanups.push(() => guest.close());
    const fetched = await bootstrapRoomDocument(guest, { documentId: initial.id, timeoutMs: 15_000 });
    cleanups.push(() => fetched.destroy());
    const guestBinding = bindCrdtTransport(fetched, guest, undefined, { onError: error => errors.push(`guest:${error.message}`) });
    cleanups.push(() => guestBinding.close());
    expect(guest.getStatus()).toMatchObject({ state: 'ready', route: 'direct', grantedRole: 'editor' });
    expect(hostController.encodeUpdate().byteLength).toBeGreaterThan(4 * 1024 * 1024);
    expect(comparable(fetched.getSnapshot().document)).toEqual(comparable(hostController.getSnapshot().document));
    expect(decodedHash(fetched.getSnapshot().document.assets['asset:host-image']!)).toBe(decodedHash(initial.assets['asset:host-image']!));

    fetched.dispatch({ type: 'update', changes: [{ id: 'note:plan', patch: { text: 'Direkte gemeinsame Notiz' } }] },
      { actorId: 'actor:guest', source: 'human', expectedRevision: fetched.getSnapshot().revision });
    await until(() => hostController.getSnapshot().document.elements.find(element => element.id === 'note:plan')?.text === 'Direkte gemeinsame Notiz');
    const second = largePng('asset:direct-guest-image', 91);
    let addedBytes = 0;
    cleanups.push(fetched.on('update', event => { if (event.source === 'human') addedBytes = event.update.byteLength; }));
    fetched.dispatch({ type: 'add', elements: [createElement('image', { id: 'image:direct-guest', pageId: 'page:details', assetId: second.id, width: 1024, height: 896 })], assets: [second] },
      { actorId: 'actor:guest', source: 'human', expectedRevision: fetched.getSnapshot().revision });
    await until(() => {
      if (errors.length) throw new Error(`Direct document transfer failed: ${errors.join(', ')}`);
      return !!hostController.getSnapshot().document.assets[second.id];
    });
    expect(addedBytes).toBeGreaterThan(4 * 1024 * 1024);
    expect(decodedHash(hostController.getSnapshot().document.assets[second.id]!)).toBe(decodedHash(second));
    expect(comparable(fetched.getSnapshot().document)).toEqual(comparable(hostController.getSnapshot().document));
    expect(errors).toEqual([]);
  }, 60_000);
});
