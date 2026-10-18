import type { ConnectorMarker, ConnectorRouting, Point, SketchElement } from './types';

export const DEFAULT_CONNECTOR_ROUTING: ConnectorRouting = 'straight';
export const DEFAULT_START_MARKER: ConnectorMarker = 'none';
export const DEFAULT_END_MARKER: ConnectorMarker = 'line-arrow';
export const ELBOWED_CONNECTOR_CORNER_RADIUS = 24;

const ROUTE_EPSILON = 0.001;

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

const ELBOW_STUB = 24;

/**
 * Orthogonal route that leaves the start edge and arrives at the target edge perpendicularly: the first
 * segment runs along the start edge's outward normal and the last one along the target edge's normal, so an
 * arrowhead always meets the border at a right angle. `fromDirection`/`toDirection` are outward unit normals.
 */
function elbowRoute(start: Point, end: Point, fromDirection: Point, toDirection: Point): Point[] {
  const fromHorizontal = fromDirection.x !== 0;
  const toHorizontal = toDirection.x !== 0;
  const exit = { x: start.x + fromDirection.x * ELBOW_STUB, y: start.y + fromDirection.y * ELBOW_STUB };
  const entry = { x: end.x + toDirection.x * ELBOW_STUB, y: end.y + toDirection.y * ELBOW_STUB };
  if (fromHorizontal === toHorizontal) {
    // Both ends use the same axis: Z-shape when the target lies ahead, otherwise a detour around via exit/entry.
    const a = fromHorizontal ? 'x' : 'y';
    const b = fromHorizontal ? 'y' : 'x';
    const sign = fromDirection[a];
    const point = (along: number, across: number): Point => (fromHorizontal ? { x: along, y: across } : { x: across, y: along });
    if (fromDirection[a] === toDirection[a]) {
      const along = sign > 0 ? Math.max(exit[a], entry[a]) : Math.min(exit[a], entry[a]);
      return [start, point(along, start[b]), point(along, end[b]), end];
    }
    if ((entry[a] - exit[a]) * sign >= 0) {
      const middle = (start[a] + end[a]) / 2;
      return [start, point(middle, start[b]), point(middle, end[b]), end];
    }
    const lane = (start[b] + end[b]) / 2 + (Math.abs(start[b] - end[b]) < 1 ? ELBOW_STUB * 2 : 0);
    return [start, exit, point(exit[a], lane), point(entry[a], lane), entry, end];
  }
  // Perpendicular axes: a single bend when both edges face the corner, otherwise route around via exit/entry.
  const corner = fromHorizontal ? { x: end.x, y: start.y } : { x: start.x, y: end.y };
  const aheadOfStart = fromHorizontal ? (end.x - start.x) * fromDirection.x > 0 : (end.y - start.y) * fromDirection.y > 0;
  const outsideTarget = toHorizontal ? (start.x - end.x) * toDirection.x > 0 : (start.y - end.y) * toDirection.y > 0;
  if (aheadOfStart && outsideTarget) return [start, corner, end];
  const bend = fromHorizontal ? { x: exit.x, y: entry.y } : { x: entry.x, y: exit.y };
  return [start, exit, bend, entry, end];
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

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < ROUTE_EPSILON && Math.abs(a.y - b.y) < ROUTE_EPSILON;
}

/** Removes zero-length and redundant collinear segments without changing a route's shape. */
export function simplifyElbowedRoute(points: readonly Point[]): Point[] {
  const compact: Point[] = [];
  for (const point of points) {
    const next = { x: point.x, y: point.y };
    if (compact.length && samePoint(compact.at(-1)!, next)) continue;
    compact.push(next);
    while (compact.length >= 3) {
      const a = compact.at(-3)!;
      const b = compact.at(-2)!;
      const c = compact.at(-1)!;
      const sameX = Math.abs(a.x - b.x) < ROUTE_EPSILON && Math.abs(b.x - c.x) < ROUTE_EPSILON;
      const sameY = Math.abs(a.y - b.y) < ROUTE_EPSILON && Math.abs(b.y - c.y) < ROUTE_EPSILON;
      if (!sameX && !sameY) break;
      compact.splice(compact.length - 2, 1);
    }
  }
  return compact;
}

