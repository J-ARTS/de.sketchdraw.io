import { afterEach, describe, expect, test, vi } from 'vitest';
import { applyCommand, createController, createDocument, type DesktopBridge, type SketchDocument } from '@/domain';
import { builtInComponentSets, DASHED_CARD_STYLE, instantiateComponent, normalizeResourceCardText, RESOURCE_CARD_COMPONENT_TYPE, RESOURCE_CARD_LOOK_KEY, resourceCardFieldAt, resourceCardFieldBox, resourceCardHeightFor, resourceCardLayout, resourceCardLines, resourceCardLook } from '@/catalog';
import { createWhiteboardStore } from '@/renderer/state/whiteboard';
import type { PointerInput, WhiteboardStore } from '@/renderer/state/contract';

const stores: WhiteboardStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.dispose(); });

const bridge: DesktopBridge = {
  platform: 'electron',
  openDocument: vi.fn<DesktopBridge['openDocument']>(async () => ({ status: 'cancelled' })),
  saveDocument: vi.fn<DesktopBridge['saveDocument']>(async () => ({ status: 'cancelled' })),
  exportFile: vi.fn<DesktopBridge['exportFile']>(async () => ({ status: 'cancelled' })),
  openExternal: vi.fn(async () => {}), onCloseRequested: () => () => {},
  respondToClose: vi.fn(async () => {}), onMenuCommand: () => () => {},
};
const pointer = (x: number, y: number): PointerInput => ({ x, y, button: 0, pointerType: 'mouse', shiftKey: false, altKey: false, metaOrCtrl: false, detail: 0 });

/** A document with one resource card at (100, 100), 360 × 150. */
function withCard(rotation = 0): SketchDocument {
  const document = createDocument('Cards');
  const set = builtInComponentSets.find((entry) => entry.components.some((component) => component.type === RESOURCE_CARD_COMPONENT_TYPE))!;
  const { command } = instantiateComponent(document, { set, type: RESOURCE_CARD_COMPONENT_TYPE, id: 'card:1', pageId: document.pages[0]!.id, at: { x: 100, y: 100 } });
  let next = applyCommand(document, command);
  next = applyCommand(next, { type: 'update', changes: [{ id: 'card:1', patch: { width: 360, height: 150, rotation, text: 'Orders', label: 'Orders', description: 'takes orders' } }] });
  return next;
}
function open(document: SketchDocument): WhiteboardStore {
  const store = createWhiteboardStore({ bridge, controller: createController(document), isMac: false });
  stores.push(store);
  store.setViewportSize(1200, 800);
  return store;
}
const card = (store: WhiteboardStore) => store.state.document.elements.find((element) => element.id === 'card:1')!;
/** Screen point in the middle of a card line (the test viewport is not panned or zoomed). */
function linePoint(store: WhiteboardStore, field: 'title' | 'description'): PointerInput {
  const element = card(store);
  const box = resourceCardFieldBox(element, field);
  return pointer(element.x + box.x + 20, element.y + box.y + box.height / 2);
}
/** A press and release at one point; the store finishes its gesture before the next one starts. */
async function click(store: WhiteboardStore, input: PointerInput): Promise<void> {
  store.pointerDown(input);
  store.pointerUp(input);
  await store.whenIdle();
}

describe('resource card layout (#189)', () => {
  test('both lines sit right of the icon, above the link bar, and are found by their points', () => {
    const element = { width: 360, height: 150, style: { fontSize: 20 } };
    const layout = resourceCardLayout(element);
    expect(layout.footerHeight).toBe(36);
    expect(layout.bodyHeight).toBe(114);
    expect(layout.textX).toBe(20 + layout.iconSize + 18);
    const title = resourceCardFieldBox(element, 'title');
    const description = resourceCardFieldBox(element, 'description');
    expect(title.y + title.height).toBeLessThanOrEqual(description.y + 1);
    expect(description.y + description.height).toBeLessThanOrEqual(layout.bodyHeight);
    expect(title.x + title.width).toBe(360 - 12);

    expect(resourceCardFieldAt(element, { x: title.x + 5, y: title.y + title.height / 2 })).toBe('title');
    expect(resourceCardFieldAt(element, { x: description.x + 5, y: description.y + description.height / 2 })).toBe('description');
    expect(resourceCardFieldAt(element, { x: 30, y: title.y + 5 })).toBeNull();
    expect(resourceCardFieldAt(element, { x: title.x + 5, y: 140 })).toBeNull();
  });
});

