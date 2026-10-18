import { describe, expect, it } from 'vitest';
import { applyCommand, connectorRoutePoints, createDocument, createElement } from '../../src/domain/index';
import type { Point, SketchElement } from '../../src/domain/types';

function worldPoint(element: SketchElement, point: Point): Point {
  const angle = element.rotation * Math.PI / 180;
  const dx = point.x - element.width / 2;
  const dy = point.y - element.height / 2;
  return { x: element.x + element.width / 2 + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: element.y + element.height / 2 + dx * Math.sin(angle) + dy * Math.cos(angle) };
}

function expectPoint(actual: Point, expected: Point) {
  expect(actual.x).toBeCloseTo(expected.x, 8);
  expect(actual.y).toBeCloseTo(expected.y, 8);
}

describe('rotated connector attachment acceptance', () => {
  it('keeps bound endpoints attached when the connector itself is rotated', () => {
    const target = createElement('rectangle', { id: 'target', x: 200, y: 100, width: 80, height: 40, rotation: 30 });
    const edge = createElement('connector', { id: 'edge', x: 10, y: 20, width: 100, height: 60, rotation: 90,
      points: [{ x: 0, y: 0 }, { x: 100, y: 60 }], from: { elementId: 'target', anchor: { x: 1, y: 0.5 } } });
    const added = applyCommand(createDocument(), { type: 'add', elements: [target, edge] });
    const attached = added.elements.find(e => e.id === 'edge')!;
    const anchor = worldPoint(target, { x: 80, y: 20 });
    expectPoint(worldPoint(attached, attached.points![0]!), anchor);
    const moved = applyCommand(added, { type: 'update', changes: [{ id: 'edge', patch: { x: 50, rotation: 45 } }] });
    const movedEdge = moved.elements.find(e => e.id === 'edge')!;
    expectPoint(worldPoint(movedEdge, movedEdge.points![0]!), anchor);
    const deleted = applyCommand(moved, { type: 'delete', ids: ['target'] });
    const detached = deleted.elements[0]!;
    expect(detached.from).toBeUndefined();
    expectPoint(worldPoint(detached, detached.points![0]!), anchor);
  });

  it('keeps elbowed routes orthogonal when a bound target moves', () => {
    const source = createElement('rectangle', { id: 'source', x: 0, y: 0, width: 100, height: 100 });
    const target = createElement('rectangle', { id: 'target', x: 400, y: 200, width: 100, height: 100 });
    const edge = createElement('connector', {
      id: 'edge', x: 100, y: 50, width: 300, height: 200, connectorRouting: 'elbowed',
      points: [{ x: 0, y: 0 }, { x: 150, y: 0 }, { x: 150, y: 200 }, { x: 300, y: 200 }],
      from: { elementId: 'source', anchor: { x: 1, y: .5 } },
      to: { elementId: 'target', anchor: { x: 0, y: .5 } },
    });
    const added = applyCommand(createDocument(), { type: 'add', elements: [source, target, edge] });
    const moved = applyCommand(added, { type: 'update', changes: [{ id: 'target', patch: { x: 450, y: 350 } }] });
    const movedEdge = moved.elements.find((element) => element.id === 'edge')!;
    const route = connectorRoutePoints(movedEdge);
    expect(route.slice(1).every((point, index) =>
      point.x === route[index]!.x || point.y === route[index]!.y)).toBe(true);
    expect(movedEdge.points).toEqual(route);
    expectPoint(worldPoint(movedEdge, route.at(-1)!), { x: 450, y: 400 });
  });
});
