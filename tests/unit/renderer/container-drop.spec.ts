import { afterEach, describe, expect, test, vi } from 'vitest';
import type { DesktopBridge } from '@/domain';
import { createWhiteboardStore } from '@/renderer/state/whiteboard';
import type { PointerInput, WhiteboardStore } from '@/renderer/state/contract';
import { createAwsGroupComponentSet, GROUP_METADATA_KEY } from '@/catalog';

// #143: dragging into and out of containers.
const stores: WhiteboardStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.dispose(); });
function setup() {
  const bridge: DesktopBridge = {
    platform: 'electron', openDocument: vi.fn<DesktopBridge['openDocument']>(async () => ({ status: 'cancelled' })),
    saveDocument: vi.fn<DesktopBridge['saveDocument']>(async () => ({ status: 'saved', file: { handleId: 'handle', name: 'test.sketchdraw.json', versionToken: 'v1' } })),
    exportFile: vi.fn<DesktopBridge['exportFile']>(async () => ({ status: 'exported', name: 'test.sketchdraw.json' })),
    openExternal: vi.fn(async () => {}), onCloseRequested: () => () => {},
    respondToClose: vi.fn(async () => {}), onMenuCommand: () => () => {},
  };
  const store = createWhiteboardStore({ bridge }); stores.push(store);
  store.setViewportSize(1000, 700);
  return store;
}
const point = (x: number, y: number): PointerInput => ({ x, y, button: 0, pointerType: 'mouse', shiftKey: false, altKey: false, metaOrCtrl: false, detail: 1 });
async function draw(store: WhiteboardStore, kind: 'rectangle' | 'container', from: [number, number], to: [number, number]) {
  store.setTool(kind); store.pointerDown(point(...from)); store.pointerMove(point(...to)); store.pointerUp(point(...to)); await store.whenIdle();
}
async function drag(store: WhiteboardStore, from: [number, number], to: [number, number], hold = false) {
  store.setTool('select'); store.pointerDown(point(...from)); store.pointerMove(point(...to));
  if (hold) return;
  store.pointerUp(point(...to)); await store.whenIdle();
}
const byKind = (store: WhiteboardStore, kind: string) => store.state.document.elements.filter((element) => element.kind === kind);
const ids = (store: WhiteboardStore) => store.state.document.elements.map((element) => element.id);

