import { createElement, type ConnectorMarker, type DocumentCommand, type ElementPatch, type ElementStyle, type Point, type SketchElement } from '@/domain';
import { DEFAULT_STYLE, STYLE_BY_KIND } from './constants';
import { CONNECTOR_LABEL_PLACEMENT_KEY, CONNECTOR_LABEL_POSITION_KEY, connectorLabelSize } from './connector-label';

/**
 * Sequence diagrams (#192, #199). A diagram is made of ordinary elements marked in their metadata, so it stays
 * editable, readable as diagram code and visible to agents:
 *
 * - a lifeline is a container with its head (rectangle) and its dashed line (path) as children,
 * - a message is a connector bound to two lifeline containers (or twice to the same one),
 * - an activation is a narrow rectangle inside a lifeline, a fragment (loop, alt, …) a container whose
 *   sections are divided by dashed connectors, a note a rectangle.
 *
 * This file reads such elements into a model (participants left to right, items top to bottom, fragments by
 * what they enclose) and lays a model out again. Every way to change a diagram goes through the same layout,
 * so spacing, activations and numbers always follow from the model.
 */
export const SEQUENCE_ROLE_KEY = 'sequence:role';
export type SequenceRole = 'lifeline' | 'head' | 'line' | 'message' | 'activation' | 'fragment' | 'divider' | 'note';
/** The running number drawn at the start of a message; present on every message of a numbered diagram. */
export const SEQUENCE_NUMBER_KEY = 'sequence:number';
/** The operator of a fragment: loop, alt, opt, par, critical, break or rect. */
export const SEQUENCE_FRAGMENT_KEY = 'sequence:fragment';
/** `actor` on the head of a lifeline draws a stick figure instead of a box. */
export const SEQUENCE_HEAD_KEY = 'sequence:head';
/** Where a note sits: over its lifelines, or left/right of one. */
export const SEQUENCE_NOTE_KEY = 'sequence:note';

export const SEQUENCE_LIFELINE = Object.freeze({ width: 160, height: 420, headHeight: 48, actorHeadHeight: 76, gap: 60, firstMessage: 96, messageStep: 48 });
export const SEQUENCE_LAYOUT = Object.freeze({
  activation: 12, nest: 6, loopWidth: 44, loopHeight: 28,
  step: 48, tightStep: 36, labelRoom: 14,
  fragmentLead: 14, fragmentHeader: 26, fragmentFoot: 16, fragmentPad: 28, emptySection: 22, dividerLead: 12,
  noteLead: 14, notePad: 16, noteReach: 70, foot: 36, minBody: 120,
});

/**
 * The colours of lifelines (#205): a pale fill with a border of the same hue. A new lifeline takes the first
 * one its diagram does not use yet; the activations of a lifeline wear the colour of its head.
 */
export interface SequenceColour { fill: string; stroke: string }
export const SEQUENCE_COLOURS: readonly SequenceColour[] = Object.freeze([
  { fill: '#e7f5ff', stroke: '#1c7ed6' }, { fill: '#ebfbee', stroke: '#2f9e44' }, { fill: '#fff4e6', stroke: '#e8590c' }, { fill: '#f3f0ff', stroke: '#6741d9' },
  { fill: '#e6fcf5', stroke: '#0c8599' }, { fill: '#fff0f6', stroke: '#c2255c' }, { fill: '#fff9db', stroke: '#e67700' }, { fill: '#f1f3f5', stroke: '#495057' },
]);
/** The colour of an activation on an actor's lifeline, whose head has none. */
const PLAIN: SequenceColour = Object.freeze({ fill: '#ffffff', stroke: DEFAULT_STYLE.stroke });

export type SequenceMessageKind = 'sync' | 'async' | 'reply';
export const FRAGMENT_OPERATORS = ['loop', 'alt', 'opt', 'par', 'critical', 'break', 'rect'] as const;
export type FragmentOperator = typeof FRAGMENT_OPERATORS[number];
/** The keyword that starts a further section of a fragment, where it can have one. */
export const FRAGMENT_SECTION_KEYWORD: Readonly<Partial<Record<FragmentOperator, string>>> = Object.freeze({ alt: 'else', par: 'and', critical: 'option' });
export type SequenceNoteSide = 'over' | 'left' | 'right';

export interface SequenceParticipant { id: string; name: string; actor: boolean }
export interface SequenceMessage { type: 'message'; id: string; from: string; to: string; text: string; kind: SequenceMessageKind }
export interface SequenceNote { type: 'note'; id: string; text: string; side: SequenceNoteSide; from: string; to: string }
/** The first section carries the fragment's own condition and no divider; every further one starts at a divider. */
export interface SequenceSection { id: string | null; label: string; items: SequenceItem[] }
export interface SequenceFragment { type: 'fragment'; id: string; operator: FragmentOperator; fill?: string; sections: SequenceSection[] }
export type SequenceItem = SequenceMessage | SequenceNote | SequenceFragment;
export interface SequenceModel { participants: SequenceParticipant[]; items: SequenceItem[]; autonumber: boolean }
export interface SequenceDiagram {
  model: SequenceModel;
  /** Every element that belongs to the diagram, including the parts of its lifelines and fragments. */
  members: Set<string>;
}

const INK = DEFAULT_STYLE.stroke;
const EPSILON = 1e-6;
const near = (a: number, b: number): boolean => Math.abs(a - b) < EPSILON;
const style = (overrides: Partial<ElementStyle> = {}): ElementStyle => ({ ...DEFAULT_STYLE, ...overrides });
export const sequenceRole = (element: Pick<SketchElement, 'metadata'> | undefined): SequenceRole | undefined => element?.metadata?.[SEQUENCE_ROLE_KEY] as SequenceRole | undefined;
const role = (value: SequenceRole): Record<string, string> => ({ [SEQUENCE_ROLE_KEY]: value });
export const isSequenceLifeline = (element: SketchElement | undefined): boolean => element?.kind === 'container' && sequenceRole(element) === 'lifeline';
export const isSequenceFragment = (element: SketchElement | undefined): boolean => element?.kind === 'container' && sequenceRole(element) === 'fragment';
const isMessage = (element: SketchElement): boolean => element.kind === 'connector' && sequenceRole(element) === 'message';
const centreX = (lifeline: Pick<SketchElement, 'x' | 'width'>): number => lifeline.x + lifeline.width / 2;
const isActorHead = (head: Pick<SketchElement, 'metadata'>): boolean => head.metadata?.[SEQUENCE_HEAD_KEY] === 'actor';

