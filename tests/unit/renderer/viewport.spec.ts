import { describe, expect, it } from 'vitest';
import { ZOOM_MAX, ZOOM_MIN } from '@/renderer/lib/constants';
import {
  centerOnPoint,
  clampZoom,
  docToScreen,
  fitRect,
  isVisible,
  keepCenterOnResize,
  panBy,
  screenToDoc,
  visibleDocRect,
  wheelToAction,
  zoomAround,
  zoomLabel,
} from '@/renderer/lib/viewport';
import type { Size, Viewport, WheelInput } from '@/renderer/state/contract';

const SIZE: Size = { width: 1000, height: 800 };

function wheel(overrides: Partial<WheelInput>): WheelInput {
  return { x: 0, y: 0, deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, shiftKey: false, ...overrides };
}

function zoomFactor(overrides: Partial<WheelInput>): number {
  const action = wheelToAction(wheel({ ctrlKey: true, ...overrides }));
  if (action.kind !== 'zoom') throw new Error('expected a zoom action');
  return action.factor;
}

describe('docToScreen / screenToDoc', () => {
  it('applies screen = doc * zoom + pan', () => {
    const vp: Viewport = { zoom: 2, panX: 10, panY: 20 };
    expect(docToScreen(vp, { x: 5, y: 7 })).toEqual({ x: 20, y: 34 });
    expect(screenToDoc(vp, { x: 20, y: 34 })).toEqual({ x: 5, y: 7 });
  });

  it.each([0.1, 0.25, 1, 2, 4])('round-trips doc -> screen -> doc at zoom %s', (zoom) => {
    const vp: Viewport = { zoom, panX: 123.5, panY: -47.25 };
    for (const point of [{ x: 0, y: 0 }, { x: -1500.75, y: 2200.5 }, { x: 999999, y: -999999 }]) {
      const back = screenToDoc(vp, docToScreen(vp, point));
      expect(back.x).toBeCloseTo(point.x, 6);
      expect(back.y).toBeCloseTo(point.y, 6);
    }
  });
});

describe('clampZoom', () => {
  it('clamps to 10 % .. 400 %', () => {
    expect(clampZoom(0.05)).toBe(ZOOM_MIN);
    expect(clampZoom(0.1)).toBe(0.1);
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(4)).toBe(4);
    expect(clampZoom(10)).toBe(ZOOM_MAX);
    expect(clampZoom(-3)).toBe(ZOOM_MIN);
  });

  it('handles non-finite values without producing NaN', () => {
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(ZOOM_MAX);
    expect(clampZoom(Number.NEGATIVE_INFINITY)).toBe(ZOOM_MIN);
    expect(clampZoom(Number.NaN)).toBe(1);
  });
});

describe('zoomAround', () => {
  const starts: Viewport[] = [
    { zoom: 1, panX: 0, panY: 0 },
    { zoom: 0.25, panX: 300, panY: -120 },
    { zoom: 3, panX: -800.5, panY: 42 },
  ];

  it.each([0.1, 0.5, 1, 2.5, 4])('keeps the document point under the anchor (target zoom %s)', (target) => {
    const anchor = { x: 345.5, y: 210.25 };
    for (const start of starts) {
      const before = screenToDoc(start, anchor);
      const next = zoomAround(start, target, anchor);
      const after = screenToDoc(next, anchor);
      expect(next.zoom).toBe(target);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
    }
  });

  it('clamps the target zoom and still holds the anchor', () => {
    const start: Viewport = { zoom: 2, panX: 50, panY: 60 };
    const anchor = { x: 400, y: 300 };
    const before = screenToDoc(start, anchor);
    for (const [requested, expected] of [[100, ZOOM_MAX], [0.0001, ZOOM_MIN]] as const) {
      const next = zoomAround(start, requested, anchor);
      expect(next.zoom).toBe(expected);
      const after = screenToDoc(next, anchor);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
    }
  });

  it('leaves the viewport unchanged when the zoom does not change', () => {
    const start: Viewport = { zoom: 1.5, panX: 12.3, panY: 45.6 };
    expect(zoomAround(start, 1.5, { x: 77, y: 88 })).toEqual(start);
    expect(zoomAround({ zoom: ZOOM_MAX, panX: 1, panY: 2 }, 50, { x: 9, y: 9 })).toEqual({ zoom: ZOOM_MAX, panX: 1, panY: 2 });
  });

  it('does not mutate its input', () => {
    const start: Viewport = { zoom: 1, panX: 5, panY: 6 };
    zoomAround(start, 2, { x: 1, y: 1 });
    expect(start).toEqual({ zoom: 1, panX: 5, panY: 6 });
  });
});

describe('panBy', () => {
  it('moves the pan offset and keeps the zoom', () => {
    expect(panBy({ zoom: 2, panX: 10, panY: 20 }, -4, 6)).toEqual({ zoom: 2, panX: 6, panY: 26 });
  });
});

