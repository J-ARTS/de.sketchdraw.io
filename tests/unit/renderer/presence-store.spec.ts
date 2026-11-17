import { afterEach, expect, test, vi } from 'vitest';
import type { DesktopBridge } from '@/domain';
import type { CursorPoint, PresenceSnapshot, SessionParticipant, ViewRect } from '@/collaboration/presence';
import type { KeyInput, PointerInput } from '@/renderer/state/contract';
import { createWhiteboardStore, NOTICE_DURATION_MS } from '@/renderer/state/whiteboard';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.useRealTimers(); });
const bridge: DesktopBridge = { platform: 'electron', saveDocument: async () => ({ status: 'cancelled' }), openDocument: async () => ({ status: 'cancelled' }), exportFile: async () => ({ status: 'cancelled' }), openExternal: async () => {}, onCloseRequested: () => () => {}, respondToClose: async () => {}, onMenuCommand: () => () => {} };
const at = (x: number, y: number): PointerInput => ({ x, y, button: 0, pointerType: 'mouse', shiftKey: false, altKey: false, metaOrCtrl: false, detail: 0 });
function setup() { const store = createWhiteboardStore({ bridge }); cleanups.push(() => store.dispose()); return store; }

test('the session presence is empty without a session and is replaced as a whole', () => {
  const store = setup();
  expect(store.state.presence).toEqual({ participants: [], cursors: [], views: [] });
  const presence: PresenceSnapshot = {
    participants: [{ id: 'a'.repeat(12), name: 'Anna', number: 1, role: 'editor', color: 1, state: 'online', self: false }],
    cursors: [{ id: 'a'.repeat(12), pageId: store.state.activePageId, x: 10, y: 20 }],
    views: [],
  };
  store.setPresence(presence);
  expect(store.state.presence).toEqual(presence);
  store.setPresence(null);
  expect(store.state.presence).toEqual({ participants: [], cursors: [], views: [] });
});

test('the own pointer is reported in document coordinates with its page, and null when it leaves the canvas', () => {
  const store = setup();
  const points: (CursorPoint | null)[] = [];
  const off = store.subscribePointer(point => points.push(point));
  store.pointerMove(at(120, 80));
  expect(points).toEqual([{ pageId: store.state.activePageId, x: 120, y: 80 }]);
  // Zoomed and panned, the same screen position is another place of the drawing.
  store.zoomBy(2, { x: 0, y: 0 }); store.panBy(50, 0);
  store.pointerMove(at(120, 80));
  const { viewport } = store.state;
  expect(points[1]).toEqual({ pageId: store.state.activePageId, x: (120 - viewport.panX) / viewport.zoom, y: (80 - viewport.panY) / viewport.zoom });
  expect(viewport.zoom).not.toBe(1);
  store.pointerLeave();
  expect(points[2]).toBeNull();
  off();
  store.pointerMove(at(1, 1));
  expect(points).toHaveLength(3);
});

test('a message from the session is shown as a notice; an error stays until it is closed', () => {
  vi.useFakeTimers();
  const store = setup();
  store.announce('Anna ist der Session beigetreten.');
  store.announce('Der Gastgeber hat die Session beendet.', 'error');
  expect(store.state.notices.map(notice => [notice.kind, notice.text])).toEqual([['info', 'Anna ist der Session beigetreten.'], ['error', 'Der Gastgeber hat die Session beendet.']]);
  vi.advanceTimersByTime(NOTICE_DURATION_MS + 100);
  expect(store.state.notices.map(notice => notice.text)).toEqual(['Der Gastgeber hat die Session beendet.']);
  store.dismissNotice(store.state.notices[0]!.id);
  expect(store.state.notices).toEqual([]);
});

// --- Following a participant (#223) ---------------------------------------------
const escape: KeyInput = { key: 'Escape', code: 'Escape', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, repeat: false, isComposing: false, scope: 'canvas' };
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const me: SessionParticipant = { id: 'a'.repeat(12), name: 'Jeremy', number: 0, role: 'owner', color: 0, state: 'online', self: true };
const anna: SessionParticipant = { id: 'b'.repeat(12), name: 'Anna', number: 1, role: 'editor', color: 1, state: 'online', self: false };
const ben: SessionParticipant = { id: 'c'.repeat(12), name: '', number: 2, role: 'viewer', color: 2, state: 'reconnecting', self: false };
function session(store: ReturnType<typeof setup>, view: Partial<ViewRect> = {}, people: SessionParticipant[] = [me, anna, ben]): PresenceSnapshot {
  const presence: PresenceSnapshot = { participants: people, cursors: [], views: [{ id: anna.id, pageId: store.state.activePageId, x: 100, y: 50, width: 640, height: 400, ...view }] };
  store.setPresence(presence);
  return presence;
}

