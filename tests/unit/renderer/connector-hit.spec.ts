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
