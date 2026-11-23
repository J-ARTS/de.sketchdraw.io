import { createElement, routeBoundConnector, type ConnectorMarker, type DocumentCommand, type ElementPatch, type ElementStyle, type SketchElement } from '@/domain';
import { BPMN_EVENT_KEY, BPMN_ICON_KEY, BPMN_ICON_STYLE_KEY, BPMN_MARKER_KEY, BPMN_ROLE_KEY, SWIMLANE, createLane, createPool, swimlaneRole } from './bpmn';
import { DEFAULT_STYLE } from './constants';
import { BPMN_ACTIVITY_TYPES, BPMN_EVENT_TYPES, createFlowNode, type FlowShape } from './diagram-libraries';
import { sequenceRole } from './sequence-model';

/**
 * A process as a graph (#206): shapes joined by arrows, in pools and lanes. This is what a BPMN diagram on
 * the canvas says, read from its ordinary elements, and what its Mermaid `flowchart` code says. Unlike a
 * sequence diagram a process has no layout of its own: people place its shapes. Applying a changed model
 * therefore only touches what changed and puts new shapes beside the ones they follow.
 */
export type { FlowShape };
export type FlowEdgeKind = 'flow' | 'message' | 'association' | 'line';
export type FlowDirection = 'LR' | 'TD';
export interface FlowNode { id: string; shape: FlowShape; type: string | null; text: string; group: string | null }
export interface FlowGroup { id: string; text: string; parent: string | null }
export interface FlowEdge {
  from: string; to: string; text: string; kind: FlowEdgeKind;
  /** An arrowhead at both ends of a sequence or message flow (`<-->`, `<-.->`). Without it the start has the look of its kind (#292). */
  both?: boolean;
}
export interface FlowModel { direction: FlowDirection; groups: FlowGroup[]; nodes: FlowNode[]; edges: FlowEdge[] }
export interface FlowDiagram {
  model: FlowModel;
  /** The element behind each node and group, by the id the code uses for it. */
  elementOf: Map<string, string>;
  /** The connector behind each edge of the model, in the same order. */
  edgeIds: string[];
  members: Set<string>;
}
/** The id the code uses for an element, remembered so that it means the same element next time. */
export const FLOW_ID_KEY = 'flow:id';
const FLOW_ID = /^[A-Za-z_][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)*$/;

interface Box { x: number; y: number; width: number; height: number }
const boxOf = (element: SketchElement): Box => ({ x: element.x, y: element.y, width: element.width, height: element.height });
const overlap = (a: Box, b: Box, margin: number): boolean => a.x < b.x + b.width + margin && b.x < a.x + a.width + margin && a.y < b.y + b.height + margin && b.y < a.y + a.height + margin;