describe('resource card text on the canvas (#189)', () => {
  test('the first click selects the card; a click on a line of the selected card edits that line', async () => {
    const store = open(withCard());
    await click(store, linePoint(store, 'title'));
    expect(store.state.selection).toEqual(['card:1']);
    expect(store.state.textEdit).toBeNull();

    await click(store, linePoint(store, 'title'));
    expect(store.state.textEdit).toMatchObject({ elementId: 'card:1', field: 'title', draft: 'Orders' });
    const element = card(store);
    const line = resourceCardFieldBox(element, 'title');
    expect(store.state.textEdit!.box).toEqual({ x: element.x + line.x, y: element.y + line.y, width: line.width, height: line.height });

    store.setTextDraft('Order service');
    expect(store.commitTextEdit()).toBe(true);
    await store.whenIdle();
    expect(store.state.textEdit).toBeNull();
    expect(card(store)).toMatchObject({ text: 'Order service', label: 'Order service', description: 'takes orders' });

    store.undo();
    await store.whenIdle();
    expect(card(store)).toMatchObject({ text: 'Orders', label: 'Orders' });
  });

  test('a drag that starts on the text moves the card instead of editing it', async () => {
    const store = open(withCard());
    await click(store, linePoint(store, 'title'));
    const start = linePoint(store, 'title');
    store.pointerDown(start);
    store.pointerMove(pointer(start.x + 60, start.y + 30));
    store.pointerUp(pointer(start.x + 60, start.y + 30));
    await store.whenIdle();
    expect(store.state.textEdit).toBeNull();
    expect(card(store)).toMatchObject({ x: 160, y: 130 });
  });

  test('a click beside the text of the selected card edits nothing, and a shift click deselects', async () => {
    const store = open(withCard());
    await click(store, pointer(120, 120));
    await click(store, pointer(120, 120));
    expect(store.state.textEdit).toBeNull();
    const shift = { ...linePoint(store, 'title'), shiftKey: true };
    await click(store, shift);
    expect(store.state.textEdit).toBeNull();
    expect(store.state.selection).toEqual([]);
  });

  test('a double click edits the line under the pointer and the name elsewhere on the card', async () => {
    const store = open(withCard());
    store.doubleClick(linePoint(store, 'description'));
    expect(store.state.textEdit).toMatchObject({ field: 'description', draft: 'takes orders' });
    // Line breaks stay (#254); only their spelling is unified and the spaces around them go.
    store.setTextDraft('takes\norders\r\n  quickly  ');
    expect(store.state.textEdit!.draft).toBe('takes\norders\n  quickly  ');
    store.commitTextEdit();
    await store.whenIdle();
    expect(card(store).description).toBe('takes\norders\nquickly');

    store.doubleClick(pointer(110, 110));
    expect(store.state.textEdit).toMatchObject({ field: 'title' });
    expect(store.state.selection).toEqual(['card:1']);
  });

  test('an emptied name keeps the old one; the description can be cleared', async () => {
    const store = open(withCard());
    const revision = store.state.revision;
    store.startTextEdit('card:1', 'title');
    store.setTextDraft('   ');
    store.commitTextEdit();
    await store.whenIdle();
    expect(store.state.textEdit).toBeNull();
    expect(card(store).text).toBe('Orders');
    expect(store.state.revision).toBe(revision);

    store.startTextEdit('card:1', 'description');
    store.setTextDraft('');
    store.commitTextEdit();
    await store.whenIdle();
    expect(card(store).description).toBeUndefined();
  });

  test('a card needs a field, other elements take none, and a turned card is hit in its own coordinates', async () => {
    const store = open(withCard(90));
    store.startTextEdit('card:1');
    expect(store.state.textEdit).toBeNull();

    // Turned by 90°, the line runs downwards: its centre is the rotated centre of the unturned line.
    const element = card(store);
    const line = resourceCardFieldBox(element, 'title');
    const centre = { x: element.x + element.width / 2, y: element.y + element.height / 2 };
    const local = { x: element.x + line.x + line.width / 2 - centre.x, y: element.y + line.y + line.height / 2 - centre.y };
    const turned = pointer(centre.x - local.y, centre.y + local.x);
    await click(store, turned);
    await click(store, turned);
    expect(store.state.textEdit).toMatchObject({ field: 'title', rotation: 90 });
    const box = store.state.textEdit!.box;
    expect(box.x + box.width / 2).toBeCloseTo(turned.x, 5);
    expect(box.y + box.height / 2).toBeCloseTo(turned.y, 5);
  });

  test('a text colour chosen while a line is edited is written with the text', async () => {
    const store = open(withCard());
    store.select(['card:1']);
    store.startTextEdit('card:1', 'title');
    store.setTextDraft('Billing');
    store.setPropertyDraft({ style: { textColor: '#e03131' } });
    store.commitTextEdit();
    await store.whenIdle();
    expect(card(store)).toMatchObject({ text: 'Billing', style: { textColor: '#e03131' } });
    store.undo();
    await store.whenIdle();
    expect(card(store).text).toBe('Orders');
    expect(card(store).style.textColor).toBeUndefined();
  });
});

