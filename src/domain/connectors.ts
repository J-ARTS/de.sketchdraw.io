import type { ConnectorMarker, ConnectorRouting, Point, SketchElement } from './types';

export const DEFAULT_CONNECTOR_ROUTING: ConnectorRouting = 'straight';
export const DEFAULT_START_MARKER: ConnectorMarker = 'none';
export const DEFAULT_END_MARKER: ConnectorMarker = 'line-arrow';

export function connectorRouting(element: Pick<SketchElement, 'connectorRouting'>): ConnectorRouting {
  return element.connectorRouting ?? DEFAULT_CONNECTOR_ROUTING;
}

export function connectorStartMarker(element: Pick<SketchElement, 'startMarker'>): ConnectorMarker {
  return element.startMarker ?? DEFAULT_START_MARKER;
}

export function connectorEndMarker(element: Pick<SketchElement, 'endMarker'>): ConnectorMarker {
  return element.endMarker ?? DEFAULT_END_MARKER;
}

const n = (value: number): string => String(Object.is(value, -0) ? 0 : Math.round(value * 1000) / 1000);
const point = (value: Point): string => `${n(value.x)} ${n(value.y)}`;

function anchorDirection(anchor: Point | undefined, fallback: Point): Point {
  if (!anchor) return fallback;
  const distances = [
    { value: anchor.x, direction: { x: -1, y: 0 } },
    { value: 1 - anchor.x, direction: { x: 1, y: 0 } },
    { value: anchor.y, direction: { x: 0, y: -1 } },
    { value: 1 - anchor.y, direction: { x: 0, y: 1 } },
  ];
  return distances.sort((a, b) => a.value - b.value)[0]!.direction;
}

function roundedPolyline(points: readonly Point[], radius: number): string {
  if (points.length < 3 || radius <= 0) return `M ${point(points[0]!)} ${points.slice(1).map((p) => `L ${point(p)}`).join(' ')}`;
  let path = `M ${point(points[0]!)}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]!;
    const corner = points[index]!;
    const next = points[index + 1]!;
    const beforeLength = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const afterLength = Math.hypot(next.x - corner.x, next.y - corner.y);
    const cut = Math.min(radius, beforeLength / 2, afterLength / 2);
    if (cut <= 0) { path += ` L ${point(corner)}`; continue; }
    const before = { x: corner.x + (previous.x - corner.x) * cut / beforeLength, y: corner.y + (previous.y - corner.y) * cut / beforeLength };
    const after = { x: corner.x + (next.x - corner.x) * cut / afterLength, y: corner.y + (next.y - corner.y) * cut / afterLength };
    path += ` L ${point(before)} Q ${point(corner)} ${point(after)}`;
  }
  return `${path} L ${point(points.at(-1)!)}`;
}

/** Deterministic SVG path projection shared by the live renderer and native SVG export. */
export function connectorPathData(element: Pick<SketchElement, 'points' | 'connectorRouting' | 'from' | 'to'>): string {
  const points = element.points ?? [];
  if (points.length < 2) return '';
  const start = points[0]!;
  const end = points.at(-1)!;
  const routing = connectorRouting(element);
  if (routing === 'straight') return `M ${point(start)} ${points.slice(1).map((p) => `L ${point(p)}`).join(' ')}`;
  if (routing === 'elbowed') {
    if (Math.abs(end.x - start.x) < 0.001 || Math.abs(end.y - start.y) < 0.001) return `M ${point(start)} L ${point(end)}`;
    const fromDirection = anchorDirection(element.from?.anchor, { x: Math.sign(end.x - start.x) || 1, y: 0 });
    const horizontalFirst = fromDirection.x !== 0;
    const middle = horizontalFirst ? (start.x + end.x) / 2 : (start.y + end.y) / 2;
    const route = horizontalFirst
      ? [start, { x: middle, y: start.y }, { x: middle, y: end.y }, end]
      : [start, { x: start.x, y: middle }, { x: end.x, y: middle }, end];
    return roundedPolyline(route, 16);
  }
  const distance = Math.max(32, Math.min(160, Math.hypot(end.x - start.x, end.y - start.y) * 0.4));
  const fallback = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)
    ? { x: Math.sign(end.x - start.x) || 1, y: 0 }
    : { x: 0, y: Math.sign(end.y - start.y) || 1 };
  const fromDirection = anchorDirection(element.from?.anchor, fallback);
  const toDirection = anchorDirection(element.to?.anchor, { x: -fallback.x, y: -fallback.y });
  const controlA = { x: start.x + fromDirection.x * distance, y: start.y + fromDirection.y * distance };
  const controlB = { x: end.x + toDirection.x * distance, y: end.y + toDirection.y * distance };
  return `M ${point(start)} C ${point(controlA)} ${point(controlB)} ${point(end)}`;
}