/** How a message is drawn says what it is: dashed is a reply, an open arrowhead asynchronous. */
export function messageKind(element: Pick<SketchElement, 'style' | 'endMarker'>): SequenceMessageKind {
  if (element.style.strokeDash === 'dashed' || element.style.strokeDash === 'dotted') return 'reply';
  return element.endMarker === 'line-arrow' ? 'async' : 'sync';
}
const KIND_LOOK: Readonly<Record<SequenceMessageKind, { dash: ElementStyle['strokeDash']; end: ConnectorMarker }>> = Object.freeze({
  sync: { dash: 'solid', end: 'solid-arrow' }, async: { dash: 'solid', end: 'line-arrow' }, reply: { dash: 'dashed', end: 'line-arrow' },
});
export function fragmentOperator(element: Pick<SketchElement, 'metadata'>): FragmentOperator {
  const value = element.metadata?.[SEQUENCE_FRAGMENT_KEY] as FragmentOperator | undefined;
  return value && FRAGMENT_OPERATORS.includes(value) ? value : 'loop';
}

// ───────────────────────────── Reading ─────────────────────────────

interface Box { x: number; y: number; width: number; height: number }
const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * The lifeline an end of a message stands on. An end dragged onto the head, the dashed line or an activation
 * of a lifeline means that lifeline; the layout then attaches it to the lifeline itself.
 */
function lifelineOfEnd(end: SketchElement['from'], byId: ReadonlyMap<string, SketchElement>): { lifeline: SketchElement; y: number } | null {
  const bound = end ? byId.get(end.elementId) : undefined;
  if (!end || !bound) return null;
  const part = sequenceRole(bound);
  const parent = bound.parentId ? byId.get(bound.parentId) : undefined;
  const lifeline = isSequenceLifeline(bound) ? bound : (part === 'head' || part === 'line' || part === 'activation') && isSequenceLifeline(parent) ? parent! : null;
  return lifeline ? { lifeline, y: bound.y + end.anchor.y * bound.height } : null;
}
/** Both lifelines of a message, or null when an end is free or stands on something else. */
export function sequenceMessageEnds(element: SketchElement, byId: ReadonlyMap<string, SketchElement>): { from: SketchElement; to: SketchElement; y: number } | null {
  if (!isMessage(element)) return null;
  const from = lifelineOfEnd(element.from, byId);
  const to = lifelineOfEnd(element.to, byId);
  return from && to ? { from: from.lifeline, to: to.lifeline, y: from.y } : null;
}

/**
 * Lifelines that belong together. Messages join them; a lifeline without any message joins the nearest one
 * beside it, so a copy of a diagram laid over the original stays a diagram of its own.
 */
function lifelineClusters(elements: readonly SketchElement[]): SketchElement[][] {
  const lifelines = elements.filter(isSequenceLifeline);
  const parent = new Map(lifelines.map((lifeline) => [lifeline.id, lifeline.id]));
  const find = (id: string): string => { let at = id; while (parent.get(at) !== at) at = parent.get(at)!; parent.set(id, at); return at; };
  const join = (a: string, b: string): void => { if (parent.has(a) && parent.has(b)) parent.set(find(a), find(b)); };
  const bound = new Set<string>();
  const byId = new Map(elements.map((element) => [element.id, element]));
  for (const element of elements) {
    const ends = sequenceMessageEnds(element, byId);
    if (!ends) continue;
    join(ends.from.id, ends.to.id);
    bound.add(ends.from.id); bound.add(ends.to.id);
  }
  for (const loose of lifelines) {
    if (bound.has(loose.id)) continue;
    let best: SketchElement | null = null;
    let distance = 420;
    for (const other of lifelines) {
      if (other === loose || !(loose.y < other.y + other.height && other.y < loose.y + loose.height)) continue;
      const apart = Math.max(loose.x, other.x) - Math.min(loose.x + loose.width, other.x + other.width);
      if (apart < distance) { best = other; distance = apart; }
    }
    if (best) join(loose.id, best.id);
  }
  const groups = new Map<string, SketchElement[]>();
  for (const lifeline of lifelines) { const key = find(lifeline.id); groups.set(key, [...(groups.get(key) ?? []), lifeline]); }
  return [...groups.values()].map((group) => group.sort((a, b) => centreX(a) - centreX(b)));
}
const areaOf = (lifelines: readonly SketchElement[]): Box => {
  const x = Math.min(...lifelines.map((lifeline) => lifeline.x));
  const y = Math.min(...lifelines.map((lifeline) => lifeline.y));
  return { x, y, width: Math.max(...lifelines.map((lifeline) => lifeline.x + lifeline.width)) - x, height: Math.max(...lifelines.map((lifeline) => lifeline.y + lifeline.height)) - y };
};
const shared = (a: Box, b: Box): number => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

