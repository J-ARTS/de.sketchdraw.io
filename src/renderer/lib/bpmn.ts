import { createElement, type DocumentCommand, type ElementPatch, type SketchDocument, type SketchElement } from '@/domain';
import { DEFAULT_STYLE } from './constants';

/**
 * BPMN on top of ordinary elements (#196). Pools and lanes are containers, events are ellipses, activities are
 * rectangles; what makes them BPMN is recorded in their metadata, and the renderer draws the title strip, the
 * double border and the symbols from it. Nothing here changes the domain model.
 */
export const BPMN_ROLE_KEY = 'bpmn:role';
export const BPMN_EVENT_KEY = 'bpmn:event';
export const BPMN_ICON_KEY = 'bpmn:icon';
export const BPMN_ICON_STYLE_KEY = 'bpmn:icon-style';
export const BPMN_MARKER_KEY = 'bpmn:marker';

export type SwimlaneRole = 'pool' | 'lane';
export type BpmnEvent = 'start' | 'intermediate' | 'end';
export type BpmnMarker = 'subprocess' | 'loop' | 'parallel' | 'sequential';

/** Width of the vertical title strip of a pool or lane, and the least height a lane keeps. */
export const SWIMLANE = Object.freeze({ strip: 32, minLane: 60, newLane: 140 });

