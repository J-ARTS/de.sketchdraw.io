import { describe, expect, test } from 'vitest';
import { applyCommand, createDocument, createElement, type SketchDocument, type SketchElement } from '@/domain';
import { bpmnDecoration, lanesOf, planAddLane, poolOf, SWIMLANE, withSwimlaneLayout } from '@/renderer/lib/bpmn';
import { diagramLibrary, diagramTemplate } from '@/renderer/lib/diagram-libraries';
import { planElementPaste } from '@/renderer/state/element-clipboard';

let counter = 0;
const createId = (prefix: string) => `${prefix}:b${counter += 1}`;
function withTemplate(id: string): SketchDocument {
  const document = createDocument('BPMN');
  return applyCommand(document, planElementPaste(diagramTemplate(id)!.build(), document, { x: 600, y: 400 }, createId).command);
}
const pool = (document: SketchDocument): SketchElement => document.elements.find((element) => bpmnDecoration(element)?.role === 'pool')!;
const resize = (document: SketchDocument, id: string, patch: Partial<Pick<SketchElement, 'x' | 'y' | 'width' | 'height'>>): SketchDocument =>
  applyCommand(document, withSwimlaneLayout(document, { type: 'update', changes: [{ id, patch }] }));
/** Lanes fill the pool: same left edge and width, stacked from its top to its bottom without gaps. */
function expectFlush(document: SketchDocument): void {
  const frame = pool(document);
  const lanes = lanesOf(document, frame.id);
  let y = frame.y;
  for (const lane of lanes) {
    expect(lane.x).toBeCloseTo(frame.x + SWIMLANE.strip, 6);
    expect(lane.width).toBeCloseTo(frame.width - SWIMLANE.strip, 6);
    expect(lane.y).toBeCloseTo(y, 6);
    y += lane.height;
  }
  expect(y).toBeCloseTo(frame.y + frame.height, 6);
}