describe('resource card with several lines (#254)', () => {
  test('a card with one line each is laid out as it always was', () => {
    const element = card(open(withCard()));
    const layout = resourceCardLayout(element);
    // 360 × 150 at font size 20: these numbers are the layout before several lines existed.
    expect(layout).toMatchObject({ look: 'solid', footerHeight: 36, bodyHeight: 114, iconSize: 52, textX: 90, extraHeight: 0 });
    expect(layout.icon).toEqual({ x: 20, y: 31 });
    expect(layout.footer).toEqual({ x: 0, y: 114, width: 360, height: 36 });
    expect(layout.title).toMatchObject({ y: 52, fontSize: 20, lines: 1 });
    expect(layout.description).toMatchObject({ y: 74, fontSize: 13, lines: 1 });
    expect(resourceCardFieldBox(element, 'title')).toEqual({ x: 90, y: 39, width: 258, height: 26 });
  });

  test('lines are what is typed, without empty ones at the end, and stored tidy', () => {
    expect(resourceCardLines('a\nb')).toEqual(['a', 'b']);
    expect(resourceCardLines('a\r\nb  \n\n')).toEqual(['a', 'b']);
    expect(resourceCardLines('a\n\nb')).toEqual(['a', '', 'b']);
    expect(resourceCardLines('')).toEqual(['']);
    expect(resourceCardLines(undefined)).toEqual(['']);
    expect(resourceCardLines(Array.from({ length: 40 }, (_, index) => `line ${index}`).join('\n'))).toHaveLength(12);
    expect(normalizeResourceCardText('  Entry point \r\n  for   all traffic  \n\n')).toBe('Entry point\nfor all traffic');
    expect(normalizeResourceCardText('\n\n')).toBe('');
  });

  test('every further line adds its height; the space around the texts, the icon and the footer stay as they were', () => {
    const one = card(open(withCard()));
    const before = resourceCardLayout(one);
    const height = resourceCardHeightFor(one, { description: 'takes orders\nand ships them\nworldwide' });
    // Two more description lines of 13 × 1.4.
    expect(height).toBeCloseTo(150 + 2 * 18.2, 5);
    const three = { ...one, description: 'takes orders\nand ships them\nworldwide', height };
    const after = resourceCardLayout(three);
    expect(after.description.lines).toBe(3);
    expect(after.footerHeight).toBe(before.footerHeight);
    expect(after.iconSize).toBe(before.iconSize);
    // The first lines keep their distance to the top edge; the last line keeps its distance to the footer.
    expect(after.title.y).toBeCloseTo(before.title.y, 5);
    expect(after.description.y).toBeCloseTo(before.description.y, 5);
    const last = after.description.y + 2 * after.description.lineHeight;
    expect(after.footer.y - last).toBeCloseTo(before.footer.y - before.description.y, 5);
    // The box of the text covers all its lines, and a point in the third line finds the description.
    const box = resourceCardFieldBox(three, 'description');
    expect(box.height).toBeCloseTo(13 * 1.3 + 2 * 18.2, 5);
    expect(resourceCardFieldAt(three, { x: box.x + 10, y: last })).toBe('description');
    // A second title line pushes the description down by a title line.
    const titled = resourceCardLayout({ ...one, text: 'Orders\nService', height: resourceCardHeightFor(one, { text: 'Orders\nService' }) });
    expect(titled.description.y - titled.title.y).toBeCloseTo(before.description.y - before.title.y + 25, 5);
    // Taking the lines away again gives the card its old height, also when the user had made it taller.
    expect(resourceCardHeightFor(three, { description: 'takes orders' })).toBeCloseTo(150, 5);
    expect(resourceCardHeightFor({ ...three, height: height + 40 }, { description: 'takes orders' })).toBeCloseTo(190, 5);
  });

  test('typing lines grows the card at once; taking the text over stores lines and height as one step', async () => {
    const store = open(withCard());
    const shown = () => store.state.displayElements.find((element) => element.id === 'card:1')!;
    store.doubleClick(linePoint(store, 'description'));
    store.setTextDraft('takes orders\nand ships them');
    // The document is untouched while the card on the canvas already has the second line.
    expect(card(store).height).toBe(150);
    expect(shown().height).toBeCloseTo(168.2, 5);
    expect(shown().description).toBe('takes orders\nand ships them');
    store.setTextDraft('takes orders\nand ships them\nworldwide');
    expect(shown().height).toBeCloseTo(186.4, 5);
    store.commitTextEdit();
    await store.whenIdle();
    expect(card(store)).toMatchObject({ description: 'takes orders\nand ships them\nworldwide' });
    expect(card(store).height).toBeCloseTo(186.4, 5);
    expect(store.state.textEdit).toBeNull();
    // One undo takes text and height back together.
    store.undo();
    await store.whenIdle();
    expect(card(store)).toMatchObject({ description: 'takes orders', height: 150 });

    // The name takes lines as well; the label that names the card elsewhere stays one line.
    store.doubleClick(linePoint(store, 'title'));
    store.setTextDraft('Orders\nService');
    expect(shown().height).toBeCloseTo(175, 5);
    store.commitTextEdit();
    await store.whenIdle();
    expect(card(store)).toMatchObject({ text: 'Orders\nService', label: 'Orders Service', height: 175 });
    // Back to one line: the card shrinks again.
    store.doubleClick(linePoint(store, 'title'));
    store.setTextDraft('Orders');
    store.commitTextEdit();
    await store.whenIdle();
    expect(card(store)).toMatchObject({ text: 'Orders', label: 'Orders', height: 150 });
  });

  test('a card saved from its dialog grows with its lines too', async () => {
    const store = open(withCard());
    expect(await store.updateResourceCard('card:1', { text: 'Orders', label: 'Orders', description: 'takes orders\nand ships them' })).toBe(true);
    expect(card(store).height).toBeCloseTo(168.2, 5);
    expect(await store.updateResourceCard('card:1', { text: 'Orders', label: 'Orders', description: null })).toBe(true);
    expect(card(store).height).toBeCloseTo(150, 5);
    expect(card(store).description).toBeUndefined();
  });
});

describe('resource card with a dashed frame (#257)', () => {
  test('the look is a property of the card; the bar of links is set in from the frame', () => {
    const plain = card(open(withCard()));
    expect(resourceCardLook(plain)).toBe('solid');
    const dashed = { ...plain, metadata: { ...plain.metadata, [RESOURCE_CARD_LOOK_KEY]: 'dashed' } };
    expect(resourceCardLook(dashed)).toBe('dashed');
    expect(resourceCardLook({ metadata: { [RESOURCE_CARD_LOOK_KEY]: 'something' } })).toBe('solid');
    const layout = resourceCardLayout(dashed);
    expect(layout.look).toBe('dashed');
    expect(layout.footer).toEqual({ x: 10, y: 104, width: 340, height: 36 });
    // The texts end above the bar.
    expect(layout.bodyHeight).toBe(100);
    expect(layout.description.y + layout.description.fontSize / 2).toBeLessThan(layout.footer.y);
    expect(DASHED_CARD_STYLE.strokeDash).toBe('dashed');
  });
});
