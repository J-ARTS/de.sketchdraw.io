import { afterEach, expect, test, vi } from 'vitest';
import type { DesktopBridge } from '@/domain';
import type { CursorPoint, PresenceSnapshot } from '@/collaboration/presence';
import type { PointerInput } from '@/renderer/state/contract';
import { createWhiteboardStore, NOTICE_DURATION_MS } from '@/renderer/state/whiteboard';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.useRealTimers(); });
const bridge: DesktopBridge = { platform: 'electron', saveDocument: async () => ({ status: 'cancelled' }), openDocument: async () => ({ status: 'cancelled' }), exportFile: async () => ({ status: 'cancelled' }), openExternal: async () => {}, onCloseRequested: () => () => {}, respondToClose: async () => {}, onMenuCommand: () => () => {} };
const at = (x: number, y: number): PointerInput => ({ x, y, button: 0, pointerType: 'mouse', shiftKey: false, altKey: false, metaOrCtrl: false, detail: 0 });
function setup() { const store = createWhiteboardStore({ bridge }); cleanups.push(() => store.dispose()); return store; }

test('the session presence is empty without a session and is replaced as a whole', () => {
  const store = setup();
  expect(store.state.presence).toEqual({ participants: [], cursors: [] });
  const presence: PresenceSnapshot = {
    participants: [{ id: 'a'.repeat(12), name: 'Anna', number: 1, role: 'editor', color: 1, state: 'online', self: false }],
    cursors: [{ id: 'a'.repeat(12), pageId: store.state.activePageId, x: 10, y: 20 }],
  };
  store.setPresence(presence);
  expect(store.state.presence).toEqual(presence);
  store.setPresence(null);
  expect(store.state.presence).toEqual({ participants: [], cursors: [] });
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