/** What kind of node an element is, or null when it is none (text, images, tables, parts of a sequence diagram, …). */
export function flowNodeKind(element: SketchElement): { shape: FlowShape; type: string | null } | null {
  if (sequenceRole(element)) return null;
  const metadata = element.metadata ?? {};
  if (element.kind === 'ellipse') {
    const kind = metadata[BPMN_EVENT_KEY];
    if (kind !== 'start' && kind !== 'intermediate' && kind !== 'end') return { shape: 'round', type: null };
    const solid = metadata[BPMN_ICON_STYLE_KEY] === 'solid';
    const type = Object.entries(BPMN_EVENT_TYPES).find(([, entry]) => entry.kind === kind && (entry.icon ?? '') === (metadata[BPMN_ICON_KEY] ?? '') && entry.solid === solid)?.[0];
    return { shape: 'event', type: type ?? kind };
  }
  if (element.kind === 'diamond') return { shape: 'gateway', type: null };
  if (element.kind === 'component') return { shape: 'box', type: null };
  if (element.kind !== 'rectangle') return null;
  if (element.shapeVariant === 'cylinder') return { shape: 'store', type: null };
  if (element.shapeVariant === 'note') return { shape: 'data', type: null };
  const marked = Boolean(metadata[BPMN_ICON_KEY] || metadata[BPMN_MARKER_KEY]);
  if (element.shapeVariant !== 'rounded' && !marked) return { shape: 'box', type: null };
  const solid = metadata[BPMN_ICON_STYLE_KEY] === 'solid';
  const thick = element.style.strokeWidth >= 4;
  const dotted = element.style.strokeDash === 'dotted';
  const type = Object.entries(BPMN_ACTIVITY_TYPES).find(([, options]) => (options.icon ?? '') === (metadata[BPMN_ICON_KEY] ?? '') && Boolean(options.solid) === solid
    && (options.marker ?? '') === (metadata[BPMN_MARKER_KEY] ?? '') && ((options.look?.strokeWidth ?? 0) >= 4) === thick && (options.look?.strokeDash === 'dotted') === dotted)?.[0];
  return { shape: 'task', type: type && type !== 'task' ? type : null };
}
const isGroup = (element: SketchElement): boolean => element.kind === 'container' && !sequenceRole(element);
const isFlowConnector = (element: SketchElement): boolean => element.kind === 'connector' && !sequenceRole(element);
function edgeKind(element: SketchElement): FlowEdgeKind {
  const broken = element.style.strokeDash === 'dashed' || element.style.strokeDash === 'dotted';
  const arrow = Boolean(element.endMarker && element.endMarker !== 'none');
  return broken ? (arrow ? 'message' : 'association') : arrow ? 'flow' : 'line';
}
/** A marker that is an arrowhead; a circle or a diamond at the start is part of the look of a kind, not a direction. */
const isArrowHead = (marker: ConnectorMarker | null | undefined): boolean => Boolean(marker && (marker.includes('arrow') || marker.includes('triangle')));
/** Whether a connector points both ways: an arrowhead at its start as well as at its end. */
const pointsBothWays = (element: SketchElement): boolean => isArrowHead(element.startMarker) && isArrowHead(element.endMarker);
const EDGE_LOOK: Readonly<Record<FlowEdgeKind, { dash: ElementStyle['strokeDash']; start: ConnectorMarker; end: ConnectorMarker }>> = Object.freeze({
  flow: { dash: 'solid', start: 'none', end: 'solid-arrow' }, message: { dash: 'dashed', start: 'circle', end: 'triangle' },
  association: { dash: 'dotted', start: 'none', end: 'none' }, line: { dash: 'solid', start: 'none', end: 'none' },
});

/**
 * The process an element belongs to: everything joined to it by arrows, together with the pools and lanes
 * those shapes are in and what else is in them. Null when the element is part of no process; a lone shape
 * without arrows only counts when it is a BPMN element.
 */