describe('dragging into and out of containers', () => {
  async function scene() {
    const store = setup();
    await draw(store, 'container', [100, 100], [400, 300]);
    await draw(store, 'rectangle', [600, 150], [700, 230]);
    return { store, container: byKind(store, 'container')[0]!, rectangle: byKind(store, 'rectangle')[0]! };
  }

  test('releasing a dragged element over a container makes it a child above the container', async () => {
    const { store, container, rectangle } = await scene();
    await drag(store, [650, 190], [250, 200]);
    const moved = byKind(store, 'rectangle')[0]!;
    expect(moved.parentId).toBe(container.id);
    expect(moved.x).toBe(rectangle.x - 400);
    expect(ids(store).indexOf(moved.id)).toBeGreaterThan(ids(store).indexOf(container.id));
  });

  test('an element drawn before the container is lifted above it when adopted', async () => {
    const store = setup();
    await draw(store, 'rectangle', [600, 150], [700, 230]);
    await draw(store, 'container', [100, 100], [400, 300]);
    const [rectangle, container] = [byKind(store, 'rectangle')[0]!, byKind(store, 'container')[0]!];
    expect(ids(store)).toEqual([rectangle.id, container.id]);
    await drag(store, [650, 190], [250, 200]);
    expect(byKind(store, 'rectangle')[0]!.parentId).toBe(container.id);
    expect(ids(store)).toEqual([container.id, rectangle.id]);
  });

  test('the drop target is announced while dragging and cleared afterwards', async () => {
    const { store, container } = await scene();
    await drag(store, [650, 190], [250, 200], true);
    expect(store.state.dropTargetId).toBe(container.id);
    store.pointerMove(point(800, 500));
    expect(store.state.dropTargetId).toBeNull();
    store.pointerMove(point(250, 200));
    store.pointerUp(point(250, 200)); await store.whenIdle();
    expect(store.state.dropTargetId).toBeNull();
  });

  test('dragging a child out onto the free canvas detaches it', async () => {
    const { store, container } = await scene();
    await drag(store, [650, 190], [250, 200]);
    expect(byKind(store, 'rectangle')[0]!.parentId).toBe(container.id);
    const child = byKind(store, 'rectangle')[0]!;
    await drag(store, [child.x + 50, child.y + 40], [800, 500]);
    const detached = byKind(store, 'rectangle')[0]!;
    expect(detached.parentId).toBeUndefined();
    expect(detached.x).toBeGreaterThan(700);
  });

  test('moving inside the same container keeps the parent and a click changes nothing', async () => {
    const { store, container } = await scene();
    await drag(store, [650, 190], [250, 200]);
    const child = byKind(store, 'rectangle')[0]!;
    await drag(store, [child.x + 50, child.y + 40], [child.x + 90, child.y + 70]);
    expect(byKind(store, 'rectangle')[0]!.parentId).toBe(container.id);
    store.setTool('select'); store.pointerDown(point(child.x + 90, child.y + 70)); store.pointerUp(point(child.x + 90, child.y + 70)); await store.whenIdle();
    expect(byKind(store, 'rectangle')[0]!.parentId).toBe(container.id);
  });

  test('a container nests into another one but never into itself or its own children', async () => {
    const store = setup();
    await draw(store, 'container', [100, 100], [500, 400]);
    await draw(store, 'container', [600, 100], [800, 250]);
    const [outer, inner] = byKind(store, 'container');
    await drag(store, [700, 120], [300, 300]);
    expect(byKind(store, 'container').find((element) => element.id === inner!.id)!.parentId).toBe(outer!.id);
    // Dragging the outer container over its own child must not create a cycle.
    const nested = byKind(store, 'container').find((element) => element.id === inner!.id)!;
    await drag(store, [150, 110], [nested.x + 20, nested.y + 20]);
    expect(byKind(store, 'container').find((element) => element.id === outer!.id)!.parentId).toBeUndefined();
  });

  test('undo restores the previous parent and order in one step', async () => {
    const { store, rectangle } = await scene();
    await drag(store, [650, 190], [250, 200]);
    expect(byKind(store, 'rectangle')[0]!.parentId).toBeDefined();
    store.undo(); await store.whenIdle();
    const restored = byKind(store, 'rectangle')[0]!;
    expect(restored.parentId).toBeUndefined();
    expect(restored.x).toBe(rectangle.x);
  });

  test('keyboard nudging never changes the parent', async () => {
    const { store } = await scene();
    store.select([byKind(store, 'rectangle')[0]!.id]);
    for (let step = 0; step < 40; step += 1) store.nudge(-10, 0);
    store.endNudge(); await store.whenIdle();
    expect(byKind(store, 'rectangle')[0]!.parentId).toBeUndefined();
  });
});

describe('placing AWS groups from the library', () => {
  test('a click places the group at the center and a drop inside a container makes it a child', async () => {
    const store = setup();
    const set = createAwsGroupComponentSet();
    await store.insertComponent(set, 'aws.group.region');
    await store.whenIdle();
    const region = byKind(store, 'container')[0]!;
    expect(region).toMatchObject({ metadata: { [GROUP_METADATA_KEY]: 'aws.group.region' }, text: 'Region', width: 360, height: 320, x: 500 - 180, y: 350 - 160 });
    expect(region.parentId).toBeUndefined();

    await store.insertComponent(set, 'aws.group.vpc', { x: 500, y: 350 });
    await store.whenIdle();
    const vpc = byKind(store, 'container')[1]!;
    expect(vpc.parentId).toBe(region.id);
    expect(ids(store).indexOf(vpc.id)).toBeGreaterThan(ids(store).indexOf(region.id));

    await store.insertComponent(set, 'aws.group.private-subnet', { x: 40, y: 40 });
    await store.whenIdle();
    expect(byKind(store, 'container')[2]!.parentId).toBeUndefined();
  });
});