function readCluster(elements: readonly SketchElement[], lifelines: readonly SketchElement[], extras: ReadonlySet<string>, heights?: ReadonlyMap<string, number>): SequenceDiagram {
  const ids = new Set(lifelines.map((lifeline) => lifeline.id));
  const byId = new Map(elements.map((element) => [element.id, element]));
  const members = new Set<string>(ids);
  const heads = new Map<string, SketchElement>();
  for (const element of elements) {
    if (!element.parentId || !ids.has(element.parentId)) continue;
    const part = sequenceRole(element);
    if (part === 'head' || part === 'line' || part === 'activation') members.add(element.id);
    if (part === 'head') heads.set(element.parentId, element);
  }
  const participants: SequenceParticipant[] = lifelines.map((lifeline) => {
    const head = heads.get(lifeline.id);
    return { id: lifeline.id, name: head?.text ?? lifeline.label ?? '', actor: head?.metadata?.[SEQUENCE_HEAD_KEY] === 'actor' };
  });
  type Placed = { y: number; item: SequenceItem };
  const placed: Placed[] = [];
  let numbered = false;
  for (const element of elements) {
    const ends = sequenceMessageEnds(element, byId);
    if (!ends || !ids.has(ends.from.id) || !ids.has(ends.to.id)) continue;
    members.add(element.id);
    if (element.metadata?.[SEQUENCE_NUMBER_KEY]) numbered = true;
    placed.push({ y: heights?.get(element.id) ?? ends.y, item: { type: 'message', id: element.id, from: ends.from.id, to: ends.to.id, text: element.text ?? '', kind: messageKind(element) } });
  }
  for (const element of elements) {
    if (!extras.has(element.id) || sequenceRole(element) !== 'note') continue;
    members.add(element.id);
    const covered = lifelines.filter((lifeline) => centreX(lifeline) >= element.x && centreX(lifeline) <= element.x + element.width);
    const stored = element.metadata?.[SEQUENCE_NOTE_KEY];
    const text = element.text ?? '';
    // A note beside a lifeline names the one it leans on; otherwise it lies over the lifelines it covers.
    const leftOf = lifelines.find((lifeline) => centreX(lifeline) >= element.x + element.width);
    const rightOf = lifelines.filter((lifeline) => centreX(lifeline) <= element.x).at(-1);
    let note: SequenceNote;
    if (stored === 'left' && leftOf) note = { type: 'note', id: element.id, text, side: 'left', from: leftOf.id, to: leftOf.id };
    else if (stored === 'right' && rightOf) note = { type: 'note', id: element.id, text, side: 'right', from: rightOf.id, to: rightOf.id };
    else if (covered.length) note = { type: 'note', id: element.id, text, side: 'over', from: covered[0]!.id, to: covered.at(-1)!.id };
    else if (rightOf) note = { type: 'note', id: element.id, text, side: 'right', from: rightOf.id, to: rightOf.id };
    else note = { type: 'note', id: element.id, text, side: 'left', from: lifelines[0]!.id, to: lifelines[0]!.id };
    placed.push({ y: element.y + element.height / 2, item: note });
  }

  // Fragments nest by their vertical extent; an item belongs to the smallest fragment around its height.
  const frames = elements.filter((element) => extras.has(element.id) && isSequenceFragment(element))
    .sort((a, b) => a.y - b.y || b.height - a.height);
  const nodes = frames.map((frame) => {
    members.add(frame.id);
    const dividers = elements.filter((element) => element.parentId === frame.id && sequenceRole(element) === 'divider').sort((a, b) => a.y - b.y);
    for (const divider of dividers) members.add(divider.id);
    const fragment: SequenceFragment = {
      type: 'fragment', id: frame.id, operator: fragmentOperator(frame),
      ...(fragmentOperator(frame) === 'rect' ? { fill: frame.style.fill } : {}),
      sections: [{ id: null, label: frame.text ?? frame.label ?? '', items: [] }, ...dividers.map((divider) => ({ id: divider.id, label: divider.text ?? '', items: [] as SequenceItem[] }))],
    };
    return { frame, fragment, dividers, children: [] as Placed[] };
  });
  const spans = (outer: SketchElement, from: number, to: number): boolean => outer.y <= from + EPSILON && outer.y + outer.height >= to - EPSILON;
  /** The smallest fragment around a height, or -1. */
  const ownerOfHeight = (y: number): number => {
    let best = -1;
    nodes.forEach(({ frame }, index) => { if (spans(frame, y, y) && (best < 0 || frame.height <= nodes[best]!.frame.height)) best = index; });
    return best;
  };
  /** The smallest fragment that encloses another one; of two equal ones the first encloses the second. */
  const ownerOfFrame = (inner: number): number => {
    const own = nodes[inner]!.frame;
    let best = -1;
    nodes.forEach(({ frame }, index) => {
      if (index === inner || !spans(frame, own.y, own.y + own.height)) return;
      if (!(frame.height > own.height + EPSILON || index < inner)) return;
      if (best < 0 || frame.height <= nodes[best]!.frame.height) best = index;
    });
    return best;
  };
  const top: Placed[] = [];
  const attach = (entry: Placed, owner: number): void => { (owner < 0 ? top : nodes[owner]!.children).push(entry); };
  for (const entry of placed) attach(entry, ownerOfHeight(entry.y));
  nodes.forEach((node, index) => attach({ y: node.frame.y, item: node.fragment }, ownerOfFrame(index)));
  for (const node of nodes) {
    for (const child of node.children.sort((a, b) => a.y - b.y)) {
      const section = node.dividers.filter((divider) => divider.y < child.y).length;
      node.fragment.sections[section]!.items.push(child.item);
    }
  }
  return { model: { participants, items: top.sort((a, b) => a.y - b.y).map((entry) => entry.item), autonumber: numbered }, members };
}

/**
 * Every sequence diagram among the elements of one page. `heights` places single messages by another height
 * than the one their start stands at (a start that was just dragged to another lifeline keeps its row).
 */
export function readSequences(elements: readonly SketchElement[], heights?: ReadonlyMap<string, number>): SequenceDiagram[] {
  const clusters = lifelineClusters(elements);
  if (!clusters.length) return [];
  const areas = clusters.map(areaOf);
  // A fragment or note belongs to the diagram it lies on most.
  const extras = clusters.map(() => new Set<string>());
  for (const element of elements) {
    if (!(isSequenceFragment(element) || (sequenceRole(element) === 'note' && element.kind !== 'connector'))) continue;
    let best = -1;
    let most = 0;
    areas.forEach((area, index) => { const overlap = overlaps(element, area) ? Math.max(shared(element, area), EPSILON) : 0; if (overlap > most) { best = index; most = overlap; } });
    if (best >= 0) extras[best]!.add(element.id);
  }
  return clusters.map((cluster, index) => readCluster(elements, cluster, extras[index]!, heights));
}
/** The sequence diagram an element belongs to. */
export function readSequence(elements: readonly SketchElement[], elementId: string): SequenceDiagram | null {
  return readSequences(elements).find((diagram) => diagram.members.has(elementId)) ?? null;
}

// ───────────────────────────── Model helpers ─────────────────────────────