export interface BpmnIconPath { d: string; fill?: boolean; contrast?: boolean }
/** Symbols in a 24 × 24 box. `fill` paths are filled with the line colour, `contrast` paths drawn in the shape's fill on top. */
export const BPMN_ICONS: Readonly<Record<string, readonly BpmnIconPath[]>> = Object.freeze({
  message: [{ d: 'M4 7h16v10H4z' }, { d: 'M4 7l8 6 8-6' }],
  'message-solid': [{ d: 'M4 7h16v10H4z', fill: true }, { d: 'M4 7l8 6 8-6', contrast: true }],
  timer: [{ d: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z' }, { d: 'M12 7.5V12l3 2' }],
  conditional: [{ d: 'M7 4.5h10v15H7z' }, { d: 'M9.5 8.5h5' }, { d: 'M9.5 12h5' }, { d: 'M9.5 15.5h5' }],
  signal: [{ d: 'M12 5l7.5 13h-15z' }],
  'signal-solid': [{ d: 'M12 5l7.5 13h-15z', fill: true }],
  error: [{ d: 'M6 18l3.5-10 4.5 5 4-8-3.5 11-4.5-5z' }],
  'error-solid': [{ d: 'M6 18l3.5-10 4.5 5 4-8-3.5 11-4.5-5z', fill: true }],
  escalation: [{ d: 'M12 4.5l5.5 14-5.5-5.5-5.5 5.5z' }],
  'escalation-solid': [{ d: 'M12 4.5l5.5 14-5.5-5.5-5.5 5.5z', fill: true }],
  link: [{ d: 'M5 9.5h8V6l6 6-6 6v-3.5H5z' }],
  'link-solid': [{ d: 'M5 9.5h8V6l6 6-6 6v-3.5H5z', fill: true }],
  cancel: [{ d: 'M7 7l10 10' }, { d: 'M17 7L7 17' }],
  terminate: [{ d: 'M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12z', fill: true }],
  user: [{ d: 'M12 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z' }, { d: 'M5 20c0-4 3-6 7-6s7 2 7 6' }],
  service: [{ d: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z' }, { d: 'M12 3.5v3' }, { d: 'M12 17.5v3' }, { d: 'M3.5 12h3' }, { d: 'M17.5 12h3' }, { d: 'M6 6l2.1 2.1' }, { d: 'M15.9 15.9L18 18' }, { d: 'M18 6l-2.1 2.1' }, { d: 'M8.1 15.9L6 18' }],
  script: [{ d: 'M8 4.5h10c-2.5 2.5 2.5 5 0 7.5s2.5 5 0 7.5H8c2.5-2.5-2.5-5 0-7.5s-2.5-5 0-7.5z' }, { d: 'M10 8.5h5' }, { d: 'M10 12h5' }, { d: 'M10 15.5h5' }],
  manual: [{ d: 'M5 13V9.5c0-1 1.5-1 1.5 0V8c0-1 1.5-1 1.5 0v-.8c0-1 1.5-1 1.5 0V8c0-1 1.5-1 1.5 0v5l2-2c.8-.8 2 .3 1.3 1.2L13 17c-1 1.5-2.5 2.5-4.5 2.5C6.5 19.5 5 18 5 16z' }],
  rule: [{ d: 'M4.5 6h15v12h-15z' }, { d: 'M4.5 10h15' }, { d: 'M10 10v8' }],
});
/** Markers at the bottom of an activity, in a 16 × 16 box. */
export const BPMN_MARKERS: Readonly<Record<BpmnMarker, readonly string[]>> = Object.freeze({
  subprocess: ['M2 2h12v12H2z', 'M8 5v6', 'M5 8h6'],
  loop: ['M12.5 8a4.5 4.5 0 1 1-1.7-3.5', 'M11.5 1.5v3.5H8'],
  parallel: ['M4 3v10', 'M8 3v10', 'M12 3v10'],
  sequential: ['M3 4h10', 'M3 8h10', 'M3 12h10'],
});

export interface BpmnDecoration {
  role: SwimlaneRole | null;
  event: BpmnEvent | null;
  icon: readonly BpmnIconPath[] | null;
  marker: readonly string[] | null;
}
/** What the renderer adds to an element, or null for elements without BPMN marks. */
export function bpmnDecoration(element: Pick<SketchElement, 'kind' | 'metadata'>): BpmnDecoration | null {
  const metadata = element.metadata;
  if (!metadata) return null;
  const role = element.kind === 'container' && (metadata[BPMN_ROLE_KEY] === 'pool' || metadata[BPMN_ROLE_KEY] === 'lane') ? metadata[BPMN_ROLE_KEY] as SwimlaneRole : null;
  const event = element.kind === 'ellipse' && ['start', 'intermediate', 'end'].includes(metadata[BPMN_EVENT_KEY] ?? '') ? metadata[BPMN_EVENT_KEY] as BpmnEvent : null;
  const name = metadata[BPMN_ICON_KEY];
  const icon = name ? BPMN_ICONS[metadata[BPMN_ICON_STYLE_KEY] === 'solid' && BPMN_ICONS[`${name}-solid`] ? `${name}-solid` : name] ?? null : null;
  const marker = element.kind === 'rectangle' ? BPMN_MARKERS[metadata[BPMN_MARKER_KEY] as BpmnMarker] ?? null : null;
  return role || event || icon || marker ? { role, event, icon, marker } : null;
}
export function swimlaneRole(element: Pick<SketchElement, 'kind' | 'metadata'> | undefined): SwimlaneRole | null {
  return element ? bpmnDecoration(element)?.role ?? null : null;
}

const INK = DEFAULT_STYLE.stroke;
const swimlaneStyle = () => ({ ...DEFAULT_STYLE, stroke: INK, strokeDash: 'solid' as const, strokeWidth: 1.5, fontSize: 14 });
export function createPool(id: string, box: { x: number; y: number; width: number; height: number }, name: string): SketchElement {
  return createElement('container', { id, ...box, text: name, label: name, metadata: { [BPMN_ROLE_KEY]: 'pool' }, style: swimlaneStyle() });
}
export function createLane(id: string, pool: Pick<SketchElement, 'id' | 'x' | 'width'>, y: number, height: number, name: string): SketchElement {
  return createElement('container', { id, parentId: pool.id, x: pool.x + SWIMLANE.strip, y, width: Math.max(SWIMLANE.strip * 2, pool.width - SWIMLANE.strip), height, text: name, label: name, metadata: { [BPMN_ROLE_KEY]: 'lane' }, style: swimlaneStyle() });
}

/** The lanes of a pool, top to bottom. */
export function lanesOf(document: SketchDocument, poolId: string): SketchElement[] {
  return document.elements.filter((element) => element.parentId === poolId && swimlaneRole(element) === 'lane').sort((a, b) => a.y - b.y);
}
/** The pool a pool or lane belongs to. */
export function poolOf(document: SketchDocument, element: SketchElement | undefined): SketchElement | null {
  const role = swimlaneRole(element);
  if (role === 'pool') return element!;
  const parent = role === 'lane' ? document.elements.find((candidate) => candidate.id === element!.parentId) : undefined;
  return swimlaneRole(parent) === 'pool' ? parent! : null;
}

type Box = { x: number; y: number; width: number; height: number };
type Change = { id: string; patch: ElementPatch };
const boxOf = (element: SketchElement, patch: ElementPatch = {}): Box => ({ x: patch.x ?? element.x, y: patch.y ?? element.y, width: patch.width ?? element.width, height: patch.height ?? element.height });

/** Everything inside the given containers moves down with them. */
function shiftDescendants(document: SketchDocument, shifts: ReadonlyMap<string, number>, changes: Change[]): void {
  const pending = new Map(shifts);
  for (let depth = 0; depth < 16 && pending.size; depth += 1) {
    const next = new Map<string, number>();
    for (const element of document.elements) {
      const dy = element.parentId ? pending.get(element.parentId) : undefined;
      if (!dy) continue;
      changes.push({ id: element.id, patch: { y: element.y + dy } });
      next.set(element.id, dy);
    }
    pending.clear();
    for (const [id, dy] of next) pending.set(id, dy);
  }
}

/**
 * Completes the resize of a pool or of one of its lanes, so that the lanes keep filling the pool: same width,
 * stacked without gaps. Other commands, and pools without lanes, come back unchanged.
 */
export function withSwimlaneLayout(document: SketchDocument, command: DocumentCommand): DocumentCommand {
  if (command.type !== 'update' || command.changes.length !== 1) return command;
  const change = command.changes[0]!;
  const element = document.elements.find((candidate) => candidate.id === change.id);
  const role = swimlaneRole(element);
  const pool = poolOf(document, element);
  if (!element || !role || !pool) return command;
  const lanes = lanesOf(document, pool.id);
  if (!lanes.length) return command;
  const changes: Change[] = [];
  const shifts = new Map<string, number>();
  const place = (lane: SketchElement, box: Box): void => {
    if (box.y !== lane.y) shifts.set(lane.id, box.y - lane.y);
    changes.push({ id: lane.id, patch: box });
  };

  if (role === 'pool') {
    const target = boxOf(pool, change.patch);
    const x = target.x + SWIMLANE.strip;
    const width = Math.max(SWIMLANE.strip * 2, target.width - SWIMLANE.strip);
    // Lanes keep their place; the first one starts with the pool and the last one ends with it.
    const tops = lanes.map((lane) => lane.y);
    tops[0] = target.y;
    for (let index = 1; index < tops.length; index += 1) tops[index] = Math.max(tops[index]!, tops[index - 1]! + SWIMLANE.minLane);
    const bottom = Math.max(target.y + target.height, tops.at(-1)! + SWIMLANE.minLane);
    lanes.forEach((lane, index) => place(lane, { x, y: tops[index]!, width, height: (tops[index + 1] ?? bottom) - tops[index]! }));
    changes.unshift({ id: pool.id, patch: { ...change.patch, x: target.x, y: target.y, width: width + SWIMLANE.strip, height: bottom - target.y } });
  } else {
    const index = lanes.findIndex((lane) => lane.id === element.id);
    const target = boxOf(element, change.patch);
    const width = Math.max(SWIMLANE.strip * 2, target.width);
    const height = Math.max(SWIMLANE.minLane, target.height);
    // The lane above gives or takes the space at the dragged top edge; the lanes below follow the bottom edge.
    const previous = lanes[index - 1];
    const top = previous ? Math.max(previous.y + SWIMLANE.minLane, target.y) : target.y;
    let cursor = top + (previous ? Math.max(SWIMLANE.minLane, target.y + target.height - top) : height);
    lanes.forEach((lane, position) => {
      if (position < index - 1) place(lane, { x: target.x, y: lane.y, width, height: lane.height });
      else if (position === index - 1) place(lane, { x: target.x, y: lane.y, width, height: top - lane.y });
      else if (position === index) changes.push({ id: lane.id, patch: { ...change.patch, x: target.x, y: top, width, height: cursor - top } });
      else { place(lane, { x: target.x, y: cursor, width, height: lane.height }); cursor += lane.height; }
    });
    const poolTop = index === 0 ? top : pool.y;
    changes.unshift({ id: pool.id, patch: { x: target.x - SWIMLANE.strip, y: poolTop, width: width + SWIMLANE.strip, height: cursor - poolTop } });
  }
  shiftDescendants(document, shifts, changes);
  return { type: 'update', changes };
}

export interface SwimlanePlan { command: DocumentCommand; selection: string[] }
/**
 * A new lane at the bottom of the pool of the selection; the pool grows by it. A pool without lanes gets its
 * first lane over its whole area, and what was directly in the pool moves into that lane.
 */
export function planAddLane(document: SketchDocument, selected: SketchElement | undefined, createId: (prefix: string) => string, name: (index: number) => string): SwimlanePlan | null {
  const pool = poolOf(document, selected);
  if (!pool) return null;
  const lanes = lanesOf(document, pool.id);
  const id = createId('container');
  if (!lanes.length) {
    const lane = createLane(id, pool, pool.y, pool.height, name(1));
    const inside = document.elements.filter((element) => element.parentId === pool.id);
    const commands: DocumentCommand[] = [{ type: 'add', elements: [lane] }];
    if (inside.length) commands.push({ type: 'update', changes: inside.map((element) => ({ id: element.id, patch: { parentId: id } })) });
    return { command: commands.length === 1 ? commands[0]! : { type: 'batch', commands }, selection: [id] };
  }
  const last = lanes.at(-1)!;
  const height = Math.max(SWIMLANE.minLane, Math.min(last.height, SWIMLANE.newLane * 2));
  const bottom = last.y + last.height;
  const lane = createLane(id, pool, bottom, height, name(lanes.length + 1));
  return {
    command: { type: 'batch', commands: [{ type: 'update', changes: [{ id: pool.id, patch: { height: bottom + height - pool.y } }] }, { type: 'add', elements: [lane] }] },
    selection: [id],
  };
}
