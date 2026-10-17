import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createController, createDocument, type DesktopBridge } from '../../../src/domain';
import { createDocumentAuthority } from '../../../src/session';
import { createOwnerSession, createSessionIdentity, acceptInvitation } from '../../../src/collaboration';
import { createWhiteboardStore } from '../../../src/renderer/state/whiteboard';
import type { PointerInput } from '../../../src/renderer/state/contract';
import { RtcDouble } from './rtc-double';

const cleanups: Array<() => void | Promise<void>> = [];
beforeEach(() => { RtcDouble.reset(); vi.stubGlobal('RTCPeerConnection', RtcDouble); });
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); RtcDouble.reset(); vi.unstubAllGlobals(); });
const until = async (condition: () => boolean) => { await vi.waitFor(() => expect(condition()).toBe(true), { timeout: 3000, interval: 5 }); };
const point = (x: number, y: number): PointerInput => ({ x, y, button: 0, pointerType: 'mouse', shiftKey: false, altKey: false, metaOrCtrl: false, detail: 1 });
async function setup() {
  const authority = createDocumentAuthority({ controller: createController(createDocument()) });
  const owner = await createOwnerSession({ authority, identity: await createSessionIdentity() }); cleanups.push(() => owner.close());
  const offer = await owner.createInvitation('editor');
  const pairing = await acceptInvitation(offer.text, { identity: await createSessionIdentity() });
  const review = await owner.acceptAnswer(pairing.answer.text);
  const [guest] = await Promise.all([pairing.confirmOwner(review.comparisonCode), owner.confirmPeer(offer.invitationId, review.comparisonCode)]);
  cleanups.push(() => guest.leave());
  await until(() => guest.getStatus().state === 'ready' && owner.getStatus().peers[0]?.state === 'ready');
  const bridge: DesktopBridge = { platform: 'browser', openDocument: async () => ({ status: 'cancelled' }),
    saveDocument: async () => ({ status: 'cancelled' }), exportFile: async () => ({ status: 'cancelled' }), openExternal: async () => {},
    onCloseRequested: () => () => {}, respondToClose: async () => {}, onMenuCommand: () => () => {} };
  const store = createWhiteboardStore({ bridge }); cleanups.push(() => store.dispose());
  expect(await store.joinGuestSession(guest)).toBe(true);
  return { authority, owner, guest, store };
}

it('resolves a real owner receipt and clears only its retained drawing after the matching mirror arrives', async () => {
  const { store, guest, authority } = await setup();
  const delayed: Array<() => void> = [];
  RtcDouble.drop = (channel, data) => {
    if (channel.pc.id === 1 && data instanceof ArrayBuffer) {
      delayed.push(() => channel.remote?.dispatchEvent(new MessageEvent('message', { data }))); return true;
    }
    return false;
  };
  store.setTool('ellipse'); store.pointerDown(point(380, 450)); store.pointerMove(point(540, 550)); store.pointerUp(point(540, 550));
  await until(() => !!store.state.pendingPeerWrite && delayed.length > 0);
  expect(authority.source.getSnapshot().revision).toBe(1);
  expect(store.state.revision).toBe(0); expect(store.state.draftElement?.kind).toBe('ellipse');
  const id = store.state.pendingPeerWrite!.requestId;
  expect(await guest.gateway.queryOutcome(id)).toMatchObject({ status: 'committed', requestId: id, revision: 1 });
  RtcDouble.drop = undefined; for (const release of delayed) release();
  await until(() => store.state.revision === 1);
  await store.resolvePendingWrite();
  expect(store.state.pendingPeerWrite).toBeNull(); expect(store.state.draftElement).toBeNull();
  expect(store.state.gestureConflict).toBeNull(); expect(store.state.canWrite).toBe(true);
  expect(store.state.document.elements).toHaveLength(1);
});

it('finishes the same drawing when the mirror reaches the store before its signed reply', async () => {
  const { store } = await setup();
  const replies: Array<() => void> = [];
  RtcDouble.drop = (channel, data) => {
    if (channel.pc.id === 1 && typeof data === 'string' && ['result', 'outcome'].includes(JSON.parse(JSON.parse(data).payload).type)) {
      replies.push(() => channel.remote?.dispatchEvent(new MessageEvent('message', { data }))); return true;
    }
    return false;
  };
  store.setTool('ellipse'); store.pointerDown(point(380, 450)); store.pointerMove(point(540, 550)); store.pointerUp(point(540, 550));
  await until(() => store.state.revision === 1 && replies.length > 0);
  expect(store.state.draftElement?.kind).toBe('ellipse');
  RtcDouble.drop = undefined; for (const release of replies) release();
  await store.whenIdle();
  expect(store.state.pendingPeerWrite).toBeNull(); expect(store.state.draftElement).toBeNull();
  expect(store.state.gestureConflict).toBeNull(); expect(store.state.canWrite).toBe(true);
});
