import { describe, expect, test } from 'vitest';
import {
  applyCommand,
  connectorPathData,
  connectorRoutePoints,
  connectorRoutePointsForRouting,
  createDocument,
  createElement,
  deserializeDocument,
  moveElbowedSegment,
  serializeDocument,
  type ConnectorMarker,
} from '@/domain';

describe('connector contract', () => {
  test('creates explicit backward-compatible defaults and preserves them through cloning and JSON', () => {
    const connector = createElement('connector', { width: 120, height: 40 });
    expect(connector).toMatchObject({ connectorRouting: 'straight', startMarker: 'none', endMarker: 'line-arrow' });
    const document = createDocument('Connectors');
    document.elements = [connector];
    expect(deserializeDocument(serializeDocument(document)).elements[0]).toMatchObject({
      connectorRouting: 'straight', startMarker: 'none', endMarker: 'line-arrow',
    });
  });

  test('preserves the complete endpoint marker palette through JSON', () => {
    const markers: ConnectorMarker[] = [
      'none', 'line-arrow', 'solid-arrow', 'triangle', 'solid-triangle', 'reverse-triangle', 'circle', 'solid-circle', 'diamond',
      'exactly-one', 'many', 'zero-or-one', 'zero-or-many', 'one-or-many',
    ];
    for (const [index, marker] of markers.entries()) {
      const document = createDocument(`Marker ${marker}`);
      document.elements = [createElement('connector', { id: `edge-${index}`, startMarker: marker, endMarker: marker })];
      expect(deserializeDocument(serializeDocument(document)).elements[0]).toMatchObject({ startMarker: marker, endMarker: marker });
    }
  });

  test('projects straight, elbowed and curved routes to distinct deterministic SVG paths', () => {
    const base = createElement('connector', { width: 160, height: 80, points: [{ x: 0, y: 0 }, { x: 160, y: 80 }], from: { elementId: 'a', anchor: { x: 1, y: .5 } }, to: { elementId: 'b', anchor: { x: 0, y: .5 } } });
    expect(connectorPathData({ ...base, connectorRouting: 'straight' })).toBe('M 0 0 L 160 80');
    expect(connectorPathData({ ...base, connectorRouting: 'elbowed' })).toContain(' Q ');
    expect(connectorPathData({ ...base, connectorRouting: 'curved' })).toContain(' C ');
  });

  test('exposes deterministic editable points and renders persisted custom routes', () => {
    const base = createElement('connector', { width: 160, height: 80, points: [{ x: 0, y: 0 }, { x: 160, y: 80 }], from: { elementId: 'a', anchor: { x: 1, y: .5 } }, to: { elementId: 'b', anchor: { x: 0, y: .5 } } });
    expect(connectorRoutePoints({ ...base, connectorRouting: 'elbowed' })).toEqual([
      { x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 160, y: 80 },
    ]);
    expect(connectorRoutePoints({ ...base, connectorRouting: 'curved' })).toHaveLength(4);
    const custom = { ...base, connectorRouting: 'elbowed' as const, points: [{ x: 0, y: 0 }, { x: 48, y: 0 }, { x: 48, y: 80 }, { x: 160, y: 80 }] };
    expect(connectorRoutePoints(custom)).toEqual(custom.points);
    expect(connectorPathData(custom)).toContain('48');
  });

  test('moves an elbowed segment parallel while every route leg stays orthogonal', () => {
    const route = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 160, y: 80 }];
    const moved = moveElbowedSegment(route, 1, { x: 112, y: 40 });
    expect(moved).toEqual([{ x: 0, y: 0 }, { x: 112, y: 0 }, { x: 112, y: 80 }, { x: 160, y: 80 }]);
    expect(moved.slice(1).every((point, index) => point.x === moved[index]!.x || point.y === moved[index]!.y)).toBe(true);
  });

  test('adds right-angle turns when an outer segment is moved and preserves both endpoints', () => {
    const route = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 160, y: 80 }];
    const moved = moveElbowedSegment(route, 0, { x: 40, y: -48 }, 24);
    expect(moved[0]).toEqual(route[0]);
    expect(moved.at(-1)).toEqual(route.at(-1));
    expect(moved).toEqual([
      { x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: -48 },
      { x: 80, y: -48 }, { x: 80, y: 80 }, { x: 160, y: 80 },
    ]);
    expect(moved.slice(1).every((point, index) => point.x === moved[index]!.x || point.y === moved[index]!.y)).toBe(true);
  });

  test('a segment dragged back next to its neighbours snaps into line and merges instead of leaving a jog', () => {
    const jogged = [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: -48 }, { x: 80, y: -48 }, { x: 80, y: 80 }, { x: 160, y: 80 }];
    const merged = moveElbowedSegment(jogged, 2, { x: 50, y: 3 }, 24, 6);
    expect(merged).toEqual([{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 160, y: 80 }]);
    // Without snapping the same drop would keep a 3-unit jog (and a handle for every tiny segment).
    expect(moveElbowedSegment(jogged, 2, { x: 50, y: 3 }, 24, 0).length).toBeGreaterThan(4);
    // Far away from every other axis the segment moves freely.
    expect(moveElbowedSegment(jogged, 2, { x: 50, y: -30 }, 24, 6)[2]).toEqual({ x: 24, y: -30 });
  });

  test('rebuilds route geometry when the line type changes instead of retaining stale bends', () => {
    const custom = createElement('connector', {
      width: 160,
      height: 80,
      connectorRouting: 'elbowed',
      points: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 50 }, { x: 120, y: 50 }, { x: 120, y: 80 }, { x: 160, y: 80 }],
      from: { elementId: 'a', anchor: { x: 1, y: .5 } },
      to: { elementId: 'b', anchor: { x: 0, y: .5 } },
    });
    expect(connectorRoutePointsForRouting(custom, 'straight')).toEqual([{ x: 0, y: 0 }, { x: 160, y: 80 }]);
    expect(connectorRoutePointsForRouting(custom, 'elbowed')).toEqual([
      { x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 160, y: 80 },
    ]);
    expect(connectorRoutePointsForRouting(custom, 'curved')).toHaveLength(4);
  });

  test('normalizes stale route points to the active line type', () => {
    const stale = createElement('connector', {
      connectorRouting: 'elbowed',
      points: [
        { x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 50 },
        { x: 120, y: 50 }, { x: 120, y: 80 }, { x: 160, y: 80 },
      ],
    });
    expect(connectorRoutePoints({ ...stale, connectorRouting: 'straight' })).toEqual([
      { x: 0, y: 0 }, { x: 160, y: 80 },
    ]);
    expect(connectorRoutePoints({ ...stale, connectorRouting: 'curved' })).toEqual([
      { x: 0, y: 0 }, { x: 30, y: 0 }, { x: 120, y: 80 }, { x: 160, y: 80 },
    ]);

    const legacyDiagonal = { ...stale, points: [
      { x: 0, y: 0 }, { x: 30, y: 20 }, { x: 120, y: 50 }, { x: 160, y: 80 },
    ] };
    const orthogonal = connectorRoutePoints(legacyDiagonal);
    expect(orthogonal.slice(1).every((point, index) =>
      point.x === orthogonal[index]!.x || point.y === orthogonal[index]!.y)).toBe(true);
    expect(orthogonal[0]).toEqual({ x: 0, y: 0 });
    expect(orthogonal.at(-1)).toEqual({ x: 160, y: 80 });
  });

  test('patches connector presentation fields without losing endpoint bindings', () => {
    const document = createDocument('Patch');
    document.elements = [
      createElement('rectangle', { id: 'a' }), createElement('rectangle', { id: 'b', x: 300 }),
      createElement('connector', { id: 'edge', from: { elementId: 'a', anchor: { x: 1, y: .5 } }, to: { elementId: 'b', anchor: { x: 0, y: .5 } } }),
    ];
    const changed = applyCommand(document, { type: 'update', changes: [{ id: 'edge', patch: { connectorRouting: 'curved', startMarker: 'circle', endMarker: 'diamond' } }] });
    expect(changed.elements[2]).toMatchObject({ connectorRouting: 'curved', startMarker: 'circle', endMarker: 'diamond', from: { elementId: 'a' }, to: { elementId: 'b' } });
  });
});
