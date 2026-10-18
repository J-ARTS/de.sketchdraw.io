import type { Point, SketchElement } from '@/domain/types';
import type { QuickDirection, Rect } from '@/renderer/state/contract';
import { bounds, center, rotatePoint } from './geometry';

export const QUICK_DIRECTIONS: readonly QuickDirection[] = ['top', 'right', 'bottom', 'left'];
/** Document-unit gap between the source shape and the created copy. */
export const QUICK_CONNECT_GAP = 80;
/** Screen-pixel distance of the quick-connect handle from the element edge. */
export const QUICK_HANDLE_OFFSET = 22;

interface Side { from: Point; to: Point; axis: Point }

/** `from` anchors on the source, `to` on the copy; `axis` points away from the source. */
export const QUICK_SIDES: Readonly<Record<QuickDirection, Side>> = {
  top: { from: { x: 0.5, y: 0 }, to: { x: 0.5, y: 1 }, axis: { x: 0, y: -1 } },
  right: { from: { x: 1, y: 0.5 }, to: { x: 0, y: 0.5 }, axis: { x: 1, y: 0 } },
  bottom: { from: { x: 0.5, y: 1 }, to: { x: 0.5, y: 0 }, axis: { x: 0, y: 1 } },
  left: { from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 }, axis: { x: -1, y: 0 } },
};

export interface QuickConnectPlan {
  /** Position and size of the copy in document coordinates. */
  shape: Rect;
  start: Point;
  end: Point;
  fromAnchor: Point;
  toAnchor: Point;
}

function overlaps(a: Rect, b: Rect, padding: number): boolean {
  return a.x < b.x + b.width + padding && b.x < a.x + a.width + padding && a.y < b.y + b.height + padding && b.y < a.y + a.height + padding;
}

/**
 * Places a same-sized copy next to `source` and returns the connector geometry.
 * Occupied spots fan out perpendicular to the direction (0, +1, −1, +2, …) so
 * repeated quick connects from one shape build a tidy column or row.
 */
export function planQuickConnect(source: SketchElement, direction: QuickDirection, elements: readonly SketchElement[]): QuickConnectPlan {
  const side = QUICK_SIDES[direction];
  const { width, height } = source;
  const base: Rect = { x: source.x + side.axis.x * (width + QUICK_CONNECT_GAP), y: source.y + side.axis.y * (height + QUICK_CONNECT_GAP), width, height };
  const obstacles = elements
    .filter((element) => element.id !== source.id && element.kind !== 'connector')
    .map((element) => bounds([element]))
    .filter((rect): rect is Rect => rect !== null);
  const step = side.axis.x !== 0 ? { x: 0, y: height + QUICK_CONNECT_GAP / 2 } : { x: width + QUICK_CONNECT_GAP / 2, y: 0 };
  let shape = base;
  for (let attempt = 0; attempt < 9; attempt++) {
    const k = attempt === 0 ? 0 : (attempt % 2 === 1 ? 1 : -1) * Math.ceil(attempt / 2);
    const candidate = { ...base, x: base.x + step.x * k, y: base.y + step.y * k };
    if (!obstacles.some((rect) => overlaps(candidate, rect, 8))) { shape = candidate; break; }
  }
  const start = rotatePoint({ x: source.x + side.from.x * width, y: source.y + side.from.y * height }, center(source), source.rotation);
  const end = { x: shape.x + side.to.x * width, y: shape.y + side.to.y * height };
  return { shape, start, end, fromAnchor: side.from, toAnchor: side.to };
}

/** Point on the element edge for a normalized anchor, honouring rotation. */
export function anchorPoint(element: SketchElement, anchor: Point): Point {
  return rotatePoint({ x: element.x + anchor.x * element.width, y: element.y + anchor.y * element.height }, center(element), element.rotation);
}

/** Side midpoint of `target` closest to `from`, used when a quick-connect drag ends on an existing element (#107). */
export function nearestSideAnchor(target: SketchElement, from: Point): Point {
  let best = QUICK_SIDES.left.from;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const direction of QUICK_DIRECTIONS) {
    const anchor = QUICK_SIDES[direction].from;
    const point = anchorPoint(target, anchor);
    const distance = Math.hypot(point.x - from.x, point.y - from.y);
    if (distance < bestDistance) { best = anchor; bestDistance = distance; }
  }
  return best;
}

/** Same kind, size and style; text, names and descriptions stay with the original. */
export function quickConnectCopy(source: SketchElement, shape: Rect): Partial<SketchElement> {
  const copy: Partial<SketchElement> = { ...shape, rotation: 0, style: { ...source.style } };
  if (source.shapeVariant) copy.shapeVariant = source.shapeVariant;
  if (source.kind === 'component') {
    if (source.componentType) copy.componentType = source.componentType;
    if (source.metadata) copy.metadata = { ...source.metadata };
    if (source.documentationUrl) copy.documentationUrl = source.documentationUrl;
  }
  if (source.kind === 'sticky-note') {
    copy.text = '';
    copy.author = source.author;
    if (source.documentationUrl) copy.documentationUrl = source.documentationUrl;
  }
  return copy;
}
