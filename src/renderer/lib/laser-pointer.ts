export interface LaserPoint {
  x: number;
  y: number;
  createdAt: number;
}

export interface LaserSegment {
  from: LaserPoint;
  to: LaserPoint;
  opacity: number;
}

/** Matches the short, disappearing presentation trail used by Excalidraw. */
export const LASER_DECAY_MS = 1_000;
export const LASER_MAX_POINTS = 50;
export const LASER_STREAMLINE = 0.4;
const LASER_CURSOR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="M7 8l10 10 3-3L10 5z" fill="white" stroke="#1e1e1e" stroke-width="1.5" stroke-linejoin="round"/><circle cx="6" cy="6" r="3.5" fill="#e03131" stroke="white" stroke-width="1.5"/></svg>';
export const LASER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(LASER_CURSOR_SVG)}") 6 6, crosshair`;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const easeOut = (value: number): number => 1 - (1 - clamp01(value)) ** 3;

export function appendLaserPoint(points: readonly LaserPoint[], point: LaserPoint): LaserPoint[] {
  const previous = points.at(-1);
  if (previous && previous.x === point.x && previous.y === point.y) return [...points];
  const smoothed = previous ? {
    x: previous.x + (point.x - previous.x) * (1 - LASER_STREAMLINE),
    y: previous.y + (point.y - previous.y) * (1 - LASER_STREAMLINE),
    createdAt: point.createdAt,
  } : point;
  return [...points, smoothed].slice(-LASER_MAX_POINTS);
}

export function liveLaserPoints(points: readonly LaserPoint[], now: number): LaserPoint[] {
  return points.filter((point) => now - point.createdAt < LASER_DECAY_MS).slice(-LASER_MAX_POINTS);
}

export function laserSegments(points: readonly LaserPoint[], now: number): LaserSegment[] {
  if (points.length < 2) return [];
  return points.slice(1).map((to, index) => {
    const temporal = easeOut(1 - (now - to.createdAt) / LASER_DECAY_MS);
    const spatial = easeOut((index + 1) / (points.length - 1));
    return { from: points[index]!, to, opacity: Math.min(temporal, spatial) };
  }).filter((segment) => segment.opacity > 0.01);
}