/** The messages of a model in the order they happen. */
export function sequenceMessages(items: readonly SequenceItem[]): SequenceMessage[] {
  return items.flatMap((item) => item.type === 'message' ? [item] : item.type === 'fragment' ? item.sections.flatMap((section) => sequenceMessages(section.items)) : []);
}
function sequenceSectionIds(items: readonly SequenceItem[]): string[] {
  return items.flatMap((item) => item.type === 'fragment' ? item.sections.flatMap((section) => [...(section.id ? [section.id] : []), ...sequenceSectionIds(section.items)]) : []);
}
/** The list an item sits in and its index there. */
export function locateSequenceItem(items: SequenceItem[], id: string): { list: SequenceItem[]; index: number } | null {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    if (item.id === id) return { list: items, index };
    if (item.type !== 'fragment') continue;
    for (const section of item.sections) {
      if (section.id === id) return { list: section.items, index: -1 };
      const found = locateSequenceItem(section.items, id);
      if (found) return found;
    }
  }
  return null;
}

// ───────────────────────────── Layout ─────────────────────────────

interface Column { id: string; x: number; width: number; head: number }
interface MessageGeometry { from: Point; to: Point; bottom: number; number: string | null }
interface Activation { top: number; bottom: number; depth: number }
interface FragmentGeometry extends Box { dividers: number[] }
interface Layout {
  columns: Map<string, Column>;
  top: number;
  height: number;
  messages: Map<string, MessageGeometry>;
  activations: Map<string, Activation[]>;
  fragments: Map<string, FragmentGeometry>;
  notes: Map<string, Box>;
}
interface Look { fontSize(id: string, fallback: number): number }

const noteHeight = (text: string, fontSize: number): number => Math.max(1, text.split('\n').length) * fontSize * 1.25 + SEQUENCE_LAYOUT.notePad;
const textWidth = (text: string, fontSize: number): number => Math.max(0, ...text.split('\n').map((line) => Array.from(line).length)) * fontSize * 0.6;

function layoutSequence(model: SequenceModel, columns: Map<string, Column>, top: number, look: Look): Layout {
  const L = SEQUENCE_LAYOUT;
  const centre = (id: string): number => { const column = columns.get(id)!; return column.x + column.width / 2; };
  const order = model.participants.map((participant) => participant.id);
  const messages = new Map<string, MessageGeometry>();
  const fragments = new Map<string, FragmentGeometry>();
  const notes = new Map<string, Box>();
  const activations = new Map<string, Activation[]>(order.map((id) => [id, []]));
  /** Open activations per lifeline, innermost last. */
  const open = new Map<string, Activation[]>(order.map((id) => [id, []]));
  const edge = (id: string, side: number): number => {
    const depth = open.get(id)!.length;
    return depth ? centre(id) + (depth - 1) * L.nest + side * L.activation / 2 : centre(id);
  };
  let cursor = top + Math.max(0, ...[...columns.values()].map((column) => column.head));
  let tight = false;
  let count = 0;

  /** Lays the items out below the cursor and returns the horizontal extent they take. */
  const place = (items: readonly SequenceItem[]): [number, number] | null => {
    let extent: [number, number] | null = null;
    const widen = (from: number, to: number): void => { extent = extent ? [Math.min(extent[0], from), Math.max(extent[1], to)] : [from, to]; };
    for (const item of items) {
      if (item.type === 'message') {
        const fontSize = look.fontSize(item.id, 14);
        const label = item.text ? connectorLabelSize(item.text, fontSize) : null;
        const self = item.from === item.to;
        // The text of a call to oneself stands beside its loop and needs no room above it.
        const y = cursor + Math.max(tight ? L.tightStep : L.step, self ? 0 : (label?.height ?? 0) + L.labelRoom);
        tight = false;
        count += 1;
        const number = model.autonumber ? String(count) : null;
        if (self) {
          // Out to the right and back, on the innermost activation; the loop is as tall as its text.
          const tall = Math.max(L.loopHeight, (label?.height ?? 0) - 4);
          const short = open.get(item.from)!.length === 0;
          if (short) { const activation = { top: y - 6, bottom: y + tall + 6, depth: 1 }; activations.get(item.from)!.push(activation); open.get(item.from)!.push(activation); }
          const x = edge(item.from, 1);
          if (short) open.get(item.from)!.pop();
          messages.set(item.id, { from: { x, y }, to: { x, y: y + tall }, bottom: y + tall, number });
          cursor = y + tall;
          widen(x, x + L.loopWidth + 8 + (label?.width ?? 0));
          continue;
        }
        const direction = Math.sign(centre(item.to) - centre(item.from)) || 1;
        const from = edge(item.from, direction);
        if (item.kind === 'sync') {
          const activation = { top: y, bottom: y, depth: open.get(item.to)!.length + 1 };
          activations.get(item.to)!.push(activation);
          open.get(item.to)!.push(activation);
        }
        const to = edge(item.to, -direction);
        if (item.kind === 'reply') { const answered = open.get(item.from)!.pop(); if (answered) answered.bottom = y; }
        messages.set(item.id, { from: { x: from, y }, to: { x: to, y }, bottom: y, number });
        cursor = y;
        const middle = (from + to) / 2;
        widen(Math.min(from, to, middle - (label?.width ?? 0) / 2), Math.max(from, to, middle + (label?.width ?? 0) / 2));
      } else if (item.type === 'note') {
        const fontSize = look.fontSize(item.id, 14);
        const height = noteHeight(item.text, fontSize);
        const wide = Math.max(120, textWidth(item.text, fontSize) + 28);
        const a = centre(item.from);
        const b = centre(item.to);
        const box: Box = item.side === 'over'
          ? (item.from === item.to ? { x: a - Math.max(wide, 2 * L.noteReach) / 2, y: 0, width: Math.max(wide, 2 * L.noteReach), height } : { x: Math.min(a, b) - L.noteReach, y: 0, width: Math.abs(b - a) + 2 * L.noteReach, height })
          : item.side === 'right' ? { x: a + L.activation, y: 0, width: wide, height } : { x: a - L.activation - wide, y: 0, width: wide, height };
        box.y = cursor + L.noteLead;
        notes.set(item.id, box);
        cursor = box.y + height;
        tight = true;
        widen(box.x, box.x + box.width);
      } else {
        cursor += L.fragmentLead;
        const frameTop = cursor;
        const dividers: number[] = [];
        let inner: [number, number] | null = null;
        const header = item.operator === 'rect' ? 8 : L.fragmentHeader;
        item.sections.forEach((section, index) => {
          if (index > 0) { cursor += L.dividerLead; dividers.push(cursor); }
          cursor += index > 0 ? L.fragmentHeader - 4 : header;
          tight = true;
          const before = cursor;
          const taken = place(section.items);
          if (taken) inner = inner ? [Math.min(inner[0], taken[0]), Math.max(inner[1], taken[1])] : taken;
          if (cursor === before) cursor += L.emptySection;
        });
        cursor += L.fragmentFoot;
        tight = false;
        // An empty fragment spans the diagram; otherwise it frames what it holds, and its own heading.
        const span: [number, number] = inner ?? [centre(order[0]!) - 22, centre(order.at(-1)!) + 22];
        const heading = item.operator === 'rect' ? 0 : item.operator.length * 8 + 26 + (item.sections[0]!.label ? textWidth(`[${item.sections[0]!.label}]`, 13) + 16 : 0);
        const x = span[0] - L.fragmentPad;
        const width = Math.max(span[1] + L.fragmentPad - x, heading);
        fragments.set(item.id, { x, y: frameTop, width, height: cursor - frameTop, dividers });
        widen(x, x + width);
      }
    }
    return extent;
  };
  place(model.items);
  // Whatever was never answered stays active to the end.
  for (const stack of open.values()) for (const activation of stack) activation.bottom = Math.max(activation.bottom, cursor + 12);
  for (const list of activations.values()) for (const activation of list) activation.bottom = Math.max(activation.bottom, activation.top + 12);
  const head = Math.max(0, ...[...columns.values()].map((column) => column.head));
  return { columns, top, height: Math.max(cursor + L.foot - top, head + L.minBody), messages, activations, fragments, notes };
}

