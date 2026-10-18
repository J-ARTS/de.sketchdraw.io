import { connectorRoutePoints, effectiveShapeVariant, type Point, type ShapeVariant, type SketchElement } from '@/domain';
import type { Rect } from '@/renderer/state/contract';

export function rotatePoint(point: Point, center: Point, degrees: number): Point {
  const angle = degrees * Math.PI / 180;
  const x = point.x - center.x;
  const y = point.y - center.y;
  return { x: center.x + x * Math.cos(angle) - y * Math.sin(angle), y: center.y + x * Math.sin(angle) + y * Math.cos(angle) };
}

export function center(element: Rect): Point {
  return { x: element.x + element.width / 2, y: element.y + element.height / 2 };
}

export function corners(element: SketchElement): Point[] {
  const c = center(element);
  return [
    { x: element.x, y: element.y }, { x: element.x + element.width, y: element.y },
    { x: element.x + element.width, y: element.y + element.height }, { x: element.x, y: element.y + element.height },
  ].map((p) => rotatePoint(p, c, element.rotation));
}

export function bounds(elements: readonly SketchElement[]): Rect | null {
  if (!elements.length) return null;
  const points = elements.flatMap(corners);
  const left = Math.min(...points.map((p) => p.x));
  const top = Math.min(...points.map((p) => p.y));
  return { x: left, y: top, width: Math.max(...points.map((p) => p.x)) - left, height: Math.max(...points.map((p) => p.y)) - top };
}

export function normalizedRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

const POLYGON_SHAPES: Partial<Record<ShapeVariant, readonly Point[]>> = {
  diamond: [{ x: .5, y: 0 }, { x: 1, y: .5 }, { x: .5, y: 1 }, { x: 0, y: .5 }],
  triangle: [{ x: .5, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
  'triangle-down': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: .5, y: 1 }],
  chevron: [{ x: 0, y: 0 }, { x: .75, y: 0 }, { x: 1, y: .5 }, { x: .75, y: 1 }, { x: 0, y: 1 }, { x: .2, y: .5 }],
  'manual-input': [{ x: 0, y: .25 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
  hexagon: [{ x: .2, y: 0 }, { x: .8, y: 0 }, { x: 1, y: .5 }, { x: .8, y: 1 }, { x: .2, y: 1 }, { x: 0, y: .5 }],
  parallelogram: [{ x: .2, y: 0 }, { x: 1, y: 0 }, { x: .8, y: 1 }, { x: 0, y: 1 }],
  'parallelogram-reverse': [{ x: 0, y: 0 }, { x: .8, y: 0 }, { x: 1, y: 1 }, { x: .2, y: 1 }],
  trapezoid: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: .8, y: 1 }, { x: .2, y: 1 }],
  'off-page': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: .65 }, { x: .5, y: 1 }, { x: 0, y: .65 }],
  pentagon: [{ x: .5, y: 0 }, { x: 1, y: .38 }, { x: .82, y: 1 }, { x: .18, y: 1 }, { x: 0, y: .38 }],
  'loop-limit': [{ x: .25, y: 0 }, { x: .75, y: 0 }, { x: 1, y: .25 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: .25 }],
};

/** Shapes that are drawn as a polygon with an adjustable corner radius (diamond and triangles). */
export const ROUNDABLE_POLYGONS: readonly ShapeVariant[] = ['diamond', 'triangle', 'triangle-down'];

/** SVG path of a unit polygon scaled to width x height with every corner rounded by `radius` (capped per corner). */
export function roundedPolygonPath(variant: ShapeVariant, width: number, height: number, radius: number): string {
  const unit = POLYGON_SHAPES[variant];
  if (!unit) return '';
  const points = unit.map((point) => ({ x: point.x * width, y: point.y * height }));
  const count = points.length;
  const parts: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const prev = points[(index + count - 1) % count]!; const current = points[index]!; const next = points[(index + 1) % count]!;
    const toPrev = Math.hypot(prev.x - current.x, prev.y - current.y); const toNext = Math.hypot(next.x - current.x, next.y - current.y);
    const reach = Math.max(0, Math.min(radius, toPrev / 2, toNext / 2));
    const start = { x: current.x + (prev.x - current.x) / toPrev * reach, y: current.y + (prev.y - current.y) / toPrev * reach };
    const end = { x: current.x + (next.x - current.x) / toNext * reach, y: current.y + (next.y - current.y) / toNext * reach };
    parts.push(`${index === 0 ? 'M' : 'L'}${start.x} ${start.y}`, `Q${current.x} ${current.y} ${end.x} ${end.y}`);
  }
  return `${parts.join(' ')} Z`;
}

function insidePolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!; const b = polygon[j]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function hitElement(element: SketchElement, point: Point, tolerance: number): boolean {
  const p = rotatePoint(point, center(element), -element.rotation);
  const x = p.x - element.x;
  const y = p.y - element.y;
  if (element.kind === 'path' || element.kind === 'connector') {
    const points = element.kind === 'connector' ? connectorRoutePoints(element) : (element.points ?? []);
    return points.some((b, i) => i > 0 && segmentDistance({ x, y }, points[i - 1]!, b) <= tolerance + element.style.strokeWidth / 2);
  }
  // Frames are viewports around ordinary canvas elements. Only their outline is selectable so
  // a frame added later in z-order never blocks interaction with content inside it.
  if (element.kind === 'frame') {
    if (x < -tolerance || y < -tolerance || x > element.width + tolerance || y > element.height + tolerance) return false;
    const edge = Math.min(Math.abs(x), Math.abs(y), Math.abs(element.width - x), Math.abs(element.height - y));
    return edge <= tolerance + element.style.strokeWidth / 2;
  }
  if (x < -tolerance || y < -tolerance || x > element.width + tolerance || y > element.height + tolerance) return false;
  const variant = effectiveShapeVariant(element);
  if (variant === 'circle' || variant === 'summing' || variant === 'or') {
    return ((x - element.width / 2) / (element.width / 2 + tolerance)) ** 2 + ((y - element.height / 2) / (element.height / 2 + tolerance)) ** 2 <= 1;
  }
  const polygon = variant ? POLYGON_SHAPES[variant] : undefined;
  if (polygon) return insidePolygon({ x: x / element.width, y: y / element.height }, polygon);
  return true;
}

export function topSelected(elements: readonly SketchElement[], ids: readonly string[]): SketchElement[] {
  const selected = new Set(ids);
  const index = new Map(elements.map((e) => [e.id, e]));
  return elements.filter((e) => {
    if (!selected.has(e.id)) return false;
    let parent = e.parentId;
    while (parent) {
      if (selected.has(parent)) return false;
      parent = index.get(parent)?.parentId;
    }
    return true;
  });
}

/** Relative positions of the dock points along each side: three per side, twelve per element. */
export const DOCK_SLOTS = [0.25, 0.5, 0.75] as const;
export type DockSide = 'top' | 'right' | 'bottom' | 'left';
export const DOCK_POINTS: ReadonlyArray<{ side: DockSide; slot: number; x: number; y: number }> = DOCK_SLOTS.flatMap((slot) => [
  { side: 'top' as const, slot, x: slot, y: 0 },
  { side: 'right' as const, slot, x: 1, y: slot },
  { side: 'bottom' as const, slot, x: slot, y: 1 },
  { side: 'left' as const, slot, x: 0, y: slot },
]);
const nearestSlot = (value: number): number => DOCK_SLOTS.reduce((best, slot) => (Math.abs(slot - value) < Math.abs(best - value) ? slot : best), DOCK_SLOTS[1]);

/** Snaps a pointer position to the nearest of the element's twelve dock points (three per side). */
export function endpointAt(element: SketchElement, point: Point): Point {
  const p = rotatePoint(point, center(element), -element.rotation);
  const anchor = { x: Math.max(0, Math.min(1, (p.x - element.x) / Math.max(1, element.width))), y: Math.max(0, Math.min(1, (p.y - element.y) / Math.max(1, element.height))) };
  const distances = [anchor.x, 1 - anchor.x, anchor.y, 1 - anchor.y];
  const edge = distances.indexOf(Math.min(...distances));
  if (edge === 0) { anchor.x = 0; anchor.y = nearestSlot(anchor.y); }
  if (edge === 1) { anchor.x = 1; anchor.y = nearestSlot(anchor.y); }
  if (edge === 2) { anchor.y = 0; anchor.x = nearestSlot(anchor.x); }
  if (edge === 3) { anchor.y = 1; anchor.x = nearestSlot(anchor.x); }
  return anchor;
}