export function readFlow(elements: readonly SketchElement[], elementId: string): FlowDiagram | null {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const kinds = new Map<string, { shape: FlowShape; type: string | null }>();
  for (const element of elements) { const kind = flowNodeKind(element); if (kind) kinds.set(element.id, kind); }
  const groupIds = new Set(elements.filter(isGroup).map((element) => element.id));
  const connectors = elements.filter((element) => isFlowConnector(element) && element.from && element.to && kinds.has(element.from.elementId) && kinds.has(element.to.elementId));

  const parent = new Map<string, string>([...kinds.keys(), ...groupIds].map((id) => [id, id]));
  const find = (id: string): string => { let at = id; while (parent.get(at) !== at) at = parent.get(at)!; parent.set(id, at); return at; };
  const join = (a: string, b: string): void => { if (parent.has(a) && parent.has(b)) parent.set(find(a), find(b)); };
  for (const id of parent.keys()) { const owner = byId.get(id)!.parentId; if (owner && groupIds.has(owner)) join(id, owner); }
  for (const connector of connectors) join(connector.from!.elementId, connector.to!.elementId);

  const selected = byId.get(elementId);
  const start = selected && isFlowConnector(selected) ? selected.from?.elementId ?? selected.to?.elementId : elementId;
  if (!start || !parent.has(start)) return null;
  const root = find(start);
  const inside = (id: string): boolean => parent.has(id) && find(id) === root;
  const nodeElements = elements.filter((element) => kinds.has(element.id) && inside(element.id));
  const groupElements = elements.filter((element) => groupIds.has(element.id) && inside(element.id));
  const edgeElements = connectors.filter((connector) => inside(connector.from!.elementId));
  const bpmn = nodeElements.some((element) => kinds.get(element.id)!.shape === 'event' || element.metadata?.[BPMN_ICON_KEY] || element.metadata?.[BPMN_MARKER_KEY]) || groupElements.some((element) => swimlaneRole(element));
  if (!edgeElements.length && !bpmn) return null;

  // Groups from the outside in and top to bottom, nodes from left to right.
  const depth = (element: SketchElement): number => { let count = 0; for (let at = element; at.parentId && groupIds.has(at.parentId) && count < 16; at = byId.get(at.parentId)!) count += 1; return count; };
  const orderedGroups: SketchElement[] = [];
  const visit = (owner: string | null): void => {
    for (const group of groupElements.filter((element) => (element.parentId && groupIds.has(element.parentId) ? element.parentId : null) === owner).sort((a, b) => a.y - b.y || a.x - b.x)) { orderedGroups.push(group); visit(group.id); }
  };
  visit(null);
  const horizontal = edgeElements.reduce((sum, edge) => { const [a, b] = [byId.get(edge.from!.elementId)!, byId.get(edge.to!.elementId)!]; return sum + Math.abs(b.x + b.width / 2 - a.x - a.width / 2) - Math.abs(b.y + b.height / 2 - a.y - a.height / 2); }, 0);
  const direction: FlowDirection = horizontal >= 0 ? 'LR' : 'TD';
  const orderedNodes = [...nodeElements].sort((a, b) => (direction === 'LR' ? a.x - b.x || a.y - b.y : a.y - b.y || a.x - b.x));

  // Ids: the remembered ones first, then short ones by kind and order for the rest.
  const idOf = new Map<string, string>();
  const used = new Set<string>();
  for (const element of [...orderedGroups, ...orderedNodes]) {
    const stored = element.metadata?.[FLOW_ID_KEY];
    if (stored && FLOW_ID.test(stored) && !used.has(stored)) { idOf.set(element.id, stored); used.add(stored); }
  }
  const fresh = (prefix: string): string => { for (let index = 1; ; index += 1) if (!used.has(`${prefix}${index}`)) { used.add(`${prefix}${index}`); return `${prefix}${index}`; } };
  const PREFIX: Record<FlowShape, string> = { event: 'e', task: 't', gateway: 'g', store: 'd', data: 'd', box: 'n', round: 'n' };
  for (const group of orderedGroups) if (!idOf.has(group.id)) idOf.set(group.id, fresh(swimlaneRole(group) === 'lane' || depth(group) > 0 ? 'l' : 'p'));
  for (const node of orderedNodes) if (!idOf.has(node.id)) idOf.set(node.id, fresh(PREFIX[kinds.get(node.id)!.shape]));

  const owner = (element: SketchElement): string | null => (element.parentId && groupIds.has(element.parentId) ? idOf.get(element.parentId)! : null);
  const position = new Map(orderedNodes.map((node, index) => [node.id, index]));
  const sortedEdges = [...edgeElements].sort((a, b) => position.get(a.from!.elementId)! - position.get(b.from!.elementId)! || position.get(a.to!.elementId)! - position.get(b.to!.elementId)!);
  const model: FlowModel = {
    direction,
    groups: orderedGroups.map((group) => ({ id: idOf.get(group.id)!, text: group.text ?? group.label ?? '', parent: owner(group) })),
    nodes: orderedNodes.map((node) => ({ id: idOf.get(node.id)!, ...kinds.get(node.id)!, text: node.text ?? '', group: owner(node) })),
    edges: sortedEdges.map((edge) => ({ from: idOf.get(edge.from!.elementId)!, to: idOf.get(edge.to!.elementId)!, text: edge.text ?? '', kind: edgeKind(edge), ...(pointsBothWays(edge) ? { both: true } : {}) })),
  };
  return {
    model,
    elementOf: new Map([...idOf].map(([element, id]) => [id, element])),
    edgeIds: sortedEdges.map((edge) => edge.id),
    members: new Set([...nodeElements, ...groupElements, ...edgeElements].map((element) => element.id)),
  };
}

const NODE_GAP = { along: 70, across: 34, margin: 16 };
const sizeOf = (shape: FlowShape): { width: number; height: number } => { const made = createFlowNode('size', shape, null, { x: 0, y: 0 }, ''); return { width: made.width, height: made.height }; };

export interface FlowPlan {
  command: DocumentCommand | null;
  /** The element behind each node and group of the applied model. */
  elementOf: Map<string, string>;
}