/**
 * How far apart the centres of two lifelines must be at least, so that the texts between them fit: the text
 * of a message between its two lifelines, the text of a call to oneself and a note beside a lifeline before
 * the next one. `from` and `to` are positions among the participants, `from` left of `to`.
 */
function textRooms(model: SequenceModel, look: Look): Array<{ from: number; to: number; distance: number }> {
  const L = SEQUENCE_LAYOUT;
  const position = new Map(model.participants.map((participant, index) => [participant.id, index]));
  const last = model.participants.length - 1;
  const rooms: Array<{ from: number; to: number; distance: number }> = [];
  const number = model.autonumber ? 24 : 0;
  const walk = (items: readonly SequenceItem[]): void => {
    for (const item of items) {
      if (item.type === 'fragment') { for (const section of item.sections) walk(section.items); continue; }
      const a = position.get(item.from);
      const b = position.get(item.to);
      if (a === undefined || b === undefined || !item.text) continue;
      const fontSize = look.fontSize(item.id, 14);
      if (item.type === 'note') {
        if (item.side === 'over') continue;
        const wide = Math.max(120, textWidth(item.text, fontSize) + 28) + 2 * L.activation + 8;
        if (item.side === 'right' && a < last) rooms.push({ from: a, to: a + 1, distance: wide });
        if (item.side === 'left' && a > 0) rooms.push({ from: a - 1, to: a, distance: wide });
        continue;
      }
      const label = connectorLabelSize(item.text, fontSize).width;
      if (a === b) { if (a < last) rooms.push({ from: a, to: a + 1, distance: L.activation + L.loopWidth + label + 2 * L.activation }); }
      else rooms.push({ from: Math.min(a, b), to: Math.max(a, b), distance: label + 2 * L.activation + number + 8 });
    }
  };
  walk(model.items);
  return rooms;
}

// ───────────────────────────── Elements ─────────────────────────────

/** One lifeline: an invisible container that holds the participant's head and the dashed line below it. */
export function sequenceLifeline(id: string, at: Point, name: string, height: number = SEQUENCE_LIFELINE.height, actor = false, colour: SequenceColour = SEQUENCE_COLOURS[0]!): SketchElement[] {
  const { width } = SEQUENCE_LIFELINE;
  const headHeight = actor ? SEQUENCE_LIFELINE.actorHeadHeight : SEQUENCE_LIFELINE.headHeight;
  return [
    createElement('container', { id, x: at.x, y: at.y, width, height, label: name, metadata: role('lifeline'), style: style({ stroke: 'transparent', strokeWidth: 1, fontSize: 14 }) }),
    createElement('rectangle', {
      id: `${id}:head`, parentId: id, x: at.x, y: at.y, width, height: headHeight, text: name, label: name,
      metadata: { ...role('head'), ...(actor ? { [SEQUENCE_HEAD_KEY]: 'actor' } : {}) },
      style: style(actor ? { textAlign: 'center', fontSize: 16, fill: 'transparent', stroke: 'transparent', textColor: INK } : { textAlign: 'center', fontSize: 16, fill: colour.fill, stroke: colour.stroke, textColor: INK }),
    }),
    createElement('path', { id: `${id}:line`, parentId: id, x: at.x + width / 2, y: at.y + headHeight, width: 0, height: height - headHeight, points: [{ x: 0, y: 0 }, { x: 0, y: height - headHeight }], metadata: role('line'), style: style({ strokeDash: 'dashed', strokeWidth: 1, stroke: '#868e96' }) }),
  ];
}
/** A message that is not attached to lifelines yet, as the library offers it. */
export function freeSequenceMessage(id: string, text: string, kind: SequenceMessageKind, length = 220): SketchElement {
  return createElement('connector', {
    id, x: 0, y: 0, width: length, height: 0, points: [{ x: 0, y: 0 }, { x: length, y: 0 }], connectorRouting: 'straight', startMarker: 'none', endMarker: KIND_LOOK[kind].end,
    text, metadata: { ...role('message'), [CONNECTOR_LABEL_PLACEMENT_KEY]: 'above' }, style: style({ fontSize: 14, strokeDash: KIND_LOOK[kind].dash }),
  });
}
export const FRAGMENT_FILL = 'rgba(77, 171, 247, 0.12)';
/** A fragment frame with its dividers, as the library offers it: `sections` are the labels of the further sections. */
export function sequenceFragmentElements(id: string, box: Box, operator: FragmentOperator, label: string, sections: readonly string[] = []): SketchElement[] {
  const frame = createElement('container', {
    id, ...box, text: label, label: label || operator, metadata: { ...role('fragment'), [SEQUENCE_FRAGMENT_KEY]: operator },
    style: style({ ...STYLE_BY_KIND.container, stroke: operator === 'rect' ? 'transparent' : INK, strokeDash: 'solid', strokeWidth: 1, fontSize: 13, fill: operator === 'rect' ? FRAGMENT_FILL : 'transparent' }),
  });
  const step = box.height / (sections.length + 1);
  return [frame, ...sections.map((text, index) => dividerElement(`${id}:section${index + 1}`, id, box.x, box.y + step * (index + 1), box.width, text))];
}
function dividerElement(id: string, parentId: string, x: number, y: number, width: number, text: string): SketchElement {
  return createElement('connector', {
    id, parentId, x, y, width, height: 0, points: [{ x: 0, y: 0 }, { x: width, y: 0 }], connectorRouting: 'straight', startMarker: 'none', endMarker: 'none',
    ...(text ? { text } : {}), metadata: role('divider'), style: style({ fontSize: 13, strokeDash: 'dashed', strokeWidth: 1 }),
  });
}
export function sequenceNoteElement(id: string, box: Box, text: string, side: SequenceNoteSide = 'over'): SketchElement {
  return createElement('rectangle', { id, ...box, text, label: text, metadata: { ...role('note'), [SEQUENCE_NOTE_KEY]: side }, style: style({ textAlign: 'center', fontSize: 14, fill: '#fff9db', stroke: '#e6b800', strokeWidth: 1, textColor: INK }) });
}

