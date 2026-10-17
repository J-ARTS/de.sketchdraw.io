import type { Point } from '@/domain/types';
import type { Rect, Size, Viewport, WheelInput } from '@/renderer/state/contract';
import { ZOOM_MAX, ZOOM_MIN } from './constants';

const LINE_HEIGHT_PX = 16;
/** Wheel events do not carry the page height; a fixed estimate keeps page-mode scrolling predictable. */
const PAGE_HEIGHT_PX = 800;
/** exp(-deltaY * k): one 100 px wheel notch changes the zoom by about 22 %. */
const WHEEL_ZOOM_SENSITIVITY = 0.002;
const MAX_WHEEL_ZOOM_DELTA_PX = 240;

export type WheelAction =
  | { kind: 'zoom'; factor: number }
  | { kind: 'pan'; dx: number; dy: number };

export function docToScreen(vp: Viewport, p: Point): Point {
  return { x: p.x * vp.zoom + vp.panX, y: p.y * vp.zoom + vp.panY };
}

export function screenToDoc(vp: Viewport, p: Point): Point {
  return { x: (p.x - vp.panX) / vp.zoom, y: (p.y - vp.panY) / vp.zoom };
}

export function clampZoom(zoom: number): number {
  if (Number.isNaN(zoom)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/** The document point under `anchorScreen` stays under it. */
export function zoomAround(vp: Viewport, newZoom: number, anchorScreen: Point): Viewport {
  const zoom = clampZoom(newZoom);
  if (zoom === vp.zoom) return { ...vp };
  const doc = screenToDoc(vp, anchorScreen);
  return {
    zoom,
    panX: anchorScreen.x - doc.x * zoom,
    panY: anchorScreen.y - doc.y * zoom,
  };
}

export function panBy(vp: Viewport, dx: number, dy: number): Viewport {
  return { zoom: vp.zoom, panX: vp.panX + dx, panY: vp.panY + dy };
}

/** Centers `docPoint` in a canvas of `size` without changing the zoom. */
export function centerOnPoint(vp: Viewport, size: Size, docPoint: Point): Viewport {
  return {
    zoom: vp.zoom,
    panX: size.width / 2 - docPoint.x * vp.zoom,
    panY: size.height / 2 - docPoint.y * vp.zoom,
  };
}

/** Zoom is clamped to the global range and to `maxZoom`; a zero-sized rect axis is ignored when fitting. */
export function fitRect(size: Size, rect: Rect, padding: number, maxZoom: number = ZOOM_MAX): Viewport {
  const availableWidth = Math.max(1, size.width - 2 * padding);
  const availableHeight = Math.max(1, size.height - 2 * padding);
  let zoom = 1;
  if (rect.width > 0 && rect.height > 0) {
    zoom = Math.min(availableWidth / rect.width, availableHeight / rect.height);
  } else if (rect.width > 0) {
    zoom = availableWidth / rect.width;
  } else if (rect.height > 0) {
    zoom = availableHeight / rect.height;
  }
  zoom = Math.min(clampZoom(zoom), clampZoom(maxZoom));
  return centerOnPoint(
    { panX: 0, panY: 0, zoom },
    size,
    { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
  );
}

/** The document point at the canvas center stays at the center after a resize. */
export function keepCenterOnResize(vp: Viewport, oldSize: Size, newSize: Size): Viewport {
  return {
    zoom: vp.zoom,
    panX: vp.panX + (newSize.width - oldSize.width) / 2,
    panY: vp.panY + (newSize.height - oldSize.height) / 2,
  };
}

/** Whole percent, e.g. "100 %". */
export function zoomLabel(zoom: number): string {
  const percent = Number.isFinite(zoom) ? Math.round(zoom * 100) : 100;
  return `${percent} %`;
}

function normalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}

function wheelDeltaToPixels(delta: number, deltaMode: number): number {
  if (!Number.isFinite(delta)) return 0;
  if (deltaMode === 1) return delta * LINE_HEIGHT_PX;
  if (deltaMode === 2) return delta * PAGE_HEIGHT_PX;
  return delta;
}

/** Callers pass `ctrlKey` as true for both Ctrl and Cmd wheel events (and for trackpad pinch). */
export function wheelToAction(input: WheelInput): WheelAction {
  const dx = wheelDeltaToPixels(input.deltaX, input.deltaMode);
  const dy = wheelDeltaToPixels(input.deltaY, input.deltaMode);
  if (input.ctrlKey) {
    const clamped = Math.max(-MAX_WHEEL_ZOOM_DELTA_PX, Math.min(MAX_WHEEL_ZOOM_DELTA_PX, dy));
    return { kind: 'zoom', factor: Math.exp(-clamped * WHEEL_ZOOM_SENSITIVITY) };
  }
  // Shift turns a vertical wheel into horizontal panning unless the device already sent horizontal delta.
  if (input.shiftKey && dx === 0) {
    return { kind: 'pan', dx: normalizeZero(-dy), dy: 0 };
  }
  return { kind: 'pan', dx: normalizeZero(-dx), dy: normalizeZero(-dy) };
}

/** Document-space rectangle currently shown by the canvas. */
export function visibleDocRect(vp: Viewport, size: Size): Rect {
  return {
    x: -vp.panX / vp.zoom,
    y: -vp.panY / vp.zoom,
    width: size.width / vp.zoom,
    height: size.height / vp.zoom,
  };
}

/** True if any part of `rect` (document coordinates) lies inside the canvas; touching the edge counts. */
export function isVisible(rect: Rect, vp: Viewport, size: Size): boolean {
  const left = rect.x * vp.zoom + vp.panX;
  const top = rect.y * vp.zoom + vp.panY;
  const right = left + rect.width * vp.zoom;
  const bottom = top + rect.height * vp.zoom;
  return right >= 0 && left <= size.width && bottom >= 0 && top <= size.height;
}