describe('BPMN on ordinary elements (#196)', () => {
  test('the library has many events and activities, each drawn from its metadata', () => {
    const templates = diagramLibrary('bpmn').templates;
    expect(templates.filter((template) => template.section === 'Ereignisse').length).toBeGreaterThanOrEqual(18);
    expect(templates.filter((template) => template.section === 'Aktivitäten').length).toBeGreaterThanOrEqual(12);
    const decoration = (id: string) => bpmnDecoration(diagramTemplate(id)!.build().elements[0]!);
    expect(decoration('bpmn.start')).toMatchObject({ event: 'start', icon: null });
    expect(decoration('bpmn.intermediate')).toMatchObject({ event: 'intermediate' });
    expect(decoration('bpmn.end-error')!.icon!.some((path) => path.fill)).toBe(true);
    expect(decoration('bpmn.message')!.icon!.some((path) => path.fill)).toBe(false);
    expect(decoration('bpmn.message-throw')!.icon!.some((path) => path.fill)).toBe(true);
    expect(decoration('bpmn.user-task')).toMatchObject({ event: null, marker: null });
    expect(decoration('bpmn.user-task')!.icon).not.toBeNull();
    expect(decoration('bpmn.subprocess')!.marker).not.toBeNull();
    expect(decoration('bpmn.task')).toBeNull();
    expect(bpmnDecoration(createElement('rectangle', { id: 'r', metadata: { 'bpmn:role': 'pool' } }))).toBeNull();
  });

  test('a pool template stacks its lanes over the whole width', () => {
    const document = withTemplate('bpmn.pool-three-lanes');
    expect(lanesOf(document, pool(document).id).map((lane) => lane.text)).toEqual(['Bahn 1', 'Bahn 2', 'Bahn 3']);
    expectFlush(document);
    const lane = lanesOf(document, pool(document).id)[1]!;
    expect(poolOf(document, lane)!.id).toBe(pool(document).id);
  });

  test('resizing the pool makes the lanes wider or narrower; the height goes to the outer lanes', () => {
    let document = withTemplate('bpmn.pool-three-lanes');
    const frame = pool(document);
    const before = lanesOf(document, frame.id);
    document = resize(document, frame.id, { width: frame.width + 240, height: frame.height + 100 });
    expectFlush(document);
    let lanes = lanesOf(document, frame.id);
    expect(lanes.map((lane) => lane.height)).toEqual([before[0]!.height, before[1]!.height, before[2]!.height + 100]);
    expect(lanes[0]!.width).toBe(frame.width + 240 - SWIMLANE.strip);

    // Dragging the top left corner: the first lane takes the height, the others stay where they are.
    document = resize(document, frame.id, { x: frame.x - 60, y: frame.y - 40, width: frame.width + 300, height: frame.height + 140 });
    expectFlush(document);
    lanes = lanesOf(document, frame.id);
    expect(lanes[0]!.height).toBe(before[0]!.height + 40);
    expect(lanes[1]!.y).toBe(before[1]!.y);

    // Narrower and far too flat: lanes keep a least height, and the pool cannot get smaller than its lanes.
    document = resize(document, frame.id, { width: 200, height: 50 });
    expectFlush(document);
    expect(lanesOf(document, frame.id).every((lane) => lane.height >= SWIMLANE.minLane)).toBe(true);
  });

  test('resizing a lane moves the lanes below with their content and adjusts the pool', () => {
    let document = withTemplate('bpmn.pool-three-lanes');
    const frame = pool(document);
    const [first, second, third] = lanesOf(document, frame.id);
    document = applyCommand(document, { type: 'add', elements: [createElement('rectangle', { id: 'task', parentId: third!.id, x: third!.x + 60, y: third!.y + 30, width: 120, height: 60 })] });
    document = resize(document, first!.id, { height: first!.height + 80, width: first!.width + 100 });
    expectFlush(document);
    const lanes = lanesOf(document, frame.id);
    expect(lanes[0]!.height).toBe(first!.height + 80);
    expect(lanes[1]!.y).toBe(second!.y + 80);
    expect(pool(document)).toMatchObject({ width: frame.width + 100, height: frame.height + 80 });
    // What is in a moved lane moves with it.
    expect(document.elements.find((element) => element.id === 'task')!.y).toBe(third!.y + 30 + 80);

    // The top edge of a middle lane is the border to the lane above.
    document = resize(document, lanes[1]!.id, { y: lanes[1]!.y - 30, height: lanes[1]!.height + 30 });
    expectFlush(document);
    expect(lanesOf(document, frame.id)[0]!.height).toBe(first!.height + 50);
  });

  test('another lane is added at the bottom, and a pool without lanes gets its first one', () => {
    let document = withTemplate('bpmn.pool-lanes');
    const frame = pool(document);
    const plan = planAddLane(document, lanesOf(document, frame.id)[0], createId, (index) => `Bahn ${index}`)!;
    document = applyCommand(document, plan.command);
    expectFlush(document);
    expect(lanesOf(document, frame.id).map((lane) => lane.text)).toEqual(['Bahn 1', 'Bahn 2', 'Bahn 3']);
    expect(plan.selection).toEqual([lanesOf(document, frame.id)[2]!.id]);

    let plain = withTemplate('bpmn.pool');
    const single = pool(plain);
    plain = applyCommand(plain, { type: 'add', elements: [createElement('rectangle', { id: 'inside', parentId: single.id, x: single.x + 80, y: single.y + 40, width: 100, height: 60 })] });
    plain = applyCommand(plain, planAddLane(plain, single, createId, (index) => `Bahn ${index}`)!.command);
    expectFlush(plain);
    const [lane] = lanesOf(plain, single.id);
    expect(plain.elements.find((element) => element.id === 'inside')!.parentId).toBe(lane!.id);
    expect(planAddLane(plain, createElement('rectangle', { id: 'x' }), createId, String)).toBeNull();
  });

  test('other commands and other elements are left alone', () => {
    const document = withTemplate('bpmn.pool-lanes');
    const move = { type: 'update' as const, changes: [{ id: 'nope', patch: { x: 1 } }] };
    expect(withSwimlaneLayout(document, move)).toBe(move);
    const rename = { type: 'rename' as const, title: 'x' };
    expect(withSwimlaneLayout(document, rename)).toBe(rename);
  });
});
