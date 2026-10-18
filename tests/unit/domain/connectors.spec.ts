import { describe, expect, test } from 'vitest';
import {
  applyCommand,
  connectorPathData,
  connectorRoutePoints,
  createDocument,
  createElement,
  deserializeDocument,
  serializeDocument,
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
