import { afterEach, expect, test } from 'vitest';
import type { DesktopBridge } from '@/domain';
import type { KeyInput, PointerInput } from '@/renderer/state/contract';
import { createWhiteboardStore } from '@/renderer/state/whiteboard';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
const bridge: DesktopBridge = { platform: 'electron', saveDocument: async () => ({ status: 'cancelled' }), openDocument: async () => ({ status: 'cancelled' }), exportFile: async () => ({ status: 'cancelled' }), openExternal: async () => {}, onCloseRequested: () => () => {}, respondToClose: async () => {}, onMenuCommand: () => () => {} };
const at = (x: number, y: number): PointerInput => ({ x, y, button: 0, pointerType: 'mouse', shiftKey: false, altKey: false, metaOrCtrl: false, detail: 0 });
const escape: KeyInput = { key: 'Escape', code: 'Escape', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, repeat: false, isComposing: false, scope: 'canvas' };
type Store = ReturnType<typeof createWhiteboardStore>;

// Guides while moving (#224): the store snaps the move and offers the lines to draw.
async function twoBoxes(options: Parameters<typeof createWhiteboardStore>[0] = { bridge }) {
  const store = createWhiteboardStore(options); cleanups.push(() => store.dispose());
  store.setViewportSize(1280, 800);
  for (const [from, to] of [[[100, 100], [200, 160]], [[400, 300], [500, 360]]] as const) {
    store.setTool('rectangle');
    store.pointerDown(at(from[0], from[1])); store.pointerMove(at(to[0], to[1])); store.pointerUp(at(to[0], to[1]));
    await store.whenIdle();
  }
  const [first, second] = store.state.document.elements;
  return { store, first: first!, second: second! };
}
const boxOf = (store: Store, id: string) => { const element = store.state.displayElements.find(entry => entry.id === id)!; return { x: element.x, y: element.y, width: element.width, height: element.height }; };

test('a moved element snaps into line with another one and the lines are shown until it is released', async () => {
  const { store, first, second } = await twoBoxes();
  expect(first).toMatchObject({ x: 100, y: 100, width: 100, height: 60 });
  expect(store.state.guides).toEqual([]);
  // Grab the second box in its middle and move it 297 to the left: three short of the first one's left edge.
  store.pointerDown(at(450, 330));
  store.pointerMove(at(153, 330));
  expect(boxOf(store, second.id)).toMatchObject({ x: 100, y: 300 });
  expect(store.state.guides).toEqual([
    { kind: 'align', axis: 'x', at: 100, from: 100, to: 360 },
    { kind: 'align', axis: 'x', at: 200, from: 100, to: 360 },
  ]);
  // Out of reach: the element follows the pointer again and the lines go.
  store.pointerMove(at(170, 330));
  expect(boxOf(store, second.id).x).toBe(120);
  expect(store.state.guides).toEqual([]);
  store.pointerMove(at(152, 331));
  store.pointerUp(at(152, 331));
  await store.whenIdle();
  expect(store.state.guides).toEqual([]);
  expect(store.state.document.elements.find(entry => entry.id === second.id)).toMatchObject({ x: 100, y: 301 });
});

test('the reach is the same on screen at any zoom, Ctrl/Cmd moves freely and the preference switches guides off', async () => {
  const saved: unknown[] = [];
  const { store, second } = await twoBoxes({ bridge, preferences: { load: () => ({ theme: null, canvasBackground: null, language: 'de', smartGuides: true }), save: value => { saved.push(value); return true; } } });
  store.zoomBy(2, { x: 0, y: 0 });
  const zoom = store.state.viewport.zoom;
  const screen = (x: number, y: number) => at(x * zoom + store.state.viewport.panX, y * zoom + store.state.viewport.panY);
  // Five screen pixels away is within reach, whatever that is in the document.
  store.pointerDown(screen(450, 330));
  store.pointerMove({ ...screen(150, 330), x: screen(150, 330).x + 5 });
  expect(boxOf(store, second.id).x).toBe(100);
  // Eight screen pixels are not.
  store.pointerMove({ ...screen(150, 330), x: screen(150, 330).x + 8 });
  expect(boxOf(store, second.id).x).toBeCloseTo(100 + 8 / zoom);
  // With the modifier held nothing snaps and nothing is drawn.
  store.pointerMove({ ...screen(150, 330), x: screen(150, 330).x + 3, metaOrCtrl: true });
  expect(boxOf(store, second.id).x).toBeCloseTo(100 + 3 / zoom);
  expect(store.state.guides).toEqual([]);
  store.handleKeyDown(escape);
  expect(store.state.guides).toEqual([]);

  store.setSmartGuides(false);
  expect(saved.at(-1)).toMatchObject({ smartGuides: false });
  store.pointerDown(screen(450, 330));
  store.pointerMove({ ...screen(150, 330), x: screen(150, 330).x + 3 });
  expect(boxOf(store, second.id).x).toBeCloseTo(100 + 3 / zoom);
  expect(store.state.guides).toEqual([]);
  store.handleKeyDown(escape);
});

test('what moves along is no reference: a container does not snap to its own content, and connectors are ignored', async () => {
  const { store, first, second } = await twoBoxes();
  store.selectAll();
  // Both boxes move as one block; there is nothing else on the page to line up with.
  store.pointerDown(at(150, 130));
  store.pointerMove(at(203, 131));
  expect(store.state.guides).toEqual([]);
  expect(boxOf(store, first.id)).toMatchObject({ x: 153, y: 101 });
  expect(boxOf(store, second.id)).toMatchObject({ x: 453, y: 301 });
  store.handleKeyDown(escape);
});

test('a small first movement does not jump onto a line', async () => {
  const { store, second } = await twoBoxes();
  // Placed freely, two off the line. Selecting it later with a tiny slip of the hand must not pull it onto the line.
  store.pointerDown(at(450, 330)); store.pointerMove({ ...at(152, 330), metaOrCtrl: true }); store.pointerUp({ ...at(152, 330), metaOrCtrl: true }); await store.whenIdle();
  expect(store.state.document.elements.find(entry => entry.id === second.id)!.x).toBe(102);
  store.pointerDown(at(160, 330)); store.pointerMove(at(161, 331));
  expect(store.state.guides).toEqual([]);
  expect(boxOf(store, second.id).x).toBe(103);
  // A deliberate movement does.
  store.pointerMove(at(160, 336));
  expect(boxOf(store, second.id)).toMatchObject({ x: 100, y: 306 });
  expect(store.state.guides.length).toBeGreaterThan(0);
  store.handleKeyDown(escape);
});
