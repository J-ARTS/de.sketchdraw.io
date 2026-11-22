import { describe, expect, test } from 'vitest';
import { createElement, type Point, type SketchElement } from '@/domain';
import { connectorPolyline } from '@/renderer/lib/connector-label';
import { hitElement } from '@/renderer/lib/geometry';

/** A curved connector whose two control points pull the line far away from the straight way between them. */
function curved(points: Point[], overrides: Partial<SketchElement> = {}): SketchElement {
  return createElement('connector', { id: 'edge', x: 100, y: 100, width: 400, height: 240, connectorRouting: 'curved', points, ...overrides });
}
const world = (element: SketchElement, point: Point): Point => ({ x: element.x + point.x, y: element.y + point.y });
const TOLERANCE = 7;

describe('selecting a curved connector (#255)', () => {
  test('every place on the drawn curve hits the connector', () => {
    // An S-curve: out to the right, in from the left.
    const edge = curved([{ x: 0, y: 0 }, { x: 160, y: 0 }, { x: 240, y: 240 }, { x: 400, y: 240 }]);
    const line = connectorPolyline(edge);
    expect(line.length).toBeGreaterThan(20);
    for (const point of line) expect(hitElement(edge, world(edge, point), TOLERANCE)).toBe(true);
  });

  test('the control points beside the curve do not hit it', () => {
    // An arc: both control points lie far above the line that is drawn.
    const edge = curved([{ x: 0, y: 240 }, { x: 0, y: -160 }, { x: 400, y: -160 }, { x: 400, y: 240 }]);
    const top = connectorPolyline(edge).reduce((best, point) => (point.y < best.y ? point : best));
    expect(top.y).toBeCloseTo(-60, 0);
    // The crest of the arc is hit; before the correction it was missed, because the straight ways between the
    // control points pass 100 units above it.
    expect(hitElement(edge, world(edge, top), TOLERANCE)).toBe(true);
    expect(hitElement(edge, world(edge, { x: 200, y: -160 }), TOLERANCE)).toBe(false);
    expect(hitElement(edge, world(edge, { x: 0, y: -160 }), TOLERANCE)).toBe(false);
    // The empty space inside the arc is no hit either.
    expect(hitElement(edge, world(edge, { x: 200, y: 120 }), TOLERANCE)).toBe(false);
  });

  test('a turned curve is hit where it is drawn, and the line width widens the hit', () => {
    const edge = curved([{ x: 0, y: 240 }, { x: 0, y: -160 }, { x: 400, y: -160 }, { x: 400, y: 240 }], { rotation: 90 });
    const centre = { x: edge.x + edge.width / 2, y: edge.y + edge.height / 2 };
    const top = { x: 200, y: -60 };
    // Turned by 90 degrees around the centre of the element.
    const turned = { x: centre.x - (edge.y + top.y - centre.y), y: centre.y + (edge.x + top.x - centre.x) };
    expect(hitElement(edge, turned, TOLERANCE)).toBe(true);
    const thin = curved([{ x: 0, y: 240 }, { x: 0, y: -160 }, { x: 400, y: -160 }, { x: 400, y: 240 }], { style: { ...edge.style, strokeWidth: 2 } });
    const thick = curved([{ x: 0, y: 240 }, { x: 0, y: -160 }, { x: 400, y: -160 }, { x: 400, y: 240 }], { style: { ...edge.style, strokeWidth: 12 } });
    expect(hitElement(thin, world(thin, { x: 200, y: -60 - 11 }), TOLERANCE)).toBe(false);
    expect(hitElement(thick, world(thick, { x: 200, y: -60 - 11 }), TOLERANCE)).toBe(true);
  });

  test('straight and elbowed connectors are hit as before', () => {
    const straight = createElement('connector', { id: 's', x: 0, y: 0, width: 200, height: 100, points: [{ x: 0, y: 0 }, { x: 200, y: 100 }] });
    expect(hitElement(straight, { x: 100, y: 50 }, TOLERANCE)).toBe(true);
    expect(hitElement(straight, { x: 100, y: 80 }, TOLERANCE)).toBe(false);
    const elbowed = createElement('connector', { id: 'e', x: 0, y: 0, width: 200, height: 100, connectorRouting: 'elbowed', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 100 }] });
    expect(hitElement(elbowed, { x: 100, y: 50 }, TOLERANCE)).toBe(true);
    expect(hitElement(elbowed, { x: 50, y: 50 }, TOLERANCE)).toBe(false);
  });
});

describe('the frame around a selected connector (#264)', () => {
  test('follows the line when an attached shape moves; the stored box stays where the connector was made', async () => {
    const { applyCommand, createDocument } = await import('@/domain');
    const { drawnFrame } = await import('@/renderer/lib/geometry');
    const a = createElement('rectangle', { id: 'a', x: 0, y: 0, width: 120, height: 80 });
    const b = createElement('rectangle', { id: 'b', x: 200, y: 0, width: 120, height: 80 });
    const edge = createElement('connector', { id: 'edge', x: 120, y: 40, width: 80, height: 1, connectorRouting: 'curved', points: [{ x: 0, y: 0 }, { x: 80, y: 0 }], from: { elementId: 'a', anchor: { x: 1, y: 0.5 } }, to: { elementId: 'b', anchor: { x: 0, y: 0.5 } } });
    let document = applyCommand(createDocument(), { type: 'add', elements: [a, b, edge] });
    document = applyCommand(document, { type: 'update', changes: [{ id: 'b', patch: { x: 420, y: 300 } }] });
    const moved = document.elements.find((element) => element.id === 'edge')!;
    const line = connectorPolyline(moved).map((point) => world(moved, point));
    const end = line.at(-1)!;
    expect(end.x).toBeCloseTo(420, 5);
    expect(end.y).toBeCloseTo(340, 5);
    // The stored box does not reach the new end of the line …
    expect(moved.x + moved.width).toBeLessThan(end.x - 100);
    // … the frame does: it encloses every point of the drawn line and nothing more.
    const frame = drawnFrame(moved);
    const left = frame.cx - frame.width / 2; const top = frame.cy - frame.height / 2;
    for (const point of line) {
      expect(point.x).toBeGreaterThanOrEqual(left - 1e-6); expect(point.x).toBeLessThanOrEqual(left + frame.width + 1e-6);
      expect(point.y).toBeGreaterThanOrEqual(top - 1e-6); expect(point.y).toBeLessThanOrEqual(top + frame.height + 1e-6);
    }
    expect(left).toBeCloseTo(Math.min(...line.map((point) => point.x)), 5);
    expect(frame.height).toBeCloseTo(300, 0);
    // Other elements keep the frame of their box.
    expect(drawnFrame(b)).toEqual({ cx: 260, cy: 40, width: 120, height: 80, rotation: 0 });
  });
});