test('the own view is reported at once and after every change of what the window shows', async () => {
  const store = setup();
  const views: (ViewRect | null)[] = [];
  const off = store.subscribeView(view => views.push(view));
  expect(views).toEqual([{ pageId: store.state.activePageId, x: 0, y: 0, width: 1280, height: 800 }]);
  store.panBy(-100, -40);
  expect(views.at(-1)).toMatchObject({ x: 100, y: 40, width: 1280, height: 800 });
  store.zoomBy(2, { x: 0, y: 0 });
  expect(views.at(-1)!.width).toBeLessThan(1280);
  store.setViewportSize(640, 400);
  expect(views.at(-1)!.width * store.state.viewport.zoom).toBeCloseTo(640);
  const first = store.state.activePageId;
  store.addPage(); await store.whenIdle(); await settle();
  expect(store.state.activePageId).not.toBe(first);
  expect(views.at(-1)!.pageId).toBe(store.state.activePageId);
  const count = views.length;
  off();
  store.panBy(5, 5);
  expect(views).toHaveLength(count);
});

test('following shows the rectangle the participant sees, fitted into the own window', () => {
  const store = setup();
  session(store);
  store.followParticipant(anna.id);
  expect(store.state.following).toBe(anna.id);
  // 640×400 fills a 1280×800 window at twice the size.
  expect(store.state.viewport).toEqual({ zoom: 2, panX: -200, panY: -100 });
  // In a window of another shape the whole rectangle stays visible, centred.
  store.setViewportSize(1000, 1000);
  expect(store.state.following).toBe(anna.id);
  expect(store.state.viewport.zoom).toBeCloseTo(1000 / 640);
  expect((100 + 320) * store.state.viewport.zoom + store.state.viewport.panX).toBeCloseTo(500);
  expect((50 + 200) * store.state.viewport.zoom + store.state.viewport.panY).toBeCloseTo(500);
  // The participant moves on; the window follows.
  session(store, { x: 1000, y: 2000 });
  expect((1000 + 320) * store.state.viewport.zoom + store.state.viewport.panX).toBeCloseTo(500);
  expect(store.state.following).toBe(anna.id);
});

test('following changes to the page the participant is on', async () => {
  const store = setup();
  const first = store.state.activePageId;
  store.addPage(); await store.whenIdle(); await settle();
  const second = store.state.activePageId;
  expect(second).not.toBe(first);
  session(store, { pageId: second });
  store.followParticipant(anna.id);
  session(store, { pageId: first });
  expect(store.state.activePageId).toBe(first);
  expect(store.state.following).toBe(anna.id);
  // A page that is not part of the document (yet) changes nothing and keeps following.
  session(store, { pageId: 'not-here' });
  expect(store.state.activePageId).toBe(first);
  expect(store.state.following).toBe(anna.id);
});

test('navigating on one\'s own, Escape or choosing nobody ends following', async () => {
  const store = setup();
  session(store);
  for (const stop of [
    () => store.panBy(10, 0), () => store.zoomBy(1.5, { x: 10, y: 10 }), () => store.fitAll(), () => store.addPage(),
    () => { store.handleKeyDown(escape); }, () => store.followParticipant(null),
  ]) {
    session(store, { pageId: store.state.activePageId });
    store.followParticipant(anna.id);
    expect(store.state.following).toBe(anna.id);
    stop(); await store.whenIdle(); await settle();
    expect(store.state.following).toBeNull();
  }
  // Without following, Escape keeps its usual meaning and a report of a view moves nothing.
  const before = { ...store.state.viewport };
  session(store, { x: 9999, pageId: store.state.activePageId });
  expect(store.state.viewport).toEqual(before);
});

test('a device that follows someone offers no view of its own', () => {
  const store = setup();
  const views: (ViewRect | null)[] = [];
  store.subscribeView(view => views.push(view));
  session(store);
  store.followParticipant(anna.id);
  expect(views.at(-1)).toBeNull();
  session(store, { x: 300 });
  expect(views.at(-1)).toBeNull();
  store.followParticipant(null);
  expect(views.at(-1)).toMatchObject({ pageId: store.state.activePageId, width: 640, height: 400 });
});

test('only another connected participant can be followed, and following ends with a message when they are gone', () => {
  const store = setup();
  session(store);
  for (const id of [me.id, ben.id, 'd'.repeat(12)]) { store.followParticipant(id); expect(store.state.following).toBeNull(); }
  store.followParticipant(anna.id);
  session(store, {}, [me, { ...anna, state: 'reconnecting' }]);
  expect(store.state.following).toBeNull();
  expect(store.state.notices.at(-1)?.text).toBe('Anna ist nicht mehr verbunden. Du folgst niemandem mehr.');
  session(store);
  store.followParticipant(anna.id);
  session(store, {}, [me]);
  expect(store.state.following).toBeNull();
  session(store);
  store.followParticipant(anna.id);
  store.setPresence(null);
  expect(store.state.following).toBeNull();
});

test('the running session is known to the workspace and can be ended from there', async () => {
  const store = setup();
  expect(store.state.session).toBeNull();
  await store.endSession();
  let ended = 0;
  store.setSession({ hosting: true, end: () => { ended++; } });
  expect(store.state.session).toEqual({ hosting: true });
  session(store);
  store.followParticipant(anna.id);
  await store.endSession();
  expect(ended).toBe(1);
  store.setSession(null);
  expect(store.state.session).toBeNull();
  expect(store.state.following).toBeNull();
  await store.endSession();
  expect(ended).toBe(1);
});