// ───────────────────────────── Planning ─────────────────────────────

export interface SequencePlanOptions {
  /** Where a diagram without lifelines yet starts. */
  origin?: Point;
  pageId?: string;
}
interface Desired { element: SketchElement; existing: SketchElement | undefined }

const samePoints = (a: readonly Point[] | undefined, b: readonly Point[] | undefined): boolean => Boolean(a && b && a.length === b.length && a.every((point, index) => near(point.x, b[index]!.x) && near(point.y, b[index]!.y))) || (!a && !b);
const sameEnd = (a: SketchElement['from'], b: SketchElement['from']): boolean => (!a && !b) || Boolean(a && b && a.elementId === b.elementId && near(a.anchor.x, b.anchor.x) && near(a.anchor.y, b.anchor.y));

/** What has to change on an existing element so that it becomes the desired one. */
function difference(existing: SketchElement, desired: SketchElement): ElementPatch | null {
  const patch: ElementPatch = {};
  for (const key of ['x', 'y', 'width', 'height'] as const) if (!near(existing[key], desired[key])) patch[key] = desired[key];
  if (!samePoints(existing.points, desired.points) && desired.points) patch.points = desired.points;
  if (!sameEnd(existing.from, desired.from) && desired.from) patch.from = desired.from;
  if (!sameEnd(existing.to, desired.to) && desired.to) patch.to = desired.to;
  if ((existing.text ?? '') !== (desired.text ?? '')) patch.text = desired.text ? desired.text : null;
  if ((existing.label ?? '') !== (desired.label ?? '') && desired.label) patch.label = desired.label;
  if ((existing.parentId ?? null) !== (desired.parentId ?? null)) patch.parentId = desired.parentId ?? null;
  for (const key of ['connectorRouting', 'startMarker', 'endMarker'] as const) if (desired[key] && existing[key] !== desired[key]) patch[key] = desired[key] as never;
  const look: Partial<ElementStyle> = {};
  if (existing.style.strokeDash !== desired.style.strokeDash) look.strokeDash = desired.style.strokeDash;
  for (const key of ['fill', 'stroke', 'textColor'] as const) if (existing.style[key] !== desired.style[key] && desired.style[key] !== undefined) look[key] = desired.style[key];
  if (Object.keys(look).length) patch.style = look;
  const metadata: Record<string, string | null> = {};
  for (const key of new Set([...Object.keys(existing.metadata ?? {}), ...Object.keys(desired.metadata ?? {})])) {
    const next = desired.metadata?.[key];
    if (existing.metadata?.[key] !== next) metadata[key] = next ?? null;
  }
  if (Object.keys(metadata).length) patch.metadata = metadata;
  return Object.keys(patch).length ? patch : null;
}

export interface SequencePlan {
  command: DocumentCommand | null;
  /** The elements of the laid-out diagram that are new. */
  added: SketchElement[];
}

/**
 * The command that makes the elements of a page show `model`. `diagram` is the diagram as it is now (its
 * members that the model no longer names are removed); without it everything is created at `origin`.
 * `elements` are the elements of the page in drawing order.
 */
