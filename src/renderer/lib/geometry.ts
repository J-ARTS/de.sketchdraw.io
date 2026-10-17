import type { Point, SketchElement } from '@/domain';
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

export function hitElement(element: SketchElement, point: Point, tolerance: number): boolean {
  const p = rotatePoint(point, center(element), -element.rotation);
  const x = p.x - element.x;
  const y = p.y - element.y;
  if (element.kind === 'path' || element.kind === 'connector') {
    return (element.points ?? []).some((b, i, points) => i > 0 && segmentDistance({ x, y }, points[i - 1]!, b) <= tolerance + element.style.strokeWidth / 2);
  }
  if (x < -tolerance || y < -tolerance || x > element.width + tolerance || y > element.height + tolerance) return false;
  if (element.kind === 'ellipse') {
    return ((x - element.width / 2) / (element.width / 2 + tolerance)) ** 2 + ((y - element.height / 2) / (element.height / 2 + tolerance)) ** 2 <= 1;
  }
  if (element.kind === 'diamond') {
    return Math.abs(x - element.width / 2) / (element.width / 2 + tolerance) + Math.abs(y - element.height / 2) / (element.height / 2 + tolerance) <= 1;
  }
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

export function endpointAt(element: SketchElement, point: Point): Point {
  const p = rotatePoint(point, center(element), -element.rotation);
  const anchor = { x: Math.max(0, Math.min(1, (p.x - element.x) / Math.max(1, element.width))), y: Math.max(0, Math.min(1, (p.y - element.y) / Math.max(1, element.height))) };
  const distances = [anchor.x, 1 - anchor.x, anchor.y, 1 - anchor.y];
  const edge = distances.indexOf(Math.min(...distances));
  if (edge === 0) anchor.x = 0;
  if (edge === 1) anchor.x = 1;
  if (edge === 2) anchor.y = 0;
  if (edge === 3) anchor.y = 1;
  return anchor;
}