/** Converts legacy free-positioned bend points into a strictly orthogonal route. */
function orthogonalElbowedRoute(points: readonly Point[]): Point[] {
  if (points.length < 2) return points.map((entry) => ({ ...entry }));
  const route: Point[] = [{ ...points[0]! }];
  let previousOrientation: 'horizontal' | 'vertical' | null = null;
  for (const point of points.slice(1)) {
    const previous = route.at(-1)!;
    const horizontal = Math.abs(previous.y - point.y) < ROUTE_EPSILON;
    const vertical = Math.abs(previous.x - point.x) < ROUTE_EPSILON;
    if (!horizontal && !vertical) {
      const horizontalFirst = previousOrientation === 'horizontal'
        || (previousOrientation === null && Math.abs(point.x - previous.x) >= Math.abs(point.y - previous.y));
      route.push(horizontalFirst
        ? { x: point.x, y: previous.y }
        : { x: previous.x, y: point.y });
    }
    const beforeTarget = route.at(-1)!;
    previousOrientation = Math.abs(beforeTarget.y - point.y) < ROUTE_EPSILON ? 'horizontal' : 'vertical';
    route.push({ ...point });
  }
  return simplifyElbowedRoute(route);
}

/**
 * Moves one orthogonal path segment parallel to itself, matching FigJam's blue
 * segment bars. Moving an outer segment keeps a short outward stub at the
 * attached endpoint and inserts the extra right-angle turns needed to do so.
 */
export function moveElbowedSegment(
  points: readonly Point[],
  segmentIndex: number,
  target: Point,
  stubLength = 24,
): Point[] {
  if (points.length < 2 || segmentIndex < 0 || segmentIndex >= points.length - 1) {
    return points.map((point) => ({ ...point }));
  }
  const route = points.map((point) => ({ ...point }));
  const start = route[segmentIndex]!;
  const end = route[segmentIndex + 1]!;
  const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
  const currentAxis = horizontal ? start.y : start.x;
  const targetAxis = horizontal ? target.y : target.x;
  if (Math.abs(targetAxis - currentAxis) < ROUTE_EPSILON) return simplifyElbowedRoute(route);

  const stub = Math.max(1, stubLength);
  if (route.length === 2) {
    if (horizontal) {
      const direction = Math.sign(end.x - start.x) || 1;
      const available = Math.abs(end.x - start.x);
      const length = Math.min(stub, Math.max(1, available / 3));
      return simplifyElbowedRoute([
        start,
        { x: start.x + direction * length, y: start.y },
        { x: start.x + direction * length, y: targetAxis },
        { x: end.x - direction * length, y: targetAxis },
        { x: end.x - direction * length, y: end.y },
        end,
      ]);
    }
    const direction = Math.sign(end.y - start.y) || 1;
    const available = Math.abs(end.y - start.y);
    const length = Math.min(stub, Math.max(1, available / 3));
    return simplifyElbowedRoute([
      start,
      { x: start.x, y: start.y + direction * length },
      { x: targetAxis, y: start.y + direction * length },
      { x: targetAxis, y: end.y - direction * length },
      { x: end.x, y: end.y - direction * length },
      end,
    ]);
  }

  if (segmentIndex === 0) {
    if (horizontal) {
      const direction = Math.sign(end.x - start.x) || 1;
      const length = Math.min(stub, Math.max(1, Math.abs(end.x - start.x) / 2));
      route.splice(1, 1,
        { x: start.x + direction * length, y: start.y },
        { x: start.x + direction * length, y: targetAxis },
        { x: end.x, y: targetAxis });
    } else {
      const direction = Math.sign(end.y - start.y) || 1;
      const length = Math.min(stub, Math.max(1, Math.abs(end.y - start.y) / 2));
      route.splice(1, 1,
        { x: start.x, y: start.y + direction * length },
        { x: targetAxis, y: start.y + direction * length },
        { x: targetAxis, y: end.y });
    }
    return simplifyElbowedRoute(route);
  }

  if (segmentIndex === route.length - 2) {
    if (horizontal) {
      const direction = Math.sign(start.x - end.x) || -1;
      const length = Math.min(stub, Math.max(1, Math.abs(end.x - start.x) / 2));
      route.splice(segmentIndex, 1,
        { x: start.x, y: targetAxis },
        { x: end.x + direction * length, y: targetAxis },
        { x: end.x + direction * length, y: end.y });
    } else {
      const direction = Math.sign(start.y - end.y) || -1;
      const length = Math.min(stub, Math.max(1, Math.abs(end.y - start.y) / 2));
      route.splice(segmentIndex, 1,
        { x: targetAxis, y: start.y },
        { x: targetAxis, y: end.y + direction * length },
        { x: end.x, y: end.y + direction * length });
    }
    return simplifyElbowedRoute(route);
  }

  if (horizontal) {
    route[segmentIndex]!.y = targetAxis;
    route[segmentIndex + 1]!.y = targetAxis;
  } else {
    route[segmentIndex]!.x = targetAxis;
    route[segmentIndex + 1]!.x = targetAxis;
  }
  return simplifyElbowedRoute(route);
}