describe('centerOnPoint', () => {
  it('places the document point at the canvas center without changing zoom', () => {
    const next = centerOnPoint({ zoom: 2, panX: 99, panY: 99 }, SIZE, { x: 300, y: -40 });
    expect(next.zoom).toBe(2);
    expect(docToScreen(next, { x: 300, y: -40 })).toEqual({ x: 500, y: 400 });
  });
});

describe('fitRect', () => {
  it('fits the limiting axis inside the padding and centers the rect', () => {
    const next = fitRect(SIZE, { x: 0, y: 0, width: 500, height: 400 }, 50);
    expect(next.zoom).toBeCloseTo(1.75, 9);
    expect(next.panX).toBeCloseTo(62.5, 9);
    expect(next.panY).toBeCloseTo(50, 9);
  });

  it('centers rects that are not at the origin', () => {
    const rect = { x: -3000, y: 1200, width: 800, height: 300 };
    const next = fitRect(SIZE, rect, 40);
    const center = docToScreen(next, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
    expect(center.x).toBeCloseTo(SIZE.width / 2, 6);
    expect(center.y).toBeCloseTo(SIZE.height / 2, 6);
    const topLeft = docToScreen(next, { x: rect.x, y: rect.y });
    const bottomRight = docToScreen(next, { x: rect.x + rect.width, y: rect.y + rect.height });
    expect(topLeft.x).toBeGreaterThanOrEqual(40 - 1e-6);
    expect(bottomRight.x).toBeLessThanOrEqual(SIZE.width - 40 + 1e-6);
    expect(topLeft.y).toBeGreaterThanOrEqual(40 - 1e-6);
    expect(bottomRight.y).toBeLessThanOrEqual(SIZE.height - 40 + 1e-6);
  });

  it('clamps tiny and huge rects to the zoom range', () => {
    expect(fitRect(SIZE, { x: 0, y: 0, width: 4, height: 4 }, 50).zoom).toBe(ZOOM_MAX);
    expect(fitRect(SIZE, { x: 0, y: 0, width: 1_000_000, height: 1_000_000 }, 50).zoom).toBe(ZOOM_MIN);
  });

  it('honors a lower maximum zoom', () => {
    expect(fitRect(SIZE, { x: 0, y: 0, width: 4, height: 4 }, 50, 1).zoom).toBe(1);
  });

  it('handles zero-sized axes', () => {
    const line = fitRect(SIZE, { x: 100, y: 100, width: 0, height: 350 }, 50);
    expect(line.zoom).toBeCloseTo(2, 9);
    const point = fitRect(SIZE, { x: 40, y: 60, width: 0, height: 0 }, 50);
    expect(point.zoom).toBe(1);
    expect(docToScreen(point, { x: 40, y: 60 })).toEqual({ x: 500, y: 400 });
  });

  it('stays finite when the padding exceeds the canvas', () => {
    const next = fitRect({ width: 100, height: 100 }, { x: 0, y: 0, width: 200, height: 200 }, 80);
    expect(next.zoom).toBe(ZOOM_MIN);
    expect(Number.isFinite(next.panX)).toBe(true);
    expect(Number.isFinite(next.panY)).toBe(true);
  });
});

describe('keepCenterOnResize', () => {
  it('keeps the document point at the canvas center', () => {
    const vp: Viewport = { zoom: 2, panX: 100, panY: 50 };
    const oldSize: Size = { width: 800, height: 600 };
    const newSize: Size = { width: 1000, height: 700 };
    const centerDoc = screenToDoc(vp, { x: 400, y: 300 });
    const next = keepCenterOnResize(vp, oldSize, newSize);
    const centerScreen = docToScreen(next, centerDoc);
    expect(next.zoom).toBe(2);
    expect(centerScreen.x).toBeCloseTo(500, 9);
    expect(centerScreen.y).toBeCloseTo(350, 9);
  });

  it('is a no-op for an unchanged size and reversible', () => {
    const vp: Viewport = { zoom: 0.5, panX: -20, panY: 30 };
    expect(keepCenterOnResize(vp, SIZE, SIZE)).toEqual(vp);
    const there = keepCenterOnResize(vp, SIZE, { width: 640, height: 480 });
    const back = keepCenterOnResize(there, { width: 640, height: 480 }, SIZE);
    expect(back.panX).toBeCloseTo(vp.panX, 9);
    expect(back.panY).toBeCloseTo(vp.panY, 9);
  });
});

describe('zoomLabel', () => {
  it('shows whole percents in German notation', () => {
    expect(zoomLabel(1)).toBe('100 %');
    expect(zoomLabel(0.1)).toBe('10 %');
    expect(zoomLabel(0.25)).toBe('25 %');
    expect(zoomLabel(1.5)).toBe('150 %');
    expect(zoomLabel(4)).toBe('400 %');
    expect(zoomLabel(0.333)).toBe('33 %');
  });

  it('falls back to 100 % for non-finite input', () => {
    expect(zoomLabel(Number.NaN)).toBe('100 %');
  });
});

describe('wheelToAction', () => {
  it('pans opposite to the wheel delta without Ctrl', () => {
    expect(wheelToAction(wheel({ deltaX: 10, deltaY: 30 }))).toEqual({ kind: 'pan', dx: -10, dy: -30 });
  });

  it('never returns negative zero', () => {
    const action = wheelToAction(wheel({ deltaX: 0, deltaY: 0 }));
    expect(action.kind).toBe('pan');
    if (action.kind === 'pan') {
      expect(Object.is(action.dx, 0)).toBe(true);
      expect(Object.is(action.dy, 0)).toBe(true);
    }
  });

  it('zooms in for negative deltaY and out for positive deltaY with Ctrl', () => {
    expect(zoomFactor({ deltaY: -100 })).toBeGreaterThan(1);
    expect(zoomFactor({ deltaY: 100 })).toBeLessThan(1);
    expect(zoomFactor({ deltaY: 0 })).toBe(1);
  });

  it('zooms exponentially so opposite and split gestures compose', () => {
    expect(zoomFactor({ deltaY: -80 }) * zoomFactor({ deltaY: 80 })).toBeCloseTo(1, 9);
    expect(zoomFactor({ deltaY: -30 }) * zoomFactor({ deltaY: -50 })).toBeCloseTo(zoomFactor({ deltaY: -80 }), 9);
  });

  it('bounds the factor for extreme deltas', () => {
    const huge = zoomFactor({ deltaY: 1e9 });
    expect(huge).toBeGreaterThan(0);
    expect(huge).toBeLessThan(1);
    expect(huge).toBeCloseTo(zoomFactor({ deltaY: 240 }), 9);
    expect(zoomFactor({ deltaY: Number.NaN })).toBe(1);
  });

  it('converts line and page delta modes to pixels', () => {
    expect(wheelToAction(wheel({ deltaY: 3, deltaMode: 1 }))).toEqual({ kind: 'pan', dx: 0, dy: -48 });
    expect(wheelToAction(wheel({ deltaY: 1, deltaMode: 2 }))).toEqual({ kind: 'pan', dx: 0, dy: -800 });
    expect(zoomFactor({ deltaY: -3, deltaMode: 1 })).toBeCloseTo(zoomFactor({ deltaY: -48, deltaMode: 0 }), 9);
  });

  it('turns a vertical wheel with Shift into horizontal panning', () => {
    expect(wheelToAction(wheel({ shiftKey: true, deltaY: 40 }))).toEqual({ kind: 'pan', dx: -40, dy: 0 });
    expect(wheelToAction(wheel({ shiftKey: true, deltaX: 25, deltaY: 40 }))).toEqual({ kind: 'pan', dx: -25, dy: -40 });
  });

  it('treats non-finite deltas as zero', () => {
    expect(wheelToAction(wheel({ deltaX: Number.NaN, deltaY: Number.POSITIVE_INFINITY }))).toEqual({ kind: 'pan', dx: 0, dy: 0 });
  });
});

describe('visibleDocRect', () => {
  it('returns the document area shown by the canvas', () => {
    expect(visibleDocRect({ zoom: 2, panX: -100, panY: -50 }, { width: 800, height: 600 })).toEqual({
      x: 50,
      y: 25,
      width: 400,
      height: 300,
    });
  });
});

describe('isVisible', () => {
  const size: Size = { width: 800, height: 600 };
  const origin: Viewport = { zoom: 1, panX: 0, panY: 0 };

  it('detects rects inside, partially inside and fully outside', () => {
    expect(isVisible({ x: 10, y: 10, width: 50, height: 50 }, origin, size)).toBe(true);
    expect(isVisible({ x: -50, y: 10, width: 100, height: 50 }, origin, size)).toBe(true);
    expect(isVisible({ x: -200, y: 10, width: 100, height: 50 }, origin, size)).toBe(false);
    expect(isVisible({ x: 900, y: 10, width: 100, height: 50 }, origin, size)).toBe(false);
    expect(isVisible({ x: 10, y: -300, width: 100, height: 50 }, origin, size)).toBe(false);
    expect(isVisible({ x: 10, y: 700, width: 100, height: 50 }, origin, size)).toBe(false);
  });

  it('counts a rect touching the canvas edge as visible', () => {
    expect(isVisible({ x: -100, y: 0, width: 100, height: 10 }, origin, size)).toBe(true);
  });

  it('supports zero-sized rects such as straight connectors', () => {
    expect(isVisible({ x: 100, y: 100, width: 0, height: 80 }, origin, size)).toBe(true);
    expect(isVisible({ x: 1000, y: 100, width: 0, height: 80 }, origin, size)).toBe(false);
  });

  it('accounts for zoom and pan', () => {
    const rect = { x: 100, y: 100, width: 10, height: 10 };
    expect(isVisible(rect, { zoom: 2, panX: -300, panY: -300 }, size)).toBe(false);
    expect(isVisible(rect, { zoom: 2, panX: -150, panY: -150 }, size)).toBe(true);
  });
});
