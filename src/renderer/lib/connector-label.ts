import { connectorRoutePoints, connectorRouting, type Point, type SketchElement } from '@/domain';

/**
 * Where a connector's text sits along the connector (#195): a share of its length, 0 at the start and 1 at
 * the end, kept in the element's metadata. Without an entry the text is in the middle. The point is taken
 * from the drawn route, so it stays on the line of straight, elbowed and curved connectors alike.
 */
export const CONNECTOR_LABEL_POSITION_KEY = 'connector:label-position';
export const DEFAULT_CONNECTOR_LABEL_POSITION = 0.5;
/**
 * Where the text sits across the line: without an entry on the line, with `above` over it, with `right`
 * beside it. Messages of a sequence diagram carry their text above the arrow, so several lines never cover
 * it; a call to oneself carries it right of its loop.
 */
export const CONNECTOR_LABEL_PLACEMENT_KEY = 'connector:label-placement';
export type ConnectorLabelPlacement = 'on' | 'above' | 'right';
const LINE_HEIGHT = 1.25;
/** Space between a text above the line and the line. */
const ABOVE_GAP = 4;
/** Space between a text beside the line and the line. */
const BESIDE_GAP = 6;

type Routed = Pick<SketchElement, 'points' | 'connectorRouting' | 'from' | 'to'>;

export function connectorLabelPosition(element: Pick<SketchElement, 'metadata'>): number {
  const value = Number(element.metadata?.[CONNECTOR_LABEL_POSITION_KEY]);
  return Number.isFinite(value) && element.metadata?.[CONNECTOR_LABEL_POSITION_KEY]?.trim() ? Math.max(0, Math.min(1, value)) : DEFAULT_CONNECTOR_LABEL_POSITION;
}
/** The metadata value for a position; three decimals are finer than a pixel on any realistic connector. */
export function formatConnectorLabelPosition(position: number): string {
  return String(Math.round(Math.max(0, Math.min(1, position)) * 1000) / 1000);
}

/** The drawn line as a polyline in element-local coordinates; a curve is sampled finely enough to look smooth. */
export function connectorPolyline(element: Routed): Point[] {
  const route = connectorRoutePoints(element);
  if (route.length < 2 || connectorRouting(element) !== 'curved' || route.length < 4) return route;
  const [a, b, c, d] = [route[0]!, route[1]!, route.at(-2)!, route.at(-1)!];
  const steps = 48;
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    const u = 1 - t;
    return {
      x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
      y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
    };
  });
}

/** The point at a share of the connector's length, in element-local coordinates. */
export function pointOnConnector(element: Routed, position: number): Point {
  const line = connectorPolyline(element);
  if (!line.length) return { x: 0, y: 0 };
  const lengths = line.slice(1).map((point, index) => Math.hypot(point.x - line[index]!.x, point.y - line[index]!.y));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let rest = Math.max(0, Math.min(1, position)) * total;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index]!;
    if (rest <= length || index === lengths.length - 1) {
      const share = length > 0 ? Math.min(1, rest / length) : 0;
      const from = line[index]!;
      const to = line[index + 1]!;
      return { x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share };
    }
    rest -= length;
  }
  return line[0]!;
}

/** The share of the connector's length that is nearest to a point given in element-local coordinates. */
export function nearestConnectorPosition(element: Routed, point: Point): number {
  const line = connectorPolyline(element);
  if (line.length < 2) return DEFAULT_CONNECTOR_LABEL_POSITION;
  const lengths = line.slice(1).map((entry, index) => Math.hypot(entry.x - line[index]!.x, entry.y - line[index]!.y));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total <= 0) return DEFAULT_CONNECTOR_LABEL_POSITION;
  let best = { distance: Number.POSITIVE_INFINITY, along: 0 };
  let travelled = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const from = line[index]!;
    const to = line[index + 1]!;
    const length = lengths[index]!;
    const share = length > 0 ? Math.max(0, Math.min(1, ((point.x - from.x) * (to.x - from.x) + (point.y - from.y) * (to.y - from.y)) / (length * length))) : 0;
    const distance = Math.hypot(point.x - (from.x + (to.x - from.x) * share), point.y - (from.y + (to.y - from.y) * share));
    if (distance < best.distance) best = { distance, along: travelled + length * share };
    travelled += length;
  }
  return best.along / total;
}

export function connectorLabelPlacement(element: Pick<SketchElement, 'metadata'>): ConnectorLabelPlacement {
  const value = element.metadata?.[CONNECTOR_LABEL_PLACEMENT_KEY];
  return value === 'above' || value === 'right' ? value : 'on';
}
/** The lines of a connector's text as the user broke them; empty lines at the end take no room. */
export function connectorLabelLines(text: string | null | undefined): string[] {
  const lines = (text ?? '').replace(/\r\n?/g, '\n').split('\n').map((line) => line.trimEnd());
  while (lines.length > 1 && !lines.at(-1)) lines.pop();
  return lines;
}
/** The room a connector's text takes; a single line keeps the size it always had. */
export function connectorLabelSize(text: string | null | undefined, fontSize: number): { width: number; height: number; lines: string[]; lineHeight: number } {
  const lines = connectorLabelLines(text);
  const longest = Math.max(0, ...lines.map((line) => Array.from(line).length));
  const lineHeight = fontSize * LINE_HEIGHT;
  return { width: Math.max(36, longest * fontSize * 0.62 + 16), height: lines.length * lineHeight + fontSize * 0.35, lines, lineHeight };
}
type Labelled = Routed & Pick<SketchElement, 'metadata' | 'text' | 'style'>;
/** Centre of the text block, in element-local coordinates. */
export function connectorLabelCentre(element: Labelled, position: number = connectorLabelPosition(element)): Point {
  const at = pointOnConnector(element, position);
  const placement = connectorLabelPlacement(element);
  if (placement === 'on') return at;
  const size = connectorLabelSize(element.text, element.style.fontSize);
  return placement === 'above' ? { x: at.x, y: at.y - size.height / 2 - ABOVE_GAP } : { x: at.x + size.width / 2 + BESIDE_GAP, y: at.y };
}
/** How far below the point on the line the grip of the text sits (before the grip's own screen distance). */
export function connectorLabelGripDrop(element: Labelled): number {
  return connectorLabelPlacement(element) === 'on' ? connectorLabelSize(element.text, element.style.fontSize).height / 2 : 0;
}