/**
 * Returns the editable local-space route behind the rendered connector.
 * Two-point legacy connectors are expanded deterministically for elbowed and
 * curved rendering. Once a user edits a route, its explicit points remain the
 * canonical, serializable geometry.
 */
export function connectorRoutePoints(element: Pick<SketchElement, 'points' | 'connectorRouting' | 'from' | 'to'>): Point[] {
  const points = (element.points ?? []).map((entry) => ({ x: entry.x, y: entry.y }));
  if (points.length < 2) return points;
  const start = points[0]!;
  const end = points.at(-1)!;
  const routing = connectorRouting(element);
  // The selected routing mode owns the rendered geometry. This also normalizes
  // older documents that may still carry control points from another mode.
  if (routing === 'straight') return [start, end];
  if (routing === 'elbowed' && points.length > 2) return orthogonalElbowedRoute(points);
  if (routing === 'curved' && points.length >= 4) return [start, points[1]!, points.at(-2)!, end];
  if (routing === 'elbowed') {
    const fallback = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)
      ? { x: Math.sign(end.x - start.x) || 1, y: 0 }
      : { x: 0, y: Math.sign(end.y - start.y) || 1 };
    const fromDirection = anchorDirection(element.from?.anchor, fallback);
    const toDirection = anchorDirection(element.to?.anchor, { x: -fromDirection.x, y: -fromDirection.y });
    // Perfectly aligned ends stay a straight line only when that line already meets both borders at a right angle.
    const alignedX = Math.abs(end.y - start.y) < 0.001 && fromDirection.y === 0 && toDirection.y === 0 && (end.x - start.x) * fromDirection.x > 0 && (start.x - end.x) * toDirection.x > 0;
    const alignedY = Math.abs(end.x - start.x) < 0.001 && fromDirection.x === 0 && toDirection.x === 0 && (end.y - start.y) * fromDirection.y > 0 && (start.y - end.y) * toDirection.y > 0;
    if (alignedX || alignedY) return [start, end];
    return simplifyElbowedRoute(elbowRoute(start, end, fromDirection, toDirection));
  }
  const distance = Math.max(32, Math.min(160, Math.hypot(end.x - start.x, end.y - start.y) * 0.4));
  const fallback = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)
    ? { x: Math.sign(end.x - start.x) || 1, y: 0 }
    : { x: 0, y: Math.sign(end.y - start.y) || 1 };
  const fromDirection = anchorDirection(element.from?.anchor, fallback);
  const toDirection = anchorDirection(element.to?.anchor, { x: -fallback.x, y: -fallback.y });
  return [
    start,
    { x: start.x + fromDirection.x * distance, y: start.y + fromDirection.y * distance },
    { x: end.x + toDirection.x * distance, y: end.y + toDirection.y * distance },
    end,
  ];
}

/** Rebuilds a route for a newly selected line type using only its endpoints. */
export function connectorRoutePointsForRouting(
  element: Pick<SketchElement, 'points' | 'connectorRouting' | 'from' | 'to'>,
  routing: ConnectorRouting,
): Point[] {
  const points = element.points ?? [];
  if (points.length < 2) return points.map((point) => ({ ...point }));
  return connectorRoutePoints({
    ...element,
    connectorRouting: routing,
    points: [{ ...points[0]! }, { ...points.at(-1)! }],
  });
}

/** Deterministic SVG path projection shared by the live renderer and native SVG export. */
export function connectorPathData(element: Pick<SketchElement, 'points' | 'connectorRouting' | 'from' | 'to'>): string {
  const points = connectorRoutePoints(element);
  if (points.length < 2) return '';
  const start = points[0]!;
  const end = points.at(-1)!;
  const routing = connectorRouting(element);
  if (routing === 'straight') return `M ${point(start)} ${points.slice(1).map((p) => `L ${point(p)}`).join(' ')}`;
  if (routing === 'elbowed') {
    return roundedPolyline(points, ELBOWED_CONNECTOR_CORNER_RADIUS);
  }
  const controlA = points[1]!;
  const controlB = points.at(-2)!;
  return `M ${point(start)} C ${point(controlA)} ${point(controlB)} ${point(end)}`;
}