/**
 * The command that makes the process show `next`. What the model keeps stays where it is; texts, kinds,
 * arrows and the lane a shape is in change in place. A new shape stands beside the shape it follows (or the
 * one it leads to), a new lane below the lanes of its pool, a new pool below the diagram.
 */
export function planFlow(elements: readonly SketchElement[], diagram: FlowDiagram, next: FlowModel, createId: (prefix: string) => string, pageId?: string): FlowPlan {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const now = diagram.model;
  const nowGroups = new Map(now.groups.map((group) => [group.id, group]));
  const nowNodes = new Map(now.nodes.map((node) => [node.id, node]));
  const nextGroups = new Map(next.groups.map((group) => [group.id, group]));
  const nextNodes = new Map(next.nodes.map((node) => [node.id, node]));
  const elementOf = new Map<string, string>();
  const boxes = new Map<string, Box>();
  const patches = new Map<string, ElementPatch>();
  const patch = (id: string, change: ElementPatch): void => {
    const before = patches.get(id) ?? {};
    patches.set(id, { ...before, ...change, ...(before.style || change.style ? { style: { ...before.style, ...change.style } } : {}), ...(before.metadata || change.metadata ? { metadata: { ...before.metadata, ...change.metadata } } : {}) });
  };
  const deletes = new Set<string>();
  const onPage = <T extends SketchElement>(element: T): T => (pageId && !element.pageId ? { ...element, pageId } : element);
  const remember = (element: SketchElement, id: string): void => { if (element.metadata?.[FLOW_ID_KEY] !== id) patch(element.id, { metadata: { [FLOW_ID_KEY]: id } }); };

  // ── Groups: kept ones in place, new lanes below the lanes of their pool, new pools below the diagram.
  const memberBoxes = [...diagram.members].map((id) => byId.get(id)).filter((element): element is SketchElement => Boolean(element && element.kind !== 'connector')).map(boxOf);
  let floor = memberBoxes.length ? Math.max(...memberBoxes.map((box) => box.y + box.height)) : 0;
  const left = memberBoxes.length ? Math.min(...memberBoxes.map((box) => box.x)) : 0;
  const newGroups: FlowGroup[] = [];
  for (const group of next.groups) {
    const existing = nowGroups.has(group.id) ? byId.get(diagram.elementOf.get(group.id) ?? '') : undefined;
    if (existing) {
      elementOf.set(group.id, existing.id);
      boxes.set(group.id, boxOf(existing));
      if ((existing.text ?? existing.label ?? '') !== group.text) patch(existing.id, { text: group.text || null, ...(group.text ? { label: group.text } : {}) });
      const owner = group.parent ? elementOf.get(group.parent) ?? null : null;
      if ((nowGroups.get(group.id)!.parent ?? null) !== (group.parent ?? null)) patch(existing.id, { parentId: owner });
      remember(existing, group.id);
      continue;
    }
    elementOf.set(group.id, createId('container'));
    newGroups.push(group);
    const pool = group.parent ? boxes.get(group.parent) : undefined;
    if (!pool) {
      // Below everything there is by now, also below a pool that has just grown by a lane.
      floor = Math.max(floor, ...[...boxes.values()].map((box) => box.y + box.height));
      boxes.set(group.id, { x: left, y: floor + 60, width: 760, height: 200 });
      continue;
    }
    const lanes = next.groups.filter((other) => other.parent === group.parent && boxes.has(other.id)).map((other) => boxes.get(other.id)!);
    // The first lane of a pool takes its whole area; every further one makes the pool taller.
    const top = lanes.length ? Math.max(...lanes.map((lane) => lane.y + lane.height)) : pool.y;
    const height = lanes.length ? SWIMLANE.newLane : pool.height;
    boxes.set(group.id, { x: pool.x + SWIMLANE.strip, y: top, width: Math.max(SWIMLANE.strip * 2, pool.width - SWIMLANE.strip), height });
    pool.height = Math.max(pool.height, top + height - pool.y);
  }
  for (const group of now.groups) {
    if (nextGroups.has(group.id)) continue;
    const element = byId.get(diagram.elementOf.get(group.id) ?? '');
    if (element) deletes.add(element.id);
  }

  // ── Nodes that stay: text, kind and lane change in place.
  const added: SketchElement[] = [];
  const groupElement = (id: string | null): string | null => (id ? elementOf.get(id) ?? null : null);
  for (const node of next.nodes) {
    const before = nowNodes.get(node.id);
    const element = before ? byId.get(diagram.elementOf.get(node.id) ?? '') : undefined;
    if (!before || !element) continue;
    let box = boxOf(element);
    // Another kind of element cannot be patched into shape: a new one takes the place of the old one.
    let substitute: SketchElement | null = null;
    if (before.shape !== node.shape || before.type !== node.type) {
      const made = createFlowNode(element.id, node.shape, node.type, { x: element.x, y: element.y }, node.text);
      const resized = before.shape !== node.shape;
      if (resized) box = { x: element.x + (element.width - made.width) / 2, y: element.y + (element.height - made.height) / 2, width: made.width, height: made.height };
      if (made.kind === element.kind) {
        const marks = Object.fromEntries([BPMN_EVENT_KEY, BPMN_ICON_KEY, BPMN_ICON_STYLE_KEY, BPMN_MARKER_KEY].map((key) => [key, made.metadata?.[key] ?? null]));
        patch(element.id, {
          shapeVariant: made.shapeVariant ?? null, metadata: marks,
          style: { stroke: made.style.stroke, fill: made.style.fill, strokeWidth: made.style.strokeWidth, strokeDash: made.style.strokeDash, ...(resized ? { fontSize: made.style.fontSize } : {}) },
          ...(resized ? box : {}),
        });
      } else substitute = made;
    }
    const moved = (before.group ?? null) !== (node.group ?? null);
    if (moved) {
      const lane = node.group ? boxes.get(node.group) : undefined;
      if (lane) box = { ...box, x: Math.max(lane.x + NODE_GAP.margin, Math.min(box.x, lane.x + lane.width - box.width - NODE_GAP.margin)), y: lane.y + (lane.height - box.height) / 2 };
    }
    const owner = moved ? groupElement(node.group) : element.parentId ?? null;
    let target = element.id;
    if (substitute) {
      target = createId(substitute.kind);
      const { parentId: _unused, ...plain } = substitute;
      added.push(onPage({ ...plain, id: target, ...box, ...(owner ? { parentId: owner } : {}), metadata: { ...substitute.metadata, [FLOW_ID_KEY]: node.id } }));
      deletes.add(element.id);
    } else {
      if ((element.text ?? '') !== node.text) patch(element.id, { text: node.text || null, ...(node.text ? { label: node.text } : {}) });
      if (moved) patch(element.id, { parentId: owner, x: box.x, y: box.y });
      remember(element, node.id);
    }
    elementOf.set(node.id, target);
    boxes.set(node.id, box);
  }
  for (const node of now.nodes) {
    if (nextNodes.has(node.id)) continue;
    const element = byId.get(diagram.elementOf.get(node.id) ?? '');
    if (element) deletes.add(element.id);
  }

  // ── New nodes: beside the node they follow, else before the node they lead to, else at the start of their lane or below everything.
  floor = Math.max(floor, ...[...boxes.values()].map((box) => box.y + box.height));
  const pending = next.nodes.filter((node) => !elementOf.has(node.id));
  const along = next.direction === 'LR';
  const placedBoxes = (): Box[] => next.nodes.filter((node) => boxes.has(node.id)).map((node) => boxes.get(node.id)!);
  while (pending.length) {
    const follows = (node: FlowNode): string | undefined => next.edges.find((edge) => edge.to === node.id && boxes.has(edge.from))?.from;
    const leads = (node: FlowNode): string | undefined => next.edges.find((edge) => edge.from === node.id && boxes.has(edge.to))?.to;
    const index = Math.max(0, pending.findIndex((node) => follows(node)) >= 0 ? pending.findIndex((node) => follows(node)) : pending.findIndex((node) => leads(node)));
    const node = pending.splice(index, 1)[0]!;
    const size = sizeOf(node.shape);
    const before = follows(node) ? boxes.get(follows(node)!)! : null;
    const after = !before && leads(node) ? boxes.get(leads(node)!)! : null;
    const lane = node.group ? boxes.get(node.group) : undefined;
    const all = placedBoxes();
    let box: Box;
    if (before) box = along ? { ...size, x: before.x + before.width + NODE_GAP.along, y: before.y + (before.height - size.height) / 2 } : { ...size, x: before.x + (before.width - size.width) / 2, y: before.y + before.height + NODE_GAP.along };
    else if (after) box = along ? { ...size, x: after.x - NODE_GAP.along - size.width, y: after.y + (after.height - size.height) / 2 } : { ...size, x: after.x + (after.width - size.width) / 2, y: after.y - NODE_GAP.along - size.height };
    else if (lane) box = { ...size, x: lane.x + 48, y: lane.y + (lane.height - size.height) / 2 };
    else box = { ...size, x: all.length ? Math.min(...all.map((other) => other.x)) : left, y: (all.length ? Math.max(floor, ...all.map((other) => other.y + other.height)) : floor) + 60 };
    if (lane) box = { ...box, x: Math.max(lane.x + 48, box.x), ...(along ? { y: lane.y + (lane.height - size.height) / 2 } : {}) };
    for (let tries = 0; tries < 60 && all.some((other) => overlap(box, other, NODE_GAP.margin)); tries += 1) {
      // In a lane a shape keeps its row and moves on; elsewhere it moves aside.
      if (along && lane) box = { ...box, x: box.x + size.width + NODE_GAP.across };
      else if (along) box = { ...box, y: box.y + size.height + NODE_GAP.across };
      else box = { ...box, x: box.x + size.width + NODE_GAP.across };
    }
    const id = createId(node.shape === 'event' || node.shape === 'round' ? 'ellipse' : node.shape === 'gateway' ? 'diamond' : 'rectangle');
    const made = createFlowNode(id, node.shape, node.type, { x: box.x, y: box.y }, node.text);
    added.push(onPage({ ...made, ...(groupElement(node.group) ? { parentId: groupElement(node.group)! } : {}), metadata: { ...made.metadata, [FLOW_ID_KEY]: node.id } }));
    elementOf.set(node.id, id);
    boxes.set(node.id, box);
  }

  // ── Pools grow to the right with what is in them; their lanes follow.
  const topGroup = (id: string | null): string | null => { let at = id; for (let depth = 0; at && nextGroups.get(at)?.parent && depth < 16; depth += 1) at = nextGroups.get(at)!.parent; return at; };
  for (const pool of next.groups.filter((group) => !group.parent)) {
    const box = boxes.get(pool.id)!;
    const inside = next.nodes.filter((node) => topGroup(node.group) === pool.id).map((node) => boxes.get(node.id)!);
    const needed = inside.length ? Math.max(...inside.map((node) => node.x + node.width)) + 32 - box.x : 0;
    if (needed <= box.width) continue;
    box.width = needed;
    for (const lane of next.groups.filter((group) => topGroup(group.id) === pool.id && group.parent)) { const inner = boxes.get(lane.id)!; inner.width = Math.max(inner.width, box.x + box.width - inner.x); }
  }
  for (const group of next.groups) {
    const element = byId.get(elementOf.get(group.id) ?? '');
    const box = boxes.get(group.id)!;
    if (element && (element.width !== box.width || element.height !== box.height)) patch(element.id, { width: box.width, height: box.height });
  }
  const addedGroups = newGroups.map((group) => {
    const id = elementOf.get(group.id)!;
    const box = boxes.get(group.id)!;
    const owner = groupElement(group.parent);
    const made = owner ? createLane(id, { id: owner, x: box.x - SWIMLANE.strip, width: box.width + SWIMLANE.strip }, box.y, box.height, group.text) : createPool(id, box, group.text);
    return onPage({ ...made, metadata: { ...made.metadata, [FLOW_ID_KEY]: group.id } });
  });

  // ── What was in a group that goes, and is not going itself, stays on the canvas.
  const goingGroups = new Set(now.groups.filter((group) => !nextGroups.has(group.id)).map((group) => diagram.elementOf.get(group.id)));
  for (const element of elements) {
    if (!element.parentId || !goingGroups.has(element.parentId) || deletes.has(element.id)) continue;
    if (patches.get(element.id)?.parentId === undefined) patch(element.id, { parentId: null });
  }

  // ── Arrows: the ones between the same two nodes are the same arrows, in their order.
  const waiting = new Map<string, string[]>();
  now.edges.forEach((edge, index) => { const key = `${edge.from}>${edge.to}`; waiting.set(key, [...(waiting.get(key) ?? []), diagram.edgeIds[index]!]); });
  const finalBox = new Map<string, Box>([...elementOf].filter(([id]) => boxes.has(id)).map(([id, element]) => [element, boxes.get(id)!]));
  const addedEdges: SketchElement[] = [];
  for (const edge of next.edges) {
    const [from, to] = [elementOf.get(edge.from), elementOf.get(edge.to)];
    if (!from || !to || !nextNodes.has(edge.from) || !nextNodes.has(edge.to)) continue;
    const look = EDGE_LOOK[edge.kind];
    // Both ways: the start carries the arrowhead of the end.
    const both = Boolean(edge.both) && isArrowHead(look.end);
    const start = both ? look.end : look.start;
    const existing = byId.get(waiting.get(`${edge.from}>${edge.to}`)?.shift() ?? '');
    if (existing) {
      if ((existing.text ?? '') !== edge.text) patch(existing.id, { text: edge.text || null });
      if (edgeKind(existing) !== edge.kind || pointsBothWays(existing) !== both) patch(existing.id, { startMarker: start, endMarker: look.end, style: { strokeDash: look.dash } });
      if (existing.from!.elementId !== from) patch(existing.id, { from: { elementId: from, anchor: existing.from!.anchor } });
      if (existing.to!.elementId !== to) patch(existing.id, { to: { elementId: to, anchor: existing.to!.anchor } });
      continue;
    }
    const routed = routeBoundConnector({ kind: 'connector', id: createId('connector'), from: { elementId: from }, to: { elementId: to } }, (id) => finalBox.get(id)) as Partial<SketchElement> & { id: string };
    addedEdges.push(onPage(createElement('connector', { ...routed, startMarker: start, endMarker: look.end, ...(edge.text ? { text: edge.text } : {}), style: { ...DEFAULT_STYLE, fontSize: 14, strokeDash: look.dash } })));
  }
  for (const ids of waiting.values()) for (const id of ids) deletes.add(id);

  // ── One command: new groups and nodes first, so that changes can refer to them.
  const commands: DocumentCommand[] = [];
  if (addedGroups.length) commands.push({ type: 'add', elements: addedGroups });
  if (added.length) commands.push({ type: 'add', elements: added });
  const changes = [...patches].filter(([id, change]) => !deletes.has(id) && Object.keys(change).length).map(([id, change]) => ({ id, patch: change }));
  if (changes.length) commands.push({ type: 'update', changes });
  if (addedEdges.length) commands.push({ type: 'add', elements: addedEdges });
  const gone = [...deletes].filter((id) => byId.has(id));
  if (gone.length) commands.push({ type: 'delete', ids: gone });

  // Shapes and arrows are drawn above the pools and lanes they are in, so they stay clickable.
  const order = [...elements.filter((element) => !deletes.has(element.id)).map((element) => element.id), ...addedGroups.map((element) => element.id), ...added.map((element) => element.id), ...addedEdges.map((element) => element.id)];
  const groupIds = new Set(next.groups.map((group) => elementOf.get(group.id)!));
  const upper = new Set([...next.nodes.map((node) => elementOf.get(node.id)!), ...diagram.edgeIds.filter((id) => !deletes.has(id)), ...addedEdges.map((element) => element.id)]);
  const firstUpper = order.findIndex((id) => upper.has(id));
  let lastGroup = -1;
  order.forEach((id, index) => { if (groupIds.has(id)) lastGroup = index; });
  if (firstUpper >= 0 && lastGroup > firstUpper) commands.push({ type: 'reorder', ids: [...order.filter((id) => !upper.has(id)), ...order.filter((id) => upper.has(id))] });

  return { command: commands.length === 0 ? null : commands.length === 1 ? commands[0]! : { type: 'batch', commands }, elementOf };
}

/** Whether an element carries a BPMN mark of its own. */
export const isBpmnElement = (element: SketchElement): boolean => Boolean(element.metadata?.[BPMN_EVENT_KEY] || element.metadata?.[BPMN_ICON_KEY] || element.metadata?.[BPMN_MARKER_KEY] || element.metadata?.[BPMN_ROLE_KEY]);
