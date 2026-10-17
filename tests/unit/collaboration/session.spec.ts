import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createController, createDocument, createElement, serializeDocument } from '../../../src/domain';
import { createDocumentAuthority } from '../../../src/session';
import { acceptInvitation, createOwnerSession, createSessionIdentity } from '../../../src/collaboration';
import type { GuestSession, OwnerSession, SessionIdentity } from '../../../src/collaboration';
import { sign } from '../../../src/collaboration/crypto';
import { utf8 } from '../../../src/collaboration/primitives';
import { RtcDouble } from './rtc-double';

const closes: Array<() => Promise<void>> = [];
beforeEach(() => { RtcDouble.reset(); vi.stubGlobal('RTCPeerConnection', RtcDouble); });
afterEach(async () => { for (const close of closes.splice(0)) await close().catch(() => undefined); RtcDouble.reset(); vi.unstubAllGlobals(); });
async function until(check: () => boolean) { await vi.waitFor(() => expect(check()).toBe(true), { timeout: 3000, interval: 5 }); }
async function setup(role: 'editor' | 'viewer' = 'editor', document = createDocument('Original')) {
  const controller = createController(document, 7);
  const authority = createDocumentAuthority({ controller });
  const human = authority.bindActor({ actorId: 'owner', source: 'human', grantId: 'ui', grantGeneration: 0, guard: () => ({ allowed: true }) });
  const ownerIdentity = await createSessionIdentity();
  const owner = await createOwnerSession({ authority, identity: ownerIdentity }); closes.push(() => owner.close());
  const guestIdentity = await createSessionIdentity(); const offer = await owner.createInvitation(role);
  const pairing = await acceptInvitation(offer.text, { identity: guestIdentity });
  const review = await owner.acceptAnswer(pairing.answer.text);
  expect(review.comparisonCode).toBe(pairing.review.comparisonCode);
  expect(review.ownerDtlsFingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(review.peerDtlsFingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(review.ownerDtlsFingerprint).toBe(pairing.review.ownerDtlsFingerprint);
  expect(review.peerDtlsFingerprint).toBe(pairing.review.peerDtlsFingerprint);
  expect(review.comparisonCode).toMatch(/^(?:[a-f0-9]{4}-){7}[a-f0-9]{4}$/);
  const [guest] = await Promise.all([pairing.confirmOwner(review.comparisonCode), owner.confirmPeer(offer.invitationId, review.comparisonCode)]);
  closes.push(() => guest.leave());
  await until(() => guest.getStatus().state === 'ready' && owner.getStatus().peers[0]?.state === 'ready');
  return { authority, human, controller, owner, guest, guestIdentity, ownerIdentity };
}
async function write(guest: GuestSession, title: string) {
  const requestId = guest.gateway.nextRequestId()!;
  return guest.gateway.submit({ requestId, expectedRevision: guest.source.getSnapshot().revision,
    action: { kind: 'dispatch', command: { type: 'rename', title } } });
}

describe('P2P production protocol with paired unit-test RTC transport', () => {
  it('requires real factory identities and only configures direct reliable data channels', async () => {
    await expect(createOwnerSession({ authority: createDocumentAuthority({ controller: createController(createDocument()) }),
      identity: { publicKeyBase64Url: '', keyHash: '' } as SessionIdentity })).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    const { guest, owner, authority } = await setup();
    expect(guest.source.getSnapshot()).toEqual(authority.source.getSnapshot());
    for (const pc of RtcDouble.all) expect(pc.config).toEqual({ iceServers: [], iceTransportPolicy: 'all', iceCandidatePoolSize: 0 });
    expect(RtcDouble.all.flatMap(pc => pc.channels).every(c => c.ordered && c.protocol === 'sketchdraw.p2p.v1')).toBe(true);
    await expect(createOwnerSession({ authority, identity: await createSessionIdentity() })).rejects.toMatchObject({ code: 'BUSY' });
    expect(owner.getStatus().confirmedRevision).toBe(7);
  });

  it('does not release a document before both humans confirm and rejects reused pairing answers', async () => {
    const authority = createDocumentAuthority({ controller: createController(createDocument('Private title')) });
    const owner = await createOwnerSession({ authority, identity: await createSessionIdentity() }); closes.push(() => owner.close());
    const offer = await owner.createInvitation('editor'); const pairing = await acceptInvitation(offer.text, { identity: await createSessionIdentity() });
    const review = await owner.acceptAnswer(pairing.answer.text);
    await expect(pairing.confirmOwner('0000')).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    await expect(owner.acceptAnswer(pairing.answer.text)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    const first = pairing.confirmOwner(review.comparisonCode);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(RtcDouble.sent.some(frame => typeof frame.data === 'string' && JSON.parse(JSON.parse(frame.data).payload).type === 'grant')).toBe(false);
    expect(RtcDouble.sent.every(frame => typeof frame.data === 'string')).toBe(true);
    await owner.confirmPeer(offer.invitationId, review.comparisonCode); const guest = await first; closes.push(() => guest.leave());
    await until(() => guest.getStatus().state === 'ready'); expect(guest.source.getSnapshot().document.title).toBe('Private title');
  });

  it('replicates guest and owner writes, deduplicates, and performs owner-side actor undo/redo', async () => {
    const { authority, human, guest } = await setup();
    const input = { requestId: guest.gateway.nextRequestId()!, expectedRevision: 7,
      action: { kind: 'dispatch' as const, command: { type: 'rename' as const, title: 'Guest' } } };
    const one = guest.gateway.submit(input); const two = guest.gateway.submit(structuredClone(input));
    expect(await one).toMatchObject({ status: 'committed', revision: 8 }); expect(await two).toEqual(await one);
    await until(() => guest.source.getSnapshot().revision === 8);
    expect(await guest.gateway.submit(input)).toEqual(await one);
    await human.gateway.submit({ requestId: human.gateway.nextRequestId()!, expectedRevision: 8,
      action: { kind: 'dispatch', command: { type: 'set-metadata', patch: { owner: 'kept' } } } });
    await until(() => guest.source.getSnapshot().revision === 9 && guest.source.getHistoryState().canUndo);
    expect(await guest.gateway.submit({ requestId: guest.gateway.nextRequestId()!, expectedRevision: 9, action: { kind: 'undo' } }))
      .toMatchObject({ status: 'committed', revision: 10 });
    await until(() => guest.source.getSnapshot().revision === 10);
    expect(guest.source.getSnapshot().document).toMatchObject({ title: 'Original', metadata: { owner: 'kept' } });
    expect(await guest.gateway.submit({ requestId: guest.gateway.nextRequestId()!, expectedRevision: 10, action: { kind: 'redo' } }))
      .toMatchObject({ status: 'committed', revision: 11 });
    await until(() => guest.source.getSnapshot().revision === 11);
    expect(guest.source.getSnapshot()).toEqual(authority.source.getSnapshot());
  });

  it('handles no-op, explicit CAS conflicts and viewer denial without imaginary revisions', async () => {
    const { guest, authority } = await setup();
    expect(await write(guest, 'Original')).toMatchObject({ status: 'no-op', revision: 7 });
    expect(await guest.gateway.submit({ requestId: guest.gateway.nextRequestId()!, expectedRevision: 6,
      action: { kind: 'dispatch', command: { type: 'rename', title: 'Stale' } } })).toMatchObject({ code: 'REVISION_CONFLICT', accepted: true });
    expect(authority.source.getSnapshot().revision).toBe(7);
    const viewer = await setup('viewer');
    expect(viewer.guest.gateway.nextRequestId()).toBeNull();
    // Scope is observable in the signed grant; a malicious UI can still try it.
    const grants = RtcDouble.sent.filter(frame => typeof frame.data === 'string').map(frame => JSON.parse(JSON.parse(frame.data as string).payload))
      .filter(message => message.type === 'grant');
    const scope = grants.at(-1).scopes[0].scopeId;
    expect(await viewer.guest.gateway.submit({ requestId: `${scope}:1`, expectedRevision: 7, action: { kind: 'undo' } }))
      .toMatchObject({ code: 'ACCESS_DENIED', accepted: false });
  });

  it('freezes a guest mirror during close preparation, resumes on cancel and never creates a local controller', async () => {
    const { guest, human } = await setup();
    const barrier = await guest.lifecycleGate.beginTransition('close', 2);
    await human.gateway.submit({ requestId: human.gateway.nextRequestId()!, expectedRevision: 7,
      action: { kind: 'dispatch', command: { type: 'add', elements: [createElement('rectangle')] } } });
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(guest.source.getSnapshot().revision).toBe(7);
    expect(guest.lifecycleGate.isCurrent(barrier, 2)).toBe(true);
    expect(guest.lifecycleGate.isCurrent(barrier, 3)).toBe(false);
    guest.lifecycleGate.cancelTransition(barrier.token);
    await until(() => guest.source.getSnapshot().revision === 8);
  });

  it('reconnects the same identity and scopes and retains unknown request outcomes without a second commit', async () => {
    const { guest, owner, guestIdentity, authority } = await setup();
    const oldScope = guest.gateway.nextRequestId()!.slice(0, 32);
    RtcDouble.drop = (_channel, data) => typeof data === 'string' && ['result', 'outcome'].includes(JSON.parse(JSON.parse(data).payload).type);
    const request = { requestId: guest.gateway.nextRequestId()!, expectedRevision: 7,
      action: { kind: 'dispatch' as const, command: { type: 'rename' as const, title: 'Once' } } };
    const pending = guest.gateway.submit(request);
    await until(() => authority.source.getSnapshot().revision === 8);
    RtcDouble.all[0]!.close();
    expect(await pending).toMatchObject({ status: 'outcome-unknown' });
    RtcDouble.drop = undefined;
    const offer = await owner.createInvitation('editor', { resumePeerId: guestIdentity.keyHash });
    const pairing = await guest.acceptReconnectOffer(offer.text); const review = await owner.acceptAnswer(pairing.answer.text);
    const [same] = await Promise.all([pairing.confirmOwner(review.comparisonCode), owner.confirmPeer(offer.invitationId, review.comparisonCode)]);
    expect(same).toBe(guest);
    await until(() => guest.getStatus().state === 'ready' && !guest.getStatus().hasUnresolvedOutcome);
    expect(guest.gateway.nextRequestId()).toBe(`${oldScope}:2`);
    expect(await guest.gateway.queryOutcome(request.requestId)).toMatchObject({ status: 'committed', revision: 8 });
    expect(authority.source.getSnapshot().revision).toBe(8);
  });

  it('revokes every peer synchronously and permits a fresh session on the same authority', async () => {
    const { owner, guest, authority, guestIdentity, human } = await setup();
    await owner.revokePeer(guestIdentity.keyHash);
    await until(() => ['revoked', 'disconnected'].includes(guest.getStatus().state));
    expect(guest.source.getSnapshot().revision).toBe(7);
    const fresh: OwnerSession = await createOwnerSession({ authority, identity: await createSessionIdentity() }); closes.push(() => fresh.close());
    expect(fresh.getStatus().session.sessionId).not.toBe(owner.getStatus().session.sessionId);
    expect(await human.gateway.submit({ requestId: human.gateway.nextRequestId()!, expectedRevision: 7,
      action: { kind: 'dispatch', command: { type: 'rename', title: 'Local' } } })).toMatchObject({ status: 'committed' });
  });
  it('closes every transport after the owner authority has already completed document replacement', async () => {
    const { owner, authority, guest } = await setup();
    await owner.createInvitation('viewer'); // Also close an unanswered pairing.
    const barrier = await authority.lifecycleGate.beginTransition('replace', 0);
    authority.lifecycleGate.completeTransition(barrier.token);
    await expect(owner.close()).resolves.toBeUndefined();
    expect(RtcDouble.all.every(pc => pc.connectionState === 'closed')).toBe(true);
    expect(owner.getStatus()).toMatchObject({ state: 'closed', confirmedRevision: 7 });
    expect(guest.gateway.nextRequestId()).toBeNull();
    await expect(owner.close()).resolves.toBeUndefined();
  });

  it('replays a retained offline range against the confirmed mirror without a replacement snapshot', async () => {
    const { guest, owner, guestIdentity, human, authority } = await setup();
    RtcDouble.all[0]!.close();
    for (const title of ['Offline one', 'Offline two']) {
      expect(await human.gateway.submit({ requestId: human.gateway.nextRequestId()!, expectedRevision: authority.source.getSnapshot().revision,
        action: { kind: 'dispatch', command: { type: 'rename', title } } })).toMatchObject({ status: 'committed' });
    }
    const before = RtcDouble.sent.length;
    const offer = await owner.createInvitation('editor', { resumePeerId: guestIdentity.keyHash });
    const pairing = await guest.acceptReconnectOffer(offer.text); const review = await owner.acceptAnswer(pairing.answer.text);
    await Promise.all([pairing.confirmOwner(review.comparisonCode), owner.confirmPeer(offer.invitationId, review.comparisonCode)]);
    await until(() => guest.getStatus().state === 'ready');
    const messages = RtcDouble.sent.slice(before).filter(frame => typeof frame.data === 'string')
      .map(frame => JSON.parse(JSON.parse(frame.data as string).payload));
    expect(messages.filter(m => m.type === 'checkpoint')).toMatchObject([{ revision: 7, transferId: null }]);
    expect(messages.filter(m => m.type === 'transfer-manifest').every(m => m.manifest.purpose === 'command')).toBe(true);
    expect(guest.source.getSnapshot()).toEqual(authority.source.getSnapshot());
    expect(guest.source.getSnapshot().revision).toBe(9);
  });

  it('falls back to a nonce-bound full checkpoint after offline commit retention is exhausted', async () => {
    const { guest, owner, guestIdentity, human, authority } = await setup();
    RtcDouble.all[0]!.close();
    for (let i = 0; i < 258; i += 1) {
      expect(await human.gateway.submit({ requestId: human.gateway.nextRequestId()!, expectedRevision: authority.source.getSnapshot().revision,
        action: { kind: 'dispatch', command: { type: 'rename', title: `Offline ${i}` } } })).toMatchObject({ status: 'committed' });
    }
    const before = RtcDouble.sent.length;
    const offer = await owner.createInvitation('editor', { resumePeerId: guestIdentity.keyHash });
    const pairing = await guest.acceptReconnectOffer(offer.text); const review = await owner.acceptAnswer(pairing.answer.text);
    await Promise.all([pairing.confirmOwner(review.comparisonCode), owner.confirmPeer(offer.invitationId, review.comparisonCode)]);
    await until(() => guest.getStatus().state === 'ready');
    const messages = RtcDouble.sent.slice(before).filter(frame => typeof frame.data === 'string')
      .map(frame => JSON.parse(JSON.parse(frame.data as string).payload));
    expect(messages.filter(m => m.type === 'transfer-manifest').map(m => m.manifest.purpose)).toEqual(['snapshot']);
    expect(guest.source.getSnapshot()).toEqual(authority.source.getSnapshot());
    expect(guest.source.getSnapshot().revision).toBe(265);
  });

  it('honors the smaller negotiated SCTP frame limit while preserving Unicode', async () => {
    vi.stubGlobal('RTCPeerConnection', class extends RtcDouble {
      constructor(configuration: RTCConfiguration) { super(configuration); this.sctp.maxMessageSize = 4096; }
    });
    const { guest } = await setup();
    const text = 'Grüße 世界 🧭'.repeat(900);
    const element = createElement('text'); element.text = text;
    expect(await guest.gateway.submit({ requestId: guest.gateway.nextRequestId()!, expectedRevision: 7,
      action: { kind: 'dispatch', command: { type: 'add', elements: [element] } } })).toMatchObject({ status: 'committed' });
    await until(() => guest.source.getSnapshot().revision === 8);
    expect(guest.source.getSnapshot().document.elements[0]).toMatchObject({ text });
    expect(RtcDouble.sent.every(frame => (typeof frame.data === 'string' ? utf8.encode(frame.data).length : frame.data.byteLength) <= 4096)).toBe(true);
  });

  it('enforces viewer rights at the owner even when a signed proposal bypasses the guest gateway', async () => {
    const { authority, guestIdentity, guest } = await setup('viewer');
    const grant = RtcDouble.sent.filter(f => typeof f.data === 'string').map(f => JSON.parse(JSON.parse(f.data as string).payload))
      .find(m => m.type === 'grant');
    const control = RtcDouble.all[1]!.channels.find(c => c.label === 'sketchdraw-control-v1')!;
    const message = { version: 1, type: 'proposal', session: grant.session, connectionId: grant.connectionId,
      scopeId: grant.scopes[0].scopeId, clientSequence: 1, requestId: `${grant.scopes[0].scopeId}:1`, expectedRevision: 7,
      kind: 'undo', commandTransferId: null, commandHash: null, digest: '0'.repeat(64) };
    control.send(JSON.stringify(await sign(guestIdentity, message)));
    await until(() => RtcDouble.sent.some(f => typeof f.data === 'string' && JSON.parse(JSON.parse(f.data).payload).type === 'result'));
    const result = RtcDouble.sent.filter(f => typeof f.data === 'string').map(f => JSON.parse(JSON.parse(f.data as string).payload)).find(m => m.type === 'result');
    expect(result.outcome).toMatchObject({ code: 'ACCESS_DENIED', accepted: false });
    expect(authority.source.getSnapshot().revision).toBe(7);
    expect(guest.source.getSnapshot().revision).toBe(7);
  });

  it('rejects a mismatching actual DTLS certificate before any document transfer', async () => {
    const authority = createDocumentAuthority({ controller: createController(createDocument()) });
    const owner = await createOwnerSession({ authority, identity: await createSessionIdentity() }); closes.push(() => owner.close());
    const offer = await owner.createInvitation('editor');
    const pairing = await acceptInvitation(offer.text, { identity: await createSessionIdentity() });
    RtcDouble.all[1]!.sctp.transport.getRemoteCertificates = () => [utf8.encode('wrong certificate').buffer];
    const review = await owner.acceptAnswer(pairing.answer.text);
    await expect(Promise.all([owner.confirmPeer(offer.invitationId, review.comparisonCode), pairing.confirmOwner(review.comparisonCode)]))
      .rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    expect(RtcDouble.sent.some(f => f.data instanceof ArrayBuffer)).toBe(false);
  });

  it('keeps a confirmed mirror unchanged after a corrupted bulk chunk', async () => {
    const { guest, human, authority } = await setup();
    let corrupted = false;
    RtcDouble.drop = (channel, data) => {
      if (!corrupted && channel.pc.id === 1 && data instanceof ArrayBuffer) {
        corrupted = true; const broken = data.slice(0); const bytes = new Uint8Array(broken); bytes[broken.byteLength - 1] = bytes[broken.byteLength - 1]! ^ 1;
        queueMicrotask(() => channel.remote?.dispatchEvent(new MessageEvent('message', { data: broken })));
        return true;
      }
      return false;
    };
    await human.gateway.submit({ requestId: human.gateway.nextRequestId()!, expectedRevision: 7,
      action: { kind: 'dispatch', command: { type: 'rename', title: 'Committed locally' } } });
    await until(() => guest.getStatus().state === 'disconnected');
    expect(authority.source.getSnapshot().revision).toBe(8); expect(guest.source.getSnapshot().revision).toBe(7);
  });

  it('tracks sent unknown requests in the guest barrier without claiming they were saved', async () => {
    const { guest, authority } = await setup();
    RtcDouble.drop = (_channel, data) => typeof data === 'string' && ['result', 'outcome'].includes(JSON.parse(JSON.parse(data).payload).type);
    const requestId = guest.gateway.nextRequestId()!;
    const pending = guest.gateway.submit({ requestId, expectedRevision: 7, action: { kind: 'dispatch', command: { type: 'rename', title: 'Pending reply' } } });
    await until(() => authority.source.getSnapshot().revision === 8);
    const barrier = await guest.lifecycleGate.beginTransition('close', 12);
    expect(barrier.unresolvedRequestIds).toEqual([requestId]);
    const frozen = barrier.snapshot.revision;
    await new Promise(resolve => setTimeout(resolve, 20)); expect(guest.source.getSnapshot().revision).toBe(frozen);
    guest.lifecycleGate.completeTransition(barrier.token);
    expect(await pending).toMatchObject({ status: 'outcome-unknown' });
  });

  it('transfers a valid document within 1 KiB of the 32 MiB limit using bounded chunks', async () => {
    const document = createDocument('Large');
    document.assets.pixel = { id: 'pixel', mimeType: 'image/png', name: 'pixel.png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS9sAAAAASUVORK5CYII=' };
    document.elements.push(createElement('image', { assetId: 'pixel' }));
    for (let i = 0; i < 670; i += 1) document.metadata[`entry${i}`] = 'x'.repeat(50000);
    const before = utf8.encode(serializeDocument(document)).length;
    const target = 32 * 1024 * 1024 - 1024;
    document.metadata.last = 'x'.repeat(target - before - 16);
    const size = utf8.encode(serializeDocument(document)).length;
    expect(size).toBeGreaterThan(31.9 * 1024 * 1024); expect(size).toBeLessThanOrEqual(32 * 1024 * 1024);
    const { guest, authority } = await setup('editor', document);
    expect(guest.source.getSnapshot().document.metadata.last).toBe(document.metadata.last);
    expect(serializeDocument(guest.source.getSnapshot().document)).toBe(serializeDocument(authority.source.getSnapshot().document));
    const chunks = RtcDouble.sent.filter(frame => frame.data instanceof ArrayBuffer);
    expect(chunks.length).toBeGreaterThan(2000);
    expect(chunks.every(frame => (frame.data as ArrayBuffer).byteLength <= 16384)).toBe(true);
  }, 20000);

});