export function planSequence(elements: readonly SketchElement[], diagram: SequenceDiagram | null, model: SequenceModel, options: SequencePlanOptions = {}): SequencePlan {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const L = SEQUENCE_LAYOUT;
  const children = (parentId: string, part: SequenceRole): SketchElement[] => elements.filter((element) => element.parentId === parentId && sequenceRole(element) === part);
  const existingLifelines = model.participants.map((participant) => byId.get(participant.id)).filter((element): element is SketchElement => Boolean(element));
  const top = existingLifelines.length ? Math.min(...existingLifelines.map((lifeline) => lifeline.y)) : options.origin?.y ?? 0;

  const look: Look = { fontSize: (id, fallback) => byId.get(id)?.style.fontSize ?? fallback };
  // Columns: existing lifelines keep their places from left to right, new ones push the rest over, and two
  // lifelines stand at least as far apart as the texts between them need (#202).
  const rooms = textRooms(model, look);
  const centres: number[] = [];
  const slots = existingLifelines.map((lifeline) => lifeline.x).sort((a, b) => a - b);
  const columns = new Map<string, Column>();
  let previous: Column | null = null;
  let shift = 0;
  let slot = 0;
  for (const [index, participant] of model.participants.entries()) {
    const lifeline = byId.get(participant.id);
    const head = lifeline ? children(lifeline.id, 'head')[0] : undefined;
    const width = lifeline?.width ?? SEQUENCE_LIFELINE.width;
    const wanted: number = lifeline ? slots[slot++]! + shift : previous ? previous.x + previous.width + SEQUENCE_LIFELINE.gap : options.origin?.x ?? 0;
    const least: number = previous ? previous.x + previous.width + SEQUENCE_LIFELINE.gap : Number.NEGATIVE_INFINITY;
    const roomy = Math.max(Number.NEGATIVE_INFINITY, ...rooms.filter((room) => room.to === index).map((room) => centres[room.from]! + room.distance - width / 2));
    const x = Math.max(wanted, least, roomy);
    centres.push(x + width / 2);
    if (lifeline && x > wanted) shift += x - wanted;
    // A head keeps the height it was given, unless it just became an actor or stopped being one.
    const standard = participant.actor ? SEQUENCE_LIFELINE.actorHeadHeight : SEQUENCE_LIFELINE.headHeight;
    const column: Column = { id: participant.id, x, width, head: head && isActorHead(head) === participant.actor ? head.height : standard };
    columns.set(participant.id, column);
    previous = column;
  }
  const layout = layoutSequence(model, columns, top, look);
  const pageId = options.pageId ?? existingLifelines[0]?.pageId;
  const onPage = <T extends SketchElement>(element: T): T => (pageId && !element.pageId ? { ...element, pageId } : element);

  const lifelineParts: Desired[] = [];
  const rest: Desired[] = [];
  const want = (list: Desired[], id: string, build: () => SketchElement, change: (existing: SketchElement) => SketchElement): void => {
    const existing = byId.get(id);
    list.push({ existing, element: existing ? change(existing) : onPage(build()) });
  };
  const withMetadata = (existing: SketchElement, changes: Record<string, string | null>): Record<string, string> => {
    const next: Record<string, string> = { ...existing.metadata };
    for (const [key, value] of Object.entries(changes)) { if (value === null) delete next[key]; else next[key] = value; }
    return next;
  };

  // A lifeline that gets a box as its head now (new, or no longer an actor) takes the first colour that no
  // head of the diagram has yet; with all in use the colours start over.
  const usedFills = new Set<string>();
  for (const lifeline of existingLifelines) { const head = children(lifeline.id, 'head')[0]; if (head && !isActorHead(head)) usedFills.add(head.style.fill.toLowerCase()); }
  let turn = usedFills.size;
  const nextColour = (): SequenceColour => {
    const colour = SEQUENCE_COLOURS.find((candidate) => !usedFills.has(candidate.fill)) ?? SEQUENCE_COLOURS[turn % SEQUENCE_COLOURS.length]!;
    usedFills.add(colour.fill);
    turn += 1;
    return colour;
  };

  // Lifelines with head, line and activations.
  for (const participant of model.participants) {
    const column = columns.get(participant.id)!;
    const box = { x: column.x, y: top, width: column.width, height: layout.height };
    const existing = byId.get(participant.id);
    const head = existing ? children(existing.id, 'head')[0] : undefined;
    const keepsHead = Boolean(head && isActorHead(head) === participant.actor);
    const created = sequenceLifeline(participant.id, { x: column.x, y: top }, participant.name, layout.height, participant.actor, keepsHead || participant.actor ? undefined : nextColour());
    // Activations wear the colour of the head; an actor has no box, so its activations stay plain.
    const headStyle = keepsHead ? head!.style : created[1]!.style;
    const worn: SequenceColour = participant.actor || headStyle.fill === 'transparent' ? PLAIN : { fill: headStyle.fill, stroke: headStyle.stroke === 'transparent' ? PLAIN.stroke : headStyle.stroke };
    const line = existing ? children(existing.id, 'line')[0] : undefined;
    want(lifelineParts, participant.id, () => created[0]!, (now) => ({ ...now, ...box, label: participant.name || now.label }));
    const middle = column.x + column.width / 2;
    const length = layout.height - column.head;
    if (head) {
      const turned = isActorHead(head) !== participant.actor;
      lifelineParts.push({ existing: head, element: {
        ...head, x: column.x, y: top, width: column.width, height: column.head, text: participant.name, label: participant.name || head.label,
        metadata: withMetadata(head, { [SEQUENCE_HEAD_KEY]: participant.actor ? 'actor' : null }),
        ...(turned ? { style: { ...head.style, ...created[1]!.style } } : {}),
      } });
    }
    else lifelineParts.push({ existing: undefined, element: onPage(created[1]!) });
    if (line) lifelineParts.push({ existing: line, element: { ...line, x: middle, y: top + column.head, width: 0, height: length, points: [{ x: 0, y: 0 }, { x: 0, y: length }] } });
    else lifelineParts.push({ existing: undefined, element: onPage({ ...created[2]!, y: top + column.head, height: length, points: [{ x: 0, y: 0 }, { x: 0, y: length }] }) });

    const boxes = existing ? children(existing.id, 'activation') : [];
    const taken = new Set(boxes.map((box) => box.id));
    layout.activations.get(participant.id)!.forEach((activation, index) => {
      const geometry = { x: middle - L.activation / 2 + (activation.depth - 1) * L.nest, y: activation.top, width: L.activation, height: activation.bottom - activation.top };
      const now = boxes[index];
      if (now) { rest.push({ existing: now, element: { ...now, ...geometry, style: { ...now.style, ...worn } } }); return; }
      let free = 1;
      while (taken.has(`${participant.id}:activation${free}`) || byId.has(`${participant.id}:activation${free}`)) free += 1;
      const id = `${participant.id}:activation${free}`;
      taken.add(id);
      rest.push({ existing: undefined, element: onPage(createElement('rectangle', { id, parentId: participant.id, ...geometry, metadata: role('activation'), style: style({ ...worn, strokeWidth: 1 }) })) });
    });
  }

  // Fragments below the messages they frame, notes and messages above.
  const anchor = (lifelineId: string, point: Point): Point => {
    const column = columns.get(lifelineId)!;
    return { x: Math.max(0, Math.min(1, (point.x - column.x) / column.width)), y: Math.max(0, Math.min(1, (point.y - top) / layout.height)) };
  };
  const messagesAndNotes: Desired[] = [];
  /** Dividers already named in this plan, so new ones get ids of their own. */
  const sectionIds = new Set(sequenceSectionIds(model.items));
  const walk = (items: readonly SequenceItem[]): void => {
    for (const item of items) {
      if (item.type === 'fragment') {
        const geometry = layout.fragments.get(item.id)!;
        const box = { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height };
        const label = item.sections[0]!.label;
        want(rest, item.id,
          () => { const frame = sequenceFragmentElements(item.id, box, item.operator, label)[0]!; return item.fill ? { ...frame, style: { ...frame.style, fill: item.fill } } : frame; },
          (now) => ({ ...now, ...box, text: label, label: label || item.operator, metadata: withMetadata(now, { [SEQUENCE_FRAGMENT_KEY]: item.operator }), ...(item.fill ? { style: { ...now.style, fill: item.fill } } : {}) }));
        item.sections.slice(1).forEach((section, index) => {
          const y = geometry.dividers[index]!;
          let id = section.id;
          for (let free = index + 1; !id; free += 1) { const candidate = `${item.id}:section${free}`; if (!byId.has(candidate) && !sectionIds.has(candidate)) id = candidate; }
          sectionIds.add(id);
          want(rest, id, () => dividerElement(id, item.id, geometry.x, y, geometry.width, section.label),
            (now) => ({ ...now, parentId: item.id, x: geometry.x, y, width: geometry.width, height: 0, points: [{ x: 0, y: 0 }, { x: geometry.width, y: 0 }], text: section.label }));
        });
        for (const section of item.sections) walk(section.items);
      } else if (item.type === 'note') {
        const box = layout.notes.get(item.id)!;
        want(messagesAndNotes, item.id, () => sequenceNoteElement(item.id, box, item.text, item.side), (now) => ({ ...now, ...box, text: item.text, metadata: withMetadata(now, { [SEQUENCE_NOTE_KEY]: item.side }) }));
      } else {
        const geometry = layout.messages.get(item.id)!;
        const self = item.from === item.to;
        const route = self
          ? [geometry.from, { x: geometry.from.x + L.loopWidth, y: geometry.from.y }, { x: geometry.from.x + L.loopWidth, y: geometry.to.y }, geometry.to]
          : [geometry.from, geometry.to];
        const x = Math.min(...route.map((point) => point.x));
        const y = Math.min(...route.map((point) => point.y));
        const shape = {
          x, y, width: Math.max(...route.map((point) => point.x)) - x, height: Math.max(...route.map((point) => point.y)) - y,
          points: route.map((point) => ({ x: point.x - x, y: point.y - y })),
          from: { elementId: item.from, anchor: anchor(item.from, geometry.from) }, to: { elementId: item.to, anchor: anchor(item.to, geometry.to) },
          connectorRouting: self ? 'elbowed' as const : 'straight' as const,
        };
        // The text of a message stands over its arrow, that of a call to oneself beside its loop.
        const marks: Record<string, string | null> = { [CONNECTOR_LABEL_PLACEMENT_KEY]: self ? 'right' : 'above', [SEQUENCE_NUMBER_KEY]: geometry.number };
        const lookOf = KIND_LOOK[item.kind];
        want(messagesAndNotes, item.id,
          () => { const made = freeSequenceMessage(item.id, item.text, item.kind); return { ...made, ...shape, metadata: withMetadata(made, marks) }; },
          (now) => {
            const restyle = messageKind(now) !== item.kind;
            // A text the user slid along the arrow stays there, unless the arrow became a loop or stopped being one.
            const wasSelf = Boolean(now.from && now.to && now.from.elementId === now.to.elementId);
            const position = wasSelf === self ? now.metadata?.[CONNECTOR_LABEL_POSITION_KEY] ?? null : null;
            return {
              ...now, ...shape, text: item.text,
              ...(restyle ? { endMarker: lookOf.end, style: { ...now.style, strokeDash: lookOf.dash } } : {}),
              metadata: withMetadata(now, { ...marks, [CONNECTOR_LABEL_POSITION_KEY]: position }),
            };
          });
      }
    }
  };
  walk(model.items);

  const desired = [...lifelineParts, ...rest, ...messagesAndNotes];
  const desiredIds = new Set(desired.map((entry) => entry.element.id));
  const deletes = diagram ? [...diagram.members].filter((id) => !desiredIds.has(id) && byId.has(id)) : [];
  const removed = new Set(deletes);
  // Deleting a container deletes what is in it: no need to name those twice.
  const deleteIds = deletes.filter((id) => { const parentId = byId.get(id)?.parentId; return !(parentId && removed.has(parentId)); });

  // A container that moves carries its children along unless they are placed explicitly: place them all.
  const movedParents = new Set(desired.filter((entry) => entry.existing?.kind === 'container' && (!near(entry.existing.x, entry.element.x) || !near(entry.existing.y, entry.element.y))).map((entry) => entry.element.id));
  const changes: Array<{ id: string; patch: ElementPatch }> = [];
  for (const { existing, element } of desired) {
    if (!existing) continue;
    const patch = difference(existing, element) ?? {};
    if (existing.parentId && movedParents.has(existing.parentId)) { patch.x = element.x; patch.y = element.y; }
    if (Object.keys(patch).length) changes.push({ id: existing.id, patch });
  }
  const newLifelineParts = lifelineParts.filter((entry) => !entry.existing).map((entry) => entry.element);
  const newRest = [...rest, ...messagesAndNotes].filter((entry) => !entry.existing).map((entry) => entry.element);
  const commands: DocumentCommand[] = [];
  if (deleteIds.length) commands.push({ type: 'delete', ids: deleteIds });
  if (newLifelineParts.length) commands.push({ type: 'add', elements: newLifelineParts });
  if (changes.length) commands.push({ type: 'update', changes });
  if (newRest.length) commands.push({ type: 'add', elements: newRest });

  // Messages and notes are drawn above activations and fragments, so numbers and arrowheads stay visible and clickable.
  const after = [...elements.filter((element) => !removed.has(element.id) && !(element.parentId && removed.has(element.parentId))).map((element) => element.id), ...newLifelineParts.map((element) => element.id), ...newRest.map((element) => element.id)];
  const upper = new Set(messagesAndNotes.map((entry) => entry.element.id));
  const lower = new Set([...lifelineParts, ...rest].map((entry) => entry.element.id));
  const firstUpper = after.findIndex((id) => upper.has(id));
  let lastLower = -1;
  after.forEach((id, index) => { if (lower.has(id)) lastLower = index; });
  if (firstUpper >= 0 && lastLower > firstUpper) commands.push({ type: 'reorder', ids: [...after.filter((id) => !upper.has(id)), ...after.filter((id) => upper.has(id))] });

  return { command: commands.length === 0 ? null : commands.length === 1 ? commands[0]! : { type: 'batch', commands }, added: [...newLifelineParts, ...newRest] };
}

/** The elements of a new diagram for `model`, as the library inserts them. */
export function buildSequence(model: SequenceModel, origin: Point = { x: 0, y: 0 }): SketchElement[] {
  return planSequence([], null, model, { origin }).added;
}
